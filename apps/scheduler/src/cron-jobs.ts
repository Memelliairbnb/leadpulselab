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
} from '@alh/queues';
import { qualifiedLeads } from '@alh/db/src/schema/leads';
import { outreachDrafts } from '@alh/db/src/schema/outreach';
import { eq, and, lte, sql } from 'drizzle-orm';

async function getActiveTenants() {
  return db.select().from(tenants).where(eq(tenants.isActive, true));
}

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

export function registerCronJobs() {
  // Google search scan - every 2 hours (at minute 0)
  cron.schedule('0 */2 * * *', googleScanJob, {
    name: 'google-scan',
    timezone: 'America/New_York',
  });
  logger.info('Registered cron: google-scan (every 2h)');

  // Social media scan - every 4 hours (at minute 15)
  cron.schedule('15 */4 * * *', socialScanJob, {
    name: 'social-scan',
    timezone: 'America/New_York',
  });
  logger.info('Registered cron: social-scan (every 4h)');

  // Daily dedupe - 3:00 AM ET
  cron.schedule('0 3 * * *', dailyDedupeJob, {
    name: 'daily-dedupe',
    timezone: 'America/New_York',
  });
  logger.info('Registered cron: daily-dedupe (3:00 AM ET)');

  // Daily rescore - 4:00 AM ET
  cron.schedule('0 4 * * *', dailyRescoreJob, {
    name: 'daily-rescore',
    timezone: 'America/New_York',
  });
  logger.info('Registered cron: daily-rescore (4:00 AM ET)');

  // Stale lead archive - 5:00 AM ET
  cron.schedule('0 5 * * *', staleArchiveJob, {
    name: 'stale-archive',
    timezone: 'America/New_York',
  });
  logger.info('Registered cron: stale-archive (5:00 AM ET)');

  // Outreach generation - 6:00 AM ET
  cron.schedule('0 6 * * *', outreachGenerationJob, {
    name: 'outreach-gen',
    timezone: 'America/New_York',
  });
  logger.info('Registered cron: outreach-gen (6:00 AM ET)');

  // Health check - every hour (at minute 30)
  cron.schedule('30 * * * *', healthCheckJob, {
    name: 'health-check',
    timezone: 'America/New_York',
  });
  logger.info('Registered cron: health-check (hourly)');
}
