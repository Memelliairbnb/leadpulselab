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

export interface InstagramDiscoveryJobData {
  tenantId: number;
  searchQuery: string;
  searchType: string;
  discoveryRunId: number;
}

export interface InstagramScrubJobData {
  tenantId: number;
  rawProfileId: number;
  discoveryRunId: number;
}

export interface InstagramEnrichmentJobData {
  tenantId: number;
  candidateId: number;
}

export interface VideoProcessingJobData {
  tenantId: number;
  jobId: number;
}
