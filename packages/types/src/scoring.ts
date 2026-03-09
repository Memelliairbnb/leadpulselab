export interface ScoringWeight {
  id: number;
  tenantId: number;
  signalKey: string;
  weight: number;
  description: string | null;
  isActive: boolean;
  updatedAt: Date;
}

export interface ScoreResult {
  finalScore: number;
  intentLevel: 'high' | 'medium' | 'low' | 'archive';
  claudeScore: number;
  rulesScore: number;
  signalsMatched: string[];
}

export interface LeadAnalysisResult {
  is_valid_lead: boolean;
  confidence: number;
  lead_type: string;
  secondary_tags: string[];
  intent_level: 'high' | 'medium' | 'low' | 'archive';
  lead_score: number;
  signals: string[];
  summary: string;
  recommended_next_action: string;
  rejection_reason: string | null;
}

export interface OutreachDraftResult {
  subject: string | null;
  body: string;
  tone: 'casual' | 'professional' | 'warm';
  estimated_word_count: number;
}
