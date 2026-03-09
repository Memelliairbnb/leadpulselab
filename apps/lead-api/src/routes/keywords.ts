import type { FastifyInstance } from 'fastify';
import { keywordRepo } from '@alh/db/src/repositories/keyword-repo';
import { logger } from '@alh/observability';

export async function keywordsRoutes(app: FastifyInstance) {
  // GET /keywords
  app.get('/keywords', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const keywords = await keywordRepo.findKeywordsByTenant(tenantId, false);
      return { data: keywords };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list keywords');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve keywords',
        statusCode: 500,
      });
    }
  });

  // GET /keyword-categories
  app.get('/keyword-categories', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const categories = await keywordRepo.findCategoriesByTenant(tenantId);
      return { data: categories };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list keyword categories');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve keyword categories',
        statusCode: 500,
      });
    }
  });

  // POST /keywords
  app.post<{
    Body: {
      categoryId: number;
      keyword: string;
      keywordType?: string;
      isActive?: boolean;
    };
  }>('/keywords', async (request, reply) => {
    const { tenantId } = request.ctx;
    const { categoryId, keyword, keywordType, isActive } = request.body;

    if (!categoryId || !keyword) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'categoryId and keyword are required',
        statusCode: 400,
      });
    }

    try {
      const created = await keywordRepo.createKeyword({
        tenantId,
        categoryId,
        keyword,
        keywordType: keywordType || 'phrase',
        isActive: isActive ?? true,
      });

      logger.info({ tenantId, keywordId: created.id, keyword }, 'Keyword created');
      return reply.status(201).send(created);
    } catch (err) {
      logger.error({ err, tenantId, keyword }, 'Failed to create keyword');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create keyword',
        statusCode: 500,
      });
    }
  });

  // POST /keyword-categories
  app.post<{
    Body: {
      name: string;
      description?: string;
    };
  }>('/keyword-categories', async (request, reply) => {
    const { tenantId } = request.ctx;
    const { name, description } = request.body;

    if (!name) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'name is required',
        statusCode: 400,
      });
    }

    try {
      const created = await keywordRepo.createCategory({
        tenantId,
        name,
        description: description ?? null,
      });

      logger.info({ tenantId, categoryId: created.id, name }, 'Keyword category created');
      return reply.status(201).send(created);
    } catch (err) {
      logger.error({ err, tenantId, name }, 'Failed to create keyword category');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create keyword category',
        statusCode: 500,
      });
    }
  });

  // PATCH /keywords/:id
  app.patch<{
    Params: { id: string };
    Body: {
      keyword?: string;
      keywordType?: string;
      isActive?: boolean;
      categoryId?: number;
    };
  }>('/keywords/:id', async (request, reply) => {
    const { tenantId } = request.ctx;
    const keywordId = parseInt(request.params.id, 10);

    if (isNaN(keywordId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid keyword ID',
        statusCode: 400,
      });
    }

    try {
      const updated = await keywordRepo.updateKeyword(tenantId, keywordId, request.body);

      if (!updated) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Keyword ${keywordId} not found`,
          statusCode: 404,
        });
      }

      logger.info({ tenantId, keywordId }, 'Keyword updated');
      return updated;
    } catch (err) {
      logger.error({ err, tenantId, keywordId }, 'Failed to update keyword');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update keyword',
        statusCode: 500,
      });
    }
  });
}
