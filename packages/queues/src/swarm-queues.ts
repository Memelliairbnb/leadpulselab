// ─── Swarm Queue Infrastructure ─────────────────────────────────────────────
// Defines all queue names and typed job data interfaces for the
// Lead Acquisition Swarm, Agent Departments, and Analytics/Maintenance.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Discovery Swarm Queues ─────────────────────────────────────────────────

export const SWARM_QUEUE_NAMES = {
  QUERY_PLANNING: 'query_planning_queue',
  QUERY_EXPANSION: 'query_expansion_queue',
  SEARCH_EXECUTION: 'search_execution_queue',
  SOURCE_FETCH: 'source_fetch_queue',
  RAW_CAPTURE: 'raw_capture_queue',
  NORMALIZATION: 'normalization_queue',
  SCRUB_DEDUPE: 'scrub_dedupe_queue',
  CANONICAL_ENRICHMENT: 'canonical_enrichment_queue',
  PRIORITIZATION: 'prioritization_queue',
  INVENTORY_ASSIGNMENT: 'inventory_assignment_queue',
} as const;

export type SwarmQueueName = (typeof SWARM_QUEUE_NAMES)[keyof typeof SWARM_QUEUE_NAMES];

// ─── Agent Department Queues ────────────────────────────────────────────────

export const DEPARTMENT_QUEUE_NAMES = {
  // Research Department
  RESEARCH_SIGNAL_DISCOVERY: 'research_signal_discovery_queue',
  RESEARCH_PROFILE_ENRICHMENT: 'research_profile_enrichment_queue',
  RESEARCH_PERSONA_INFERENCE: 'research_persona_inference_queue',
  RESEARCH_INTENT_DETECTION: 'research_intent_detection_queue',
  RESEARCH_CONTEXT_SUMMARY: 'research_context_summary_queue',

  // Qualification Department
  QUALIFY_RELEVANCE: 'qualify_relevance_queue',
  QUALIFY_SCORING: 'qualify_scoring_queue',
  QUALIFY_ICP_FIT: 'qualify_icp_fit_queue',
  QUALIFY_DUPLICATE_REVIEW: 'qualify_duplicate_review_queue',
  QUALIFY_ACTION_RECOMMEND: 'qualify_action_recommend_queue',

  // Outreach Department
  OUTREACH_PERSONALIZATION: 'outreach_personalization_queue',
  OUTREACH_COPY_GENERATION: 'outreach_copy_generation_queue',
  OUTREACH_COMPLIANCE: 'outreach_compliance_queue',
  OUTREACH_CTA_GENERATION: 'outreach_cta_generation_queue',
  OUTREACH_VARIANT_TEST: 'outreach_variant_test_queue',

  // Reply Department
  REPLY_CLASSIFICATION: 'reply_classification_queue',
  REPLY_OBJECTION_HANDLING: 'reply_objection_handling_queue',
  REPLY_QUALIFICATION_Q: 'reply_qualification_question_queue',
  REPLY_ESCALATION: 'reply_escalation_queue',
  REPLY_SENTIMENT: 'reply_sentiment_queue',

  // Follow-up Department
  FOLLOWUP_TIMING: 'followup_timing_queue',
  FOLLOWUP_SEQUENCE_SELECT: 'followup_sequence_select_queue',
  FOLLOWUP_VARIATION: 'followup_variation_queue',
  FOLLOWUP_REENGAGEMENT: 'followup_reengagement_queue',
  FOLLOWUP_STOP_RULE: 'followup_stop_rule_queue',
} as const;

export type DepartmentQueueName = (typeof DEPARTMENT_QUEUE_NAMES)[keyof typeof DEPARTMENT_QUEUE_NAMES];

// ─── Analytics / Maintenance Queues ─────────────────────────────────────────

export const MAINTENANCE_QUEUE_NAMES = {
  LIFECYCLE_EVENT: 'lifecycle_event_queue',
  INVENTORY_AGING: 'inventory_aging_queue',
  STATS_ROLLUP: 'stats_rollup_queue',
  SOURCE_HEALTH_CALC: 'source_health_calc_queue',
  YIELD_CALC: 'yield_calc_queue',
  COST_TRACKING: 'cost_tracking_queue',
  REPROCESSING: 'reprocessing_queue',
} as const;

export type MaintenanceQueueName = (typeof MAINTENANCE_QUEUE_NAMES)[keyof typeof MAINTENANCE_QUEUE_NAMES];

// ─── All queue names combined ───────────────────────────────────────────────

export const ALL_SWARM_QUEUE_NAMES = {
  ...SWARM_QUEUE_NAMES,
  ...DEPARTMENT_QUEUE_NAMES,
  ...MAINTENANCE_QUEUE_NAMES,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Job Data Interfaces — Discovery Swarm
// ═══════════════════════════════════════════════════════════════════════════

export interface QueryPlanningJobData {
  tenantId: number;
  agentType: 'query_planner';
  campaignId: number;
  icpDescription: string;
  keywords: string[];
  payload: Record<string, unknown>;
}

export interface QueryExpansionJobData {
  tenantId: number;
  agentType: 'query_expander';
  planId: string;
  baseQuery: string;
  expansionStrategy: 'synonym' | 'semantic' | 'geographic' | 'industry';
  payload: Record<string, unknown>;
}

export interface SearchExecutionJobData {
  tenantId: number;
  agentType: 'search_executor';
  queryId: string;
  sourceType: string;
  query: string;
  maxResults: number;
  payload: Record<string, unknown>;
}

export interface SourceFetchJobData {
  tenantId: number;
  agentType: 'source_fetcher';
  sourceId: number;
  url: string;
  fetchStrategy: 'api' | 'scrape' | 'feed';
  payload: Record<string, unknown>;
}

export interface RawCaptureJobData {
  tenantId: number;
  agentType: 'raw_capturer';
  sourceId: number;
  rawData: Record<string, unknown>;
  sourceType: string;
  payload: Record<string, unknown>;
}

export interface NormalizationJobData {
  tenantId: number;
  leadId: number;
  agentType: 'normalizer';
  rawLeadId: number;
  sourceType: string;
  payload: Record<string, unknown>;
}

export interface ScrubDedupeJobData {
  tenantId: number;
  leadId: number;
  agentType: 'scrub_deduper';
  canonicalLeadId?: number;
  dedupeStrategy: 'email' | 'phone' | 'fuzzy_name' | 'composite';
  payload: Record<string, unknown>;
}

export interface CanonicalEnrichmentJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'canonical_enricher';
  enrichmentSources: string[];
  payload: Record<string, unknown>;
}

export interface PrioritizationJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'prioritizer';
  scoringModelId?: string;
  payload: Record<string, unknown>;
}

export interface InventoryAssignmentJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'inventory_assigner';
  inventoryPoolId?: number;
  assignmentStrategy: 'round_robin' | 'capacity' | 'specialization' | 'geographic';
  payload: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job Data Interfaces — Research Department
// ═══════════════════════════════════════════════════════════════════════════

export interface ResearchSignalDiscoveryJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'research_signal_discovery';
  signalTypes: string[];
  payload: Record<string, unknown>;
}

export interface ResearchProfileEnrichmentJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'research_profile_enrichment';
  enrichmentDepth: 'basic' | 'standard' | 'deep';
  payload: Record<string, unknown>;
}

export interface ResearchPersonaInferenceJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'research_persona_inference';
  payload: Record<string, unknown>;
}

export interface ResearchIntentDetectionJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'research_intent_detection';
  signals: Record<string, unknown>[];
  payload: Record<string, unknown>;
}

export interface ResearchContextSummaryJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'research_context_summary';
  payload: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job Data Interfaces — Qualification Department
// ═══════════════════════════════════════════════════════════════════════════

export interface QualifyRelevanceJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'qualify_relevance';
  icpCriteria: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface QualifyScoringJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'qualify_scoring';
  scoringModelId: string;
  payload: Record<string, unknown>;
}

export interface QualifyIcpFitJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'qualify_icp_fit';
  icpProfileId: string;
  payload: Record<string, unknown>;
}

export interface QualifyDuplicateReviewJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'qualify_duplicate_review';
  candidateDuplicateIds: number[];
  payload: Record<string, unknown>;
}

export interface QualifyActionRecommendJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'qualify_action_recommend';
  qualificationResult: Record<string, unknown>;
  payload: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job Data Interfaces — Outreach Department
// ═══════════════════════════════════════════════════════════════════════════

export interface OutreachPersonalizationJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'outreach_personalization';
  templateId: string;
  personaData: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface OutreachCopyGenerationJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'outreach_copy_generation';
  channel: 'email' | 'sms' | 'linkedin' | 'dm';
  templateId?: string;
  payload: Record<string, unknown>;
}

export interface OutreachComplianceJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'outreach_compliance';
  messageContent: string;
  channel: string;
  payload: Record<string, unknown>;
}

export interface OutreachCtaGenerationJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'outreach_cta_generation';
  offerType: string;
  payload: Record<string, unknown>;
}

export interface OutreachVariantTestJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'outreach_variant_test';
  variantGroupId: string;
  variants: Record<string, unknown>[];
  payload: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job Data Interfaces — Reply Department
// ═══════════════════════════════════════════════════════════════════════════

export interface ReplyClassificationJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'reply_classification';
  messageId: number;
  messageContent: string;
  payload: Record<string, unknown>;
}

export interface ReplyObjectionHandlingJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'reply_objection_handling';
  messageId: number;
  objectionType: string;
  payload: Record<string, unknown>;
}

export interface ReplyQualificationQuestionJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'reply_qualification_question';
  messageId: number;
  questionContent: string;
  payload: Record<string, unknown>;
}

export interface ReplyEscalationJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'reply_escalation';
  messageId: number;
  escalationReason: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  payload: Record<string, unknown>;
}

export interface ReplySentimentJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'reply_sentiment';
  messageId: number;
  messageContent: string;
  payload: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job Data Interfaces — Follow-up Department
// ═══════════════════════════════════════════════════════════════════════════

export interface FollowupTimingJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'followup_timing';
  sequenceId: number;
  currentStep: number;
  payload: Record<string, unknown>;
}

export interface FollowupSequenceSelectJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'followup_sequence_select';
  leadStage: string;
  payload: Record<string, unknown>;
}

export interface FollowupVariationJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'followup_variation';
  sequenceId: number;
  stepOrder: number;
  payload: Record<string, unknown>;
}

export interface FollowupReengagementJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'followup_reengagement';
  lastContactDate: string; // ISO date
  dormantDays: number;
  payload: Record<string, unknown>;
}

export interface FollowupStopRuleJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'followup_stop_rule';
  sequenceId: number;
  ruleType: 'max_attempts' | 'unsubscribe' | 'negative_reply' | 'converted' | 'manual';
  payload: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job Data Interfaces — Analytics / Maintenance
// ═══════════════════════════════════════════════════════════════════════════

export interface LifecycleEventJobData {
  tenantId: number;
  canonicalLeadId: number;
  agentType: 'lifecycle_tracker';
  eventType: string;
  fromStage?: string;
  toStage?: string;
  metadata: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface InventoryAgingJobData {
  tenantId: number;
  agentType: 'inventory_aging';
  inventoryPoolId?: number;
  agingThresholdDays: number;
  payload: Record<string, unknown>;
}

export interface StatsRollupJobData {
  tenantId: number;
  agentType: 'stats_rollup';
  rollupPeriod: 'hourly' | 'daily' | 'weekly' | 'monthly';
  targetDate: string; // ISO date
  payload: Record<string, unknown>;
}

export interface SourceHealthCalcJobData {
  tenantId: number;
  agentType: 'source_health_calc';
  sourceId: number;
  payload: Record<string, unknown>;
}

export interface YieldCalcJobData {
  tenantId: number;
  agentType: 'yield_calc';
  campaignId?: number;
  sourceId?: number;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  payload: Record<string, unknown>;
}

export interface CostTrackingJobData {
  tenantId: number;
  agentType: 'cost_tracker';
  resourceType: 'api_call' | 'llm_token' | 'scrape' | 'enrichment';
  unitCost: number;
  quantity: number;
  payload: Record<string, unknown>;
}

export interface ReprocessingJobData {
  tenantId: number;
  agentType: 'reprocessor';
  leadIds?: number[];
  canonicalLeadIds?: number[];
  reprocessReason: string;
  targetQueue: string;
  payload: Record<string, unknown>;
}
