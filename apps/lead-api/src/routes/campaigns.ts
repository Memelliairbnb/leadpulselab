import type { FastifyInstance } from 'fastify';
import { db } from '@alh/db';
import {
  campaigns,
  campaignAssignments,
} from '@alh/db/src/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { logger } from '@alh/observability';

export async function campaignsRoutes(app: FastifyInstance) {
  // GET /campaigns — list campaigns by tenant
  app.get<{
    Querystring: { page?: string; limit?: string };
  }>('/', async (request, reply) => {
    const { tenantId } = request.ctx;
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 25));
    const offset = (page - 1) * limit;

    try {
      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(campaigns)
          .where(eq(campaigns.tenantId, tenantId))
          .orderBy(desc(campaigns.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(campaigns)
          .where(eq(campaigns.tenantId, tenantId)),
      ]);

      const total = countResult[0]?.count ?? 0;

      return {
        data: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list campaigns');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve campaigns',
        statusCode: 500,
      });
    }
  });

  // POST /campaigns/assign — assign leads to a campaign
  app.post<{
    Body: {
      campaignId: number;
      canonicalLeadIds: number[];
    };
  }>('/assign', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const { campaignId, canonicalLeadIds } = request.body;

    if (!campaignId) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'campaignId is required',
        statusCode: 400,
      });
    }

    if (!Array.isArray(canonicalLeadIds) || canonicalLeadIds.length === 0) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'canonicalLeadIds must be a non-empty array',
        statusCode: 400,
      });
    }

    try {
      // Verify campaign belongs to tenant
      const [campaign] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, tenantId)))
        .limit(1);

      if (!campaign) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Campaign ${campaignId} not found`,
          statusCode: 404,
        });
      }

      const rows = canonicalLeadIds.map((leadId) => ({
        campaignId,
        canonicalLeadId: leadId,
        tenantId,
        status: 'pending' as const,
        assignedBy: userId,
      }));

      await db.insert(campaignAssignments).values(rows).onConflictDoNothing();

      logger.info(
        { tenantId, campaignId, count: canonicalLeadIds.length, userId },
        'Leads assigned to campaign',
      );
      return reply.status(201).send({
        message: `${canonicalLeadIds.length} leads assigned to campaign`,
        campaignId,
      });
    } catch (err) {
      logger.error({ err, tenantId, campaignId }, 'Failed to assign leads to campaign');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to assign leads to campaign',
        statusCode: 500,
      });
    }
  });

  // PATCH /campaigns/:id/status — update assignment status
  app.patch<{
    Params: { id: string };
    Body: { status: string };
  }>('/:id/status', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const assignmentId = parseInt(request.params.id, 10);
    const { status } = request.body;

    if (isNaN(assignmentId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid assignment ID',
        statusCode: 400,
      });
    }

    const validStatuses = ['pending', 'active', 'contacted', 'responded', 'converted', 'rejected', 'paused'];
    if (!status || !validStatuses.includes(status)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: `status is required and must be one of: ${validStatuses.join(', ')}`,
        statusCode: 400,
      });
    }

    try {
      const [existing] = await db
        .select()
        .from(campaignAssignments)
        .where(
          and(
            eq(campaignAssignments.id, assignmentId),
            eq(campaignAssignments.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Campaign assignment ${assignmentId} not found`,
          statusCode: 404,
        });
      }

      const [updated] = await db
        .update(campaignAssignments)
        .set({ status, updatedBy: userId, updatedAt: new Date() })
        .where(eq(campaignAssignments.id, assignmentId))
        .returning();

      logger.info({ tenantId, assignmentId, status, userId }, 'Campaign assignment status updated');
      return updated;
    } catch (err) {
      logger.error({ err, tenantId, assignmentId, status }, 'Failed to update assignment status');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update assignment status',
        statusCode: 500,
      });
    }
  });

  // GET /campaigns/performance — campaign performance stats
  app.get('/performance', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const stats = await db
        .select({
          campaignId: campaignAssignments.campaignId,
          status: campaignAssignments.status,
          count: sql<number>`count(*)::int`,
        })
        .from(campaignAssignments)
        .where(eq(campaignAssignments.tenantId, tenantId))
        .groupBy(campaignAssignments.campaignId, campaignAssignments.status);

      // Group by campaign
      const byCampaign: Record<number, Record<string, number>> = {};
      for (const row of stats) {
        if (!byCampaign[row.campaignId]) {
          byCampaign[row.campaignId] = {};
        }
        byCampaign[row.campaignId][row.status] = row.count;
      }

      return { data: byCampaign };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to get campaign performance');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve campaign performance',
        statusCode: 500,
      });
    }
  });
}
