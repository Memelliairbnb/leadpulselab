/**
 * Phone Discovery step.
 *
 * Attempts to find phone numbers from public sources:
 * 1. Profile bio text
 * 2. Post text
 * 3. Personal website contact page
 */

import { logger } from '@alh/observability';
import type { ResolutionContext } from '../pipeline';
import { politeDelay } from '../util';

const log = logger.child({ module: 'identity-resolution:phone-discovery' });

/**
 * Regex patterns for common phone number formats:
 * - US/CA: (555) 123-4567, 555-123-4567, 555.123.4567, +1 555 123 4567
 * - International: +44 20 1234 5678, +61 412 345 678
 */
const PHONE_PATTERNS = [
  // US/CA formats
  /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  // International with country code
  /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
];

/**
 * Extract phone numbers from text, filtering out obvious non-phone numbers.
 */
function extractPhonesFromText(text: string): string[] {
  const phones: Set<string> = new Set();

  for (const pattern of PHONE_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      // Strip non-digit chars for validation
      const digits = raw.replace(/\D/g, '');

      // Must have at least 7 digits (local) and at most 15 (E.164 max)
      if (digits.length >= 7 && digits.length <= 15) {
        phones.add(raw.trim());
      }
    }
  }

  return [...phones];
}

/**
 * Try to scrape phone numbers from a personal website's contact page.
 */
async function findPhonesOnWebsite(websiteUrl: string): Promise<string[]> {
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

      // Extract tel: links
      const telRegex = /href="tel:([^"]+)"/gi;
      let match: RegExpExecArray | null;
      while ((match = telRegex.exec(html)) !== null) {
        found.push(match[1]);
      }

      // Also extract phones from visible text
      found.push(...extractPhonesFromText(html));
    } catch {
      // Page doesn't exist or errored — skip
    }
  }

  return [...new Set(found)];
}

/**
 * Main phone discovery entry point.
 */
export async function discoverPhones(ctx: ResolutionContext): Promise<void> {
  // 1. Extract from bio
  if (ctx.bio) {
    const bioPhones = extractPhonesFromText(ctx.bio);
    for (const phone of bioPhones) {
      if (!ctx.phones.find((p) => p.phone === phone)) {
        ctx.phones.push({ phone, source: 'bio', confidence: 0.6 });
      }
    }
  }

  // 2. Extract from post text
  if (ctx.input.postText) {
    const postPhones = extractPhonesFromText(ctx.input.postText);
    for (const phone of postPhones) {
      if (!ctx.phones.find((p) => p.phone === phone)) {
        ctx.phones.push({ phone, source: 'post_text', confidence: 0.5 });
      }
    }
  }

  // 3. Scrape personal website
  if (ctx.website) {
    const websitePhones = await findPhonesOnWebsite(ctx.website);
    for (const phone of websitePhones) {
      if (!ctx.phones.find((p) => p.phone === phone)) {
        ctx.phones.push({ phone, source: 'website', confidence: 0.7 });
      }
    }
  }

  log.info({ phoneCount: ctx.phones.length }, 'Phone discovery complete');
}
