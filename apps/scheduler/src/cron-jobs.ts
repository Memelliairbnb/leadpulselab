import cron from 'node-cron';
import { logger } from '@alh/observability';
import { db } from '@alh/db';
import { tenants } from '@alh/db/src/schema/tenants';
import { sourceRepo } from '@alh/db/src/repositories/source-repo';
import { keywordRepo } from '@alh/db/src/repositories/keyword-repo';
import { jobRepo } from '@alh/db/src/repositories/job-repo';
import {
  enqueueSourceScan,
  enqueueLeadDedupe,
  enqueueRescore,
  enqueueOutreachGeneration,
  QUEUE_NAMES,
  getQueue,
  SWARM_QUEUE_NAMES,
  MAINTENANCE_QUEUE_NAMES,
  ALL_SWARM_QUEUE_NAMES,
  enqueueQueryPlanning,
  enqueueQueryExpansion,
  enqueueStatsRollup,
  enqueueInventoryAging,
  enqueueSourceHealthCalc,
  enqueueYieldCalc,
  enqueueCostTracking,
} from '@alh/queues';
import { qualifiedLeads } from '@alh/db/src/schema/leads';
import { outreachDrafts } from '@alh/db/src/schema/outreach';
import { eq, and, lte, sql } from 'drizzle-orm';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getActiveTenants() {
  return db.select().from(tenants).where(eq(tenants.isActive, true));
}

function yesterday(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// Original Cron Jobs (preserved)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Google search source scan - every 2 hours
 * Scans all enabled search_engine sources for each active tenant.
 */
async function googleScanJob() {
  const jobName = 'google-scan';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();

    for (const tenant of activeTenants) {
      const sources = await sourceRepo.findEnabledByTenant(tenant.id);
      const searchSources = sources.filter((s) => s.sourceType === 'search_engine');

      if (searchSources.length === 0) continue;

      const keywords = await keywordRepo.findKeywordsByTenant(tenant.id, true);
      const keywordStrings = keywords.map((k) => k.keyword);

      if (keywordStrings.length === 0) {
        logger.debug({ tenantId: tenant.id, job: jobName }, 'No active keywords, skipping');
        continue;
      }

      for (const source of searchSources) {
        const scanJob = await jobRepo.createScanJob({
          tenantId: tenant.id,
          sourceId: source.id,
          status: 'pending',
          triggerType: 'scheduled',
          keywordsUsed: keywordStrings,
        });

        await enqueueSourceScan({
          tenantId: tenant.id,
          scanJobId: scanJob.id,
          sourceId: source.id,
          keywords: keywordStrings,
        });

        logger.info(
          { tenantId: tenant.id, sourceId: source.id, scanJobId: scanJob.id, job: jobName },
          'Search scan enqueued',
        );
      }
    }
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Social media source scan - every 4 hours
 * Scans all enabled social/forum sources for each active tenant.
 */
async function socialScanJob() {
  const jobName = 'social-scan';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();

    for (const tenant of activeTenants) {
      const sources = await sourceRepo.findEnabledByTenant(tenant.id);
      const socialSources = sources.filter(
        (s) => s.sourceType === 'social' || s.sourceType === 'forum',
      );

      if (socialSources.length === 0) continue;

      const keywords = await keywordRepo.findKeywordsByTenant(tenant.id, true);
      const keywordStrings = keywords.map((k) => k.keyword);

      if (keywordStrings.length === 0) {
        logger.debug({ tenantId: tenant.id, job: jobName }, 'No active keywords, skipping');
        continue;
      }

      for (const source of socialSources) {
        const scanJob = await jobRepo.createScanJob({
          tenantId: tenant.id,
          sourceId: source.id,
          status: 'pending',
          triggerType: 'scheduled',
          keywordsUsed: keywordStrings,
        });

        await enqueueSourceScan({
          tenantId: tenant.id,
          scanJobId: scanJob.id,
          sourceId: source.id,
          keywords: keywordStrings,
        });

        logger.info(
          { tenantId: tenant.id, sourceId: source.id, scanJobId: scanJob.id, job: jobName },
          'Social scan enqueued',
        );
      }
    }
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Daily dedupe sweep - 3:00 AM
 * Enqueues a full dedupe sweep for each tenant's recently created leads.
 */
async function dailyDedupeJob() {
  const jobName = 'daily-dedupe';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    for (const tenant of activeTenants) {
      // Get leads created in the last 24h that aren't already flagged as duplicates
      const recentLeads = await db
        .select({ id: qualifiedLeads.id })
        .from(qualifiedLeads)
        .where(
          and(
            eq(qualifiedLeads.tenantId, tenant.id),
            eq(qualifiedLeads.isDuplicate, false),
            sql`${qualifiedLeads.createdAt} >= ${oneDayAgo}`,
          ),
        );

      for (const lead of recentLeads) {
        await enqueueLeadDedupe({
          tenantId: tenant.id,
          qualifiedLeadId: lead.id,
          type: 'single',
        });
      }

      if (recentLeads.length > 0) {
        logger.info(
          { tenantId: tenant.id, leadCount: recentLeads.length, job: jobName },
          'Dedupe jobs enqueued',
        );
      }
    }
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Daily rescore - 4:00 AM
 * Re-scores leads that haven't been rescored in 7 days.
 */
async function dailyRescoreJob() {
  const jobName = 'daily-rescore';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const tenant of activeTenants) {
      const staleLeads = await db
        .select({ id: qualifiedLeads.id })
        .from(qualifiedLeads)
        .where(
          and(
            eq(qualifiedLeads.tenantId, tenant.id),
            eq(qualifiedLeads.isDuplicate, false),
            sql`${qualifiedLeads.status} NOT IN ('archived', 'converted')`,
            sql`(${qualifiedLeads.lastRescoredAt} IS NULL OR ${qualifiedLeads.lastRescoredAt} <= ${sevenDaysAgo})`,
          ),
        );

      for (const lead of staleLeads) {
        await enqueueRescore({
          tenantId: tenant.id,
          qualifiedLeadId: lead.id,
        });
      }

      if (staleLeads.length > 0) {
        logger.info(
          { tenantId: tenant.id, leadCount: staleLeads.length, job: jobName },
          'Rescore jobs enqueued',
        );
      }
    }
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Stale lead archive - 5:00 AM
 * Archives leads that have been in "new" status for over 30 days with low scores.
 */
async function staleArchiveJob() {
  const jobName = 'stale-archive';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const tenant of activeTenants) {
      const staleQueue = getQueue(QUEUE_NAMES.STALE_ARCHIVE);

      const staleLeads = await db
        .select({ id: qualifiedLeads.id })
        .from(qualifiedLeads)
        .where(
          and(
            eq(qualifiedLeads.tenantId, tenant.id),
            eq(qualifiedLeads.status, 'new'),
            lte(qualifiedLeads.leadScore, 40),
            lte(qualifiedLeads.createdAt, thirtyDaysAgo),
          ),
        );

      for (const lead of staleLeads) {
        await staleQueue.add('archive', {
          tenantId: tenant.id,
          qualifiedLeadId: lead.id,
        }, {
          jobId: `stale-archive-${lead.id}-${Date.now()}`,
        });
      }

      if (staleLeads.length > 0) {
        logger.info(
          { tenantId: tenant.id, leadCount: staleLeads.length, job: jobName },
          'Stale archive jobs enqueued',
        );
      }
    }
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Outreach generation - 6:00 AM
 * Generates outreach drafts for approved leads that don't have a pending draft.
 */
async function outreachGenerationJob() {
  const jobName = 'outreach-gen';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();

    for (const tenant of activeTenants) {
      // Find approved leads without a pending/approved outreach draft
      const leadsNeedingOutreach = await db
        .select({ id: qualifiedLeads.id })
        .from(qualifiedLeads)
        .where(
          and(
            eq(qualifiedLeads.tenantId, tenant.id),
            eq(qualifiedLeads.status, 'approved'),
            sql`${qualifiedLeads.id} NOT IN (
              SELECT lead_id FROM outreach_drafts
              WHERE tenant_id = ${tenant.id}
              AND status IN ('pending_review', 'approved')
            )`,
          ),
        );

      for (const lead of leadsNeedingOutreach) {
        await enqueueOutreachGeneration({
          tenantId: tenant.id,
          qualifiedLeadId: lead.id,
        });
      }

      if (leadsNeedingOutreach.length > 0) {
        logger.info(
          { tenantId: tenant.id, leadCount: leadsNeedingOutreach.length, job: jobName },
          'Outreach generation jobs enqueued',
        );
      }
    }
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Health check - every hour
 * Logs system health metrics: queue sizes, active tenants, recent errors.
 */
async function healthCheckJob() {
  const jobName = 'health-check';

  try {
    const activeTenants = await getActiveTenants();

    const queueNames = Object.values(QUEUE_NAMES);
    const queueStats: Record<string, { waiting: number; active: number; failed: number }> = {};

    for (const name of queueNames) {
      const queue = getQueue(name);
      const [waiting, active, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getFailedCount(),
      ]);
      queueStats[name] = { waiting, active, failed };
    }

    logger.info(
      {
        job: jobName,
        activeTenants: activeTenants.length,
        queues: queueStats,
      },
      'Health check completed',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Health check failed');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Discovery Swarm Crons
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Continuous discovery - every 30 minutes
 * Main heartbeat of the swarm. For each active tenant and each enabled source,
 * pushes a query_planning_queue job to kick off the discovery pipeline.
 */
async function continuousDiscoveryJob() {
  const jobName = 'continuous-discovery';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      const sources = await sourceRepo.findEnabledByTenant(tenant.id);
      const keywords = await keywordRepo.findKeywordsByTenant(tenant.id, true);
      const keywordStrings = keywords.map((k) => k.keyword);

      if (keywordStrings.length === 0) {
        logger.debug({ tenantId: tenant.id, job: jobName }, 'No active keywords, skipping');
        continue;
      }

      for (const source of sources) {
        await enqueueQueryPlanning({
          tenantId: tenant.id,
          agentType: 'query_planner',
          campaignId: source.id, // use source as campaign context
          icpDescription: tenant.icpDescription ?? '',
          keywords: keywordStrings,
          payload: { sourceType: source.sourceType, sourceId: source.id },
        });
        totalJobs++;
      }
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs },
      'Continuous discovery enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Query expansion refresh - every 6 hours
 * Re-expands queries for tenants that have new or updated keywords.
 */
async function queryExpansionRefreshJob() {
  const jobName = 'query-expansion-refresh';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      const keywords = await keywordRepo.findKeywordsByTenant(tenant.id, true);

      if (keywords.length === 0) continue;

      for (const kw of keywords) {
        await enqueueQueryExpansion({
          tenantId: tenant.id,
          agentType: 'query_expander',
          planId: `refresh-${tenant.id}-${kw.id}`,
          baseQuery: kw.keyword,
          expansionStrategy: 'semantic',
          payload: { keywordId: kw.id, refreshCycle: true },
        });
        totalJobs++;
      }
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs },
      'Query expansion refresh enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Source health calculation - every 4 hours
 * Calculates and stores source_health_metrics for each enabled source.
 */
async function sourceHealthCalcJob() {
  const jobName = 'source-health-calc';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      const sources = await sourceRepo.findEnabledByTenant(tenant.id);

      for (const source of sources) {
        await enqueueSourceHealthCalc({
          tenantId: tenant.id,
          agentType: 'source_health_calc',
          sourceId: source.id,
          payload: { sourceType: source.sourceType },
        });
        totalJobs++;
      }
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs },
      'Source health calc enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Inventory & Lifecycle Crons
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inventory aging - daily at 2:00 AM
 * Recalculates age_bands for all inventory items based on last_seen_at/last_contacted_at.
 * Updates temperature (hot -> warm -> aged -> cold).
 */
async function inventoryAgingJob() {
  const jobName = 'inventory-aging';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      await enqueueInventoryAging({
        tenantId: tenant.id,
        agentType: 'inventory_aging',
        agingThresholdDays: 30,
        payload: { fullRecalc: true },
      });
      totalJobs++;
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs },
      'Inventory aging enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Freshness score update - daily at 2:30 AM
 * Recalculates freshness_scores for canonical leads.
 */
async function freshnessScoreJob() {
  const jobName = 'freshness-score';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      const queue = getQueue(MAINTENANCE_QUEUE_NAMES.INVENTORY_AGING);
      await queue.add('freshness_score', {
        tenantId: tenant.id,
        agentType: 'freshness_scorer',
        recalcType: 'full',
        payload: {},
      }, {
        jobId: `freshness-${tenant.id}-${Date.now()}`,
      });
      totalJobs++;
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs },
      'Freshness score update enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Stale lead detection - daily at 3:00 AM
 * Finds leads with no activity in 90+ days, moves to 'dormant' lifecycle state.
 */
async function staleLeadDetectionJob() {
  const jobName = 'stale-lead-detection';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      const queue = getQueue(MAINTENANCE_QUEUE_NAMES.LIFECYCLE_EVENT);
      await queue.add('stale_detection', {
        tenantId: tenant.id,
        agentType: 'lifecycle_tracker',
        eventType: 'dormant_check',
        inactivityThresholdDays: 90,
        payload: {},
      }, {
        jobId: `stale-detect-${tenant.id}-${Date.now()}`,
      });
      totalJobs++;
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs },
      'Stale lead detection enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Reactivation check - daily at 3:30 AM
 * Finds dormant leads with new signals, moves to 'reactivation eligible'.
 */
async function reactivationCheckJob() {
  const jobName = 'reactivation-check';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      const queue = getQueue(MAINTENANCE_QUEUE_NAMES.LIFECYCLE_EVENT);
      await queue.add('reactivation_check', {
        tenantId: tenant.id,
        agentType: 'lifecycle_tracker',
        eventType: 'reactivation_check',
        payload: {},
      }, {
        jobId: `reactivation-${tenant.id}-${Date.now()}`,
      });
      totalJobs++;
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs },
      'Reactivation check enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Analytics Crons
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Daily stats rollup - daily at 1:00 AM
 * Calculates and upserts tenant_dashboard_daily_stats for the previous day.
 */
async function dailyStatsRollupJob() {
  const jobName = 'daily-stats-rollup';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    const targetDate = yesterday();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      await enqueueStatsRollup({
        tenantId: tenant.id,
        agentType: 'stats_rollup',
        rollupPeriod: 'daily',
        targetDate,
        payload: {},
      });
      totalJobs++;
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs, targetDate },
      'Daily stats rollup enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Source health daily stats - daily at 1:30 AM
 * Calculates and upserts source_health_daily_stats per source per tenant.
 */
async function sourceHealthDailyJob() {
  const jobName = 'source-health-daily';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      const sources = await sourceRepo.findEnabledByTenant(tenant.id);

      for (const source of sources) {
        await enqueueSourceHealthCalc({
          tenantId: tenant.id,
          agentType: 'source_health_calc',
          sourceId: source.id,
          payload: { rollupType: 'daily', targetDate: yesterday() },
        });
        totalJobs++;
      }
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs },
      'Source health daily stats enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Campaign performance daily - daily at 1:45 AM
 * Calculates campaign_performance_daily for each tenant.
 */
async function campaignPerformanceDailyJob() {
  const jobName = 'campaign-performance-daily';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    const targetDate = yesterday();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      await enqueueStatsRollup({
        tenantId: tenant.id,
        agentType: 'stats_rollup',
        rollupPeriod: 'daily',
        targetDate,
        payload: { rollupType: 'campaign_performance' },
      });
      totalJobs++;
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs, targetDate },
      'Campaign performance daily enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Inventory snapshot - every 6 hours
 * Snapshots inventory_counts_by_segment for each tenant.
 */
async function inventorySnapshotJob() {
  const jobName = 'inventory-snapshot';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      const queue = getQueue(MAINTENANCE_QUEUE_NAMES.STATS_ROLLUP);
      await queue.add('inventory_snapshot', {
        tenantId: tenant.id,
        agentType: 'stats_rollup',
        rollupPeriod: 'snapshot',
        targetDate: new Date().toISOString().slice(0, 10),
        payload: { snapshotType: 'inventory_counts_by_segment' },
      }, {
        jobId: `inv-snap-${tenant.id}-${Date.now()}`,
      });
      totalJobs++;
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs },
      'Inventory snapshot enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cost Tracking Crons
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Yield calculation - daily at 7:00 AM
 * Calculates yield_metrics for the previous day per tenant.
 */
async function yieldCalculationJob() {
  const jobName = 'yield-calculation';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    const targetDate = yesterday();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      await enqueueYieldCalc({
        tenantId: tenant.id,
        agentType: 'yield_calc',
        periodStart: targetDate,
        periodEnd: targetDate,
        payload: {},
      });
      totalJobs++;
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs, targetDate },
      'Yield calculation enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

/**
 * Cost aggregation - daily at 7:30 AM
 * Aggregates agent_cost_tracking into daily summaries per tenant.
 */
async function costAggregationJob() {
  const jobName = 'cost-aggregation';
  logger.info({ job: jobName }, 'Cron job started');

  try {
    const activeTenants = await getActiveTenants();
    const targetDate = yesterday();
    let totalJobs = 0;

    for (const tenant of activeTenants) {
      await enqueueCostTracking({
        tenantId: tenant.id,
        agentType: 'cost_tracker',
        resourceType: 'api_call',
        unitCost: 0,
        quantity: 0,
        payload: { aggregationType: 'daily_summary', targetDate },
      });
      totalJobs++;
    }

    logger.info(
      { job: jobName, tenantCount: activeTenants.length, jobCount: totalJobs, targetDate },
      'Cost aggregation enqueued',
    );
  } catch (err) {
    logger.error({ err, job: jobName }, 'Cron job failed');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Registration
// ═══════════════════════════════════════════════════════════════════════════

export function registerCronJobs() {
  const tz = 'America/New_York';

  // ─── Original Crons ──────────────────────────────────────────────────

  // Google search scan - every 2 hours (at minute 0)
  cron.schedule('0 */2 * * *', googleScanJob, { name: 'google-scan', timezone: tz });
  logger.info('Registered cron: google-scan (every 2h)');

  // Social media scan - every 4 hours (at minute 15)
  cron.schedule('15 */4 * * *', socialScanJob, { name: 'social-scan', timezone: tz });
  logger.info('Registered cron: social-scan (every 4h)');

  // Daily dedupe - 3:00 AM ET
  cron.schedule('0 3 * * *', dailyDedupeJob, { name: 'daily-dedupe', timezone: tz });
  logger.info('Registered cron: daily-dedupe (3:00 AM ET)');

  // Daily rescore - 4:00 AM ET
  cron.schedule('0 4 * * *', dailyRescoreJob, { name: 'daily-rescore', timezone: tz });
  logger.info('Registered cron: daily-rescore (4:00 AM ET)');

  // Stale lead archive - 5:00 AM ET
  cron.schedule('0 5 * * *', staleArchiveJob, { name: 'stale-archive', timezone: tz });
  logger.info('Registered cron: stale-archive (5:00 AM ET)');

  // Outreach generation - 6:00 AM ET
  cron.schedule('0 6 * * *', outreachGenerationJob, { name: 'outreach-gen', timezone: tz });
  logger.info('Registered cron: outreach-gen (6:00 AM ET)');

  // Health check - every hour (at minute 30)
  cron.schedule('30 * * * *', healthCheckJob, { name: 'health-check', timezone: tz });
  logger.info('Registered cron: health-check (hourly)');

  // ─── Discovery Swarm Crons ──────────────────────────────────────────

  // Continuous discovery - every 30 minutes (main swarm heartbeat)
  cron.schedule('*/30 * * * *', continuousDiscoveryJob, { name: 'continuous-discovery', timezone: tz });
  logger.info('Registered cron: continuous-discovery (every 30min)');

  // Query expansion refresh - every 6 hours (at minute 10)
  cron.schedule('10 */6 * * *', queryExpansionRefreshJob, { name: 'query-expansion-refresh', timezone: tz });
  logger.info('Registered cron: query-expansion-refresh (every 6h)');

  // Source health calculation - every 4 hours (at minute 20)
  cron.schedule('20 */4 * * *', sourceHealthCalcJob, { name: 'source-health-calc', timezone: tz });
  logger.info('Registered cron: source-health-calc (every 4h)');

  // ─── Inventory & Lifecycle Crons ─────────────────────────────────────

  // Inventory aging - daily at 2:00 AM ET
  cron.schedule('0 2 * * *', inventoryAgingJob, { name: 'inventory-aging', timezone: tz });
  logger.info('Registered cron: inventory-aging (2:00 AM ET)');

  // Freshness score update - daily at 2:30 AM ET
  cron.schedule('30 2 * * *', freshnessScoreJob, { name: 'freshness-score', timezone: tz });
  logger.info('Registered cron: freshness-score (2:30 AM ET)');

  // Stale lead detection - daily at 3:00 AM ET (runs alongside daily-dedupe)
  cron.schedule('0 3 * * *', staleLeadDetectionJob, { name: 'stale-lead-detection', timezone: tz });
  logger.info('Registered cron: stale-lead-detection (3:00 AM ET)');

  // Reactivation check - daily at 3:30 AM ET
  cron.schedule('30 3 * * *', reactivationCheckJob, { name: 'reactivation-check', timezone: tz });
  logger.info('Registered cron: reactivation-check (3:30 AM ET)');

  // ─── Analytics Crons ────────────────────────────────────────────────

  // Daily stats rollup - daily at 1:00 AM ET
  cron.schedule('0 1 * * *', dailyStatsRollupJob, { name: 'daily-stats-rollup', timezone: tz });
  logger.info('Registered cron: daily-stats-rollup (1:00 AM ET)');

  // Source health daily stats - daily at 1:30 AM ET
  cron.schedule('30 1 * * *', sourceHealthDailyJob, { name: 'source-health-daily', timezone: tz });
  logger.info('Registered cron: source-health-daily (1:30 AM ET)');

  // Campaign performance daily - daily at 1:45 AM ET
  cron.schedule('45 1 * * *', campaignPerformanceDailyJob, { name: 'campaign-performance-daily', timezone: tz });
  logger.info('Registered cron: campaign-performance-daily (1:45 AM ET)');

  // Inventory snapshot - every 6 hours (at minute 30)
  cron.schedule('30 */6 * * *', inventorySnapshotJob, { name: 'inventory-snapshot', timezone: tz });
  logger.info('Registered cron: inventory-snapshot (every 6h)');

  // ─── Cost Tracking Crons ────────────────────────────────────────────

  // Yield calculation - daily at 7:00 AM ET
  cron.schedule('0 7 * * *', yieldCalculationJob, { name: 'yield-calculation', timezone: tz });
  logger.info('Registered cron: yield-calculation (7:00 AM ET)');

  // Cost aggregation - daily at 7:30 AM ET
  cron.schedule('30 7 * * *', costAggregationJob, { name: 'cost-aggregation', timezone: tz });
  logger.info('Registered cron: cost-aggregation (7:30 AM ET)');
}
