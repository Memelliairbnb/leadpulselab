import { createHash } from "node:crypto";

/**
 * Normalize text by lowercasing, trimming, and collapsing whitespace.
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Create a SHA-256 hash of normalized text.
 */
export function hashText(text: string): string {
  const normalized = normalizeText(text);
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Normalize a name: lowercase, trim, remove non-alpha characters, collapse spaces.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Calculate Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

/**
 * Calculate Jaccard similarity between two sets of tokens.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeText(a).split(" "));
  const tokensB = new Set(normalizeText(b).split(" "));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;

  const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
  const union = new Set([...tokensA, ...tokensB]);

  return intersection.size / union.size;
}

export interface DuplicateCandidate {
  id: string;
  profileUrl: string | null;
  contentHash: string | null;
  authorName: string | null;
  platformName: string | null;
  contactMethods: string[];
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  matchedLeadId: string | null;
  matchType: string | null;
  matchScore: number;
}

/**
 * Check if a lead is a duplicate against a list of existing candidates.
 * Uses multiple matching strategies with decreasing confidence.
 */
export function checkDuplicate(
  lead: DuplicateCandidate,
  existingLeads: DuplicateCandidate[]
): DuplicateCheckResult {
  for (const existing of existingLeads) {
    // Strategy 1: Exact profile URL match (highest confidence)
    if (
      lead.profileUrl &&
      existing.profileUrl &&
      normalizeText(lead.profileUrl) === normalizeText(existing.profileUrl)
    ) {
      return {
        isDuplicate: true,
        matchedLeadId: existing.id,
        matchType: "profile_url",
        matchScore: 1.0,
      };
    }

    // Strategy 2: Content text hash match
    if (
      lead.contentHash &&
      existing.contentHash &&
      lead.contentHash === existing.contentHash
    ) {
      return {
        isDuplicate: true,
        matchedLeadId: existing.id,
        matchType: "content_hash",
        matchScore: 0.95,
      };
    }

    // Strategy 3: Name + platform fuzzy match
    if (
      lead.authorName &&
      existing.authorName &&
      lead.platformName &&
      existing.platformName &&
      lead.platformName === existing.platformName
    ) {
      const nameA = normalizeName(lead.authorName);
      const nameB = normalizeName(existing.authorName);

      if (nameA === nameB) {
        return {
          isDuplicate: true,
          matchedLeadId: existing.id,
          matchType: "name_platform_exact",
          matchScore: 0.9,
        };
      }

      const maxLen = Math.max(nameA.length, nameB.length);
      if (maxLen > 0) {
        const distance = levenshtein(nameA, nameB);
        const similarity = 1 - distance / maxLen;
        if (similarity >= 0.85) {
          return {
            isDuplicate: true,
            matchedLeadId: existing.id,
            matchType: "name_platform_fuzzy",
            matchScore: similarity,
          };
        }
      }
    }

    // Strategy 4: Contact method match (email or phone)
    if (lead.contactMethods.length > 0 && existing.contactMethods.length > 0) {
      const leadContacts = new Set(
        lead.contactMethods.map((c) => normalizeText(c))
      );
      const existingContacts = new Set(
        existing.contactMethods.map((c) => normalizeText(c))
      );
      const hasOverlap = [...leadContacts].some((c) =>
        existingContacts.has(c)
      );

      if (hasOverlap) {
        return {
          isDuplicate: true,
          matchedLeadId: existing.id,
          matchType: "contact_method",
          matchScore: 0.85,
        };
      }
    }
  }

  return {
    isDuplicate: false,
    matchedLeadId: null,
    matchType: null,
    matchScore: 0,
  };
}
