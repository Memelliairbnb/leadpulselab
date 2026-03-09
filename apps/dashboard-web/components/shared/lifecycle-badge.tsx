import { cn } from '@/lib/utils';

type LifecycleStage =
  | 'discovered'
  | 'qualified'
  | 'contacted'
  | 'replied'
  | 'converted'
  | 'nurturing'
  | 'stale'
  | 'dead';

interface LifecycleBadgeProps {
  stage: LifecycleStage;
  className?: string;
}

const stageConfig: Record<string, { label: string; className: string }> = {
  discovered: {
    label: 'Discovered',
    className: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  },
  qualified: {
    label: 'Qualified',
    className: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  },
  contacted: {
    label: 'Contacted',
    className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  },
  replied: {
    label: 'Replied',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  converted: {
    label: 'Converted',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  nurturing: {
    label: 'Nurturing',
    className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  },
  stale: {
    label: 'Stale',
    className: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  },
  dead: {
    label: 'Dead',
    className: 'bg-gray-600/10 text-gray-500 border-gray-600/20',
  },
};

export function LifecycleBadge({ stage, className }: LifecycleBadgeProps) {
  const config = stageConfig[stage] ?? {
    label: stage,
    className: 'bg-surface-overlay text-text-muted border-border',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
