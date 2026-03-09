import { Worker } from "bullmq";
import { redisConnection, SWARM_QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import { processNormalization } from "./normalizer.js";
import { processScrubDedupe } from "./scrubber.js";
import { processCanonicalEnrichment } from "./enricher.js";

const log = logger.child({ worker: "scrubber-worker" });

// ─── Normalization Worker ────────────────────────────────────────────────────
const normalizationWorker = new Worker(
  SWARM_QUEUE_NAMES.NORMALIZATION,
  async (job) => {
    log.info({ jobId: job.id, rawLeadId: job.data.rawLeadId }, "Processing normalization job");
    return processNormalization(job);
  },
  {
    connection: redisConnection,
    concurrency: 10,
  },
);

normalizationWorker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Normalization job completed");
});

normalizationWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Normalization job failed");
});

normalizationWorker.on("error", (err) => {
  log.error({ error: err.message }, "Normalization worker error");
});

// ─── Scrub/Dedupe Worker ─────────────────────────────────────────────────────
const scrubDedupeWorker = new Worker(
  SWARM_QUEUE_NAMES.SCRUB_DEDUPE,
  async (job) => {
    log.info({ jobId: job.id, leadId: job.data.leadId }, "Processing scrub/dedupe job");
    return processScrubDedupe(job);
  },
  {
    connection: redisConnection,
    concurrency: 5,
  },
);

scrubDedupeWorker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Scrub/dedupe job completed");
});

scrubDedupeWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Scrub/dedupe job failed");
});

scrubDedupeWorker.on("error", (err) => {
  log.error({ error: err.message }, "Scrub/dedupe worker error");
});

// ─── Canonical Enrichment Worker ─────────────────────────────────────────────
const canonicalEnrichmentWorker = new Worker(
  SWARM_QUEUE_NAMES.CANONICAL_ENRICHMENT,
  async (job) => {
    log.info({ jobId: job.id, canonicalLeadId: job.data.canonicalLeadId }, "Processing canonical enrichment job");
    return processCanonicalEnrichment(job);
  },
  {
    connection: redisConnection,
    concurrency: 5,
  },
);

canonicalEnrichmentWorker.on("completed", (job) => {
  log.info({ jobId: job?.id }, "Canonical enrichment job completed");
});

canonicalEnrichmentWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, error: err.message }, "Canonical enrichment job failed");
});

canonicalEnrichmentWorker.on("error", (err) => {
  log.error({ error: err.message }, "Canonical enrichment worker error");
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
async function shutdown() {
  log.info("Shutting down scrubber worker...");
  await Promise.all([
    normalizationWorker.close(),
    scrubDedupeWorker.close(),
    canonicalEnrichmentWorker.close(),
  ]);
  await redisConnection.quit();
  log.info("Scrubber worker shut down cleanly");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info(
  {
    queues: [
      SWARM_QUEUE_NAMES.NORMALIZATION,
      SWARM_QUEUE_NAMES.SCRUB_DEDUPE,
      SWARM_QUEUE_NAMES.CANONICAL_ENRICHMENT,
    ],
  },
  "Scrubber worker started, listening on 3 queues",
);
