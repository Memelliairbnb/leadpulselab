import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { qualifiedLeads } from './leads';
import { users } from './users';

export const outreachDrafts = pgTable(
  'outreach_drafts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    leadId: integer('lead_id')
      .notNull()
      .references(() => qualifiedLeads.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    channel: varchar('channel', { length: 30 }).notNull().default('dm'),
    subject: varchar('subject', { length: 255 }),
    body: text('body').notNull(),
    aiModelUsed: varchar('ai_model_used', { length: 50 }),
    promptTemplate: varchar('prompt_template', { length: 100 }),
    status: varchar('status', { length: 20 }).notNull().default('pending_review'),
    reviewedBy: integer('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_outreach_drafts_lead').on(table.leadId),
    index('idx_outreach_drafts_status').on(table.status),
    index('idx_outreach_drafts_tenant').on(table.tenantId),
  ],
);

export const optOuts = pgTable(
  'opt_outs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    identifierType: varchar('identifier_type', { length: 30 }).notNull(),
    reason: text('reason'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_opt_outs_identifier').on(table.tenantId, table.identifier, table.identifierType),
  ],
);
