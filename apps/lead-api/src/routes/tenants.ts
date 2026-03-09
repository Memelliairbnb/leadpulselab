import type { FastifyInstance } from 'fastify';
import { tenantRepo } from '@alh/db/src/repositories/tenant-repo';
import { db } from '@alh/db';
import { tenantScoringModels } from '@alh/db/src/schema';
import { verticalTemplates } from '@alh/db/src/schema/tenants';
import { eq } from 'drizzle-orm';
import { logger } from '@alh/observability';

export async function tenantsRoutes(app: FastifyInstance) {
  // GET /tenant - Current tenant info
  app.get('/', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const tenant = await tenantRepo.findById(tenantId);

      if (!tenant) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Tenant not found',
          statusCode: 404,
        });
      }

      return tenant;
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to get tenant info');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve tenant info',
        statusCode: 500,
      });
    }
  });

  // GET /tenant/lead-types
  app.get('/lead-types', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const leadTypes = await tenantRepo.findLeadTypes(tenantId);
      return { data: leadTypes };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list lead types');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve lead types',
        statusCode: 500,
      });
    }
  });

  // POST /tenant/lead-types
  app.post<{
    Body: {
      name: string;
      displayName: string;
      description?: string;
      priority?: number;
      color?: string;
    };
  }>('/lead-types', async (request, reply) => {
    const { tenantId, userRole } = request.ctx;
    const { name, displayName, description, priority, color } = request.body;

    if (!['admin', 'manager'].includes(userRole)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Only admins and managers can create lead types',
        statusCode: 403,
      });
    }

    if (!name || !displayName) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'name and displayName are required',
        statusCode: 400,
      });
    }

    try {
      const created = await tenantRepo.createLeadType({
        tenantId,
        name,
        displayName,
        description: description ?? null,
        priority: priority ?? 0,
        color: color ?? null,
      });

      logger.info({ tenantId, leadTypeId: created.id, name }, 'Lead type created');
      return reply.status(201).send(created);
    } catch (err) {
      logger.error({ err, tenantId, name }, 'Failed to create lead type');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create lead type',
        statusCode: 500,
      });
    }
  });

  // GET /tenant/ai-config
  app.get('/ai-config', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const config = await tenantRepo.findAiConfig(tenantId);
      return config ?? { tenantId, industryContext: '', classificationInstructions: null, scoringInstructions: null, outreachInstructions: null, exampleSignalsJson: [], irrelevantSignalsJson: [] };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to get AI config');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve AI config',
        statusCode: 500,
      });
    }
  });

  // PUT /tenant/ai-config
  app.put<{
    Body: {
      industryContext?: string;
      classificationInstructions?: string | null;
      scoringInstructions?: string | null;
      outreachInstructions?: string | null;
      exampleSignalsJson?: string[];
      irrelevantSignalsJson?: string[];
    };
  }>('/ai-config', async (request, reply) => {
    const { tenantId, userRole } = request.ctx;

    if (!['admin', 'manager'].includes(userRole)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Only admins and managers can update AI config',
        statusCode: 403,
      });
    }

    try {
      const updated = await tenantRepo.upsertAiConfig(tenantId, request.body);
      logger.info({ tenantId }, 'AI config updated');
      return updated;
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to update AI config');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update AI config',
        statusCode: 500,
      });
    }
  });

  // GET /tenant/scoring
  app.get('/scoring', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const model = await tenantRepo.findActiveScoringModel(tenantId);

      if (!model) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'No active scoring model found',
          statusCode: 404,
        });
      }

      return model;
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to get scoring config');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve scoring config',
        statusCode: 500,
      });
    }
  });

  // PUT /tenant/scoring
  app.put<{
    Body: {
      claudeWeight?: number;
      rulesWeight?: number;
      hotThreshold?: number;
      strongThreshold?: number;
      nurtureThreshold?: number;
      signals?: Array<{
        signalKey: string;
        signalPattern: string;
        weight: number;
        description?: string;
        isActive?: boolean;
      }>;
    };
  }>('/scoring', async (request, reply) => {
    const { tenantId, userRole } = request.ctx;

    if (!['admin', 'manager'].includes(userRole)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Only admins and managers can update scoring config',
        statusCode: 403,
      });
    }

    try {
      // For now, return the body back as acknowledgement.
      // Full scoring model update would require a dedicated repo method.
      const model = await tenantRepo.findActiveScoringModel(tenantId);

      if (!model) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'No active scoring model found. Apply a template first.',
          statusCode: 404,
        });
      }

      // Update model thresholds via direct DB call (tenantRepo could be extended)
      const updateData: Record<string, unknown> = {};
      if (request.body.claudeWeight !== undefined) updateData.claudeWeight = String(request.body.claudeWeight);
      if (request.body.rulesWeight !== undefined) updateData.rulesWeight = String(request.body.rulesWeight);
      if (request.body.hotThreshold !== undefined) updateData.hotThreshold = request.body.hotThreshold;
      if (request.body.strongThreshold !== undefined) updateData.strongThreshold = request.body.strongThreshold;
      if (request.body.nurtureThreshold !== undefined) updateData.nurtureThreshold = request.body.nurtureThreshold;

      if (Object.keys(updateData).length > 0) {
        await db
          .update(tenantScoringModels)
          .set(updateData)
          .where(eq(tenantScoringModels.id, model.id));
      }

      const updatedModel = await tenantRepo.findActiveScoringModel(tenantId);
      logger.info({ tenantId, modelId: model.id }, 'Scoring config updated');
      return updatedModel;
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to update scoring config');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update scoring config',
        statusCode: 500,
      });
    }
  });

  // GET /tenant/outreach-templates
  app.get('/outreach-templates', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const templates = await tenantRepo.findOutreachTemplates(tenantId);
      return { data: templates };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list outreach templates');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve outreach templates',
        statusCode: 500,
      });
    }
  });

  // POST /tenant/apply-template - Apply a vertical template to the tenant
  app.post<{
    Body: { templateName: string };
  }>('/apply-template', async (request, reply) => {
    const { tenantId, userRole } = request.ctx;
    const { templateName } = request.body;

    if (!['admin'].includes(userRole)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Only admins can apply templates',
        statusCode: 403,
      });
    }

    if (!templateName) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'templateName is required',
        statusCode: 400,
      });
    }

    try {
      // Load the template from the vertical-templates config
      const [template] = await db
        .select()
        .from(verticalTemplates)
        .where(eq(verticalTemplates.name, templateName))
        .limit(1);

      if (!template) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Template "${templateName}" not found`,
          statusCode: 404,
        });
      }

      const config = template.configJson as {
        leadTypes?: Array<{ name: string; displayName: string; description: string; priority: number; color: string }>;
        aiConfig?: { industryContext: string; classificationInstructions: string | null; exampleSignals: string[]; irrelevantSignals: string[] };
      };

      // Apply lead types
      if (config.leadTypes) {
        for (const lt of config.leadTypes) {
          try {
            await tenantRepo.createLeadType({
              tenantId,
              name: lt.name,
              displayName: lt.displayName,
              description: lt.description,
              priority: lt.priority,
              color: lt.color,
            });
          } catch {
            // Ignore duplicates (unique constraint)
          }
        }
      }

      // Apply AI config
      if (config.aiConfig) {
        await tenantRepo.upsertAiConfig(tenantId, {
          industryContext: config.aiConfig.industryContext,
          classificationInstructions: config.aiConfig.classificationInstructions,
          exampleSignalsJson: config.aiConfig.exampleSignals,
          irrelevantSignalsJson: config.aiConfig.irrelevantSignals,
        });
      }

      logger.info({ tenantId, templateName }, 'Vertical template applied');
      return { message: `Template "${templateName}" applied successfully`, templateName };
    } catch (err) {
      logger.error({ err, tenantId, templateName }, 'Failed to apply template');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to apply template',
        statusCode: 500,
      });
    }
  });
}
