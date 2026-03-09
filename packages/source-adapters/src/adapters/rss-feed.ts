import type { SourceAdapter, FetchParams, RawSourcePayload, RawLeadCandidate, SourceType } from '@alh/types';
import { logger } from '@alh/observability';

/**
 * RSS Feed adapter — the BEST free source.
 * Reddit and many forums expose public RSS/Atom feeds that require NO API key.
 *
 * Reddit RSS examples:
 *   https://www.reddit.com/r/CRedit/new/.rss
 *   https://www.reddit.com/r/personalfinance/new/.rss
 *
 * Also works with any standard RSS 2.0 or Atom feed.
 */

interface RssItem {
  title: string;
  description: string;
  author: string | null;
  link: string;
  pubDate: string | null;
  category: string | null;
}

interface RssPayload {
  feedUrl: string;
  feedTitle: string | null;
  items: RssItem[];
}

// Default Reddit subreddits for credit repair vertical
const DEFAULT_CREDIT_SUBREDDITS = [
  'CRedit',
  'personalfinance',
  'FirstTimeHomeBuyer',
  'Debt',
  'povertyfinance',
];

export class RssFeedAdapter implements SourceAdapter {
  name = 'rss_feed';
  sourceType: SourceType = 'social';

  async fetch(params: FetchParams): Promise<RawSourcePayload[]> {
    const results: RawSourcePayload[] = [];

    // Build feed URLs from config or use defaults
    const feedUrls = this.buildFeedUrls(params);

    for (const feedUrl of feedUrls) {
      try {
        const res = await fetch(feedUrl, {
          headers: {
            'User-Agent': 'LeadPulseLab/1.0 (RSS Reader)',
            'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
          },
        });

        if (!res.ok) {
          logger.warn({ status: res.status, feedUrl }, 'RSS feed fetch non-200');
          continue;
        }

        const xml = await res.text();
        const feedTitle = this.extractFeedTitle(xml);
        const items = this.parseRssXml(xml);

        // Filter by keywords if provided
        const filteredItems = params.keywords.length > 0
          ? items.filter((item) => {
              const text = `${item.title} ${item.description}`.toLowerCase();
              return params.keywords.some((kw) => text.includes(kw.toLowerCase()));
            })
          : items;

        // Filter by date if provided
        const dateFilteredItems = params.since
          ? filteredItems.filter((item) => {
              if (!item.pubDate) return true;
              try {
                return new Date(item.pubDate) >= params.since!;
              } catch {
                return true;
              }
            })
          : filteredItems;

        // Limit results
        const maxResults = params.maxResults ?? 25;
        const limitedItems = dateFilteredItems.slice(0, maxResults);

        if (limitedItems.length > 0) {
          results.push({
            sourceUrl: feedUrl,
            fetchMethod: 'rss',
            payload: {
              feedUrl,
              feedTitle,
              items: limitedItems,
            } as RssPayload,
            fetchedAt: new Date(),
          });

          logger.info(
            { feedUrl, totalItems: items.length, filteredItems: limitedItems.length },
            'RSS feed parsed',
          );
        }

        // Small delay between feeds
        await this.delay(500);
      } catch (error) {
        logger.error({ error, feedUrl }, 'RSS feed fetch failed');
      }
    }

    return results;
  }

  extractLeads(payload: RawSourcePayload): RawLeadCandidate[] {
    const data = payload.payload as RssPayload;
    if (!data.items) return [];

    return data.items.map((item) => {
      const subreddit = this.extractSubreddit(item.link || data.feedUrl);
      const platform = data.feedUrl.includes('reddit.com') ? 'reddit' : 'rss';

      return {
        platform,
        profileName: item.author,
        profileUrl: item.author && platform === 'reddit'
          ? `https://www.reddit.com/user/${item.author}`
          : null,
        sourceUrl: item.link,
        matchedKeywords: [],
        rawText: `${item.title}\n${item.description}`,
        rawMetadata: {
          feedUrl: data.feedUrl,
          feedTitle: data.feedTitle,
          pubDate: item.pubDate,
          category: item.category,
          subreddit,
        },
        locationText: null,
        contactHint: null,
        contentDate: item.pubDate ? new Date(item.pubDate) : null,
      };
    });
  }

  /**
   * Build list of feed URLs.
   * If config.feedUrls is provided, use those.
   * If config.subreddits is provided, build Reddit RSS URLs.
   * Otherwise use default credit repair subreddits.
   */
  private buildFeedUrls(params: FetchParams): string[] {
    const configFeeds = params.config?.feedUrls as string[] | undefined;
    if (configFeeds && configFeeds.length > 0) {
      return configFeeds;
    }

    const subreddits = (params.config?.subreddits as string[] | undefined) ?? DEFAULT_CREDIT_SUBREDDITS;
    return subreddits.map((sub) => `https://www.reddit.com/r/${sub}/new/.rss`);
  }

  /**
   * Parse RSS 2.0 or Atom XML using regex (no external XML parser needed).
   */
  private parseRssXml(xml: string): RssItem[] {
    const items: RssItem[] = [];

    // Try RSS 2.0 format first: <item>...</item>
    const rssItemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;

    while ((match = rssItemRegex.exec(xml)) !== null) {
      const block = match[1];
      items.push({
        title: this.extractTag(block, 'title'),
        description: this.stripHtml(this.extractTag(block, 'description') || this.extractTag(block, 'content:encoded') || ''),
        author: this.extractAuthor(block),
        link: this.extractTag(block, 'link') || this.extractAttr(block, 'link', 'href'),
        pubDate: this.extractTag(block, 'pubDate') || this.extractTag(block, 'dc:date'),
        category: this.extractTag(block, 'category'),
      });
    }

    // If no RSS items found, try Atom format: <entry>...</entry>
    if (items.length === 0) {
      const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
      while ((match = atomEntryRegex.exec(xml)) !== null) {
        const block = match[1];
        items.push({
          title: this.stripHtml(this.extractTag(block, 'title') || ''),
          description: this.stripHtml(
            this.extractTag(block, 'content') ||
            this.extractTag(block, 'summary') ||
            ''
          ),
          author: this.extractAtomAuthor(block),
          link: this.extractAttr(block, 'link', 'href'),
          pubDate: this.extractTag(block, 'published') || this.extractTag(block, 'updated'),
          category: this.extractAttr(block, 'category', 'term'),
        });
      }
    }

    return items;
  }

  private extractTag(xml: string, tag: string): string {
    // Handle CDATA: <tag><![CDATA[content]]></tag>
    const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
    const cdataMatch = xml.match(cdataRegex);
    if (cdataMatch) return cdataMatch[1].trim();

    // Regular tag
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const m = xml.match(regex);
    return m ? m[1].trim() : '';
  }

  private extractAttr(xml: string, tag: string, attr: string): string {
    const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i');
    const m = xml.match(regex);
    return m ? m[1] : '';
  }

  private extractAuthor(block: string): string | null {
    // RSS: <dc:creator>, <author>, or <managingEditor>
    const author = this.extractTag(block, 'dc:creator') ||
      this.extractTag(block, 'author') ||
      this.extractTag(block, 'managingEditor');
    if (author) {
      // Reddit RSS uses /u/username format
      const redditUser = author.match(/\/u\/([A-Za-z0-9_-]+)/);
      if (redditUser) return redditUser[1];
      return author;
    }
    return null;
  }

  private extractAtomAuthor(block: string): string | null {
    const authorBlock = block.match(/<author>([\s\S]*?)<\/author>/i);
    if (!authorBlock) return null;
    const name = this.extractTag(authorBlock[1], 'name');
    if (name) {
      const redditUser = name.match(/\/u\/([A-Za-z0-9_-]+)/);
      if (redditUser) return redditUser[1];
      return name;
    }
    return null;
  }

  private extractSubreddit(url: string): string | null {
    const m = url.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/);
    return m ? m[1] : null;
  }

  private extractFeedTitle(xml: string): string | null {
    // Get feed-level title (outside of <item>/<entry>)
    const channelMatch = xml.match(/<channel>([\s\S]*?)<item>/i);
    const feedBlock = channelMatch ? channelMatch[1] : xml.substring(0, 2000);
    const title = this.extractTag(feedBlock, 'title');
    return title || null;
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
