export interface SourceScanJobData {
  tenantId: number;
  scanJobId: number;
  sourceId: number;
  keywords: string[];
}

export interface LeadIngestionJobData {
  tenantId: number;
  rawSourceId: number;
  rawLeadIds: number[];
}

export interface LeadAnalysisJobData {
  tenantId: number;
  rawLeadId: number;
}

export interface LeadDedupeJobData {
  tenantId: number;
  qualifiedLeadId: number;
  type?: 'single' | 'full_sweep';
}

export interface LeadEnrichmentJobData {
  tenantId: number;
  qualifiedLeadId: number;
}

export interface OutreachGenerationJobData {
  tenantId: number;
  qualifiedLeadId: number;
}

export interface RescoreJobData {
  tenantId: number;
  qualifiedLeadId: number;
}

export interface StaleArchiveJobData {
  tenantId: number;
  qualifiedLeadId: number;
}
