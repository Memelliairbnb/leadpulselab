import { cn } from '@/lib/utils';

type Temperature = 'hot' | 'warm' | 'aged' | 'cold';

interface TemperatureBadgeProps {
  temperature: Temperature;
  className?: string;
}

const tempConfig: Record<Temperature, { label: string; className: string; pulse?: boolean }> = {
  hot: {
    label: 'HOT',
    className: 'bg-red-500/15 text-red-400 border-red-500/25',
    pulse: true,
  },
  warm: {
    label: 'WARM',
    className: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  },
  aged: {
    label: 'AGED',
    className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  },
  cold: {
    label: 'COLD',
    className: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
  },
};

export function TemperatureBadge({ temperature, className }: TemperatureBadgeProps) {
  const config = tempConfig[temperature] ?? tempConfig.cold;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border',
        config.className,
        className
      )}
    >
      {config.pulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
      )}
      {config.label}
    </span>
  );
}
