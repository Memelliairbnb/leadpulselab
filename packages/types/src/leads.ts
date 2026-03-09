export interface RawLead {
  id: number;
  tenantId: number;
  rawSourceId: number;
  platform: string;
  profileName: string | null;
  profileUrl: string | null;
  sourceUrl: string;
  matchedKeywords: string[];
  rawText: string;
  rawMetadataJson: Record<string, unknown>;
  locationText: string | null;
  contactHint: string | null;
  contentDate: Date | null;
  capturedAt: Date;
  textHash: string;
  isProcessed: boolean;
  processingStatus: RawLeadProcessingStatus;
  createdAt: Date;
}

export type RawLeadProcessingStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'discarded';

export interface QualifiedLead {
  id: number;
  tenantId: number;
  rawLeadId: number | null;
  fullName: string | null;
  companyName: string | null;
  leadType: string;
  leadTypeId: number | null;
  intentLevel: IntentLevel;
  leadScore: number;
  aiConfidence: number | null;
  aiSummary: string;
  aiSignalsJson: string[];
  aiRecommendedAction: string | null;
  city: string | null;
  state: string | null;
  country: string;
  platform: string;
  profileUrl: string | null;
  contactMethod: string | null;
  contactType: ContactType | null;
  status: LeadStatus;
  assignedToUserId: number | null;
  needsReview: boolean;
  isDuplicate: boolean;
  duplicateOfLeadId: number | null;
  duplicateConfidence: number | null;
  sourceContentDate: Date | null;
  lastRescoredAt: Date | null;
  resolutionStatus: ResolutionStatus;
  identityConfidence: number;
  emailVerified: boolean;
  phoneVerified: boolean;
  resolvedEmail: string | null;
  resolvedPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ResolutionStatus =
  | 'signal_found'
  | 'profile_extracted'
  | 'identity_candidate'
  | 'contact_candidate'
  | 'email_found'
  | 'phone_found'
  | 'qualified'
  | 'partial_inventory'
  | 'discarded';

export type IntentLevel = 'high' | 'medium' | 'low' | 'archive';

export type LeadStatus =
  | 'new'
  | 'reviewing'
  | 'approved'
  | 'outreach_sent'
  | 'nurturing'
  | 'converted'
  | 'archived';

export type ContactType = 'dm' | 'email' | 'phone' | 'comment' | 'unknown';

export interface LeadTag {
  id: number;
  tenantId: number;
  name: string;
  category: 'signal' | 'status' | 'custom';
  createdAt: Date;
}

export interface QualifiedLeadTag {
  id: number;
  leadId: number;
  tagId: number;
  source: 'ai' | 'manual';
  createdAt: Date;
}

export interface LeadContact {
  id: number;
  leadId: number;
  contactType: string;
  contactValue: string;
  isPrimary: boolean;
  isVerified: boolean;
  source: 'extracted' | 'enriched' | 'manual';
  createdAt: Date;
}

export interface LeadActivity {
  id: number;
  leadId: number;
  activityType: LeadActivityType;
  description: string | null;
  metadataJson: Record<string, unknown>;
  performedBy: number | null;
  createdAt: Date;
}

export type LeadActivityType =
  | 'created'
  | 'scored'
  | 'rescored'
  | 'status_changed'
  | 'assigned'
  | 'outreach_drafted'
  | 'outreach_approved'
  | 'outreach_sent'
  | 'note_added'
  | 'duplicate_flagged'
  | 'tag_added'
  | 'tag_removed';
