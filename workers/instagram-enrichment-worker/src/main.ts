import { Worker } from "bullmq";
import { redisConnection, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processInstagramEnrichment } from "./processor.js";

const log = logger.child({ worker: "instagram-enrichment-worker" });

const worker = new Worker(
  QUEUE_NAMES.INSTAGRAM_ENRICHMENT,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing instagram enrichment job");
    return processInstagramEnrichment(job);
  },
  {
    connection: redisConnection,
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 60_000,
    },
  }
);

worker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Instagram enrichment job completed");
});

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Instagram enrichment job failed");
});

worker.on("error", (err) => {
  log.error({ error: err.message }, "Worker error");
});

async function shutdown() {
  log.info("Shutting down instagram enrichment worker...");
  await worker.close();
  await redisConnection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("Instagram enrichment worker started, listening on queue: %s", QUEUE_NAMES.INSTAGRAM_ENRICHMENT);
