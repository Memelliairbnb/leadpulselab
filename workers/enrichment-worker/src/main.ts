import { Worker } from "bullmq";
import { redisConnection, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processLeadEnrichment } from "./processor.js";

const log = logger.child({ worker: "enrichment-worker" });

const worker = new Worker(
  QUEUE_NAMES.LEAD_ENRICHMENT,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing lead enrichment job");
    return processLeadEnrichment(job);
  },
  {
    connection: redisConnection,
    concurrency: 3,
    limiter: {
      max: 10,
      duration: 60_000,
    },
  }
);

worker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Lead enrichment job completed");
});

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Lead enrichment job failed");
});

worker.on("error", (err) => {
  log.error({ error: err.message }, "Worker error");
});

async function shutdown() {
  log.info("Shutting down enrichment worker...");
  await worker.close();
  await redisConnection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("Enrichment worker started, listening on queue: %s", QUEUE_NAMES.LEAD_ENRICHMENT);
