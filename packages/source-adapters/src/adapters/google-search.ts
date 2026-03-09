import type { SourceAdapter, FetchParams, RawSourcePayload, RawLeadCandidate, SourceType } from '@alh/types';
import { logger } from '@alh/observability';

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

  async fetch(params: FetchParams): Promise<RawSourcePayload[]> {
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
    const data = payload.payload as GoogleSearchResult;
    if (!data.items) return [];

    return data.items.map((item) => ({
      platform: 'google',
      profileName: null,
      profileUrl: null,
      sourceUrl: item.link,
      matchedKeywords: [],
      rawText: `${item.title}\n${item.snippet}`,
      rawMetadata: {
        title: item.title,
        link: item.link,
        snippet: item.snippet,
      },
      locationText: null,
      contactHint: null,
      contentDate: null,
    }));
  }
}
