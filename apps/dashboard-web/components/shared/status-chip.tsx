import { cn } from '@/lib/utils';
import type { LeadStatus } from '@alh/types';

interface StatusChipProps {
  status: LeadStatus;
  className?: string;
}

const statusConfig: Record<LeadStatus, { label: string; className: string }> = {
  new: {
    label: 'New',
    className: 'bg-accent/10 text-accent border-accent/20',
  },
  reviewing: {
    label: 'Reviewing',
    className: 'bg-warning/10 text-warning border-warning/20',
  },
  approved: {
    label: 'Approved',
    className: 'bg-success/10 text-success border-success/20',
  },
  outreach_sent: {
    label: 'Outreach Sent',
    className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  },
  nurturing: {
    label: 'Nurturing',
    className: 'bg-nurture/10 text-nurture border-nurture/20',
  },
  converted: {
    label: 'Converted',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  archived: {
    label: 'Archived',
    className: 'bg-archive/10 text-archive border-archive/20',
  },
};

export function StatusChip({ status, className }: StatusChipProps) {
  const config = statusConfig[status] ?? {
    label: status,
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
