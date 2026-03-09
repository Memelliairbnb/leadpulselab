import {
  pgTable,
  serial,
  varchar,
  boolean,
  integer,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { canonicalLeads } from './canonical';

// ---------------------------------------------------------------------------
// Lead Inventory Layer — where leads become reusable assets
// ---------------------------------------------------------------------------

export const leadInventoryItems = pgTable(
  'lead_inventory_items',
  {
    id: serial('id').primaryKey(),
    canonicalLeadId: integer('canonical_lead_id')
      .notNull()
      .references(() => canonicalLeads.id),
    tenantId: integer('tenant_id').references(() => tenants.id), // null = platform pool
    inventoryStatus: varchar('inventory_status', { length: 20 }).notNull().default('available'),
    temperature: varchar('temperature', { length: 10 }).notNull().default('warm'),
    valueScore: integer('value_score').notNull().default(0),
    ageBand: varchar('age_band', { length: 20 }),
    industry: varchar('industry', { length: 100 }),
    geoRegion: varchar('geo_region', { length: 100 }),
    persona: varchar('persona', { length: 100 }),
    signalType: varchar('signal_type', { length: 100 }),
    problemType: varchar('problem_type', { length: 100 }),
    assignmentCount: integer('assignment_count').notNull().default(0),
    contactCount: integer('contact_count').notNull().default(0),
    lastAssignedAt: timestamp('last_assigned_at', { withTimezone: true }),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    monetizationEligible: boolean('monetization_eligible').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_inventory_canonical_lead').on(table.canonicalLeadId),
    index('idx_inventory_items_tenant').on(table.tenantId),
    index('idx_inventory_items_status').on(table.inventoryStatus),
    index('idx_inventory_items_temperature').on(table.temperature),
    index('idx_inventory_items_value_score').on(table.valueScore),
    index('idx_inventory_items_age_band').on(table.ageBand),
    index('idx_inventory_items_industry').on(table.industry),
    index('idx_inventory_items_geo_region').on(table.geoRegion),
  ],
);

export const leadInventoryPools = pgTable(
  'lead_inventory_pools',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id), // null = platform pool
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    poolType: varchar('pool_type', { length: 30 }).notNull(),
    filterCriteriaJson: jsonb('filter_criteria_json').notNull().default({}),
    leadCount: integer('lead_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const leadPoolMemberships = pgTable(
  'lead_pool_memberships',
  {
    id: serial('id').primaryKey(),
    poolId: integer('pool_id')
      .notNull()
      .references(() => leadInventoryPools.id),
    inventoryItemId: integer('inventory_item_id')
      .notNull()
      .references(() => leadInventoryItems.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    addedBy: varchar('added_by', { length: 20 }).notNull(),
  },
  (table) => [
    index('idx_pool_memberships_pool').on(table.poolId),
    index('idx_pool_memberships_item').on(table.inventoryItemId),
    // Active membership: unique pool+item where not yet removed
    uniqueIndex('uq_pool_membership_active')
      .on(table.poolId, table.inventoryItemId)
      .where(sql`removed_at IS NULL`),
  ],
);

export const leadSegments = pgTable(
  'lead_segments',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    name: varchar('name', { length: 100 }).notNull(),
    segmentType: varchar('segment_type', { length: 30 }).notNull(),
    rulesJson: jsonb('rules_json').notNull(),
    leadCount: integer('lead_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const leadAgeBands = pgTable(
  'lead_age_bands',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    bandName: varchar('band_name', { length: 30 }).notNull(),
    minDays: integer('min_days').notNull(),
    maxDays: integer('max_days'), // null = no upper limit
    label: varchar('label', { length: 50 }).notNull(),
    color: varchar('color', { length: 7 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const leadValueScores = pgTable(
  'lead_value_scores',
  {
    id: serial('id').primaryKey(),
    inventoryItemId: integer('inventory_item_id')
      .notNull()
      .references(() => leadInventoryItems.id),
    score: integer('score').notNull(),
    factorsJson: jsonb('factors_json'),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const leadMonetizationProfiles = pgTable(
  'lead_monetization_profiles',
  {
    id: serial('id').primaryKey(),
    inventoryItemId: integer('inventory_item_id')
      .notNull()
      .references(() => leadInventoryItems.id),
    monetizationType: varchar('monetization_type', { length: 30 }).notNull(),
    estimatedValueCents: integer('estimated_value_cents'),
    eligibleVerticals: jsonb('eligible_verticals').notNull().default([]),
    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
