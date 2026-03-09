export type QueryType =
  | 'keyword'
  | 'hashtag'
  | 'long_tail'
  | 'expanded'
  | 'location_targeted';

export type ExpansionSource =
  | 'original'
  | 'ai_expanded'
  | 'variation'
  | 'synonym';

export type FetchMethod = 'api' | 'scrape' | 'rss' | 'search';

export interface QueryRun {
  id: number;
  tenantId: number | null;
  sourceId: number;
  queryText: string;
  queryType: QueryType | null;
  keywordId: number | null;
  expansionSource: ExpansionSource | null;
  resultsCount: number;
  leadsExtracted: number;
  duplicatesFound: number;
  agentRunId: number | null;
  executedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface SourceFetchRun {
  id: number;
  tenantId: number | null;
  queryRunId: number | null;
  sourceId: number;
  fetchUrl: string;
  fetchMethod: FetchMethod | null;
  httpStatus: number | null;
  responseSizeBytes: number | null;
  itemsFound: number;
  success: boolean;
  errorMessage: string | null;
  fetchedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface RawSourceBlob {
  id: number;
  sourceFetchRunId: number;
  contentType: string | null;
  blobData: string;
  checksumHash: string;
  byteSize: number;
  compressed: boolean;
  createdAt: Date;
}

export interface SourceHealthMetric {
  id: number;
  sourceId: number;
  tenantId: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  fetchCount: number;
  successCount: number;
  failureCount: number;
  totalLeadsFound: number;
  uniqueLeadsFound: number;
  duplicateRate: string;
  parseSuccessRate: string;
  enrichmentSuccessRate: string;
  avgLeadScore: string;
  campaignYieldRate: string;
  freshnessAvgDays: string;
  qualityScore: number;
  calculatedAt: Date | null;
}

export interface SourceQualityScore {
  id: number;
  sourceId: number;
  qualityScore: number;
  reliabilityScore: number;
  freshnessScore: number;
  yieldScore: number;
  lastCalculatedAt: Date | null;
  updatedAt: Date;
}
