'use client';

import type { LeadFilters as LeadFiltersType } from '@alh/types';

interface LeadFilterBarProps {
  filters: LeadFiltersType;
  onChange: (filters: LeadFiltersType) => void;
}

const statusOptions = [
  { value: '', label: 'All Statuses' },
  { value: 'new', label: 'New' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'approved', label: 'Approved' },
  { value: 'outreach_sent', label: 'Outreach Sent' },
  { value: 'nurturing', label: 'Nurturing' },
  { value: 'converted', label: 'Converted' },
  { value: 'archived', label: 'Archived' },
];

const intentOptions = [
  { value: '', label: 'All Scores' },
  { value: 'high', label: 'Hot (80+)' },
  { value: 'medium', label: 'Strong (60-79)' },
  { value: 'low', label: 'Nurture (35-59)' },
  { value: 'archive', label: 'Archive (<35)' },
];

const platformOptions = [
  { value: '', label: 'All Platforms' },
  { value: 'google', label: 'Google' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'yelp', label: 'Yelp' },
  { value: 'twitter', label: 'Twitter/X' },
];

const selectClass =
  'bg-surface-raised border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent appearance-none cursor-pointer';

export function LeadFilterBar({ filters, onChange }: LeadFilterBarProps) {
  function update(patch: Partial<LeadFiltersType>) {
    onChange({ ...filters, ...patch, page: 1 });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="text"
        placeholder="Search leads..."
        value={filters.search ?? ''}
        onChange={(e) => update({ search: e.target.value })}
        className="bg-surface-raised border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent w-64"
      />

      <select
        value={filters.status ?? ''}
        onChange={(e) => update({ status: e.target.value || undefined })}
        className={selectClass}
      >
        {statusOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        value={filters.intentLevel ?? ''}
        onChange={(e) => update({ intentLevel: e.target.value || undefined })}
        className={selectClass}
      >
        {intentOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        value={filters.platform ?? ''}
        onChange={(e) => update({ platform: e.target.value || undefined })}
        className={selectClass}
      >
        {platformOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {(filters.status || filters.intentLevel || filters.platform || filters.search) && (
        <button
          onClick={() => onChange({ page: 1, limit: filters.limit })}
          className="text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
