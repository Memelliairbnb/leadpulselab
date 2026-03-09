import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { platformSources } from './sources';
import { users } from './users';

export const scanJobs = pgTable(
  'scan_jobs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    sourceId: integer('source_id').notNull().references(() => platformSources.id),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    triggerType: varchar('trigger_type', { length: 20 }).notNull().default('scheduled'),
    triggeredBy: integer('triggered_by').references(() => users.id),
    keywordsUsed: jsonb('keywords_used').default([]),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    resultsCount: integer('results_count').default(0),
    leadsFound: integer('leads_found').default(0),
    errorMessage: text('error_message'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_scan_jobs_tenant').on(table.tenantId),
    index('idx_scan_jobs_status').on(table.status),
    index('idx_scan_jobs_source').on(table.sourceId),
    index('idx_scan_jobs_created').on(table.createdAt),
  ],
);

export const jobRuns = pgTable(
  'job_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    jobType: varchar('job_type', { length: 50 }).notNull(),
    queueName: varchar('queue_name', { length: 100 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    inputJson: jsonb('input_json').default({}),
    outputJson: jsonb('output_json').default({}),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_job_runs_type').on(table.jobType),
    index('idx_job_runs_status').on(table.status),
    index('idx_job_runs_created').on(table.createdAt),
    index('idx_job_runs_idempotency').on(table.idempotencyKey),
  ],
);
