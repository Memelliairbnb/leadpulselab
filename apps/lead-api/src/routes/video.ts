import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { db } from '@alh/db/src/client';
import { videoProcessingJobs } from '@alh/db/src/schema';
import { logger } from '@alh/observability';
import { enqueueVideoProcessing } from '@alh/queues';
import { eq, and, desc, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';

export async function videoRoutes(app: FastifyInstance) {
  // Register multipart support for file uploads
  app.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500 MB per file
      files: 3,
    },
  });

  // ─── POST /video/process ────────────────────────────────────────────────────
  app.post('/process', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      const parts = request.parts();

      let duration = 10;
      let musicGenre: string | null = null;
      const filePaths: string[] = [];

      // Create a temporary job ID placeholder dir
      const tmpBase = '/tmp/video-processing';
      const tmpJobDir = path.join(tmpBase, `pending-${Date.now()}`);
      fs.mkdirSync(tmpJobDir, { recursive: true });

      for await (const part of parts) {
        if (part.type === 'field') {
          if (part.fieldname === 'duration') {
            const val = parseInt(String(part.value), 10);
            if (val === 10 || val === 30) {
              duration = val;
            }
          } else if (part.fieldname === 'musicGenre') {
            musicGenre = String(part.value) || null;
          }
        } else if (part.type === 'file') {
          const safeName = part.filename?.replace(/[^a-zA-Z0-9._-]/g, '_') || `clip-${Date.now()}`;
          const dest = path.join(tmpJobDir, safeName);
          await pipeline(part.file, fs.createWriteStream(dest));
          filePaths.push(dest);
        }
      }

      // Validate clip count vs duration
      const expectedClips = duration === 30 ? 3 : 1;
      if (filePaths.length < 1) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'At least one video file is required',
          statusCode: 400,
        });
      }

      if (duration === 30 && filePaths.length < 3) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: '30-second videos require 3 clips (clip1, clip2, clip3)',
          statusCode: 400,
        });
      }

      // Create job row
      const [job] = await db
        .insert(videoProcessingJobs)
        .values({
          tenantId,
          status: 'pending',
          clipCount: filePaths.length,
          duration,
          musicGenre,
          inputUrls: filePaths,
        })
        .returning();

      // Rename temp dir to use real job ID
      const finalDir = path.join(tmpBase, String(job.id));
      fs.renameSync(tmpJobDir, finalDir);

      // Update file paths in DB to reflect final dir
      const updatedPaths = filePaths.map((fp) =>
        fp.replace(tmpJobDir, finalDir),
      );
      await db
        .update(videoProcessingJobs)
        .set({ inputUrls: updatedPaths })
        .where(eq(videoProcessingJobs.id, job.id));

      // Enqueue processing job
      await enqueueVideoProcessing({ tenantId, jobId: job.id });

      logger.info({ jobId: job.id, tenantId, duration, clips: filePaths.length }, 'Video processing job created');

      return reply.status(201).send({ id: job.id, status: 'pending' });
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to create video processing job');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create video processing job',
        statusCode: 500,
      });
    }
  });

  // ─── GET /video ─────────────────────────────────────────────────────────────
  app.get<{
    Querystring: { page?: string; limit?: string };
  }>('/', async (request, reply) => {
    const { tenantId } = request.ctx;
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    try {
      const [jobs, countResult] = await Promise.all([
        db
          .select()
          .from(videoProcessingJobs)
          .where(eq(videoProcessingJobs.tenantId, tenantId))
          .orderBy(desc(videoProcessingJobs.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(videoProcessingJobs)
          .where(eq(videoProcessingJobs.tenantId, tenantId)),
      ]);

      const total = countResult[0]?.count ?? 0;

      return reply.send({
        data: jobs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list video processing jobs');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to list video processing jobs',
        statusCode: 500,
      });
    }
  });

  // ─── GET /video/:id ─────────────────────────────────────────────────────────
  app.get<{
    Params: { id: string };
  }>('/:id', async (request, reply) => {
    const { tenantId } = request.ctx;
    const jobId = parseInt(request.params.id, 10);

    if (isNaN(jobId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid job ID',
        statusCode: 400,
      });
    }

    try {
      const [job] = await db
        .select()
        .from(videoProcessingJobs)
        .where(
          and(
            eq(videoProcessingJobs.id, jobId),
            eq(videoProcessingJobs.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!job) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Video processing job not found',
          statusCode: 404,
        });
      }

      return reply.send(job);
    } catch (err) {
      logger.error({ err, tenantId, jobId }, 'Failed to get video processing job');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get video processing job',
        statusCode: 500,
      });
    }
  });

  // ─── GET /video/:id/download ────────────────────────────────────────────────
  app.get<{
    Params: { id: string };
  }>('/:id/download', async (request, reply) => {
    const { tenantId } = request.ctx;
    const jobId = parseInt(request.params.id, 10);

    if (isNaN(jobId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid job ID',
        statusCode: 400,
      });
    }

    try {
      const [job] = await db
        .select()
        .from(videoProcessingJobs)
        .where(
          and(
            eq(videoProcessingJobs.id, jobId),
            eq(videoProcessingJobs.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!job || job.status !== 'completed' || !job.outputUrl) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Video not ready or not found',
          statusCode: 404,
        });
      }

      const outputPath = job.outputUrl;

      // If it's a URL (http/https), redirect
      if (outputPath.startsWith('http://') || outputPath.startsWith('https://')) {
        return reply.redirect(outputPath);
      }

      // If it's a local file, stream it
      if (fs.existsSync(outputPath)) {
        const stat = fs.statSync(outputPath);
        const ext = path.extname(outputPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
          '.mov': 'video/quicktime',
        };
        const contentType = mimeMap[ext] || 'application/octet-stream';

        reply.header('Content-Type', contentType);
        reply.header('Content-Length', stat.size);
        reply.header('Content-Disposition', `attachment; filename="video-${jobId}${ext}"`);

        const stream = fs.createReadStream(outputPath);
        return reply.send(stream);
      }

      return reply.status(404).send({
        error: 'Not Found',
        message: 'Output file not found',
        statusCode: 404,
      });
    } catch (err) {
      logger.error({ err, tenantId, jobId }, 'Failed to download video');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to download video',
        statusCode: 500,
      });
    }
  });
}
