'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AnalyticsOverview } from '@alh/types';
import { api } from '@/lib/api-client';

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const overview = await api.getAnalyticsOverview();
      setData(overview);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading analytics...
      </div>
    );
  }

  const scoreBands = [
    { label: 'Hot', value: data.leadsByScoreBand.hot, color: 'bg-hot', textColor: 'text-hot' },
    { label: 'Strong', value: data.leadsByScoreBand.strong, color: 'bg-strong', textColor: 'text-strong' },
    { label: 'Nurture', value: data.leadsByScoreBand.nurture, color: 'bg-nurture', textColor: 'text-nurture' },
    { label: 'Archive', value: data.leadsByScoreBand.archive, color: 'bg-archive', textColor: 'text-archive' },
  ];

  const totalBanded = scoreBands.reduce((sum, b) => sum + b.value, 0) || 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Analytics</h1>
        <p className="text-sm text-text-muted mt-0.5">Pipeline metrics and distributions</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
          <p className="text-xs text-text-muted uppercase">Total Leads</p>
          <p className="text-2xl font-semibold text-text-primary mt-1 tabular-nums">
            {data.totalLeads.toLocaleString()}
          </p>
        </div>
        <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
          <p className="text-xs text-text-muted uppercase">Today</p>
          <p className="text-2xl font-semibold text-accent mt-1 tabular-nums">
            +{data.leadsToday}
          </p>
        </div>
        <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
          <p className="text-xs text-text-muted uppercase">Outreach Queue</p>
          <p className="text-2xl font-semibold text-warning mt-1 tabular-nums">
            {data.outreachPending}
          </p>
        </div>
        <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
          <p className="text-xs text-text-muted uppercase">Scans (24h)</p>
          <p className="text-2xl font-semibold text-success mt-1 tabular-nums">
            {data.scanJobs24h.completed}
          </p>
        </div>
      </div>

      {/* Score Band Distribution */}
      <div className="bg-surface-raised border border-border rounded-lg p-5">
        <h2 className="text-sm font-medium text-text-primary mb-4">Score Band Distribution</h2>
        {/* Stacked bar */}
        <div className="h-6 flex rounded-md overflow-hidden mb-4">
          {scoreBands.map((band) => (
            <div
              key={band.label}
              className={`${band.color} opacity-80 transition-all`}
              style={{ width: `${(band.value / totalBanded) * 100}%` }}
              title={`${band.label}: ${band.value}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-4">
          {scoreBands.map((band) => (
            <div key={band.label} className="text-center">
              <p className={`text-lg font-semibold tabular-nums ${band.textColor}`}>
                {band.value.toLocaleString()}
              </p>
              <p className="text-xs text-text-muted">{band.label}</p>
              <p className="text-xs text-text-muted tabular-nums">
                {((band.value / totalBanded) * 100).toFixed(1)}%
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leads by Type */}
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Leads by Type</h2>
          <div className="space-y-3">
            {Object.entries(data.leadsByType).length === 0 ? (
              <p className="text-xs text-text-muted">No data</p>
            ) : (
              Object.entries(data.leadsByType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => {
                  const maxTypeCount = Math.max(...Object.values(data.leadsByType), 1);
                  return (
                    <div key={type}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-text-secondary capitalize">{type.replace(/_/g, ' ')}</span>
                        <span className="text-text-primary tabular-nums">{count}</span>
                      </div>
                      <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent/60"
                          style={{ width: `${(count / maxTypeCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>

        {/* Leads by Platform */}
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Leads by Platform</h2>
          <div className="space-y-3">
            {Object.entries(data.leadsByPlatform).length === 0 ? (
              <p className="text-xs text-text-muted">No data</p>
            ) : (
              Object.entries(data.leadsByPlatform)
                .sort(([, a], [, b]) => b - a)
                .map(([platform, count]) => {
                  const maxPlatCount = Math.max(...Object.values(data.leadsByPlatform), 1);
                  return (
                    <div key={platform}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-text-secondary capitalize">{platform}</span>
                        <span className="text-text-primary tabular-nums">{count}</span>
                      </div>
                      <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent/60"
                          style={{ width: `${(count / maxPlatCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
