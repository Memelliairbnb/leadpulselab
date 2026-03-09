import type { FastifyRequest, FastifyReply } from 'fastify';
import { tenantRepo } from '@alh/db/src/repositories/tenant-repo';
import { logger } from '@alh/observability';

export interface RequestContext {
  userId: number;
  userRole: string;
  tenantId: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header',
      statusCode: 401,
    });
  }

  const token = authHeader.slice(7);

  if (!INTERNAL_API_TOKEN || token !== INTERNAL_API_TOKEN) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid API token',
      statusCode: 401,
    });
  }

  const userIdHeader = request.headers['x-user-id'];
  const userRoleHeader = request.headers['x-user-role'];
  const tenantIdHeader = request.headers['x-tenant-id'];

  if (!userIdHeader || !tenantIdHeader) {
    return reply.status(400).send({
      error: 'Bad Request',
      message: 'Missing required headers: X-User-Id, X-Tenant-Id',
      statusCode: 400,
    });
  }

  const userId = parseInt(String(userIdHeader), 10);
  const tenantId = parseInt(String(tenantIdHeader), 10);
  const userRole = String(userRoleHeader || 'viewer');

  if (isNaN(userId) || isNaN(tenantId)) {
    return reply.status(400).send({
      error: 'Bad Request',
      message: 'X-User-Id and X-Tenant-Id must be valid integers',
      statusCode: 400,
    });
  }

  try {
    const membership = await tenantRepo.findMembership(userId, tenantId);

    if (!membership) {
      logger.warn({ userId, tenantId }, 'User is not a member of the requested tenant');
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'User does not have access to this tenant',
        statusCode: 403,
      });
    }

    request.ctx = {
      userId,
      userRole: membership.role || userRole,
      tenantId,
    };
  } catch (err) {
    logger.error({ err, userId, tenantId }, 'Auth middleware: failed to verify tenant membership');
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: 'Failed to verify tenant membership',
      statusCode: 500,
    });
  }
}
