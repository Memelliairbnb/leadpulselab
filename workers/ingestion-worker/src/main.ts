import { Worker } from "bullmq";
import { redisConnection, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processSourceScan } from "./processor.js";

const log = logger.child({ worker: "ingestion-worker" });

const worker = new Worker(
  QUEUE_NAMES.SOURCE_SCAN,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing source scan job");
    return processSourceScan(job);
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
  log.info({ jobId: job?.id }, "Source scan job completed");
});

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Source scan job failed");
});

worker.on("error", (err) => {
  log.error({ error: err.message }, "Worker error");
});

async function shutdown() {
  log.info("Shutting down ingestion worker...");
  await worker.close();
  await redisConnection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("Ingestion worker started, listening on queue: %s", QUEUE_NAMES.SOURCE_SCAN);
