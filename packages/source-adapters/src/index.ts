export { getAdapter, registerAdapter } from './registry';
export { GoogleSearchAdapter } from './adapters/google-search';
export { RedditAdapter } from './adapters/reddit';
export { buildDiscoveryQueries, INTENT_PHRASES, DEFAULT_TARGET_SITES } from './query-builder';
export type { KeywordCategoryInput, QueryBuilderOptions } from './query-builder';
