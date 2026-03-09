import { Job } from "bullmq";
import { db } from "@alh/db";
import {
  qualifiedLeads,
  outreachDrafts,
  optOuts,
  tenantAiConfigs,
  tenantOutreachTemplates,
} from "@alh/db/schema";
import { eq, and, or } from "@alh/db/orm";
import { logger } from "@alh/observability";
import {
  generateOutreachDraft,
  buildOutreachSystemPrompt,
  buildOutreachUserPrompt,
} from "@alh/ai";
import type { OutreachGenerationJobData } from "@alh/types";

const log = logger.child({ module: "outreach-processor" });

export async function processOutreachGeneration(
  job: Job<OutreachGenerationJobData>
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
    // Check opt-outs by email, phone, or profile URL
    const optOutConditions = [];

    if (lead.primaryEmail) {
      optOutConditions.push(
        and(
          eq(optOuts.tenantId, tenantId),
          eq(optOuts.contactValue, lead.primaryEmail)
        )
      );
    }
    if (lead.primaryPhone) {
      optOutConditions.push(
        and(
          eq(optOuts.tenantId, tenantId),
          eq(optOuts.contactValue, lead.primaryPhone)
        )
      );
    }
    if (lead.profileUrl) {
      optOutConditions.push(
        and(
          eq(optOuts.tenantId, tenantId),
          eq(optOuts.contactValue, lead.profileUrl)
        )
      );
    }

    if (optOutConditions.length > 0) {
      const optOutRecords = await db
        .select()
        .from(optOuts)
        .where(or(...optOutConditions))
        .limit(1);

      if (optOutRecords.length > 0) {
        log.info(
          { qualifiedLeadId, optOutId: optOutRecords[0].id },
          "Lead has opted out, skipping outreach"
        );

        await db
          .update(qualifiedLeads)
          .set({ status: "opted_out" })
          .where(eq(qualifiedLeads.id, qualifiedLeadId));

        return { action: "opted_out", qualifiedLeadId };
      }
    }

    // Load tenant AI config and outreach templates
    const [aiConfigRows, templates] = await Promise.all([
      db
        .select()
        .from(tenantAiConfigs)
        .where(eq(tenantAiConfigs.tenantId, tenantId))
        .limit(1),
      db
        .select()
        .from(tenantOutreachTemplates)
        .where(
          and(
            eq(tenantOutreachTemplates.tenantId, tenantId),
            eq(tenantOutreachTemplates.isActive, true)
          )
        ),
    ]);

    const aiConfig = aiConfigRows[0] ?? null;

    if (!aiConfig) {
      throw new Error(`No AI config found for tenant: ${tenantId}`);
    }

    // Find best matching template based on lead type or use default
    const template =
      templates.find((t) => t.leadType === lead.leadType) ??
      templates.find((t) => t.isDefault) ??
      templates[0] ??
      null;

    // Build outreach prompts
    const systemPrompt = buildOutreachSystemPrompt({
      template: template
        ? {
            name: template.name,
            tone: template.tone,
            guidelines: template.guidelines,
            exampleMessages: template.exampleMessages,
          }
        : undefined,
      tenantContext: aiConfig.outreachContext ?? undefined,
    });

    const userPrompt = buildOutreachUserPrompt({
      leadType: lead.leadType,
      authorName: lead.authorName,
      authorHandle: lead.authorHandle,
      platformName: lead.platformName,
      contentSnippet: lead.contentSnippet,
      aiSummary: lead.aiSummary,
      score: lead.score,
      signals: lead.signals as Record<string, unknown>,
      contactMethods: lead.contactMethodsEnriched as Array<{
        type: string;
        value: string;
      }>,
    });

    log.info({ qualifiedLeadId, tenantId }, "Generating outreach draft via AI");

    // Generate outreach draft via Claude
    const draftResult = await generateOutreachDraft({
      systemPrompt,
      userPrompt,
      model: aiConfig.model ?? "claude-sonnet-4-20250514",
      maxTokens: aiConfig.maxTokens ?? 1024,
      apiKey: aiConfig.apiKey,
    });

    // Save the outreach draft
    const [draft] = await db
      .insert(outreachDrafts)
      .values({
        tenantId,
        qualifiedLeadId,
        templateId: template?.id ?? null,
        channel: draftResult.channel ?? "direct_message",
        subject: draftResult.subject ?? null,
        body: draftResult.body,
        tone: draftResult.tone ?? template?.tone ?? null,
        personalizationNotes: draftResult.personalizationNotes ?? null,
        status: "pending_review",
        generatedAt: new Date(),
      })
      .returning();

    // Update qualified lead status
    await db
      .update(qualifiedLeads)
      .set({ status: "outreach_drafted", outreachDraftId: draft.id })
      .where(eq(qualifiedLeads.id, qualifiedLeadId));

    log.info(
      {
        qualifiedLeadId,
        draftId: draft.id,
        channel: draftResult.channel,
      },
      "Outreach draft generated successfully"
    );

    return {
      action: "draft_created",
      draftId: draft.id,
      qualifiedLeadId,
      channel: draftResult.channel,
    };
  } catch (err) {
    const error = err as Error;
    log.error(
      { qualifiedLeadId, error: error.message },
      "Outreach generation failed"
    );

    await db
      .update(qualifiedLeads)
      .set({ status: "outreach_failed", errorMessage: error.message })
      .where(eq(qualifiedLeads.id, qualifiedLeadId));

    throw error;
  }
}
