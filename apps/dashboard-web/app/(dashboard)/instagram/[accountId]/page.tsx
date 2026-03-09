'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { formatRelativeTime } from '@/lib/utils';

interface AccountDetail {
  id: string;
  username: string;
  fullName: string;
  profilePicUrl: string | null;
  bio: string | null;
  followerCount: number;
  followingCount: number;
  postCount: number;
  isBusiness: boolean;
  category: string | null;
  niche: string | null;
  status: 'active' | 'paused' | 'error' | 'connecting';
  products: string[];
  idealCustomers: string[];
  engagement: {
    autoFollow: boolean;
    autoLike: boolean;
    autoComment: boolean;
    autoDm: boolean;
    autoContent: boolean;
    dailyFollowLimit: number;
    dailyLikeLimit: number;
    dailyCommentLimit: number;
    dailyDmLimit: number;
  };
  stats: {
    todayFollows: number;
    todayLikes: number;
    todayComments: number;
    todayDms: number;
    totalLeadsScraped: number;
    engagementRate: number;
  };
  dailyStats: Array<{
    date: string;
    follows: number;
    likes: number;
    comments: number;
    dms: number;
  }>;
  recentActivity: Array<{
    id: string;
    type: 'follow' | 'like' | 'comment' | 'dm' | 'scrape';
    targetUsername: string;
    detail: string;
    createdAt: string;
  }>;
  createdAt: string;
  lastActiveAt: string | null;
}

const statusColors: Record<string, string> = {
  active: 'bg-success',
  paused: 'bg-warning',
  error: 'bg-danger',
  connecting: 'bg-accent',
};

const activityTypeIcons: Record<string, string> = {
  follow: 'text-accent',
  like: 'text-hot',
  comment: 'text-success',
  dm: 'text-strong',
  scrape: 'text-nurture',
};

export default function AccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = use(params);
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    fetchAccount();
  }, [accountId]);

  async function fetchAccount() {
    setLoading(true);
    try {
      const res = await fetch(`/api/proxy/instagram/accounts/${accountId}`);
      if (!res.ok) throw new Error('Failed to load account');
      const data = await res.json();
      setAccount(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus() {
    if (!account) return;
    setToggling(true);
    try {
      const newStatus = account.status === 'active' ? 'paused' : 'active';
      const res = await fetch(`/api/proxy/instagram/accounts/${accountId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      setAccount((prev) => (prev ? { ...prev, status: newStatus } : prev));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading account details...
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-danger">{error || 'Account not found'}</p>
        <Link href="/instagram" className="text-sm text-accent hover:text-accent-hover">
          Back to Instagram
        </Link>
      </div>
    );
  }

  const maxDaily = Math.max(
    ...(account.dailyStats?.map((d) => d.follows + d.likes + d.comments) ?? [1]),
    1
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/instagram" className="text-text-muted hover:text-text-secondary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-lg font-semibold text-text-primary">@{account.username}</h1>
          <span className="flex items-center gap-1.5 ml-2">
            <span className={`w-2 h-2 rounded-full ${statusColors[account.status]}`} />
            <span className="text-xs text-text-muted capitalize">{account.status}</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleStatus}
            disabled={toggling}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 ${
              account.status === 'active'
                ? 'bg-warning/10 text-warning hover:bg-warning/20 border border-warning/30'
                : 'bg-success/10 text-success hover:bg-success/20 border border-success/30'
            }`}
          >
            {account.status === 'active' ? 'Pause' : 'Resume'}
          </button>
          <Link
            href={`/instagram/connect?edit=${accountId}`}
            className="px-4 py-2 bg-surface-overlay border border-border text-text-secondary hover:text-text-primary text-sm font-medium rounded-md transition-colors"
          >
            Settings
          </Link>
        </div>
      </div>

      {/* Account Info Card */}
      <div className="bg-surface-raised border border-border rounded-lg p-5">
        <div className="flex items-start gap-5">
          <div className="w-20 h-20 rounded-full bg-surface-overlay flex items-center justify-center overflow-hidden flex-shrink-0">
            {account.profilePicUrl ? (
              <img src={account.profilePicUrl} alt={account.username} className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-semibold text-text-muted">
                {account.username.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-text-primary">{account.fullName || account.username}</h2>
            {account.bio && (
              <p className="text-sm text-text-secondary mt-1 whitespace-pre-line">{account.bio}</p>
            )}
            <div className="flex items-center gap-6 mt-3">
              <span className="text-sm">
                <span className="font-semibold text-text-primary tabular-nums">
                  {account.followerCount.toLocaleString()}
                </span>{' '}
                <span className="text-text-muted">followers</span>
              </span>
              <span className="text-sm">
                <span className="font-semibold text-text-primary tabular-nums">
                  {account.followingCount.toLocaleString()}
                </span>{' '}
                <span className="text-text-muted">following</span>
              </span>
              <span className="text-sm">
                <span className="font-semibold text-text-primary tabular-nums">
                  {account.postCount.toLocaleString()}
                </span>{' '}
                <span className="text-text-muted">posts</span>
              </span>
            </div>
            {account.niche && (
              <span className="inline-block mt-2 text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">
                {account.niche}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Follows Today', value: account.stats.todayFollows, color: 'text-accent' },
          { label: 'Likes Today', value: account.stats.todayLikes, color: 'text-hot' },
          { label: 'Comments Today', value: account.stats.todayComments, color: 'text-success' },
          { label: 'DMs Today', value: account.stats.todayDms, color: 'text-strong' },
          { label: 'Leads Scraped', value: account.stats.totalLeadsScraped, color: 'text-nurture' },
          { label: 'Engagement', value: `${account.stats.engagementRate}%`, color: 'text-text-primary' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-raised border border-border rounded-lg px-4 py-3">
            <p className="text-xs text-text-muted">{stat.label}</p>
            <p className={`text-xl font-semibold mt-1 tabular-nums ${stat.color}`}>
              {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Daily Engagement Chart */}
      {account.dailyStats && account.dailyStats.length > 0 && (
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Engagement (Last 7 Days)</h2>
          <div className="flex items-end gap-1.5 h-40">
            {account.dailyStats.slice(-7).map((day) => {
              const total = day.follows + day.likes + day.comments;
              const pct = (total / maxDaily) * 100;
              const followPct = total > 0 ? (day.follows / total) * pct : 0;
              const likePct = total > 0 ? (day.likes / total) * pct : 0;
              const commentPct = total > 0 ? (day.comments / total) * pct : 0;

              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-text-muted tabular-nums">{total}</span>
                  <div className="w-full flex flex-col-reverse" style={{ height: `${Math.max(pct, 4)}%` }}>
                    <div className="w-full bg-accent/70 rounded-b" style={{ height: `${followPct > 0 ? (followPct / pct) * 100 : 0}%` }} />
                    <div className="w-full bg-hot/70" style={{ height: `${likePct > 0 ? (likePct / pct) * 100 : 0}%` }} />
                    <div className="w-full bg-success/70 rounded-t" style={{ height: `${commentPct > 0 ? (commentPct / pct) * 100 : 0}%` }} />
                  </div>
                  <span className="text-xs text-text-muted">
                    {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 justify-center">
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="w-2.5 h-2.5 rounded-sm bg-accent/70" /> Follows
            </span>
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="w-2.5 h-2.5 rounded-sm bg-hot/70" /> Likes
            </span>
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="w-2.5 h-2.5 rounded-sm bg-success/70" /> Comments
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Activity */}
        <div className="bg-surface-raised border border-border rounded-lg p-5">
          <h2 className="text-sm font-medium text-text-primary mb-4">Recent Activity</h2>
          {(!account.recentActivity || account.recentActivity.length === 0) ? (
            <p className="text-xs text-text-muted">No recent activity</p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {account.recentActivity.slice(0, 20).map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <span
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      activity.type === 'follow'
                        ? 'bg-accent'
                        : activity.type === 'like'
                          ? 'bg-hot'
                          : activity.type === 'comment'
                            ? 'bg-success'
                            : activity.type === 'dm'
                              ? 'bg-strong'
                              : 'bg-nurture'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary">
                      <span className="capitalize">{activity.type}</span>{' '}
                      <span className="text-text-secondary">@{activity.targetUsername}</span>
                    </p>
                    {activity.detail && (
                      <p className="text-xs text-text-muted truncate">{activity.detail}</p>
                    )}
                  </div>
                  <span className="text-xs text-text-muted flex-shrink-0">
                    {formatRelativeTime(activity.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Products & Target Audiences */}
        <div className="space-y-4">
          <div className="bg-surface-raised border border-border rounded-lg p-5">
            <h2 className="text-sm font-medium text-text-primary mb-3">Products Being Marketed</h2>
            {(!account.products || account.products.length === 0) ? (
              <p className="text-xs text-text-muted">No products configured</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {account.products.map((product, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 bg-surface-overlay border border-border-subtle rounded-md text-sm text-text-secondary"
                  >
                    {product}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="bg-surface-raised border border-border rounded-lg p-5">
            <h2 className="text-sm font-medium text-text-primary mb-3">Target Audiences</h2>
            {(!account.idealCustomers || account.idealCustomers.length === 0) ? (
              <p className="text-xs text-text-muted">No target audiences configured</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {account.idealCustomers.map((customer, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 bg-accent/5 border border-accent/20 rounded-md text-sm text-accent"
                  >
                    {customer}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Automation Status */}
          <div className="bg-surface-raised border border-border rounded-lg p-5">
            <h2 className="text-sm font-medium text-text-primary mb-3">Automation Status</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Auto-Follow', enabled: account.engagement.autoFollow },
                { label: 'Auto-Like', enabled: account.engagement.autoLike },
                { label: 'Auto-Comment', enabled: account.engagement.autoComment },
                { label: 'Auto-DM', enabled: account.engagement.autoDm },
                { label: 'Auto-Content', enabled: account.engagement.autoContent },
              ].map(({ label, enabled }) => (
                <div key={label} className="flex items-center justify-between py-1">
                  <span className="text-xs text-text-secondary">{label}</span>
                  <span
                    className={`text-xs font-medium ${enabled ? 'text-success' : 'text-text-muted'}`}
                  >
                    {enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
