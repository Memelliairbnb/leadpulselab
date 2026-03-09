'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { QualifiedLead, LeadFilters, PaginatedResponse } from '@alh/types';
import { api } from '@/lib/api-client';
import { DataTable, type Column } from '@/components/shared/data-table';
import { ScoreBadge } from '@/components/shared/score-badge';
import { StatusChip } from '@/components/shared/status-chip';
import { LeadFilterBar } from '@/components/leads/lead-filters';
import { formatRelativeTime } from '@/lib/utils';

export default function LeadsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<LeadFilters>({ page: 1, limit: 25, sortBy: 'createdAt', sortOrder: 'desc' });
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
            {lead.fullName || lead.companyName || 'Unknown'}
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
