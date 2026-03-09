import type { FastifyInstance } from 'fastify';
import { db } from '@alh/db';
import {
  canonicalLeads,
  leadIdentities,
  leadDomains,
  lifecycleEvents,
} from '@alh/db/src/schema';
import { eq, and, ilike, sql, desc, asc } from 'drizzle-orm';
import { logger } from '@alh/observability';

export async function canonicalRoutes(app: FastifyInstance) {
  // GET /canonical-leads — list with filters
  app.get<{
    Querystring: {
      lifecycle_state?: string;
      industry?: string;
      geo?: string;
      persona?: string;
      freshness?: string;
      verification?: string;
      search?: string;
      page?: string;
      limit?: string;
      sortBy?: string;
      sortOrder?: string;
    };
  }>('/', async (request, reply) => {
    const { tenantId } = request.ctx;
    const {
      lifecycle_state,
      industry,
      geo,
      persona,
      freshness,
      verification,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = request.query;
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 25));
    const offset = (page - 1) * limit;

    try {
      const conditions = [eq(canonicalLeads.tenantId, tenantId)];

      if (lifecycle_state) {
        conditions.push(eq(canonicalLeads.lifecycleState, lifecycle_state));
      }
      if (industry) {
        conditions.push(eq(canonicalLeads.industry, industry));
      }
      if (geo) {
        conditions.push(eq(canonicalLeads.geo, geo));
      }
      if (persona) {
        conditions.push(eq(canonicalLeads.persona, persona));
      }
      if (freshness) {
        conditions.push(eq(canonicalLeads.freshness, freshness));
      }
      if (verification) {
        conditions.push(eq(canonicalLeads.verification, verification));
      }
      if (search) {
        conditions.push(
          ilike(canonicalLeads.displayName, `%${search}%`),
        );
      }

      const where = and(...conditions);

      const orderCol =
        sortBy === 'displayName'
          ? canonicalLeads.displayName
          : sortBy === 'lifecycleState'
            ? canonicalLeads.lifecycleState
            : canonicalLeads.createdAt;
      const orderFn = sortOrder === 'asc' ? asc : desc;

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(canonicalLeads)
          .where(where)
          .orderBy(orderFn(orderCol))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(canonicalLeads)
          .where(where),
      ]);

      const total = countResult[0]?.count ?? 0;

      return {
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list canonical leads');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve canonical leads',
        statusCode: 500,
      });
    }
  });

  // GET /canonical-leads/:id — detail with identities, domains, lifecycle events
  app.get<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const { tenantId } = request.ctx;
    const id = parseInt(request.params.id, 10);

    if (isNaN(id)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid canonical lead ID',
        statusCode: 400,
      });
    }

    try {
      const [lead] = await db
        .select()
        .from(canonicalLeads)
        .where(and(eq(canonicalLeads.id, id), eq(canonicalLeads.tenantId, tenantId)))
        .limit(1);

      if (!lead) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Canonical lead ${id} not found`,
          statusCode: 404,
        });
      }

      const [identities, domains, events] = await Promise.all([
        db
          .select()
          .from(leadIdentities)
          .where(eq(leadIdentities.canonicalLeadId, id)),
        db
          .select()
          .from(leadDomains)
          .where(eq(leadDomains.canonicalLeadId, id)),
        db
          .select()
          .from(lifecycleEvents)
          .where(eq(lifecycleEvents.canonicalLeadId, id))
          .orderBy(desc(lifecycleEvents.createdAt))
          .limit(50),
      ]);

      return { ...lead, identities, domains, lifecycleEvents: events };
    } catch (err) {
      logger.error({ err, tenantId, id }, 'Failed to get canonical lead detail');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve canonical lead',
        statusCode: 500,
      });
    }
  });

  // PATCH /canonical-leads/:id/lifecycle — update lifecycle state
  app.patch<{
    Params: { id: string };
    Body: { state: string; reason?: string };
  }>('/:id/lifecycle', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const id = parseInt(request.params.id, 10);
    const { state, reason } = request.body;

    if (isNaN(id)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid canonical lead ID',
        statusCode: 400,
      });
    }

    if (!state) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'state is required',
        statusCode: 400,
      });
    }

    const validStates = ['raw', 'enriched', 'verified', 'scored', 'qualified', 'nurturing', 'converted', 'archived', 'dead'];
    if (!validStates.includes(state)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: `Invalid state. Must be one of: ${validStates.join(', ')}`,
        statusCode: 400,
      });
    }

    try {
      const [existing] = await db
        .select()
        .from(canonicalLeads)
        .where(and(eq(canonicalLeads.id, id), eq(canonicalLeads.tenantId, tenantId)))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Canonical lead ${id} not found`,
          statusCode: 404,
        });
      }

      const previousState = existing.lifecycleState;

      const [updated] = await db
        .update(canonicalLeads)
        .set({ lifecycleState: state, updatedAt: new Date() })
        .where(and(eq(canonicalLeads.id, id), eq(canonicalLeads.tenantId, tenantId)))
        .returning();

      // Record lifecycle event
      await db.insert(lifecycleEvents).values({
        canonicalLeadId: id,
        tenantId,
        fromState: previousState,
        toState: state,
        reason: reason ?? null,
        triggeredBy: userId,
      });

      logger.info({ tenantId, id, previousState, state, userId }, 'Canonical lead lifecycle updated');
      return updated;
    } catch (err) {
      logger.error({ err, tenantId, id, state }, 'Failed to update lifecycle state');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update lifecycle state',
        statusCode: 500,
      });
    }
  });

  // GET /canonical-leads/:id/identities — list identities
  app.get<{
    Params: { id: string };
  }>('/:id/identities', async (request, reply) => {
    const { tenantId } = request.ctx;
    const id = parseInt(request.params.id, 10);

    if (isNaN(id)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid canonical lead ID',
        statusCode: 400,
      });
    }

    try {
      // Verify lead belongs to tenant
      const [lead] = await db
        .select({ id: canonicalLeads.id })
        .from(canonicalLeads)
        .where(and(eq(canonicalLeads.id, id), eq(canonicalLeads.tenantId, tenantId)))
        .limit(1);

      if (!lead) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Canonical lead ${id} not found`,
          statusCode: 404,
        });
      }

      const identities = await db
        .select()
        .from(leadIdentities)
        .where(eq(leadIdentities.canonicalLeadId, id));

      return { data: identities };
    } catch (err) {
      logger.error({ err, tenantId, id }, 'Failed to list identities');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve identities',
        statusCode: 500,
      });
    }
  });

  // POST /canonical-leads/:id/identities — add identity manually
  app.post<{
    Params: { id: string };
    Body: {
      provider: string;
      externalId: string;
      profileUrl?: string;
      metadata?: Record<string, unknown>;
    };
  }>('/:id/identities', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const id = parseInt(request.params.id, 10);
    const { provider, externalId, profileUrl, metadata } = request.body;

    if (isNaN(id)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid canonical lead ID',
        statusCode: 400,
      });
    }

    if (!provider || !externalId) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'provider and externalId are required',
        statusCode: 400,
      });
    }

    try {
      // Verify lead belongs to tenant
      const [lead] = await db
        .select({ id: canonicalLeads.id })
        .from(canonicalLeads)
        .where(and(eq(canonicalLeads.id, id), eq(canonicalLeads.tenantId, tenantId)))
        .limit(1);

      if (!lead) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Canonical lead ${id} not found`,
          statusCode: 404,
        });
      }

      const [identity] = await db
        .insert(leadIdentities)
        .values({
          canonicalLeadId: id,
          provider,
          externalId,
          profileUrl: profileUrl ?? null,
          metadata: metadata ?? null,
          addedBy: userId,
        })
        .returning();

      logger.info({ tenantId, canonicalLeadId: id, provider, userId }, 'Identity added manually');
      return reply.status(201).send(identity);
    } catch (err) {
      logger.error({ err, tenantId, id, provider }, 'Failed to add identity');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to add identity',
        statusCode: 500,
      });
    }
  });

  // GET /canonical-leads/:id/events — lifecycle event history
  app.get<{
    Params: { id: string };
    Querystring: { page?: string; limit?: string };
  }>('/:id/events', async (request, reply) => {
    const { tenantId } = request.ctx;
    const id = parseInt(request.params.id, 10);
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 25));
    const offset = (page - 1) * limit;

    if (isNaN(id)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid canonical lead ID',
        statusCode: 400,
      });
    }

    try {
      // Verify lead belongs to tenant
      const [lead] = await db
        .select({ id: canonicalLeads.id })
        .from(canonicalLeads)
        .where(and(eq(canonicalLeads.id, id), eq(canonicalLeads.tenantId, tenantId)))
        .limit(1);

      if (!lead) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Canonical lead ${id} not found`,
          statusCode: 404,
        });
      }

      const [events, countResult] = await Promise.all([
        db
          .select()
          .from(lifecycleEvents)
          .where(eq(lifecycleEvents.canonicalLeadId, id))
          .orderBy(desc(lifecycleEvents.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(lifecycleEvents)
          .where(eq(lifecycleEvents.canonicalLeadId, id)),
      ]);

      const total = countResult[0]?.count ?? 0;

      return {
        data: events,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (err) {
      logger.error({ err, tenantId, id }, 'Failed to list lifecycle events');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve lifecycle events',
        statusCode: 500,
      });
    }
  });
}
