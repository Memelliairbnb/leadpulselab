import { Worker } from "bullmq";
import { redisConnection, SWARM_QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processQueryPlanning } from "./query-planner.js";
import { processQueryExpansion } from "./query-expander.js";
import { processSearchExecution } from "./search-executor.js";
import { processSourceFetch } from "./source-fetcher.js";
import { processRawCapture } from "./raw-capturer.js";

const log = logger.child({ worker: "discovery-worker" });

// ─── Query Planning Worker ──────────────────────────────────────────────────

const queryPlanningWorker = new Worker(
  SWARM_QUEUE_NAMES.QUERY_PLANNING,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing query planning job");
    return processQueryPlanning(job);
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

queryPlanningWorker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Query planning job completed");
});

queryPlanningWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Query planning job failed");
});

// ─── Query Expansion Worker ─────────────────────────────────────────────────

const queryExpansionWorker = new Worker(
  SWARM_QUEUE_NAMES.QUERY_EXPANSION,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing query expansion job");
    return processQueryExpansion(job);
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

queryExpansionWorker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Query expansion job completed");
});

queryExpansionWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Query expansion job failed");
});

// ─── Search Execution Worker ────────────────────────────────────────────────

const searchExecutionWorker = new Worker(
  SWARM_QUEUE_NAMES.SEARCH_EXECUTION,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing search execution job");
    return processSearchExecution(job);
  },
  {
    connection: redisConnection,
    concurrency: 10,
  }
);

searchExecutionWorker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Search execution job completed");
});

searchExecutionWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Search execution job failed");
});

// ─── Source Fetch Worker ────────────────────────────────────────────────────

const sourceFetchWorker = new Worker(
  SWARM_QUEUE_NAMES.SOURCE_FETCH,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing source fetch job");
    return processSourceFetch(job);
  },
  {
    connection: redisConnection,
    concurrency: 10,
  }
);

sourceFetchWorker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Source fetch job completed");
});

sourceFetchWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Source fetch job failed");
});

// ─── Raw Capture Worker ─────────────────────────────────────────────────────

const rawCaptureWorker = new Worker(
  SWARM_QUEUE_NAMES.RAW_CAPTURE,
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "Processing raw capture job");
    return processRawCapture(job);
  },
  {
    connection: redisConnection,
    concurrency: 10,
  }
);

rawCaptureWorker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Raw capture job completed");
});

rawCaptureWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Raw capture job failed");
});

// ─── Error handlers ─────────────────────────────────────────────────────────

const workers = [
  queryPlanningWorker,
  queryExpansionWorker,
  searchExecutionWorker,
  sourceFetchWorker,
  rawCaptureWorker,
];

for (const w of workers) {
  w.on("error", (err) => {
    log.error({ error: err.message }, "Worker error");
  });
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

async function shutdown() {
  log.info("Shutting down discovery worker...");
  await Promise.all(workers.map((w) => w.close()));
  await redisConnection.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info(
  {
    queues: [
      SWARM_QUEUE_NAMES.QUERY_PLANNING,
      SWARM_QUEUE_NAMES.QUERY_EXPANSION,
      SWARM_QUEUE_NAMES.SEARCH_EXECUTION,
      SWARM_QUEUE_NAMES.SOURCE_FETCH,
      SWARM_QUEUE_NAMES.RAW_CAPTURE,
    ],
  },
  "Discovery worker started, listening on 5 queues"
);
