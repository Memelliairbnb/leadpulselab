import {
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { canonicalLeads } from './canonical';

// ---------------------------------------------------------------------------
// Lead Lifecycle & Events Layer
// ---------------------------------------------------------------------------

// NOTE: In production this table should be PARTITION BY RANGE (created_at)
// to keep event queries fast as volume grows. Create monthly or weekly
// partitions via a cron or migration script.
export const leadLifecycleEvents = pgTable(
  'lead_lifecycle_events',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    canonicalLeadId: integer('canonical_lead_id')
      .notNull()
      .references(() => canonicalLeads.id),
    fromState: varchar('from_state', { length: 30 }),
    toState: varchar('to_state', { length: 30 }).notNull(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    triggeredBy: varchar('triggered_by', { length: 20 }).notNull(),
    triggeredById: integer('triggered_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lifecycle_events_canonical').on(table.canonicalLeadId),
    index('idx_lifecycle_events_tenant').on(table.tenantId),
    index('idx_lifecycle_events_type').on(table.eventType),
    index('idx_lifecycle_events_to_state').on(table.toState),
    index('idx_lifecycle_events_created').on(table.createdAt),
  ],
);

export const campaignAssignments = pgTable(
  'campaign_assignments',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    canonicalLeadId: integer('canonical_lead_id')
      .notNull()
      .references(() => canonicalLeads.id),
    campaignName: varchar('campaign_name', { length: 100 }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    status: varchar('status', { length: 20 }).notNull().default('assigned'),
    contactedAt: timestamp('contacted_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removalReason: varchar('removal_reason', { length: 50 }),
  },
  (table) => [
    index('idx_campaign_assignments_tenant').on(table.tenantId),
    index('idx_campaign_assignments_canonical').on(table.canonicalLeadId),
    index('idx_campaign_assignments_status').on(table.status),
    index('idx_campaign_assignments_campaign').on(table.campaignName),
  ],
);

export const pipelineHistory = pgTable(
  'pipeline_history',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    canonicalLeadId: integer('canonical_lead_id')
      .notNull()
      .references(() => canonicalLeads.id),
    stage: varchar('stage', { length: 50 }).notNull(),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
    exitedAt: timestamp('exited_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
  },
);
