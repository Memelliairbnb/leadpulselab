import { Worker } from "bullmq";
import { redisConnection, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processVideoJob } from "./processor.js";

const log = logger.child({ worker: "video-processing-worker" });

const worker = new Worker(
  QUEUE_NAMES.VIDEO_PROCESSING,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing video job");
    return processVideoJob(job);
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

worker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Video processing job completed");
});

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Video processing job failed");
});

worker.on("error", (err) => {
  log.error({ error: err.message }, "Worker error");
});

async function shutdown() {
  log.info("Shutting down video processing worker...");
  await worker.close();
  await redisConnection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("Video processing worker started, listening on queue: %s", QUEUE_NAMES.VIDEO_PROCESSING);
