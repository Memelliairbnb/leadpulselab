'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { TemperatureBadge } from '@/components/shared/temperature-badge';

interface InventoryStats {
  temperatureCounts: { hot: number; warm: number; aged: number; cold: number };
  ageBands: { band: string; count: number }[];
  industrySegments: { industry: string; count: number }[];
  statusCounts: { available: number; assigned: number; working: number; exhausted: number };
  valueScoreDistribution: { band: string; count: number }[];
}

interface LeadPool {
  id: number;
  name: string;
  leadCount: number;
  avgScore: number;
  temperature: 'hot' | 'warm' | 'aged' | 'cold';
  createdAt: string;
}

export default function InventoryPage() {
  const [stats, setStats] = useState<InventoryStats | null>(null);
  const [pools, setPools] = useState<LeadPool[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, poolsRes] = await Promise.allSettled([
        api.getInventoryStats(),
        api.getInventoryPools(),
      ]);

      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
      if (poolsRes.status === 'fulfilled') setPools(poolsRes.value?.items ?? poolsRes.value ?? []);
    } catch (err) {
      console.error('Failed to fetch inventory:', err);
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
        Loading inventory...
      </div>
    );
  }

  const tempCounts = stats?.temperatureCounts ?? { hot: 0, warm: 0, aged: 0, cold: 0 };
  const statusCounts = stats?.statusCounts ?? { available: 0, assigned: 0, working: 0, exhausted: 0 };
  const ageBands = stats?.ageBands ?? [];
  const industrySegments = stats?.industrySegments ?? [];
  const valueScoreDist = stats?.valueScoreDistribution ?? [];

  const tempCards: { key: 'hot' | 'warm' | 'aged' | 'cold'; color: string }[] = [
    { key: 'hot', color: 'text-red-400' },
    { key: 'warm', color: 'text-orange-400' },
    { key: 'aged', color: 'text-yellow-400' },
    { key: 'cold', color: 'text-slate-400' },
  ];

  const statusCards: { key: keyof typeof statusCounts; label: string; color: string }[] = [
    { key: 'available', label: 'Available', color: 'text-success' },
    { key: 'assigned', label: 'Assigned', color: 'text-accent' },
    { key: 'working', label: 'Working', color: 'text-warning' },
    { key: 'exhausted', label: 'Exhausted', color: 'text-archive' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Inventory</h1>
        <p className="text-sm text-text-muted mt-0.5">Lead stock levels, pools, and distribution</p>
      </div>

      {/* Temperature Distribution */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tempCards.map(({ key, color }) => (
          <div key={key} className="bg-surface-raised border border-border rounded-lg px-5 py-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-text-muted uppercase tracking-wider">{key}</p>
              <TemperatureBadge temperature={key} />
            </div>
            <p className={`text-2xl font-semibold mt-1 tabular-nums ${color}`}>
              {tempCounts[key].toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Status Breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statusCards.map(({ key, label, color }) => (
          <div key={key} className="bg-surface-raised border border-border rounded-lg px-5 py-4">
            <p className="text-xs text-text-muted uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-semibold mt-1 tabular-nums ${color}`}>
              {statusCounts[key].toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Age Band Breakdown */}
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Age Bands</h2>
          {ageBands.length === 0 ? (
            <p className="text-xs text-text-muted">No data</p>
          ) : (
            <div className="space-y-3">
              {ageBands.map((band) => {
                const maxCount = Math.max(...ageBands.map((b) => b.count), 1);
                return (
                  <div key={band.band}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-text-secondary">{band.band}</span>
                      <span className="text-text-primary tabular-nums">{band.count}</span>
                    </div>
                    <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent/60"
                        style={{ width: `${(band.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Industry Segments */}
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Industry Segments</h2>
          {industrySegments.length === 0 ? (
            <p className="text-xs text-text-muted">No data</p>
          ) : (
            <div className="space-y-3">
              {industrySegments.slice(0, 10).map((seg) => {
                const maxCount = Math.max(...industrySegments.map((s) => s.count), 1);
                return (
                  <div key={seg.industry}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-text-secondary capitalize">{seg.industry.replace(/_/g, ' ')}</span>
                      <span className="text-text-primary tabular-nums">{seg.count}</span>
                    </div>
                    <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-500/60"
                        style={{ width: `${(seg.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Value Score Distribution */}
      {valueScoreDist.length > 0 && (
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Value Score Distribution</h2>
          <div className="flex items-end gap-2 h-32">
            {valueScoreDist.map((band) => {
              const maxCount = Math.max(...valueScoreDist.map((b) => b.count), 1);
              const pct = (band.count / maxCount) * 100;
              return (
                <div key={band.band} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-xs text-text-muted tabular-nums">{band.count}</span>
                  <div
                    className="w-full rounded-t bg-accent/70"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                  <span className="text-xs text-text-muted">{band.band}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lead Pools */}
      <div className="bg-surface-raised border border-border rounded-lg p-5">
        <h2 className="text-sm font-medium text-text-primary mb-4">Lead Pools</h2>
        {pools.length === 0 ? (
          <p className="text-xs text-text-muted">No lead pools configured</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 text-xs text-text-muted font-medium">Pool</th>
                  <th className="pb-2 text-xs text-text-muted font-medium text-right">Leads</th>
                  <th className="pb-2 text-xs text-text-muted font-medium text-right">Avg Score</th>
                  <th className="pb-2 text-xs text-text-muted font-medium">Temperature</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((pool) => (
                  <tr key={pool.id} className="border-b border-border-subtle last:border-0">
                    <td className="py-2 text-text-primary">{pool.name}</td>
                    <td className="py-2 text-text-primary text-right tabular-nums">{pool.leadCount}</td>
                    <td className="py-2 text-text-primary text-right tabular-nums">{pool.avgScore}</td>
                    <td className="py-2">
                      <TemperatureBadge temperature={pool.temperature} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
