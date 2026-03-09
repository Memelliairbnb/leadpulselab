import type { FastifyInstance } from 'fastify';
import { sourceRepo } from '@alh/db/src/repositories/source-repo';
import { logger } from '@alh/observability';

export async function sourcesRoutes(app: FastifyInstance) {
  // GET /sources
  app.get('/', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const sources = await sourceRepo.findByTenant(tenantId);
      return { data: sources };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list sources');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve sources',
        statusCode: 500,
      });
    }
  });

  // PATCH /sources/:id
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      isEnabled?: boolean;
      configJson?: Record<string, unknown>;
      rateLimitRpm?: number;
    };
  }>('/:id', async (request, reply) => {
    const { tenantId } = request.ctx;
    const sourceId = parseInt(request.params.id, 10);

    if (isNaN(sourceId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid source ID',
        statusCode: 400,
      });
    }

    try {
      const updated = await sourceRepo.update(tenantId, sourceId, request.body);

      if (!updated) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Source ${sourceId} not found`,
          statusCode: 404,
        });
      }

      logger.info({ tenantId, sourceId }, 'Source updated');
      return updated;
    } catch (err) {
      logger.error({ err, tenantId, sourceId }, 'Failed to update source');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update source',
        statusCode: 500,
      });
    }
  });
}
