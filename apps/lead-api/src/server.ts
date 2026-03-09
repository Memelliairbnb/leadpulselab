import Fastify from 'fastify';
import cors from '@fastify/cors';
import { logger } from '@alh/observability';
import { authMiddleware } from './middleware/auth';
import { leadsRoutes } from './routes/leads';
import { keywordsRoutes } from './routes/keywords';
import { sourcesRoutes } from './routes/sources';
import { jobsRoutes } from './routes/jobs';
import { analyticsRoutes } from './routes/analytics';
import { outreachRoutes } from './routes/outreach';
import { tenantsRoutes } from './routes/tenants';
import { canonicalRoutes } from './routes/canonical';
import { inventoryRoutes } from './routes/inventory';
import { discoveryRoutes } from './routes/discovery';
import { campaignsRoutes } from './routes/campaigns';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';

export function buildServer() {
  const app = Fastify({
    logger: false, // we use our own pino logger
    requestTimeout: 30_000,
  });

  // CORS
  app.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-User-Id',
      'X-User-Role',
      'X-Tenant-Id',
    ],
  });

  // Health check (no auth required)
  app.get('/health', async () => ({ status: 'ok', service: 'lead-api' }));

  // Auth routes (no bearer auth required — uses internal token in header)
  app.register(authRoutes, { prefix: '/auth' });

  // Auth middleware for all /api routes
  app.register(async function authenticatedRoutes(instance) {
    instance.addHook('onRequest', authMiddleware);

    // Register route plugins
    instance.register(leadsRoutes, { prefix: '/leads' });
    instance.register(keywordsRoutes);
    instance.register(sourcesRoutes, { prefix: '/sources' });
    instance.register(jobsRoutes);
    instance.register(analyticsRoutes, { prefix: '/analytics' });
    instance.register(outreachRoutes, { prefix: '/outreach' });
    instance.register(tenantsRoutes, { prefix: '/tenant' });
    instance.register(canonicalRoutes, { prefix: '/canonical-leads' });
    instance.register(inventoryRoutes, { prefix: '/inventory' });
    instance.register(discoveryRoutes, { prefix: '/discovery' });
    instance.register(campaignsRoutes, { prefix: '/campaigns' });
    instance.register(adminRoutes, { prefix: '/admin' });
  }, { prefix: '/api' });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error(
      { err: error, url: request.url, method: request.method },
      'Unhandled route error',
    );

    const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : (error as Error).name,
      message: statusCode >= 500 ? 'An unexpected error occurred' : (error as Error).message,
      statusCode,
    });
  });

  return app;
}
