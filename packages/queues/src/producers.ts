import { getQueue, QUEUE_NAMES } from './queues';
import type {
  SourceScanJobData,
  LeadAnalysisJobData,
  LeadDedupeJobData,
  LeadEnrichmentJobData,
  OutreachGenerationJobData,
  RescoreJobData,
} from './types';

export async function enqueueSourceScan(data: SourceScanJobData) {
  const queue = getQueue(QUEUE_NAMES.SOURCE_SCAN);
  await queue.add('scan', data, {
    jobId: `scan-${data.scanJobId}`,
  });
}

export async function enqueueLeadAnalysis(data: LeadAnalysisJobData) {
  const queue = getQueue(QUEUE_NAMES.LEAD_ANALYSIS);
  await queue.add('analyze', data, {
    jobId: `analyze-${data.rawLeadId}`,
  });
}

export async function enqueueLeadDedupe(data: LeadDedupeJobData) {
  const queue = getQueue(QUEUE_NAMES.LEAD_DEDUPE);
  await queue.add('dedupe', data, {
    jobId: `dedupe-${data.qualifiedLeadId}-${Date.now()}`,
  });
}

export async function enqueueLeadEnrichment(data: LeadEnrichmentJobData) {
  const queue = getQueue(QUEUE_NAMES.LEAD_ENRICHMENT);
  await queue.add('enrich', data, {
    jobId: `enrich-${data.qualifiedLeadId}`,
  });
}

export async function enqueueOutreachGeneration(data: OutreachGenerationJobData) {
  const queue = getQueue(QUEUE_NAMES.OUTREACH_GENERATION);
  await queue.add('outreach', data, {
    jobId: `outreach-${data.qualifiedLeadId}-${Date.now()}`,
  });
}

export async function enqueueRescore(data: RescoreJobData) {
  const queue = getQueue(QUEUE_NAMES.RESCORE);
  await queue.add('rescore', data, {
    jobId: `rescore-${data.qualifiedLeadId}-${Date.now()}`,
  });
}
