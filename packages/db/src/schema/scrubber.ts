import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  numeric,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { canonicalLeads } from './canonical';

export const scrubRuns = pgTable(
  'scrub_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    runType: varchar('run_type', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    inputCount: integer('input_count').notNull().default(0),
    newLeadsCount: integer('new_leads_count').notNull().default(0),
    mergedCount: integer('merged_count').notNull().default(0),
    suppressedCount: integer('suppressed_count').notNull().default(0),
    reviewCount: integer('review_count').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const duplicateCandidates = pgTable(
  'duplicate_candidates',
  {
    id: serial('id').primaryKey(),
    scrubRunId: integer('scrub_run_id')
      .notNull()
      .references(() => scrubRuns.id, { onDelete: 'cascade' }),
    rawLeadId: integer('raw_lead_id').notNull(),
    existingCanonicalId: integer('existing_canonical_id')
      .references(() => canonicalLeads.id),
    existingIdentityId: integer('existing_identity_id'),
    matchMethod: varchar('match_method', { length: 30 }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    evidenceJson: jsonb('evidence_json').default({}),
    resolution: varchar('resolution', { length: 20 }).notNull().default('pending'),
    resolvedBy: varchar('resolved_by', { length: 20 }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_duplicate_candidates_run').on(table.scrubRunId),
    index('idx_duplicate_candidates_raw_lead').on(table.rawLeadId),
    index('idx_duplicate_candidates_canonical').on(table.existingCanonicalId),
    index('idx_duplicate_candidates_resolution').on(table.resolution),
  ],
);

export const identityMerges = pgTable(
  'identity_merges',
  {
    id: serial('id').primaryKey(),
    primaryCanonicalId: integer('primary_canonical_id')
      .notNull()
      .references(() => canonicalLeads.id),
    mergedCanonicalId: integer('merged_canonical_id')
      .notNull()
      .references(() => canonicalLeads.id),
    mergeReason: varchar('merge_reason', { length: 50 }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    mergedFieldsJson: jsonb('merged_fields_json').default({}),
    mergedBy: varchar('merged_by', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const mergeDecisions = pgTable(
  'merge_decisions',
  {
    id: serial('id').primaryKey(),
    duplicateCandidateId: integer('duplicate_candidate_id')
      .notNull()
      .references(() => duplicateCandidates.id, { onDelete: 'cascade' }),
    decision: varchar('decision', { length: 20 }).notNull(),
    reason: text('reason'),
    decidedBy: integer('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const suppressionLogs = pgTable(
  'suppression_logs',
  {
    id: serial('id').primaryKey(),
    scrubRunId: integer('scrub_run_id')
      .notNull()
      .references(() => scrubRuns.id, { onDelete: 'cascade' }),
    rawLeadId: integer('raw_lead_id').notNull(),
    canonicalLeadId: integer('canonical_lead_id')
      .notNull()
      .references(() => canonicalLeads.id),
    matchMethod: varchar('match_method', { length: 30 }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_suppression_logs_canonical').on(table.canonicalLeadId),
    index('idx_suppression_logs_raw_lead').on(table.rawLeadId),
  ],
);
