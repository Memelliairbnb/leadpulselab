'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { ScoreBadge } from '@/components/shared/score-badge';
import { ResolutionBadge } from '@/components/shared/resolution-badge';
import { getLeadDisplayName } from '@/lib/lead-utils';
import { formatRelativeTime } from '@/lib/utils';
import type { QualifiedLead, ResolutionStatus } from '@alh/types';

interface PipelineColumn {
  key: string;
  label: string;
  color: string;
  statuses: ResolutionStatus[];
}

const PIPELINE_COLUMNS: PipelineColumn[] = [
  {
    key: 'signal',
    label: 'Signal Found',
    color: 'border-gray-500/30',
    statuses: ['signal_found'],
  },
  {
    key: 'resolving',
    label: 'Resolving',
    color: 'border-indigo-500/30',
    statuses: ['profile_extracted', 'identity_candidate', 'contact_candidate'],
  },
  {
    key: 'contact',
    label: 'Contact Found',
    color: 'border-cyan-500/30',
    statuses: ['email_found', 'phone_found'],
  },
  {
    key: 'qualified',
    label: 'Qualified',
    color: 'border-emerald-500/30',
    statuses: ['qualified'],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    color: 'border-amber-500/30',
    statuses: ['partial_inventory'],
  },
];

export default function PipelinesPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<QualifiedLead[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPipelineLeads();
      const items = res.data ?? res.items ?? res ?? [];
      setLeads(items);
    } catch (err) {
      console.error('Failed to fetch pipeline:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading pipeline...
      </div>
    );
  }

  const columns = PIPELINE_COLUMNS.map((col) => ({
    ...col,
    leads: leads.filter((l) =>
      col.statuses.includes((l.resolutionStatus ?? 'signal_found') as ResolutionStatus)
    ),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Resolution Pipeline</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Signal capture through identity resolution to qualified lead
        </p>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map(({ key, label, color, leads: columnLeads }) => (
          <div
            key={key}
            className={`flex-shrink-0 w-72 bg-surface-raised border rounded-lg ${color}`}
          >
            {/* Column Header */}
            <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
              <span className="text-sm font-medium text-text-primary">{label}</span>
              <span className="text-xs text-text-muted tabular-nums bg-surface-overlay px-2 py-0.5 rounded-full">
                {columnLeads.length}
              </span>
            </div>

            {/* Lead Cards */}
            <div className="p-3 space-y-2 min-h-[200px] max-h-[calc(100vh-300px)] overflow-y-auto">
              {columnLeads.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-8">No leads in this stage</p>
              ) : (
                columnLeads.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => router.push(`/leads/${lead.id}`)}
                    className="bg-surface-overlay border border-border-subtle rounded-md p-3 hover:border-border transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-text-primary font-medium truncate">
                          {getLeadDisplayName(lead)}
                        </p>
                        {lead.companyName && (
                          <p className="text-xs text-text-muted truncate">{lead.companyName}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <ScoreBadge score={lead.leadScore} intentLevel={lead.intentLevel} />
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised border border-border text-text-muted capitalize">
                        {lead.platform}
                      </span>
                    </div>
                    {/* Contact info icons */}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {lead.resolvedEmail && (
                          <span title={lead.emailVerified ? 'Verified email' : 'Email found'} className="flex items-center gap-0.5">
                            <svg className={`w-3.5 h-3.5 ${lead.emailVerified ? 'text-emerald-400' : 'text-text-muted'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          </span>
                        )}
                        {lead.resolvedPhone && (
                          <span title={lead.phoneVerified ? 'Verified phone' : 'Phone found'} className="flex items-center gap-0.5">
                            <svg className={`w-3.5 h-3.5 ${lead.phoneVerified ? 'text-emerald-400' : 'text-text-muted'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                          </span>
                        )}
                        {lead.profileUrl && (
                          <span title="Profile URL" className="flex items-center gap-0.5">
                            <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-text-muted tabular-nums">
                        {formatRelativeTime(lead.createdAt)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
