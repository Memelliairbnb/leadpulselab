import type { FastifyInstance } from 'fastify';
import { db } from '@alh/db';
import {
  queryRuns,
  sourceHealth,
  scrubRuns,
  duplicateCandidates,
} from '@alh/db/src/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { logger } from '@alh/observability';

export async function discoveryRoutes(app: FastifyInstance) {
  // GET /discovery/query-runs — recent query runs with stats
  app.get<{
    Querystring: { page?: string; limit?: string };
  }>('/query-runs', async (request, reply) => {
    const { tenantId } = request.ctx;
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 25));
    const offset = (page - 1) * limit;

    try {
      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(queryRuns)
          .where(eq(queryRuns.tenantId, tenantId))
          .orderBy(desc(queryRuns.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(queryRuns)
          .where(eq(queryRuns.tenantId, tenantId)),
      ]);

      const total = countResult[0]?.count ?? 0;

      return {
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list query runs');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve query runs',
        statusCode: 500,
      });
    }
  });

  // POST /discovery/trigger-scan — manually trigger a discovery scan for a source
  app.post<{
    Body: { sourceId: number; keywords?: string[] };
  }>('/trigger-scan', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const { sourceId, keywords } = request.body;

    if (!sourceId) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'sourceId is required',
        statusCode: 400,
      });
    }

    try {
      const [run] = await db
        .insert(queryRuns)
        .values({
          tenantId,
          sourceId,
          status: 'pending',
          keywords: keywords ?? [],
          triggeredBy: userId,
        })
        .returning();

      logger.info({ tenantId, sourceId, runId: run.id, userId }, 'Discovery scan triggered');
      return reply.status(201).send(run);
    } catch (err) {
      logger.error({ err, tenantId, sourceId }, 'Failed to trigger discovery scan');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to trigger discovery scan',
        statusCode: 500,
      });
    }
  });

  // GET /discovery/source-health — source quality scores
  app.get('/source-health', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const rows = await db
        .select()
        .from(sourceHealth)
        .where(eq(sourceHealth.tenantId, tenantId))
        .orderBy(desc(sourceHealth.qualityScore));

      return { data: rows };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list source health');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve source health',
        statusCode: 500,
      });
    }
  });

  // GET /discovery/source-health/:sourceId — detailed health metrics for a source
  app.get<{
    Params: { sourceId: string };
  }>('/source-health/:sourceId', async (request, reply) => {
    const { tenantId } = request.ctx;
    const sourceId = parseInt(request.params.sourceId, 10);

    if (isNaN(sourceId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid source ID',
        statusCode: 400,
      });
    }

    try {
      const [health] = await db
        .select()
        .from(sourceHealth)
        .where(
          and(
            eq(sourceHealth.sourceId, sourceId),
            eq(sourceHealth.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!health) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Source health for source ${sourceId} not found`,
          statusCode: 404,
        });
      }

      return health;
    } catch (err) {
      logger.error({ err, tenantId, sourceId }, 'Failed to get source health detail');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve source health detail',
        statusCode: 500,
      });
    }
  });

  // GET /discovery/scrub-runs — recent scrub runs
  app.get<{
    Querystring: { page?: string; limit?: string };
  }>('/scrub-runs', async (request, reply) => {
    const { tenantId } = request.ctx;
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 25));
    const offset = (page - 1) * limit;

    try {
      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(scrubRuns)
          .where(eq(scrubRuns.tenantId, tenantId))
          .orderBy(desc(scrubRuns.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(scrubRuns)
          .where(eq(scrubRuns.tenantId, tenantId)),
      ]);

      const total = countResult[0]?.count ?? 0;

      return {
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list scrub runs');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve scrub runs',
        statusCode: 500,
      });
    }
  });

  // GET /discovery/duplicate-candidates — pending duplicate reviews
  app.get<{
    Querystring: { page?: string; limit?: string };
  }>('/duplicate-candidates', async (request, reply) => {
    const { tenantId } = request.ctx;
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 25));
    const offset = (page - 1) * limit;

    try {
      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(duplicateCandidates)
          .where(
            and(
              eq(duplicateCandidates.tenantId, tenantId),
              eq(duplicateCandidates.status, 'pending'),
            ),
          )
          .orderBy(desc(duplicateCandidates.confidence))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(duplicateCandidates)
          .where(
            and(
              eq(duplicateCandidates.tenantId, tenantId),
              eq(duplicateCandidates.status, 'pending'),
            ),
          ),
      ]);

      const total = countResult[0]?.count ?? 0;

      return {
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list duplicate candidates');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve duplicate candidates',
        statusCode: 500,
      });
    }
  });

  // POST /discovery/duplicate-candidates/:id/resolve — resolve a duplicate
  app.post<{
    Params: { id: string };
    Body: { resolution: 'merge' | 'separate' | 'defer'; reason?: string };
  }>('/duplicate-candidates/:id/resolve', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const id = parseInt(request.params.id, 10);
    const { resolution, reason } = request.body;

    if (isNaN(id)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid duplicate candidate ID',
        statusCode: 400,
      });
    }

    const validResolutions = ['merge', 'separate', 'defer'];
    if (!resolution || !validResolutions.includes(resolution)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: `resolution is required and must be one of: ${validResolutions.join(', ')}`,
        statusCode: 400,
      });
    }

    try {
      const [existing] = await db
        .select()
        .from(duplicateCandidates)
        .where(
          and(
            eq(duplicateCandidates.id, id),
            eq(duplicateCandidates.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Duplicate candidate ${id} not found`,
          statusCode: 404,
        });
      }

      const [updated] = await db
        .update(duplicateCandidates)
        .set({
          status: resolution === 'defer' ? 'deferred' : 'resolved',
          resolution,
          reason: reason ?? null,
          resolvedBy: userId,
          resolvedAt: new Date(),
        })
        .where(eq(duplicateCandidates.id, id))
        .returning();

      logger.info({ tenantId, id, resolution, userId }, 'Duplicate candidate resolved');
      return updated;
    } catch (err) {
      logger.error({ err, tenantId, id, resolution }, 'Failed to resolve duplicate candidate');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to resolve duplicate candidate',
        statusCode: 500,
      });
    }
  });
}
