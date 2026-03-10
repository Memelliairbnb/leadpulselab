import { Job } from "bullmq";
import { db, rawInstagramProfiles, instagramProfileCandidates } from "@alh/db";
import { eq, and } from "drizzle-orm";
import { getQueue, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import type { InstagramScrubJobData } from "@alh/queues";

const log = logger.child({ module: "instagram-scrub-processor" });

// ─── Regex patterns ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
const PHONE_DIGITS_RE = /[^\d+]/g;

// ─── Business keyword patterns ──────────────────────────────────────────────

const BUSINESS_KEYWORDS = [
  "llc", "inc", "co\\.", "corp", "ltd",
  "\\bwe\\b", "our team", "services", "book now",
  "dm for pricing", "dm for info", "dm to order",
  "appointments", "consultations", "free consultation",
  "licensed", "certified", "insured", "bonded",
  "call us", "contact us", "visit us",
  "shop now", "order now", "buy now",
  "est\\.", "since \\d{4}",
];
const BUSINESS_RE = new RegExp(BUSINESS_KEYWORDS.join("|"), "i");

const CREATOR_KEYWORDS = [
  "content creator", "influencer", "collab",
  "brand ambassador", "partnerships", "pr friendly",
  "linktree", "linktr\\.ee", "beacons\\.ai", "stan\\.store",
  "campsite\\.bio", "tap\\.bio", "hoo\\.be",
  "youtube", "tiktok", "podcast",
  "creator", "blogger", "vlogger",
];
const CREATOR_RE = new RegExp(CREATOR_KEYWORDS.join("|"), "i");

const PERSONAL_KEYWORDS = [
  "just me", "\\bdad\\b", "\\bmom\\b", "\\bwife\\b", "\\bhusband\\b",
  "dog mom", "cat mom", "plant mom",
  "living my best life", "personal account",
  "not a business",
];
const PERSONAL_RE = new RegExp(PERSONAL_KEYWORDS.join("|"), "i");

// ─── Bio quality indicators ─────────────────────────────────────────────────

const CTA_RE = /\b(dm|call|book|visit|link in bio|click|tap|shop|order|schedule)\b/i;
const SERVICE_RE = /\b(repair|restoration|fix|specialist|consultant|expert|coaching|training|services|solutions)\b/i;
const LOCATION_RE = /\b(based in|located in|serving)\b|📍|🏠/i;
const CREDENTIAL_RE = /\b(certified|licensed|accredited|bonded|insured|diploma|degree|MBA|CPA|registered)\b/i;
const BUSINESS_EMOJI_RE = /[📧📞🏠💼🏢📱☎️✉️🔗💰📈]/;

// ─── Credit repair niche keywords (default vertical) ────────────────────────

const CREDIT_REPAIR_KEYWORDS = [
  "credit repair",
  "credit restoration",
  "credit fix",
  "credit score",
  "fico",
  "credit specialist",
  "credit consultant",
  "debt relief",
  "financial literacy",
  "credit education",
  "credit coaching",
  "credit bureau",
  "tradeline",
  "credit sweep",
  "dispute",
  "charge off",
  "collection removal",
];

// ─── Types ──────────────────────────────────────────────────────────────────

type ProfileType = "business" | "creator" | "personal" | "unclear";
type PrequalStatus = "enrich" | "partial" | "discard";

// Infer the row type from the Drizzle schema
type RawProfileRow = typeof rawInstagramProfiles.$inferSelect;

// ─── Normalization helpers ──────────────────────────────────────────────────

function normalizeHandle(handle: string): string {
  return handle.toLowerCase().replace(/^@/, "").trim();
}

function normalizeProfileUrl(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}

function normalizeEmail(email: string | null): string | null {
  if (!email) return null;
  const cleaned = email.toLowerCase().trim();
  return EMAIL_RE.test(cleaned) ? cleaned : null;
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(PHONE_DIGITS_RE, "");
  const digitCount = cleaned.replace(/\+/, "").length;
  return digitCount >= 10 ? cleaned : null;
}

// ─── Classification ─────────────────────────────────────────────────────────

function classifyProfileType(profile: RawProfileRow): ProfileType {
  const bio = profile.bioText?.toLowerCase() ?? "";
  const name = profile.displayName?.toLowerCase() ?? "";
  const category = profile.category?.toLowerCase() ?? "";
  const combined = `${bio} ${name} ${category}`;

  // Explicit business account flag from Instagram
  if (profile.isBusiness) return "business";

  // Check for business indicators
  if (BUSINESS_RE.test(combined)) return "business";
  if (profile.publicEmailCandidate || profile.publicPhoneCandidate) return "business";
  if (profile.websiteUrl) return "business";
  if (category.length > 0) return "business";

  // Check for creator indicators
  if (CREATOR_RE.test(combined)) return "creator";

  // Check for personal indicators
  if (PERSONAL_RE.test(combined)) return "personal";

  return "unclear";
}

// ─── Scoring functions ──────────────────────────────────────────────────────

function scoreNicheFit(profile: RawProfileRow, keywords: string[]): number {
  let score = 0;
  const bio = profile.bioText?.toLowerCase() ?? "";
  const name = profile.displayName?.toLowerCase() ?? "";
  const category = profile.category?.toLowerCase() ?? "";
  const combined = `${bio} ${name} ${category}`;

  // Keyword matches in bio/name/category
  for (const keyword of keywords) {
    if (combined.includes(keyword.toLowerCase())) {
      score += 20;
    }
  }

  // Category match bonus (only once)
  if (category.length > 0) {
    for (const keyword of keywords) {
      if (category.includes(keyword.toLowerCase())) {
        score += 25;
        break;
      }
    }
  }

  return Math.min(score, 100);
}

function scoreContactability(profile: RawProfileRow): number {
  let score = 0;

  if (profile.publicEmailCandidate) score += 40;
  if (profile.publicPhoneCandidate) score += 30;
  if (profile.websiteUrl) score += 20;
  if (profile.category && profile.category.length > 0) score += 10;

  // Private profile is a deal-breaker
  if (profile.isPrivate) score -= 50;

  // No bio at all is a bad sign
  if (!profile.bioText || profile.bioText.trim().length === 0) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function scoreBioQuality(profile: RawProfileRow): number {
  const bio = profile.bioText ?? "";
  let score = 0;

  if (bio.length > 50) score += 15;
  if (CTA_RE.test(bio)) score += 20;
  if (SERVICE_RE.test(bio)) score += 20;
  if (LOCATION_RE.test(bio)) score += 15;
  if (CREDENTIAL_RE.test(bio)) score += 15;
  if (BUSINESS_EMOJI_RE.test(bio)) score += 15;

  return Math.min(score, 100);
}

function computePrequalScore(
  nicheFit: number,
  contactability: number,
  bioQuality: number,
  profileType: ProfileType,
  isPrivate: boolean,
): { score: number; status: PrequalStatus } {
  let score = Math.round(nicheFit * 0.4 + contactability * 0.3 + bioQuality * 0.3);

  // Personal profiles get penalized
  if (profileType === "personal") {
    score = Math.max(0, score - 20);
  }

  let status: PrequalStatus;
  if (isPrivate) {
    status = "discard";
  } else if (score >= 50) {
    status = "enrich";
  } else if (score >= 30) {
    status = "partial";
  } else {
    status = "discard";
  }

  return { score, status };
}

// ─── Main processor ─────────────────────────────────────────────────────────

export async function processInstagramScrub(job: Job<InstagramScrubJobData>) {
  const { tenantId, rawProfileId, discoveryRunId } = job.data;
  const startMs = Date.now();

  // ── Step 1: Fetch raw profile ──────────────────────────────────────────
  const [profile] = await db
    .select()
    .from(rawInstagramProfiles)
    .where(
      and(
        eq(rawInstagramProfiles.id, rawProfileId),
        eq(rawInstagramProfiles.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!profile) {
    throw new Error(`Raw profile not found: id=${rawProfileId} tenant=${tenantId}`);
  }

  log.info(
    { rawProfileId, handle: profile.instagramHandle, tenantId },
    "Loaded raw Instagram profile",
  );

  // ── Step 2: Normalize data ─────────────────────────────────────────────
  const handle = normalizeHandle(profile.instagramHandle);
  const profileUrl = normalizeProfileUrl(handle);
  const normalizedEmail = normalizeEmail(profile.publicEmailCandidate);
  const normalizedPhone = normalizePhone(profile.publicPhoneCandidate);

  // ── Step 3: Deduplication check ────────────────────────────────────────
  const [existing] = await db
    .select({ id: instagramProfileCandidates.id })
    .from(instagramProfileCandidates)
    .where(
      and(
        eq(instagramProfileCandidates.tenantId, tenantId),
        eq(instagramProfileCandidates.instagramHandle, handle),
      ),
    )
    .limit(1);

  if (existing) {
    log.info({ handle, tenantId, existingId: existing.id }, "Duplicate profile detected, skipping");

    await db
      .update(rawInstagramProfiles)
      .set({ processingStatus: "duplicate" })
      .where(eq(rawInstagramProfiles.id, rawProfileId));

    return { status: "duplicate" as const, handle, durationMs: Date.now() - startMs };
  }

  // ── Step 4: Classify profile type ──────────────────────────────────────
  const profileType = classifyProfileType(profile);

  // ── Step 5: Score niche fit ────────────────────────────────────────────
  // TODO: Load tenant vertical keywords dynamically from config
  const nicheKeywords = CREDIT_REPAIR_KEYWORDS;
  const nicheFit = scoreNicheFit(profile, nicheKeywords);

  // ── Step 6: Score contactability ───────────────────────────────────────
  const contactability = scoreContactability(profile);

  // ── Step 7: Score bio quality ──────────────────────────────────────────
  const bioQuality = scoreBioQuality(profile);

  // ── Step 8: Compute overall prequal score ──────────────────────────────
  const { score: prequalScore, status: prequalStatus } = computePrequalScore(
    nicheFit,
    contactability,
    bioQuality,
    profileType,
    !!profile.isPrivate,
  );

  log.info(
    {
      handle,
      profileType,
      nicheFit,
      contactability,
      bioQuality,
      prequalScore,
      prequalStatus,
      isPrivate: !!profile.isPrivate,
    },
    "Prequal scoring complete",
  );

  // ── Step 9: Insert into instagramProfileCandidates ─────────────────────
  const [inserted] = await db
    .insert(instagramProfileCandidates)
    .values({
      tenantId,
      rawProfileId,
      instagramHandle: handle,
      profileUrl,
      displayName: profile.displayName,
      bioText: profile.bioText,
      category: profile.category,
      websiteUrl: profile.websiteUrl,
      normalizedEmail,
      normalizedPhone,
      profileType,
      duplicateStatus: "unique",
      nicheFitScore: nicheFit,
      contactabilityScore: contactability,
      bioQualityScore: bioQuality,
      overallPrequalScore: prequalScore,
      prequalStatus,
      scrubNotes: `type=${profileType}, private=${!!profile.isPrivate}`,
    })
    .returning({ id: instagramProfileCandidates.id });

  if (!inserted) {
    throw new Error(`Failed to insert candidate for handle: ${handle}`);
  }

  const candidateId = inserted.id;

  log.info({ candidateId, handle, prequalStatus }, "Candidate record created");

  // ── Step 10: Queue for enrichment if qualified ─────────────────────────
  if (prequalStatus === "enrich") {
    const enrichmentQueue = getQueue(QUEUE_NAMES.INSTAGRAM_ENRICHMENT);
    await enrichmentQueue.add(
      "enrich",
      { tenantId, candidateId },
      { jobId: `ig-enrich-${candidateId}-${Date.now()}` },
    );

    log.info({ candidateId, handle }, "Queued candidate for Instagram enrichment");
  }

  // ── Step 11: Mark raw profile as processed ─────────────────────────────
  await db
    .update(rawInstagramProfiles)
    .set({ processingStatus: "processed" })
    .where(eq(rawInstagramProfiles.id, rawProfileId));

  const durationMs = Date.now() - startMs;
  log.info({ handle, candidateId, prequalStatus, durationMs }, "Scrub complete");

  return {
    status: prequalStatus,
    handle,
    candidateId,
    profileType,
    scores: { nicheFit, contactability, bioQuality, prequal: prequalScore },
    durationMs,
  };
}
