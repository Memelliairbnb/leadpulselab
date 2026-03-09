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

  return `You are a lead classification and buying-intent analyst for a business in the following industry context:

${ctx.industryContext}

Your job is to analyze raw text from public online sources and determine:
1. If the author is a REAL PERSON expressing a REAL NEED (not a company posting ads, not educational/marketing content, not a service provider advertising)
2. What their buying intent signals are
3. Whether they are a potential lead for this business

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

## INTENT ANALYSIS INSTRUCTIONS

Identify the INTENT TYPE — classify the primary intent into exactly one of:
- seeking_help: Person is actively asking for help or guidance
- requesting_service: Person is requesting a specific service or provider
- expressing_pain: Person is describing a problem, frustration, or pain point
- switching_provider: Person mentions dissatisfaction with current provider and looking for alternatives
- asking_recommendation: Person is asking others for recommendations or referrals
- posting_job: Person is posting a job or looking for someone to hire
- reviewing_service: Person is reviewing or commenting on a service (not a lead themselves)

Extract SIGNAL PHRASES: Pull the exact phrases from the text that indicate buying intent (e.g. "need help with", "looking for someone who", "anyone recommend", "fed up with my current", "how do I find a").

Identify the PERSON/BUSINESS: Extract the author's username, real name, or company name if visible in the text.

Rate URGENCY:
- immediate: Needs help right now, deadline mentioned, crisis language
- short_term: Looking actively but no rush, within days/weeks
- exploring: Early research stage, gathering information
- none: No real urgency, hypothetical, or not a real need

CRITICAL DISTINCTION — flag is_real_person correctly:
- TRUE: A real individual expressing their own personal need or problem
- FALSE: A company, service provider advertising, news article, educational content, marketing post, or bot-generated content

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

  const keywordContext = rawLead.matchedKeywords.length > 0
    ? `\nThese intent phrases were matched during discovery: ${rawLead.matchedKeywords.join(', ')}`
    : '';

  const platformContext = `Source platform: ${rawLead.platform} — consider the typical content style of this platform when evaluating intent (e.g. Reddit posts tend to be personal questions, Quora is Q&A, LinkedIn is professional).`;

  return `Analyze this raw text from ${rawLead.platform} and determine if this is a valid lead.

${platformContext}

Source URL: ${rawLead.sourceUrl}
Profile: ${rawLead.profileName ?? 'Unknown'}
Location hint: ${rawLead.locationText ?? 'Unknown'}
Content date: ${rawLead.contentDate?.toISOString() ?? 'Unknown'}
Matched keywords: ${rawLead.matchedKeywords.join(', ') || 'None'}${keywordContext}

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
  "rejection_reason": string | null (if is_valid_lead is false),
  "intent_type": "seeking_help" | "requesting_service" | "expressing_pain" | "switching_provider" | "asking_recommendation" | "posting_job" | "reviewing_service",
  "signal_phrases_found": string[] (exact buying-signal phrases found in the text),
  "is_real_person": boolean (true if this is a real person with a real need, false if company/ad/article),
  "person_or_business_name": string | null (name or username of the person/business if visible),
  "estimated_urgency": "immediate" | "short_term" | "exploring" | "none"
}`;
}
