/**
 * Website Discovery step.
 *
 * Attempts to find a personal or business website for the identity by:
 * 1. Checking if the bio already contains a URL (may have been found by profile extractor)
 * 2. Trying common personal website patterns (firstname + lastname .com, username .com)
 * 3. Trying company domain if company is known
 * 4. Verifying that candidate URLs actually resolve
 */

import { logger } from '@alh/observability';
import type { ResolutionContext } from '../pipeline';
import { politeDelay } from '../util';

const log = logger.child({ module: 'identity-resolution:website-discovery' });

/**
 * Verify a URL resolves by sending a HEAD request.
 */
async function urlResolves(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadPulseLab/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Generate candidate website URLs from available identity data.
 */
function generateCandidates(ctx: ResolutionContext): string[] {
  const candidates: string[] = [];

  // Username-based: {username}.com
  if (ctx.input.username) {
    const u = ctx.input.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (u.length >= 3) {
      candidates.push(`https://${u}.com`);
    }
  }

  // Name-based: {firstname}{lastname}.com, {first}{last}.com
  if (ctx.fullName) {
    const parts = ctx.fullName.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const first = parts[0].replace(/[^a-z]/g, '');
      const last = parts[parts.length - 1].replace(/[^a-z]/g, '');
      if (first && last) {
        candidates.push(`https://${first}${last}.com`);
        candidates.push(`https://${first}-${last}.com`);
      }
    }
  }

  // Company-based: {company}.com
  if (ctx.company) {
    const slug = ctx.company.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (slug.length >= 2) {
      candidates.push(`https://${slug}.com`);
    }
  }

  // Deduplicate
  return [...new Set(candidates)];
}

/**
 * Extract URLs from bio text.
 */
function extractUrlsFromBio(bio: string): string[] {
  const urlRegex = /https?:\/\/[^\s"'<>)\]]+/gi;
  return bio.match(urlRegex) ?? [];
}

/**
 * Main website discovery entry point.
 */
export async function discoverWebsite(ctx: ResolutionContext): Promise<void> {
  // If we already have a website, just verify it resolves
  if (ctx.website) {
    log.info({ website: ctx.website }, 'Website already known — verifying');
    const valid = await urlResolves(ctx.website);
    if (!valid) {
      log.warn({ website: ctx.website }, 'Known website does not resolve — clearing');
      ctx.website = null;
    } else {
      log.info({ website: ctx.website }, 'Website verified');
      return;
    }
  }

  // Check bio for URLs
  if (ctx.bio) {
    const bioUrls = extractUrlsFromBio(ctx.bio);
    for (const url of bioUrls) {
      // Skip social media URLs
      if (/reddit|twitter|x\.com|instagram|facebook|linkedin|github|quora/i.test(url)) {
        continue;
      }
      await politeDelay();
      if (await urlResolves(url)) {
        ctx.website = url;
        log.info({ website: url, source: 'bio' }, 'Website found in bio');
        return;
      }
    }
  }

  // Try generated candidates
  const candidates = generateCandidates(ctx);
  log.info({ candidateCount: candidates.length }, 'Probing website candidates');

  for (const url of candidates) {
    await politeDelay();
    if (await urlResolves(url)) {
      ctx.website = url;
      log.info({ website: url, source: 'generated' }, 'Website discovered');
      return;
    }
  }

  log.debug('No website discovered');
}
