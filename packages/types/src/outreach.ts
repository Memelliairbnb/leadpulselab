export interface OutreachDraft {
  id: number;
  tenantId: number;
  leadId: number;
  version: number;
  channel: string;
  subject: string | null;
  body: string;
  aiModelUsed: string | null;
  promptTemplate: string | null;
  status: OutreachStatus;
  reviewedBy: number | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export type OutreachStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'expired';

export interface OptOut {
  id: number;
  tenantId: number;
  identifier: string;
  identifierType: 'email' | 'phone' | 'profile_url' | 'name_platform';
  reason: string | null;
  requestedAt: Date;
  createdAt: Date;
}
