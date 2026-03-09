import type { FastifyInstance } from 'fastify';
import { leadRepo } from '@alh/db/src/repositories/lead-repo';
import { enqueueOutreachGeneration } from '@alh/queues';
import { logger } from '@alh/observability';

export async function outreachRoutes(app: FastifyInstance) {
  // POST /outreach/:id/regenerate - Regenerate outreach for a lead
  app.post<{
    Params: { id: string };
  }>('/:id/regenerate', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const leadId = parseInt(request.params.id, 10);

    if (isNaN(leadId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid lead ID',
        statusCode: 400,
      });
    }

    try {
      // Verify lead exists and belongs to tenant
      const lead = await leadRepo.findById(tenantId, leadId);

      if (!lead) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Lead ${leadId} not found`,
          statusCode: 404,
        });
      }

      // Enqueue outreach regeneration
      await enqueueOutreachGeneration({
        tenantId,
        qualifiedLeadId: leadId,
      });

      logger.info({ tenantId, leadId, userId }, 'Outreach regeneration queued');

      return { message: 'Outreach regeneration queued', leadId };
    } catch (err) {
      logger.error({ err, tenantId, leadId }, 'Failed to queue outreach regeneration');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to queue outreach regeneration',
        statusCode: 500,
      });
    }
  });
}
