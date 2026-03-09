'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const PLATFORMS = [
  { value: 'reddit', label: 'Reddit' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'twitter', label: 'Twitter / X' },
  { value: 'manual', label: 'Manual' },
];

interface FormData {
  fullName: string;
  email: string;
  phone: string;
  platform: string;
  sourceUrl: string;
  rawText: string;
  notes: string;
}

const emptyForm: FormData = {
  fullName: '',
  email: '',
  phone: '',
  platform: 'manual',
  sourceUrl: '',
  rawText: '',
  notes: '',
};

export default function NewLeadPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function update(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.fullName.trim() && !form.email.trim()) {
      setError('Please provide at least a name or email.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/proxy/leads/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Request failed: ${res.status}`);
      }

      setSuccess(true);
      setForm(emptyForm);
      setTimeout(() => router.push('/leads'), 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to create lead');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'w-full bg-surface-overlay border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors';
  const labelClass = 'block text-xs font-medium text-text-secondary mb-1.5';

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Add Lead</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Manually enter a lead for AI analysis
          </p>
        </div>
        <Link
          href="/leads"
          className="text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          Back to Leads
        </Link>
      </div>

      {success && (
        <div className="bg-green-900/20 border border-green-700/30 rounded-md px-4 py-3 text-sm text-green-400">
          Lead created and queued for AI analysis. Redirecting...
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-md px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-surface-raised border border-border rounded-lg p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass}>Full Name</label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              placeholder="John Doe"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Platform</label>
            <select
              value={form.platform}
              onChange={(e) => update('platform', e.target.value)}
              className={inputClass}
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="john@example.com"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="(555) 123-4567"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Source URL</label>
          <input
            type="url"
            value={form.sourceUrl}
            onChange={(e) => update('sourceUrl', e.target.value)}
            placeholder="https://reddit.com/r/creditrepair/comments/..."
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Raw Text</label>
          <textarea
            value={form.rawText}
            onChange={(e) => update('rawText', e.target.value)}
            placeholder="Paste what they posted or said... AI will analyze this for intent signals."
            rows={5}
            className={inputClass + ' resize-y'}
          />
          <p className="text-xs text-text-muted mt-1">
            This is the content AI will analyze for buying signals, intent, and lead scoring.
          </p>
        </div>

        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            placeholder="Any additional context..."
            rows={2}
            className={inputClass + ' resize-y'}
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating...' : 'Create Lead'}
          </button>
          <Link
            href="/leads"
            className="px-5 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
