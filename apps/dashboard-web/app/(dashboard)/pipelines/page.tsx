'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { ScoreBadge } from '@/components/shared/score-badge';
import { TemperatureBadge } from '@/components/shared/temperature-badge';
import { LifecycleBadge } from '@/components/shared/lifecycle-badge';

interface PipelineLead {
  id: number;
  name: string;
  company: string | null;
  score: number;
  temperature: 'hot' | 'warm' | 'aged' | 'cold';
  lifecycleStage: string;
  daysInStage: number;
}

const STAGES = ['discovered', 'qualified', 'contacted', 'replied', 'converted'] as const;

const stageColors: Record<string, string> = {
  discovered: 'border-sky-500/30',
  qualified: 'border-indigo-500/30',
  contacted: 'border-purple-500/30',
  replied: 'border-amber-500/30',
  converted: 'border-emerald-500/30',
};

export default function PipelinesPage() {
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPipelineLeads();
      // API returns PaginatedResponse shape with .data array
      const items = res.data ?? res.items ?? res ?? [];
      // Map qualified lead fields to pipeline lead shape
      setLeads(items.map((lead: any) => ({
        id: lead.id,
        name: lead.fullName || lead.companyName || `Lead #${lead.id}`,
        company: lead.companyName || null,
        score: lead.leadScore ?? 0,
        temperature: lead.leadScore >= 80 ? 'hot' : lead.leadScore >= 60 ? 'warm' : lead.leadScore >= 35 ? 'aged' : 'cold',
        lifecycleStage: lead.status === 'new' ? 'discovered' : lead.status === 'approved' ? 'qualified' : lead.status === 'outreach_sent' ? 'contacted' : lead.status === 'nurturing' ? 'replied' : lead.status === 'converted' ? 'converted' : 'discovered',
        daysInStage: lead.createdAt ? Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000) : 0,
      })));
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

  const columns = STAGES.map((stage) => ({
    stage,
    leads: leads.filter((l) => l.lifecycleStage === stage),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Pipeline</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Lifecycle stages from discovery to conversion
        </p>
      </div>

      {/* Kanban Board */}
      {/* TODO: Add drag-and-drop with @dnd-kit or react-beautiful-dnd */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map(({ stage, leads: columnLeads }) => (
          <div
            key={stage}
            className={`flex-shrink-0 w-72 bg-surface-raised border rounded-lg ${stageColors[stage] ?? 'border-border'}`}
          >
            {/* Column Header */}
            <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LifecycleBadge stage={stage as any} />
              </div>
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
                    className="bg-surface-overlay border border-border-subtle rounded-md p-3 hover:border-border transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-text-primary font-medium truncate">
                          {lead.name}
                        </p>
                        {lead.company && (
                          <p className="text-xs text-text-muted truncate">{lead.company}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <ScoreBadge score={lead.score} />
                      <TemperatureBadge temperature={lead.temperature} />
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-text-muted tabular-nums">
                        {lead.daysInStage}d in stage
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
