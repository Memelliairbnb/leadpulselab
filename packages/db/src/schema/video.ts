import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

// ─── Video processing jobs ───────────────────────────────────────────────────

export const videoProcessingJobs = pgTable(
  'video_processing_jobs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    clipCount: integer('clip_count').notNull().default(1),
    duration: integer('duration').notNull().default(10),
    musicGenre: varchar('music_genre', { length: 20 }).default('hiphop'),
    transcriptText: text('transcript_text'),
    inputUrls: jsonb('input_urls'),
    outputUrl: text('output_url'),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_video_jobs_tenant').on(table.tenantId),
    index('idx_video_jobs_status').on(table.status),
    index('idx_video_jobs_created').on(table.createdAt),
  ],
);
