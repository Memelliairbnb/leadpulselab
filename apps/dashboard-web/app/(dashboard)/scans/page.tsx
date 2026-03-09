'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ScanJob, PaginatedResponse } from '@alh/types';
import { api } from '@/lib/api-client';
import { DataTable, type Column } from '@/components/shared/data-table';
import { cn, formatRelativeTime } from '@/lib/utils';

const statusColors: Record<string, string> = {
  completed: 'text-success',
  running: 'text-accent',
  pending: 'text-warning',
  failed: 'text-danger',
  cancelled: 'text-text-muted',
};

export default function ScansPage() {
  const [data, setData] = useState<PaginatedResponse<ScanJob> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchScans = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getScanJobs(page);
      setData(result);
    } catch (err) {
      console.error('Failed to fetch scans:', err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

  const columns: Column<ScanJob>[] = [
    {
      key: 'id',
      label: 'ID',
      render: (job) => <span className="text-text-muted tabular-nums">#{job.id}</span>,
    },
    {
      key: 'sourceId',
      label: 'Source',
      render: (job) => <span className="text-text-secondary tabular-nums">Source #{job.sourceId}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (job) => (
        <span className={cn('text-xs font-medium capitalize', statusColors[job.status] ?? 'text-text-muted')}>
          {job.status}
        </span>
      ),
    },
    {
      key: 'triggerType',
      label: 'Trigger',
      render: (job) => (
        <span className="text-xs text-text-muted capitalize">{job.triggerType}</span>
      ),
    },
    {
      key: 'resultsCount',
      label: 'Results',
      render: (job) => (
        <span className="text-text-secondary tabular-nums">{job.resultsCount}</span>
      ),
    },
    {
      key: 'leadsFound',
      label: 'Leads',
      render: (job) => (
        <span className={cn('tabular-nums', job.leadsFound > 0 ? 'text-success' : 'text-text-muted')}>
          {job.leadsFound}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'When',
      className: 'text-right',
      render: (job) => (
        <span className="text-xs text-text-muted">{formatRelativeTime(job.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Scan Jobs</h1>
        <p className="text-sm text-text-muted mt-0.5">Source scan history and results</p>
      </div>

      <div className={loading ? 'opacity-60 pointer-events-none' : ''}>
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          page={data?.pagination.page}
          totalPages={data?.pagination.totalPages}
          total={data?.pagination.total}
          onPageChange={setPage}
          emptyMessage="No scan jobs found"
        />
      </div>
    </div>
  );
}
