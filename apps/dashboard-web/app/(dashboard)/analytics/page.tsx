'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AnalyticsOverview } from '@alh/types';
import { api } from '@/lib/api-client';

interface YieldMetrics {
  funnel: {
    queries: number;
    fetches: number;
    raw: number;
    normalized: number;
    qualified: number;
    contacted: number;
    converted: number;
  };
  costPerLead: {
    raw: number;
    normalized: number;
    qualified: number;
    contacted: number;
    converted: number;
  };
  sourcePerformance: {
    source: string;
    leadsFound: number;
    qualified: number;
    conversionRate: number;
    costPerLead: number;
  }[];
  inventoryAging: {
    band: string;
    count: number;
  }[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [yieldData, setYieldData] = useState<YieldMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const [overview, yieldRes] = await Promise.allSettled([
        api.getAnalyticsOverview(),
        api.getYieldMetrics(),
      ]);
      if (overview.status === 'fulfilled') setData(overview.value);
      if (yieldRes.status === 'fulfilled') setYieldData(yieldRes.value);
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

  const funnel = yieldData?.funnel;
  const funnelSteps = funnel
    ? [
        { label: 'Queries', value: funnel.queries, color: 'bg-sky-500' },
        { label: 'Fetches', value: funnel.fetches, color: 'bg-indigo-500' },
        { label: 'Raw', value: funnel.raw, color: 'bg-purple-500' },
        { label: 'Normalized', value: funnel.normalized, color: 'bg-violet-500' },
        { label: 'Qualified', value: funnel.qualified, color: 'bg-amber-500' },
        { label: 'Contacted', value: funnel.contacted, color: 'bg-orange-500' },
        { label: 'Converted', value: funnel.converted, color: 'bg-emerald-500' },
      ]
    : [];

  const maxFunnelValue = funnelSteps.length > 0 ? Math.max(...funnelSteps.map((s) => s.value), 1) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Analytics</h1>
        <p className="text-sm text-text-muted mt-0.5">Pipeline metrics, yield funnel, and cost tracking</p>
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

      {/* Yield Funnel */}
      {funnelSteps.length > 0 && (
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Yield Funnel</h2>
          <div className="space-y-3">
            {funnelSteps.map((step, i) => {
              const pct = (step.value / maxFunnelValue) * 100;
              const prevValue = i > 0 ? funnelSteps[i - 1].value : null;
              const dropPct = prevValue && prevValue > 0
                ? ((1 - step.value / prevValue) * 100).toFixed(0)
                : null;
              return (
                <div key={step.label}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-text-secondary">{step.label}</span>
                    <div className="flex items-center gap-3">
                      {dropPct && (
                        <span className="text-xs text-text-muted">
                          -{dropPct}%
                        </span>
                      )}
                      <span className="text-text-primary tabular-nums">{step.value.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-surface-overlay rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${step.color} opacity-70 transition-all`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cost Tracking */}
      {yieldData?.costPerLead && (
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Cost per Lead by Stage</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {Object.entries(yieldData.costPerLead).map(([stage, cost]) => (
              <div key={stage} className="text-center">
                <p className="text-lg font-semibold text-text-primary tabular-nums">
                  ${(cost as number).toFixed(2)}
                </p>
                <p className="text-xs text-text-muted capitalize">{stage}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Score Band Distribution */}
      <div className="bg-surface-raised border border-border rounded-lg p-5">
        <h2 className="text-sm font-medium text-text-primary mb-4">Score Band Distribution</h2>
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

      {/* Source Performance Comparison */}
      {yieldData?.sourcePerformance && yieldData.sourcePerformance.length > 0 && (
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Source Performance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 text-xs text-text-muted font-medium">Source</th>
                  <th className="pb-2 text-xs text-text-muted font-medium text-right">Leads Found</th>
                  <th className="pb-2 text-xs text-text-muted font-medium text-right">Qualified</th>
                  <th className="pb-2 text-xs text-text-muted font-medium text-right">Conv. Rate</th>
                  <th className="pb-2 text-xs text-text-muted font-medium text-right">Cost/Lead</th>
                </tr>
              </thead>
              <tbody>
                {yieldData.sourcePerformance.map((src) => (
                  <tr key={src.source} className="border-b border-border-subtle last:border-0">
                    <td className="py-2 text-text-primary capitalize">{src.source}</td>
                    <td className="py-2 text-text-primary text-right tabular-nums">{src.leadsFound}</td>
                    <td className="py-2 text-text-primary text-right tabular-nums">{src.qualified}</td>
                    <td className="py-2 text-right tabular-nums">
                      <span className={src.conversionRate >= 10 ? 'text-success' : 'text-text-secondary'}>
                        {src.conversionRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 text-text-primary text-right tabular-nums">
                      ${src.costPerLead.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Inventory Aging Chart */}
      {yieldData?.inventoryAging && yieldData.inventoryAging.length > 0 && (
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Inventory Aging</h2>
          <div className="flex items-end gap-2 h-32">
            {yieldData.inventoryAging.map((band) => {
              const maxCount = Math.max(...yieldData.inventoryAging.map((b) => b.count), 1);
              const pct = (band.count / maxCount) * 100;
              return (
                <div key={band.band} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-xs text-text-muted tabular-nums">{band.count}</span>
                  <div
                    className="w-full rounded-t bg-accent/60"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                  <span className="text-xs text-text-muted">{band.band}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
