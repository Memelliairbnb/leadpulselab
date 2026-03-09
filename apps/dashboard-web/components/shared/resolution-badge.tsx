import { cn } from '@/lib/utils';
import type { ResolutionStatus } from '@alh/types';

interface ResolutionBadgeProps {
  status: ResolutionStatus;
  className?: string;
}

const resolutionConfig: Record<string, { label: string; className: string }> = {
  signal_found: {
    label: 'Signal',
    className: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  },
  profile_extracted: {
    label: 'Profile',
    className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  identity_candidate: {
    label: 'Identity',
    className: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  },
  contact_candidate: {
    label: 'Contact',
    className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  },
  email_found: {
    label: 'Email Found',
    className: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  },
  phone_found: {
    label: 'Phone Found',
    className: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  },
  qualified: {
    label: 'Qualified',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  partial_inventory: {
    label: 'Inventory',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  discarded: {
    label: 'Discarded',
    className: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
};

export function ResolutionBadge({ status, className }: ResolutionBadgeProps) {
  const config = resolutionConfig[status] ?? {
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
