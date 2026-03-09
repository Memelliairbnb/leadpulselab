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
import { tenants, tenantLeadTypes } from './tenants';
import { users } from './users';

export const rawLeads = pgTable(
  'raw_leads',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    rawSourceId: integer('raw_source_id').notNull(),
    platform: varchar('platform', { length: 50 }).notNull(),
    profileName: varchar('profile_name', { length: 255 }),
    profileUrl: text('profile_url'),
    sourceUrl: text('source_url').notNull(),
    matchedKeywords: jsonb('matched_keywords').default([]),
    rawText: text('raw_text').notNull(),
    rawMetadataJson: jsonb('raw_metadata_json').default({}),
    locationText: varchar('location_text', { length: 255 }),
    contactHint: varchar('contact_hint', { length: 255 }),
    contentDate: timestamp('content_date', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    textHash: varchar('text_hash', { length: 64 }).notNull(),
    isProcessed: boolean('is_processed').notNull().default(false),
    processingStatus: varchar('processing_status', { length: 20 }).default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_raw_leads_tenant').on(table.tenantId),
    index('idx_raw_leads_platform').on(table.platform),
    index('idx_raw_leads_text_hash').on(table.textHash),
    index('idx_raw_leads_processing').on(table.processingStatus),
    index('idx_raw_leads_source').on(table.rawSourceId),
  ],
);

export const qualifiedLeads = pgTable(
  'qualified_leads',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    rawLeadId: integer('raw_lead_id').unique(),
    fullName: varchar('full_name', { length: 255 }),
    companyName: varchar('company_name', { length: 255 }),
    leadType: varchar('lead_type', { length: 50 }).notNull(),
    leadTypeId: integer('lead_type_id').references(() => tenantLeadTypes.id),
    intentLevel: varchar('intent_level', { length: 10 }).notNull(),
    leadScore: integer('lead_score').notNull(),
    aiConfidence: numeric('ai_confidence', { precision: 3, scale: 2 }),
    aiSummary: text('ai_summary').notNull(),
    aiSignalsJson: jsonb('ai_signals_json').notNull().default([]),
    aiRecommendedAction: text('ai_recommended_action'),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 50 }),
    country: varchar('country', { length: 50 }).default('US'),
    platform: varchar('platform', { length: 50 }).notNull(),
    profileUrl: text('profile_url'),
    contactMethod: varchar('contact_method', { length: 255 }),
    contactType: varchar('contact_type', { length: 30 }),
    status: varchar('status', { length: 20 }).notNull().default('new'),
    assignedToUserId: integer('assigned_to_user_id').references(() => users.id),
    intentType: varchar('intent_type', { length: 50 }),
    isRealPerson: boolean('is_real_person').default(true),
    estimatedUrgency: varchar('estimated_urgency', { length: 20 }),
    personOrBusinessName: varchar('person_or_business_name', { length: 255 }),
    needsReview: boolean('needs_review').notNull().default(true),
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    duplicateOfLeadId: integer('duplicate_of_lead_id'),
    duplicateConfidence: numeric('duplicate_confidence', { precision: 3, scale: 2 }),
    sourceContentDate: timestamp('source_content_date', { withTimezone: true }),
    lastRescoredAt: timestamp('last_rescored_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_qualified_leads_tenant').on(table.tenantId),
    index('idx_qualified_leads_type').on(table.leadType),
    index('idx_qualified_leads_score').on(table.leadScore),
    index('idx_qualified_leads_status').on(table.status),
    index('idx_qualified_leads_intent').on(table.intentLevel),
    index('idx_qualified_leads_assigned').on(table.assignedToUserId),
    index('idx_qualified_leads_created').on(table.createdAt),
    index('idx_qualified_leads_platform').on(table.platform),
    index('idx_qualified_leads_needs_review').on(table.needsReview),
  ],
);

export const leadTags = pgTable(
  'lead_tags',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    name: varchar('name', { length: 50 }).notNull(),
    category: varchar('category', { length: 30 }).notNull().default('signal'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lead_tags_tenant').on(table.tenantId),
  ],
);

export const qualifiedLeadTags = pgTable(
  'qualified_lead_tags',
  {
    id: serial('id').primaryKey(),
    leadId: integer('lead_id')
      .notNull()
      .references(() => qualifiedLeads.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id').notNull().references(() => leadTags.id),
    source: varchar('source', { length: 20 }).notNull().default('ai'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_qualified_lead_tags_lead').on(table.leadId),
    index('idx_qualified_lead_tags_tag').on(table.tagId),
  ],
);

export const leadContacts = pgTable(
  'lead_contacts',
  {
    id: serial('id').primaryKey(),
    leadId: integer('lead_id')
      .notNull()
      .references(() => qualifiedLeads.id, { onDelete: 'cascade' }),
    contactType: varchar('contact_type', { length: 30 }).notNull(),
    contactValue: varchar('contact_value', { length: 255 }).notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    isVerified: boolean('is_verified').notNull().default(false),
    source: varchar('source', { length: 30 }).default('extracted'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lead_contacts_lead').on(table.leadId),
  ],
);

export const leadSignals = pgTable(
  'lead_signals',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    rawLeadId: integer('raw_lead_id').notNull().references(() => rawLeads.id),
    qualifiedLeadId: integer('qualified_lead_id').references(() => qualifiedLeads.id),
    signalPhrase: varchar('signal_phrase', { length: 100 }),
    intentType: varchar('intent_type', { length: 50 }),
    signalStrength: integer('signal_strength'),
    sourceUrl: text('source_url'),
    sourcePlatform: varchar('source_platform', { length: 50 }),
    authorName: varchar('author_name', { length: 255 }),
    authorProfileUrl: text('author_profile_url'),
    contentSnippet: text('content_snippet'),
    contentDate: timestamp('content_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lead_signals_tenant').on(table.tenantId),
    index('idx_lead_signals_raw_lead').on(table.rawLeadId),
    index('idx_lead_signals_qualified_lead').on(table.qualifiedLeadId),
    index('idx_lead_signals_intent_type').on(table.intentType),
    index('idx_lead_signals_author_name').on(table.authorName),
  ],
);

export const leadActivity = pgTable(
  'lead_activity',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    leadId: integer('lead_id')
      .notNull()
      .references(() => qualifiedLeads.id, { onDelete: 'cascade' }),
    activityType: varchar('activity_type', { length: 50 }).notNull(),
    description: text('description'),
    metadataJson: jsonb('metadata_json').default({}),
    performedBy: integer('performed_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lead_activity_lead').on(table.leadId),
    index('idx_lead_activity_type').on(table.activityType),
    index('idx_lead_activity_created').on(table.createdAt),
  ],
);
