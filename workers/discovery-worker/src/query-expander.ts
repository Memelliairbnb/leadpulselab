import { Job } from "bullmq";
import { logger } from "@alh/observability";
import { getQueue, SWARM_QUEUE_NAMES } from "@alh/queues";
import type { QueryExpansionJobData } from "@alh/queues";
import { sourcingRepo } from "@alh/db/src/repositories/sourcing-repo";
import { tenantRepo } from "@alh/db/src/repositories/tenant-repo";
import { sourceRepo } from "@alh/db/src/repositories/source-repo";

const log = logger.child({ module: "query-expander" });

interface KeywordPayload {
  id: number;
  keyword: string;
  keywordType: string;
  categoryId: number;
}

/**
 * Template-based query expansion. No Claude calls — too expensive at scale.
 * Generates variations using simple string templates.
 */
function expandKeyword(
  keyword: string,
  keywordType: string,
  tenantGeo: { city?: string; state?: string } | null
): string[] {
  const expanded: string[] = [];

  // 1. Original keyword as-is
  expanded.push(keyword);

  if (keywordType === "hashtag") {
    // Hashtag variations
    const clean = keyword.replace(/^#/, "");
    expanded.push(`#${clean}`);
    expanded.push(`#${clean}help`);
    expanded.push(`#${clean}advice`);
    expanded.push(`#${clean}tips`);
    expanded.push(clean); // plain text version
  } else if (keywordType === "long_tail") {
    // Long-tail expansions — generate related phrasings
    expanded.push(`how to ${keyword}`);
    expanded.push(`help with ${keyword}`);
    expanded.push(`${keyword} advice`);
    expanded.push(`${keyword} help`);
    expanded.push(`best ${keyword}`);
    expanded.push(`${keyword} services`);
    expanded.push(`${keyword} near me`);
  } else {
    // Standard phrase expansions
    expanded.push(`${keyword} help`);
    expanded.push(`${keyword} services`);
    expanded.push(`need ${keyword}`);
    expanded.push(`looking for ${keyword}`);
    expanded.push(`${keyword} near me`);
  }

  // 2. Location-targeted variations if tenant has geo data
  if (tenantGeo?.city) {
    expanded.push(`${keyword} in ${tenantGeo.city}`);
    expanded.push(`${keyword} ${tenantGeo.city}`);
  }
  if (tenantGeo?.state) {
    expanded.push(`${keyword} in ${tenantGeo.state}`);
    expanded.push(`${keyword} ${tenantGeo.state}`);
  }
  if (tenantGeo?.city && tenantGeo?.state) {
    expanded.push(`${keyword} ${tenantGeo.city} ${tenantGeo.state}`);
  }

  // Deduplicate
  return [...new Set(expanded)];
}

export async function processQueryExpansion(job: Job<QueryExpansionJobData>) {
  const { tenantId, planId, payload } = job.data;
  const queryRunId = payload.queryRunId as number;
  const keywords = payload.keywords as KeywordPayload[];

  try {
    // Load tenant settings for geo data
    const tenant = await tenantRepo.findById(tenantId);
    const settings = (tenant?.settingsJson ?? {}) as Record<string, unknown>;
    const tenantGeo = settings.geo as { city?: string; state?: string } | null ?? null;

    // Load all enabled sources for this tenant so we can fan out per-source
    const enabledSources = await sourceRepo.findEnabledByTenant(tenantId);
    if (enabledSources.length === 0) {
      log.warn({ tenantId }, "No enabled sources for tenant, skipping expansion");
      return { expanded: 0 };
    }

    const searchQueue = getQueue(SWARM_QUEUE_NAMES.SEARCH_EXECUTION);
    let totalExpanded = 0;

    for (const kw of keywords) {
      const variations = expandKeyword(kw.keyword, kw.keywordType, tenantGeo);

      for (const query of variations) {
        for (const source of enabledSources) {
          const queryId = `q-${tenantId}-${kw.id}-${source.id}-${Buffer.from(query).toString("base64url").slice(0, 16)}`;

          await searchQueue.add(
            "search_execution",
            {
              tenantId,
              agentType: "search_executor" as const,
              queryId,
              sourceType: source.sourceType,
              query,
              maxResults: 50,
              payload: {
                queryRunId,
                sourceId: source.id,
                adapterKey: source.adapterKey,
                keywordId: kw.id,
                keywordText: kw.keyword,
                rateLimitRpm: source.rateLimitRpm,
              },
            },
            {
              jobId: `search-${queryId}`,
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
            }
          );

          totalExpanded++;
        }
      }
    }

    // Update query_run with expansion count
    await sourcingRepo.updateQueryRun(queryRunId, {
      resultsCount: totalExpanded,
      expansionSource: "variation",
    });

    log.info(
      { tenantId, planId, totalExpanded, keywordCount: keywords.length, sourceCount: enabledSources.length },
      "Query expansion completed"
    );

    return { expanded: totalExpanded };
  } catch (err) {
    const error = err as Error;
    log.error({ tenantId, planId, error: error.message }, "Query expansion failed");
    throw error;
  }
}
