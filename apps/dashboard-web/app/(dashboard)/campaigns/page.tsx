'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/utils';

interface Campaign {
  id: number;
  name: string;
  status: 'active' | 'paused' | 'completed' | 'draft';
  assignedCount: number;
  contactedCount: number;
  repliedCount: number;
  convertedCount: number;
  createdAt: string;
  updatedAt: string;
}

const statusStyles: Record<string, string> = {
  active: 'bg-success/10 text-success border-success/20',
  paused: 'bg-warning/10 text-warning border-warning/20',
  completed: 'bg-accent/10 text-accent border-accent/20',
  draft: 'bg-surface-overlay text-text-muted border-border',
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  // Assign form state
  const [assignCampaignId, setAssignCampaignId] = useState('');
  const [assignLeadIds, setAssignLeadIds] = useState('');
  const [assigning, setAssigning] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const filters: Record<string, any> = {};
      if (statusFilter !== 'all') filters.status = statusFilter;
      const res = await api.getCampaigns(filters);
      setCampaigns(res.data ?? res.items ?? res ?? []);
    } catch (err) {
      console.error('Failed to fetch campaigns:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignCampaignId || !assignLeadIds.trim()) return;
    setAssigning(true);
    try {
      const canonicalLeadIds = assignLeadIds
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));
      // The API expects campaignName, not campaignId
      const selectedCampaign = campaigns.find((c) => String(c.id) === assignCampaignId);
      await api.assignToCampaign({
        campaignName: selectedCampaign?.name ?? assignCampaignId,
        canonicalLeadIds,
      });
      setAssignLeadIds('');
      await fetchCampaigns();
    } catch (err) {
      console.error('Failed to assign leads:', err);
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading campaigns...
      </div>
    );
  }

  const activeCampaigns = campaigns.filter((c) => c.status === 'active');
  const totalAssigned = activeCampaigns.reduce((s, c) => s + c.assignedCount, 0);
  const totalContacted = activeCampaigns.reduce((s, c) => s + c.contactedCount, 0);
  const totalConverted = activeCampaigns.reduce((s, c) => s + c.convertedCount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Campaigns</h1>
        <p className="text-sm text-text-muted mt-0.5">Outreach campaigns and lead assignment</p>
      </div>

      {/* Performance Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
          <p className="text-xs text-text-muted uppercase">Active Campaigns</p>
          <p className="text-2xl font-semibold text-accent mt-1 tabular-nums">
            {activeCampaigns.length}
          </p>
        </div>
        <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
          <p className="text-xs text-text-muted uppercase">Total Assigned</p>
          <p className="text-2xl font-semibold text-text-primary mt-1 tabular-nums">
            {totalAssigned.toLocaleString()}
          </p>
        </div>
        <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
          <p className="text-xs text-text-muted uppercase">Total Contacted</p>
          <p className="text-2xl font-semibold text-warning mt-1 tabular-nums">
            {totalContacted.toLocaleString()}
          </p>
        </div>
        <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
          <p className="text-xs text-text-muted uppercase">Converted</p>
          <p className="text-2xl font-semibold text-success mt-1 tabular-nums">
            {totalConverted.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Status Filters */}
      <div className="flex items-center gap-2">
        {['all', 'active', 'paused', 'completed', 'draft'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-accent/15 text-accent'
                : 'bg-surface-overlay text-text-secondary hover:text-text-primary'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Campaigns List */}
      <div className="bg-surface-raised border border-border rounded-lg p-5">
        <h2 className="text-sm font-medium text-text-primary mb-4">Campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="text-xs text-text-muted">No campaigns found</p>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className="flex items-center justify-between py-3 border-b border-border-subtle last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                      statusStyles[campaign.status] ?? statusStyles.draft
                    }`}
                  >
                    {campaign.status}
                  </span>
                  <div>
                    <p className="text-sm text-text-primary font-medium">{campaign.name}</p>
                    <p className="text-xs text-text-muted">{formatRelativeTime(campaign.updatedAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm tabular-nums">
                  <div className="text-center">
                    <p className="text-text-primary">{campaign.assignedCount}</p>
                    <p className="text-xs text-text-muted">Assigned</p>
                  </div>
                  <div className="text-center">
                    <p className="text-text-primary">{campaign.contactedCount}</p>
                    <p className="text-xs text-text-muted">Contacted</p>
                  </div>
                  <div className="text-center">
                    <p className="text-warning">{campaign.repliedCount}</p>
                    <p className="text-xs text-text-muted">Replied</p>
                  </div>
                  <div className="text-center">
                    <p className="text-success">{campaign.convertedCount}</p>
                    <p className="text-xs text-text-muted">Converted</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assign Leads Form */}
      <div className="bg-surface-raised border border-border rounded-lg p-5">
        <h2 className="text-sm font-medium text-text-primary mb-4">Assign Leads to Campaign</h2>
        <form onSubmit={handleAssign} className="flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-xs text-text-muted mb-1">Campaign</label>
            <select
              value={assignCampaignId}
              onChange={(e) => setAssignCampaignId(e.target.value)}
              className="w-full bg-surface-overlay border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:border-accent"
            >
              <option value="">Select campaign...</option>
              {campaigns
                .filter((c) => c.status === 'active' || c.status === 'draft')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-text-muted mb-1">Lead IDs (comma-separated)</label>
            <input
              type="text"
              value={assignLeadIds}
              onChange={(e) => setAssignLeadIds(e.target.value)}
              placeholder="1, 2, 3"
              className="w-full bg-surface-overlay border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={assigning || !assignCampaignId || !assignLeadIds.trim()}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {assigning ? 'Assigning...' : 'Assign'}
          </button>
        </form>
      </div>
    </div>
  );
}
