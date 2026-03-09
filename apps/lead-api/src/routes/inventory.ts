import type { FastifyInstance } from 'fastify';
import { db } from '@alh/db';
import {
  leadInventoryItems,
  leadInventoryPools,
  leadPoolMemberships,
  leadSegments,
} from '@alh/db/src/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { logger } from '@alh/observability';

export async function inventoryRoutes(app: FastifyInstance) {
  // GET /inventory — list inventory items with filters
  app.get<{
    Querystring: {
      temperature?: string;
      age_band?: string;
      industry?: string;
      status?: string;
      min_value?: string;
      max_value?: string;
      page?: string;
      limit?: string;
    };
  }>('/', async (request, reply) => {
    const { tenantId } = request.ctx;
    const { temperature, age_band, industry, status, min_value, max_value } = request.query;
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 25));
    const offset = (page - 1) * limit;

    try {
      const conditions = [eq(leadInventoryItems.tenantId, tenantId)];

      if (temperature) {
        conditions.push(eq(leadInventoryItems.temperature, temperature));
      }
      if (age_band) {
        conditions.push(eq(leadInventoryItems.ageBand, age_band));
      }
      if (industry) {
        conditions.push(eq(leadInventoryItems.industry, industry));
      }
      if (status) {
        conditions.push(eq(leadInventoryItems.inventoryStatus, status));
      }
      if (min_value) {
        conditions.push(gte(leadInventoryItems.valueScore, Number(min_value)));
      }
      if (max_value) {
        conditions.push(lte(leadInventoryItems.valueScore, Number(max_value)));
      }

      const where = and(...conditions);

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(leadInventoryItems)
          .where(where)
          .orderBy(desc(leadInventoryItems.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(leadInventoryItems)
          .where(where),
      ]);

      const total = countResult[0]?.count ?? 0;

      return {
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list inventory items');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve inventory items',
        statusCode: 500,
      });
    }
  });

  // GET /inventory/stats — counts by temperature, age_band, status
  app.get('/stats', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const [byTemperature, byAgeBand, byStatus] = await Promise.all([
        db
          .select({
            temperature: leadInventoryItems.temperature,
            count: sql<number>`count(*)::int`,
          })
          .from(leadInventoryItems)
          .where(eq(leadInventoryItems.tenantId, tenantId))
          .groupBy(leadInventoryItems.temperature),
        db
          .select({
            ageBand: leadInventoryItems.ageBand,
            count: sql<number>`count(*)::int`,
          })
          .from(leadInventoryItems)
          .where(eq(leadInventoryItems.tenantId, tenantId))
          .groupBy(leadInventoryItems.ageBand),
        db
          .select({
            status: leadInventoryItems.inventoryStatus,
            count: sql<number>`count(*)::int`,
          })
          .from(leadInventoryItems)
          .where(eq(leadInventoryItems.tenantId, tenantId))
          .groupBy(leadInventoryItems.inventoryStatus),
      ]);

      return { byTemperature, byAgeBand, byStatus };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to get inventory stats');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve inventory stats',
        statusCode: 500,
      });
    }
  });

  // GET /inventory/pools — list pools
  app.get('/pools', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const pools = await db
        .select()
        .from(leadInventoryPools)
        .where(eq(leadInventoryPools.tenantId, tenantId))
        .orderBy(desc(leadInventoryPools.createdAt));

      return { data: pools };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list inventory pools');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve inventory pools',
        statusCode: 500,
      });
    }
  });

  // POST /inventory/pools — create pool
  app.post<{
    Body: {
      name: string;
      description?: string;
      filters?: Record<string, unknown>;
    };
  }>('/pools', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const { name, description, filters } = request.body;

    if (!name) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'name is required',
        statusCode: 400,
      });
    }

    try {
      const [pool] = await db
        .insert(leadInventoryPools)
        .values({
          tenantId,
          name,
          description: description ?? null,
          filterCriteriaJson: filters ?? {},
          poolType: 'manual',
        })
        .returning();

      logger.info({ tenantId, poolId: pool.id, name, userId }, 'Inventory pool created');
      return reply.status(201).send(pool);
    } catch (err) {
      logger.error({ err, tenantId, name }, 'Failed to create inventory pool');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create inventory pool',
        statusCode: 500,
      });
    }
  });

  // POST /inventory/pools/:id/add — add leads to pool
  app.post<{
    Params: { id: string };
    Body: { inventoryItemIds: number[] };
  }>('/pools/:id/add', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const poolId = parseInt(request.params.id, 10);
    const { inventoryItemIds } = request.body;

    if (isNaN(poolId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid pool ID',
        statusCode: 400,
      });
    }

    if (!Array.isArray(inventoryItemIds) || inventoryItemIds.length === 0) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'inventoryItemIds must be a non-empty array',
        statusCode: 400,
      });
    }

    try {
      // Verify pool belongs to tenant
      const [pool] = await db
        .select({ id: leadInventoryPools.id })
        .from(leadInventoryPools)
        .where(and(eq(leadInventoryPools.id, poolId), eq(leadInventoryPools.tenantId, tenantId)))
        .limit(1);

      if (!pool) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Pool ${poolId} not found`,
          statusCode: 404,
        });
      }

      const rows = inventoryItemIds.map((itemId) => ({
        poolId,
        inventoryItemId: itemId,
        addedBy: String(userId),
      }));

      await db.insert(leadPoolMemberships).values(rows).onConflictDoNothing();

      logger.info({ tenantId, poolId, count: inventoryItemIds.length, userId }, 'Items added to pool');
      return { message: `${inventoryItemIds.length} items added to pool`, poolId };
    } catch (err) {
      logger.error({ err, tenantId, poolId }, 'Failed to add items to pool');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to add items to pool',
        statusCode: 500,
      });
    }
  });

  // GET /inventory/segments — list segments
  app.get('/segments', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const segments = await db
        .select()
        .from(leadSegments)
        .where(eq(leadSegments.tenantId, tenantId))
        .orderBy(desc(leadSegments.createdAt));

      return { data: segments };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list inventory segments');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve inventory segments',
        statusCode: 500,
      });
    }
  });

  // POST /inventory/segments — create segment
  app.post<{
    Body: {
      name: string;
      segmentType?: string;
      rulesJson: Record<string, unknown>;
    };
  }>('/segments', async (request, reply) => {
    const { tenantId } = request.ctx;
    const { name, segmentType, rulesJson } = request.body;

    if (!name || !rulesJson) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'name and rulesJson are required',
        statusCode: 400,
      });
    }

    try {
      const [segment] = await db
        .insert(leadSegments)
        .values({
          tenantId,
          name,
          segmentType: segmentType ?? 'custom',
          rulesJson,
        })
        .returning();

      logger.info({ tenantId, segmentId: segment.id, name }, 'Inventory segment created');
      return reply.status(201).send(segment);
    } catch (err) {
      logger.error({ err, tenantId, name }, 'Failed to create inventory segment');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create inventory segment',
        statusCode: 500,
      });
    }
  });

  // GET /inventory/monetizable — leads eligible for monetization
  app.get('/monetizable', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const rows = await db
        .select()
        .from(leadInventoryItems)
        .where(
          and(
            eq(leadInventoryItems.tenantId, tenantId),
            eq(leadInventoryItems.monetizationEligible, true),
            eq(leadInventoryItems.inventoryStatus, 'available'),
          ),
        )
        .orderBy(desc(leadInventoryItems.valueScore));

      return { data: rows };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list monetizable inventory');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve monetizable inventory',
        statusCode: 500,
      });
    }
  });
}
