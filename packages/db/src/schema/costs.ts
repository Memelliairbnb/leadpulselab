import {
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { platformSources } from './sources';
import { agentRuns } from './agents';
import { sourceFetchRuns } from './sourcing';

// =====================================================
// AGENT COST TRACKING — per-agent-run cost tracking
// =====================================================

export const agentCostTracking = pgTable(
  'agent_cost_tracking',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    agentRunId: integer('agent_run_id').notNull().references(() => agentRuns.id),
    agentType: varchar('agent_type', { length: 50 }).notNull(),
    modelUsed: varchar('model_used', { length: 50 }),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_agent_cost_tracking_tenant').on(table.tenantId),
    index('idx_agent_cost_tracking_type').on(table.agentType),
    index('idx_agent_cost_tracking_created').on(table.createdAt),
  ],
);

// =====================================================
// SOURCE RUN COSTS — cost per source fetch operation
// =====================================================

export const sourceRunCosts = pgTable(
  'source_run_costs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    sourceId: integer('source_id').notNull().references(() => platformSources.id),
    sourceFetchRunId: integer('source_fetch_run_id').references(() => sourceFetchRuns.id),
    costType: varchar('cost_type', { length: 30 }),
    // 'api_call', 'proxy', 'compute', 'storage'
    costCents: integer('cost_cents').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

// =====================================================
// YIELD METRICS — conversion funnel metrics
// =====================================================

export const yieldMetrics = pgTable(
  'yield_metrics',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    totalQueries: integer('total_queries').notNull().default(0),
    totalFetches: integer('total_fetches').notNull().default(0),
    rawLeadsCaptured: integer('raw_leads_captured').notNull().default(0),
    normalizedLeads: integer('normalized_leads').notNull().default(0),
    verifiedLeads: integer('verified_leads').notNull().default(0),
    hotLeads: integer('hot_leads').notNull().default(0),
    contactedLeads: integer('contacted_leads').notNull().default(0),
    repliedLeads: integer('replied_leads').notNull().default(0),
    convertedLeads: integer('converted_leads').notNull().default(0),
    costPerRawLeadCents: integer('cost_per_raw_lead_cents').notNull().default(0),
    costPerNormalizedLeadCents: integer('cost_per_normalized_lead_cents').notNull().default(0),
    costPerVerifiedLeadCents: integer('cost_per_verified_lead_cents').notNull().default(0),
    costPerHotLeadCents: integer('cost_per_hot_lead_cents').notNull().default(0),
    costPerConversionCents: integer('cost_per_conversion_cents').notNull().default(0),
    totalCostCents: integer('total_cost_cents').notNull().default(0),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_yield_metrics_tenant').on(table.tenantId),
    index('idx_yield_metrics_period').on(table.periodStart),
  ],
);
