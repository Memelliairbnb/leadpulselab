export interface ScanJob {
  id: number;
  tenantId: number;
  sourceId: number;
  status: ScanJobStatus;
  triggerType: 'scheduled' | 'manual';
  triggeredBy: number | null;
  keywordsUsed: string[];
  startedAt: Date | null;
  completedAt: Date | null;
  resultsCount: number;
  leadsFound: number;
  errorMessage: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

export type ScanJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobRun {
  id: number;
  tenantId: number;
  jobType: JobType;
  queueName: string | null;
  status: JobRunStatus;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown>;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
}

export type JobType =
  | 'source_scan'
  | 'ai_analysis'
  | 'dedupe_sweep'
  | 'rescore'
  | 'outreach_gen'
  | 'stale_archive'
  | 'health_check'
  | 'enrichment';

export type JobRunStatus = 'pending' | 'running' | 'completed' | 'failed';
