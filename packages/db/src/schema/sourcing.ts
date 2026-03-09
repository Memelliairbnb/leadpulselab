import {
  pgTable,
  serial,
  varchar,
  boolean,
  integer,
  text,
  timestamp,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { platformSources } from './sources';

// =====================================================
// QUERY RUNS — every search query executed by discovery agents
// NOTE: partition by created_at in production
// =====================================================

export const queryRuns = pgTable(
  'query_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    sourceId: integer('source_id').notNull().references(() => platformSources.id),
    queryText: text('query_text').notNull(),
    queryType: varchar('query_type', { length: 30 }),
    // 'keyword', 'hashtag', 'long_tail', 'expanded', 'location_targeted'
    keywordId: integer('keyword_id'),
    expansionSource: varchar('expansion_source', { length: 30 }),
    // 'original', 'ai_expanded', 'variation', 'synonym'
    resultsCount: integer('results_count').notNull().default(0),
    leadsExtracted: integer('leads_extracted').notNull().default(0),
    duplicatesFound: integer('duplicates_found').notNull().default(0),
    agentRunId: integer('agent_run_id'),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_query_runs_tenant').on(table.tenantId),
    index('idx_query_runs_source').on(table.sourceId),
    index('idx_query_runs_type').on(table.queryType),
    index('idx_query_runs_executed').on(table.executedAt),
  ],
);

// =====================================================
// SOURCE FETCH RUNS — individual fetch operations (one per URL/API call)
// =====================================================

export const sourceFetchRuns = pgTable(
  'source_fetch_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').references(() => tenants.id),
    queryRunId: integer('query_run_id').references(() => queryRuns.id),
    sourceId: integer('source_id').notNull().references(() => platformSources.id),
    fetchUrl: text('fetch_url').notNull(),
    fetchMethod: varchar('fetch_method', { length: 20 }),
    // 'api', 'scrape', 'rss', 'search'
    httpStatus: integer('http_status'),
    responseSizeBytes: integer('response_size_bytes'),
    itemsFound: integer('items_found').notNull().default(0),
    success: boolean('success').notNull().default(false),
    errorMessage: text('error_message'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_source_fetch_runs_source').on(table.sourceId),
    index('idx_source_fetch_runs_query').on(table.queryRunId),
    index('idx_source_fetch_runs_fetched').on(table.fetchedAt),
    index('idx_source_fetch_runs_success').on(table.success),
  ],
);

// =====================================================
// RAW SOURCE BLOBS — full raw response storage (never lose raw data)
// NOTE: partition by created_at, consider moving to object storage for scale
// =====================================================

export const rawSourceBlobs = pgTable(
  'raw_source_blobs',
  {
    id: serial('id').primaryKey(),
    sourceFetchRunId: integer('source_fetch_run_id')
      .notNull()
      .references(() => sourceFetchRuns.id),
    contentType: varchar('content_type', { length: 50 }),
    // 'html', 'json', 'text', 'xml'
    blobData: text('blob_data').notNull(),
    checksumHash: varchar('checksum_hash', { length: 64 }).notNull(),
    byteSize: integer('byte_size').notNull(),
    compressed: boolean('compressed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_raw_source_blobs_checksum').on(table.checksumHash),
    index('idx_raw_source_blobs_fetch_run').on(table.sourceFetchRunId),
  ],
);

// =====================================================
// SOURCE HEALTH METRICS — running quality metrics per source
// =====================================================

export const sourceHealthMetrics = pgTable(
  'source_health_metrics',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id').notNull().references(() => platformSources.id),
    tenantId: integer('tenant_id').references(() => tenants.id),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    fetchCount: integer('fetch_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    totalLeadsFound: integer('total_leads_found').notNull().default(0),
    uniqueLeadsFound: integer('unique_leads_found').notNull().default(0),
    duplicateRate: numeric('duplicate_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    parseSuccessRate: numeric('parse_success_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    enrichmentSuccessRate: numeric('enrichment_success_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    avgLeadScore: numeric('avg_lead_score', { precision: 5, scale: 2 }).notNull().default('0'),
    campaignYieldRate: numeric('campaign_yield_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    // what % of leads from this source convert
    freshnessAvgDays: numeric('freshness_avg_days', { precision: 5, scale: 2 }).notNull().default('0'),
    qualityScore: integer('quality_score').notNull().default(0),
    // 0-100 composite
    calculatedAt: timestamp('calculated_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_source_health_metrics_source').on(table.sourceId),
    index('idx_source_health_metrics_calculated').on(table.calculatedAt),
  ],
);

// =====================================================
// SOURCE QUALITY SCORES — simplified current quality per source
// =====================================================

export const sourceQualityScores = pgTable(
  'source_quality_scores',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id').notNull().unique(),
    qualityScore: integer('quality_score').notNull().default(50),
    reliabilityScore: integer('reliability_score').notNull().default(50),
    freshnessScore: integer('freshness_score').notNull().default(50),
    yieldScore: integer('yield_score').notNull().default(50),
    lastCalculatedAt: timestamp('last_calculated_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
