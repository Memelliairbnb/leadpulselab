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
  numeric,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const canonicalLeads = pgTable(
  'canonical_leads',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    canonicalType: varchar('canonical_type', { length: 20 }).notNull(),
    normalizedName: varchar('normalized_name', { length: 255 }).notNull(),
    normalizedDomain: varchar('normalized_domain', { length: 255 }),
    primaryEmail: varchar('primary_email', { length: 255 }),
    primaryPhone: varchar('primary_phone', { length: 50 }),
    companyName: varchar('company_name', { length: 255 }),
    industryInference: varchar('industry_inference', { length: 100 }),
    personaInference: varchar('persona_inference', { length: 100 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 50 }),
    country: varchar('country', { length: 50 }).default('US'),
    geoRegion: varchar('geo_region', { length: 100 }),
    freshnessScore: integer('freshness_score').notNull().default(0),
    verificationStatus: varchar('verification_status', { length: 20 }).notNull().default('unverified'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastEnrichedAt: timestamp('last_enriched_at', { withTimezone: true }),
    signalCount: integer('signal_count').notNull().default(0),
    sourceCount: integer('source_count').notNull().default(0),
    mergeCount: integer('merge_count').notNull().default(0),
    lifecycleState: varchar('lifecycle_state', { length: 30 }).notNull().default('discovered'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_canonical_leads_name').on(table.normalizedName),
    index('idx_canonical_leads_domain').on(table.normalizedDomain),
    index('idx_canonical_leads_email').on(table.primaryEmail),
    index('idx_canonical_leads_lifecycle').on(table.lifecycleState),
    index('idx_canonical_leads_freshness').on(table.freshnessScore),
    index('idx_canonical_leads_verification').on(table.verificationStatus),
    index('idx_canonical_leads_industry').on(table.industryInference),
    index('idx_canonical_leads_geo').on(table.city, table.state),
    index('idx_canonical_leads_created').on(table.createdAt),
  ],
);

export const leadIdentities = pgTable(
  'lead_identities',
  {
    id: serial('id').primaryKey(),
    canonicalLeadId: integer('canonical_lead_id')
      .notNull()
      .references(() => canonicalLeads.id, { onDelete: 'cascade' }),
    platform: varchar('platform', { length: 50 }).notNull(),
    platformId: varchar('platform_id', { length: 255 }),
    profileUrl: text('profile_url'),
    profileName: varchar('profile_name', { length: 255 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    identityType: varchar('identity_type', { length: 20 }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    source: varchar('source', { length: 30 }).notNull(),
    verified: boolean('verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lead_identities_canonical').on(table.canonicalLeadId),
    index('idx_lead_identities_platform').on(table.platform, table.platformId),
    index('idx_lead_identities_email').on(table.email),
    index('idx_lead_identities_profile_url').on(table.profileUrl),
  ],
);

export const identityLinks = pgTable(
  'identity_links',
  {
    id: serial('id').primaryKey(),
    identityAId: integer('identity_a_id')
      .notNull()
      .references(() => leadIdentities.id, { onDelete: 'cascade' }),
    identityBId: integer('identity_b_id')
      .notNull()
      .references(() => leadIdentities.id, { onDelete: 'cascade' }),
    linkType: varchar('link_type', { length: 20 }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    evidenceJson: jsonb('evidence_json').default({}),
    createdBy: varchar('created_by', { length: 20 }).notNull(),
    reviewed: boolean('reviewed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const leadDomains = pgTable(
  'lead_domains',
  {
    id: serial('id').primaryKey(),
    canonicalLeadId: integer('canonical_lead_id')
      .notNull()
      .references(() => canonicalLeads.id, { onDelete: 'cascade' }),
    domain: varchar('domain', { length: 255 }).notNull(),
    domainType: varchar('domain_type', { length: 20 }).notNull(),
    verified: boolean('verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lead_domains_domain').on(table.domain),
    index('idx_lead_domains_canonical').on(table.canonicalLeadId),
  ],
);

export const leadFreshnessScores = pgTable(
  'lead_freshness_scores',
  {
    id: serial('id').primaryKey(),
    canonicalLeadId: integer('canonical_lead_id')
      .notNull()
      .references(() => canonicalLeads.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    signalRecencyDays: integer('signal_recency_days').notNull(),
    activityCount30d: integer('activity_count_30d').notNull().default(0),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const leadVerificationStatus = pgTable(
  'lead_verification_status',
  {
    id: serial('id').primaryKey(),
    canonicalLeadId: integer('canonical_lead_id')
      .notNull()
      .references(() => canonicalLeads.id, { onDelete: 'cascade' }),
    verificationType: varchar('verification_type', { length: 30 }).notNull(),
    result: varchar('result', { length: 20 }).notNull(),
    detailsJson: jsonb('details_json').default({}),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
