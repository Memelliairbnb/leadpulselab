import type { Job } from "bullmq";
import { db } from "@alh/db";
import { rawLeads } from "@alh/db";
import { getQueue, SWARM_QUEUE_NAMES } from "@alh/queues";
import type { NormalizationJobData, ScrubDedupeJobData } from "@alh/queues";
import { hashText, normalizeText, normalizeName } from "@alh/utils";
import { logger } from "@alh/observability";
import { eq } from "drizzle-orm";

const log = logger.child({ processor: "normalizer" });

// ─── Tracking param patterns to strip from URLs ─────────────────────────────
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid",
  "ref", "ref_src", "ref_url", "source", "trk", "trkCampaign",
]);

/**
 * Normalize a URL: lowercase, strip www., remove tracking params, remove trailing slash.
 */
function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim().toLowerCase());
    url.hostname = url.hostname.replace(/^www\./, "");

    // Strip tracking params
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    // Sort remaining params for consistency
    url.searchParams.sort();

    let result = url.toString();
    // Remove trailing slash
    if (result.endsWith("/")) {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    // If URL parsing fails, do basic normalization
    return rawUrl.trim().toLowerCase().replace(/^www\./, "");
  }
}

/**
 * Normalize an email: lowercase, trim.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalize a phone number: strip non-digits, handle +1 prefix.
 */
function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  // Strip leading country code 1 if 11 digits
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

/**
 * Extract domain from a URL or email.
 */
function extractDomain(url?: string | null, email?: string | null): string | null {
  if (url) {
    try {
      const parsed = new URL(url.trim().toLowerCase());
      return parsed.hostname.replace(/^www\./, "");
    } catch {
      // fall through
    }
  }
  if (email) {
    const parts = email.trim().toLowerCase().split("@");
    if (parts.length === 2) {
      return parts[1];
    }
  }
  return null;
}

/**
 * Normalization processor — takes a raw lead, normalizes all fields,
 * hashes the normalized text, and pushes to scrub_dedupe_queue.
 */
export async function processNormalization(job: Job<NormalizationJobData>) {
  const { tenantId, rawLeadId } = job.data;
  const startMs = Date.now();

  log.info({ rawLeadId, tenantId }, "Starting normalization");

  // 1. Fetch the raw lead
  const [rawLead] = await db
    .select()
    .from(rawLeads)
    .where(eq(rawLeads.id, rawLeadId))
    .limit(1);

  if (!rawLead) {
    log.warn({ rawLeadId }, "Raw lead not found, skipping normalization");
    return { status: "skipped", reason: "raw_lead_not_found" };
  }

  // 2. Normalize fields
  const normalizedProfileName = rawLead.profileName
    ? normalizeName(rawLead.profileName)
    : null;

  const normalizedProfileUrl = rawLead.profileUrl
    ? normalizeUrl(rawLead.profileUrl)
    : null;

  const normalizedSourceUrl = normalizeUrl(rawLead.sourceUrl);

  const metadata = (rawLead.rawMetadataJson ?? {}) as Record<string, unknown>;
  const rawEmail = (metadata.email as string) ?? null;
  const rawPhone = (metadata.phone as string) ?? null;

  const normalizedEmail = rawEmail ? normalizeEmail(rawEmail) : null;
  const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null;

  const normalizedDomain = extractDomain(
    rawLead.profileUrl ?? rawLead.sourceUrl,
    rawEmail,
  );

  // 3. Hash normalized text for dedupe
  const textForHash = normalizeText(rawLead.rawText);
  const textHash = hashText(rawLead.rawText);

  // 4. Update the raw lead with processed status
  await db
    .update(rawLeads)
    .set({
      processingStatus: "normalized",
      textHash,
    })
    .where(eq(rawLeads.id, rawLeadId));

  log.info(
    {
      rawLeadId,
      normalizedProfileName,
      normalizedDomain,
      hasEmail: !!normalizedEmail,
      hasPhone: !!normalizedPhone,
      durationMs: Date.now() - startMs,
    },
    "Normalization complete, pushing to scrub_dedupe_queue",
  );

  // 5. Push to scrub_dedupe_queue
  const scrubQueue = getQueue(SWARM_QUEUE_NAMES.SCRUB_DEDUPE);
  const scrubJobData: ScrubDedupeJobData = {
    tenantId,
    leadId: rawLeadId,
    agentType: "scrub_deduper",
    dedupeStrategy: "composite",
    payload: {
      rawLeadId,
      normalizedProfileName,
      normalizedProfileUrl,
      normalizedSourceUrl,
      normalizedEmail,
      normalizedPhone,
      normalizedDomain,
      textHash,
      textForHash,
      platform: rawLead.platform,
      locationText: rawLead.locationText,
      rawText: rawLead.rawText,
      matchedKeywords: rawLead.matchedKeywords,
      contentDate: rawLead.contentDate,
      contactHint: rawLead.contactHint,
    },
  };

  await scrubQueue.add("scrub_dedupe", scrubJobData, {
    jobId: `scrub-${tenantId}-${rawLeadId}-composite`,
  });

  return {
    status: "normalized",
    rawLeadId,
    normalizedProfileName,
    normalizedDomain,
    textHash,
  };
}
