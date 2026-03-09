import type { DiscoveryQuery, IntentType } from '@alh/types';

/**
 * Default intent signal phrases grouped by intent type.
 * These get combined with industry keywords to form search queries
 * that find people actively expressing a need.
 */
export const INTENT_PHRASES: Array<{ phrase: string; intentType: IntentType }> = [
  { phrase: 'looking for', intentType: 'seeking_help' },
  { phrase: 'need help with', intentType: 'seeking_help' },
  { phrase: 'recommend a', intentType: 'asking_recommendation' },
  { phrase: 'how do I fix', intentType: 'expressing_pain' },
  { phrase: 'anyone know', intentType: 'asking_recommendation' },
  { phrase: 'who can help', intentType: 'seeking_help' },
  { phrase: 'need a', intentType: 'requesting_service' },
  { phrase: 'any suggestions', intentType: 'asking_recommendation' },
  { phrase: 'bad experience with', intentType: 'switching_provider' },
  { phrase: 'looking for alternative', intentType: 'switching_provider' },
  { phrase: 'how do I improve', intentType: 'expressing_pain' },
  { phrase: 'can someone recommend', intentType: 'asking_recommendation' },
];

/** High-signal community sites where people publicly ask for help */
export const DEFAULT_TARGET_SITES = [
  'reddit.com',
  'quora.com',
  'yelp.com',
  'trustpilot.com',
  'bbb.org',
];

export interface KeywordCategoryInput {
  name: string;
  keywords: Array<{ keyword: string; type: string }>;
}

export interface QueryBuilderOptions {
  /** Keyword categories from the vertical template */
  keywordCategories: KeywordCategoryInput[];
  /** Override intent phrases (defaults to INTENT_PHRASES) */
  intentPhrases?: Array<{ phrase: string; intentType: IntentType }>;
  /** Override target sites (defaults to DEFAULT_TARGET_SITES) */
  targetSites?: string[];
  /** Extra intent phrases from the template config */
  templateIntentPhrases?: string[];
  /** Max intent phrases per query group to avoid overly long queries */
  maxIntentPhrasesPerQuery?: number;
  /** Max keywords per query to avoid overly long queries */
  maxKeywordsPerQuery?: number;
}

/**
 * Builds an array of intent-focused discovery queries from industry keywords
 * and intent signal phrases.
 *
 * Strategy:
 * 1. Group intent phrases into small batches (2-3 per query)
 * 2. For each keyword category, combine keyword terms with intent phrase batches
 * 3. Produce site-scoped variants for each target site
 * 4. Also produce a general (no site:) variant for broader coverage
 */
export function buildDiscoveryQueries(options: QueryBuilderOptions): DiscoveryQuery[] {
  const {
    keywordCategories,
    targetSites = DEFAULT_TARGET_SITES,
    maxIntentPhrasesPerQuery = 3,
    maxKeywordsPerQuery = 3,
  } = options;

  // Merge default intent phrases with any template-specific ones
  const phrases = [...INTENT_PHRASES];
  if (options.templateIntentPhrases) {
    for (const p of options.templateIntentPhrases) {
      if (!phrases.some((existing) => existing.phrase === p)) {
        phrases.push({ phrase: p, intentType: 'seeking_help' });
      }
    }
  }
  if (options.intentPhrases) {
    // Full override if provided
    phrases.length = 0;
    phrases.push(...options.intentPhrases);
  }

  const queries: DiscoveryQuery[] = [];
  const intentBatches = batchArray(phrases, maxIntentPhrasesPerQuery);

  for (const category of keywordCategories) {
    // Only use phrase-type keywords for search queries (skip hashtags, regex)
    const phraseKeywords = category.keywords
      .filter((k) => k.type === 'phrase')
      .map((k) => k.keyword);

    if (phraseKeywords.length === 0) continue;

    const keywordBatches = batchArray(phraseKeywords, maxKeywordsPerQuery);

    for (const keywordBatch of keywordBatches) {
      for (const intentBatch of intentBatches) {
        const intentPart = intentBatch
          .map((ip) => `"${ip.phrase}"`)
          .join(' OR ');

        const keywordPart = keywordBatch
          .map((kw) => `"${kw}"`)
          .join(' OR ');

        const baseQuery = `(${intentPart}) (${keywordPart})`;
        const intentPhraseStrings = intentBatch.map((ip) => ip.phrase);

        // General query (no site restriction)
        queries.push({
          query: baseQuery,
          intentPhrases: intentPhraseStrings,
          industryKeywords: keywordBatch,
          category: category.name,
        });

        // Site-scoped queries for each target site
        for (const site of targetSites) {
          queries.push({
            query: `${baseQuery} site:${site}`,
            intentPhrases: intentPhraseStrings,
            industryKeywords: keywordBatch,
            targetSites: [site],
            category: category.name,
          });
        }
      }
    }
  }

  return queries;
}

/** Split an array into batches of a given size */
function batchArray<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}
