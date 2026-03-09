import { Job, Queue } from "bullmq";
import { db } from "@alh/db";
import { sql } from "drizzle-orm";
import { redisConnection, QUEUE_NAMES } from "@alh/queues";
import { logger } from "@alh/observability";
import type { InstagramScrubJobData } from "@alh/queues";

const log = logger.child({ module: "instagram-scrub-processor" });

// ─── Regex patterns ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
const PHONE_DIGITS_RE = /[^\d+]/g;

// ─── Business keyword patterns ──────────────────────────────────────────────

const BUSINESS_KEYWORDS = [
  "llc", "inc", "co.", "corp", "ltd",
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
const LOCATION_RE = /\b(based in|located in|serving|📍|🏠)\b/i;
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

interface RawProfile {
  id: number;
  tenant_id: number;
  instagram_handle: string;
  display_name: string | null;
  bio_text: string | null;
  profile_url: string | null;
  follower_count: number | null;
  following_count: number | null;
  post_count: number | null;
  is_private: boolean | null;
  is_business: boolean | null;
  category: string | null;
  public_email_candidate: string | null;
  public_phone_candidate: string | null;
  website_url: string | null;
  location_clues: string | null;
  discovery_run_id: number | null;
  processing_status: string | null;
}

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
  // Must have 10+ digits (with or without leading +)
  const digitCount = cleaned.replace(/\+/, "").length;
  return digitCount >= 10 ? cleaned : null;
}

// ─── Classification ─────────────────────────────────────────────────────────

function classifyProfileType(profile: RawProfile): ProfileType {
  const bio = profile.bio_text?.toLowerCase() ?? "";
  const name = profile.display_name?.toLowerCase() ?? "";
  const category = profile.category?.toLowerCase() ?? "";
  const combined = `${bio} ${name} ${category}`;

  // Explicit business account flag from Instagram
  if (profile.is_business) return "business";

  // Check for business indicators
  if (BUSINESS_RE.test(combined)) return "business";
  if (profile.public_email_candidate || profile.public_phone_candidate) return "business";
  if (profile.website_url) return "business";
  if (profile.category && profile.category.length > 0) return "business";

  // Check for creator indicators
  if (CREATOR_RE.test(combined)) return "creator";

  // Check for personal indicators
  if (PERSONAL_RE.test(combined)) return "personal";

  // Not enough signal
  return "unclear";
}

// ─── Scoring functions ──────────────────────────────────────────────────────

function scoreNicheFit(profile: RawProfile, keywords: string[]): number {
  let score = 0;
  const bio = profile.bio_text?.toLowerCase() ?? "";
  const name = profile.display_name?.toLowerCase() ?? "";
  const category = profile.category?.toLowerCase() ?? "";
  const combined = `${bio} ${name} ${category}`;

  // Keyword matches in bio/name/category
  for (const keyword of keywords) {
    if (combined.includes(keyword.toLowerCase())) {
      score += 20;
    }
  }

  // Category match (Instagram business category)
  if (category.length > 0) {
    for (const keyword of keywords) {
      if (category.includes(keyword.toLowerCase())) {
        score += 25;
        break; // Only count category bonus once
      }
    }
  }

  // TODO: Location match when tenant has target cities configured
  // if (targetCities && profile.city) score += 10;

  return Math.min(score, 100);
}

function scoreContactability(profile: RawProfile): number {
  let score = 0;

  if (profile.public_email_candidate) score += 40;
  if (profile.public_phone_candidate) score += 30;
  if (profile.website_url) score += 20;
  if (profile.category && profile.category.length > 0) score += 10;

  // Private profile is a deal-breaker
  if (profile.is_private) score -= 50;

  // No bio at all is a bad sign
  if (!profile.bio_text || profile.bio_text.trim().length === 0) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function scoreBioQuality(profile: RawProfile): number {
  const bio = profile.bio_text ?? "";
  let score = 0;

  // Bio length
  if (bio.length > 50) score += 15;

  // Call to action
  if (CTA_RE.test(bio)) score += 20;

  // Service description
  if (SERVICE_RE.test(bio)) score += 20;

  // Location mention
  if (LOCATION_RE.test(bio)) score += 15;

  // Credentials/certifications
  if (CREDENTIAL_RE.test(bio)) score += 15;

  // Business-type emojis
  if (BUSINESS_EMOJI_RE.test(bio)) score += 15;

  return Math.min(score, 100);
}

function computePrequalScore(
  nicheFit: number,
  contactability: number,
  bioQuality: number,
  profileType: ProfileType,
  isPrivate: boolean
): { score: number; status: PrequalStatus } {
  // Weighted average
  let score = Math.round(nicheFit * 0.4 + contactability * 0.3 + bioQuality * 0.3);

  // Personal profiles get penalized
  if (profileType === "personal") {
    score = Math.max(0, score - 20);
  }

  // Determine status
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

  // ─── Step 1: Load Raw Profile ───────────────────────────────────────────
  const rawResult = await db.execute(
    sql`SELECT * FROM raw_instagram_profiles WHERE id = ${rawProfileId} AND tenant_id = ${tenantId}`
  );

  const rows = rawResult as unknown as Record<string, unknown>[];
  if (!rows || rows.length === 0) {
    throw new Error(`Raw profile not found: ${rawProfileId} for tenant ${tenantId}`);
  }

  const profile = rows[0] as unknown as RawProfile;

  log.info(
    { rawProfileId, handle: profile.instagram_handle, tenantId },
    "Loaded raw Instagram profile"
  );

  // ─── Step 2: Normalize Handle ───────────────────────────────────────────
  const handle = normalizeHandle(profile.instagram_handle);
  const profileUrl = normalizeProfileUrl(handle);
  const normalizedEmail = normalizeEmail(profile.public_email_candidate);
  const normalizedPhone = normalizePhone(profile.public_phone_candidate);

  // ─── Step 3: Duplicate Scrub ────────────────────────────────────────────
  const dupeResult = await db.execute(
    sql`SELECT id FROM instagram_profile_candidates
        WHERE tenant_id = ${tenantId} AND instagram_handle = ${handle}
        LIMIT 1`
  );

  const dupeRows = dupeResult as unknown as Record<string, unknown>[];
  if (dupeRows && dupeRows.length > 0) {
    log.info({ handle, tenantId }, "Duplicate profile detected, skipping");

    // Mark raw profile as duplicate
    await db.execute(
      sql`UPDATE raw_instagram_profiles
          SET processing_status = 'duplicate'
          WHERE id = ${rawProfileId}`
    );

    return { status: "duplicate", handle };
  }

  // ─── Step 4: Classify Profile Type ──────────────────────────────────────
  const profileType = classifyProfileType(profile);

  // ─── Step 5: Score Niche Fit ────────────────────────────────────────────
  // TODO: Load tenant vertical keywords from config dynamically
  // For now, use credit repair keywords as default
  const nicheKeywords = CREDIT_REPAIR_KEYWORDS;
  const nicheFit = scoreNicheFit(profile, nicheKeywords);

  // ─── Step 6: Score Contactability ───────────────────────────────────────
  const contactability = scoreContactability(profile);

  // ─── Step 7: Score Bio Quality ──────────────────────────────────────────
  const bioQuality = scoreBioQuality(profile);

  // ─── Step 8: Overall Prequal Score ──────────────────────────────────────
  const { score: prequalScore, status: prequalStatus } = computePrequalScore(
    nicheFit,
    contactability,
    bioQuality,
    profileType,
    !!profile.is_private
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
      isPrivate: !!profile.is_private,
    },
    "Prequal scoring complete"
  );

  // ─── Step 9: Insert into instagram_profile_candidates ───────────────────
  const insertResult = await db.execute(
    sql`INSERT INTO instagram_profile_candidates (
          tenant_id,
          raw_profile_id,
          instagram_handle,
          profile_url,
          display_name,
          bio_text,
          category,
          website_url,
          normalized_email,
          normalized_phone,
          profile_type,
          duplicate_status,
          niche_fit_score,
          contactability_score,
          bio_quality_score,
          overall_prequal_score,
          prequal_status,
          scrub_notes,
          created_at,
          updated_at
        ) VALUES (
          ${tenantId},
          ${rawProfileId},
          ${handle},
          ${profileUrl},
          ${profile.display_name},
          ${profile.bio_text},
          ${profile.category},
          ${profile.website_url},
          ${normalizedEmail},
          ${normalizedPhone},
          ${profileType},
          ${'unique'},
          ${nicheFit},
          ${contactability},
          ${bioQuality},
          ${prequalScore},
          ${prequalStatus},
          ${`type=${profileType}, private=${!!profile.is_private}`},
          NOW(),
          NOW()
        )
        RETURNING id`
  );

  const insertRows = insertResult as unknown as Record<string, unknown>[];
  const candidateId = insertRows[0]?.id as number | undefined;

  if (!candidateId) {
    throw new Error(`Failed to insert candidate for handle: ${handle}`);
  }

  log.info({ candidateId, handle, prequalStatus }, "Candidate record created");

  // ─── Step 10: Queue for enrichment if status = 'enrich' ─────────────────
  if (prequalStatus === "enrich") {
    const enrichmentQueue = new Queue(QUEUE_NAMES.INSTAGRAM_ENRICHMENT, {
      connection: redisConnection,
    });

    await enrichmentQueue.add(
      "enrich",
      { tenantId, candidateId },
      { jobId: `ig-enrich-${candidateId}-${Date.now()}` }
    );

    await enrichmentQueue.close();

    log.info(
      { candidateId, handle },
      "Queued candidate for Instagram enrichment"
    );
  }

  // ─── Step 11: Update raw profile processing_status ──────────────────────
  await db.execute(
    sql`UPDATE raw_instagram_profiles
        SET processing_status = 'completed'
        WHERE id = ${rawProfileId}`
  );

  return {
    status: prequalStatus,
    handle,
    candidateId,
    profileType,
    scores: {
      nicheFit,
      contactability,
      bioQuality,
      prequal: prequalScore,
    },
  };
}
