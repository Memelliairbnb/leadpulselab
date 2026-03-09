import { Job } from "bullmq";
import { db } from "@alh/db";
import { qualifiedLeads, tenantScoringModels, leadContacts } from "@alh/db";
import { eq, and, ne } from "drizzle-orm";
import { logger } from "@alh/observability";
import { getQueue, QUEUE_NAMES } from "@alh/queues";
import {
  checkDuplicate,
  hashText,
  type DuplicateCandidate,
} from "./similarity.js";
import type { LeadDedupeJobData } from "@alh/queues";

const log = logger.child({ module: "dedupe-processor" });

export async function processLeadDedupe(job: Job<LeadDedupeJobData>) {
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
    // Load tenant scoring model for score threshold
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

    const scoreThreshold = scoringModel?.nurtureThreshold ?? 50;

    // Check score threshold first
    if (lead.leadScore < scoreThreshold) {
      log.info(
        {
          qualifiedLeadId,
          score: lead.leadScore,
          threshold: scoreThreshold,
        },
        "Lead below score threshold, marking as low_score"
      );

      await db
        .update(qualifiedLeads)
        .set({ status: "low_score" })
        .where(eq(qualifiedLeads.id, qualifiedLeadId));

      return { action: "filtered", reason: "below_threshold" };
    }

    // Load contacts for this lead
    const currentContacts = await db
      .select()
      .from(leadContacts)
      .where(eq(leadContacts.leadId, qualifiedLeadId));

    // Load existing leads for the same tenant to check duplicates
    const existingLeads = await db
      .select({
        id: qualifiedLeads.id,
        profileUrl: qualifiedLeads.profileUrl,
        fullName: qualifiedLeads.fullName,
        platform: qualifiedLeads.platform,
        aiSummary: qualifiedLeads.aiSummary,
      })
      .from(qualifiedLeads)
      .where(
        and(
          eq(qualifiedLeads.tenantId, tenantId),
          ne(qualifiedLeads.id, qualifiedLeadId),
          ne(qualifiedLeads.status, "duplicate")
        )
      );

    // Load contacts for all existing leads for comparison
    const existingLeadIds = existingLeads.map((el) => el.id);

    // Build candidate objects for comparison
    const currentCandidate: DuplicateCandidate = {
      id: String(lead.id),
      profileUrl: lead.profileUrl,
      contentHash: lead.aiSummary ? hashText(lead.aiSummary) : null,
      authorName: lead.fullName,
      platformName: lead.platform,
      contactMethods: currentContacts.map((c) => c.contactValue),
    };

    const existingCandidates: DuplicateCandidate[] = existingLeads.map(
      (el) => ({
        id: String(el.id),
        profileUrl: el.profileUrl,
        contentHash: el.aiSummary ? hashText(el.aiSummary) : null,
        authorName: el.fullName,
        platformName: el.platform,
        contactMethods: [], // simplified - full contact loading would be expensive
      })
    );

    const dupeResult = checkDuplicate(currentCandidate, existingCandidates);

    if (dupeResult.isDuplicate) {
      log.info(
        {
          qualifiedLeadId,
          matchedLeadId: dupeResult.matchedLeadId,
          matchType: dupeResult.matchType,
          matchScore: dupeResult.matchScore,
        },
        "Duplicate lead detected"
      );

      await db
        .update(qualifiedLeads)
        .set({
          status: "duplicate",
          isDuplicate: true,
          duplicateOfLeadId: dupeResult.matchedLeadId
            ? parseInt(dupeResult.matchedLeadId, 10)
            : null,
          duplicateConfidence: String(dupeResult.matchScore),
        })
        .where(eq(qualifiedLeads.id, qualifiedLeadId));

      return {
        action: "duplicate",
        matchedLeadId: dupeResult.matchedLeadId,
        matchType: dupeResult.matchType,
      };
    }

    // Not a duplicate - push to enrichment queue
    log.info({ qualifiedLeadId }, "Lead passed dedupe, pushing to enrichment");

    const enrichmentQueue = getQueue(QUEUE_NAMES.LEAD_ENRICHMENT);
    await enrichmentQueue.add(
      "enrich-lead",
      {
        qualifiedLeadId,
        tenantId,
      },
      {
        jobId: `enrich-${qualifiedLeadId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 3000 },
      }
    );

    await db
      .update(qualifiedLeads)
      .set({ status: "dedupe_passed" })
      .where(eq(qualifiedLeads.id, qualifiedLeadId));

    return { action: "passed", qualifiedLeadId };
  } catch (err) {
    const error = err as Error;
    log.error(
      { qualifiedLeadId, error: error.message },
      "Lead dedupe processing failed"
    );
    throw error;
  }
}
