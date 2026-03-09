/**
 * Main Identity Resolver.
 *
 * Orchestrates all resolution steps in sequence, taking a raw signal input and
 * progressively building a ResolvedIdentity. Each step enriches the shared
 * context with whatever data it can find from public sources.
 *
 * Pipeline order:
 *   1. Profile Extraction   — fetch the source profile, extract name/bio/links
 *   2. Cross-Platform Search — probe other platforms for matching username
 *   3. Website Discovery     — find a personal/business website
 *   4. Email Discovery       — extract/find email addresses
 *   5. Phone Discovery       — extract/find phone numbers
 *   6. Identity Scoring      — score confidence and determine resolution status
 */

import { logger } from '@alh/observability';
import type { IdentityInput, ResolvedIdentity, ResolutionContext } from './pipeline';
import { createEmptyContext } from './pipeline';
import { extractProfile } from './steps/profile-extractor';
import { searchCrossPlatform } from './steps/cross-platform-search';
import { discoverWebsite } from './steps/website-discovery';
import { discoverEmails } from './steps/email-discovery';
import { discoverPhones } from './steps/phone-discovery';
import { scoreIdentity } from './steps/identity-scorer';

const log = logger.child({ module: 'identity-resolution:resolver' });

/**
 * Convert the mutable ResolutionContext into a frozen ResolvedIdentity.
 */
function contextToIdentity(
  ctx: ResolutionContext,
  identityConfidence: number,
  resolutionStatus: ResolvedIdentity['resolutionStatus'],
): ResolvedIdentity {
  return {
    fullName: ctx.fullName,
    emails: [...ctx.emails],
    phones: [...ctx.phones],
    socialProfiles: [...ctx.socialProfiles],
    website: ctx.website,
    company: ctx.company,
    location: ctx.location,
    bio: ctx.bio,
    identityConfidence,
    resolutionStatus,
  };
}

/**
 * Resolve an identity from a raw signal input.
 *
 * Runs all steps in sequence with polite delays between network requests.
 * Each step is wrapped in a try/catch so a single failure doesn't abort the
 * entire pipeline — we just continue with whatever data we have.
 */
export async function resolveIdentity(input: IdentityInput): Promise<ResolvedIdentity> {
  log.info(
    {
      platform: input.platform,
      username: input.username,
      hasProfileUrl: !!input.profileUrl,
      hasDisplayName: !!input.displayName,
    },
    'Starting identity resolution',
  );

  const ctx: ResolutionContext = createEmptyContext(input);

  // Step 1: Profile Extraction
  try {
    await extractProfile(ctx);
    log.debug('Step 1 (profile extraction) complete');
  } catch (err) {
    log.error({ error: (err as Error).message }, 'Step 1 (profile extraction) failed');
  }

  // Step 2: Cross-Platform Search
  try {
    await searchCrossPlatform(ctx);
    log.debug('Step 2 (cross-platform search) complete');
  } catch (err) {
    log.error({ error: (err as Error).message }, 'Step 2 (cross-platform search) failed');
  }

  // Step 3: Website Discovery
  try {
    await discoverWebsite(ctx);
    log.debug('Step 3 (website discovery) complete');
  } catch (err) {
    log.error({ error: (err as Error).message }, 'Step 3 (website discovery) failed');
  }

  // Step 4: Email Discovery
  try {
    await discoverEmails(ctx);
    log.debug('Step 4 (email discovery) complete');
  } catch (err) {
    log.error({ error: (err as Error).message }, 'Step 4 (email discovery) failed');
  }

  // Step 5: Phone Discovery
  try {
    await discoverPhones(ctx);
    log.debug('Step 5 (phone discovery) complete');
  } catch (err) {
    log.error({ error: (err as Error).message }, 'Step 5 (phone discovery) failed');
  }

  // Step 6: Identity Scoring
  const { identityConfidence, resolutionStatus } = scoreIdentity(ctx);

  const resolved = contextToIdentity(ctx, identityConfidence, resolutionStatus);

  log.info(
    {
      platform: input.platform,
      username: input.username,
      confidence: identityConfidence,
      status: resolutionStatus,
      emailCount: resolved.emails.length,
      phoneCount: resolved.phones.length,
      socialCount: resolved.socialProfiles.length,
      hasName: !!resolved.fullName,
      hasWebsite: !!resolved.website,
      hasCompany: !!resolved.company,
    },
    'Identity resolution complete',
  );

  return resolved;
}
