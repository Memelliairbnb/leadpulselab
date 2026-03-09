export type AgentType =
  | 'lead_classifier'
  | 'lead_scorer'
  | 'outreach_drafter'
  | 'reply_analyzer'
  | 'lead_researcher'
  | 'followup_generator'
  | 'conversation_handler'
  | 'opportunity_analyzer'
  | 'lead_qualifier';

export interface AgentRun {
  id: number;
  tenantId: number;
  leadId: number | null;
  agentType: AgentType;
  promptTemplateId: number | null;
  promptVersion: number | null;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown>;
  status: AgentRunStatus;
  errorMessage: string | null;
  modelUsed: string | null;
  tokenCount: number | null;
  durationMs: number | null;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

export interface LeadIntelligence {
  id: number;
  tenantId: number;
  leadId: number;
  summary: string;
  signalsJson: string[];
  painPointsJson: string[];
  opportunitiesJson: string[];
  confidence: number | null;
  recommendedNextAction: string | null;
  modelVersion: string | null;
  agentRunId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: number;
  tenantId: number;
  leadId: number;
  direction: 'inbound' | 'outbound' | 'ai_draft';
  channel: string;
  subject: string | null;
  body: string;
  senderName: string | null;
  senderIdentifier: string | null;
  aiAnalysisJson: Record<string, unknown>;
  status: ConversationMessageStatus;
  parentMessageId: number | null;
  approvedBy: number | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  externalMessageId: string | null;
  createdAt: Date;
}

export type ConversationMessageStatus =
  | 'received'
  | 'read'
  | 'replied'
  | 'ai_draft'
  | 'approved'
  | 'sent';

export interface FollowupTask {
  id: number;
  tenantId: number;
  leadId: number;
  sequenceId: number | null;
  sequenceStep: number | null;
  channel: string;
  subject: string | null;
  body: string;
  dueAt: Date;
  status: FollowupTaskStatus;
  requiresApproval: boolean;
  approvedBy: number | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  agentRunId: number | null;
  createdAt: Date;
}

export type FollowupTaskStatus =
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'sent'
  | 'cancelled'
  | 'skipped';

export interface LeadInsight {
  id: number;
  tenantId: number;
  insightType: InsightType;
  title: string;
  description: string;
  dataJson: Record<string, unknown>;
  confidence: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  agentRunId: number | null;
  isActive: boolean;
  createdAt: Date;
}

export type InsightType =
  | 'regional_trend'
  | 'objection_pattern'
  | 'opportunity_theme'
  | 'keyword_performance'
  | 'source_quality'
  | 'conversion_pattern';

export interface AIPromptTemplate {
  id: number;
  tenantId: number | null;
  promptKey: string;
  promptVersion: number;
  systemPrompt: string;
  userPromptTemplate: string;
  industryContext: string | null;
  outputSchema: Record<string, unknown> | null;
  isActive: boolean;
  notes: string | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantFollowupSequence {
  id: number;
  tenantId: number;
  name: string;
  leadTypeId: number | null;
  isActive: boolean;
  createdAt: Date;
}

export interface TenantFollowupStep {
  id: number;
  sequenceId: number;
  stepOrder: number;
  delayDays: number;
  channel: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  tone: string;
  requiresApproval: boolean;
  skipIfReplied: boolean;
  createdAt: Date;
}

export interface TenantAutomationSettings {
  id: number;
  tenantId: number;
  automationMode: 'manual' | 'semi_auto' | 'auto';
  requiresOutreachApproval: boolean;
  requiresReplyApproval: boolean;
  requiresFollowupApproval: boolean;
  autoGenerateOutreach: boolean;
  autoGenerateFollowups: boolean;
  autoArchiveStaleLeads: boolean;
  staleLeadDays: number;
  maxOutreachPerDay: number | null;
  maxFollowupsPerDay: number | null;
  workingHoursStart: number;
  workingHoursEnd: number;
  workingTimezone: string;
  updatedAt: Date;
}

// Expanded lead workflow states — app-controlled, not LLM-controlled
export type LeadWorkflowState =
  | 'raw_created'
  | 'analysis_pending'
  | 'analysis_complete'
  | 'qualified'
  | 'duplicate_review'
  | 'enrichment_pending'
  | 'enrichment_complete'
  | 'outreach_draft_pending'
  | 'outreach_draft_ready'
  | 'outreach_approved'
  | 'outreach_sent'
  | 'reply_received'
  | 'reply_classified'
  | 'followup_scheduled'
  | 'followup_sent'
  | 'nurturing'
  | 'converted'
  | 'archived'
  | 'opted_out';
