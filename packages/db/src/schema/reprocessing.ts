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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

// =====================================================
// PIPELINE VERSIONS — track versions of parsing/enrichment/scoring pipelines
// =====================================================

export const pipelineVersions = pgTable(
  'pipeline_versions',
  {
    id: serial('id').primaryKey(),
    pipelineType: varchar('pipeline_type', { length: 30 }),
    // 'parser', 'enricher', 'scorer', 'classifier', 'scrubber'
    version: varchar('version', { length: 20 }).notNull(),
    description: text('description'),
    changesJson: jsonb('changes_json').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_pipeline_versions_type_version').on(table.pipelineType, table.version),
  ],
);

// =====================================================
// REPROCESSING RUNS — batch reprocessing jobs
// =====================================================

export const reprocessingRuns = pgTable(
  'reprocessing_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    runType: varchar('run_type', { length: 30 }),
    // 'full_reparse', 'enrichment_upgrade', 'scoring_recalc', 'pipeline_upgrade'
    targetTable: varchar('target_table', { length: 50 }),
    filterCriteriaJson: jsonb('filter_criteria_json').notNull().default({}),
    pipelineVersionId: integer('pipeline_version_id').references(() => pipelineVersions.id),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // 'pending', 'running', 'completed', 'failed'
    totalRecords: integer('total_records').notNull().default(0),
    processedRecords: integer('processed_records').notNull().default(0),
    updatedRecords: integer('updated_records').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

// =====================================================
// ENRICHMENT VERSIONS — track enrichment data provider versions
// =====================================================

export const enrichmentVersions = pgTable(
  'enrichment_versions',
  {
    id: serial('id').primaryKey(),
    providerName: varchar('provider_name', { length: 50 }).notNull(),
    version: varchar('version', { length: 20 }).notNull(),
    capabilitiesJson: jsonb('capabilities_json').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
