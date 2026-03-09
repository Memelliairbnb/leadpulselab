import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '@alh/db/src/client';
import { users } from '@alh/db/src/schema/users';
import { tenantMembers, tenants } from '@alh/db/src/schema/tenants';
import { eq, and } from 'drizzle-orm';
import { logger } from '@alh/observability';

const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN;

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login — called by NextAuth CredentialsProvider
  app.post<{
    Body: { email: string; password: string };
  }>('/login', async (request, reply) => {
    const internalToken = request.headers['x-internal-token'] as string | undefined;

    if (!INTERNAL_API_TOKEN || internalToken !== INTERNAL_API_TOKEN) {
      logger.warn('Auth login: invalid or missing internal token');
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid internal token',
        statusCode: 401,
      });
    }

    const { email, password } = request.body || {};

    if (!email || !password) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Email and password are required',
        statusCode: 400,
      });
    }

    try {
      // Find user by email
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase().trim()))
        .limit(1);

      if (!user) {
        logger.info({ email }, 'Auth login: user not found');
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid email or password',
          statusCode: 401,
        });
      }

      if (!user.isActive) {
        logger.info({ email }, 'Auth login: user is inactive');
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Account is disabled',
          statusCode: 401,
        });
      }

      // Verify password
      const passwordValid = await bcrypt.compare(password, user.passwordHash);
      if (!passwordValid) {
        logger.info({ email }, 'Auth login: invalid password');
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid email or password',
          statusCode: 401,
        });
      }

      // Get first tenant membership
      const memberships = await db
        .select({
          tenantId: tenantMembers.tenantId,
          role: tenantMembers.role,
          tenantName: tenants.name,
        })
        .from(tenantMembers)
        .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
        .where(
          and(
            eq(tenantMembers.userId, user.id),
            eq(tenants.isActive, true),
          ),
        )
        .limit(1);

      if (memberships.length === 0) {
        logger.warn({ userId: user.id }, 'Auth login: no tenant membership');
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'No active tenant membership',
          statusCode: 403,
        });
      }

      const membership = memberships[0];

      logger.info({ userId: user.id, tenantId: membership.tenantId }, 'Auth login: success');

      return reply.send({
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        tenantId: membership.tenantId,
        role: membership.role,
        tenantName: membership.tenantName,
      });
    } catch (err) {
      logger.error({ err, email }, 'Auth login: unexpected error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        statusCode: 500,
      });
    }
  });
}
