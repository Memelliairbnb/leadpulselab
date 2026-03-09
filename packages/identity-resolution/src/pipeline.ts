/**
 * Identity Resolution Pipeline types.
 *
 * A raw signal (username, post, profile URL) enters the pipeline and is
 * progressively enriched until we either have a qualified identity with
 * verified contact information, or we discard it.
 */

export interface IdentityInput {
  platform: string;
  username?: string;
  profileUrl?: string;
  displayName?: string;
  postText: string;
  sourceUrl: string;
}

export interface ResolvedIdentity {
  fullName: string | null;
  emails: Array<{ email: string; source: string; confidence: number }>;
  phones: Array<{ phone: string; source: string; confidence: number }>;
  socialProfiles: Array<{ platform: string; url: string; username: string }>;
  website: string | null;
  company: string | null;
  location: string | null;
  bio: string | null;
  identityConfidence: number; // 0-100
  resolutionStatus: ResolutionStatus;
}

export type ResolutionStatus =
  | 'signal_found'
  | 'profile_extracted'
  | 'identity_candidate'
  | 'contact_candidate'
  | 'email_found'
  | 'phone_found'
  | 'qualified'
  | 'partial_inventory'
  | 'discarded';

/**
 * Internal mutable context that each resolution step can read from and write to.
 * The resolver converts this to a frozen ResolvedIdentity at the end.
 */
export interface ResolutionContext {
  input: IdentityInput;
  fullName: string | null;
  emails: Array<{ email: string; source: string; confidence: number }>;
  phones: Array<{ phone: string; source: string; confidence: number }>;
  socialProfiles: Array<{ platform: string; url: string; username: string }>;
  website: string | null;
  company: string | null;
  location: string | null;
  bio: string | null;
}

export function createEmptyContext(input: IdentityInput): ResolutionContext {
  return {
    input,
    fullName: input.displayName ?? null,
    emails: [],
    phones: [],
    socialProfiles: input.username
      ? [{ platform: input.platform, url: input.profileUrl ?? '', username: input.username }]
      : [],
    website: null,
    company: null,
    location: null,
    bio: null,
  };
}
