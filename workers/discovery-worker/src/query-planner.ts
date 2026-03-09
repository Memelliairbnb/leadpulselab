import { Job } from "bullmq";
import { logger } from "@alh/observability";
import { getQueue, SWARM_QUEUE_NAMES } from "@alh/queues";
import type { QueryPlanningJobData } from "@alh/queues";
import { keywordRepo } from "@alh/db/src/repositories/keyword-repo";
import { sourcingRepo } from "@alh/db/src/repositories/sourcing-repo";

const log = logger.child({ module: "query-planner" });

export async function processQueryPlanning(job: Job<QueryPlanningJobData>) {
  const { tenantId, campaignId, keywords: seedKeywords } = job.data;

  try {
    // Load tenant's active keywords from the provided seed categories
    // If seed keywords are provided, use them; otherwise load from DB
    let keywordRows = await keywordRepo.findKeywordsByTenant(tenantId, true);

    // Filter to only active keywords
    if (keywordRows.length === 0) {
      log.warn({ tenantId }, "No active keywords found for tenant, skipping planning");
      return { planned: 0 };
    }

    // Group keywords by type (phrase, hashtag, long_tail)
    const grouped: Record<string, typeof keywordRows> = {};
    for (const kw of keywordRows) {
      const kwType = kw.keywordType ?? "phrase";
      if (!grouped[kwType]) grouped[kwType] = [];
      grouped[kwType].push(kw);
    }

    const expansionQueue = getQueue(SWARM_QUEUE_NAMES.QUERY_EXPANSION);
    let totalPlanned = 0;

    for (const [kwType, kwGroup] of Object.entries(grouped)) {
      // Create a query_run record for tracking this keyword group
      const queryRun = await sourcingRepo.createQueryRun({
        tenantId,
        sourceId: 0, // will be set per-source at search execution
        queryText: kwGroup.map((k) => k.keyword).join(", "),
        queryType: kwType,
        expansionSource: "original",
      });

      // Push to expansion queue with the keyword group
      await expansionQueue.add(
        "query_expansion",
        {
          tenantId,
          agentType: "query_expander" as const,
          planId: `plan-${campaignId}-${kwType}-${queryRun.id}`,
          baseQuery: kwGroup.map((k) => k.keyword).join("|"),
          expansionStrategy: kwType === "hashtag" ? "synonym" : "semantic",
          payload: {
            queryRunId: queryRun.id,
            campaignId,
            keywordType: kwType,
            keywords: kwGroup.map((k) => ({
              id: k.id,
              keyword: k.keyword,
              keywordType: k.keywordType,
              categoryId: k.categoryId,
            })),
          },
        },
        {
          jobId: `qexp-${tenantId}-plan-${campaignId}-${kwType}-${queryRun.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );

      totalPlanned++;

      log.info(
        { tenantId, kwType, keywordCount: kwGroup.length, queryRunId: queryRun.id },
        "Planned keyword group for expansion"
      );
    }

    log.info(
      { tenantId, campaignId, totalPlanned, totalKeywords: keywordRows.length },
      "Query planning completed"
    );

    return { planned: totalPlanned, totalKeywords: keywordRows.length };
  } catch (err) {
    const error = err as Error;
    log.error({ tenantId, campaignId, error: error.message }, "Query planning failed");
    throw error;
  }
}
