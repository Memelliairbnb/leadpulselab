import type { Job } from "bullmq";
import { db } from "@alh/db";
import { canonicalLeads, leadInventoryItems } from "@alh/db";
import { getQueue, SWARM_QUEUE_NAMES } from "@alh/queues";
import type { CanonicalEnrichmentJobData, PrioritizationJobData } from "@alh/queues";
import { normalizeLocation } from "@alh/utils";
import { logger } from "@alh/observability";
import { eq } from "drizzle-orm";

const log = logger.child({ processor: "enricher" });

// ─── Industry inference keywords ─────────────────────────────────────────────
const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  saas: ["saas", "software", "platform", "app", "tool", "api", "cloud"],
  ecommerce: ["ecommerce", "shopify", "store", "retail", "product", "selling"],
  marketing: ["marketing", "seo", "ads", "agency", "growth", "funnel", "leads"],
  finance: ["finance", "fintech", "banking", "investment", "crypto", "defi", "trading"],
  healthcare: ["health", "medical", "wellness", "therapy", "clinic", "patient"],
  real_estate: ["real estate", "realtor", "property", "housing", "mortgage", "realty"],
  education: ["education", "course", "coaching", "training", "learning", "teach"],
  consulting: ["consulting", "consultant", "advisory", "strategy", "freelance"],
  construction: ["construction", "contractor", "building", "renovation", "plumbing", "hvac"],
  legal: ["legal", "attorney", "lawyer", "law firm", "litigation"],
  insurance: ["insurance", "broker", "coverage", "claims"],
  food_beverage: ["restaurant", "food", "catering", "chef", "bar", "cafe"],
};

// ─── Persona inference keywords ──────────────────────────────────────────────
const PERSONA_KEYWORDS: Record<string, string[]> = {
  founder: ["founder", "cofounder", "co-founder", "started", "built", "launching"],
  executive: ["ceo", "cto", "cfo", "coo", "vp", "director", "chief", "president"],
  marketer: ["marketer", "marketing", "growth", "seo", "ads", "content"],
  sales: ["sales", "revenue", "pipeline", "closing", "deal", "account exec"],
  developer: ["developer", "engineer", "coding", "programming", "dev", "full stack"],
  freelancer: ["freelancer", "freelance", "independent", "contractor", "solopreneur"],
  agency_owner: ["agency", "agency owner", "we help", "our clients", "done for you"],
  coach: ["coach", "coaching", "mentor", "helping", "transformation"],
  investor: ["investor", "investing", "portfolio", "angel", "vc", "capital"],
  small_business_owner: ["small business", "local business", "owner", "shop", "store owner"],
};

/**
 * Infer industry from text content and signals.
 */
function inferIndustry(rawText: string, matchedKeywords: unknown[]): string | null {
  const lowerText = rawText.toLowerCase();
  const allText = lowerText + " " + (matchedKeywords ?? []).join(" ").toLowerCase();

  let bestIndustry: string | null = null;
  let bestScore = 0;

  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (allText.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndustry = industry;
    }
  }

  return bestScore >= 1 ? bestIndustry : null;
}

/**
 * Infer persona type from text content.
 */
function inferPersona(rawText: string): string | null {
  const lowerText = rawText.toLowerCase();

  let bestPersona: string | null = null;
  let bestScore = 0;

  for (const [persona, keywords] of Object.entries(PERSONA_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lowerText.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPersona = persona;
    }
  }

  return bestScore >= 1 ? bestPersona : null;
}

/**
 * Calculate initial freshness score (0-100).
 * Factors: content recency, signal count, source diversity.
 */
function calculateFreshnessScore(contentDate: string | null, signalCount: number): number {
  let score = 50; // base score

  if (contentDate) {
    const daysSince = Math.floor(
      (Date.now() - new Date(contentDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSince <= 1) score += 40;
    else if (daysSince <= 7) score += 30;
    else if (daysSince <= 30) score += 20;
    else if (daysSince <= 90) score += 10;
    else score -= 10;
  }

  // Signal count bonus
  score += Math.min(signalCount * 2, 10);

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate age band based on first seen date.
 */
function calculateAgeBand(firstSeenAt: Date): string {
  const daysSince = Math.floor(
    (Date.now() - firstSeenAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysSince <= 1) return "today";
  if (daysSince <= 7) return "this_week";
  if (daysSince <= 30) return "this_month";
  if (daysSince <= 90) return "this_quarter";
  return "older";
}

/**
 * Canonical enrichment processor — enriches a new canonical lead
 * with location, industry, persona, and freshness scoring.
 */
export async function processCanonicalEnrichment(job: Job<CanonicalEnrichmentJobData>) {
  const { tenantId, canonicalLeadId } = job.data;
  const payload = job.data.payload as Record<string, unknown>;
  const startMs = Date.now();

  log.info({ canonicalLeadId, tenantId }, "Starting canonical enrichment");

  // 1. Fetch the canonical lead
  const [canonical] = await db
    .select()
    .from(canonicalLeads)
    .where(eq(canonicalLeads.id, canonicalLeadId))
    .limit(1);

  if (!canonical) {
    log.warn({ canonicalLeadId }, "Canonical lead not found, skipping enrichment");
    return { status: "skipped", reason: "canonical_lead_not_found" };
  }

  const rawText = (payload.rawText as string) ?? "";
  const locationText = (payload.locationText as string) ?? null;
  const matchedKeywords = (payload.matchedKeywords as unknown[]) ?? [];
  const contentDate = (payload.contentDate as string) ?? null;

  // 2. Normalize location
  const location = normalizeLocation(locationText);
  log.debug({ canonicalLeadId, location }, "Location normalized");

  // 3. Infer industry
  const industry = inferIndustry(rawText, matchedKeywords);
  log.debug({ canonicalLeadId, industry }, "Industry inferred");

  // 4. Infer persona type
  const persona = inferPersona(rawText);
  log.debug({ canonicalLeadId, persona }, "Persona inferred");

  // 5. Calculate freshness score
  const freshnessScore = calculateFreshnessScore(contentDate, canonical.signalCount);
  log.debug({ canonicalLeadId, freshnessScore }, "Freshness score calculated");

  // 6. Update canonical lead record
  await db
    .update(canonicalLeads)
    .set({
      city: location.city,
      state: location.state,
      country: location.country,
      industryInference: industry,
      personaInference: persona,
      freshnessScore,
      lastEnrichedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(canonicalLeads.id, canonicalLeadId));

  log.info(
    { canonicalLeadId, city: location.city, state: location.state, industry, persona, freshnessScore },
    "Canonical lead enriched",
  );

  // 7. Create lead_inventory_item
  const ageBand = calculateAgeBand(canonical.firstSeenAt);

  const [inventoryItem] = await db
    .insert(leadInventoryItems)
    .values({
      canonicalLeadId,
      tenantId,
      inventoryStatus: "available",
      temperature: freshnessScore >= 70 ? "hot" : freshnessScore >= 40 ? "warm" : "cold",
      valueScore: freshnessScore,
      ageBand,
      industry,
      geoRegion: location.state ? `${location.city ?? "unknown"}, ${location.state}` : location.city,
      persona,
    })
    .onConflictDoUpdate({
      target: leadInventoryItems.canonicalLeadId,
      set: {
        temperature: freshnessScore >= 70 ? "hot" : freshnessScore >= 40 ? "warm" : "cold",
        valueScore: freshnessScore,
        ageBand,
        industry,
        geoRegion: location.state ? `${location.city ?? "unknown"}, ${location.state}` : location.city,
        persona,
        updatedAt: new Date(),
      },
    })
    .returning();

  log.info(
    { canonicalLeadId, inventoryItemId: inventoryItem.id, ageBand, temperature: inventoryItem.temperature },
    "Lead inventory item created/updated",
  );

  // 8. Push to prioritization_queue
  const prioQueue = getQueue(SWARM_QUEUE_NAMES.PRIORITIZATION);
  const prioJobData: PrioritizationJobData = {
    tenantId,
    canonicalLeadId,
    agentType: "prioritizer",
    payload: {
      freshnessScore,
      industry,
      persona,
      ageBand,
      city: location.city,
      state: location.state,
      inventoryItemId: inventoryItem.id,
    },
  };

  await prioQueue.add("prioritization", prioJobData, {
    jobId: `prio-${tenantId}-${canonicalLeadId}`,
  });

  const durationMs = Date.now() - startMs;
  log.info(
    { canonicalLeadId, inventoryItemId: inventoryItem.id, durationMs },
    "Canonical enrichment complete, pushed to prioritization_queue",
  );

  return {
    status: "enriched",
    canonicalLeadId,
    inventoryItemId: inventoryItem.id,
    industry,
    persona,
    freshnessScore,
    ageBand,
    durationMs,
  };
}
