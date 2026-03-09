import type { SourceAdapter, FetchParams, RawSourcePayload, RawLeadCandidate, SourceType } from '@alh/types';
import { logger } from '@alh/observability';

interface RedditListing {
  data: {
    children: Array<{
      data: {
        id: string;
        title: string;
        selftext: string;
        author: string;
        subreddit: string;
        permalink: string;
        url: string;
        created_utc: number;
        score: number;
        num_comments: number;
      };
    }>;
  };
}

export class RedditAdapter implements SourceAdapter {
  name = 'reddit';
  sourceType: SourceType = 'social';

  private accessToken: string | null = null;
  private tokenExpiry = 0;

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;
    const userAgent = process.env.REDDIT_USER_AGENT || 'leadpulselab/1.0';

    if (!clientId || !clientSecret) {
      throw new Error('Reddit client ID and secret are required');
    }

    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);

    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken!;
  }

  async fetch(params: FetchParams): Promise<RawSourcePayload[]> {
    const token = await this.getAccessToken();
    const userAgent = process.env.REDDIT_USER_AGENT || 'leadpulselab/1.0';
    const results: RawSourcePayload[] = [];

    for (const keyword of params.keywords) {
      try {
        const url = new URL('https://oauth.reddit.com/search');
        url.searchParams.set('q', keyword);
        url.searchParams.set('sort', 'new');
        url.searchParams.set('limit', String(params.maxResults ?? 25));
        url.searchParams.set('t', 'week');

        const res = await fetch(url.toString(), {
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': userAgent,
          },
        });

        if (!res.ok) {
          logger.error({ status: res.status, keyword }, 'Reddit search API error');
          continue;
        }

        const data: RedditListing = await res.json();
        results.push({
          sourceUrl: url.toString(),
          fetchMethod: 'api',
          payload: data,
          fetchedAt: new Date(),
        });

        logger.info(
          { keyword, resultCount: data.data.children.length },
          'Reddit search completed',
        );
      } catch (error) {
        logger.error({ error, keyword }, 'Reddit search fetch failed');
      }
    }

    return results;
  }

  extractLeads(payload: RawSourcePayload): RawLeadCandidate[] {
    const data = payload.payload as RedditListing;
    if (!data.data?.children) return [];

    return data.data.children.map((child) => {
      const post = child.data;
      return {
        platform: 'reddit',
        profileName: post.author,
        profileUrl: `https://www.reddit.com/user/${post.author}`,
        sourceUrl: `https://www.reddit.com${post.permalink}`,
        matchedKeywords: [],
        rawText: `${post.title}\n${post.selftext}`,
        rawMetadata: {
          subreddit: post.subreddit,
          score: post.score,
          numComments: post.num_comments,
          postId: post.id,
        },
        locationText: null,
        contactHint: null,
        contentDate: new Date(post.created_utc * 1000),
      };
    });
  }
}
