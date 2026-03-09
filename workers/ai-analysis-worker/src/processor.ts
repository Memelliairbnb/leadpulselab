import { Job } from "bullmq";
import { db } from "@alh/db";
import {
  rawLeads,
  qualifiedLeads,
  leadTags,
  tenantLeadTypes,
  tenantScoringSignals,
  tenantAiConfig,
  tenantScoringModels,
} from "@alh/db";
import { eq, and } from "drizzle-orm";
import { logger } from "@alh/observability";
import { getQueue, QUEUE_NAMES } from "@alh/queues";
import type { LeadAnalysisJobData } from "@alh/queues";
import {
  analyzeRawLead,
  buildClassificationSystemPrompt,
  buildClassificationUserPrompt,
} from "@alh/ai";
import { calculateFinalScore } from "@alh/scoring";

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
    .set({ processingStatus: "processing" })
    .where(eq(rawLeads.id, rawLeadId));

  try {
    // Load tenant AI context
    const [aiConfigRow] = await db
      .select()
      .from(tenantAiConfig)
      .where(eq(tenantAiConfig.tenantId, tenantId))
      .limit(1);

    if (!aiConfigRow) {
      throw new Error(`No AI config found for tenant: ${tenantId}`);
    }

    // Load scoring model and its signals
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

    const leadTypes = await db
      .select()
      .from(tenantLeadTypes)
      .where(eq(tenantLeadTypes.tenantId, tenantId));

    const scoringSignals = scoringModel
      ? await db
          .select()
          .from(tenantScoringSignals)
          .where(eq(tenantScoringSignals.scoringModelId, scoringModel.id))
      : [];

    // Build tenant AI context
    const tenantAIContext = {
      tenantId,
      industryContext: aiConfigRow.industryContext,
      leadTypes: leadTypes.map((lt) => ({
        name: lt.name,
        displayName: lt.displayName,
        description: lt.description ?? "",
      })),
      scoringSignals: scoringSignals.map((s) => ({
        signalKey: s.signalKey,
        signalPattern: s.signalPattern,
        weight: s.weight,
      })),
      classificationInstructions:
        aiConfigRow.classificationInstructions ?? null,
      exampleSignals: (aiConfigRow.exampleSignalsJson as string[]) ?? [],
      irrelevantSignals:
        (aiConfigRow.irrelevantSignalsJson as string[]) ?? [],
    };

    // Build dynamic prompts using tenant context
    const systemPrompt = buildClassificationSystemPrompt(tenantAIContext);

    const userPrompt = buildClassificationUserPrompt(tenantAIContext, {
      platform: rawLead.platform,
      sourceUrl: rawLead.sourceUrl,
      profileName: rawLead.profileName,
      locationText: rawLead.locationText,
      contentDate: rawLead.contentDate,
      matchedKeywords: (rawLead.matchedKeywords as string[]) ?? [],
      rawText: rawLead.rawText,
    });

    log.info({ rawLeadId, tenantId }, "Calling AI analysis");

    // Call Claude for classification
    const analysisResult = await analyzeRawLead(systemPrompt, userPrompt);

    // Calculate final score using tenant scoring model
    const scoreResult = calculateFinalScore(
      {
        claudeScore: analysisResult.lead_score,
        rawText: rawLead.rawText,
        contentDate: rawLead.contentDate,
        matchedKeywords: (rawLead.matchedKeywords as string[]) ?? [],
        isExistingDuplicate: false,
      },
      {
        claudeWeight: scoringModel
          ? parseFloat(String(scoringModel.claudeWeight))
          : 0.6,
        rulesWeight: scoringModel
          ? parseFloat(String(scoringModel.rulesWeight))
          : 0.4,
        hotThreshold: scoringModel?.hotThreshold ?? 85,
        strongThreshold: scoringModel?.strongThreshold ?? 70,
        nurtureThreshold: scoringModel?.nurtureThreshold ?? 50,
        signals: scoringSignals.map((s) => ({
          id: s.id,
          scoringModelId: s.scoringModelId,
          signalKey: s.signalKey,
          signalPattern: s.signalPattern,
          weight: s.weight,
          description: s.description ?? null,
          isActive: s.isActive,
        })),
      }
    );

    log.info(
      {
        rawLeadId,
        leadType: analysisResult.lead_type,
        finalScore: scoreResult.finalScore,
        confidence: analysisResult.confidence,
        intentType: analysisResult.intent_type,
        isRealPerson: analysisResult.is_real_person,
        estimatedUrgency: analysisResult.estimated_urgency,
      },
      "AI analysis complete"
    );

    // Find matching lead type ID
    const matchedLeadType = leadTypes.find(
      (lt) => lt.name === analysisResult.lead_type
    );

    // Build enriched AI signals JSON with intent data
    const aiSignals = {
      signals: analysisResult.signals,
      intent_type: analysisResult.intent_type ?? 'unknown',
      signal_phrases_found: analysisResult.signal_phrases_found ?? [],
      is_real_person: analysisResult.is_real_person ?? true,
      person_or_business_name: analysisResult.person_or_business_name ?? null,
      estimated_urgency: analysisResult.estimated_urgency ?? 'exploring',
    };

    // Use person/business name from AI if available, fall back to profile name
    const resolvedName =
      analysisResult.person_or_business_name ?? rawLead.profileName ?? null;

    // Create qualified lead record
    const [qualifiedLead] = await db
      .insert(qualifiedLeads)
      .values({
        tenantId,
        rawLeadId,
        fullName: resolvedName,
        leadType: analysisResult.lead_type,
        leadTypeId: matchedLeadType?.id ?? null,
        intentLevel: scoreResult.intentLevel,
        leadScore: scoreResult.finalScore,
        aiConfidence: String(analysisResult.confidence),
        aiSummary: analysisResult.summary,
        aiSignalsJson: aiSignals,
        aiRecommendedAction: analysisResult.recommended_next_action,
        platform: rawLead.platform,
        profileUrl: rawLead.profileUrl,
        contactMethod: rawLead.contactHint ?? null,
        city: null,
        state: null,
        status: "new",
      })
      .returning();

    // Save tags
    if (
      analysisResult.secondary_tags &&
      analysisResult.secondary_tags.length > 0
    ) {
      await db.insert(leadTags).values(
        analysisResult.secondary_tags.map((tag: string) => ({
          tenantId,
          name: tag,
          category: "ai" as const,
        }))
      );
    }

    // Update raw lead status to analyzed
    await db
      .update(rawLeads)
      .set({ processingStatus: "analyzed", isProcessed: true })
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
      leadType: analysisResult.lead_type,
      score: scoreResult.finalScore,
    };
  } catch (err) {
    const error = err as Error;
    log.error({ rawLeadId, error: error.message }, "Lead analysis failed");

    await db
      .update(rawLeads)
      .set({ processingStatus: "failed" })
      .where(eq(rawLeads.id, rawLeadId));

    throw error;
  }
}
