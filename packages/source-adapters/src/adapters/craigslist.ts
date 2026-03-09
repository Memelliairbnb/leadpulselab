import type { SourceAdapter, FetchParams, RawSourcePayload, RawLeadCandidate, SourceType } from '@alh/types';
import { logger } from '@alh/observability';

/**
 * Craigslist free scraping adapter.
 * Scrapes craigslist services/gigs sections for people requesting
 * credit repair, financial help, etc.
 * No API key needed — uses public HTML pages.
 */

interface CraigslistPost {
  title: string;
  url: string;
  date: string | null;
  location: string | null;
  bodySnippet: string | null;
}

interface CraigslistPayload {
  posts: CraigslistPost[];
  searchUrl: string;
  section: string;
}

// Sections to search
const CL_SECTIONS = [
  { path: 'bfs', label: 'business/financial services' },
  { path: 'lgs', label: 'legal services' },
  { path: 'fns', label: 'financial services' },
];

// Major metro Craigslist subdomains
const CL_METROS = [
  'newyork', 'losangeles', 'chicago', 'houston', 'phoenix',
  'dallas', 'sfbay', 'seattle', 'denver', 'atlanta',
  'miami', 'boston', 'detroit', 'minneapolis', 'sandiego',
];

export class CraigslistAdapter implements SourceAdapter {
  name = 'craigslist';
  sourceType: SourceType = 'forum';

  async fetch(params: FetchParams): Promise<RawSourcePayload[]> {
    const results: RawSourcePayload[] = [];
    const metros = (params.config?.metros as string[] | undefined) ?? CL_METROS.slice(0, 5);
    const sections = (params.config?.sections as typeof CL_SECTIONS | undefined) ?? CL_SECTIONS;

    for (const metro of metros) {
      for (const section of sections) {
        for (const keyword of params.keywords) {
          try {
            const searchUrl = `https://${metro}.craigslist.org/search/${section.path}?query=${encodeURIComponent(keyword)}`;

            const res = await fetch(searchUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
              },
            });

            if (!res.ok) {
              logger.warn({ status: res.status, metro, section: section.path, keyword }, 'Craigslist fetch non-200');
              continue;
            }

            const html = await res.text();
            const posts = this.parseListingPage(html, metro);

            if (posts.length > 0) {
              results.push({
                sourceUrl: searchUrl,
                fetchMethod: 'scrape',
                payload: {
                  posts,
                  searchUrl,
                  section: section.label,
                } as CraigslistPayload,
                fetchedAt: new Date(),
              });

              logger.info(
                { metro, section: section.path, keyword, count: posts.length },
                'Craigslist scrape completed',
              );
            }

            // Be polite — small delay between requests
            await this.delay(1500);
          } catch (error) {
            logger.error({ error, metro, keyword }, 'Craigslist scrape failed');
          }
        }
      }
    }

    return results;
  }

  extractLeads(payload: RawSourcePayload): RawLeadCandidate[] {
    const data = payload.payload as CraigslistPayload;
    if (!data.posts) return [];

    return data.posts.map((post) => ({
      platform: 'craigslist',
      profileName: null,
      profileUrl: null,
      sourceUrl: post.url,
      matchedKeywords: [],
      rawText: `${post.title}\n${post.bodySnippet ?? ''}`,
      rawMetadata: {
        section: data.section,
        date: post.date,
        location: post.location,
      },
      locationText: post.location,
      contactHint: null,
      contentDate: post.date ? new Date(post.date) : null,
    }));
  }

  /**
   * Parse Craigslist search results HTML using regex.
   * CL uses <li class="cl-static-search-result"> or <li class="result-row"> patterns.
   */
  private parseListingPage(html: string, metro: string): CraigslistPost[] {
    const posts: CraigslistPost[] = [];

    // Modern CL layout: <li class="cl-static-search-result"> with <a href="...">
    // Also handles older layout with class="result-row"
    const listingRegex = /<li[^>]*class="[^"]*(?:cl-static-search-result|result-row)[^"]*"[^>]*>[\s\S]*?<\/li>/gi;
    const matches = html.match(listingRegex) ?? [];

    for (const match of matches) {
      // Extract URL
      const hrefMatch = match.match(/href="(https?:\/\/[^"]+)"/);
      const url = hrefMatch ? hrefMatch[1] : null;
      if (!url) continue;

      // Extract title
      const titleMatch = match.match(/<a[^>]*>([^<]+)<\/a>/) ??
        match.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</) ??
        match.match(/<span[^>]*id="titletextonly"[^>]*>([^<]+)</);
      const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

      // Extract date
      const dateMatch = match.match(/datetime="([^"]+)"/) ??
        match.match(/(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : null;

      // Extract location (often in <span class="result-hood"> or similar)
      const locMatch = match.match(/class="[^"]*hood[^"]*"[^>]*>\s*\(([^)]+)\)/) ??
        match.match(/class="[^"]*nearby[^"]*"[^>]*>([^<]+)</) ??
        match.match(/class="[^"]*meta[^"]*"[^>]*>([^<]+)</);
      const location = locMatch ? locMatch[1].trim() : metro;

      posts.push({
        title,
        url,
        date,
        location,
        bodySnippet: null, // CL listing pages don't have body text, only titles
      });
    }

    // Fallback: if structured parsing failed, try generic anchor extraction
    if (posts.length === 0) {
      const anchorRegex = /<a[^>]+href="(https?:\/\/[^"]*craigslist[^"]*\/[a-z]{3}\/d\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
      let anchorMatch: RegExpExecArray | null;
      while ((anchorMatch = anchorRegex.exec(html)) !== null) {
        posts.push({
          title: anchorMatch[2].trim(),
          url: anchorMatch[1],
          date: null,
          location: metro,
          bodySnippet: null,
        });
      }
    }

    return posts;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
