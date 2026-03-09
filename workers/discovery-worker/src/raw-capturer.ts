import { Job } from "bullmq";
import { createHash } from "node:crypto";
import { logger } from "@alh/observability";
import { getQueue, SWARM_QUEUE_NAMES } from "@alh/queues";
import type { RawCaptureJobData } from "@alh/queues";
import { db } from "@alh/db";
import { rawLeads } from "@alh/db";
import { eq } from "drizzle-orm";
import { keywordRepo } from "@alh/db/src/repositories/keyword-repo";

const log = logger.child({ module: "raw-capturer" });

export async function processRawCapture(job: Job<RawCaptureJobData>) {
  const { tenantId, sourceId, rawData, sourceType, payload } = job.data;
  const queryRunId = payload.queryRunId as number;
  const sourceFetchRunId = payload.sourceFetchRunId as number;
  const keywordId = payload.keywordId as number | undefined;

  const candidate = rawData as Record<string, unknown>;
  const rawText = (candidate.rawText as string) ?? "";
  const platform = (candidate.platform as string) ?? sourceType;

  try {
    // Hash the text for dedup
    const textHash = createHash("sha256").update(rawText).digest("hex");

    // Check if text_hash already exists in raw_leads (quick pre-filter)
    const [existing] = await db
      .select({ id: rawLeads.id })
      .from(rawLeads)
      .where(eq(rawLeads.textHash, textHash))
      .limit(1);

    if (existing) {
      // Duplicate — still store for audit, but mark as processed
      log.warn(
        { tenantId, textHash, existingId: existing.id },
        "Pre-filter duplicate detected, storing for audit"
      );

      await db.insert(rawLeads).values({
        tenantId,
        rawSourceId: sourceFetchRunId,
        platform,
        profileName: (candidate.profileName as string) ?? null,
        profileUrl: (candidate.profileUrl as string) ?? null,
        sourceUrl: (candidate.sourceUrl as string) ?? "",
        matchedKeywords: (candidate.matchedKeywords as string[]) ?? [],
        rawText,
        rawMetadataJson: (candidate.rawMetadata as Record<string, unknown>) ?? {},
        locationText: (candidate.locationText as string) ?? null,
        contactHint: (candidate.contactHint as string) ?? null,
        contentDate: candidate.contentDate ? new Date(candidate.contentDate as string) : null,
        textHash,
        isProcessed: true,
        processingStatus: "duplicate",
      });

      // Increment keyword match count even for dupes
      if (keywordId) {
        await keywordRepo.incrementMatchCount(keywordId);
      }

      return { stored: true, duplicate: true, existingId: existing.id };
    }

    // New lead — store raw_lead
    const [newRawLead] = await db
      .insert(rawLeads)
      .values({
        tenantId,
        rawSourceId: sourceFetchRunId,
        platform,
        profileName: (candidate.profileName as string) ?? null,
        profileUrl: (candidate.profileUrl as string) ?? null,
        sourceUrl: (candidate.sourceUrl as string) ?? "",
        matchedKeywords: (candidate.matchedKeywords as string[]) ?? [],
        rawText,
        rawMetadataJson: (candidate.rawMetadata as Record<string, unknown>) ?? {},
        locationText: (candidate.locationText as string) ?? null,
        contactHint: (candidate.contactHint as string) ?? null,
        contentDate: candidate.contentDate ? new Date(candidate.contentDate as string) : null,
        textHash,
        isProcessed: false,
        processingStatus: "pending",
      })
      .returning();

    // Push to normalization queue (handled by scrubber-worker)
    const normalizationQueue = getQueue(SWARM_QUEUE_NAMES.NORMALIZATION);
    await normalizationQueue.add(
      "normalization",
      {
        tenantId,
        leadId: newRawLead.id,
        agentType: "normalizer" as const,
        rawLeadId: newRawLead.id,
        sourceType: platform,
        payload: {
          queryRunId,
          sourceId,
          sourceFetchRunId,
          keywordId,
        },
      },
      {
        jobId: `norm-${tenantId}-${newRawLead.id}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      }
    );

    // Increment keyword match count
    if (keywordId) {
      await keywordRepo.incrementMatchCount(keywordId);
    }

    log.info(
      { tenantId, rawLeadId: newRawLead.id, platform, textHash },
      "Raw lead captured and queued for normalization"
    );

    return { stored: true, duplicate: false, rawLeadId: newRawLead.id };
  } catch (err) {
    const error = err as Error;
    log.error(
      { tenantId, sourceId, error: error.message },
      "Raw capture failed"
    );
    throw error;
  }
}
