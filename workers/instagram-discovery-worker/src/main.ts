import { Worker } from "bullmq";
import { redisConnection, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processInstagramDiscovery } from "./processor.js";

const log = logger.child({ worker: "instagram-discovery-worker" });

const worker = new Worker(
  QUEUE_NAMES.INSTAGRAM_DISCOVERY,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing Instagram discovery job");
    return processInstagramDiscovery(job);
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
  log.info({ jobId: job?.id }, "Instagram discovery job completed");
});

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Instagram discovery job failed");
});

worker.on("error", (err) => {
  log.error({ error: err.message }, "Worker error");
});

async function shutdown() {
  log.info("Shutting down instagram-discovery worker...");
  await worker.close();
  await redisConnection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("Instagram discovery worker started, listening on queue: %s", QUEUE_NAMES.INSTAGRAM_DISCOVERY);
