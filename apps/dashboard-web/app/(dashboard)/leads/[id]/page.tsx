'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import type { QualifiedLead, LeadContact, LeadActivity, OutreachDraft } from '@alh/types';
import { api } from '@/lib/api-client';
import { ScoreBadge } from '@/components/shared/score-badge';
import { StatusChip } from '@/components/shared/status-chip';
import { formatDate, formatRelativeTime } from '@/lib/utils';

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const leadId = Number(id);

  const [lead, setLead] = useState<QualifiedLead | null>(null);
  const [contacts, setContacts] = useState<LeadContact[]>([]);
  const [activity, setActivity] = useState<LeadActivity[]>([]);
  const [outreach, setOutreach] = useState<OutreachDraft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [l, c, a, o] = await Promise.all([
          api.getLead(leadId),
          api.getLeadContacts(leadId),
          api.getLeadActivity(leadId),
          api.getLeadOutreach(leadId),
        ]);
        setLead(l);
        setContacts(c);
        setActivity(a);
        setOutreach(o);
      } catch (err) {
        console.error('Failed to load lead:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [leadId]);

  async function handleApproveOutreach(draftId: number) {
    try {
      const updated = await api.approveOutreach(draftId);
      setOutreach((prev) => prev.map((d) => (d.id === draftId ? updated : d)));
    } catch (err) {
      console.error('Failed to approve:', err);
    }
  }

  async function handleRejectOutreach(draftId: number) {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    try {
      const updated = await api.rejectOutreach(draftId, reason);
      setOutreach((prev) => prev.map((d) => (d.id === draftId ? updated : d)));
    } catch (err) {
      console.error('Failed to reject:', err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading lead...
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-text-muted">Lead not found</p>
        <Link href="/leads" className="text-accent text-sm hover:underline">
          Back to leads
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href="/leads" className="text-xs text-text-muted hover:text-text-secondary mb-2 block">
            &larr; Back to leads
          </Link>
          <h1 className="text-lg font-semibold text-text-primary">
            {lead.fullName || lead.companyName || 'Unknown Lead'}
          </h1>
          <div className="flex items-center gap-3 mt-2">
            <StatusChip status={lead.status} />
            <ScoreBadge score={lead.leadScore} intentLevel={lead.intentLevel} />
            <span className="text-xs text-text-muted capitalize">{lead.platform}</span>
            {lead.city && (
              <span className="text-xs text-text-muted">
                {lead.city}{lead.state ? `, ${lead.state}` : ''}
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-text-muted">
          <p>ID: {lead.id}</p>
          <p>Found: {formatDate(lead.createdAt)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-5">
          {/* AI Summary */}
          <div className="bg-surface-raised border border-border rounded-lg p-5">
            <h2 className="text-sm font-medium text-text-primary mb-3">AI Summary</h2>
            <p className="text-sm text-text-secondary leading-relaxed">{lead.aiSummary}</p>
            {lead.aiRecommendedAction && (
              <div className="mt-3 px-3 py-2 bg-accent/5 border border-accent/10 rounded text-sm text-accent">
                Recommended: {lead.aiRecommendedAction}
              </div>
            )}
          </div>

          {/* Signals */}
          {lead.aiSignalsJson.length > 0 && (
            <div className="bg-surface-raised border border-border rounded-lg p-5">
              <h2 className="text-sm font-medium text-text-primary mb-3">Signals</h2>
              <div className="flex flex-wrap gap-2">
                {lead.aiSignalsJson.map((signal, i) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full bg-surface-overlay border border-border text-text-secondary"
                  >
                    {signal}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Outreach Drafts */}
          {outreach.length > 0 && (
            <div className="bg-surface-raised border border-border rounded-lg p-5">
              <h2 className="text-sm font-medium text-text-primary mb-3">Outreach Drafts</h2>
              <div className="space-y-4">
                {outreach.map((draft) => (
                  <div key={draft.id} className="border border-border-subtle rounded-md p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-muted">v{draft.version}</span>
                        <span className="text-xs text-text-muted capitalize">{draft.channel}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          draft.status === 'pending_review' ? 'bg-warning/10 text-warning' :
                          draft.status === 'approved' ? 'bg-success/10 text-success' :
                          draft.status === 'rejected' ? 'bg-danger/10 text-danger' :
                          draft.status === 'sent' ? 'bg-accent/10 text-accent' :
                          'bg-surface-overlay text-text-muted'
                        }`}>
                          {draft.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <span className="text-xs text-text-muted">{formatRelativeTime(draft.createdAt)}</span>
                    </div>
                    {draft.subject && (
                      <p className="text-sm font-medium text-text-primary mb-1">{draft.subject}</p>
                    )}
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">{draft.body}</p>
                    {draft.status === 'pending_review' && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border-subtle">
                        <button
                          onClick={() => handleApproveOutreach(draft.id)}
                          className="px-3 py-1.5 text-xs font-medium rounded bg-success/15 text-success border border-success/25 hover:bg-success/25 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectOutreach(draft.id)}
                          className="px-3 py-1.5 text-xs font-medium rounded bg-danger/15 text-danger border border-danger/25 hover:bg-danger/25 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {draft.rejectionReason && (
                      <p className="mt-2 text-xs text-danger">Reason: {draft.rejectionReason}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity Timeline */}
          {activity.length > 0 && (
            <div className="bg-surface-raised border border-border rounded-lg p-5">
              <h2 className="text-sm font-medium text-text-primary mb-3">Activity</h2>
              <div className="space-y-3">
                {activity.map((event) => (
                  <div key={event.id} className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-border mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-secondary">
                        <span className="font-medium text-text-primary capitalize">
                          {event.activityType.replace(/_/g, ' ')}
                        </span>
                        {event.description && ` \u2014 ${event.description}`}
                      </p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {formatRelativeTime(event.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Lead Info */}
          <div className="bg-surface-raised border border-border rounded-lg p-5">
            <h2 className="text-sm font-medium text-text-primary mb-3">Details</h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-muted">Type</dt>
                <dd className="text-text-secondary capitalize">{lead.leadType.replace(/_/g, ' ')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">AI Confidence</dt>
                <dd className="text-text-secondary tabular-nums">{lead.aiConfidence ? `${(lead.aiConfidence * 100).toFixed(0)}%` : '\u2014'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">Contact</dt>
                <dd className="text-text-secondary capitalize">{lead.contactType ?? '\u2014'}</dd>
              </div>
              {lead.profileUrl && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">Profile</dt>
                  <dd>
                    <a
                      href={lead.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent text-xs hover:underline truncate block max-w-[160px]"
                    >
                      View source
                    </a>
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-text-muted">Duplicate</dt>
                <dd className="text-text-secondary">{lead.isDuplicate ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </div>

          {/* Contacts */}
          {contacts.length > 0 && (
            <div className="bg-surface-raised border border-border rounded-lg p-5">
              <h2 className="text-sm font-medium text-text-primary mb-3">Contacts</h2>
              <div className="space-y-2">
                {contacts.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted uppercase">{c.contactType}</span>
                      {c.isPrimary && (
                        <span className="text-[10px] text-accent">PRIMARY</span>
                      )}
                    </div>
                    <span className="text-text-secondary truncate max-w-[160px]">{c.contactValue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Score Breakdown */}
          <div className="bg-surface-raised border border-border rounded-lg p-5">
            <h2 className="text-sm font-medium text-text-primary mb-3">Score Breakdown</h2>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Final Score</span>
                  <span className="text-text-primary tabular-nums">{lead.leadScore}/100</span>
                </div>
                <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${lead.leadScore}%` }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Intent Level</span>
                <span className="text-text-secondary capitalize">{lead.intentLevel}</span>
              </div>
              {lead.lastRescoredAt && (
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Last Rescored</span>
                  <span className="text-text-secondary">{formatRelativeTime(lead.lastRescoredAt)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
