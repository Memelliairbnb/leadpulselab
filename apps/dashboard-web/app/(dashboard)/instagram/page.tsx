'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface InstagramAccount {
  id: number;
  ig_username: string;
  ig_user_id: string | null;
  bio_text: string | null;
  profile_pic_url: string | null;
  follower_count: number | null;
  following_count: number | null;
  post_count: number | null;
  is_business: boolean;
  business_category: string | null;
  detected_niche: string | null;
  confirmed_niche: string | null;
  account_status: string;
  connected_at: string | null;
  last_active_at: string | null;
  config: any;
  products: Array<{ id: number; name: string }>;
  audiences: Array<{ id: number; name: string }>;
  today_stats: {
    follows: number;
    likes: number;
    comments: number;
    dms: number;
  };
}

export default function InstagramPage() {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  async function fetchAccounts() {
    setLoading(true);
    try {
      const res = await fetch('/api/proxy/instagram');
      if (!res.ok) throw new Error('Failed to load accounts');
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch (err: any) {
      setError(err.message);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }

  const statusColors: Record<string, string> = {
    active: 'bg-success',
    paused: 'bg-warning',
    error: 'bg-danger',
    pending: 'bg-accent',
    disabled: 'bg-archive',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading Instagram accounts...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Instagram</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Manage connected accounts and engagement automation
          </p>
        </div>
        <Link
          href="/instagram/connect"
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
        >
          Connect Instagram Account
        </Link>
      </div>

      {/* Summary Stats */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
            <p className="text-xs text-text-muted uppercase tracking-wider">Connected Accounts</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-text-primary">{accounts.length}</p>
            <p className="text-xs mt-1 text-text-muted">
              {accounts.filter((a) => a.account_status === 'active').length} active
            </p>
          </div>
          <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
            <p className="text-xs text-text-muted uppercase tracking-wider">Today&apos;s Follows</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-accent">
              {accounts.reduce((sum, a) => sum + (a.today_stats?.follows || 0), 0)}
            </p>
            <p className="text-xs mt-1 text-text-muted">Across all accounts</p>
          </div>
          <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
            <p className="text-xs text-text-muted uppercase tracking-wider">Today&apos;s Engagement</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-success">
              {accounts.reduce((sum, a) => sum + (a.today_stats?.likes || 0) + (a.today_stats?.comments || 0), 0)}
            </p>
            <p className="text-xs mt-1 text-text-muted">Likes + Comments</p>
          </div>
          <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
            <p className="text-xs text-text-muted uppercase tracking-wider">Products</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-text-primary">
              {accounts.reduce((sum, a) => sum + (a.products?.length || 0), 0)}
            </p>
            <p className="text-xs mt-1 text-text-muted">Configured across accounts</p>
          </div>
        </div>
      )}

      {/* Account Cards */}
      {accounts.length === 0 ? (
        <div className="bg-surface-raised border border-border rounded-lg p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-overlay flex items-center justify-center">
            <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-text-primary mb-1">No Instagram accounts connected</h3>
          <p className="text-xs text-text-muted mb-4">
            Connect your first Instagram account to start growing and scraping leads automatically.
          </p>
          <Link
            href="/instagram/connect"
            className="inline-flex px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
          >
            Connect Instagram Account
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {accounts.map((account) => (
            <Link
              key={account.id}
              href={`/instagram/${account.id}`}
              className="bg-surface-raised border border-border rounded-lg p-5 hover:border-accent/40 transition-colors group"
            >
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-full bg-surface-overlay flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {account.profile_pic_url ? (
                    <img src={account.profile_pic_url} alt={account.ig_username} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg font-semibold text-text-muted">
                      {account.ig_username.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors truncate">
                      @{account.ig_username}
                    </h3>
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${statusColors[account.account_status] ?? 'bg-archive'}`} />
                      <span className="text-xs text-text-muted capitalize">{account.account_status}</span>
                    </span>
                  </div>

                  {(account.confirmed_niche || account.detected_niche) && (
                    <span className="inline-block mt-1 text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">
                      {account.confirmed_niche || account.detected_niche}
                    </span>
                  )}

                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-xs text-text-muted">
                      <span className="text-text-primary font-medium tabular-nums">
                        {(account.follower_count || 0).toLocaleString()}
                      </span>{' '}followers
                    </span>
                    <span className="text-xs text-text-muted">
                      <span className="text-text-primary font-medium tabular-nums">
                        {(account.following_count || 0).toLocaleString()}
                      </span>{' '}following
                    </span>
                  </div>

                  {/* Products */}
                  {account.products?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {account.products.slice(0, 3).map((p) => (
                        <span key={p.id} className="text-xs bg-surface-overlay text-text-secondary px-2 py-0.5 rounded">
                          {p.name}
                        </span>
                      ))}
                      {account.products.length > 3 && (
                        <span className="text-xs text-text-muted">+{account.products.length - 3} more</span>
                      )}
                    </div>
                  )}

                  {/* Today's activity */}
                  <div className="grid grid-cols-4 gap-3 mt-3 pt-3 border-t border-border-subtle">
                    <div>
                      <p className="text-xs text-text-muted">Follows</p>
                      <p className="text-sm font-medium text-text-primary tabular-nums">{account.today_stats?.follows || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">Likes</p>
                      <p className="text-sm font-medium text-text-primary tabular-nums">{account.today_stats?.likes || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">Comments</p>
                      <p className="text-sm font-medium text-text-primary tabular-nums">{account.today_stats?.comments || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">DMs</p>
                      <p className="text-sm font-medium text-text-primary tabular-nums">{account.today_stats?.dms || 0}</p>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
