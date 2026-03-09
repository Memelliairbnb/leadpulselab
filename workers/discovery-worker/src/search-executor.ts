import { Job } from "bullmq";
import { logger } from "@alh/observability";
import { getQueue, SWARM_QUEUE_NAMES } from "@alh/queues";
import type { SearchExecutionJobData } from "@alh/queues";
import { sourcingRepo } from "@alh/db/src/repositories/sourcing-repo";
import { getAdapter } from "@alh/source-adapters";

const log = logger.child({ module: "search-executor" });

/**
 * Simple in-memory rate limiter per source.
 * Tracks last request timestamps to respect platform_sources.rate_limit_rpm.
 */
const rateLimitState = new Map<number, number[]>();

async function waitForRateLimit(sourceId: number, rpm: number): Promise<void> {
  const now = Date.now();
  const windowMs = 60_000;

  if (!rateLimitState.has(sourceId)) {
    rateLimitState.set(sourceId, []);
  }

  const timestamps = rateLimitState.get(sourceId)!;
  // Prune timestamps older than 1 minute
  const recent = timestamps.filter((t) => now - t < windowMs);
  rateLimitState.set(sourceId, recent);

  if (recent.length >= rpm) {
    // Wait until the oldest request in the window expires
    const waitMs = windowMs - (now - recent[0]) + 100;
    log.info({ sourceId, waitMs, rpm }, "Rate limit reached, waiting");
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  // Record this request
  rateLimitState.get(sourceId)!.push(Date.now());
}

export async function processSearchExecution(job: Job<SearchExecutionJobData>) {
  const { tenantId, query, sourceType, maxResults, payload } = job.data;
  const queryRunId = payload.queryRunId as number;
  const sourceId = payload.sourceId as number;
  const adapterKey = payload.adapterKey as string;
  const keywordId = payload.keywordId as number | undefined;
  const rateLimitRpm = (payload.rateLimitRpm as number) ?? 60;

  try {
    // Load the adapter for this source
    const adapter = getAdapter(adapterKey);
    if (!adapter) {
      log.warn({ adapterKey, sourceId }, "No adapter registered for key, skipping");
      return { results: 0 };
    }

    // Respect rate limits
    await waitForRateLimit(sourceId, rateLimitRpm);

    // Execute the search
    const startMs = Date.now();
    const fetchResults = await adapter.fetch({
      keywords: [query],
      maxResults,
      config: {},
    });
    const durationMs = Date.now() - startMs;

    const sourceFetchQueue = getQueue(SWARM_QUEUE_NAMES.SOURCE_FETCH);
    let resultsCount = 0;

    for (const rawPayload of fetchResults) {
      await sourceFetchQueue.add(
        "source_fetch",
        {
          tenantId,
          agentType: "source_fetcher" as const,
          sourceId,
          url: rawPayload.sourceUrl,
          fetchStrategy: rawPayload.fetchMethod as "api" | "scrape" | "feed",
          payload: {
            queryRunId,
            sourceId,
            adapterKey,
            keywordId,
            rawPayload: rawPayload.payload,
            sourceUrl: rawPayload.sourceUrl,
            fetchMethod: rawPayload.fetchMethod,
            fetchedAt: rawPayload.fetchedAt.toISOString(),
          },
        },
        {
          jobId: `fetch-${tenantId}-${sourceId}-${Date.now()}-${resultsCount}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );

      resultsCount++;
    }

    // Update query_run with results count
    await sourcingRepo.updateQueryRun(queryRunId, {
      resultsCount,
      executedAt: new Date(),
      durationMs,
    });

    log.info(
      { tenantId, sourceId, query, resultsCount, durationMs },
      "Search execution completed"
    );

    return { results: resultsCount, durationMs };
  } catch (err) {
    const error = err as Error;
    log.error(
      { tenantId, sourceId, query, error: error.message },
      "Search execution failed"
    );
    throw error;
  }
}
