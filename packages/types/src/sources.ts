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

// --- Intent signal types ---

export type IntentType =
  | 'seeking_help'
  | 'requesting_service'
  | 'expressing_pain'
  | 'switching_provider'
  | 'asking_recommendation';

export interface IntentSignal {
  /** The intent phrase that matched, e.g. "need help with" */
  signalPhrase: string;
  /** Classified type of intent */
  intentType: IntentType;
  /** 0-1 confidence score */
  confidence: number;
  /** The actual text fragment that matched */
  matchedText: string;
}

export interface DiscoveryQuery {
  /** The fully-built search query string */
  query: string;
  /** Intent phrases included in this query */
  intentPhrases: string[];
  /** Industry keywords included in this query */
  industryKeywords: string[];
  /** Optional site: operators applied */
  targetSites?: string[];
  /** The keyword category this query was generated from */
  category: string;
}
