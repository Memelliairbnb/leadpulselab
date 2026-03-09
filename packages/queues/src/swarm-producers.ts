import { getQueue } from './queues';
import {
  SWARM_QUEUE_NAMES,
  MAINTENANCE_QUEUE_NAMES,
} from './swarm-queues';
import type {
  QueryPlanningJobData,
  QueryExpansionJobData,
  SearchExecutionJobData,
  SourceFetchJobData,
  RawCaptureJobData,
  NormalizationJobData,
  ScrubDedupeJobData,
  CanonicalEnrichmentJobData,
  PrioritizationJobData,
  InventoryAssignmentJobData,
  LifecycleEventJobData,
  StatsRollupJobData,
  InventoryAgingJobData,
  SourceHealthCalcJobData,
  YieldCalcJobData,
  CostTrackingJobData,
} from './swarm-queues';

// ─── Discovery Swarm Producers ──────────────────────────────────────────────

export async function enqueueQueryPlanning(data: QueryPlanningJobData) {
  const queue = getQueue(SWARM_QUEUE_NAMES.QUERY_PLANNING);
  await queue.add('query_planning', data, {
    jobId: `qplan-${data.tenantId}-${data.campaignId}`,
  });
}

export async function enqueueQueryExpansion(data: QueryExpansionJobData) {
  const queue = getQueue(SWARM_QUEUE_NAMES.QUERY_EXPANSION);
  await queue.add('query_expansion', data, {
    jobId: `qexp-${data.tenantId}-${data.planId}-${data.expansionStrategy}`,
  });
}

export async function enqueueSearchExecution(data: SearchExecutionJobData) {
  const queue = getQueue(SWARM_QUEUE_NAMES.SEARCH_EXECUTION);
  await queue.add('search_execution', data, {
    jobId: `search-${data.tenantId}-${data.queryId}-${data.sourceType}`,
  });
}

export async function enqueueSourceFetch(data: SourceFetchJobData) {
  const queue = getQueue(SWARM_QUEUE_NAMES.SOURCE_FETCH);
  await queue.add('source_fetch', data, {
    jobId: `fetch-${data.tenantId}-${data.sourceId}-${Date.now()}`,
  });
}

export async function enqueueRawCapture(data: RawCaptureJobData) {
  const queue = getQueue(SWARM_QUEUE_NAMES.RAW_CAPTURE);
  await queue.add('raw_capture', data, {
    jobId: `capture-${data.tenantId}-${data.sourceId}-${Date.now()}`,
  });
}

export async function enqueueNormalization(data: NormalizationJobData) {
  const queue = getQueue(SWARM_QUEUE_NAMES.NORMALIZATION);
  await queue.add('normalization', data, {
    jobId: `norm-${data.tenantId}-${data.rawLeadId}`,
  });
}

export async function enqueueScrubDedupe(data: ScrubDedupeJobData) {
  const queue = getQueue(SWARM_QUEUE_NAMES.SCRUB_DEDUPE);
  await queue.add('scrub_dedupe', data, {
    jobId: `scrub-${data.tenantId}-${data.leadId}-${data.dedupeStrategy}`,
  });
}

export async function enqueueCanonicalEnrichment(data: CanonicalEnrichmentJobData) {
  const queue = getQueue(SWARM_QUEUE_NAMES.CANONICAL_ENRICHMENT);
  await queue.add('canonical_enrichment', data, {
    jobId: `cenrich-${data.tenantId}-${data.canonicalLeadId}`,
  });
}

export async function enqueuePrioritization(data: PrioritizationJobData) {
  const queue = getQueue(SWARM_QUEUE_NAMES.PRIORITIZATION);
  await queue.add('prioritization', data, {
    jobId: `prio-${data.tenantId}-${data.canonicalLeadId}`,
  });
}

export async function enqueueInventoryAssignment(data: InventoryAssignmentJobData) {
  const queue = getQueue(SWARM_QUEUE_NAMES.INVENTORY_ASSIGNMENT);
  await queue.add('inventory_assignment', data, {
    jobId: `assign-${data.tenantId}-${data.canonicalLeadId}`,
  });
}

// ─── Maintenance Producers ──────────────────────────────────────────────────

export async function enqueueLifecycleEvent(data: LifecycleEventJobData) {
  const queue = getQueue(MAINTENANCE_QUEUE_NAMES.LIFECYCLE_EVENT);
  await queue.add('lifecycle_event', data, {
    jobId: `lifecycle-${data.tenantId}-${data.canonicalLeadId}-${data.eventType}-${Date.now()}`,
  });
}

export async function enqueueStatsRollup(data: StatsRollupJobData) {
  const queue = getQueue(MAINTENANCE_QUEUE_NAMES.STATS_ROLLUP);
  await queue.add('stats_rollup', data, {
    jobId: `rollup-${data.tenantId}-${data.rollupPeriod}-${data.targetDate}`,
  });
}

export async function enqueueInventoryAging(data: InventoryAgingJobData) {
  const queue = getQueue(MAINTENANCE_QUEUE_NAMES.INVENTORY_AGING);
  await queue.add('inventory_aging', data, {
    jobId: `aging-${data.tenantId}-${Date.now()}`,
  });
}

export async function enqueueSourceHealthCalc(data: SourceHealthCalcJobData) {
  const queue = getQueue(MAINTENANCE_QUEUE_NAMES.SOURCE_HEALTH_CALC);
  await queue.add('source_health_calc', data, {
    jobId: `shealth-${data.tenantId}-${data.sourceId}-${Date.now()}`,
  });
}

export async function enqueueYieldCalc(data: YieldCalcJobData) {
  const queue = getQueue(MAINTENANCE_QUEUE_NAMES.YIELD_CALC);
  await queue.add('yield_calc', data, {
    jobId: `yield-${data.tenantId}-${data.periodStart}`,
  });
}

export async function enqueueCostTracking(data: CostTrackingJobData) {
  const queue = getQueue(MAINTENANCE_QUEUE_NAMES.COST_TRACKING);
  await queue.add('cost_tracking', data, {
    jobId: `cost-${data.tenantId}-${data.resourceType}-${Date.now()}`,
  });
}
