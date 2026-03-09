import { Job } from "bullmq";
import { db } from "@alh/db";
import {
  qualifiedLeads,
  outreachDrafts,
  optOuts,
  tenantAiConfig,
  tenantOutreachTemplates,
  leadContacts,
} from "@alh/db";
import { eq, and, or } from "drizzle-orm";
import { logger } from "@alh/observability";
import type { OutreachGenerationJobData } from "@alh/queues";
import {
  generateOutreachDraft,
  buildOutreachSystemPrompt,
  buildOutreachUserPrompt,
} from "@alh/ai";

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
    // Check opt-outs by contact identifiers and profile URL
    const contacts = await db
      .select()
      .from(leadContacts)
      .where(eq(leadContacts.leadId, qualifiedLeadId));

    const optOutConditions = contacts.map((c) =>
      and(
        eq(optOuts.tenantId, tenantId),
        eq(optOuts.identifier, c.contactValue)
      )
    );

    if (lead.profileUrl) {
      optOutConditions.push(
        and(
          eq(optOuts.tenantId, tenantId),
          eq(optOuts.identifier, lead.profileUrl)
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
        .from(tenantAiConfig)
        .where(eq(tenantAiConfig.tenantId, tenantId))
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

    // Find best matching template based on lead type or use first available
    const template = templates[0] ?? null;

    // Determine channel from template or default
    const channel = template?.channel ?? "dm";

    // Build outreach prompts
    const systemPrompt = buildOutreachSystemPrompt({
      industryContext: aiConfig.industryContext,
      outreachInstructions: aiConfig.outreachInstructions ?? null,
    });

    const userPrompt = buildOutreachUserPrompt({
      leadType: lead.leadType,
      platform: lead.platform,
      aiSummary: lead.aiSummary,
      signals: (lead.aiSignalsJson as string[]) ?? [],
      channel,
    });

    log.info({ qualifiedLeadId, tenantId }, "Generating outreach draft via AI");

    // Generate outreach draft via Claude
    const draftResult = await generateOutreachDraft(systemPrompt, userPrompt);

    // Save the outreach draft
    const [draft] = await db
      .insert(outreachDrafts)
      .values({
        tenantId,
        leadId: qualifiedLeadId,
        channel,
        subject: draftResult.subject ?? null,
        body: draftResult.body,
        promptTemplate: template?.name ?? null,
        status: "pending_review",
      })
      .returning();

    // Update qualified lead status
    await db
      .update(qualifiedLeads)
      .set({ status: "outreach_drafted" })
      .where(eq(qualifiedLeads.id, qualifiedLeadId));

    log.info(
      {
        qualifiedLeadId,
        draftId: draft.id,
        channel,
      },
      "Outreach draft generated successfully"
    );

    return {
      action: "draft_created",
      draftId: draft.id,
      qualifiedLeadId,
      channel,
    };
  } catch (err) {
    const error = err as Error;
    log.error(
      { qualifiedLeadId, error: error.message },
      "Outreach generation failed"
    );

    await db
      .update(qualifiedLeads)
      .set({ status: "outreach_failed" })
      .where(eq(qualifiedLeads.id, qualifiedLeadId));

    throw error;
  }
}
