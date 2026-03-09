import { Worker } from "bullmq";
import { redis, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processLeadDedupe } from "./dedupe-processor.js";
import { processLeadEnrichment } from "./enrichment-processor.js";

const log = logger.child({ worker: "dedupe-enrichment-worker" });

// Dedupe worker
const dedupeWorker = new Worker(
  QUEUE_NAMES.LEAD_DEDUPE,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing lead dedupe job");
    return processLeadDedupe(job);
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

dedupeWorker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Lead dedupe job completed");
});

dedupeWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Lead dedupe job failed");
});

dedupeWorker.on("error", (err) => {
  log.error({ error: err.message }, "Dedupe worker error");
});

// Enrichment worker
const enrichmentWorker = new Worker(
  QUEUE_NAMES.LEAD_ENRICHMENT,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing lead enrichment job");
    return processLeadEnrichment(job);
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

enrichmentWorker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Lead enrichment job completed");
});

enrichmentWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Lead enrichment job failed");
});

enrichmentWorker.on("error", (err) => {
  log.error({ error: err.message }, "Enrichment worker error");
});

async function shutdown() {
  log.info("Shutting down dedupe-enrichment worker...");
  await Promise.all([dedupeWorker.close(), enrichmentWorker.close()]);
  await redis.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info(
  "Dedupe-enrichment worker started, listening on queues: %s, %s",
  QUEUE_NAMES.LEAD_DEDUPE,
  QUEUE_NAMES.LEAD_ENRICHMENT
);
