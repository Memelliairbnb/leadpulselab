export type ReprocessingRunType =
  | 'full_reparse'
  | 'enrichment_upgrade'
  | 'scoring_recalc'
  | 'pipeline_upgrade';

export type ReprocessingRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type PipelineType =
  | 'parser'
  | 'enricher'
  | 'scorer'
  | 'classifier'
  | 'scrubber';

export interface ReprocessingRun {
  id: number;
  tenantId: number | null;
  runType: ReprocessingRunType | null;
  targetTable: string | null;
  filterCriteriaJson: Record<string, unknown>;
  pipelineVersionId: number | null;
  status: ReprocessingRunStatus;
  totalRecords: number;
  processedRecords: number;
  updatedRecords: number;
  errorCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface PipelineVersion {
  id: number;
  pipelineType: PipelineType | null;
  version: string;
  description: string | null;
  changesJson: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
}

export interface EnrichmentVersion {
  id: number;
  providerName: string;
  version: string;
  capabilitiesJson: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
}
