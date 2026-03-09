'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DetectedAccount {
  id: string;
  username: string;
  fullName: string;
  profilePicUrl: string | null;
  followerCount: number;
  followingCount: number;
  isBusiness: boolean;
  category: string | null;
  selected: boolean;
}

interface NicheSetup {
  accountId: string;
  username: string;
  detectedNiche: string;
  confirmedNiche: string;
  editingNiche: boolean;
  products: string[];
  idealCustomers: string[];
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

  // Step 1: Login
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Step 2: 2FA
  const [twoFaCode, setTwoFaCode] = useState('');
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // Step 3: Account selection
  const [detectedAccounts, setDetectedAccounts] = useState<DetectedAccount[]>([]);

  // Step 4: Niche setup
  const [nicheSetups, setNicheSetups] = useState<NicheSetup[]>([]);
  const [currentNicheIndex, setCurrentNicheIndex] = useState(0);

  // Step 5: Engagement settings
  const [engagement, setEngagement] = useState<EngagementSettings>(defaultEngagement);

  async function handleLogin() {
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/instagram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Login failed');

      setSessionToken(data.sessionToken ?? null);

      if (data.requiresTwoFa) {
        setStep(2);
      } else {
        setDetectedAccounts(
          (data.accounts ?? []).map((a: any) => ({ ...a, selected: true }))
        );
        setStep(3);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify2Fa() {
    if (twoFaCode.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/instagram/connect/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, code: twoFaCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Verification failed');

      setDetectedAccounts(
        (data.accounts ?? []).map((a: any) => ({ ...a, selected: true }))
      );
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleAccountSelection(id: string) {
    setDetectedAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a))
    );
  }

  function handleConnectSelected() {
    const selected = detectedAccounts.filter((a) => a.selected);
    if (selected.length === 0) return;

    setNicheSetups(
      selected.map((a) => ({
        accountId: a.id,
        username: a.username,
        detectedNiche: a.category ?? 'General',
        confirmedNiche: a.category ?? 'General',
        editingNiche: false,
        products: [''],
        idealCustomers: [''],
      }))
    );
    setCurrentNicheIndex(0);
    setStep(4);
  }

  function updateNicheSetup(index: number, updates: Partial<NicheSetup>) {
    setNicheSetups((prev) =>
      prev.map((n, i) => (i === index ? { ...n, ...updates } : n))
    );
  }

  function addListItem(index: number, field: 'products' | 'idealCustomers') {
    setNicheSetups((prev) =>
      prev.map((n, i) =>
        i === index ? { ...n, [field]: [...n[field], ''] } : n
      )
    );
  }

  function updateListItem(
    nicheIndex: number,
    field: 'products' | 'idealCustomers',
    itemIndex: number,
    value: string
  ) {
    setNicheSetups((prev) =>
      prev.map((n, i) =>
        i === nicheIndex
          ? {
              ...n,
              [field]: n[field].map((v, j) => (j === itemIndex ? value : v)),
            }
          : n
      )
    );
  }

  function removeListItem(
    nicheIndex: number,
    field: 'products' | 'idealCustomers',
    itemIndex: number
  ) {
    setNicheSetups((prev) =>
      prev.map((n, i) =>
        i === nicheIndex
          ? { ...n, [field]: n[field].filter((_, j) => j !== itemIndex) }
          : n
      )
    );
  }

  function handleNicheNext() {
    if (currentNicheIndex < nicheSetups.length - 1) {
      setCurrentNicheIndex(currentNicheIndex + 1);
    } else {
      setStep(5);
    }
  }

  async function handleSaveAndStart() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/instagram/accounts/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          accounts: nicheSetups.map((n) => ({
            accountId: n.accountId,
            niche: n.confirmedNiche,
            products: n.products.filter((p) => p.trim()),
            idealCustomers: n.idealCustomers.filter((c) => c.trim()),
          })),
          engagement,
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

  const stepLabels = ['Login', '2FA', 'Accounts', 'Niche', 'Settings'];
  const activeSteps = step === 2 ? [1, 2, 3, 4, 5] : [1, 3, 4, 5];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Connect Instagram Account</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Link your Instagram to start automated engagement and lead scraping
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {activeSteps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                step === s
                  ? 'bg-accent text-white'
                  : step > s
                    ? 'bg-success/20 text-success'
                    : 'bg-surface-overlay text-text-muted'
              }`}
            >
              {step > s ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-xs ${step === s ? 'text-text-primary' : 'text-text-muted'}`}>
              {stepLabels[s - 1]}
            </span>
            {i < activeSteps.length - 1 && (
              <div className={`w-8 h-px ${step > s ? 'bg-success/40' : 'bg-border'}`} />
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

      {/* Step 1: Login */}
      {step === 1 && (
        <div className="bg-surface-raised border border-border rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-sm font-medium text-text-primary mb-1">Instagram Login</h2>
            <p className="text-xs text-text-muted">
              Your credentials are encrypted and used only for session authentication.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your_instagram_handle"
                className="w-full px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
          </div>

          <button
            onClick={handleLogin}
            disabled={loading || !username.trim() || !password.trim()}
            className="w-full px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Connecting...
              </span>
            ) : (
              'Connect'
            )}
          </button>
        </div>
      )}

      {/* Step 2: 2FA */}
      {step === 2 && (
        <div className="bg-surface-raised border border-border rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-sm font-medium text-text-primary mb-1">Two-Factor Authentication</h2>
            <p className="text-xs text-text-muted">
              Enter the 6-digit code from your authenticator app or SMS.
            </p>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1.5">Verification Code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={twoFaCode}
              onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none text-center text-lg tracking-widest font-mono"
              onKeyDown={(e) => e.key === 'Enter' && handleVerify2Fa()}
            />
          </div>

          <button
            onClick={handleVerify2Fa}
            disabled={loading || twoFaCode.length !== 6}
            className="w-full px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Verifying...
              </span>
            ) : (
              'Verify'
            )}
          </button>
        </div>
      )}

      {/* Step 3: Account Selection */}
      {step === 3 && (
        <div className="bg-surface-raised border border-border rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-sm font-medium text-text-primary mb-1">Select Accounts</h2>
            <p className="text-xs text-text-muted">
              Choose which accounts to connect for automated growth.
            </p>
          </div>

          {detectedAccounts.length === 0 ? (
            <p className="text-sm text-text-muted py-4 text-center">No accounts detected</p>
          ) : (
            <div className="space-y-2">
              {detectedAccounts.map((account) => (
                <button
                  key={account.id}
                  onClick={() => toggleAccountSelection(account.id)}
                  className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors text-left ${
                    account.selected
                      ? 'border-accent/50 bg-accent/5'
                      : 'border-border-subtle bg-surface-overlay hover:border-border'
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      account.selected
                        ? 'bg-accent border-accent'
                        : 'border-text-muted bg-transparent'
                    }`}
                  >
                    {account.selected && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center overflow-hidden flex-shrink-0">
                    {account.profilePicUrl ? (
                      <img src={account.profilePicUrl} alt={account.username} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-semibold text-text-muted">
                        {account.username.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary">@{account.username}</p>
                      {account.isBusiness && (
                        <span className="text-xs bg-accent/10 text-accent px-1.5 py-0.5 rounded">Business</span>
                      )}
                    </div>
                    {account.fullName && (
                      <p className="text-xs text-text-secondary truncate">{account.fullName}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-text-muted">
                        {account.followerCount.toLocaleString()} followers
                      </span>
                      {account.category && (
                        <span className="text-xs text-text-muted">{account.category}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={handleConnectSelected}
            disabled={detectedAccounts.filter((a) => a.selected).length === 0}
            className="w-full px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            Connect Selected ({detectedAccounts.filter((a) => a.selected).length})
          </button>
        </div>
      )}

      {/* Step 4: Niche Setup */}
      {step === 4 && nicheSetups[currentNicheIndex] && (
        <div className="bg-surface-raised border border-border rounded-lg p-6 space-y-5">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-text-primary">
                Niche Setup for @{nicheSetups[currentNicheIndex].username}
              </h2>
              {nicheSetups.length > 1 && (
                <span className="text-xs text-text-muted">
                  {currentNicheIndex + 1} of {nicheSetups.length}
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Help the AI understand your business to find the right leads.
            </p>
          </div>

          {/* Detected Niche */}
          <div className="space-y-2">
            <label className="block text-xs text-text-secondary">AI-Detected Niche</label>
            {!nicheSetups[currentNicheIndex].editingNiche ? (
              <div className="flex items-center gap-3">
                <span className="px-3 py-1.5 bg-accent/10 text-accent rounded-md text-sm font-medium">
                  {nicheSetups[currentNicheIndex].confirmedNiche}
                </span>
                <span className="text-xs text-text-muted">Is this correct?</span>
                <button
                  onClick={() => updateNicheSetup(currentNicheIndex, { editingNiche: false })}
                  className="text-xs text-success hover:text-success/80 font-medium"
                >
                  Yes
                </button>
                <button
                  onClick={() => updateNicheSetup(currentNicheIndex, { editingNiche: true })}
                  className="text-xs text-warning hover:text-warning/80 font-medium"
                >
                  Edit
                </button>
              </div>
            ) : (
              <input
                type="text"
                value={nicheSetups[currentNicheIndex].confirmedNiche}
                onChange={(e) =>
                  updateNicheSetup(currentNicheIndex, { confirmedNiche: e.target.value })
                }
                className="w-full px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-primary focus:border-accent focus:outline-none"
                placeholder="e.g. Credit Repair, Real Estate, Fitness"
              />
            )}
          </div>

          {/* Products */}
          <div className="space-y-2">
            <label className="block text-xs text-text-secondary">What do you sell?</label>
            <div className="space-y-2">
              {nicheSetups[currentNicheIndex].products.map((product, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={product}
                    onChange={(e) =>
                      updateListItem(currentNicheIndex, 'products', i, e.target.value)
                    }
                    className="flex-1 px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-primary focus:border-accent focus:outline-none"
                    placeholder="e.g. Credit repair services, coaching programs..."
                  />
                  {nicheSetups[currentNicheIndex].products.length > 1 && (
                    <button
                      onClick={() => removeListItem(currentNicheIndex, 'products', i)}
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
              onClick={() => addListItem(currentNicheIndex, 'products')}
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
              {nicheSetups[currentNicheIndex].idealCustomers.map((customer, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customer}
                    onChange={(e) =>
                      updateListItem(currentNicheIndex, 'idealCustomers', i, e.target.value)
                    }
                    className="flex-1 px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-primary focus:border-accent focus:outline-none"
                    placeholder="e.g. People with bad credit scores, first-time home buyers..."
                  />
                  {nicheSetups[currentNicheIndex].idealCustomers.length > 1 && (
                    <button
                      onClick={() => removeListItem(currentNicheIndex, 'idealCustomers', i)}
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
              onClick={() => addListItem(currentNicheIndex, 'idealCustomers')}
              className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add another
            </button>
          </div>

          <button
            onClick={handleNicheNext}
            className="w-full px-4 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
          >
            {currentNicheIndex < nicheSetups.length - 1 ? 'Next Account' : 'Continue to Settings'}
          </button>
        </div>
      )}

      {/* Step 5: Engagement Settings */}
      {step === 5 && (
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
