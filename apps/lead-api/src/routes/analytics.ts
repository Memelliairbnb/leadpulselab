import type { FastifyInstance } from 'fastify';
import { db } from '@alh/db';
import { qualifiedLeads, scanJobs, outreachDrafts } from '@alh/db/src/schema';
import { eq, and, gte, sql, count } from 'drizzle-orm';
import { logger } from '@alh/observability';
import type { AnalyticsOverview } from '@alh/types';

export async function analyticsRoutes(app: FastifyInstance) {
  // GET /analytics/overview
  app.get('/overview', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Run all queries in parallel
      const [
        totalResult,
        todayResult,
        scoreBandResult,
        typeResult,
        platformResult,
        scanJobStats,
        outreachPendingResult,
      ] = await Promise.all([
        // Total leads
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(qualifiedLeads)
          .where(eq(qualifiedLeads.tenantId, tenantId)),

        // Leads today
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(qualifiedLeads)
          .where(
            and(
              eq(qualifiedLeads.tenantId, tenantId),
              gte(qualifiedLeads.createdAt, startOfToday),
            ),
          ),

        // Leads by score band
        db
          .select({
            band: sql<string>`
              CASE
                WHEN ${qualifiedLeads.leadScore} >= 85 THEN 'hot'
                WHEN ${qualifiedLeads.leadScore} >= 70 THEN 'strong'
                WHEN ${qualifiedLeads.leadScore} >= 30 THEN 'nurture'
                ELSE 'archive'
              END
            `,
            count: sql<number>`count(*)::int`,
          })
          .from(qualifiedLeads)
          .where(eq(qualifiedLeads.tenantId, tenantId))
          .groupBy(sql`
            CASE
              WHEN ${qualifiedLeads.leadScore} >= 85 THEN 'hot'
              WHEN ${qualifiedLeads.leadScore} >= 70 THEN 'strong'
              WHEN ${qualifiedLeads.leadScore} >= 50 THEN 'nurture'
              ELSE 'archive'
            END
          `),

        // Leads by type
        db
          .select({
            leadType: qualifiedLeads.leadType,
            count: sql<number>`count(*)::int`,
          })
          .from(qualifiedLeads)
          .where(eq(qualifiedLeads.tenantId, tenantId))
          .groupBy(qualifiedLeads.leadType),

        // Leads by platform
        db
          .select({
            platform: qualifiedLeads.platform,
            count: sql<number>`count(*)::int`,
          })
          .from(qualifiedLeads)
          .where(eq(qualifiedLeads.tenantId, tenantId))
          .groupBy(qualifiedLeads.platform),

        // Scan job stats (last 24h)
        db
          .select({
            status: scanJobs.status,
            count: sql<number>`count(*)::int`,
          })
          .from(scanJobs)
          .where(
            and(
              eq(scanJobs.tenantId, tenantId),
              gte(scanJobs.createdAt, twentyFourHoursAgo),
            ),
          )
          .groupBy(scanJobs.status),

        // Pending outreach count
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(outreachDrafts)
          .where(
            and(
              eq(outreachDrafts.tenantId, tenantId),
              eq(outreachDrafts.status, 'pending_review'),
            ),
          ),
      ]);

      // Build score band map
      const bandMap: Record<string, number> = { hot: 0, strong: 0, nurture: 0, archive: 0 };
      for (const row of scoreBandResult) {
        bandMap[row.band] = row.count;
      }

      // Build type map
      const typeMap: Record<string, number> = {};
      for (const row of typeResult) {
        typeMap[row.leadType] = row.count;
      }

      // Build platform map
      const platformMap: Record<string, number> = {};
      for (const row of platformResult) {
        platformMap[row.platform] = row.count;
      }

      // Build scan job stats
      const scanJobMap: Record<string, number> = {};
      for (const row of scanJobStats) {
        scanJobMap[row.status] = row.count;
      }

      const overview: AnalyticsOverview = {
        totalLeads: totalResult[0]?.count ?? 0,
        leadsToday: todayResult[0]?.count ?? 0,
        leadsByScoreBand: {
          hot: bandMap.hot,
          strong: bandMap.strong,
          nurture: bandMap.nurture,
          archive: bandMap.archive,
        },
        leadsByType: typeMap,
        leadsByPlatform: platformMap,
        scanJobs24h: {
          completed: scanJobMap['completed'] ?? 0,
          failed: scanJobMap['failed'] ?? 0,
        },
        outreachPending: outreachPendingResult[0]?.count ?? 0,
      };

      return overview;
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to build analytics overview');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve analytics',
        statusCode: 500,
      });
    }
  });
}
