import { Job } from "bullmq";
import { db } from "@alh/db";
import {
  qualifiedLeads,
  tenantScoringModels,
  leadContacts,
} from "@alh/db";
import { eq, and } from "drizzle-orm";
import { logger } from "@alh/observability";
import { getQueue, QUEUE_NAMES } from "@alh/queues";
import type { LeadEnrichmentJobData } from "@alh/queues";

const log = logger.child({ module: "enrichment-processor" });

interface CategorizedContact {
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
function categorizeContact(value: string): CategorizedContact {
  const trimmed = value.trim();

  // Email pattern
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { type: "email", value: trimmed.toLowerCase(), raw: value };
  }

  // Phone pattern (various formats)
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
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
    // Normalize location from city/state
    const locationParts = [lead.city, lead.state, lead.country].filter(
      Boolean
    );
    const normalizedLocation = normalizeLocation(locationParts.join(", "));

    // Parse location back into components if we normalized it
    if (normalizedLocation) {
      const parts = normalizedLocation.split(", ");
      await db
        .update(qualifiedLeads)
        .set({
          city: parts[0] ?? lead.city,
          state: parts[1] ?? lead.state,
          country: parts[2] ?? lead.country,
        })
        .where(eq(qualifiedLeads.id, qualifiedLeadId));
    }

    // Load existing contacts for this lead
    const existingContacts = await db
      .select()
      .from(leadContacts)
      .where(eq(leadContacts.leadId, qualifiedLeadId));

    // Categorize existing contact methods
    const categorizedContacts: CategorizedContact[] = existingContacts.map(
      (c) => categorizeContact(c.contactValue)
    );

    // If contactMethod on the lead has a value, categorize and save it too
    if (lead.contactMethod && !existingContacts.length) {
      const categorized = categorizeContact(lead.contactMethod);
      await db.insert(leadContacts).values({
        leadId: qualifiedLeadId,
        contactType: categorized.type,
        contactValue: categorized.value,
        isPrimary: true,
        source: "extracted",
      });
      categorizedContacts.push(categorized);
    }

    // Determine primary contact type
    const primaryEmail = categorizedContacts.find(
      (c) => c.type === "email"
    );
    const primaryPhone = categorizedContacts.find(
      (c) => c.type === "phone"
    );

    // Update contact type on the lead
    const contactType = primaryEmail
      ? "email"
      : primaryPhone
        ? "phone"
        : categorizedContacts[0]?.type ?? null;

    await db
      .update(qualifiedLeads)
      .set({
        contactType,
        status: "enriched",
        updatedAt: new Date(),
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

    // Load tenant scoring model for outreach threshold
    const [scoringModel] = await db
      .select()
      .from(tenantScoringModels)
      .where(
        and(
          eq(tenantScoringModels.tenantId, tenantId),
          eq(tenantScoringModels.isActive, true)
        )
      )
      .limit(1);

    const outreachScoreThreshold = scoringModel?.strongThreshold ?? 70;

    // If lead qualifies, push to outreach generation queue
    if (lead.leadScore >= outreachScoreThreshold) {
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
        { qualifiedLeadId, score: lead.leadScore },
        "Lead qualifies for outreach, pushed to outreach queue"
      );

      return { action: "outreach_queued", qualifiedLeadId };
    }

    log.info(
      {
        qualifiedLeadId,
        score: lead.leadScore,
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
