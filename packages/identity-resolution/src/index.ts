/**
 * @alh/identity-resolution
 *
 * Identity Resolution Engine for LeadPulseLab.
 *
 * Takes a raw signal (username, profile URL, post text) and resolves it into
 * a full identity with verified contact information. A signal is NOT a lead
 * until it passes through this pipeline.
 */

// Core types
export type {
  IdentityInput,
  ResolvedIdentity,
  ResolutionStatus,
  ResolutionContext,
} from './pipeline';

export { createEmptyContext } from './pipeline';

// Main resolver
export { resolveIdentity } from './resolver';

// Individual steps (for testing or custom pipelines)
export { extractProfile } from './steps/profile-extractor';
export { searchCrossPlatform } from './steps/cross-platform-search';
export { discoverWebsite } from './steps/website-discovery';
export { discoverEmails } from './steps/email-discovery';
export { discoverPhones } from './steps/phone-discovery';
export { scoreIdentity } from './steps/identity-scorer';
export type { ScoreResult } from './steps/identity-scorer';

// Utilities
export { politeDelay } from './util';
