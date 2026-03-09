/**
 * Email Discovery step.
 *
 * Attempts to find email addresses from public sources:
 * 1. Profile bio / about section (regex for email patterns)
 * 2. GitHub profile public email
 * 3. Personal website contact page
 * 4. Common email patterns if domain is known (first@domain, first.last@domain)
 */

import { logger } from '@alh/observability';
import type { ResolutionContext } from '../pipeline';
import { politeDelay } from '../util';

const log = logger.child({ module: 'identity-resolution:email-discovery' });

/** Regex that matches most email addresses */
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Extract email addresses from arbitrary text.
 */
function extractEmailsFromText(text: string): string[] {
  const matches = text.match(EMAIL_REGEX);
  if (!matches) return [];

  // Deduplicate and lowercase
  return [...new Set(matches.map((e) => e.toLowerCase()))];
}

/**
 * Try to fetch a GitHub user's public email via the events API.
 * GitHub exposes emails in push events if the user has not opted out.
 */
async function findGitHubEmail(username: string): Promise<string | null> {
  const url = `https://api.github.com/users/${username}/events/public`;
  log.debug({ username }, 'Checking GitHub events for email');

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'LeadPulseLab/1.0',
        Accept: 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const events = (await res.json()) as Array<{
      type?: string;
      payload?: {
        commits?: Array<{
          author?: { email?: string };
        }>;
      };
    }>;

    for (const event of events) {
      if (event.type === 'PushEvent' && event.payload?.commits) {
        for (const commit of event.payload.commits) {
          const email = commit.author?.email;
          if (
            email &&
            !email.includes('noreply') &&
            !email.includes('users.noreply.github.com')
          ) {
            return email.toLowerCase();
          }
        }
      }
    }
  } catch (err) {
    log.debug({ username, error: (err as Error).message }, 'GitHub email lookup failed');
  }

  return null;
}

/**
 * Try to scrape emails from a personal website's contact or about page.
 */
async function findEmailsOnWebsite(websiteUrl: string): Promise<string[]> {
  const pagesToTry = [websiteUrl, `${websiteUrl}/contact`, `${websiteUrl}/about`];
  const found: string[] = [];

  for (const pageUrl of pagesToTry) {
    try {
      await politeDelay();
      const res = await fetch(pageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadPulseLab/1.0)' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });

      if (!res.ok) continue;

      const html = await res.text();

      // Extract mailto: links
      const mailtoRegex = /href="mailto:([^"]+)"/gi;
      let match: RegExpExecArray | null;
      while ((match = mailtoRegex.exec(html)) !== null) {
        const email = match[1].toLowerCase().split('?')[0]; // strip query params
        found.push(email);
      }

      // Also extract emails from visible text
      found.push(...extractEmailsFromText(html));
    } catch {
      // Page doesn't exist or errored — skip
    }
  }

  return [...new Set(found)];
}

/**
 * Generate common email pattern candidates from name + domain.
 */
function generateEmailCandidates(
  fullName: string | null,
  domain: string,
): Array<{ email: string; confidence: number }> {
  if (!fullName) return [];

  const parts = fullName.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length < 1) return [];

  const first = parts[0].replace(/[^a-z]/g, '');
  const last = parts.length > 1 ? parts[parts.length - 1].replace(/[^a-z]/g, '') : '';

  const candidates: Array<{ email: string; confidence: number }> = [];

  if (first) {
    candidates.push({ email: `${first}@${domain}`, confidence: 0.3 });
  }
  if (first && last) {
    candidates.push({ email: `${first}.${last}@${domain}`, confidence: 0.35 });
    candidates.push({ email: `${first}${last}@${domain}`, confidence: 0.25 });
    candidates.push({ email: `${first[0]}${last}@${domain}`, confidence: 0.2 });
  }

  return candidates;
}

/**
 * Main email discovery entry point.
 */
export async function discoverEmails(ctx: ResolutionContext): Promise<void> {
  // 1. Extract emails from bio text
  if (ctx.bio) {
    const bioEmails = extractEmailsFromText(ctx.bio);
    for (const email of bioEmails) {
      if (!ctx.emails.find((e) => e.email === email)) {
        ctx.emails.push({ email, source: 'bio', confidence: 0.7 });
      }
    }
  }

  // 2. Extract emails from post text
  if (ctx.input.postText) {
    const postEmails = extractEmailsFromText(ctx.input.postText);
    for (const email of postEmails) {
      if (!ctx.emails.find((e) => e.email === email)) {
        ctx.emails.push({ email, source: 'post_text', confidence: 0.6 });
      }
    }
  }

  // 3. GitHub public email
  const githubProfile = ctx.socialProfiles.find((p) => p.platform === 'github');
  if (githubProfile) {
    await politeDelay();
    const ghEmail = await findGitHubEmail(githubProfile.username);
    if (ghEmail && !ctx.emails.find((e) => e.email === ghEmail)) {
      ctx.emails.push({ email: ghEmail, source: 'github_events', confidence: 0.85 });
    }
  }

  // 4. Scrape personal website for emails
  if (ctx.website) {
    const websiteEmails = await findEmailsOnWebsite(ctx.website);
    for (const email of websiteEmails) {
      if (!ctx.emails.find((e) => e.email === email)) {
        ctx.emails.push({ email, source: 'website', confidence: 0.75 });
      }
    }
  }

  // 5. Generate common email pattern candidates (lower confidence — unverified)
  if (ctx.website) {
    try {
      const domain = new URL(ctx.website).hostname.replace(/^www\./, '');
      const candidates = generateEmailCandidates(ctx.fullName, domain);
      for (const candidate of candidates) {
        if (!ctx.emails.find((e) => e.email === candidate.email)) {
          ctx.emails.push({ ...candidate, source: 'pattern_guess' });
        }
      }
    } catch {
      // Invalid URL — skip
    }
  }

  log.info({ emailCount: ctx.emails.length }, 'Email discovery complete');
}
