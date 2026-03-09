export interface TenantAIContext {
  tenantId: number;
  industryContext: string;
  leadTypes: Array<{
    name: string;
    displayName: string;
    description: string;
  }>;
  scoringSignals: Array<{
    signalKey: string;
    signalPattern: string;
    weight: number;
  }>;
  classificationInstructions: string | null;
  exampleSignals: string[];
  irrelevantSignals: string[];
}

export function buildClassificationSystemPrompt(ctx: TenantAIContext): string {
  const leadTypeList = ctx.leadTypes
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  const positiveSignals = ctx.scoringSignals
    .filter((s) => s.weight > 0)
    .map((s) => `- "${s.signalPattern}" (+${s.weight})`)
    .join('\n');

  const negativeSignals = ctx.scoringSignals
    .filter((s) => s.weight < 0)
    .map((s) => `- "${s.signalPattern}" (${s.weight})`)
    .join('\n');

  const irrelevantList =
    ctx.irrelevantSignals.length > 0
      ? `\nSignals to IGNORE (not relevant to this industry):\n${ctx.irrelevantSignals.map((s) => `- ${s}`).join('\n')}`
      : '';

  const exampleList =
    ctx.exampleSignals.length > 0
      ? `\nExample high-intent signals:\n${ctx.exampleSignals.map((s) => `- "${s}"`).join('\n')}`
      : '';

  return `You are a lead classification analyst for a business in the following industry context:

${ctx.industryContext}

Your job is to analyze raw text from public online sources and determine if the person is a potential lead for this business.

You MUST respond with valid JSON only. No markdown, no code fences, no explanation, no preamble.

Classify each lead into exactly one of these lead types:
${leadTypeList}

Positive scoring signals:
${positiveSignals}

Negative scoring signals:
${negativeSignals}
${irrelevantList}
${exampleList}

${ctx.classificationInstructions ?? ''}

Score the lead 0-100 based on how clearly the text signals a need this business can solve.

Intent levels:
- high: Actively seeking help, recent, specific pain
- medium: Has pain signals but not actively seeking
- low: Vague or indirect signals
- archive: Not a real lead for this business`;
}

export function buildClassificationUserPrompt(
  ctx: TenantAIContext,
  rawLead: {
    platform: string;
    sourceUrl: string;
    profileName: string | null;
    locationText: string | null;
    contentDate: Date | null;
    matchedKeywords: string[];
    rawText: string;
  },
): string {
  const leadTypeNames = ctx.leadTypes.map((t) => `"${t.name}"`).join(' | ');

  return `Analyze this raw text from ${rawLead.platform} and determine if this is a valid lead.

Source URL: ${rawLead.sourceUrl}
Profile: ${rawLead.profileName ?? 'Unknown'}
Location hint: ${rawLead.locationText ?? 'Unknown'}
Content date: ${rawLead.contentDate?.toISOString() ?? 'Unknown'}
Matched keywords: ${rawLead.matchedKeywords.join(', ') || 'None'}

Raw text:
---
${rawLead.rawText}
---

Respond with this exact JSON structure:
{
  "is_valid_lead": boolean,
  "confidence": number (0.0 to 1.0),
  "lead_type": ${leadTypeNames},
  "secondary_tags": string[],
  "intent_level": "high" | "medium" | "low" | "archive",
  "lead_score": number (0 to 100),
  "signals": string[] (3-7 specific evidence points from the text),
  "summary": string (2-3 sentences, human-readable),
  "recommended_next_action": string,
  "rejection_reason": string | null (if is_valid_lead is false)
}`;
}
