'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PlatformSource } from '@alh/types';
import { api } from '@/lib/api-client';
import { cn, formatRelativeTime } from '@/lib/utils';

export default function SourcesPage() {
  const [sources, setSources] = useState<PlatformSource[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getSources();
      setSources(data);
    } catch (err) {
      console.error('Failed to fetch sources:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  async function handleToggle(source: PlatformSource) {
    try {
      const updated = await api.toggleSource(source.id, !source.isEnabled);
      setSources((prev) => prev.map((s) => (s.id === source.id ? updated : s)));
    } catch (err) {
      console.error('Failed to toggle source:', err);
    }
  }

  async function handleTriggerScan(sourceId: number) {
    try {
      await api.triggerScan(sourceId);
      // Refresh to show updated lastScanAt
      fetchSources();
    } catch (err) {
      console.error('Failed to trigger scan:', err);
    }
  }

  function getHealthStatus(source: PlatformSource): { label: string; className: string } {
    if (!source.isEnabled) return { label: 'Disabled', className: 'text-text-muted' };
    if (source.errorCount >= 5) return { label: 'Unhealthy', className: 'text-danger' };
    if (source.errorCount > 0) return { label: 'Degraded', className: 'text-warning' };
    return { label: 'Healthy', className: 'text-success' };
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Sources</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Platform data sources and their health status
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading && sources.length === 0 && (
          <div className="col-span-full text-center py-12 text-text-muted text-sm">
            Loading sources...
          </div>
        )}

        {sources.map((source) => {
          const health = getHealthStatus(source);
          return (
            <div
              key={source.id}
              className="bg-surface-raised border border-border rounded-lg p-5"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-medium text-text-primary">{source.name}</h3>
                  <p className="text-xs text-text-muted mt-0.5 capitalize">
                    {source.sourceType.replace(/_/g, ' ')} &middot; {source.adapterKey}
                  </p>
                </div>
                <button
                  onClick={() => handleToggle(source)}
                  className={cn(
                    'w-9 h-5 rounded-full relative transition-colors shrink-0',
                    source.isEnabled ? 'bg-accent' : 'bg-border'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                      source.isEnabled ? 'left-4.5' : 'left-0.5'
                    )}
                  />
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-muted">Status</span>
                  <span className={health.className}>{health.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Errors</span>
                  <span className={source.errorCount > 0 ? 'text-warning' : 'text-text-secondary'}>
                    {source.errorCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Rate Limit</span>
                  <span className="text-text-secondary">{source.rateLimitRpm} rpm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Last Scan</span>
                  <span className="text-text-secondary">
                    {source.lastScanAt ? formatRelativeTime(source.lastScanAt) : 'Never'}
                  </span>
                </div>
              </div>

              <button
                onClick={() => handleTriggerScan(source.id)}
                disabled={!source.isEnabled}
                className="mt-4 w-full px-3 py-1.5 text-xs font-medium rounded-md border border-border text-text-secondary hover:bg-surface-overlay disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Trigger Scan
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
