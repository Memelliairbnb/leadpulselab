import type { FastifyInstance } from 'fastify';
import { jobRepo } from '@alh/db/src/repositories/job-repo';
import { sourceRepo } from '@alh/db/src/repositories/source-repo';
import { keywordRepo } from '@alh/db/src/repositories/keyword-repo';
import { enqueueSourceScan } from '@alh/queues';
import { logger } from '@alh/observability';

export async function jobsRoutes(app: FastifyInstance) {
  // GET /scan-jobs
  app.get<{
    Querystring: { limit?: string };
  }>('/scan-jobs', async (request, reply) => {
    const { tenantId } = request.ctx;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

    try {
      const scanJobs = await jobRepo.findScanJobsByTenant(tenantId, limit);
      return { data: scanJobs };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list scan jobs');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve scan jobs',
        statusCode: 500,
      });
    }
  });

  // POST /scan-jobs/run - Trigger a manual scan
  app.post<{
    Body: { sourceId: number };
  }>('/scan-jobs/run', async (request, reply) => {
    const { tenantId, userId, userRole } = request.ctx;
    const { sourceId } = request.body;

    if (!sourceId) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'sourceId is required',
        statusCode: 400,
      });
    }

    // Only admins and managers can trigger manual scans
    if (!['admin', 'manager'].includes(userRole)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Only admins and managers can trigger manual scans',
        statusCode: 403,
      });
    }

    try {
      // Verify source belongs to tenant and is enabled
      const source = await sourceRepo.findById(tenantId, sourceId);
      if (!source) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Source ${sourceId} not found`,
          statusCode: 404,
        });
      }

      if (!source.isEnabled) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Source is disabled. Enable it before running a scan.',
          statusCode: 400,
        });
      }

      // Fetch active keywords for this tenant
      const keywords = await keywordRepo.findKeywordsByTenant(tenantId, true);
      const keywordStrings = keywords.map((k) => k.keyword);

      if (keywordStrings.length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'No active keywords configured. Add keywords before scanning.',
          statusCode: 400,
        });
      }

      // Create scan job record
      const scanJob = await jobRepo.createScanJob({
        tenantId,
        sourceId,
        status: 'pending',
        triggerType: 'manual',
        triggeredBy: userId,
        keywordsUsed: keywordStrings,
      });

      // Enqueue the scan
      await enqueueSourceScan({
        tenantId,
        scanJobId: scanJob.id,
        sourceId,
        keywords: keywordStrings,
      });

      logger.info(
        { tenantId, scanJobId: scanJob.id, sourceId, keywordCount: keywordStrings.length },
        'Manual scan job created and enqueued',
      );

      return reply.status(201).send(scanJob);
    } catch (err) {
      logger.error({ err, tenantId, sourceId }, 'Failed to trigger manual scan');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to trigger scan job',
        statusCode: 500,
      });
    }
  });

  // GET /jobs - List job runs
  app.get<{
    Querystring: { limit?: string };
  }>('/jobs', async (request, reply) => {
    const { tenantId } = request.ctx;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

    try {
      const jobRuns = await jobRepo.findJobRunsByTenant(tenantId, limit);
      return { data: jobRuns };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list job runs');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve job runs',
        statusCode: 500,
      });
    }
  });
}
