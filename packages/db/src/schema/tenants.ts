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
  numeric,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable(
  'tenants',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    industry: varchar('industry', { length: 100 }),
    plan: varchar('plan', { length: 30 }).notNull().default('starter'),
    isActive: boolean('is_active').notNull().default(true),
    onboardingTemplate: varchar('onboarding_template', { length: 100 }),
    settingsJson: jsonb('settings_json').notNull().default({}),
    maxLeadsPerMonth: integer('max_leads_per_month').default(1000),
    maxSources: integer('max_sources').default(5),
    maxUsers: integer('max_users').default(5),
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const tenantMembers = pgTable(
  'tenant_members',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    userId: integer('user_id').notNull(),  // references users.id
    role: varchar('role', { length: 20 }).notNull().default('viewer'),
    invitedBy: integer('invited_by'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_tenant_members').on(table.tenantId, table.userId),
    index('idx_tenant_members_tenant').on(table.tenantId),
    index('idx_tenant_members_user').on(table.userId),
  ],
);

export const tenantLeadTypes = pgTable(
  'tenant_lead_types',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    name: varchar('name', { length: 50 }).notNull(),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    description: text('description'),
    priority: integer('priority').notNull().default(0),
    color: varchar('color', { length: 7 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_tenant_lead_types').on(table.tenantId, table.name),
    index('idx_tenant_lead_types_tenant').on(table.tenantId),
  ],
);

export const tenantScoringModels = pgTable(
  'tenant_scoring_models',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    name: varchar('name', { length: 100 }).notNull().default('default'),
    isActive: boolean('is_active').notNull().default(true),
    claudeWeight: numeric('claude_weight', { precision: 3, scale: 2 }).notNull().default('0.60'),
    rulesWeight: numeric('rules_weight', { precision: 3, scale: 2 }).notNull().default('0.40'),
    hotThreshold: integer('hot_threshold').notNull().default(85),
    strongThreshold: integer('strong_threshold').notNull().default(70),
    nurtureThreshold: integer('nurture_threshold').notNull().default(50),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_tenant_scoring_models').on(table.tenantId, table.name),
  ],
);

export const tenantScoringSignals = pgTable(
  'tenant_scoring_signals',
  {
    id: serial('id').primaryKey(),
    scoringModelId: integer('scoring_model_id')
      .notNull()
      .references(() => tenantScoringModels.id, { onDelete: 'cascade' }),
    signalKey: varchar('signal_key', { length: 100 }).notNull(),
    signalPattern: text('signal_pattern').notNull(),
    weight: integer('weight').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [
    uniqueIndex('uq_tenant_scoring_signals').on(table.scoringModelId, table.signalKey),
  ],
);

export const tenantOutreachTemplates = pgTable(
  'tenant_outreach_templates',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    name: varchar('name', { length: 100 }).notNull(),
    leadTypeId: integer('lead_type_id').references(() => tenantLeadTypes.id),
    channel: varchar('channel', { length: 30 }).notNull().default('dm'),
    subjectTemplate: text('subject_template'),
    bodyTemplate: text('body_template').notNull(),
    tone: varchar('tone', { length: 20 }).default('warm'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_tenant_outreach_templates_tenant').on(table.tenantId),
  ],
);

export const tenantAiConfig = pgTable(
  'tenant_ai_config',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id).unique(),
    industryContext: text('industry_context').notNull(),
    classificationInstructions: text('classification_instructions'),
    scoringInstructions: text('scoring_instructions'),
    outreachInstructions: text('outreach_instructions'),
    exampleSignalsJson: jsonb('example_signals_json').default([]),
    irrelevantSignalsJson: jsonb('irrelevant_signals_json').default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const verticalTemplates = pgTable(
  'vertical_templates',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    industry: varchar('industry', { length: 100 }).notNull(),
    description: text('description'),
    configJson: jsonb('config_json').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
