import { Job } from "bullmq";
import { db } from "@alh/db";
import { qualifiedLeads, tenantSettings } from "@alh/db/schema";
import { eq, and, ne } from "@alh/db/orm";
import { logger } from "@alh/observability";
import { getQueue, QUEUE_NAMES } from "@alh/queues";
import {
  checkDuplicate,
  hashText,
  type DuplicateCandidate,
} from "./similarity.js";
import type { LeadDedupeJobData } from "@alh/types";

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
    // Load tenant settings for score threshold
    const [settings] = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);

    const scoreThreshold = settings?.minLeadScore ?? 50;

    // Check score threshold first
    if (lead.score < scoreThreshold) {
      log.info(
        {
          qualifiedLeadId,
          score: lead.score,
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

    // Load existing leads for the same tenant to check duplicates
    const existingLeads = await db
      .select({
        id: qualifiedLeads.id,
        profileUrl: qualifiedLeads.profileUrl,
        contentSnippet: qualifiedLeads.contentSnippet,
        authorName: qualifiedLeads.authorName,
        platformName: qualifiedLeads.platformName,
        contactMethods: qualifiedLeads.contactMethods,
      })
      .from(qualifiedLeads)
      .where(
        and(
          eq(qualifiedLeads.tenantId, tenantId),
          ne(qualifiedLeads.id, qualifiedLeadId),
          ne(qualifiedLeads.status, "duplicate")
        )
      );

    // Build candidate objects for comparison
    const currentCandidate: DuplicateCandidate = {
      id: lead.id,
      profileUrl: lead.profileUrl,
      contentHash: lead.contentSnippet ? hashText(lead.contentSnippet) : null,
      authorName: lead.authorName,
      platformName: lead.platformName,
      contactMethods: (lead.contactMethods as string[]) ?? [],
    };

    const existingCandidates: DuplicateCandidate[] = existingLeads.map(
      (el) => ({
        id: el.id,
        profileUrl: el.profileUrl,
        contentHash: el.contentSnippet ? hashText(el.contentSnippet) : null,
        authorName: el.authorName,
        platformName: el.platformName,
        contactMethods: (el.contactMethods as string[]) ?? [],
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
          duplicateOfId: dupeResult.matchedLeadId,
          dedupeMatchType: dupeResult.matchType,
          dedupeMatchScore: dupeResult.matchScore,
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
