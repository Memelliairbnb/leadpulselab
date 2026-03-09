import type { SourceAdapter, FetchParams, RawSourcePayload, RawLeadCandidate, SourceType, DiscoveryQuery, IntentSignal } from '@alh/types';
import { logger } from '@alh/observability';
import { INTENT_PHRASES } from '../query-builder';

interface GoogleSearchResult {
  items?: Array<{
    title: string;
    link: string;
    snippet: string;
    pagemap?: {
      metatags?: Array<Record<string, string>>;
    };
  }>;
  searchInformation?: {
    totalResults: string;
  };
}

export class GoogleSearchAdapter implements SourceAdapter {
  name = 'google_search';
  sourceType: SourceType = 'search_engine';

  /**
   * Fetch using raw keyword strings (legacy path).
   * If params.config.discoveryQueries is provided, uses intent-focused queries instead.
   */
  async fetch(params: FetchParams): Promise<RawSourcePayload[]> {
    const discoveryQueries = params.config?.discoveryQueries as DiscoveryQuery[] | undefined;
    if (discoveryQueries && discoveryQueries.length > 0) {
      return this.fetchIntentQueries(discoveryQueries, params);
    }
    return this.fetchKeywords(params);
  }

  /**
   * Execute pre-built intent discovery queries against Google Custom Search.
   */
  async fetchIntentQueries(
    queries: DiscoveryQuery[],
    params: FetchParams,
  ): Promise<RawSourcePayload[]> {
    const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_CUSTOM_SEARCH_CX;
    if (!apiKey || !cx) {
      throw new Error('Google Custom Search API key and CX are required');
    }

    const results: RawSourcePayload[] = [];
    const maxResults = params.maxResults ?? 10;

    for (const dq of queries) {
      try {
        const url = new URL('https://www.googleapis.com/customsearch/v1');
        url.searchParams.set('key', apiKey);
        url.searchParams.set('cx', cx);
        url.searchParams.set('q', dq.query);
        url.searchParams.set('num', String(Math.min(maxResults, 10)));

        if (params.since) {
          const dateStr = params.since.toISOString().split('T')[0];
          url.searchParams.set('sort', `date:r:${dateStr}:`);
        }

        const res = await fetch(url.toString());
        if (!res.ok) {
          logger.error({ status: res.status, query: dq.query }, 'Google search API error');
          continue;
        }

        const data = (await res.json()) as GoogleSearchResult;
        results.push({
          sourceUrl: url.toString(),
          fetchMethod: 'api',
          payload: {
            ...data,
            _discoveryQuery: dq,
          },
          fetchedAt: new Date(),
        });

        logger.info(
          { query: dq.query, category: dq.category, resultCount: data.items?.length ?? 0 },
          'Intent-focused Google search completed',
        );
      } catch (error) {
        logger.error({ error, query: dq.query }, 'Intent query fetch failed');
      }
    }

    return results;
  }

  /**
   * Legacy: fetch using raw keyword strings.
   */
  private async fetchKeywords(params: FetchParams): Promise<RawSourcePayload[]> {
    const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_CUSTOM_SEARCH_CX;

    if (!apiKey || !cx) {
      throw new Error('Google Custom Search API key and CX are required');
    }

    const results: RawSourcePayload[] = [];
    const maxResults = params.maxResults ?? 10;

    for (const keyword of params.keywords) {
      try {
        const url = new URL('https://www.googleapis.com/customsearch/v1');
        url.searchParams.set('key', apiKey);
        url.searchParams.set('cx', cx);
        url.searchParams.set('q', keyword);
        url.searchParams.set('num', String(Math.min(maxResults, 10)));

        if (params.since) {
          const dateStr = params.since.toISOString().split('T')[0];
          url.searchParams.set('sort', `date:r:${dateStr}:`);
        }

        const res = await fetch(url.toString());
        if (!res.ok) {
          logger.error({ status: res.status, keyword }, 'Google search API error');
          continue;
        }

        const data = (await res.json()) as GoogleSearchResult;
        results.push({
          sourceUrl: url.toString(),
          fetchMethod: 'api',
          payload: data,
          fetchedAt: new Date(),
        });

        logger.info(
          { keyword, resultCount: data.items?.length ?? 0 },
          'Google search completed',
        );
      } catch (error) {
        logger.error({ error, keyword }, 'Google search fetch failed');
      }
    }

    return results;
  }

  extractLeads(payload: RawSourcePayload): RawLeadCandidate[] {
    const data = payload.payload as GoogleSearchResult & { _discoveryQuery?: DiscoveryQuery };
    if (!data.items) return [];

    const discoveryQuery = data._discoveryQuery;

    return data.items.map((item) => {
      const combinedText = `${item.title}\n${item.snippet}`;

      // Extract metadata from snippet
      const extractedMeta = this.extractSnippetMetadata(item.snippet, item.link);

      // Detect intent signals if we have a discovery query
      const intentSignals = discoveryQuery
        ? this.detectIntentSignals(combinedText, discoveryQuery.intentPhrases)
        : [];

      return {
        platform: this.detectPlatform(item.link),
        profileName: extractedMeta.username,
        profileUrl: extractedMeta.profileUrl,
        sourceUrl: item.link,
        matchedKeywords: discoveryQuery?.industryKeywords ?? [],
        rawText: combinedText,
        rawMetadata: {
          title: item.title,
          link: item.link,
          snippet: item.snippet,
          businessName: extractedMeta.businessName,
          contentDate: extractedMeta.contentDate,
          intentSignals,
          category: discoveryQuery?.category ?? null,
          intentPhrases: discoveryQuery?.intentPhrases ?? [],
        },
        locationText: null,
        contactHint: null,
        contentDate: extractedMeta.contentDate ? new Date(extractedMeta.contentDate) : null,
      };
    });
  }

  /**
   * Try to extract usernames, business names, and dates from a search snippet.
   */
  private extractSnippetMetadata(
    snippet: string,
    url: string,
  ): { username: string | null; profileUrl: string | null; businessName: string | null; contentDate: string | null } {
    let username: string | null = null;
    let profileUrl: string | null = null;
    let businessName: string | null = null;
    let contentDate: string | null = null;

    // Reddit username from URL: /r/subreddit/comments/.../title/ or /u/username
    const redditUserMatch = url.match(/reddit\.com\/u(?:ser)?\/([A-Za-z0-9_-]+)/);
    if (redditUserMatch) {
      username = redditUserMatch[1];
      profileUrl = `https://reddit.com/u/${username}`;
    }
    // Reddit post — extract subreddit context
    const redditSubMatch = url.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/);
    if (redditSubMatch && !username) {
      // Use "r/subreddit" as a context hint
      username = `r/${redditSubMatch[1]}`;
    }

    // Quora profile from URL
    const quoraMatch = url.match(/quora\.com\/profile\/([A-Za-z0-9_-]+)/);
    if (quoraMatch) {
      username = quoraMatch[1].replace(/-/g, ' ');
      profileUrl = `https://quora.com/profile/${quoraMatch[1]}`;
    }

    // Yelp business name from URL
    const yelpMatch = url.match(/yelp\.com\/biz\/([A-Za-z0-9_-]+)/);
    if (yelpMatch) {
      businessName = yelpMatch[1].replace(/-/g, ' ');
    }

    // BBB business
    const bbbMatch = url.match(/bbb\.org\/.*\/profile\/.*?\/([A-Za-z0-9_-]+)/);
    if (bbbMatch) {
      businessName = bbbMatch[1].replace(/-/g, ' ');
    }

    // Date patterns in snippet: "Jan 15, 2025", "2025-01-15", "15 Jan 2025", etc.
    const dateMatch = snippet.match(
      /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})|(\d{4}-\d{2}-\d{2})/i,
    );
    if (dateMatch) {
      contentDate = dateMatch[0];
    }

    return { username, profileUrl, businessName, contentDate };
  }

  /**
   * Detect which intent phrases appear in the text and classify them.
   */
  private detectIntentSignals(text: string, queryIntentPhrases: string[]): IntentSignal[] {
    const signals: IntentSignal[] = [];
    const lowerText = text.toLowerCase();

    for (const ip of INTENT_PHRASES) {
      if (!queryIntentPhrases.includes(ip.phrase)) continue;

      const idx = lowerText.indexOf(ip.phrase.toLowerCase());
      if (idx !== -1) {
        // Extract surrounding context (up to 60 chars around the match)
        const start = Math.max(0, idx - 20);
        const end = Math.min(lowerText.length, idx + ip.phrase.length + 40);
        const matchedText = text.substring(start, end).trim();

        signals.push({
          signalPhrase: ip.phrase,
          intentType: ip.intentType,
          confidence: 0.8,
          matchedText,
        });
      }
    }

    return signals;
  }

  /** Identify platform from URL */
  private detectPlatform(url: string): string {
    if (url.includes('reddit.com')) return 'reddit';
    if (url.includes('quora.com')) return 'quora';
    if (url.includes('yelp.com')) return 'yelp';
    if (url.includes('trustpilot.com')) return 'trustpilot';
    if (url.includes('bbb.org')) return 'bbb';
    if (url.includes('facebook.com')) return 'facebook';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
    return 'google';
  }
}
