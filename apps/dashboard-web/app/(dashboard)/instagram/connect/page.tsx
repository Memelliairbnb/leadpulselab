'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface ConnectedAccount {
  id: number;
  igUserId: string;
  igUsername: string;
  fullName: string;
  profilePicUrl: string | null;
  followerCount: number;
  followingCount: number;
  isBusiness: boolean;
  category: string | null;
}

interface NicheSetup {
  accountId: number;
  username: string;
  detectedNiche: string;
  confirmedNiche: string;
  editingNiche: boolean;
  products: string[];
  idealCustomers: string[];
  detectingNiche: boolean;
}

interface EngagementSettings {
  autoFollow: boolean;
  autoLike: boolean;
  autoComment: boolean;
  autoDm: boolean;
  autoContent: boolean;
  dailyFollowLimit: number;
  dailyLikeLimit: number;
  dailyCommentLimit: number;
  dailyDmLimit: number;
}

const defaultEngagement: EngagementSettings = {
  autoFollow: true,
  autoLike: true,
  autoComment: false,
  autoDm: false,
  autoContent: false,
  dailyFollowLimit: 50,
  dailyLikeLimit: 100,
  dailyCommentLimit: 20,
  dailyDmLimit: 10,
};

export default function InstagramConnectPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string>('');

  // Step 1: Browser login
  const [connectedAccount, setConnectedAccount] = useState<ConnectedAccount | null>(null);

  // Step 2: Niche setup
  const [nicheSetup, setNicheSetup] = useState<NicheSetup | null>(null);

  // Step 3: Engagement settings
  const [engagement, setEngagement] = useState<EngagementSettings>(defaultEngagement);

  // Poll for connection status after browser opens
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/proxy/instagram');
        if (res.ok) {
          const data = await res.json();
          const accounts = data.accounts || [];
          // Check for any newly connected account (active status)
          const newest = accounts.find(
            (a: any) => a.account_status === 'active' && !connectedAccount
          );
          if (newest) {
            const account: ConnectedAccount = {
              id: newest.id,
              igUserId: newest.ig_user_id || '',
              igUsername: newest.ig_username,
              fullName: newest.bio_text?.split('\n')[0] || newest.ig_username,
              profilePicUrl: newest.profile_pic_url,
              followerCount: newest.follower_count || 0,
              followingCount: newest.following_count || 0,
              isBusiness: newest.is_business || false,
              category: newest.business_category || null,
            };
            setConnectedAccount(account);
            setPolling(false);
            setLoading(false);
            setConnectStatus('');
            moveToNicheSetup(account);
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [polling, connectedAccount]);

  function moveToNicheSetup(account: ConnectedAccount) {
    setNicheSetup({
      accountId: account.id,
      username: account.igUsername,
      detectedNiche: account.category || 'General',
      confirmedNiche: account.category || 'General',
      editingNiche: false,
      products: [''],
      idealCustomers: [''],
      detectingNiche: true,
    });
    setStep(2);
    detectNiche(account.id);
  }

  function handleOpenBrowser() {
    setLoading(true);
    setError(null);
    setConnectStatus('Opening Instagram in your browser...');

    // Open Instagram login in a new window
    const width = 450;
    const height = 750;
    const left = window.screenX + (window.innerWidth - width) / 2;
    const top = window.screenY + (window.innerHeight - height) / 2;

    const popup = window.open(
      'https://www.instagram.com/accounts/login/',
      'instagram-login',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,toolbar=no,menubar=no`
    );

    if (!popup) {
      setError('Popup blocked. Please allow popups for this site.');
      setLoading(false);
      setConnectStatus('');
      return;
    }

    setConnectStatus(
      'Log in to Instagram in the popup window. Once logged in, enter your Instagram username below.'
    );

    // Check if popup closed
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        if (!connectedAccount) {
          setConnectStatus('Instagram window closed. Enter your username below to finish connecting.');
        }
      }
    }, 1000);
  }

  // Manual connection: user enters their username after logging in via popup
  const [manualUsername, setManualUsername] = useState('');

  async function handleManualConnect() {
    if (!manualUsername.trim()) return;
    setLoading(true);
    setError(null);
    setConnectStatus('Looking up your account...');

    try {
      // Register the account via browser-connect endpoint
      const res = await fetch('/api/proxy/instagram/browser-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ig_user_id: '',
          ig_username: manualUsername.trim().replace('@', ''),
          session_cookies: '{}',
          is_business: false,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Connection failed');

      const account = data.account as ConnectedAccount;
      setConnectedAccount(account);
      moveToNicheSetup(account);
    } catch (err: any) {
      setError(err.message);
      setConnectStatus('');
    } finally {
      setLoading(false);
    }
  }

  async function detectNiche(accountId: number) {
    try {
      const res = await fetch(`/api/proxy/instagram/accounts/${accountId}/detect-niche`, {
        method: 'POST',
      });

      if (res.ok) {
        const data = await res.json();
        setNicheSetup((prev) =>
          prev
            ? {
                ...prev,
                detectedNiche: data.detected_niche || prev.detectedNiche,
                confirmedNiche: data.detected_niche || prev.confirmedNiche,
                products:
                  data.suggested_products?.length > 0
                    ? data.suggested_products.map((p: { name: string }) => p.name)
                    : prev.products,
                idealCustomers:
                  data.suggested_audiences?.length > 0
                    ? data.suggested_audiences.map((a: { name: string }) => a.name)
                    : prev.idealCustomers,
                detectingNiche: false,
              }
            : prev
        );
      } else {
        setNicheSetup((prev) => (prev ? { ...prev, detectingNiche: false } : prev));
      }
    } catch {
      setNicheSetup((prev) => (prev ? { ...prev, detectingNiche: false } : prev));
    }
  }

  function updateNicheSetup(updates: Partial<NicheSetup>) {
    setNicheSetup((prev) => (prev ? { ...prev, ...updates } : prev));
  }

  function addListItem(field: 'products' | 'idealCustomers') {
    setNicheSetup((prev) =>
      prev ? { ...prev, [field]: [...prev[field], ''] } : prev
    );
  }

  function updateListItem(field: 'products' | 'idealCustomers', index: number, value: string) {
    setNicheSetup((prev) =>
      prev
        ? { ...prev, [field]: prev[field].map((v, i) => (i === index ? value : v)) }
        : prev
    );
  }

  function removeListItem(field: 'products' | 'idealCustomers', index: number) {
    setNicheSetup((prev) =>
      prev
        ? { ...prev, [field]: prev[field].filter((_, i) => i !== index) }
        : prev
    );
  }

  async function handleSaveAndStart() {
    if (!nicheSetup || !connectedAccount) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/instagram/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accounts: [
            {
              ig_username: connectedAccount.igUsername,
              niche: nicheSetup.confirmedNiche,
              products: nicheSetup.products
                .filter((p) => p.trim())
                .map((p) => ({ name: p.trim() })),
              audiences: nicheSetup.idealCustomers
                .filter((c) => c.trim())
                .map((c) => ({ name: c.trim() })),
              config: {
                auto_follow: engagement.autoFollow,
                auto_like: engagement.autoLike,
                auto_comment: engagement.autoComment,
                auto_dm: engagement.autoDm,
                auto_content: engagement.autoContent,
                daily_follow_limit: engagement.dailyFollowLimit,
                daily_like_limit: engagement.dailyLikeLimit,
                daily_comment_limit: engagement.dailyCommentLimit,
                daily_dm_limit: engagement.dailyDmLimit,
                engagement_enabled: true,
                content_enabled: engagement.autoContent,
              },
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Setup failed');

      router.push('/instagram');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const stepLabels = ['Connect', 'Niche', 'Settings'];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Connect Instagram Account</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Link your Instagram to start automated engagement and lead generation
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                step === i + 1
                  ? 'bg-accent text-white'
                  : step > i + 1
                    ? 'bg-success/20 text-success'
                    : 'bg-surface-overlay text-text-muted'
              }`}
            >
              {step > i + 1 ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-xs ${step === i + 1 ? 'text-text-primary' : 'text-text-muted'}`}>
              {label}
            </span>
            {i < stepLabels.length - 1 && (
              <div className={`w-8 h-px ${step > i + 1 ? 'bg-success/40' : 'bg-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {/* Step 1: Connect with Instagram */}
      {step === 1 && (
        <div className="bg-surface-raised border border-border rounded-lg p-6 space-y-5">
          <div className="text-center space-y-3">
            {/* Instagram icon */}
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069z" />
              </svg>
            </div>

            <div>
              <h2 className="text-base font-medium text-text-primary">Connect Your Instagram</h2>
              <p className="text-sm text-text-muted mt-1">
                We'll open Instagram in a new window. Log in with your account (saved passwords work), then come back here.
              </p>
            </div>
          </div>

          {/* Open Browser Button */}
          <button
            onClick={handleOpenBrowser}
            disabled={loading && !connectStatus}
            className="w-full px-4 py-3 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 hover:from-purple-600 hover:via-pink-600 hover:to-orange-500 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069z" />
            </svg>
            Open Instagram Login
          </button>

          {/* Status message */}
          {connectStatus && (
            <div className="p-3 bg-accent/5 border border-accent/20 rounded-lg">
              <p className="text-xs text-text-secondary">{connectStatus}</p>
            </div>
          )}

          {/* Username input - shown after browser opens */}
          {connectStatus && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-text-muted">Once logged in</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div>
                <label className="block text-xs text-text-secondary mb-1.5">
                  Enter your Instagram username
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">@</span>
                    <input
                      type="text"
                      value={manualUsername}
                      onChange={(e) => setManualUsername(e.target.value.replace(/[^a-zA-Z0-9_.]/g, ''))}
                      placeholder="yourusername"
                      className="w-full pl-7 pr-3 py-2.5 bg-surface-overlay border border-border rounded-md text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                      onKeyDown={(e) => e.key === 'Enter' && handleManualConnect()}
                    />
                  </div>
                  <button
                    onClick={handleManualConnect}
                    disabled={loading || !manualUsername.trim()}
                    className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                  >
                    {loading ? (
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      'Connect'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 bg-surface-overlay rounded-lg">
            <svg className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-xs text-text-muted">
              We never see your password. You log in directly on Instagram.com in your own browser where your passwords are saved.
            </p>
          </div>
        </div>
      )}

      {/* Step 2: Niche Setup */}
      {step === 2 && nicheSetup && (
        <div className="bg-surface-raised border border-border rounded-lg p-6 space-y-5">
          {/* Connected account preview */}
          {connectedAccount && (
            <div className="flex items-center gap-3 p-3 bg-success/5 border border-success/20 rounded-lg">
              <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center overflow-hidden flex-shrink-0">
                {connectedAccount.profilePicUrl ? (
                  <img src={connectedAccount.profilePicUrl} alt={connectedAccount.igUsername} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm font-semibold text-text-muted">
                    {connectedAccount.igUsername.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">@{connectedAccount.igUsername}</p>
                <p className="text-xs text-text-muted">
                  {connectedAccount.followerCount?.toLocaleString() || 0} followers
                  {connectedAccount.isBusiness && ' · Business account'}
                </p>
              </div>
              <svg className="w-5 h-5 text-success flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}

          <div>
            <h2 className="text-sm font-medium text-text-primary">
              Niche Setup for @{nicheSetup.username}
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Help the AI understand your business to find the right leads.
            </p>
          </div>

          {/* Detected Niche */}
          <div className="space-y-2">
            <label className="block text-xs text-text-secondary">AI-Detected Niche</label>
            {nicheSetup.detectingNiche ? (
              <div className="flex items-center gap-2 py-2">
                <svg className="w-4 h-4 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs text-text-muted">AI is analyzing your account...</span>
              </div>
            ) : !nicheSetup.editingNiche ? (
              <div className="flex items-center gap-3">
                <span className="px-3 py-1.5 bg-accent/10 text-accent rounded-md text-sm font-medium">
                  {nicheSetup.confirmedNiche}
                </span>
                <span className="text-xs text-text-muted">Is this correct?</span>
                <button
                  onClick={() => updateNicheSetup({ editingNiche: false })}
                  className="text-xs text-success hover:text-success/80 font-medium"
                >
                  Yes
                </button>
                <button
                  onClick={() => updateNicheSetup({ editingNiche: true })}
                  className="text-xs text-warning hover:text-warning/80 font-medium"
                >
                  Edit
                </button>
              </div>
            ) : (
              <input
                type="text"
                value={nicheSetup.confirmedNiche}
                onChange={(e) => updateNicheSetup({ confirmedNiche: e.target.value })}
                className="w-full px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-primary focus:border-accent focus:outline-none"
                placeholder="e.g. Credit Repair, Real Estate, Fitness, Restaurants"
              />
            )}
          </div>

          {/* Products */}
          <div className="space-y-2">
            <label className="block text-xs text-text-secondary">What do you sell?</label>
            <div className="space-y-2">
              {nicheSetup.products.map((product, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={product}
                    onChange={(e) => updateListItem('products', i, e.target.value)}
                    className="flex-1 px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-primary focus:border-accent focus:outline-none"
                    placeholder="e.g. Credit repair services, coaching programs..."
                  />
                  {nicheSetup.products.length > 1 && (
                    <button
                      onClick={() => removeListItem('products', i)}
                      className="text-text-muted hover:text-danger p-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => addListItem('products')}
              className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add another
            </button>
          </div>

          {/* Ideal Customers */}
          <div className="space-y-2">
            <label className="block text-xs text-text-secondary">Who is your ideal customer?</label>
            <div className="space-y-2">
              {nicheSetup.idealCustomers.map((customer, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customer}
                    onChange={(e) => updateListItem('idealCustomers', i, e.target.value)}
                    className="flex-1 px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-primary focus:border-accent focus:outline-none"
                    placeholder="e.g. People with bad credit, first-time home buyers..."
                  />
                  {nicheSetup.idealCustomers.length > 1 && (
                    <button
                      onClick={() => removeListItem('idealCustomers', i)}
                      className="text-text-muted hover:text-danger p-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => addListItem('idealCustomers')}
              className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add another
            </button>
          </div>

          <button
            onClick={() => setStep(3)}
            disabled={nicheSetup.detectingNiche}
            className="w-full px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            Continue to Settings
          </button>
        </div>
      )}

      {/* Step 3: Engagement Settings */}
      {step === 3 && (
        <div className="bg-surface-raised border border-border rounded-lg p-6 space-y-5">
          <div>
            <h2 className="text-sm font-medium text-text-primary mb-1">Engagement Settings</h2>
            <p className="text-xs text-text-muted">
              Configure automation features and daily limits.
            </p>
          </div>

          {/* Toggle Switches */}
          <div className="space-y-3">
            {[
              { key: 'autoFollow' as const, label: 'Auto-Follow', desc: 'Automatically follow target accounts' },
              { key: 'autoLike' as const, label: 'Auto-Like', desc: 'Like posts from target accounts' },
              { key: 'autoComment' as const, label: 'Auto-Comment', desc: 'AI-generated comments on posts' },
              { key: 'autoDm' as const, label: 'Auto-DM', desc: 'Send personalized direct messages' },
              { key: 'autoContent' as const, label: 'Auto-Content', desc: 'AI-generated post suggestions' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm text-text-primary">{label}</p>
                  <p className="text-xs text-text-muted">{desc}</p>
                </div>
                <button
                  onClick={() =>
                    setEngagement((prev) => ({ ...prev, [key]: !prev[key] }))
                  }
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    engagement[key] ? 'bg-accent' : 'bg-surface-overlay border border-border'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      engagement[key] ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          {/* Daily Limits */}
          <div className="border-t border-border pt-4 space-y-4">
            <h3 className="text-xs text-text-secondary uppercase tracking-wider">Daily Limits</h3>
            {[
              { key: 'dailyFollowLimit' as const, label: 'Follow Limit', min: 10, max: 200 },
              { key: 'dailyLikeLimit' as const, label: 'Like Limit', min: 20, max: 500 },
              { key: 'dailyCommentLimit' as const, label: 'Comment Limit', min: 5, max: 100 },
              { key: 'dailyDmLimit' as const, label: 'DM Limit', min: 5, max: 50 },
            ].map(({ key, label, min, max }) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-text-secondary">{label}</label>
                  <span className="text-xs text-text-primary font-medium tabular-nums">
                    {engagement[key]}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  value={engagement[key]}
                  onChange={(e) =>
                    setEngagement((prev) => ({
                      ...prev,
                      [key]: parseInt(e.target.value),
                    }))
                  }
                  className="w-full h-1.5 bg-surface-overlay rounded-full appearance-none cursor-pointer accent-accent"
                />
                <div className="flex justify-between text-xs text-text-muted">
                  <span>{min}</span>
                  <span>{max}</span>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleSaveAndStart}
            disabled={loading}
            className="w-full px-4 py-2.5 bg-success hover:bg-success/90 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Setting up...
              </span>
            ) : (
              'Save & Start Growing'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
