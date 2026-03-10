import { Job } from "bullmq";
import { db, videoProcessingJobs } from "@alh/db";
import { eq } from "drizzle-orm";
import type { VideoProcessingJobData } from "@alh/queues";
import { logger } from "@alh/observability";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const log = logger.child({ module: "video-processing-processor" });

// ─── Constants ───────────────────────────────────────────────────────────────

const PYTHON_SCRIPT = path.resolve(__dirname, "../scripts/process-video.py");
const PYTHON_TIMEOUT_MS = 300_000; // 5 minutes
const FFMPEG_TIMEOUT_MS = 120_000; // 2 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Concatenate multiple video clips into a single file using ffmpeg filter_complex.
 * Returns the path to the combined output file.
 */
function concatenateClips(clips: string[], outputPath: string): void {
  if (clips.length === 0) {
    throw new Error("No clips to concatenate");
  }

  if (clips.length === 1) {
    // Single clip — just copy it
    fs.copyFileSync(clips[0], outputPath);
    return;
  }

  // Validate all clips exist
  for (const clip of clips) {
    if (!fs.existsSync(clip)) {
      throw new Error(`Input clip not found: ${clip}`);
    }
  }

  // Build ffmpeg concat command
  const inputArgs = clips.map((c) => `-i "${c}"`).join(" ");
  const filterInputs = clips.map((_, i) => `[${i}:v][${i}:a]`).join("");
  const filterComplex = `${filterInputs}concat=n=${clips.length}:v=1:a=1[v][a]`;

  const cmd = [
    "ffmpeg -y",
    inputArgs,
    `-filter_complex "${filterComplex}"`,
    '-map "[v]" -map "[a]"',
    `-c:v libx264 -preset fast -crf 23`,
    `-c:a aac -b:a 128k`,
    `"${outputPath}"`,
  ].join(" ");

  log.info({ cmd, clipCount: clips.length }, "Concatenating clips with ffmpeg");

  execSync(cmd, {
    timeout: FFMPEG_TIMEOUT_MS,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (!fs.existsSync(outputPath)) {
    throw new Error(`ffmpeg concat failed — output not created: ${outputPath}`);
  }

  log.info({ outputPath }, "Clips concatenated successfully");
}

// ─── Main Processor ──────────────────────────────────────────────────────────

export async function processVideoJob(job: Job<VideoProcessingJobData>) {
  const { tenantId, jobId } = job.data;

  log.info({ tenantId, jobId, bullmqJobId: job.id }, "Starting video processing");

  // ── Load the video processing job from DB ────────────────────────────────

  const rows = await db
    .select()
    .from(videoProcessingJobs)
    .where(eq(videoProcessingJobs.id, jobId))
    .limit(1);

  const videoJob = rows[0];
  if (!videoJob) {
    throw new Error(`Video processing job not found: id=${jobId}`);
  }

  if (videoJob.tenantId !== tenantId) {
    throw new Error(`Tenant mismatch: job tenant=${videoJob.tenantId}, expected=${tenantId}`);
  }

  // ── Update status to processing ──────────────────────────────────────────

  await db
    .update(videoProcessingJobs)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(videoProcessingJobs.id, jobId));

  // ── Set up working directory ─────────────────────────────────────────────

  const workDir = path.join(os.tmpdir(), "video-processing", `job-${jobId}`);
  ensureDir(workDir);

  try {
    // ── Get input video paths ────────────────────────────────────────────

    const inputUrls = (videoJob.inputUrls ?? []) as string[];
    if (inputUrls.length === 0) {
      throw new Error("No input URLs provided");
    }

    log.info(
      { jobId, clipCount: videoJob.clipCount, inputCount: inputUrls.length },
      "Processing video inputs"
    );

    // ── Concatenate clips if needed (multi-clip / 30s videos) ────────────

    let inputVideoPath: string;

    if (inputUrls.length > 1) {
      // Multiple clips — concatenate first
      const combinedPath = path.join(workDir, "combined.mp4");
      concatenateClips(inputUrls, combinedPath);
      inputVideoPath = combinedPath;
    } else {
      // Single clip — use directly
      inputVideoPath = inputUrls[0];
    }

    // Verify input exists
    if (!fs.existsSync(inputVideoPath)) {
      throw new Error(`Input video not found: ${inputVideoPath}`);
    }

    // ── Run Python processing script ─────────────────────────────────────

    const outputPath = path.join(workDir, "final.mp4");
    const musicGenre = videoJob.musicGenre ?? "hiphop";

    // Determine the script path — check both dist (production) and source locations
    let scriptPath = PYTHON_SCRIPT;
    if (!fs.existsSync(scriptPath)) {
      // Try relative to the source file's actual location
      const altPath = path.resolve(
        path.dirname(__filename ?? __dirname),
        "..",
        "scripts",
        "process-video.py"
      );
      if (fs.existsSync(altPath)) {
        scriptPath = altPath;
      } else {
        // Last resort: look in the worker root
        const rootPath = path.resolve(__dirname, "..", "..", "scripts", "process-video.py");
        if (fs.existsSync(rootPath)) {
          scriptPath = rootPath;
        }
      }
    }

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Python processing script not found at: ${scriptPath}`);
    }

    log.info(
      { jobId, inputVideoPath, outputPath, musicGenre, scriptPath },
      "Running Python video processing script"
    );

    const result = execSync(
      `python3 "${scriptPath}" "${inputVideoPath}" "${outputPath}" "${musicGenre}"`,
      {
        timeout: PYTHON_TIMEOUT_MS,
        encoding: "utf-8",
        cwd: workDir,
      }
    );

    // Parse JSON result from stdout (last line)
    const lines = result.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    let pythonResult: { transcript: string; duration: number; output: string };

    try {
      pythonResult = JSON.parse(lastLine);
    } catch {
      log.warn({ rawOutput: result }, "Failed to parse Python script JSON output");
      throw new Error(`Python script did not return valid JSON. Output: ${lastLine}`);
    }

    // Verify output file exists
    const finalOutputPath = pythonResult.output || outputPath;
    if (!fs.existsSync(finalOutputPath)) {
      throw new Error(`Output video not found after processing: ${finalOutputPath}`);
    }

    log.info(
      {
        jobId,
        outputPath: finalOutputPath,
        transcript: pythonResult.transcript?.substring(0, 100),
        duration: pythonResult.duration,
      },
      "Video processing complete"
    );

    // ── Update DB: completed ─────────────────────────────────────────────

    await db
      .update(videoProcessingJobs)
      .set({
        status: "completed",
        outputUrl: finalOutputPath,
        transcriptText: pythonResult.transcript,
        metadata: {
          ...(videoJob.metadata as Record<string, unknown> ?? {}),
          duration: pythonResult.duration,
          processedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(videoProcessingJobs.id, jobId));

    return {
      jobId,
      status: "completed",
      outputUrl: finalOutputPath,
      duration: pythonResult.duration,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error(
      { jobId, error: error.message, stack: error.stack },
      "Video processing failed"
    );

    // ── Update DB: failed ──────────────────────────────────────────────

    await db
      .update(videoProcessingJobs)
      .set({
        status: "failed",
        errorMessage: error.message,
        updatedAt: new Date(),
      })
      .where(eq(videoProcessingJobs.id, jobId));

    throw error;
  }
}
