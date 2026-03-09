export type CanonicalType = 'person' | 'business' | 'professional';

export type VerificationStatus =
  | 'unverified'
  | 'partially_verified'
  | 'verified'
  | 'stale';

export type FullLifecycleState =
  | 'discovered'
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
  | 'monetized'
  | 'archived'
  | 'opted_out';

export interface CanonicalLead {
  id: number;
  tenantId: number | null;
  canonicalType: CanonicalType;
  normalizedName: string;
  normalizedDomain: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  companyName: string | null;
  industryInference: string | null;
  personaInference: string | null;
  city: string | null;
  state: string | null;
  country: string;
  geoRegion: string | null;
  freshnessScore: number;
  verificationStatus: VerificationStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastEnrichedAt: Date | null;
  signalCount: number;
  sourceCount: number;
  mergeCount: number;
  lifecycleState: FullLifecycleState;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadIdentity {
  id: number;
  canonicalLeadId: number;
  platform: string;
  platformId: string | null;
  profileUrl: string | null;
  profileName: string | null;
  email: string | null;
  phone: string | null;
  identityType: string;
  confidence: string;
  source: string;
  verified: boolean;
  createdAt: Date;
}

export interface IdentityLink {
  id: number;
  identityAId: number;
  identityBId: number;
  linkType: string;
  confidence: string;
  evidenceJson: Record<string, unknown>;
  createdBy: string;
  reviewed: boolean;
  createdAt: Date;
}

export interface LeadDomain {
  id: number;
  canonicalLeadId: number;
  domain: string;
  domainType: string;
  verified: boolean;
  createdAt: Date;
}

export interface LeadFreshnessScore {
  id: number;
  canonicalLeadId: number;
  score: number;
  signalRecencyDays: number;
  activityCount30d: number;
  calculatedAt: Date;
}

export interface LeadVerificationStatusRecord {
  id: number;
  canonicalLeadId: number;
  verificationType: string;
  result: string;
  detailsJson: Record<string, unknown>;
  verifiedAt: Date;
}
