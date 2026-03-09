/**
 * Profile Extractor step.
 *
 * Given a platform + username, constructs the profile URL, fetches the public
 * profile page, and extracts: display name, bio, location, website link, and
 * social links.
 */

import { logger } from '@alh/observability';
import type { ResolutionContext } from '../pipeline';
import { politeDelay } from '../util';

const log = logger.child({ module: 'identity-resolution:profile-extractor' });

// Known profile URL patterns by platform
const PROFILE_URL_PATTERNS: Record<string, (username: string) => string> = {
  reddit: (u) => `https://www.reddit.com/user/${u}`,
  twitter: (u) => `https://twitter.com/${u}`,
  github: (u) => `https://github.com/${u}`,
  instagram: (u) => `https://www.instagram.com/${u}/`,
  linkedin: (u) => `https://www.linkedin.com/in/${u}`,
  quora: (u) => `https://www.quora.com/profile/${u}`,
  facebook: (u) => `https://www.facebook.com/${u}`,
};

/**
 * Build a profile URL from platform + username if we don't already have one.
 */
function constructProfileUrl(platform: string, username: string): string | null {
  const builder = PROFILE_URL_PATTERNS[platform.toLowerCase()];
  return builder ? builder(username) : null;
}

/**
 * Extract Reddit profile data via their public JSON endpoint.
 * No API key needed — just appends /about.json.
 */
async function extractRedditProfile(username: string, ctx: ResolutionContext): Promise<void> {
  const url = `https://www.reddit.com/user/${username}/about.json`;
  log.info({ username, url }, 'Fetching Reddit profile');

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LeadPulseLab/1.0 (identity-resolution)' },
    });

    if (!res.ok) {
      log.warn({ username, status: res.status }, 'Reddit profile fetch failed');
      return;
    }

    const json = await res.json() as {
      data?: {
        name?: string;
        subreddit?: {
          public_description?: string;
          title?: string;
          display_name_prefixed?: string;
        };
      };
    };
    const data = json?.data;

    if (!data) return;

    // Reddit doesn't expose real names, but the subreddit title is sometimes used
    if (data.subreddit?.title && data.subreddit.title !== data.name) {
      ctx.fullName = ctx.fullName ?? data.subreddit.title;
    }

    if (data.subreddit?.public_description) {
      ctx.bio = data.subreddit.public_description;
      // Extract URLs from bio
      extractUrlsFromText(data.subreddit.public_description, ctx);
    }
  } catch (err) {
    log.error({ username, error: (err as Error).message }, 'Reddit profile extraction error');
  }
}

/**
 * Extract profile info from a Quora profile page by scraping the HTML.
 */
async function extractQuoraProfile(username: string, ctx: ResolutionContext): Promise<void> {
  const url = `https://www.quora.com/profile/${username}`;
  log.info({ username, url }, 'Fetching Quora profile');

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadPulseLab/1.0)' },
    });

    if (!res.ok) {
      log.warn({ username, status: res.status }, 'Quora profile fetch failed');
      return;
    }

    const html = await res.text();

    // Extract bio/credentials from meta description
    const metaMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    if (metaMatch?.[1]) {
      ctx.bio = ctx.bio ?? metaMatch[1];
    }

    // Extract links from the page
    extractUrlsFromText(html, ctx);
  } catch (err) {
    log.error({ username, error: (err as Error).message }, 'Quora profile extraction error');
  }
}

/**
 * Extract GitHub profile data from the public HTML page.
 */
async function extractGitHubProfile(username: string, ctx: ResolutionContext): Promise<void> {
  const url = `https://github.com/${username}`;
  log.info({ username, url }, 'Fetching GitHub profile');

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LeadPulseLab/1.0 (identity-resolution)' },
    });

    if (!res.ok) {
      log.warn({ username, status: res.status }, 'GitHub profile fetch failed');
      return;
    }

    const html = await res.text();

    // Extract name from itemprop="name"
    const nameMatch = html.match(/itemprop="name"[^>]*>([^<]+)</);
    if (nameMatch?.[1]) {
      const name = nameMatch[1].trim();
      if (name && name !== username) {
        ctx.fullName = ctx.fullName ?? name;
      }
    }

    // Extract bio from itemprop="description" or the bio div
    const bioMatch = html.match(/class="p-note user-profile-bio"[^>]*>[\s\S]*?<div>([^<]+)<\/div>/);
    if (bioMatch?.[1]) {
      ctx.bio = ctx.bio ?? bioMatch[1].trim();
    }

    // Extract location
    const locMatch = html.match(/itemprop="homeLocation"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
    if (locMatch?.[1]) {
      ctx.location = ctx.location ?? locMatch[1].trim();
    }

    // Extract company
    const companyMatch = html.match(/itemprop="worksFor"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
    if (companyMatch?.[1]) {
      ctx.company = ctx.company ?? companyMatch[1].trim().replace(/^@/, '');
    }

    // Extract website link
    const websiteMatch = html.match(/itemprop="url"[^>]*href="(https?:\/\/[^"]+)"/);
    if (websiteMatch?.[1]) {
      ctx.website = ctx.website ?? websiteMatch[1];
    }

    // Extract email if public
    const emailMatch = html.match(/itemprop="email"[^>]*>[\s\S]*?<a[^>]*href="mailto:([^"]+)"/);
    if (emailMatch?.[1]) {
      ctx.emails.push({ email: emailMatch[1], source: 'github_profile', confidence: 0.9 });
    }

    extractUrlsFromText(html, ctx);
  } catch (err) {
    log.error({ username, error: (err as Error).message }, 'GitHub profile extraction error');
  }
}

/**
 * Pull URLs out of arbitrary text and update context.
 */
function extractUrlsFromText(text: string, ctx: ResolutionContext): void {
  const urlRegex = /https?:\/\/[^\s"'<>)\]]+/gi;
  const urls = text.match(urlRegex) ?? [];

  for (const url of urls) {
    const lower = url.toLowerCase();

    // Skip known social platform URLs — we'll find those in cross-platform step
    if (
      lower.includes('reddit.com') ||
      lower.includes('quora.com') ||
      lower.includes('facebook.com') ||
      lower.includes('twitter.com') ||
      lower.includes('x.com') ||
      lower.includes('instagram.com') ||
      lower.includes('github.com') ||
      lower.includes('linkedin.com')
    ) {
      continue;
    }

    // Looks like a personal/business website
    if (!ctx.website) {
      ctx.website = url;
    }
  }
}

/**
 * Main profile extraction entry point.
 */
export async function extractProfile(ctx: ResolutionContext): Promise<void> {
  const { platform, username, profileUrl } = ctx.input;

  if (!username && !profileUrl) {
    log.debug('No username or profile URL — skipping profile extraction');
    return;
  }

  const resolvedUsername = username ?? profileUrl?.split('/').filter(Boolean).pop() ?? null;

  // Ensure we have the profile URL in our social profiles list
  if (profileUrl && username) {
    const existing = ctx.socialProfiles.find(
      (p) => p.platform === platform && p.username === username,
    );
    if (!existing) {
      ctx.socialProfiles.push({ platform, url: profileUrl, username });
    }
  } else if (resolvedUsername) {
    const url = constructProfileUrl(platform, resolvedUsername);
    if (url) {
      const existing = ctx.socialProfiles.find(
        (p) => p.platform === platform && p.username === resolvedUsername,
      );
      if (!existing) {
        ctx.socialProfiles.push({ platform, url, username: resolvedUsername });
      }
    }
  }

  // Platform-specific extraction
  const platformLower = platform.toLowerCase();

  if (platformLower === 'reddit' && resolvedUsername) {
    await extractRedditProfile(resolvedUsername, ctx);
  } else if (platformLower === 'quora' && resolvedUsername) {
    await politeDelay();
    await extractQuoraProfile(resolvedUsername, ctx);
  } else if (platformLower === 'github' && resolvedUsername) {
    await politeDelay();
    await extractGitHubProfile(resolvedUsername, ctx);
  }

  log.info(
    {
      platform,
      username: resolvedUsername,
      hasName: !!ctx.fullName,
      hasBio: !!ctx.bio,
      hasWebsite: !!ctx.website,
      socialCount: ctx.socialProfiles.length,
    },
    'Profile extraction complete',
  );
}
