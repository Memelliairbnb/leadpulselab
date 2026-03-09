import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  timestamp,
  jsonb,
  boolean,
  index,
  numeric,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { qualifiedLeads } from './leads';
import { users } from './users';

// =====================================================
// AGENT RUNS — every AI agent execution is logged
// =====================================================

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    leadId: integer('lead_id').references(() => qualifiedLeads.id),
    agentType: varchar('agent_type', { length: 50 }).notNull(),
    // e.g. 'lead_classifier', 'lead_scorer', 'outreach_drafter',
    //      'reply_analyzer', 'lead_researcher', 'followup_generator',
    //      'conversation_handler', 'opportunity_analyzer'
    promptTemplateId: integer('prompt_template_id').references(() => aiPromptTemplates.id),
    promptVersion: integer('prompt_version'),
    inputJson: jsonb('input_json').notNull().default({}),
    outputJson: jsonb('output_json').default({}),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // pending, running, completed, failed, timeout
    errorMessage: text('error_message'),
    modelUsed: varchar('model_used', { length: 50 }),
    tokenCount: integer('token_count'),
    durationMs: integer('duration_ms'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_agent_runs_tenant').on(table.tenantId),
    index('idx_agent_runs_lead').on(table.leadId),
    index('idx_agent_runs_type').on(table.agentType),
    index('idx_agent_runs_status').on(table.status),
    index('idx_agent_runs_created').on(table.createdAt),
    index('idx_agent_runs_idempotency').on(table.idempotencyKey),
  ],
);

// =====================================================
// LEAD INTELLIGENCE — summarized research per lead
// =====================================================

export const leadIntelligence = pgTable(
  'lead_intelligence',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    leadId: integer('lead_id')
      .notNull()
      .references(() => qualifiedLeads.id, { onDelete: 'cascade' }),
    summary: text('summary').notNull(),
    signalsJson: jsonb('signals_json').notNull().default([]),
    painPointsJson: jsonb('pain_points_json').default([]),
    opportunitiesJson: jsonb('opportunities_json').default([]),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    recommendedNextAction: varchar('recommended_next_action', { length: 255 }),
    modelVersion: varchar('model_version', { length: 50 }),
    agentRunId: integer('agent_run_id').references(() => agentRuns.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lead_intelligence_tenant').on(table.tenantId),
    index('idx_lead_intelligence_lead').on(table.leadId),
  ],
);

// =====================================================
// CONVERSATION MESSAGES — inbound/outbound + AI suggestions
// =====================================================

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    leadId: integer('lead_id')
      .notNull()
      .references(() => qualifiedLeads.id, { onDelete: 'cascade' }),
    direction: varchar('direction', { length: 10 }).notNull(),
    // 'inbound', 'outbound', 'ai_draft'
    channel: varchar('channel', { length: 30 }).notNull(),
    // 'dm', 'email', 'sms', 'comment'
    subject: varchar('subject', { length: 255 }),
    body: text('body').notNull(),
    senderName: varchar('sender_name', { length: 255 }),
    senderIdentifier: varchar('sender_identifier', { length: 255 }),
    aiAnalysisJson: jsonb('ai_analysis_json').default({}),
    // sentiment, intent, suggested_response, etc.
    status: varchar('status', { length: 20 }).notNull().default('received'),
    // received, read, replied, ai_draft, approved, sent
    parentMessageId: integer('parent_message_id'),
    approvedBy: integer('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    externalMessageId: varchar('external_message_id', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_conversation_messages_tenant').on(table.tenantId),
    index('idx_conversation_messages_lead').on(table.leadId),
    index('idx_conversation_messages_direction').on(table.direction),
    index('idx_conversation_messages_created').on(table.createdAt),
  ],
);

// =====================================================
// FOLLOWUP TASKS — scheduled follow-ups with approval
// =====================================================

export const followupTasks = pgTable(
  'followup_tasks',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    leadId: integer('lead_id')
      .notNull()
      .references(() => qualifiedLeads.id, { onDelete: 'cascade' }),
    sequenceId: integer('sequence_id').references(() => tenantFollowupSequences.id),
    sequenceStep: integer('sequence_step'),
    channel: varchar('channel', { length: 30 }).notNull().default('dm'),
    subject: varchar('subject', { length: 255 }),
    body: text('body').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending_approval'),
    // pending_approval, approved, scheduled, sent, cancelled, skipped
    requiresApproval: boolean('requires_approval').notNull().default(true),
    approvedBy: integer('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    agentRunId: integer('agent_run_id').references(() => agentRuns.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_followup_tasks_tenant').on(table.tenantId),
    index('idx_followup_tasks_lead').on(table.leadId),
    index('idx_followup_tasks_due').on(table.dueAt),
    index('idx_followup_tasks_status').on(table.status),
  ],
);

// =====================================================
// LEAD INSIGHTS — pattern-based trends and analytics
// =====================================================

export const leadInsights = pgTable(
  'lead_insights',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    insightType: varchar('insight_type', { length: 50 }).notNull(),
    // 'regional_trend', 'objection_pattern', 'opportunity_theme',
    // 'keyword_performance', 'source_quality', 'conversion_pattern'
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    dataJson: jsonb('data_json').notNull().default({}),
    // supporting data: counts, lead IDs, time ranges, etc.
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    agentRunId: integer('agent_run_id').references(() => agentRuns.id),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lead_insights_tenant').on(table.tenantId),
    index('idx_lead_insights_type').on(table.insightType),
    index('idx_lead_insights_created').on(table.createdAt),
  ],
);

// =====================================================
// VERSIONED PROMPT TEMPLATES — configurable, not in code
// =====================================================

export const aiPromptTemplates = pgTable(
  'ai_prompt_templates',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    // null = system-level template, non-null = tenant override
    promptKey: varchar('prompt_key', { length: 100 }).notNull(),
    // 'lead_classification', 'lead_scoring', 'outreach_draft',
    // 'reply_analysis', 'followup_generation', 'lead_research',
    // 'conversation_handler', 'opportunity_analyzer'
    promptVersion: integer('prompt_version').notNull().default(1),
    systemPrompt: text('system_prompt').notNull(),
    userPromptTemplate: text('user_prompt_template').notNull(),
    industryContext: text('industry_context'),
    outputSchema: jsonb('output_schema'),
    // expected JSON schema for validation
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ai_prompt_templates_tenant').on(table.tenantId),
    index('idx_ai_prompt_templates_key').on(table.promptKey),
    index('idx_ai_prompt_templates_active').on(table.isActive),
  ],
);

// =====================================================
// TENANT FOLLOWUP SEQUENCES — configurable multi-step
// =====================================================

export const tenantFollowupSequences = pgTable(
  'tenant_followup_sequences',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    name: varchar('name', { length: 100 }).notNull(),
    leadTypeId: integer('lead_type_id'),
    // null = applies to all lead types
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_tenant_followup_sequences_tenant').on(table.tenantId),
  ],
);

export const tenantFollowupSteps = pgTable(
  'tenant_followup_steps',
  {
    id: serial('id').primaryKey(),
    sequenceId: integer('sequence_id')
      .notNull()
      .references(() => tenantFollowupSequences.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    delayDays: integer('delay_days').notNull(),
    // days after previous step (or initial outreach)
    channel: varchar('channel', { length: 30 }).notNull().default('dm'),
    subjectTemplate: text('subject_template'),
    bodyTemplate: text('body_template').notNull(),
    // supports {{lead_name}}, {{service_name}}, {{last_message_summary}} etc.
    tone: varchar('tone', { length: 20 }).default('warm'),
    requiresApproval: boolean('requires_approval').notNull().default(true),
    skipIfReplied: boolean('skip_if_replied').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_tenant_followup_steps_sequence').on(table.sequenceId),
  ],
);

// =====================================================
// TENANT AUTOMATION SETTINGS — control flags per tenant
// =====================================================

export const tenantAutomationSettings = pgTable(
  'tenant_automation_settings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id)
      .unique(),
    automationMode: varchar('automation_mode', { length: 20 }).notNull().default('manual'),
    // 'manual' = everything needs approval
    // 'semi_auto' = some steps auto, some need approval
    // 'auto' = fully automated (enterprise only)
    requiresOutreachApproval: boolean('requires_outreach_approval').notNull().default(true),
    requiresReplyApproval: boolean('requires_reply_approval').notNull().default(true),
    requiresFollowupApproval: boolean('requires_followup_approval').notNull().default(true),
    autoGenerateOutreach: boolean('auto_generate_outreach').notNull().default(true),
    // auto-generate drafts for qualifying leads
    autoGenerateFollowups: boolean('auto_generate_followups').notNull().default(false),
    // auto-generate followup drafts per sequence
    autoArchiveStaleLeads: boolean('auto_archive_stale_leads').notNull().default(true),
    staleLeadDays: integer('stale_lead_days').notNull().default(30),
    maxOutreachPerDay: integer('max_outreach_per_day').default(50),
    maxFollowupsPerDay: integer('max_followups_per_day').default(25),
    workingHoursStart: integer('working_hours_start').default(9),
    // 0-23
    workingHoursEnd: integer('working_hours_end').default(17),
    workingTimezone: varchar('working_timezone', { length: 50 }).default('America/New_York'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
