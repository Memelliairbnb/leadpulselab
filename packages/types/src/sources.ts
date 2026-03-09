export interface PlatformSource {
  id: number;
  tenantId: number;
  name: string;
  sourceType: SourceType;
  adapterKey: string;
  isEnabled: boolean;
  configJson: Record<string, unknown>;
  rateLimitRpm: number;
  lastScanAt: Date | null;
  errorCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type SourceType = 'search_engine' | 'social' | 'forum' | 'directory';

export interface RawSource {
  id: number;
  tenantId: number;
  scanJobId: number;
  sourceName: string;
  sourceType: string;
  sourceUrl: string;
  fetchMethod: string;
  sourcePayloadJson: unknown;
  checksumHash: string;
  fetchedAt: Date;
  createdAt: Date;
}

export interface SourceError {
  id: number;
  sourceId: number | null;
  scanJobId: number | null;
  errorType: SourceErrorType;
  errorMessage: string;
  errorContext: Record<string, unknown>;
  resolved: boolean;
  createdAt: Date;
}

export type SourceErrorType =
  | 'fetch_failed'
  | 'parse_error'
  | 'rate_limited'
  | 'auth_expired'
  | 'timeout';

export interface RawSourcePayload {
  sourceUrl: string;
  fetchMethod: string;
  payload: unknown;
  fetchedAt: Date;
}

export interface RawLeadCandidate {
  platform: string;
  profileName: string | null;
  profileUrl: string | null;
  sourceUrl: string;
  matchedKeywords: string[];
  rawText: string;
  rawMetadata: Record<string, unknown>;
  locationText: string | null;
  contactHint: string | null;
  contentDate: Date | null;
}

export interface FetchParams {
  keywords: string[];
  maxResults?: number;
  since?: Date;
  config?: Record<string, unknown>;
}

export interface SourceAdapter {
  name: string;
  sourceType: SourceType;
  fetch(params: FetchParams): Promise<RawSourcePayload[]>;
  extractLeads(payload: RawSourcePayload): RawLeadCandidate[];
}
