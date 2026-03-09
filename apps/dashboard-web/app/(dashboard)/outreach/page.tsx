'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { OutreachDraft, QualifiedLead } from '@alh/types';
import { api } from '@/lib/api-client';
import { ScoreBadge } from '@/components/shared/score-badge';
import { formatRelativeTime } from '@/lib/utils';

type DraftWithLead = OutreachDraft & { lead?: QualifiedLead };

export default function OutreachPage() {
  const [drafts, setDrafts] = useState<DraftWithLead[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPendingOutreach();
      setDrafts(res.data);
    } catch (err) {
      console.error('Failed to fetch outreach:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  async function handleApprove(id: number) {
    try {
      await api.approveOutreach(id);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error('Failed to approve:', err);
    }
  }

  async function handleReject(id: number) {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    try {
      await api.rejectOutreach(id, reason);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error('Failed to reject:', err);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Outreach Queue</h1>
        <p className="text-sm text-text-muted mt-0.5">
          {loading ? 'Loading...' : `${drafts.length} drafts pending review`}
        </p>
      </div>

      {drafts.length === 0 && !loading && (
        <div className="bg-surface-raised border border-border rounded-lg p-12 text-center">
          <p className="text-text-muted text-sm">No outreach drafts pending review</p>
        </div>
      )}

      <div className="space-y-4">
        {drafts.map((draft) => (
          <div
            key={draft.id}
            className="bg-surface-raised border border-border rounded-lg p-5"
          >
            {/* Lead context header */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-border-subtle">
              <div className="flex items-center gap-3">
                {draft.lead ? (
                  <>
                    <Link
                      href={`/leads/${draft.lead.id}`}
                      className="text-sm font-medium text-text-primary hover:text-accent transition-colors"
                    >
                      {draft.lead.fullName || draft.lead.companyName || `Lead #${draft.leadId}`}
                    </Link>
                    <ScoreBadge score={draft.lead.leadScore} intentLevel={draft.lead.intentLevel} />
                    <span className="text-xs text-text-muted capitalize">{draft.lead.platform}</span>
                  </>
                ) : (
                  <Link
                    href={`/leads/${draft.leadId}`}
                    className="text-sm font-medium text-text-primary hover:text-accent"
                  >
                    Lead #{draft.leadId}
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="capitalize">{draft.channel}</span>
                <span>v{draft.version}</span>
                <span>{formatRelativeTime(draft.createdAt)}</span>
              </div>
            </div>

            {/* Draft content */}
            {draft.subject && (
              <p className="text-sm font-medium text-text-primary mb-2">
                Subject: {draft.subject}
              </p>
            )}
            <div className="bg-surface rounded-md border border-border-subtle p-4 mb-4">
              <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                {draft.body}
              </p>
            </div>

            {/* AI context */}
            {draft.lead?.aiSummary && (
              <p className="text-xs text-text-muted mb-4 line-clamp-2">
                Context: {draft.lead.aiSummary}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleApprove(draft.id)}
                className="px-4 py-2 text-sm font-medium rounded-md bg-success/15 text-success border border-success/25 hover:bg-success/25 transition-colors"
              >
                Approve &amp; Queue
              </button>
              <button
                onClick={() => handleReject(draft.id)}
                className="px-4 py-2 text-sm font-medium rounded-md bg-danger/15 text-danger border border-danger/25 hover:bg-danger/25 transition-colors"
              >
                Reject
              </button>
              <Link
                href={`/leads/${draft.leadId}`}
                className="px-4 py-2 text-sm text-text-muted hover:text-text-secondary transition-colors"
              >
                View Lead
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
