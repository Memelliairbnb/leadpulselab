import type { SourceAdapter, FetchParams, RawSourcePayload, RawLeadCandidate, SourceType } from '@alh/types';
import { logger } from '@alh/observability';

/**
 * Generic public forum / webpage scraper.
 * Given a list of URLs (forum pages, subreddit pages, etc.), fetches the HTML
 * and extracts text content, links, and usernames from common HTML patterns.
 * No API key needed — works with any public webpage.
 */

interface ForumPost {
  username: string | null;
  profileUrl: string | null;
  text: string;
  url: string;
  date: string | null;
}

interface ForumPayload {
  posts: ForumPost[];
  pageUrl: string;
  forumType: string;
}

// Well-known forum URL patterns for detection
const FORUM_PATTERNS: Array<{
  name: string;
  detect: RegExp;
  postRegex: RegExp;
  userRegex: RegExp;
  textRegex: RegExp;
  dateRegex: RegExp;
}> = [
  {
    // Reddit old/new HTML pages (not API)
    name: 'reddit',
    detect: /reddit\.com/,
    postRegex: /<div[^>]*class="[^"]*(?:thing|Post)[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*(?:thing|Post)[^"]*"|$)/gi,
    userRegex: /(?:data-author="([^"]+)"|href="\/(?:user|u)\/([^/"]+)")/i,
    textRegex: /<(?:p|div)[^>]*class="[^"]*(?:md|RichText)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/i,
    dateRegex: /datetime="([^"]+)"|data-timestamp="(\d+)"/i,
  },
  {
    // Generic phpBB / vBulletin / Discourse style forums
    name: 'generic_forum',
    detect: /./,
    postRegex: /<(?:div|article|tr)[^>]*class="[^"]*(?:post|message|comment|topic)[^"]*"[^>]*>[\s\S]*?<\/(?:div|article|tr)>/gi,
    userRegex: /class="[^"]*(?:author|username|user-name|poster)[^"]*"[^>]*>(?:<a[^>]*href="([^"]*)"[^>]*>)?([^<]+)/i,
    textRegex: /class="[^"]*(?:post-?(?:body|content|text)|message-?(?:body|content)|comment-?(?:body|content))[^"]*"[^>]*>([\s\S]*?)<\/(?:div|td|article)>/i,
    dateRegex: /datetime="([^"]+)"|class="[^"]*(?:date|time|timestamp)[^"]*"[^>]*>([^<]+)</i,
  },
];

export class PublicForumAdapter implements SourceAdapter {
  name = 'public_forums';
  sourceType: SourceType = 'forum';

  async fetch(params: FetchParams): Promise<RawSourcePayload[]> {
    const results: RawSourcePayload[] = [];
    const urls = (params.config?.urls as string[] | undefined) ?? [];

    if (urls.length === 0) {
      logger.warn('PublicForumAdapter: no URLs provided in config.urls');
      return results;
    }

    for (const pageUrl of urls) {
      try {
        const res = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
        });

        if (!res.ok) {
          logger.warn({ status: res.status, url: pageUrl }, 'PublicForum fetch non-200');
          continue;
        }

        const html = await res.text();
        const forumPattern = FORUM_PATTERNS.find((p) => p.detect.test(pageUrl)) ?? FORUM_PATTERNS[FORUM_PATTERNS.length - 1];
        const posts = this.parsePage(html, pageUrl, forumPattern, params.keywords);

        if (posts.length > 0) {
          results.push({
            sourceUrl: pageUrl,
            fetchMethod: 'scrape',
            payload: {
              posts,
              pageUrl,
              forumType: forumPattern.name,
            } as ForumPayload,
            fetchedAt: new Date(),
          });

          logger.info({ url: pageUrl, count: posts.length, type: forumPattern.name }, 'Forum scrape completed');
        }

        // Polite delay between requests
        await this.delay(2000);
      } catch (error) {
        logger.error({ error, url: pageUrl }, 'Forum scrape failed');
      }
    }

    return results;
  }

  extractLeads(payload: RawSourcePayload): RawLeadCandidate[] {
    const data = payload.payload as ForumPayload;
    if (!data.posts) return [];

    return data.posts.map((post) => ({
      platform: data.forumType === 'reddit' ? 'reddit' : 'forum',
      profileName: post.username,
      profileUrl: post.profileUrl,
      sourceUrl: post.url || data.pageUrl,
      matchedKeywords: [],
      rawText: post.text,
      rawMetadata: {
        forumType: data.forumType,
        pageUrl: data.pageUrl,
        date: post.date,
      },
      locationText: null,
      contactHint: null,
      contentDate: post.date ? new Date(post.date) : null,
    }));
  }

  private parsePage(
    html: string,
    pageUrl: string,
    pattern: typeof FORUM_PATTERNS[number],
    keywords: string[],
  ): ForumPost[] {
    const posts: ForumPost[] = [];

    // Strip script and style tags for cleaner text extraction
    const cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');

    const postMatches = cleanHtml.match(pattern.postRegex) ?? [];

    for (const block of postMatches) {
      // Extract username
      const userMatch = block.match(pattern.userRegex);
      const username = userMatch ? (userMatch[2] ?? userMatch[1] ?? null) : null;
      const profileUrl = userMatch?.[1]?.startsWith('http')
        ? userMatch[1]
        : username
          ? this.buildProfileUrl(pageUrl, username)
          : null;

      // Extract text content
      const textMatch = block.match(pattern.textRegex);
      let text = textMatch ? this.stripHtml(textMatch[1]) : this.stripHtml(block);

      // Truncate very long texts
      if (text.length > 2000) {
        text = text.substring(0, 2000) + '...';
      }

      // Skip very short or empty texts
      if (text.trim().length < 20) continue;

      // If keywords provided, check relevance
      if (keywords.length > 0) {
        const lowerText = text.toLowerCase();
        const hasKeyword = keywords.some((kw) => lowerText.includes(kw.toLowerCase()));
        if (!hasKeyword) continue;
      }

      // Extract date
      const dateMatch = block.match(pattern.dateRegex);
      let date: string | null = null;
      if (dateMatch) {
        if (dateMatch[1]) {
          date = dateMatch[1];
        } else if (dateMatch[2]) {
          // Unix timestamp
          const ts = parseInt(dateMatch[2], 10);
          if (ts > 1000000000) {
            date = new Date(ts * 1000).toISOString();
          }
        }
      }

      posts.push({
        username,
        profileUrl,
        text: text.trim(),
        url: pageUrl,
        date,
      });
    }

    // Fallback: if no structured posts found, extract all paragraph text
    if (posts.length === 0) {
      const paragraphs = cleanHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
      const lowerKeywords = keywords.map((k) => k.toLowerCase());

      for (const p of paragraphs) {
        const text = this.stripHtml(p);
        if (text.length < 30) continue;
        const lowerText = text.toLowerCase();
        if (lowerKeywords.length > 0 && !lowerKeywords.some((kw) => lowerText.includes(kw))) continue;

        posts.push({
          username: null,
          profileUrl: null,
          text: text.trim().substring(0, 2000),
          url: pageUrl,
          date: null,
        });
      }
    }

    return posts;
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

  private buildProfileUrl(pageUrl: string, username: string): string | null {
    try {
      const urlObj = new URL(pageUrl);
      if (urlObj.hostname.includes('reddit.com')) {
        return `https://www.reddit.com/user/${username}`;
      }
      // Generic: link to homepage
      return `${urlObj.origin}/user/${username}`;
    } catch {
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
