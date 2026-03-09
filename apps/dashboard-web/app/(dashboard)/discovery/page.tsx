'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/utils';

interface SourceAdapter {
  id: number;
  name: string;
  platform: string;
  isEnabled: boolean;
  qualityScore: number;
  lastRunAt: string | null;
  status: string;
}

interface QueryRun {
  id: number;
  query: string;
  source: string;
  resultsCount: number;
  duplicatesFound: number;
  durationMs: number;
  createdAt: string;
}

interface SourceHealth {
  source: string;
  status: 'healthy' | 'degraded' | 'down';
  lastCheck: string;
  uptime: number;
  avgLatencyMs: number;
}

interface ScrubRun {
  id: number;
  processedCount: number;
  duplicatesFound: number;
  mergedCount: number;
  completedAt: string;
}

export default function DiscoveryPage() {
  const [sources, setSources] = useState<SourceAdapter[]>([]);
  const [queryRuns, setQueryRuns] = useState<QueryRun[]>([]);
  const [health, setHealth] = useState<SourceHealth[]>([]);
  const [scrubRuns, setScrubRuns] = useState<ScrubRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sourcesRes, queryRunsRes, healthRes] = await Promise.allSettled([
        api.getSources(),
        api.getDiscoveryQueryRuns(),
        api.getSourceHealth(),
      ]);

      if (sourcesRes.status === 'fulfilled') setSources(sourcesRes.value as SourceAdapter[]);
      if (queryRunsRes.status === 'fulfilled') {
        const data = queryRunsRes.value;
        setQueryRuns(data.items ?? data.queryRuns ?? data ?? []);
        if (data.scrubRuns) setScrubRuns(data.scrubRuns);
      }
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value as SourceHealth[]);
    } catch (err) {
      console.error('Failed to fetch discovery data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleTriggerScan = async () => {
    setScanning(true);
    try {
      await api.triggerDiscoveryScan();
      await fetchData();
    } catch (err) {
      console.error('Scan trigger failed:', err);
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading discovery data...
      </div>
    );
  }

  const healthStatusColor: Record<string, string> = {
    healthy: 'text-success',
    degraded: 'text-warning',
    down: 'text-danger',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Discovery</h1>
          <p className="text-sm text-text-muted mt-0.5">Source adapters, query runs, and data health</p>
        </div>
        <button
          onClick={handleTriggerScan}
          disabled={scanning}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
        >
          {scanning ? 'Scanning...' : 'Trigger Scan'}
        </button>
      </div>

      {/* Source Health Overview */}
      {health.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {health.map((h) => (
            <div
              key={h.source}
              className="bg-surface-raised border border-border rounded-lg px-5 py-4"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-text-muted uppercase tracking-wider">{h.source}</p>
                <span className={`text-xs font-medium uppercase ${healthStatusColor[h.status] ?? 'text-text-muted'}`}>
                  {h.status}
                </span>
              </div>
              <p className="text-sm text-text-secondary">
                Uptime: <span className="text-text-primary tabular-nums">{h.uptime}%</span>
              </p>
              <p className="text-xs text-text-muted mt-1">
                Avg latency: {h.avgLatencyMs}ms
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Active Source Adapters */}
      <div className="bg-surface-raised border border-border rounded-lg p-5">
        <h2 className="text-sm font-medium text-text-primary mb-4">Source Adapters</h2>
        {sources.length === 0 ? (
          <p className="text-xs text-text-muted">No source adapters configured</p>
        ) : (
          <div className="space-y-3">
            {sources.map((src) => (
              <div
                key={src.id}
                className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-2 h-2 rounded-full ${src.isEnabled ? 'bg-success' : 'bg-archive'}`}
                  />
                  <div>
                    <p className="text-sm text-text-primary">{src.name}</p>
                    <p className="text-xs text-text-muted">{src.platform}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {/* Quality Score Bar */}
                  <div className="w-24 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent/70"
                        style={{ width: `${src.qualityScore}%` }}
                      />
                    </div>
                    <span className="text-xs text-text-muted tabular-nums w-8 text-right">
                      {src.qualityScore}
                    </span>
                  </div>
                  {src.lastRunAt && (
                    <span className="text-xs text-text-muted">
                      {formatRelativeTime(src.lastRunAt)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Query Runs */}
      <div className="bg-surface-raised border border-border rounded-lg p-5">
        <h2 className="text-sm font-medium text-text-primary mb-4">Recent Query Runs</h2>
        {queryRuns.length === 0 ? (
          <p className="text-xs text-text-muted">No query runs yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 text-xs text-text-muted font-medium">Query</th>
                  <th className="pb-2 text-xs text-text-muted font-medium">Source</th>
                  <th className="pb-2 text-xs text-text-muted font-medium text-right">Results</th>
                  <th className="pb-2 text-xs text-text-muted font-medium text-right">Dupes</th>
                  <th className="pb-2 text-xs text-text-muted font-medium text-right">Time</th>
                  <th className="pb-2 text-xs text-text-muted font-medium text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {queryRuns.slice(0, 20).map((run) => (
                  <tr key={run.id} className="border-b border-border-subtle last:border-0">
                    <td className="py-2 text-text-primary max-w-xs truncate">{run.query}</td>
                    <td className="py-2 text-text-secondary">{run.source}</td>
                    <td className="py-2 text-text-primary text-right tabular-nums">{run.resultsCount}</td>
                    <td className="py-2 text-right tabular-nums">
                      <span className={run.duplicatesFound > 0 ? 'text-warning' : 'text-text-muted'}>
                        {run.duplicatesFound}
                      </span>
                    </td>
                    <td className="py-2 text-text-muted text-right tabular-nums">
                      {run.durationMs < 1000 ? `${run.durationMs}ms` : `${(run.durationMs / 1000).toFixed(1)}s`}
                    </td>
                    <td className="py-2 text-text-muted text-right">
                      {formatRelativeTime(run.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Scrub Runs */}
      {scrubRuns.length > 0 && (
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Recent Scrub Runs</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {scrubRuns.slice(0, 3).map((run) => (
              <div key={run.id} className="bg-surface-overlay rounded-md p-4 border border-border-subtle">
                <p className="text-xs text-text-muted mb-2">{formatRelativeTime(run.completedAt)}</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Processed</span>
                    <span className="text-text-primary tabular-nums">{run.processedCount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Duplicates</span>
                    <span className="text-warning tabular-nums">{run.duplicatesFound}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Merged</span>
                    <span className="text-success tabular-nums">{run.mergedCount}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
