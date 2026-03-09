import Anthropic from '@anthropic-ai/sdk';
import { logger } from '@alh/observability';
import { LeadAnalysisSchema, OutreachDraftSchema } from './schemas/classification-schema';
import type { LeadAnalysisOutput, OutreachDraftOutput } from './schemas/classification-schema';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export { client as claudeClient };

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  const maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS || '2048', 10);
  const temperature = parseFloat(process.env.CLAUDE_TEMPERATURE || '0.3');

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content');
  }

  return textBlock.text;
}

function extractJson(text: string): string {
  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  return text.trim();
}

export async function analyzeRawLead(
  systemPrompt: string,
  userPrompt: string,
): Promise<LeadAnalysisOutput> {
  const startTime = Date.now();

  let raw = await callClaude(systemPrompt, userPrompt);
  let jsonStr = extractJson(raw);

  try {
    const parsed = JSON.parse(jsonStr);
    const validated = LeadAnalysisSchema.parse(parsed);
    logger.info({ durationMs: Date.now() - startTime }, 'Lead analysis completed');
    return validated;
  } catch (firstError) {
    // Retry once with stricter instruction
    logger.warn({ error: String(firstError) }, 'First Claude parse failed, retrying');

    raw = await callClaude(
      systemPrompt,
      userPrompt +
        '\n\nIMPORTANT: Your previous response was not valid JSON. Respond ONLY with the JSON object, no other text, no markdown fences.',
    );
    jsonStr = extractJson(raw);

    const parsed = JSON.parse(jsonStr);
    const validated = LeadAnalysisSchema.parse(parsed);
    logger.info({ durationMs: Date.now() - startTime, retried: true }, 'Lead analysis completed on retry');
    return validated;
  }
}

export async function generateOutreachDraft(
  systemPrompt: string,
  userPrompt: string,
): Promise<OutreachDraftOutput> {
  const raw = await callClaude(systemPrompt, userPrompt);
  const jsonStr = extractJson(raw);
  const parsed = JSON.parse(jsonStr);
  return OutreachDraftSchema.parse(parsed);
}
