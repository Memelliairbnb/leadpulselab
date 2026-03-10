'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface VideoJob {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  duration: number;
  music_genre: string;
  output_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  pending: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Pending' },
  processing: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Processing' },
  completed: { color: 'text-green-400', bg: 'bg-green-400/10', label: 'Completed' },
  failed: { color: 'text-red-400', bg: 'bg-red-400/10', label: 'Failed' },
};

export default function VideoPage() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/proxy/video');
      if (!res.ok) throw new Error('Failed to load video jobs');
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Poll every 5 seconds while any job is in a non-terminal state
  useEffect(() => {
    const hasActiveJobs = jobs.some(
      (j) => j.status === 'pending' || j.status === 'processing'
    );
    if (!hasActiveJobs) return;

    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [jobs, fetchJobs]);

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading video jobs...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Video Processing</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Create and manage AI-generated marketing videos
          </p>
        </div>
        <Link
          href="/video/new"
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
        >
          Process New Video
        </Link>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Summary Stats */}
      {jobs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
            <p className="text-xs text-text-muted uppercase tracking-wider">Total Jobs</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-text-primary">{jobs.length}</p>
            <p className="text-xs mt-1 text-text-muted">All time</p>
          </div>
          <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
            <p className="text-xs text-text-muted uppercase tracking-wider">Completed</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-green-400">
              {jobs.filter((j) => j.status === 'completed').length}
            </p>
            <p className="text-xs mt-1 text-text-muted">Ready to download</p>
          </div>
          <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
            <p className="text-xs text-text-muted uppercase tracking-wider">Processing</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-blue-400">
              {jobs.filter((j) => j.status === 'processing' || j.status === 'pending').length}
            </p>
            <p className="text-xs mt-1 text-text-muted">In progress</p>
          </div>
          <div className="bg-surface-raised border border-border rounded-lg px-5 py-4">
            <p className="text-xs text-text-muted uppercase tracking-wider">Failed</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums text-red-400">
              {jobs.filter((j) => j.status === 'failed').length}
            </p>
            <p className="text-xs mt-1 text-text-muted">Need attention</p>
          </div>
        </div>
      )}

      {/* Job Cards */}
      {jobs.length === 0 ? (
        <div className="bg-surface-raised border border-border rounded-lg p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-overlay flex items-center justify-center">
            <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <polygon points="23 7 16 12 23 17 23 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-text-primary mb-1">No video jobs yet</h3>
          <p className="text-xs text-text-muted mb-4">
            Process your first video to create AI-generated marketing content.
          </p>
          <Link
            href="/video/new"
            className="inline-flex px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
          >
            Process New Video
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {jobs.map((job) => {
            const sc = statusConfig[job.status] ?? statusConfig.pending;
            return (
              <div
                key={job.id}
                className="bg-surface-raised border border-border rounded-lg overflow-hidden"
              >
                {/* Video Preview / Placeholder */}
                <div className="aspect-video bg-surface-overlay flex items-center justify-center relative">
                  {job.status === 'completed' && job.output_url ? (
                    <video
                      src={job.output_url}
                      controls
                      className="w-full h-full object-cover"
                      preload="metadata"
                    />
                  ) : job.status === 'processing' || job.status === 'pending' ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-text-muted">
                        {job.status === 'pending' ? 'Queued...' : 'Processing...'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      <span className="text-xs text-red-400">Failed</span>
                    </div>
                  )}
                </div>

                {/* Card Details */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${job.status === 'completed' ? 'bg-green-400' : job.status === 'failed' ? 'bg-red-400' : job.status === 'processing' ? 'bg-blue-400' : 'bg-yellow-400'}`} />
                      {sc.label}
                    </span>
                    <span className="text-xs text-text-muted">#{job.id}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-text-muted">Duration</p>
                      <p className="text-sm font-medium text-text-primary tabular-nums">{job.duration}s</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">Music</p>
                      <p className="text-sm font-medium text-text-primary capitalize">{job.music_genre}</p>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border-subtle">
                    <p className="text-xs text-text-muted">{formatDate(job.created_at)}</p>
                  </div>

                  {job.status === 'failed' && job.error_message && (
                    <div className="bg-red-500/10 rounded px-3 py-2">
                      <p className="text-xs text-red-400 line-clamp-2">{job.error_message}</p>
                    </div>
                  )}

                  {job.status === 'completed' && job.output_url && (
                    <a
                      href={job.output_url}
                      download
                      className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-accent/10 hover:bg-accent/20 text-accent text-sm font-medium rounded-md transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download Video
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
