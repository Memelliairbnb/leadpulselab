import { ScoreBadge } from '@/components/shared/score-badge';
import type { IntentLevel } from '@alh/types';

interface LeadScoreBadgeProps {
  score: number;
  intentLevel?: IntentLevel;
}

export function LeadScoreBadge({ score, intentLevel }: LeadScoreBadgeProps) {
  return <ScoreBadge score={score} intentLevel={intentLevel} />;
}
