import type { FastifyInstance } from 'fastify';
import { leadRepo } from '@alh/db/src/repositories/lead-repo';
import { outreachRepo } from '@alh/db/src/repositories/outreach-repo';
import { enqueueOutreachGeneration, enqueueLeadAnalysis } from '@alh/queues';
import { logger } from '@alh/observability';
import { db } from '@alh/db/src/client';
import { rawLeads } from '@alh/db/src/schema';
import type { LeadFilters } from '@alh/types';
import { createHash } from 'crypto';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

export async function leadsRoutes(app: FastifyInstance) {
  // POST /leads/manual — create a lead from manual entry
  app.post<{
    Body: {
      fullName?: string;
      email?: string;
      phone?: string;
      platform?: string;
      sourceUrl?: string;
      rawText?: string;
      notes?: string;
    };
  }>('/manual', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const { fullName, email, phone, platform, sourceUrl, rawText, notes } = request.body;

    if (!fullName?.trim() && !email?.trim()) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'At least a name or email is required',
        statusCode: 400,
      });
    }

    const textContent = rawText?.trim() || `Manual lead: ${fullName || email}`;
    const textHash = createHash('sha256').update(textContent + Date.now()).digest('hex').slice(0, 64);

    try {
      // Create a raw_lead record
      const [raw] = await db
        .insert(rawLeads)
        .values({
          tenantId,
          rawSourceId: 0, // sentinel for manual entry
          platform: platform || 'manual',
          profileName: fullName || null,
          profileUrl: null,
          sourceUrl: sourceUrl?.trim() || 'manual-entry',
          matchedKeywords: [],
          rawText: textContent,
          rawMetadataJson: {
            source: 'manual_entry',
            enteredBy: userId,
            email: email || null,
            phone: phone || null,
            notes: notes || null,
          },
          textHash,
          isProcessed: false,
          processingStatus: 'pending',
        })
        .returning();

      // Queue for AI analysis
      await enqueueLeadAnalysis({ tenantId, rawLeadId: raw.id });

      logger.info({ tenantId, rawLeadId: raw.id, userId }, 'Manual lead created and queued for analysis');

      return reply.status(201).send({
        message: 'Lead created and queued for AI analysis',
        rawLeadId: raw.id,
      });
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to create manual lead');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create lead',
        statusCode: 500,
      });
    }
  });

  // POST /leads/webhook — accepts external lead data via webhook
  app.post<{
    Body: {
      fullName?: string;
      email?: string;
      phone?: string;
      platform?: string;
      sourceUrl?: string;
      rawText?: string;
      notes?: string;
    };
  }>('/webhook', async (request, reply) => {
    // Webhook auth: check X-Webhook-Key header
    const webhookKey = request.headers['x-webhook-key'];

    if (!WEBHOOK_SECRET || webhookKey !== WEBHOOK_SECRET) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or missing X-Webhook-Key header',
        statusCode: 401,
      });
    }

    // For webhooks, tenantId comes from the auth context
    const { tenantId } = request.ctx;
    const { fullName, email, phone, platform, sourceUrl, rawText, notes } = request.body;

    if (!fullName?.trim() && !email?.trim() && !rawText?.trim()) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'At least a name, email, or rawText is required',
        statusCode: 400,
      });
    }

    const textContent = rawText?.trim() || `Webhook lead: ${fullName || email}`;
    const textHash = createHash('sha256').update(textContent + Date.now()).digest('hex').slice(0, 64);

    try {
      const [raw] = await db
        .insert(rawLeads)
        .values({
          tenantId,
          rawSourceId: 0,
          platform: platform || 'webhook',
          profileName: fullName || null,
          profileUrl: null,
          sourceUrl: sourceUrl?.trim() || 'webhook-intake',
          matchedKeywords: [],
          rawText: textContent,
          rawMetadataJson: {
            source: 'webhook',
            email: email || null,
            phone: phone || null,
            notes: notes || null,
          },
          textHash,
          isProcessed: false,
          processingStatus: 'pending',
        })
        .returning();

      await enqueueLeadAnalysis({ tenantId, rawLeadId: raw.id });

      logger.info({ tenantId, rawLeadId: raw.id }, 'Webhook lead created and queued for analysis');

      return reply.status(201).send({
        message: 'Lead created and queued for AI analysis',
        rawLeadId: raw.id,
      });
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to create webhook lead');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create lead',
        statusCode: 500,
      });
    }
  });

  // GET /leads - List with filters
  app.get<{
    Querystring: LeadFilters;
  }>('/', async (request, reply) => {
    const { tenantId } = request.ctx;
    const filters: LeadFilters = {
      status: request.query.status,
      leadType: request.query.leadType,
      intentLevel: request.query.intentLevel,
      platform: request.query.platform,
      minScore: request.query.minScore ? Number(request.query.minScore) : undefined,
      maxScore: request.query.maxScore ? Number(request.query.maxScore) : undefined,
      assignedTo: request.query.assignedTo ? Number(request.query.assignedTo) : undefined,
      resolutionStatus: request.query.resolutionStatus,
      resolutionTab: request.query.resolutionTab,
      needsReview: request.query.needsReview,
      isDuplicate: request.query.isDuplicate,
      search: request.query.search,
      page: request.query.page ? Number(request.query.page) : 1,
      limit: request.query.limit ? Number(request.query.limit) : 25,
      sortBy: request.query.sortBy,
      sortOrder: request.query.sortOrder,
    };

    try {
      const result = await leadRepo.findMany(tenantId, filters);
      return result;
    } catch (err) {
      logger.error({ err, tenantId, filters }, 'Failed to list leads');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve leads',
        statusCode: 500,
      });
    }
  });

  // GET /leads/:id - Lead detail
  app.get<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const { tenantId } = request.ctx;
    const leadId = parseInt(request.params.id, 10);

    if (isNaN(leadId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid lead ID',
        statusCode: 400,
      });
    }

    try {
      const lead = await leadRepo.findByIdWithDetails(tenantId, leadId);

      if (!lead) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Lead ${leadId} not found`,
          statusCode: 404,
        });
      }

      // Attach outreach drafts
      const drafts = await outreachRepo.findDraftsByLead(leadId);

      return { ...lead, outreachDrafts: drafts };
    } catch (err) {
      logger.error({ err, tenantId, leadId }, 'Failed to get lead detail');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve lead',
        statusCode: 500,
      });
    }
  });

  // PATCH /leads/:id/status
  app.patch<{
    Params: { id: string };
    Body: { status: string };
  }>('/:id/status', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const leadId = parseInt(request.params.id, 10);
    const { status } = request.body;

    if (isNaN(leadId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid lead ID',
        statusCode: 400,
      });
    }

    if (!status) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Status is required',
        statusCode: 400,
      });
    }

    const validStatuses = ['new', 'reviewing', 'approved', 'outreach_sent', 'nurturing', 'converted', 'archived'];
    if (!validStatuses.includes(status)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        statusCode: 400,
      });
    }

    try {
      const updated = await leadRepo.updateStatus(tenantId, leadId, status, userId);

      if (!updated) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Lead ${leadId} not found`,
          statusCode: 404,
        });
      }

      logger.info({ tenantId, leadId, status, userId }, 'Lead status updated');
      return updated;
    } catch (err) {
      logger.error({ err, tenantId, leadId, status }, 'Failed to update lead status');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update lead status',
        statusCode: 500,
      });
    }
  });

  // PATCH /leads/:id/assign
  app.patch<{
    Params: { id: string };
    Body: { assignToUserId: number };
  }>('/:id/assign', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const leadId = parseInt(request.params.id, 10);
    const { assignToUserId } = request.body;

    if (isNaN(leadId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid lead ID',
        statusCode: 400,
      });
    }

    if (!assignToUserId || typeof assignToUserId !== 'number') {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'assignToUserId is required and must be a number',
        statusCode: 400,
      });
    }

    try {
      const updated = await leadRepo.assign(tenantId, leadId, assignToUserId, userId);

      if (!updated) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Lead ${leadId} not found`,
          statusCode: 404,
        });
      }

      logger.info({ tenantId, leadId, assignToUserId, performedBy: userId }, 'Lead assigned');
      return updated;
    } catch (err) {
      logger.error({ err, tenantId, leadId, assignToUserId }, 'Failed to assign lead');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to assign lead',
        statusCode: 500,
      });
    }
  });

  // POST /leads/:id/approve-outreach
  app.post<{
    Params: { id: string };
    Body: { draftId: number };
  }>('/:id/approve-outreach', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const leadId = parseInt(request.params.id, 10);
    const { draftId } = request.body;

    if (isNaN(leadId) || !draftId) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Valid lead ID and draftId are required',
        statusCode: 400,
      });
    }

    try {
      const approved = await outreachRepo.approveDraft(tenantId, draftId, userId);

      if (!approved) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Draft ${draftId} not found`,
          statusCode: 404,
        });
      }

      logger.info({ tenantId, leadId, draftId, userId }, 'Outreach draft approved');
      return approved;
    } catch (err) {
      logger.error({ err, tenantId, leadId, draftId }, 'Failed to approve outreach');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to approve outreach draft',
        statusCode: 500,
      });
    }
  });

  // POST /leads/:id/reject-outreach
  app.post<{
    Params: { id: string };
    Body: { draftId: number; reason: string };
  }>('/:id/reject-outreach', async (request, reply) => {
    const { tenantId, userId } = request.ctx;
    const leadId = parseInt(request.params.id, 10);
    const { draftId, reason } = request.body;

    if (isNaN(leadId) || !draftId) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Valid lead ID and draftId are required',
        statusCode: 400,
      });
    }

    if (!reason) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'A rejection reason is required',
        statusCode: 400,
      });
    }

    try {
      const rejected = await outreachRepo.rejectDraft(tenantId, draftId, userId, reason);

      if (!rejected) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Draft ${draftId} not found`,
          statusCode: 404,
        });
      }

      // Enqueue a regeneration so the user gets a new draft automatically
      await enqueueOutreachGeneration({ tenantId, qualifiedLeadId: leadId });

      logger.info({ tenantId, leadId, draftId, userId, reason }, 'Outreach draft rejected, regeneration queued');
      return rejected;
    } catch (err) {
      logger.error({ err, tenantId, leadId, draftId }, 'Failed to reject outreach');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to reject outreach draft',
        statusCode: 500,
      });
    }
  });
}
