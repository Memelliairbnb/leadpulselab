import { Worker } from "bullmq";
import { redisConnection, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processInstagramScrub } from "./processor.js";

const log = logger.child({ worker: "instagram-scrub-worker" });

const worker = new Worker(
  QUEUE_NAMES.INSTAGRAM_SCRUB,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing Instagram scrub job");
    return processInstagramScrub(job);
  },
  {
    connection: redisConnection,
    concurrency: 5, // CPU-bound, no external calls
  }
);

worker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Instagram scrub job completed");
});

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Instagram scrub job failed");
});

worker.on("error", (err) => {
  log.error({ error: err.message }, "Worker error");
});

async function shutdown() {
  log.info("Shutting down instagram-scrub-worker...");
  await worker.close();
  await redisConnection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("Instagram scrub worker started, listening on queue: %s", QUEUE_NAMES.INSTAGRAM_SCRUB);
