export type LifecycleEventType =
  | 'state_change'
  | 'enrichment'
  | 'scoring'
  | 'merge'
  | 'assignment'
  | 'contact'
  | 'reply'
  | 'conversion'
  | 'archive'
  | 'reprocess';

export type CampaignStatus =
  | 'assigned'
  | 'contacted'
  | 'replied'
  | 'converted'
  | 'removed';

export interface LeadLifecycleEvent {
  id: number;
  tenantId: number | null;
  canonicalLeadId: number;
  fromState: string | null;
  toState: string;
  eventType: LifecycleEventType;
  metadataJson: Record<string, unknown>;
  triggeredBy: string;
  triggeredById: number | null;
  createdAt: Date;
}

export interface CampaignAssignment {
  id: number;
  tenantId: number;
  canonicalLeadId: number;
  campaignName: string | null;
  assignedAt: Date;
  status: CampaignStatus;
  contactedAt: Date | null;
  repliedAt: Date | null;
  convertedAt: Date | null;
  removedAt: Date | null;
  removalReason: string | null;
}

export interface PipelineHistoryRecord {
  id: number;
  tenantId: number;
  canonicalLeadId: number;
  stage: string;
  enteredAt: Date;
  exitedAt: Date | null;
  durationMs: number | null;
}
