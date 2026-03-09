export interface AgentCostRecord {
  id: number;
  tenantId: number | null;
  agentRunId: number;
  agentType: string;
  modelUsed: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  createdAt: Date;
}

export type CostType = 'api_call' | 'proxy' | 'compute' | 'storage';

export interface SourceRunCost {
  id: number;
  tenantId: number | null;
  sourceId: number;
  sourceFetchRunId: number | null;
  costType: CostType | null;
  costCents: number;
  createdAt: Date;
}

export interface YieldMetric {
  id: number;
  tenantId: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  totalQueries: number;
  totalFetches: number;
  rawLeadsCaptured: number;
  normalizedLeads: number;
  verifiedLeads: number;
  hotLeads: number;
  contactedLeads: number;
  repliedLeads: number;
  convertedLeads: number;
  costPerRawLeadCents: number;
  costPerNormalizedLeadCents: number;
  costPerVerifiedLeadCents: number;
  costPerHotLeadCents: number;
  costPerConversionCents: number;
  totalCostCents: number;
  calculatedAt: Date | null;
}
