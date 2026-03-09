import type { FastifyInstance } from 'fastify';
import { db } from '@alh/db';
import {
  tenants,
  sourceHealthMetrics,
  leadInventoryItems,
  queryRuns,
} from '@alh/db/src/schema';
import { sql, desc } from 'drizzle-orm';
import { logger } from '@alh/observability';

function requireAdmin(role: string): boolean {
  return role === 'admin';
}

export async function adminRoutes(app: FastifyInstance) {
  // Role check hook — all routes in this plugin require admin
  app.addHook('onRequest', async (request, reply) => {
    if (!requireAdmin(request.ctx.userRole)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
        statusCode: 403,
      });
    }
  });

  // GET /admin/tenants — list all tenants
  app.get('/tenants', async (_request, reply) => {
    try {
      const rows = await db
        .select()
        .from(tenants)
        .orderBy(desc(tenants.createdAt));

      return { data: rows };
    } catch (err) {
      logger.error({ err }, 'Failed to list tenants');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve tenants',
        statusCode: 500,
      });
    }
  });

  // GET /admin/source-health — platform-wide source health
  app.get('/source-health', async (_request, reply) => {
    try {
      const rows = await db
        .select()
        .from(sourceHealthMetrics)
        .orderBy(desc(sourceHealthMetrics.qualityScore));

      return { data: rows };
    } catch (err) {
      logger.error({ err }, 'Failed to get platform source health');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve platform source health',
        statusCode: 500,
      });
    }
  });

  // GET /admin/workers — worker/queue health status
  app.get('/workers', async (_request, reply) => {
    try {
      // Query recent query runs to infer worker health
      const stats = await db
        .select({
          queryType: queryRuns.queryType,
          count: sql<number>`count(*)::int`,
          latest: sql<string>`max(${queryRuns.createdAt})::text`,
        })
        .from(queryRuns)
        .groupBy(queryRuns.queryType);

      const statusMap: Record<string, { count: number; latest: string | null }> = {};
      for (const row of stats) {
        statusMap[row.queryType ?? 'unknown'] = { count: row.count, latest: row.latest };
      }

      return {
        workers: statusMap,
        healthy: true,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get worker health');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve worker health',
        statusCode: 500,
      });
    }
  });

  // GET /admin/costs — cost tracking summary
  app.get('/costs', async (_request, reply) => {
    try {
      // Aggregate run data from query runs (cost column not available, using duration as proxy)
      const result = await db
        .select({
          totalRuns: sql<number>`count(*)::int`,
          totalDurationMs: sql<number>`coalesce(sum(${queryRuns.durationMs}), 0)::numeric`,
          avgDurationMs: sql<number>`coalesce(avg(${queryRuns.durationMs}), 0)::numeric`,
        })
        .from(queryRuns);

      return {
        totalRuns: result[0]?.totalRuns ?? 0,
        totalCost: Number(result[0]?.totalDurationMs ?? 0),
        avgCostPerRun: Number(result[0]?.avgDurationMs ?? 0),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get cost summary');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve cost summary',
        statusCode: 500,
      });
    }
  });

  // GET /admin/yield — yield metrics
  app.get('/yield', async (_request, reply) => {
    try {
      const [runStats, inventoryStats] = await Promise.all([
        db
          .select({
            totalRuns: sql<number>`count(*)::int`,
            totalLeadsFound: sql<number>`coalesce(sum(${queryRuns.resultsCount}), 0)::int`,
            totalLeadsQualified: sql<number>`coalesce(sum(${queryRuns.leadsExtracted}), 0)::int`,
          })
          .from(queryRuns),
        db
          .select({
            totalInventory: sql<number>`count(*)::int`,
            totalValue: sql<number>`coalesce(sum(${leadInventoryItems.valueScore}), 0)::numeric`,
          })
          .from(leadInventoryItems),
      ]);

      const totalFound = runStats[0]?.totalLeadsFound ?? 0;
      const totalQualified = runStats[0]?.totalLeadsQualified ?? 0;

      return {
        totalRuns: runStats[0]?.totalRuns ?? 0,
        totalLeadsFound: totalFound,
        totalLeadsQualified: totalQualified,
        qualificationRate: totalFound > 0 ? (totalQualified / totalFound) : 0,
        totalInventory: inventoryStats[0]?.totalInventory ?? 0,
        totalEstimatedValue: Number(inventoryStats[0]?.totalValue ?? 0),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get yield metrics');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve yield metrics',
        statusCode: 500,
      });
    }
  });

  // POST /admin/reprocess — trigger reprocessing run
  app.post<{
    Body: { tenantId?: number; scope?: string };
  }>('/reprocess', async (request, reply) => {
    const { userId } = request.ctx;
    const { tenantId: targetTenantId, scope } = request.body;

    try {
      // Insert a reprocessing query run
      const [run] = await db
        .insert(queryRuns)
        .values({
          tenantId: targetTenantId ?? 0,
          sourceId: 0, // system-triggered
          queryText: `reprocess: ${scope ?? 'all'}`,
          queryType: 'keyword',
        })
        .returning();

      logger.info({ runId: run.id, targetTenantId, scope, userId }, 'Reprocessing run triggered');
      return reply.status(201).send(run);
    } catch (err) {
      logger.error({ err, targetTenantId, scope }, 'Failed to trigger reprocessing');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to trigger reprocessing',
        statusCode: 500,
      });
    }
  });

  // GET /admin/inventory-overview — platform-wide inventory stats
  app.get('/inventory-overview', async (_request, reply) => {
    try {
      const [byTenant, byTemperature, byStatus] = await Promise.all([
        db
          .select({
            tenantId: leadInventoryItems.tenantId,
            count: sql<number>`count(*)::int`,
            totalValue: sql<number>`coalesce(sum(${leadInventoryItems.valueScore}), 0)::numeric`,
          })
          .from(leadInventoryItems)
          .groupBy(leadInventoryItems.tenantId),
        db
          .select({
            temperature: leadInventoryItems.temperature,
            count: sql<number>`count(*)::int`,
          })
          .from(leadInventoryItems)
          .groupBy(leadInventoryItems.temperature),
        db
          .select({
            status: leadInventoryItems.inventoryStatus,
            count: sql<number>`count(*)::int`,
          })
          .from(leadInventoryItems)
          .groupBy(leadInventoryItems.inventoryStatus),
      ]);

      return {
        byTenant: byTenant.map((r) => ({
          tenantId: r.tenantId,
          count: r.count,
          totalValue: Number(r.totalValue),
        })),
        byTemperature,
        byStatus,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get inventory overview');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve inventory overview',
        statusCode: 500,
      });
    }
  });
}
