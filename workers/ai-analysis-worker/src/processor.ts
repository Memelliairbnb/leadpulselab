import { Job } from "bullmq";
import { db } from "@alh/db";
import {
  rawLeads,
  qualifiedLeads,
  leadTags,
  tenantLeadTypes,
  tenantScoringSignals,
  tenantAiConfigs,
  tenantScoringModels,
} from "@alh/db/schema";
import { eq, and } from "@alh/db/orm";
import { logger } from "@alh/observability";
import { getQueue, QUEUE_NAMES } from "@alh/queues";
import {
  analyzeRawLead,
  buildClassificationSystemPrompt,
  buildClassificationUserPrompt,
} from "@alh/ai";
import { calculateFinalScore } from "@alh/scoring";
import type { LeadAnalysisJobData } from "@alh/types";

const log = logger.child({ module: "ai-analysis-processor" });

export async function processLeadAnalysis(job: Job<LeadAnalysisJobData>) {
  const { rawLeadId, tenantId } = job.data;

  // Load the raw lead
  const [rawLead] = await db
    .select()
    .from(rawLeads)
    .where(and(eq(rawLeads.id, rawLeadId), eq(rawLeads.tenantId, tenantId)))
    .limit(1);

  if (!rawLead) {
    throw new Error(`Raw lead not found: ${rawLeadId}`);
  }

  // Update raw lead status to processing
  await db
    .update(rawLeads)
    .set({ status: "processing" })
    .where(eq(rawLeads.id, rawLeadId));

  try {
    // Load tenant AI context
    const [leadTypes, scoringSignals, aiConfigRows, scoringModelRows] =
      await Promise.all([
        db
          .select()
          .from(tenantLeadTypes)
          .where(eq(tenantLeadTypes.tenantId, tenantId)),
        db
          .select()
          .from(tenantScoringSignals)
          .where(eq(tenantScoringSignals.tenantId, tenantId)),
        db
          .select()
          .from(tenantAiConfigs)
          .where(eq(tenantAiConfigs.tenantId, tenantId))
          .limit(1),
        db
          .select()
          .from(tenantScoringModels)
          .where(eq(tenantScoringModels.tenantId, tenantId))
          .limit(1),
      ]);

    const aiConfig = aiConfigRows[0] ?? null;
    const scoringModel = scoringModelRows[0] ?? null;

    if (!aiConfig) {
      throw new Error(`No AI config found for tenant: ${tenantId}`);
    }

    // Build dynamic prompts using tenant context
    const systemPrompt = buildClassificationSystemPrompt({
      leadTypes,
      scoringSignals,
      tenantContext: aiConfig.classificationContext ?? undefined,
    });

    const userPrompt = buildClassificationUserPrompt({
      authorName: rawLead.authorName,
      authorHandle: rawLead.authorHandle,
      contentText: rawLead.contentText,
      profileUrl: rawLead.profileUrl,
      platformName: rawLead.platformName,
      postedAt: rawLead.postedAt?.toISOString() ?? null,
      rawData: rawLead.rawData,
    });

    log.info({ rawLeadId, tenantId }, "Calling AI analysis");

    // Call Claude for classification
    const analysisResult = await analyzeRawLead({
      systemPrompt,
      userPrompt,
      model: aiConfig.model ?? "claude-sonnet-4-20250514",
      maxTokens: aiConfig.maxTokens ?? 1024,
      apiKey: aiConfig.apiKey,
    });

    // Calculate final score using tenant scoring model
    const finalScore = calculateFinalScore({
      aiSignals: analysisResult.signals,
      scoringModel: scoringModel?.weights ?? {},
      scoringSignals,
    });

    log.info(
      {
        rawLeadId,
        leadType: analysisResult.leadType,
        finalScore,
        confidence: analysisResult.confidence,
      },
      "AI analysis complete"
    );

    // Create qualified lead record
    const [qualifiedLead] = await db
      .insert(qualifiedLeads)
      .values({
        tenantId,
        rawLeadId,
        platformSourceId: rawLead.platformSourceId,
        platformName: rawLead.platformName,
        leadType: analysisResult.leadType,
        score: finalScore,
        confidence: analysisResult.confidence,
        aiSummary: analysisResult.summary,
        aiReasoning: analysisResult.reasoning,
        signals: analysisResult.signals,
        authorName: rawLead.authorName,
        authorHandle: rawLead.authorHandle,
        profileUrl: rawLead.profileUrl,
        contentSnippet: rawLead.contentText?.slice(0, 500) ?? null,
        contactMethods: analysisResult.contactMethods ?? [],
        location: analysisResult.location ?? null,
        status: "new",
        classifiedAt: new Date(),
      })
      .returning();

    // Save tags
    if (analysisResult.tags && analysisResult.tags.length > 0) {
      await db.insert(leadTags).values(
        analysisResult.tags.map((tag: string) => ({
          qualifiedLeadId: qualifiedLead.id,
          tenantId,
          tag,
        }))
      );
    }

    // Update raw lead status to analyzed
    await db
      .update(rawLeads)
      .set({ status: "analyzed", qualifiedLeadId: qualifiedLead.id })
      .where(eq(rawLeads.id, rawLeadId));

    // Push to dedupe queue
    const dedupeQueue = getQueue(QUEUE_NAMES.LEAD_DEDUPE);
    await dedupeQueue.add(
      "dedupe-lead",
      {
        qualifiedLeadId: qualifiedLead.id,
        tenantId,
      },
      {
        jobId: `dedupe-${qualifiedLead.id}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 3000 },
      }
    );

    return {
      qualifiedLeadId: qualifiedLead.id,
      leadType: analysisResult.leadType,
      score: finalScore,
    };
  } catch (err) {
    const error = err as Error;
    log.error({ rawLeadId, error: error.message }, "Lead analysis failed");

    await db
      .update(rawLeads)
      .set({ status: "failed", errorMessage: error.message })
      .where(eq(rawLeads.id, rawLeadId));

    throw error;
  }
}
