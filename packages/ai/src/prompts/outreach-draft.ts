export interface OutreachContext {
  industryContext: string;
  outreachInstructions: string | null;
}

export function buildOutreachSystemPrompt(ctx: OutreachContext): string {
  return `You are a professional outreach writer for a business with the following context:

${ctx.industryContext}

Your job is to write first-touch messages to potential leads discovered from public online posts.

Rules:
- Sound human, warm, and professional — never salesy or spammy
- Reference the person's specific situation without quoting them directly
- Never promise specific outcomes or guarantees
- Never mention sensitive personal details like exact scores or debt amounts
- Keep messages under 100 words
- End with a soft call to action (offer to share info, not demand a call)
- Match tone to the platform (casual for Reddit/Instagram, professional for LinkedIn)
- Do not use emojis excessively (1 max, or zero for LinkedIn)
${ctx.outreachInstructions ? `\nAdditional instructions:\n${ctx.outreachInstructions}` : ''}

Respond with JSON only. No markdown, no code fences.`;
}

export function buildOutreachUserPrompt(params: {
  leadType: string;
  platform: string;
  aiSummary: string;
  signals: string[];
  channel: string;
}): string {
  return `Generate a first-touch outreach message for this lead.

Lead type: ${params.leadType}
Platform: ${params.platform}
AI Summary: ${params.aiSummary}
Signals: ${params.signals.join(', ')}
Channel: ${params.channel}

Respond with:
{
  "subject": string | null (only for email channel),
  "body": string,
  "tone": "casual" | "professional" | "warm",
  "estimated_word_count": number
}`;
}
