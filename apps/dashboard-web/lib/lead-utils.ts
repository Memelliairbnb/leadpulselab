import type { QualifiedLead } from '@alh/types';

/**
 * Returns a display name for a lead, using the best available data:
 * 1. fullName (set by AI analysis from person_or_business_name or profileName)
 * 2. companyName
 * 3. profileUrl-derived username (e.g. "u/reddit_user")
 * 4. "Anonymous [platform] user"
 */
export function getLeadDisplayName(lead: QualifiedLead): string {
  if (lead.fullName) return lead.fullName;
  if (lead.companyName) return lead.companyName;

  // Try to extract a username from profileUrl
  if (lead.profileUrl) {
    const username = extractUsernameFromUrl(lead.profileUrl, lead.platform);
    if (username) return username;
  }

  // Fall back to platform-based anonymous label
  if (lead.platform) {
    const platformLabel = lead.platform.charAt(0).toUpperCase() + lead.platform.slice(1);
    return `Anonymous ${platformLabel} user`;
  }

  return 'Unknown Lead';
}

function extractUsernameFromUrl(url: string, platform: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/$/, '');

    if (platform === 'reddit') {
      // e.g. /r/subreddit/comments/.../... or /user/username
      const userMatch = pathname.match(/\/u(?:ser)?\/([^/]+)/);
      if (userMatch) return `u/${userMatch[1]}`;
    }

    if (platform === 'twitter' || platform === 'x') {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 1 && !['search', 'hashtag', 'i'].includes(parts[0])) {
        return `@${parts[0]}`;
      }
    }

    if (platform === 'linkedin') {
      const match = pathname.match(/\/in\/([^/]+)/);
      if (match) return match[1].replace(/-/g, ' ');
    }

    if (platform === 'facebook') {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 1 && !['groups', 'pages', 'events'].includes(parts[0])) {
        return parts[0];
      }
    }

    // Generic: last path segment
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  } catch {
    // invalid URL
  }
  return null;
}

/**
 * The AI analysis worker stores aiSignalsJson as either:
 * - A flat string[] (legacy)
 * - An object { signals: string[], intent_type, signal_phrases_found, ... }
 *
 * This normalizes it to a flat string array for display.
 */
export function parseAiSignals(aiSignalsJson: unknown): string[] {
  if (!aiSignalsJson) return [];

  // Flat array of strings (legacy format)
  if (Array.isArray(aiSignalsJson)) {
    return aiSignalsJson.filter((s): s is string => typeof s === 'string');
  }

  // Enriched object format from the AI analysis worker
  if (typeof aiSignalsJson === 'object' && aiSignalsJson !== null) {
    const obj = aiSignalsJson as Record<string, unknown>;
    if (Array.isArray(obj.signals)) {
      return obj.signals.filter((s): s is string => typeof s === 'string');
    }
    // Try signal_phrases_found as fallback
    if (Array.isArray(obj.signal_phrases_found)) {
      return obj.signal_phrases_found.filter((s): s is string => typeof s === 'string');
    }
  }

  return [];
}
