import type { Job } from "bullmq";
import { db } from "@alh/db";
import {
  rawLeads,
  canonicalLeads,
  leadIdentities,
  leadSignals,
  scrubRuns,
  duplicateCandidates,
  identityMerges,
  suppressionLogs,
} from "@alh/db";
import { getQueue, SWARM_QUEUE_NAMES } from "@alh/queues";
import type { ScrubDedupeJobData, CanonicalEnrichmentJobData } from "@alh/queues";
import { logger } from "@alh/observability";
import { eq, and, sql } from "drizzle-orm";

const log = logger.child({ processor: "scrubber" });

// ─── Match result from a single pipeline stage ──────────────────────────────
interface StageMatch {
  stage: string;
  matchMethod: string;
  canonicalLeadId: number;
  identityId?: number;
  confidence: number;
  evidence: Record<string, unknown>;
}

// ─── Levenshtein distance (simple DP) ────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ─── Stage 1: URL normalization check ────────────────────────────────────────
async function stageUrlMatch(
  normalizedProfileUrl: string | null,
): Promise<StageMatch | null> {
  if (!normalizedProfileUrl) return null;

  const [match] = await db
    .select({
      id: leadIdentities.id,
      canonicalLeadId: leadIdentities.canonicalLeadId,
      profileUrl: leadIdentities.profileUrl,
    })
    .from(leadIdentities)
    .where(eq(leadIdentities.profileUrl, normalizedProfileUrl))
    .limit(1);

  if (!match) return null;

  log.debug({ profileUrl: normalizedProfileUrl, canonicalLeadId: match.canonicalLeadId }, "Stage 1: URL match found");
  return {
    stage: "1_url_match",
    matchMethod: "profile_url",
    canonicalLeadId: match.canonicalLeadId,
    identityId: match.id,
    confidence: 0.98,
    evidence: { profileUrl: normalizedProfileUrl },
  };
}

// ─── Stage 2: Domain normalization ───────────────────────────────────────────
async function stageDomainMatch(
  normalizedDomain: string | null,
): Promise<StageMatch | null> {
  if (!normalizedDomain) return null;

  const [match] = await db
    .select({ id: canonicalLeads.id, normalizedDomain: canonicalLeads.normalizedDomain })
    .from(canonicalLeads)
    .where(eq(canonicalLeads.normalizedDomain, normalizedDomain))
    .limit(1);

  if (!match) return null;

  log.debug({ domain: normalizedDomain, canonicalLeadId: match.id }, "Stage 2: Domain match found");
  return {
    stage: "2_domain_match",
    matchMethod: "normalized_domain",
    canonicalLeadId: match.id,
    confidence: 0.80,
    evidence: { domain: normalizedDomain },
  };
}

// ─── Stage 3: Exact text hash ────────────────────────────────────────────────
async function stageTextHashMatch(
  textHash: string,
  rawLeadId: number,
): Promise<StageMatch | null> {
  // Find another raw lead with the same text hash that has already been processed
  const [match] = await db
    .select({
      id: rawLeads.id,
      textHash: rawLeads.textHash,
    })
    .from(rawLeads)
    .where(
      and(
        eq(rawLeads.textHash, textHash),
        eq(rawLeads.processingStatus, "completed"),
      ),
    )
    .limit(1);

  if (!match || match.id === rawLeadId) return null;

  // Look up which canonical lead this raw lead mapped to via lead_identities
  // We search by checking if there is a canonical lead already created from this source
  // This is a heuristic — in practice we look for suppression logs
  const [suppression] = await db
    .select({ canonicalLeadId: suppressionLogs.canonicalLeadId })
    .from(suppressionLogs)
    .where(eq(suppressionLogs.rawLeadId, match.id))
    .limit(1);

  if (suppression) {
    log.debug({ textHash, canonicalLeadId: suppression.canonicalLeadId }, "Stage 3: Text hash match via suppression log");
    return {
      stage: "3_text_hash",
      matchMethod: "text_hash",
      canonicalLeadId: suppression.canonicalLeadId,
      confidence: 0.99,
      evidence: { textHash, matchedRawLeadId: match.id },
    };
  }

  return null;
}

// ─── Stage 4: Email match ────────────────────────────────────────────────────
async function stageEmailMatch(
  normalizedEmail: string | null,
): Promise<StageMatch | null> {
  if (!normalizedEmail) return null;

  const [match] = await db
    .select({
      id: leadIdentities.id,
      canonicalLeadId: leadIdentities.canonicalLeadId,
    })
    .from(leadIdentities)
    .where(eq(leadIdentities.email, normalizedEmail))
    .limit(1);

  if (!match) return null;

  log.debug({ email: normalizedEmail, canonicalLeadId: match.canonicalLeadId }, "Stage 4: Email match found");
  return {
    stage: "4_email_match",
    matchMethod: "email",
    canonicalLeadId: match.canonicalLeadId,
    identityId: match.id,
    confidence: 0.97,
    evidence: { email: normalizedEmail },
  };
}

// ─── Stage 5: Phone match ────────────────────────────────────────────────────
async function stagePhoneMatch(
  normalizedPhone: string | null,
): Promise<StageMatch | null> {
  if (!normalizedPhone) return null;

  const [match] = await db
    .select({
      id: leadIdentities.id,
      canonicalLeadId: leadIdentities.canonicalLeadId,
    })
    .from(leadIdentities)
    .where(eq(leadIdentities.phone, normalizedPhone))
    .limit(1);

  if (!match) return null;

  log.debug({ phone: normalizedPhone, canonicalLeadId: match.canonicalLeadId }, "Stage 5: Phone match found");
  return {
    stage: "5_phone_match",
    matchMethod: "phone",
    canonicalLeadId: match.canonicalLeadId,
    identityId: match.id,
    confidence: 0.96,
    evidence: { phone: normalizedPhone },
  };
}

// ─── Stage 6: Name + platform fuzzy match ────────────────────────────────────
async function stageNamePlatformFuzzyMatch(
  normalizedProfileName: string | null,
  platform: string,
): Promise<StageMatch | null> {
  if (!normalizedProfileName || normalizedProfileName.length < 3) return null;

  // Find identities on the same platform
  const candidates = await db
    .select({
      id: leadIdentities.id,
      canonicalLeadId: leadIdentities.canonicalLeadId,
      profileName: leadIdentities.profileName,
    })
    .from(leadIdentities)
    .where(eq(leadIdentities.platform, platform))
    .limit(200);

  for (const candidate of candidates) {
    if (!candidate.profileName) continue;
    const distance = levenshtein(
      normalizedProfileName,
      candidate.profileName.toLowerCase().trim(),
    );
    if (distance <= 2) {
      log.debug(
        { name: normalizedProfileName, matchedName: candidate.profileName, distance, canonicalLeadId: candidate.canonicalLeadId },
        "Stage 6: Fuzzy name+platform match found",
      );
      // Confidence scales with distance: 0=0.92, 1=0.85, 2=0.78
      const confidence = distance === 0 ? 0.92 : distance === 1 ? 0.85 : 0.78;
      return {
        stage: "6_name_platform_fuzzy",
        matchMethod: "fuzzy_name_platform",
        canonicalLeadId: candidate.canonicalLeadId,
        identityId: candidate.id,
        confidence,
        evidence: {
          inputName: normalizedProfileName,
          matchedName: candidate.profileName,
          platform,
          levenshteinDistance: distance,
        },
      };
    }
  }

  return null;
}

// ─── Stage 6b: Author + platform exact match via lead_signals ────────────────
async function stageAuthorPlatformMatch(
  authorName: string | null,
  platform: string,
): Promise<StageMatch | null> {
  if (!authorName || authorName.length < 2) return null;

  const normalizedAuthor = authorName.toLowerCase().trim();

  // Check lead_signals for same author_name + source_platform
  const [existingSignal] = await db
    .select({
      id: leadSignals.id,
      rawLeadId: leadSignals.rawLeadId,
      qualifiedLeadId: leadSignals.qualifiedLeadId,
    })
    .from(leadSignals)
    .where(
      and(
        eq(leadSignals.authorName, normalizedAuthor),
        eq(leadSignals.sourcePlatform, platform),
      ),
    )
    .limit(1);

  if (!existingSignal) return null;

  // Look up the canonical lead through the identity table using the raw_lead_id
  const [identity] = await db
    .select({
      id: leadIdentities.id,
      canonicalLeadId: leadIdentities.canonicalLeadId,
    })
    .from(leadIdentities)
    .where(eq(leadIdentities.platform, platform))
    .limit(1);

  if (!identity) return null;

  log.debug(
    { authorName: normalizedAuthor, platform, canonicalLeadId: identity.canonicalLeadId },
    "Stage 6b: Author+platform match found via lead_signals",
  );

  return {
    stage: "6b_author_platform",
    matchMethod: "author_platform",
    canonicalLeadId: identity.canonicalLeadId,
    identityId: identity.id,
    confidence: 0.88,
    evidence: { authorName: normalizedAuthor, platform },
  };
}

// ─── Stage 6c: Content similarity match ─────────────────────────────────────
async function stageContentSimilarityMatch(
  contentSnippet: string | null,
  platform: string,
): Promise<StageMatch | null> {
  if (!contentSnippet || contentSnippet.length < 30) return null;

  const normalizedContent = contentSnippet.toLowerCase().trim();
  // Get recent signals from same platform
  const recentSignals = await db
    .select({
      id: leadSignals.id,
      rawLeadId: leadSignals.rawLeadId,
      contentSnippet: leadSignals.contentSnippet,
      authorName: leadSignals.authorName,
    })
    .from(leadSignals)
    .where(eq(leadSignals.sourcePlatform, platform))
    .limit(200);

  for (const sig of recentSignals) {
    if (!sig.contentSnippet) continue;
    const existingContent = sig.contentSnippet.toLowerCase().trim();

    // Use trigram-like overlap: count shared 3-char sequences
    const similarity = computeTrigramSimilarity(normalizedContent, existingContent);
    if (similarity >= 0.7) {
      // Find the canonical lead for this signal's raw_lead via suppression or identity
      const [suppression] = await db
        .select({ canonicalLeadId: suppressionLogs.canonicalLeadId })
        .from(suppressionLogs)
        .where(eq(suppressionLogs.rawLeadId, sig.rawLeadId))
        .limit(1);

      if (suppression) {
        log.debug(
          { similarity, canonicalLeadId: suppression.canonicalLeadId },
          "Stage 6c: Content similarity match found",
        );
        return {
          stage: "6c_content_similarity",
          matchMethod: "content_similarity",
          canonicalLeadId: suppression.canonicalLeadId,
          confidence: Math.min(0.95, 0.7 + similarity * 0.25),
          evidence: {
            similarity,
            matchedSignalId: sig.id,
            matchedAuthor: sig.authorName,
          },
        };
      }
    }
  }

  return null;
}

// ─── Trigram similarity helper ──────────────────────────────────────────────
function computeTrigramSimilarity(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return 0;

  const trigramsA = new Set<string>();
  const trigramsB = new Set<string>();

  for (let i = 0; i <= a.length - 3; i++) trigramsA.add(a.substring(i, i + 3));
  for (let i = 0; i <= b.length - 3; i++) trigramsB.add(b.substring(i, i + 3));

  let intersection = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersection++;
  }

  const union = trigramsA.size + trigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Stage 7: Identity merge candidate detection ─────────────────────────────
function stageIdentityMergeDetection(
  allMatches: StageMatch[],
): { isMergeCandidate: boolean; mergeMatches: StageMatch[] } {
  if (allMatches.length < 2) {
    return { isMergeCandidate: false, mergeMatches: [] };
  }

  // Check if partial matches reference different canonical leads
  const uniqueCanonicalIds = new Set(allMatches.map((m) => m.canonicalLeadId));
  if (uniqueCanonicalIds.size >= 2) {
    log.info(
      { canonicalIds: [...uniqueCanonicalIds], matchCount: allMatches.length },
      "Stage 7: Identity merge candidate detected — multiple canonical leads matched",
    );
    return { isMergeCandidate: true, mergeMatches: allMatches };
  }

  return { isMergeCandidate: false, mergeMatches: [] };
}

// ─── Signal detection helpers ───────────────────────────────────────────────

const SIGNAL_PHRASES: { pattern: RegExp; phrase: string }[] = [
  { pattern: /need help with/i, phrase: "need help with" },
  { pattern: /looking for\b/i, phrase: "looking for" },
  { pattern: /anyone recommend/i, phrase: "anyone recommend" },
  { pattern: /can someone help/i, phrase: "can someone help" },
  { pattern: /struggling with/i, phrase: "struggling with" },
  { pattern: /how do i\b/i, phrase: "how do i" },
  { pattern: /where can i find/i, phrase: "where can i find" },
  { pattern: /does anyone know/i, phrase: "does anyone know" },
  { pattern: /i('m| am) trying to/i, phrase: "i'm trying to" },
  { pattern: /any suggestions for/i, phrase: "any suggestions for" },
  { pattern: /what('s| is) the best/i, phrase: "what's the best" },
  { pattern: /is there a service/i, phrase: "is there a service" },
  { pattern: /my credit\b/i, phrase: "my credit" },
  { pattern: /fix my\b/i, phrase: "fix my" },
  { pattern: /help me\b/i, phrase: "help me" },
  { pattern: /bad credit/i, phrase: "bad credit" },
  { pattern: /credit repair/i, phrase: "credit repair" },
  { pattern: /debt relief/i, phrase: "debt relief" },
  { pattern: /collection(s)? on my/i, phrase: "collections on my" },
];

const INTENT_TYPES: { pattern: RegExp; type: string }[] = [
  { pattern: /need help|can someone help|help me|struggling/i, type: "seeking_help" },
  { pattern: /looking for|anyone recommend|where can i find|is there a service/i, type: "requesting_service" },
  { pattern: /struggling|bad credit|in debt|can't afford|falling behind/i, type: "expressing_pain" },
  { pattern: /how do i|how to|what('s| is) the best|any suggestions/i, type: "researching" },
  { pattern: /i('m| am) trying to|want to|planning to|thinking about/i, type: "active_intent" },
  { pattern: /just (got|received|found out)|was denied|rejected/i, type: "triggered_event" },
];

function detectSignalPhrase(text: string | null): string | null {
  if (!text) return null;
  for (const { pattern, phrase } of SIGNAL_PHRASES) {
    if (pattern.test(text)) return phrase;
  }
  return null;
}

function detectIntentType(text: string | null): string | null {
  if (!text) return null;
  for (const { pattern, type } of INTENT_TYPES) {
    if (pattern.test(text)) return type;
  }
  return null;
}

function computeSignalStrength(
  matches: StageMatch[],
  text: string | null,
): number {
  let strength = 30; // base

  // More dedup matches = less unique = lower signal? No — more signals = stronger lead
  // Intent phrases boost strength
  if (text) {
    let intentHits = 0;
    for (const { pattern } of SIGNAL_PHRASES) {
      if (pattern.test(text)) intentHits++;
    }
    strength += Math.min(intentHits * 10, 40);
  }

  // Recency of content would boost, but we don't have that here easily
  // Multiple matches from different stages = strong identity = boost
  strength += Math.min(matches.length * 5, 20);

  // Cap at 1-100
  return Math.max(1, Math.min(100, strength));
}

/**
 * Core scrub/dedupe processor — runs the 8-stage pipeline on a normalized lead.
 */
export async function processScrubDedupe(job: Job<ScrubDedupeJobData>) {
  const { tenantId, leadId: rawLeadId } = job.data;
  const payload = job.data.payload as Record<string, unknown>;
  const startMs = Date.now();

  const normalizedProfileUrl = payload.normalizedProfileUrl as string | null;
  const normalizedDomain = payload.normalizedDomain as string | null;
  const normalizedEmail = payload.normalizedEmail as string | null;
  const normalizedPhone = payload.normalizedPhone as string | null;
  const normalizedProfileName = payload.normalizedProfileName as string | null;
  const textHash = payload.textHash as string;
  const platform = payload.platform as string;
  const rawText = payload.rawText as string | null;
  const contentDate = payload.contentDate as string | null;
  const sourceUrl = payload.normalizedSourceUrl as string | null;

  log.info({ rawLeadId, tenantId, platform }, "Starting 8-stage scrub/dedupe pipeline");

  // Create scrub_run record
  const scrubRun = await db
    .insert(scrubRuns)
    .values({
      tenantId,
      runType: "single",
      status: "running",
      inputCount: 1,
      startedAt: new Date(),
    })
    .returning()
    .then(([r]) => r);

  const allMatches: StageMatch[] = [];

  try {
    // ─── Stage 1: URL normalization check ──────────────────────────────
    const urlMatch = await stageUrlMatch(normalizedProfileUrl);
    if (urlMatch) allMatches.push(urlMatch);

    // ─── Stage 2: Domain normalization ─────────────────────────────────
    const domainMatch = await stageDomainMatch(normalizedDomain);
    if (domainMatch) allMatches.push(domainMatch);

    // ─── Stage 3: Exact text hash ──────────────────────────────────────
    const textMatch = await stageTextHashMatch(textHash, rawLeadId);
    if (textMatch) allMatches.push(textMatch);

    // ─── Stage 4: Email match ──────────────────────────────────────────
    const emailMatch = await stageEmailMatch(normalizedEmail);
    if (emailMatch) allMatches.push(emailMatch);

    // ─── Stage 5: Phone match ──────────────────────────────────────────
    const phoneMatch = await stagePhoneMatch(normalizedPhone);
    if (phoneMatch) allMatches.push(phoneMatch);

    // ─── Stage 6: Name + platform fuzzy match ──────────────────────────
    const nameMatch = await stageNamePlatformFuzzyMatch(normalizedProfileName, platform);
    if (nameMatch) allMatches.push(nameMatch);

    // ─── Stage 6b: Author + platform exact match (signals table) ──────
    const authorMatch = await stageAuthorPlatformMatch(normalizedProfileName, platform);
    if (authorMatch) allMatches.push(authorMatch);

    // ─── Stage 6c: Content similarity match ───────────────────────────
    const contentMatch = await stageContentSimilarityMatch(rawText, platform);
    if (contentMatch) allMatches.push(contentMatch);

    // ─── Stage 7: Identity merge candidate detection ───────────────────
    const { isMergeCandidate, mergeMatches } = stageIdentityMergeDetection(allMatches);

    // ─── Resolution logic ──────────────────────────────────────────────
    const bestMatch = allMatches.length > 0
      ? allMatches.reduce((best, m) => (m.confidence > best.confidence ? m : best))
      : null;

    let resolution: "new" | "suppressed" | "pending_review" | "merge_review";
    let newCanonicalLeadId: number | null = null;
    let newLeads = 0;
    let suppressed = 0;
    let review = 0;
    let merged = 0;

    if (isMergeCandidate) {
      // ─── MERGE candidate: multiple canonical leads matched ─────────
      resolution = "merge_review";
      merged = 1;

      // Create identity_merge records for review
      const canonicalIds = [...new Set(mergeMatches.map((m) => m.canonicalLeadId))];
      const primaryId = canonicalIds[0];

      for (let i = 1; i < canonicalIds.length; i++) {
        await db.insert(identityMerges).values({
          primaryCanonicalId: primaryId,
          mergedCanonicalId: canonicalIds[i],
          mergeReason: "multi_signal_overlap",
          confidence: String(bestMatch?.confidence ?? 0.8),
          mergedFieldsJson: { matches: mergeMatches.map((m) => ({ stage: m.stage, method: m.matchMethod })) },
          mergedBy: "scrubber_auto",
        });
      }

      log.info(
        { rawLeadId, canonicalIds, matchCount: mergeMatches.length },
        "Created identity merge records for review",
      );
    } else if (!bestMatch) {
      // ─── NO match: create new canonical lead + identity ────────────
      resolution = "new";
      newLeads = 1;

      const [canonical] = await db
        .insert(canonicalLeads)
        .values({
          tenantId,
          canonicalType: "person",
          normalizedName: normalizedProfileName ?? "unknown",
          normalizedDomain,
          primaryEmail: normalizedEmail,
          primaryPhone: normalizedPhone,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          signalCount: 1,
          sourceCount: 1,
        })
        .returning();

      newCanonicalLeadId = canonical.id;

      // Create lead_identity
      await db.insert(leadIdentities).values({
        canonicalLeadId: canonical.id,
        platform,
        profileUrl: normalizedProfileUrl,
        profileName: normalizedProfileName,
        email: normalizedEmail,
        phone: normalizedPhone,
        identityType: "primary",
        confidence: "1.00",
        source: "scrubber",
      });

      log.info(
        { rawLeadId, canonicalLeadId: canonical.id },
        "Created new canonical lead + identity",
      );

      // Push to canonical_enrichment_queue
      const enrichQueue = getQueue(SWARM_QUEUE_NAMES.CANONICAL_ENRICHMENT);
      const enrichJobData: CanonicalEnrichmentJobData = {
        tenantId,
        canonicalLeadId: canonical.id,
        agentType: "canonical_enricher",
        enrichmentSources: ["location", "industry", "persona", "freshness"],
        payload: {
          rawLeadId,
          normalizedProfileName,
          normalizedDomain,
          normalizedEmail,
          normalizedPhone,
          platform,
          locationText: payload.locationText,
          rawText: payload.rawText,
          matchedKeywords: payload.matchedKeywords,
          contentDate: payload.contentDate,
          contactHint: payload.contactHint,
        },
      };

      await enrichQueue.add("canonical_enrichment", enrichJobData, {
        jobId: `cenrich-${tenantId}-${canonical.id}`,
      });
    } else if (bestMatch.confidence >= 0.95) {
      // ─── EXACT match: suppress duplicate ───────────────────────────
      resolution = "suppressed";
      suppressed = 1;

      // Log suppression
      await db.insert(suppressionLogs).values({
        scrubRunId: scrubRun.id,
        rawLeadId,
        canonicalLeadId: bestMatch.canonicalLeadId,
        matchMethod: bestMatch.matchMethod,
        confidence: String(bestMatch.confidence),
      });

      // Update canonical lead last_seen_at and signal_count
      await db
        .update(canonicalLeads)
        .set({
          lastSeenAt: new Date(),
          signalCount: sql`${canonicalLeads.signalCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(canonicalLeads.id, bestMatch.canonicalLeadId));

      log.info(
        {
          rawLeadId,
          canonicalLeadId: bestMatch.canonicalLeadId,
          matchMethod: bestMatch.matchMethod,
          confidence: bestMatch.confidence,
        },
        "Duplicate suppressed",
      );
    } else {
      // ─── PARTIAL match (0.7-0.94): flag for review ────────────────
      resolution = "pending_review";
      review = 1;

      await db.insert(duplicateCandidates).values({
        scrubRunId: scrubRun.id,
        rawLeadId,
        existingCanonicalId: bestMatch.canonicalLeadId,
        existingIdentityId: bestMatch.identityId ?? null,
        matchMethod: bestMatch.matchMethod,
        confidence: String(bestMatch.confidence),
        evidenceJson: bestMatch.evidence,
        resolution: "pending",
      });

      log.info(
        {
          rawLeadId,
          canonicalLeadId: bestMatch.canonicalLeadId,
          matchMethod: bestMatch.matchMethod,
          confidence: bestMatch.confidence,
        },
        "Created duplicate candidate for review",
      );
    }

    // ─── Record signal in lead_signals table ─────────────────────────────
    // Every raw lead produces a signal — this builds the signals-first data model
    const signalPhrase = detectSignalPhrase(rawText);
    const intentType = detectIntentType(rawText);
    const signalStrength = computeSignalStrength(allMatches, rawText);

    try {
      await db.insert(leadSignals).values({
        tenantId,
        rawLeadId,
        qualifiedLeadId: null,
        signalPhrase: signalPhrase ? signalPhrase.substring(0, 100) : null,
        intentType,
        signalStrength,
        sourceUrl: sourceUrl ?? null,
        sourcePlatform: platform,
        authorName: normalizedProfileName ? normalizedProfileName.toLowerCase().trim() : null,
        authorProfileUrl: normalizedProfileUrl,
        contentSnippet: rawText ? rawText.substring(0, 500) : null,
        contentDate: contentDate ? new Date(contentDate) : null,
      });
    } catch (sigError) {
      log.warn(
        { rawLeadId, error: (sigError as Error).message },
        "Failed to record lead signal (non-fatal)",
      );
    }

    // ─── Stage 8: Source trail preservation ─────────────────────────────
    // Mark raw lead as completed with the canonical lead mapping
    await db
      .update(rawLeads)
      .set({
        isProcessed: true,
        processingStatus: "completed",
      })
      .where(eq(rawLeads.id, rawLeadId));

    // ─── Update scrub_run with counts ──────────────────────────────────
    const durationMs = Date.now() - startMs;
    await db
      .update(scrubRuns)
      .set({
        status: "completed",
        newLeadsCount: newLeads,
        suppressedCount: suppressed,
        reviewCount: review,
        mergedCount: merged,
        completedAt: new Date(),
        durationMs,
      })
      .where(eq(scrubRuns.id, scrubRun.id));

    log.info(
      {
        rawLeadId,
        scrubRunId: scrubRun.id,
        resolution,
        matchCount: allMatches.length,
        bestConfidence: bestMatch?.confidence ?? null,
        durationMs,
      },
      "Scrub/dedupe pipeline complete",
    );

    return {
      status: resolution,
      rawLeadId,
      scrubRunId: scrubRun.id,
      canonicalLeadId: newCanonicalLeadId ?? bestMatch?.canonicalLeadId ?? null,
      matchCount: allMatches.length,
      bestConfidence: bestMatch?.confidence ?? null,
      durationMs,
    };
  } catch (error) {
    // Mark scrub_run as failed
    await db
      .update(scrubRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
        durationMs: Date.now() - startMs,
      })
      .where(eq(scrubRuns.id, scrubRun.id));

    log.error(
      { rawLeadId, scrubRunId: scrubRun.id, error: (error as Error).message },
      "Scrub/dedupe pipeline failed",
    );

    throw error;
  }
}
