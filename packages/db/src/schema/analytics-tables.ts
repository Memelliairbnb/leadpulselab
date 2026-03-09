import {
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  date,
  numeric,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

// ---------------------------------------------------------------------------
// Pre-computed summary / analytics tables
// ---------------------------------------------------------------------------

export const tenantDashboardDailyStats = pgTable(
  'tenant_dashboard_daily_stats',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    statDate: date('stat_date').notNull(),
    leadsDiscovered: integer('leads_discovered').notNull().default(0),
    leadsQualified: integer('leads_qualified').notNull().default(0),
    leadsContacted: integer('leads_contacted').notNull().default(0),
    repliesReceived: integer('replies_received').notNull().default(0),
    conversions: integer('conversions').notNull().default(0),
    hotLeadsCount: integer('hot_leads_count').notNull().default(0),
    warmLeadsCount: integer('warm_leads_count').notNull().default(0),
    agedLeadsCount: integer('aged_leads_count').notNull().default(0),
    outreachDraftsGenerated: integer('outreach_drafts_generated').notNull().default(0),
    outreachApproved: integer('outreach_approved').notNull().default(0),
    scanJobsCompleted: integer('scan_jobs_completed').notNull().default(0),
    scanJobsFailed: integer('scan_jobs_failed').notNull().default(0),
    agentRunsTotal: integer('agent_runs_total').notNull().default(0),
    agentCostCents: integer('agent_cost_cents').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_tenant_dashboard_daily').on(table.tenantId, table.statDate),
  ],
);

export const sourceHealthDailyStats = pgTable(
  'source_health_daily_stats',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    sourceId: integer('source_id').notNull(),
    statDate: date('stat_date').notNull(),
    fetchCount: integer('fetch_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    leadsFound: integer('leads_found').notNull().default(0),
    duplicateRate: numeric('duplicate_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    enrichmentSuccessRate: numeric('enrichment_success_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    avgLeadScore: numeric('avg_lead_score', { precision: 5, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_source_health_daily').on(table.sourceId, table.statDate),
  ],
);

export const campaignPerformanceDaily = pgTable(
  'campaign_performance_daily',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    campaignName: varchar('campaign_name', { length: 100 }),
    statDate: date('stat_date').notNull(),
    leadsAssigned: integer('leads_assigned').notNull().default(0),
    contactsMade: integer('contacts_made').notNull().default(0),
    repliesReceived: integer('replies_received').notNull().default(0),
    conversions: integer('conversions').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_campaign_performance_daily').on(
      table.tenantId,
      table.campaignName,
      table.statDate,
    ),
  ],
);

// NOTE: This table stores periodic snapshots. Consider partitioning by
// snapshot_at range in production if the volume becomes significant.
export const inventoryCountsBySegment = pgTable(
  'inventory_counts_by_segment',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id'),
    segmentName: varchar('segment_name', { length: 100 }),
    temperature: varchar('temperature', { length: 10 }),
    leadCount: integer('lead_count').notNull().default(0),
    avgValueScore: numeric('avg_value_score', { precision: 5, scale: 2 }).notNull().default('0'),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
