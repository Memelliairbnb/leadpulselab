import { cn } from '@/lib/utils';
import type { IntentLevel } from '@alh/types';

interface ScoreBadgeProps {
  score: number;
  intentLevel?: IntentLevel;
  className?: string;
}

const bandConfig: Record<string, { label: string; className: string }> = {
  hot: {
    label: 'HOT',
    className: 'bg-hot/15 text-hot border-hot/25',
  },
  strong: {
    label: 'STRONG',
    className: 'bg-strong/15 text-strong border-strong/25',
  },
  nurture: {
    label: 'NURTURE',
    className: 'bg-nurture/15 text-nurture border-nurture/25',
  },
  archive: {
    label: 'ARCHIVE',
    className: 'bg-archive/15 text-archive border-archive/25',
  },
};

function getScoreBand(score: number, intentLevel?: string): string {
  if (intentLevel) {
    if (intentLevel === 'high') return 'hot';
    if (intentLevel === 'medium') return 'strong';
    if (intentLevel === 'low') return 'nurture';
    return 'archive';
  }
  if (score >= 85) return 'hot';
  if (score >= 70) return 'strong';
  if (score >= 30) return 'nurture';
  return 'archive';
}

export function ScoreBadge({ score, intentLevel, className }: ScoreBadgeProps) {
  const band = getScoreBand(score, intentLevel);
  const config = bandConfig[band];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border',
        config.className,
        className
      )}
    >
      <span className="tabular-nums">{score}</span>
      <span className="opacity-75">{config.label}</span>
    </span>
  );
}
