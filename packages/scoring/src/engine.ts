import type { TenantScoringSignal, ScoreResult } from '@alh/types';

interface ScoringInput {
  claudeScore: number;
  rawText: string;
  contentDate: Date | null;
  matchedKeywords: string[];
  isExistingDuplicate: boolean;
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
  const clampedScore = Math.max(0, Math.min(100, finalScore));

  // Determine intent level from thresholds
  let intentLevel: 'high' | 'medium' | 'low' | 'archive';
  if (clampedScore >= config.hotThreshold) intentLevel = 'high';
  else if (clampedScore >= config.nurtureThreshold) intentLevel = 'medium';
  else if (clampedScore >= 40) intentLevel = 'low';
  else intentLevel = 'archive';

  return {
    finalScore: clampedScore,
    intentLevel,
    claudeScore: input.claudeScore,
    rulesScore,
    signalsMatched,
  };
}
