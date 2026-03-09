// Level 2 queue names — reserved now for agent infrastructure expansion
// These queues support the specialized agent workers coming in Level 2

export const LEVEL2_QUEUE_NAMES = {
  LEAD_RESEARCH: 'lead_research_queue',
  LEAD_QUALIFICATION: 'lead_qualification_queue',
  REPLY_ANALYSIS: 'reply_analysis_queue',
  CONVERSATION: 'conversation_queue',
  FOLLOWUP: 'followup_queue',
  OPPORTUNITY_INSIGHT: 'opportunity_insight_queue',
} as const;

// Standard job payload structure for all agent queues
export interface AgentJobPayload {
  tenantId: number;
  leadId: number;
  agentType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attemptCount: number;
  promptTemplateId?: number;
  createdAt: string; // ISO date
}

// Level 2 job data types

export interface LeadResearchJobData {
  tenantId: number;
  leadId: number;
  agentType: 'lead_researcher';
  researchDepth: 'basic' | 'standard' | 'deep';
  payload: Record<string, unknown>;
}

export interface LeadQualificationJobData {
  tenantId: number;
  leadId: number;
  agentType: 'lead_qualifier';
  qualificationCriteria: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface ReplyAnalysisJobData {
  tenantId: number;
  leadId: number;
  agentType: 'reply_analyzer';
  messageId: number;
  payload: Record<string, unknown>;
}

export interface ConversationJobData {
  tenantId: number;
  leadId: number;
  agentType: 'conversation_handler';
  conversationHistory: Array<{ role: string; content: string }>;
  payload: Record<string, unknown>;
}

export interface FollowupJobData {
  tenantId: number;
  leadId: number;
  agentType: 'followup_generator';
  sequenceId: number;
  stepOrder: number;
  payload: Record<string, unknown>;
}

export interface OpportunityInsightJobData {
  tenantId: number;
  leadId?: number;
  agentType: 'opportunity_analyzer';
  analysisType: 'regional_trend' | 'objection_pattern' | 'conversion_pattern' | 'keyword_performance';
  payload: Record<string, unknown>;
}
