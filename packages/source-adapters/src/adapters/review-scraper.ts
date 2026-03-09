import type { SourceAdapter, FetchParams, RawSourcePayload, RawLeadCandidate, SourceType } from '@alh/types';
import { logger } from '@alh/observability';

/**
 * Yelp / BBB public review scraper.
 * Fetches search results and review pages for credit repair companies,
 * extracts reviews where people describe their credit problems.
 * No API key needed — uses public HTML pages.
 */

interface ReviewEntry {
  reviewerName: string | null;
  reviewText: string;
  rating: number | null;
  date: string | null;
  businessName: string | null;
  sourceUrl: string;
}

interface ReviewPayload {
  reviews: ReviewEntry[];
  searchUrl: string;
  platform: 'yelp' | 'bbb';
}

// Default locations to search
const DEFAULT_LOCATIONS = [
  'Houston TX', 'Dallas TX', 'Atlanta GA', 'Miami FL', 'Chicago IL',
  'Los Angeles CA', 'New York NY', 'Phoenix AZ', 'Denver CO', 'Detroit MI',
];

export class ReviewScraperAdapter implements SourceAdapter {
  name = 'review_scraper';
  sourceType: SourceType = 'directory';

  async fetch(params: FetchParams): Promise<RawSourcePayload[]> {
    const results: RawSourcePayload[] = [];
    const locations = (params.config?.locations as string[] | undefined) ?? DEFAULT_LOCATIONS.slice(0, 3);
    const platforms = (params.config?.platforms as string[] | undefined) ?? ['yelp', 'bbb'];

    for (const keyword of params.keywords) {
      for (const location of locations) {
        if (platforms.includes('yelp')) {
          try {
            const yelpResults = await this.scrapeYelp(keyword, location);
            if (yelpResults.length > 0) {
              const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}`;
              results.push({
                sourceUrl: searchUrl,
                fetchMethod: 'scrape',
                payload: {
                  reviews: yelpResults,
                  searchUrl,
                  platform: 'yelp',
                } as ReviewPayload,
                fetchedAt: new Date(),
              });
              logger.info({ keyword, location, count: yelpResults.length }, 'Yelp scrape completed');
            }
          } catch (error) {
            logger.error({ error, keyword, location }, 'Yelp scrape failed');
          }
          await this.delay(2000);
        }

        if (platforms.includes('bbb')) {
          try {
            const bbbResults = await this.scrapeBBB(keyword, location);
            if (bbbResults.length > 0) {
              const searchUrl = `https://www.bbb.org/search?find_country=US&find_text=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}&find_type=Category`;
              results.push({
                sourceUrl: searchUrl,
                fetchMethod: 'scrape',
                payload: {
                  reviews: bbbResults,
                  searchUrl,
                  platform: 'bbb',
                } as ReviewPayload,
                fetchedAt: new Date(),
              });
              logger.info({ keyword, location, count: bbbResults.length }, 'BBB scrape completed');
            }
          } catch (error) {
            logger.error({ error, keyword, location }, 'BBB scrape failed');
          }
          await this.delay(2000);
        }
      }
    }

    return results;
  }

  extractLeads(payload: RawSourcePayload): RawLeadCandidate[] {
    const data = payload.payload as ReviewPayload;
    if (!data.reviews) return [];

    return data.reviews.map((review) => ({
      platform: data.platform,
      profileName: review.reviewerName,
      profileUrl: null,
      sourceUrl: review.sourceUrl || data.searchUrl,
      matchedKeywords: [],
      rawText: review.reviewText,
      rawMetadata: {
        rating: review.rating,
        businessName: review.businessName,
        reviewDate: review.date,
        reviewPlatform: data.platform,
      },
      locationText: null,
      contactHint: null,
      contentDate: review.date ? new Date(review.date) : null,
    }));
  }

  private async scrapeYelp(keyword: string, location: string): Promise<ReviewEntry[]> {
    const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}`;

    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) {
      logger.warn({ status: res.status, keyword, location }, 'Yelp search non-200');
      return [];
    }

    const html = await res.text();
    return this.parseYelpResults(html);
  }

  private parseYelpResults(html: string): ReviewEntry[] {
    const reviews: ReviewEntry[] = [];

    // Yelp embeds JSON-LD and structured data we can extract
    // Also try to parse review snippets from search results

    // Look for review text snippets in search results
    const reviewSnippetRegex = /<p[^>]*class="[^"]*(?:snippet|comment)[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
    const snippetMatches = html.match(reviewSnippetRegex) ?? [];

    // Also try the data-testid pattern Yelp uses
    const reviewBlockRegex = /<span[^>]*(?:class="[^"]*(?:raw__|css-)[^"]*")[^>]*>([\s\S]*?)<\/span>/gi;

    // Extract business cards with review previews
    const cardRegex = /<div[^>]*class="[^"]*(?:container|businessName|result)[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*(?:container|businessName|result)[^"]*"|<\/main>)/gi;
    const cardMatches = html.match(cardRegex) ?? [];

    for (const card of cardMatches) {
      // Business name
      const bizMatch = card.match(/<a[^>]*class="[^"]*(?:businessName|css-)[^"]*"[^>]*href="([^"]*)"[^>]*>(?:<[^>]*>)*([^<]+)/i) ??
        card.match(/<a[^>]*href="(\/biz\/[^"]+)"[^>]*>(?:<[^>]*>)*([^<]+)/i);
      const businessName = bizMatch ? this.stripHtml(bizMatch[2]) : null;
      const bizUrl = bizMatch ? `https://www.yelp.com${bizMatch[1]}` : null;

      // Review snippet
      const snippetMatch = card.match(/<p[^>]*>([\s\S]{40,}?)<\/p>/i);
      const reviewText = snippetMatch ? this.stripHtml(snippetMatch[1]) : null;

      // Reviewer name
      const nameMatch = card.match(/class="[^"]*(?:user-name|reviewer)[^"]*"[^>]*>(?:<[^>]*>)*([^<]+)/i);
      const reviewerName = nameMatch ? nameMatch[1].trim() : null;

      // Rating
      const ratingMatch = card.match(/aria-label="(\d+(?:\.\d+)?)\s*star/i) ??
        card.match(/rating[^>]*?(\d+(?:\.\d+)?)/i);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

      if (reviewText && reviewText.length > 30) {
        reviews.push({
          reviewerName,
          reviewText,
          rating,
          date: null,
          businessName,
          sourceUrl: bizUrl ?? '',
        });
      }
    }

    // Fallback: extract any review-like paragraphs
    if (reviews.length === 0) {
      for (const snippet of snippetMatches) {
        const text = this.stripHtml(snippet);
        if (text.length > 30) {
          reviews.push({
            reviewerName: null,
            reviewText: text,
            rating: null,
            date: null,
            businessName: null,
            sourceUrl: '',
          });
        }
      }
    }

    return reviews;
  }

  private async scrapeBBB(keyword: string, location: string): Promise<ReviewEntry[]> {
    const searchUrl = `https://www.bbb.org/search?find_country=US&find_text=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}&find_type=Category`;

    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) {
      logger.warn({ status: res.status, keyword, location }, 'BBB search non-200');
      return [];
    }

    const html = await res.text();
    return this.parseBBBResults(html);
  }

  private parseBBBResults(html: string): ReviewEntry[] {
    const reviews: ReviewEntry[] = [];

    // BBB uses structured result cards
    const resultRegex = /<div[^>]*class="[^"]*(?:result-item|search-result|bds-listing)[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*(?:result-item|search-result|bds-listing)[^"]*"|<\/section>)/gi;
    const results = html.match(resultRegex) ?? [];

    for (const block of results) {
      // Business name
      const nameMatch = block.match(/<(?:h3|a)[^>]*class="[^"]*(?:business-name|result-name)[^"]*"[^>]*>(?:<[^>]*>)*([^<]+)/i) ??
        block.match(/<a[^>]*href="(\/us\/[^"]+)"[^>]*>(?:<[^>]*>)*([^<]+)/i);
      const businessName = nameMatch ? this.stripHtml(nameMatch[2] ?? nameMatch[1]) : null;

      // Complaint / review text
      const textMatch = block.match(/<p[^>]*class="[^"]*(?:complaint|review|description)[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ??
        block.match(/<p[^>]*>([\s\S]{40,}?)<\/p>/i);
      const reviewText = textMatch ? this.stripHtml(textMatch[1]) : null;

      // Rating
      const ratingMatch = block.match(/(?:rating|grade)[^>]*>([A-F][+-]?)/i);
      const rating = ratingMatch ? this.bbbGradeToNumber(ratingMatch[1]) : null;

      const urlMatch = block.match(/href="(\/us\/[^"]+)"/i);
      const sourceUrl = urlMatch ? `https://www.bbb.org${urlMatch[1]}` : '';

      if (reviewText && reviewText.length > 20) {
        reviews.push({
          reviewerName: null,
          reviewText,
          rating,
          date: null,
          businessName,
          sourceUrl,
        });
      }
    }

    return reviews;
  }

  private bbbGradeToNumber(grade: string): number {
    const grades: Record<string, number> = {
      'A+': 5, 'A': 4.5, 'A-': 4, 'B+': 3.5, 'B': 3, 'B-': 2.5,
      'C+': 2, 'C': 1.5, 'C-': 1, 'D+': 0.75, 'D': 0.5, 'D-': 0.25, 'F': 0,
    };
    return grades[grade] ?? 0;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
