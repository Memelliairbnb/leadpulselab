import type { TenantScoringSignal, ScoreResult } from '@alh/types';

/**
 * Contact data availability levels, used to cap scores for unreachable leads.
 * - 'direct': email or phone available — no cap
 * - 'profile': username or profile URL only — capped at 75
 * - 'none': no contact data at all — capped at 60
 */
export type ContactDataLevel = 'direct' | 'profile' | 'none';

interface ScoringInput {
  claudeScore: number;
  rawText: string;
  contentDate: Date | null;
  matchedKeywords: string[];
  isExistingDuplicate: boolean;
  /** Optional — defaults to 'direct' for backward compatibility */
  contactDataLevel?: ContactDataLevel;
}

interface ScoringConfig {
  claudeWeight: number;
  rulesWeight: number;
  hotThreshold: number;
  strongThreshold: number;
  nurtureThreshold: number;
  signals: TenantScoringSignal[];
}

export function calculateFinalScore(
  input: ScoringInput,
  config: ScoringConfig,
): ScoreResult {
  const textLower = input.rawText.toLowerCase();
  let rulesScore = 50; // base score
  const signalsMatched: string[] = [];

  // Apply tenant-configured scoring signals
  for (const signal of config.signals) {
    if (!signal.isActive) continue;

    if (signal.signalPattern) {
      const patterns = signal.signalPattern.split('|').map((p) => p.trim().toLowerCase());
      const matched = patterns.some((p) => textLower.includes(p));
      if (matched) {
        rulesScore += signal.weight;
        signalsMatched.push(signal.signalKey);
      }
    }
  }

  // Recency scoring
  if (input.contentDate) {
    const daysSince = (Date.now() - input.contentDate.getTime()) / 86400000;
    if (daysSince <= 7) {
      rulesScore += 10;
      signalsMatched.push('recent_activity_7d');
    } else if (daysSince > 30) {
      rulesScore -= 25;
      signalsMatched.push('stale_content_30d');
    }
  }

  // Duplicate penalty
  if (input.isExistingDuplicate) {
    rulesScore -= 30;
    signalsMatched.push('duplicate_signal');
  }

  // Multiple keyword matches bonus
  if (input.matchedKeywords.length >= 3) {
    rulesScore += 10;
    signalsMatched.push('multiple_keyword_matches');
  }

  // Clamp rules score
  rulesScore = Math.max(0, Math.min(100, rulesScore));

  // Weighted blend
  const finalScore = Math.round(
    config.claudeWeight * input.claudeScore + config.rulesWeight * rulesScore,
  );
  let clampedScore = Math.max(0, Math.min(100, finalScore));

  // --- Contact data penalty ---
  // A lead you can't reach is not actionable, regardless of intent signals.
  // Default to 'direct' so existing callers without this field are unaffected.
  const contactLevel = input.contactDataLevel ?? 'direct';

  if (contactLevel === 'none') {
    // No contact data at all — cap at 60 (can't be hot or strong)
    clampedScore = Math.min(clampedScore, 60);
    signalsMatched.push('no_contact_data');
  } else if (contactLevel === 'profile') {
    // Only profile URL / username — cap at 75 (can be strong but not hot)
    clampedScore = Math.min(clampedScore, 75);
    signalsMatched.push('profile_only_contact');
  }

  // Determine intent level from thresholds
  let intentLevel: 'high' | 'medium' | 'low' | 'archive';
  if (clampedScore >= config.hotThreshold) intentLevel = 'high';
  else if (clampedScore >= config.strongThreshold) intentLevel = 'medium';
  else if (clampedScore >= config.nurtureThreshold) intentLevel = 'low';
  else if (clampedScore >= 30) intentLevel = 'low';
  else intentLevel = 'archive';

  return {
    finalScore: clampedScore,
    intentLevel,
    claudeScore: input.claudeScore,
    rulesScore,
    signalsMatched,
  };
}
