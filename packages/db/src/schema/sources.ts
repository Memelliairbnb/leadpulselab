import {
  pgTable,
  serial,
  varchar,
  boolean,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const platformSources = pgTable(
  'platform_sources',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    name: varchar('name', { length: 100 }).notNull(),
    sourceType: varchar('source_type', { length: 50 }).notNull(),
    adapterKey: varchar('adapter_key', { length: 100 }).notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    configJson: jsonb('config_json').default({}),
    rateLimitRpm: integer('rate_limit_rpm').default(60),
    lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
    errorCount: integer('error_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_platform_sources_tenant').on(table.tenantId),
  ],
);

export const rawSources = pgTable(
  'raw_sources',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    scanJobId: integer('scan_job_id').notNull(),  // references scanJobs.id
    sourceName: varchar('source_name', { length: 100 }).notNull(),
    sourceType: varchar('source_type', { length: 50 }).notNull(),
    sourceUrl: text('source_url').notNull(),
    fetchMethod: varchar('fetch_method', { length: 50 }).notNull(),
    sourcePayloadJson: jsonb('source_payload_json').notNull(),
    checksumHash: varchar('checksum_hash', { length: 64 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_raw_sources_checksum').on(table.checksumHash),
    index('idx_raw_sources_scan_job').on(table.scanJobId),
    index('idx_raw_sources_tenant').on(table.tenantId),
  ],
);

export const sourceErrors = pgTable(
  'source_errors',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    sourceId: integer('source_id').references(() => platformSources.id),
    scanJobId: integer('scan_job_id'),
    errorType: varchar('error_type', { length: 50 }).notNull(),
    errorMessage: text('error_message').notNull(),
    errorContext: jsonb('error_context').default({}),
    resolved: boolean('resolved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_source_errors_source').on(table.sourceId),
    index('idx_source_errors_unresolved').on(table.resolved),
  ],
);
