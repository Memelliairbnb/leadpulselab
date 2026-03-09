import { Job } from "bullmq";
import { db } from "@alh/db";
import { qualifiedLeads, tenantSettings } from "@alh/db/schema";
import { eq, and } from "@alh/db/orm";
import { logger } from "@alh/observability";
import { getQueue, QUEUE_NAMES } from "@alh/queues";
import type { LeadEnrichmentJobData } from "@alh/types";

const log = logger.child({ module: "enrichment-processor" });

interface ContactMethod {
  type: string;
  value: string;
  raw?: string;
}

/**
 * Normalize a location string: trim, title-case, remove extra punctuation.
 */
function normalizeLocation(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Basic title-case normalization
  return trimmed
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(", ")
    .replace(/,\s*$/, "");
}

/**
 * Categorize a contact value into a type.
 */
function categorizeContact(value: string): ContactMethod {
  const trimmed = value.trim();

  // Email pattern
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { type: "email", value: trimmed.toLowerCase(), raw: value };
  }

  // Phone pattern (various formats)
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
    // Likely a phone number
    return { type: "phone", value: digitsOnly, raw: value };
  }

  // URL patterns
  if (/^https?:\/\//i.test(trimmed)) {
    if (/linkedin\.com/i.test(trimmed)) {
      return { type: "linkedin", value: trimmed, raw: value };
    }
    if (/twitter\.com|x\.com/i.test(trimmed)) {
      return { type: "twitter", value: trimmed, raw: value };
    }
    if (/facebook\.com|fb\.com/i.test(trimmed)) {
      return { type: "facebook", value: trimmed, raw: value };
    }
    if (/instagram\.com/i.test(trimmed)) {
      return { type: "instagram", value: trimmed, raw: value };
    }
    return { type: "website", value: trimmed, raw: value };
  }

  // Handle patterns (e.g., @username)
  if (/^@[\w.]+$/.test(trimmed)) {
    return { type: "handle", value: trimmed, raw: value };
  }

  return { type: "other", value: trimmed, raw: value };
}

export async function processLeadEnrichment(
  job: Job<LeadEnrichmentJobData>
) {
  const { qualifiedLeadId, tenantId } = job.data;

  // Load the qualified lead
  const [lead] = await db
    .select()
    .from(qualifiedLeads)
    .where(
      and(
        eq(qualifiedLeads.id, qualifiedLeadId),
        eq(qualifiedLeads.tenantId, tenantId)
      )
    )
    .limit(1);

  if (!lead) {
    throw new Error(`Qualified lead not found: ${qualifiedLeadId}`);
  }

  try {
    // Normalize location
    const normalizedLocation = normalizeLocation(lead.location);

    // Categorize contact methods
    const rawContacts = (lead.contactMethods as string[]) ?? [];
    const categorizedContacts: ContactMethod[] = rawContacts.map(
      categorizeContact
    );

    // Extract primary email and phone if available
    const primaryEmail =
      categorizedContacts.find((c) => c.type === "email")?.value ?? null;
    const primaryPhone =
      categorizedContacts.find((c) => c.type === "phone")?.value ?? null;

    // Update the lead with enriched data
    await db
      .update(qualifiedLeads)
      .set({
        location: normalizedLocation,
        contactMethodsEnriched: categorizedContacts,
        primaryEmail,
        primaryPhone,
        status: "enriched",
        enrichedAt: new Date(),
      })
      .where(eq(qualifiedLeads.id, qualifiedLeadId));

    log.info(
      {
        qualifiedLeadId,
        normalizedLocation,
        contactCount: categorizedContacts.length,
        hasEmail: !!primaryEmail,
        hasPhone: !!primaryPhone,
      },
      "Lead enrichment complete"
    );

    // Load tenant settings for score threshold
    const [settings] = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);

    const outreachScoreThreshold = settings?.outreachMinScore ?? 70;

    // If lead qualifies, push to outreach generation queue
    if (lead.score >= outreachScoreThreshold) {
      const outreachQueue = getQueue(QUEUE_NAMES.OUTREACH_GENERATION);
      await outreachQueue.add(
        "generate-outreach",
        {
          qualifiedLeadId,
          tenantId,
        },
        {
          jobId: `outreach-${qualifiedLeadId}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );

      log.info(
        { qualifiedLeadId, score: lead.score },
        "Lead qualifies for outreach, pushed to outreach queue"
      );

      return { action: "outreach_queued", qualifiedLeadId };
    }

    log.info(
      {
        qualifiedLeadId,
        score: lead.score,
        threshold: outreachScoreThreshold,
      },
      "Lead enriched but below outreach threshold"
    );

    return { action: "enriched_only", qualifiedLeadId };
  } catch (err) {
    const error = err as Error;
    log.error(
      { qualifiedLeadId, error: error.message },
      "Lead enrichment failed"
    );
    throw error;
  }
}
