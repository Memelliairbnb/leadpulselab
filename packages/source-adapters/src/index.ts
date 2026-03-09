export { getAdapter, registerAdapter } from './registry';
export { GoogleSearchAdapter } from './adapters/google-search';
export { RedditAdapter } from './adapters/reddit';
export { CraigslistAdapter } from './adapters/craigslist';
export { PublicForumAdapter } from './adapters/public-forums';
export { RssFeedAdapter } from './adapters/rss-feed';
export { ReviewScraperAdapter } from './adapters/review-scraper';
export { buildDiscoveryQueries, INTENT_PHRASES, DEFAULT_TARGET_SITES } from './query-builder';
export type { KeywordCategoryInput, QueryBuilderOptions } from './query-builder';
