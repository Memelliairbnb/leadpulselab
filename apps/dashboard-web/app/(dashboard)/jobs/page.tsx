'use client';

import { useState } from 'react';

const jobTypes = [
  { type: 'source_scan', label: 'Source Scan', description: 'Fetch new data from platform sources' },
  { type: 'ai_analysis', label: 'AI Analysis', description: 'Classify and score raw leads with Claude' },
  { type: 'dedupe_sweep', label: 'Dedup Sweep', description: 'Find and flag duplicate leads' },
  { type: 'rescore', label: 'Rescore', description: 'Recalculate scores with updated weights' },
  { type: 'outreach_gen', label: 'Outreach Gen', description: 'Generate outreach drafts for qualified leads' },
  { type: 'stale_archive', label: 'Stale Archive', description: 'Auto-archive stale leads past threshold' },
  { type: 'health_check', label: 'Health Check', description: 'Verify source connectivity and API keys' },
  { type: 'enrichment', label: 'Enrichment', description: 'Enrich leads with additional data points' },
];

export default function JobsPage() {
  const [triggering, setTriggering] = useState<string | null>(null);

  async function handleTrigger(jobType: string) {
    setTriggering(jobType);
    try {
      await fetch('/api/proxy/jobs/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobType }),
      });
    } catch (err) {
      console.error('Failed to trigger job:', err);
    } finally {
      setTriggering(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Jobs</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Background job types and manual triggers
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {jobTypes.map((job) => (
          <div
            key={job.type}
            className="bg-surface-raised border border-border rounded-lg p-5 flex flex-col"
          >
            <h3 className="text-sm font-medium text-text-primary">{job.label}</h3>
            <p className="text-xs text-text-muted mt-1.5 leading-relaxed flex-1">
              {job.description}
            </p>
            <button
              onClick={() => handleTrigger(job.type)}
              disabled={triggering === job.type}
              className="mt-4 w-full px-3 py-1.5 text-xs font-medium rounded-md border border-border text-text-secondary hover:bg-surface-overlay disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {triggering === job.type ? 'Triggering...' : 'Run Now'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
