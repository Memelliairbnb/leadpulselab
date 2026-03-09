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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

// ─── Worker 0: Discovery run tracking ───────────────────────────────────────

export const instagramDiscoveryRuns = pgTable(
  'instagram_discovery_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    searchQuery: text('search_query'),
    searchType: varchar('search_type', { length: 30 }).notNull(),
    profilesFound: integer('profiles_found').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_discovery_runs_tenant').on(table.tenantId),
    index('idx_ig_discovery_runs_status').on(table.status),
    index('idx_ig_discovery_runs_search_type').on(table.searchType),
    index('idx_ig_discovery_runs_created').on(table.createdAt),
  ],
);

// ─── Worker 1: Raw scraped profiles ─────────────────────────────────────────

export const rawInstagramProfiles = pgTable(
  'raw_instagram_profiles',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    discoveryRunId: integer('discovery_run_id').references(() => instagramDiscoveryRuns.id),
    instagramHandle: varchar('instagram_handle', { length: 255 }).notNull(),
    profileUrl: text('profile_url'),
    displayName: varchar('display_name', { length: 500 }),
    bioText: text('bio_text'),
    category: varchar('category', { length: 255 }),
    websiteUrl: text('website_url'),
    publicEmailCandidate: varchar('public_email_candidate', { length: 500 }),
    publicPhoneCandidate: varchar('public_phone_candidate', { length: 100 }),
    locationClues: text('location_clues'),
    followerCount: integer('follower_count'),
    followingCount: integer('following_count'),
    postCount: integer('post_count'),
    isBusiness: boolean('is_business'),
    isPrivate: boolean('is_private').notNull().default(false),
    discoveryReason: text('discovery_reason'),
    rawMetadataJson: jsonb('raw_metadata_json'),
    processingStatus: varchar('processing_status', { length: 20 }).notNull().default('pending'),
    textHash: varchar('text_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_ig_profiles_tenant_handle').on(table.tenantId, table.instagramHandle),
    index('idx_ig_profiles_tenant').on(table.tenantId),
    index('idx_ig_profiles_discovery_run').on(table.discoveryRunId),
    index('idx_ig_profiles_processing').on(table.processingStatus),
    index('idx_ig_profiles_text_hash').on(table.textHash),
    index('idx_ig_profiles_created').on(table.createdAt),
  ],
);

// ─── Worker 2: Scrubbed / pre-qualified candidates ──────────────────────────

export const instagramProfileCandidates = pgTable(
  'instagram_profile_candidates',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    rawProfileId: integer('raw_profile_id').references(() => rawInstagramProfiles.id),
    instagramHandle: varchar('instagram_handle', { length: 255 }),
    profileUrl: text('profile_url'),
    displayName: varchar('display_name', { length: 500 }),
    bioText: text('bio_text'),
    category: varchar('category', { length: 255 }),
    websiteUrl: text('website_url'),
    normalizedEmail: varchar('normalized_email', { length: 500 }),
    normalizedPhone: varchar('normalized_phone', { length: 100 }),
    profileType: varchar('profile_type', { length: 20 }).notNull().default('unclear'),
    duplicateStatus: varchar('duplicate_status', { length: 20 }).notNull().default('unique'),
    nicheFitScore: integer('niche_fit_score').notNull().default(0),
    contactabilityScore: integer('contactability_score').notNull().default(0),
    bioQualityScore: integer('bio_quality_score').notNull().default(0),
    overallPrequalScore: integer('overall_prequal_score').notNull().default(0),
    prequalStatus: varchar('prequal_status', { length: 20 }).notNull().default('enrich'),
    scrubNotes: text('scrub_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_candidates_tenant').on(table.tenantId),
    index('idx_ig_candidates_raw_profile').on(table.rawProfileId),
    index('idx_ig_candidates_prequal_status').on(table.prequalStatus),
    index('idx_ig_candidates_overall_score').on(table.overallPrequalScore),
    index('idx_ig_candidates_profile_type').on(table.profileType),
    index('idx_ig_candidates_duplicate_status').on(table.duplicateStatus),
    index('idx_ig_candidates_created').on(table.createdAt),
  ],
);

// ─── Worker 3: Contact discovery results ────────────────────────────────────

export const instagramContactCandidates = pgTable(
  'instagram_contact_candidates',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    candidateId: integer('candidate_id')
      .notNull()
      .references(() => instagramProfileCandidates.id, { onDelete: 'cascade' }),
    contactType: varchar('contact_type', { length: 30 }).notNull(),
    contactValue: text('contact_value').notNull(),
    source: varchar('source', { length: 30 }).notNull(),
    isVerified: boolean('is_verified').notNull().default(false),
    verificationMethod: varchar('verification_method', { length: 50 }),
    verificationResult: varchar('verification_result', { length: 50 }),
    priorityRank: integer('priority_rank').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_contacts_tenant').on(table.tenantId),
    index('idx_ig_contacts_candidate').on(table.candidateId),
    index('idx_ig_contacts_type').on(table.contactType),
    index('idx_ig_contacts_verified').on(table.isVerified),
  ],
);

// ─── Worker 3: Verification step tracking ───────────────────────────────────

export const instagramVerificationRuns = pgTable(
  'instagram_verification_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    candidateId: integer('candidate_id')
      .notNull()
      .references(() => instagramProfileCandidates.id, { onDelete: 'cascade' }),
    stepName: varchar('step_name', { length: 100 }).notNull(),
    stepStatus: varchar('step_status', { length: 20 }).notNull(),
    outputDataJson: jsonb('output_data_json'),
    durationMs: integer('duration_ms'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_verification_candidate').on(table.candidateId),
    index('idx_ig_verification_step').on(table.stepName),
    index('idx_ig_verification_status').on(table.stepStatus),
    index('idx_ig_verification_created').on(table.createdAt),
  ],
);

// ─── Final scoring ──────────────────────────────────────────────────────────

export const instagramLeadScores = pgTable(
  'instagram_lead_scores',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    candidateId: integer('candidate_id')
      .notNull()
      .references(() => instagramProfileCandidates.id, { onDelete: 'cascade' }),
    nicheFitScore: integer('niche_fit_score').notNull(),
    contactabilityScore: integer('contactability_score').notNull(),
    verificationScore: integer('verification_score').notNull(),
    finalQualificationScore: integer('final_qualification_score').notNull(),
    qualificationStatus: varchar('qualification_status', { length: 30 }).notNull(),
    contactPathRanking: jsonb('contact_path_ranking'),
    scoringNotes: text('scoring_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_scores_tenant').on(table.tenantId),
    index('idx_ig_scores_candidate').on(table.candidateId),
    index('idx_ig_scores_qualification').on(table.qualificationStatus),
    index('idx_ig_scores_final_score').on(table.finalQualificationScore),
    index('idx_ig_scores_created').on(table.createdAt),
  ],
);
