'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { QualifiedLead, LeadFilters, PaginatedResponse } from '@alh/types';
import { api } from '@/lib/api-client';
import { DataTable, type Column } from '@/components/shared/data-table';
import { ScoreBadge } from '@/components/shared/score-badge';
import { StatusChip } from '@/components/shared/status-chip';
import { ResolutionBadge } from '@/components/shared/resolution-badge';
import { LeadFilterBar } from '@/components/leads/lead-filters';
import { formatRelativeTime } from '@/lib/utils';
import { getLeadDisplayName } from '@/lib/lead-utils';

type ResolutionTab = 'qualified' | 'in_progress' | 'inventory' | 'all';

const RESOLUTION_TABS: { key: ResolutionTab; label: string }[] = [
  { key: 'qualified', label: 'Qualified' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'all', label: 'All' },
];

export default function LeadsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ResolutionTab>('qualified');
  const [filters, setFilters] = useState<LeadFilters>({
    page: 1,
    limit: 25,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    resolutionTab: 'qualified',
  });
  const [data, setData] = useState<PaginatedResponse<QualifiedLead> | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getLeads(filters);
      setData(result);
    } catch (err) {
      console.error('Failed to fetch leads:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  function handleTabChange(tab: ResolutionTab) {
    setActiveTab(tab);
    setFilters((prev) => ({
      ...prev,
      page: 1,
      resolutionTab: tab,
      resolutionStatus: undefined,
    }));
  }

  function handleSort(key: string) {
    setFilters((prev) => ({
      ...prev,
      sortBy: key,
      sortOrder: prev.sortBy === key && prev.sortOrder === 'asc' ? 'desc' : 'asc',
    }));
  }

  const columns: Column<QualifiedLead>[] = [
    {
      key: 'fullName',
      label: 'Name',
      sortable: true,
      render: (lead) => (
        <div>
          <span className="text-text-primary font-medium">
            {getLeadDisplayName(lead)}
          </span>
          {lead.companyName && lead.fullName && (
            <span className="block text-xs text-text-muted">{lead.companyName}</span>
          )}
        </div>
      ),
    },
    {
      key: 'leadType',
      label: 'Type',
      render: (lead) => (
        <span className="text-xs px-2 py-0.5 rounded bg-surface-overlay border border-border text-text-secondary">
          {lead.leadType.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'leadScore',
      label: 'Score',
      sortable: true,
      render: (lead) => (
        <ScoreBadge score={lead.leadScore} intentLevel={lead.intentLevel} />
      ),
    },
    {
      key: 'resolutionStatus',
      label: 'Resolution',
      render: (lead) => (
        <ResolutionBadge status={lead.resolutionStatus ?? 'signal_found'} />
      ),
    },
    {
      key: 'platform',
      label: 'Platform',
      render: (lead) => (
        <span className="text-sm text-text-secondary capitalize">{lead.platform}</span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (lead) => <StatusChip status={lead.status} />,
    },
    {
      key: 'createdAt',
      label: 'Found',
      sortable: true,
      className: 'text-right',
      render: (lead) => (
        <span className="text-xs text-text-muted">
          {formatRelativeTime(lead.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Lead Pipeline</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {data?.pagination.total !== undefined
              ? `${data.pagination.total.toLocaleString()} leads`
              : 'Loading...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/leads/import')}
            className="px-3 py-1.5 text-sm text-text-secondary border border-border rounded-md hover:bg-surface-overlay hover:text-text-primary transition-colors"
          >
            Import CSV
          </button>
          <button
            onClick={() => router.push('/leads/new')}
            className="px-3 py-1.5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Lead
          </button>
        </div>
      </div>

      {/* Resolution tabs */}
      <div className="flex items-center gap-1 bg-surface-raised border border-border rounded-lg p-1">
        {RESOLUTION_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === tab.key
                ? 'bg-accent text-white font-medium'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <LeadFilterBar filters={filters} onChange={setFilters} />

      <div className={loading ? 'opacity-60 pointer-events-none' : ''}>
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          sortBy={filters.sortBy}
          sortOrder={filters.sortOrder}
          onSort={handleSort}
          onRowClick={(lead) => router.push(`/leads/${lead.id}`)}
          page={data?.pagination.page}
          totalPages={data?.pagination.totalPages}
          total={data?.pagination.total}
          onPageChange={(p) => setFilters((prev) => ({ ...prev, page: p }))}
          emptyMessage="No leads match your filters"
        />
      </div>
    </div>
  );
}
