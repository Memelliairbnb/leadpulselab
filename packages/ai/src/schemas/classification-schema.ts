import { z } from 'zod';

export const LeadAnalysisSchema = z.object({
  is_valid_lead: z.boolean(),
  confidence: z.number().min(0).max(1),
  lead_type: z.string(),
  secondary_tags: z.array(z.string()),
  intent_level: z.enum(['high', 'medium', 'low', 'archive']),
  lead_score: z.number().int().min(0).max(100),
  signals: z.array(z.string()),
  summary: z.string(),
  recommended_next_action: z.string(),
  rejection_reason: z.string().nullable().optional(),
  // Intent signal fields (new — optional for backward compat with older responses)
  intent_type: z.string().optional().default('unknown'),
  signal_phrases_found: z.array(z.string()).optional().default([]),
  is_real_person: z.boolean().optional().default(true),
  person_or_business_name: z.string().nullable().optional().default(null),
  estimated_urgency: z
    .enum(['immediate', 'short_term', 'exploring', 'none'])
    .optional()
    .default('exploring'),
});

export type LeadAnalysisOutput = z.infer<typeof LeadAnalysisSchema>;

export const OutreachDraftSchema = z.object({
  subject: z.string().nullable(),
  body: z.string(),
  tone: z.enum(['casual', 'professional', 'warm']),
  estimated_word_count: z.number().int(),
});

export type OutreachDraftOutput = z.infer<typeof OutreachDraftSchema>;
