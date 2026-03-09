/**
 * Cross-Platform Search step.
 *
 * Given a username or name, checks whether matching accounts exist on other
 * major platforms by probing public URL patterns. A 200 response means the
 * account exists; anything else means it doesn't (or is private).
 */

import { logger } from '@alh/observability';
import type { ResolutionContext } from '../pipeline';
import { politeDelay } from '../util';

const log = logger.child({ module: 'identity-resolution:cross-platform-search' });

interface PlatformProbe {
  platform: string;
  urlBuilder: (username: string) => string;
}

const PLATFORMS_TO_PROBE: PlatformProbe[] = [
  { platform: 'twitter', urlBuilder: (u) => `https://twitter.com/${u}` },
  { platform: 'github', urlBuilder: (u) => `https://github.com/${u}` },
  { platform: 'instagram', urlBuilder: (u) => `https://www.instagram.com/${u}/` },
  { platform: 'linkedin', urlBuilder: (u) => `https://www.linkedin.com/in/${u}` },
  { platform: 'facebook', urlBuilder: (u) => `https://www.facebook.com/${u}` },
];

/**
 * Check if a profile exists at a given URL by sending a HEAD request.
 * Returns true if the server responds with 200.
 */
async function profileExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadPulseLab/1.0)',
      },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Search for the same username across major platforms.
 * Only probes platforms that are not already in the context.
 */
export async function searchCrossPlatform(ctx: ResolutionContext): Promise<void> {
  const username = ctx.input.username;

  if (!username) {
    log.debug('No username available — skipping cross-platform search');
    return;
  }

  const existingPlatforms = new Set(ctx.socialProfiles.map((p) => p.platform.toLowerCase()));

  const toProbe = PLATFORMS_TO_PROBE.filter(
    (p) => !existingPlatforms.has(p.platform),
  );

  if (toProbe.length === 0) {
    log.debug('All platforms already known — skipping');
    return;
  }

  log.info(
    { username, platformCount: toProbe.length },
    'Starting cross-platform search',
  );

  for (const probe of toProbe) {
    await politeDelay();

    const url = probe.urlBuilder(username);
    const exists = await profileExists(url);

    if (exists) {
      log.info({ platform: probe.platform, username, url }, 'Cross-platform match found');
      ctx.socialProfiles.push({
        platform: probe.platform,
        url,
        username,
      });
    } else {
      log.debug({ platform: probe.platform, username }, 'No match');
    }
  }

  log.info(
    { username, totalProfiles: ctx.socialProfiles.length },
    'Cross-platform search complete',
  );
}
