import { Worker } from "bullmq";
import { redis, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processLeadAnalysis } from "./processor.js";

const log = logger.child({ worker: "ai-analysis-worker" });

const worker = new Worker(
  QUEUE_NAMES.LEAD_ANALYSIS,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing lead analysis job");
    return processLeadAnalysis(job);
  },
  {
    connection: redis,
    concurrency: 5,
    limiter: {
      max: 20,
      duration: 60_000,
    },
  }
);

worker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Lead analysis job completed");
});

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Lead analysis job failed");
});

worker.on("error", (err) => {
  log.error({ error: err.message }, "Worker error");
});

async function shutdown() {
  log.info("Shutting down AI analysis worker...");
  await worker.close();
  await redis.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("AI analysis worker started, listening on queue: %s", QUEUE_NAMES.LEAD_ANALYSIS);
