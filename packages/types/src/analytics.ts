export interface TenantDashboardDailyStat {
  id: number;
  tenantId: number;
  statDate: string;
  leadsDiscovered: number;
  leadsQualified: number;
  leadsContacted: number;
  repliesReceived: number;
  conversions: number;
  hotLeadsCount: number;
  warmLeadsCount: number;
  agedLeadsCount: number;
  outreachDraftsGenerated: number;
  outreachApproved: number;
  scanJobsCompleted: number;
  scanJobsFailed: number;
  agentRunsTotal: number;
  agentCostCents: number;
  createdAt: Date;
}

export interface SourceHealthDailyStat {
  id: number;
  tenantId: number | null;
  sourceId: number;
  statDate: string;
  fetchCount: number;
  successCount: number;
  failureCount: number;
  leadsFound: number;
  duplicateRate: string;
  enrichmentSuccessRate: string;
  avgLeadScore: string;
  createdAt: Date;
}

export interface CampaignPerformanceDailyStat {
  id: number;
  tenantId: number;
  campaignName: string | null;
  statDate: string;
  leadsAssigned: number;
  contactsMade: number;
  repliesReceived: number;
  conversions: number;
  createdAt: Date;
}

export interface InventoryCountBySegment {
  id: number;
  tenantId: number | null;
  segmentName: string | null;
  temperature: string | null;
  leadCount: number;
  avgValueScore: string;
  snapshotAt: Date;
}
