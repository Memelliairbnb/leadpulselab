import { Worker } from "bullmq";
import { redis, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processOutreachGeneration } from "./processor.js";

const log = logger.child({ worker: "outreach-worker" });

const worker = new Worker(
  QUEUE_NAMES.OUTREACH_GENERATION,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing outreach generation job");
    return processOutreachGeneration(job);
  },
  {
    connection: redis,
    concurrency: 3,
    limiter: {
      max: 15,
      duration: 60_000,
    },
  }
);

worker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Outreach generation job completed");
});

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Outreach generation job failed");
});

worker.on("error", (err) => {
  log.error({ error: err.message }, "Worker error");
});

async function shutdown() {
  log.info("Shutting down outreach worker...");
  await worker.close();
  await redis.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("Outreach worker started, listening on queue: %s", QUEUE_NAMES.OUTREACH_GENERATION);
