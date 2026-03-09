import type { FastifyInstance } from 'fastify';
import { db } from '@alh/db';
import {
  inventoryItems,
  inventoryPools,
  inventoryPoolMembers,
  inventorySegments,
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
      const conditions = [eq(inventoryItems.tenantId, tenantId)];

      if (temperature) {
        conditions.push(eq(inventoryItems.temperature, temperature));
      }
      if (age_band) {
        conditions.push(eq(inventoryItems.ageBand, age_band));
      }
      if (industry) {
        conditions.push(eq(inventoryItems.industry, industry));
      }
      if (status) {
        conditions.push(eq(inventoryItems.status, status));
      }
      if (min_value) {
        conditions.push(gte(inventoryItems.estimatedValue, Number(min_value)));
      }
      if (max_value) {
        conditions.push(lte(inventoryItems.estimatedValue, Number(max_value)));
      }

      const where = and(...conditions);

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(inventoryItems)
          .where(where)
          .orderBy(desc(inventoryItems.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(inventoryItems)
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
            temperature: inventoryItems.temperature,
            count: sql<number>`count(*)::int`,
          })
          .from(inventoryItems)
          .where(eq(inventoryItems.tenantId, tenantId))
          .groupBy(inventoryItems.temperature),
        db
          .select({
            ageBand: inventoryItems.ageBand,
            count: sql<number>`count(*)::int`,
          })
          .from(inventoryItems)
          .where(eq(inventoryItems.tenantId, tenantId))
          .groupBy(inventoryItems.ageBand),
        db
          .select({
            status: inventoryItems.status,
            count: sql<number>`count(*)::int`,
          })
          .from(inventoryItems)
          .where(eq(inventoryItems.tenantId, tenantId))
          .groupBy(inventoryItems.status),
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
        .from(inventoryPools)
        .where(eq(inventoryPools.tenantId, tenantId))
        .orderBy(desc(inventoryPools.createdAt));

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
        .insert(inventoryPools)
        .values({
          tenantId,
          name,
          description: description ?? null,
          filters: filters ?? null,
          createdBy: userId,
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
        .select({ id: inventoryPools.id })
        .from(inventoryPools)
        .where(and(eq(inventoryPools.id, poolId), eq(inventoryPools.tenantId, tenantId)))
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
        addedBy: userId,
      }));

      await db.insert(inventoryPoolMembers).values(rows).onConflictDoNothing();

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
        .from(inventorySegments)
        .where(eq(inventorySegments.tenantId, tenantId))
        .orderBy(desc(inventorySegments.createdAt));

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
      description?: string;
      criteria: Record<string, unknown>;
    };
  }>('/segments', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const { name, description, criteria } = request.body;

    if (!name || !criteria) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'name and criteria are required',
        statusCode: 400,
      });
    }

    try {
      const [segment] = await db
        .insert(inventorySegments)
        .values({
          tenantId,
          name,
          description: description ?? null,
          criteria,
          createdBy: userId,
        })
        .returning();

      logger.info({ tenantId, segmentId: segment.id, name, userId }, 'Inventory segment created');
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
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.tenantId, tenantId),
            eq(inventoryItems.monetizable, true),
            eq(inventoryItems.status, 'available'),
          ),
        )
        .orderBy(desc(inventoryItems.estimatedValue));

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
