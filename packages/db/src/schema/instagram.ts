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

// ─── Follower collection: Target accounts ───────────────────────────────────

export const instagramTargetAccounts = pgTable(
  'instagram_target_accounts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    candidateId: integer('candidate_id').references(() => instagramProfileCandidates.id),
    instagramHandle: varchar('instagram_handle', { length: 255 }).notNull(),
    profileUrl: text('profile_url'),
    displayName: varchar('display_name', { length: 500 }),
    followerCount: integer('follower_count'),
    category: varchar('category', { length: 255 }),
    isCompetitor: boolean('is_competitor').notNull().default(false),
    collectionStatus: varchar('collection_status', { length: 50 }).notNull().default('pending'),
    followersCollected: integer('followers_collected').notNull().default(0),
    lastCollectionAt: timestamp('last_collection_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_ig_target_tenant_handle').on(table.tenantId, table.instagramHandle),
    index('idx_ig_target_tenant').on(table.tenantId),
    index('idx_ig_target_status').on(table.collectionStatus),
  ],
);

// ─── Follower collection: Collected followers ───────────────────────────────

export const instagramCollectedFollowers = pgTable(
  'instagram_collected_followers',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    targetAccountId: integer('target_account_id').notNull().references(() => instagramTargetAccounts.id),
    followerHandle: varchar('follower_handle', { length: 255 }).notNull(),
    followerProfileUrl: text('follower_profile_url'),
    followerDisplayName: varchar('follower_display_name', { length: 500 }),
    followerBio: text('follower_bio'),
    isBusiness: boolean('is_business'),
    isPrivate: boolean('is_private'),
    category: varchar('category', { length: 255 }),
    publicEmail: varchar('public_email', { length: 500 }),
    publicPhone: varchar('public_phone', { length: 100 }),
    websiteUrl: text('website_url'),
    locationClues: text('location_clues'),
    followerCount: integer('follower_count'),
    followingCount: integer('following_count'),
    processingStatus: varchar('processing_status', { length: 50 }).notNull().default('raw'),
    qualificationScore: integer('qualification_score'),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_ig_follower_tenant_target_handle').on(table.tenantId, table.targetAccountId, table.followerHandle),
    index('idx_ig_follower_tenant').on(table.tenantId),
    index('idx_ig_follower_target').on(table.targetAccountId),
    index('idx_ig_follower_processing').on(table.processingStatus),
    index('idx_ig_follower_score').on(table.qualificationScore),
  ],
);

// ─── Follower collection: Run tracking ──────────────────────────────────────

export const instagramCollectionRuns = pgTable(
  'instagram_collection_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    targetAccountId: integer('target_account_id').notNull().references(() => instagramTargetAccounts.id),
    status: varchar('status', { length: 50 }).notNull().default('running'),
    followersCollected: integer('followers_collected').notNull().default(0),
    cursorPosition: text('cursor_position'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_collection_runs_tenant').on(table.tenantId),
    index('idx_ig_collection_runs_target').on(table.targetAccountId),
    index('idx_ig_collection_runs_status').on(table.status),
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

// ═══════════════════════════════════════════════════════════════════════════════
// Instagram Growth Machine — auto-engage, scrape followers, generate content
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Connected Instagram accounts ────────────────────────────────────────────

export const instagramAccounts = pgTable(
  'instagram_accounts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    igUserId: varchar('ig_user_id', { length: 255 }),
    igUsername: varchar('ig_username', { length: 255 }).notNull(),
    encryptedPassword: text('encrypted_password'),
    sessionJson: text('session_json'),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }),
    accessToken: text('access_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    tokenScope: text('token_scope'),
    detectedNiche: varchar('detected_niche', { length: 255 }),
    confirmedNiche: varchar('confirmed_niche', { length: 255 }),
    bioText: text('bio_text'),
    profilePicUrl: text('profile_pic_url'),
    followerCount: integer('follower_count'),
    followingCount: integer('following_count'),
    postCount: integer('post_count'),
    isBusiness: boolean('is_business'),
    businessCategory: varchar('business_category', { length: 255 }),
    accountStatus: varchar('account_status', { length: 30 }).notNull().default('pending'),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_ig_accounts_tenant_username').on(table.tenantId, table.igUsername),
    index('idx_ig_accounts_status').on(table.accountStatus),
    index('idx_ig_accounts_tenant').on(table.tenantId),
  ],
);

// ─── Products linked to an Instagram account ─────────────────────────────────

export const instagramAccountProducts = pgTable(
  'instagram_account_products',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id').notNull().references(() => instagramAccounts.id, { onDelete: 'cascade' }),
    productName: varchar('product_name', { length: 255 }).notNull(),
    productDescription: text('product_description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_account_products_account').on(table.accountId),
  ],
);

// ─── Target audiences linked to an Instagram account ─────────────────────────

export const instagramAccountAudiences = pgTable(
  'instagram_account_audiences',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id').notNull().references(() => instagramAccounts.id, { onDelete: 'cascade' }),
    audienceName: varchar('audience_name', { length: 255 }).notNull(),
    audienceDescription: text('audience_description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_account_audiences_account').on(table.accountId),
  ],
);

// ─── Per-account automation config ───────────────────────────────────────────

export const instagramAccountConfig = pgTable(
  'instagram_account_config',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id').notNull().references(() => instagramAccounts.id, { onDelete: 'cascade' }).unique(),
    autoFollow: boolean('auto_follow').notNull().default(true),
    autoLike: boolean('auto_like').notNull().default(true),
    autoComment: boolean('auto_comment').notNull().default(true),
    autoDm: boolean('auto_dm').notNull().default(false),
    autoContent: boolean('auto_content').notNull().default(false),
    dailyFollowLimit: integer('daily_follow_limit').notNull().default(10),
    dailyLikeLimit: integer('daily_like_limit').notNull().default(30),
    dailyCommentLimit: integer('daily_comment_limit').notNull().default(5),
    dailyDmLimit: integer('daily_dm_limit').notNull().default(0),
    engagementEnabled: boolean('engagement_enabled').notNull().default(false),
    contentEnabled: boolean('content_enabled').notNull().default(false),
    rampWeek: integer('ramp_week').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_account_config_account').on(table.accountId),
  ],
);

// ─── Engagement action log ───────────────────────────────────────────────────

export const instagramEngagementLog = pgTable(
  'instagram_engagement_log',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id').notNull().references(() => instagramAccounts.id, { onDelete: 'cascade' }),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    actionType: varchar('action_type', { length: 30 }).notNull(),
    targetHandle: varchar('target_handle', { length: 255 }),
    targetPostId: varchar('target_post_id', { length: 255 }),
    commentText: text('comment_text'),
    dmText: text('dm_text'),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    status: varchar('status', { length: 30 }).notNull().default('success'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_engagement_account_action_created').on(table.accountId, table.actionType, table.createdAt),
    index('idx_ig_engagement_account_created').on(table.accountId, table.createdAt),
    index('idx_ig_engagement_tenant').on(table.tenantId),
  ],
);

// ─── Content schedule ────────────────────────────────────────────────────────

export const instagramContentSchedule = pgTable(
  'instagram_content_schedule',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id').notNull().references(() => instagramAccounts.id, { onDelete: 'cascade' }),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    contentType: varchar('content_type', { length: 30 }).notNull(),
    caption: text('caption'),
    hashtags: text('hashtags'),
    imageUrl: text('image_url'),
    videoUrl: text('video_url'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    status: varchar('status', { length: 30 }).notNull().default('draft'),
    aiPrompt: text('ai_prompt'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_content_account_status').on(table.accountId, table.status),
    index('idx_ig_content_tenant').on(table.tenantId),
  ],
);

// ─── DM campaigns ────────────────────────────────────────────────────────────

export const instagramDmCampaigns = pgTable(
  'instagram_dm_campaigns',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id').notNull().references(() => instagramAccounts.id, { onDelete: 'cascade' }),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    campaignName: varchar('campaign_name', { length: 255 }).notNull(),
    targetAudience: text('target_audience'),
    messageTemplate: text('message_template'),
    aiPersonalize: boolean('ai_personalize').notNull().default(true),
    status: varchar('status', { length: 30 }).notNull().default('draft'),
    totalSent: integer('total_sent').notNull().default(0),
    totalReplied: integer('total_replied').notNull().default(0),
    totalConverted: integer('total_converted').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_dm_campaigns_account').on(table.accountId),
    index('idx_ig_dm_campaigns_tenant').on(table.tenantId),
    index('idx_ig_dm_campaigns_status').on(table.status),
  ],
);

// ─── DM messages ─────────────────────────────────────────────────────────────

export const instagramDmMessages = pgTable(
  'instagram_dm_messages',
  {
    id: serial('id').primaryKey(),
    campaignId: integer('campaign_id').notNull().references(() => instagramDmCampaigns.id, { onDelete: 'cascade' }),
    accountId: integer('account_id').notNull().references(() => instagramAccounts.id, { onDelete: 'cascade' }),
    recipientHandle: varchar('recipient_handle', { length: 255 }).notNull(),
    messageText: text('message_text'),
    status: varchar('status', { length: 30 }).notNull().default('queued'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    replyText: text('reply_text'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ig_dm_messages_campaign_status').on(table.campaignId, table.status),
    index('idx_ig_dm_messages_account').on(table.accountId),
  ],
);
