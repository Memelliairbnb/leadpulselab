import { api } from '@/lib/api-client';
import type { AnalyticsOverview } from '@alh/types';

async function getOverview(): Promise<AnalyticsOverview | null> {
  try {
    return await api.getAnalyticsOverview();
  } catch {
    return null;
  }
}

export default async function OverviewPage() {
  const data = await getOverview();

  // Fallback for when API isn't available yet
  const overview: AnalyticsOverview = data ?? {
    totalLeads: 0,
    leadsToday: 0,
    leadsByScoreBand: { hot: 0, strong: 0, nurture: 0, archive: 0 },
    leadsByType: {},
    leadsByPlatform: {},
    scanJobs24h: { completed: 0, failed: 0 },
    outreachPending: 0,
  };

  const stats = [
    {
      label: 'Total Leads',
      value: overview.totalLeads.toLocaleString(),
      sub: `+${overview.leadsToday} today`,
    },
    {
      label: 'Hot Leads',
      value: overview.leadsByScoreBand.hot.toLocaleString(),
      sub: 'Score 80+',
      accent: 'text-hot',
    },
    {
      label: 'Outreach Pending',
      value: overview.outreachPending.toLocaleString(),
      sub: 'Awaiting review',
      accent: 'text-warning',
    },
    {
      label: 'Scans (24h)',
      value: overview.scanJobs24h.completed.toLocaleString(),
      sub: overview.scanJobs24h.failed > 0
        ? `${overview.scanJobs24h.failed} failed`
        : 'All healthy',
      accent: overview.scanJobs24h.failed > 0 ? 'text-danger' : 'text-success',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Overview</h1>
        <p className="text-sm text-text-muted mt-1">Lead pipeline at a glance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-surface-raised border border-border rounded-lg px-5 py-4"
          >
            <p className="text-xs text-text-muted uppercase tracking-wider">{stat.label}</p>
            <p className={`text-2xl font-semibold mt-1 tabular-nums ${stat.accent ?? 'text-text-primary'}`}>
              {stat.value}
            </p>
            <p className={`text-xs mt-1 ${stat.accent ?? 'text-text-muted'}`}>{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Score Distribution */}
      <div className="bg-surface-raised border border-border rounded-lg p-5">
        <h2 className="text-sm font-medium text-text-primary mb-4">Score Distribution</h2>
        <div className="flex items-end gap-2 h-32">
          {[
            { band: 'Hot', count: overview.leadsByScoreBand.hot, color: 'bg-hot' },
            { band: 'Strong', count: overview.leadsByScoreBand.strong, color: 'bg-strong' },
            { band: 'Nurture', count: overview.leadsByScoreBand.nurture, color: 'bg-nurture' },
            { band: 'Archive', count: overview.leadsByScoreBand.archive, color: 'bg-archive' },
          ].map((item) => {
            const maxCount = Math.max(
              overview.leadsByScoreBand.hot,
              overview.leadsByScoreBand.strong,
              overview.leadsByScoreBand.nurture,
              overview.leadsByScoreBand.archive,
              1
            );
            const pct = (item.count / maxCount) * 100;
            return (
              <div key={item.band} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-xs text-text-muted tabular-nums">{item.count}</span>
                <div
                  className={`w-full rounded-t ${item.color} opacity-80`}
                  style={{ height: `${Math.max(pct, 4)}%` }}
                />
                <span className="text-xs text-text-muted">{item.band}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-column: By Type + By Platform */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-3">Leads by Type</h2>
          <div className="space-y-2">
            {Object.entries(overview.leadsByType).length === 0 ? (
              <p className="text-xs text-text-muted">No data yet</p>
            ) : (
              Object.entries(overview.leadsByType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary capitalize">{type.replace(/_/g, ' ')}</span>
                    <span className="text-sm text-text-primary tabular-nums">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-3">Leads by Platform</h2>
          <div className="space-y-2">
            {Object.entries(overview.leadsByPlatform).length === 0 ? (
              <p className="text-xs text-text-muted">No data yet</p>
            ) : (
              Object.entries(overview.leadsByPlatform)
                .sort(([, a], [, b]) => b - a)
                .map(([platform, count]) => (
                  <div key={platform} className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary capitalize">{platform}</span>
                    <span className="text-sm text-text-primary tabular-nums">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
