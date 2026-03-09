/**
 * Identity Scorer step.
 *
 * Calculates an overall identity confidence score (0-100) based on how much
 * data we were able to resolve. This score determines whether the signal
 * graduates to a real lead or gets discarded.
 *
 * Scoring rubric:
 *   Has real name:                     +20
 *   Has verified email (conf >= 0.6):  +30
 *   Has verified phone (conf >= 0.5):  +20
 *   Has multiple social profiles:      +10
 *   Has website:                       +10
 *   Has company:                       +10
 *   Cross-platform username match:     +15
 *   Only has username, nothing else:   10 (base)
 */

import { logger } from '@alh/observability';
import type { ResolutionContext } from '../pipeline';
import type { ResolutionStatus } from '../pipeline';

const log = logger.child({ module: 'identity-resolution:identity-scorer' });

export interface ScoreResult {
  identityConfidence: number;
  resolutionStatus: ResolutionStatus;
}

/**
 * Score the resolved identity and determine its resolution status.
 */
export function scoreIdentity(ctx: ResolutionContext): ScoreResult {
  let score = 0;
  const factors: string[] = [];

  // Base: if we only have a username and nothing else
  const hasAnythingBeyondUsername =
    ctx.fullName ||
    ctx.emails.length > 0 ||
    ctx.phones.length > 0 ||
    ctx.website ||
    ctx.company ||
    ctx.bio ||
    ctx.socialProfiles.length > 1;

  if (!hasAnythingBeyondUsername) {
    score = 10;
    factors.push('username_only(10)');
  }

  // Has real name
  if (ctx.fullName) {
    score += 20;
    factors.push('real_name(+20)');
  }

  // Has verified email (confidence >= 0.6)
  const verifiedEmails = ctx.emails.filter((e) => e.confidence >= 0.6);
  if (verifiedEmails.length > 0) {
    score += 30;
    factors.push(`verified_email(+30, count=${verifiedEmails.length})`);
  }

  // Has verified phone (confidence >= 0.5)
  const verifiedPhones = ctx.phones.filter((p) => p.confidence >= 0.5);
  if (verifiedPhones.length > 0) {
    score += 20;
    factors.push(`verified_phone(+20, count=${verifiedPhones.length})`);
  }

  // Has multiple social profiles (more than just the source platform)
  if (ctx.socialProfiles.length >= 2) {
    score += 10;
    factors.push(`multi_social(+10, count=${ctx.socialProfiles.length})`);
  }

  // Has website
  if (ctx.website) {
    score += 10;
    factors.push('website(+10)');
  }

  // Has company
  if (ctx.company) {
    score += 10;
    factors.push('company(+10)');
  }

  // Cross-platform username match: same username found on 2+ other platforms
  if (ctx.input.username && ctx.socialProfiles.length >= 3) {
    const matchingUsername = ctx.socialProfiles.filter(
      (p) => p.username.toLowerCase() === ctx.input.username!.toLowerCase(),
    );
    if (matchingUsername.length >= 3) {
      score += 15;
      factors.push(`cross_platform_match(+15, count=${matchingUsername.length})`);
    }
  }

  // Cap at 100
  score = Math.min(score, 100);

  // Determine resolution status
  const hasEmail = ctx.emails.length > 0;
  const hasPhone = ctx.phones.length > 0;
  const hasContact = hasEmail || hasPhone;

  let resolutionStatus: ResolutionStatus;

  if (score >= 60 && hasContact) {
    resolutionStatus = 'qualified';
  } else if (hasEmail) {
    resolutionStatus = 'email_found';
  } else if (hasPhone) {
    resolutionStatus = 'phone_found';
  } else if (score >= 30 || hasContact) {
    resolutionStatus = 'partial_inventory';
  } else if (score < 30 && !hasContact) {
    resolutionStatus = 'discarded';
  } else {
    resolutionStatus = 'identity_candidate';
  }

  log.info(
    {
      score,
      resolutionStatus,
      factors,
      emailCount: ctx.emails.length,
      phoneCount: ctx.phones.length,
      socialCount: ctx.socialProfiles.length,
    },
    'Identity scored',
  );

  return { identityConfidence: score, resolutionStatus };
}
