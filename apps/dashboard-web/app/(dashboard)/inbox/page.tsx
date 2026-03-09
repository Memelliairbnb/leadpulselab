'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';

interface Conversation {
  id: number;
  leadName: string;
  leadCompany: string | null;
  lastMessagePreview: string;
  unreadCount: number;
  needsReply: boolean;
  hasPendingDraft: boolean;
  updatedAt: string;
}

interface Message {
  id: number;
  direction: 'inbound' | 'outbound';
  body: string;
  channel: string;
  createdAt: string;
  isAiDraft: boolean;
  draftId?: number;
  status: string;
}

type FilterMode = 'all' | 'unread' | 'needs_reply' | 'ai_draft';

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const filters: Record<string, any> = {};
      if (filter === 'unread') filters.unread = true;
      if (filter === 'needs_reply') filters.needsReply = true;
      if (filter === 'ai_draft') filters.hasPendingDraft = true;
      const res = await api.getConversations(filters);
      setConversations(res.data ?? res.items ?? res ?? []);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const selectConversation = async (id: number) => {
    setSelectedId(id);
    setReplyText('');
    try {
      const res = await api.getConversationMessages(id);
      setMessages(res.data ?? res.items ?? res ?? []);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
      setMessages([]);
    }
  };

  const handleSendReply = async () => {
    if (!selectedId || !replyText.trim()) return;
    setSending(true);
    try {
      await api.sendReply(selectedId, replyText.trim());
      setReplyText('');
      await selectConversation(selectedId);
      await fetchConversations();
    } catch (err) {
      console.error('Failed to send reply:', err);
    } finally {
      setSending(false);
    }
  };

  const handleApproveDraft = async (draftId: number) => {
    if (!selectedId) return;
    try {
      await api.approveAiDraft(selectedId, draftId);
      await selectConversation(selectedId);
      await fetchConversations();
    } catch (err) {
      console.error('Failed to approve draft:', err);
    }
  };

  const filters: { key: FilterMode; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'needs_reply', label: 'Needs Reply' },
    { key: 'ai_draft', label: 'AI Drafts' },
  ];

  const selectedConversation = conversations.find((c) => c.id === selectedId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Inbox</h1>
        <p className="text-sm text-text-muted mt-0.5">Conversations and message management</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === f.key
                ? 'bg-accent/15 text-accent'
                : 'bg-surface-overlay text-text-secondary hover:text-text-primary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-4 h-[calc(100vh-240px)]">
        {/* Left: Conversation List */}
        <div className="w-96 flex-shrink-0 bg-surface-raised border border-border rounded-lg overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-text-muted text-sm">
              Loading...
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-text-muted text-sm">
              No conversations
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  className={cn(
                    'w-full px-4 py-3 text-left hover:bg-surface-overlay transition-colors',
                    selectedId === conv.id && 'bg-surface-overlay'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn(
                      'text-sm font-medium truncate',
                      conv.unreadCount > 0 ? 'text-text-primary' : 'text-text-secondary'
                    )}>
                      {conv.leadName}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {conv.unreadCount > 0 && (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white text-xs font-medium tabular-nums">
                          {conv.unreadCount}
                        </span>
                      )}
                      {conv.hasPendingDraft && (
                        <span className="w-2 h-2 rounded-full bg-warning" title="AI draft pending" />
                      )}
                    </div>
                  </div>
                  {conv.leadCompany && (
                    <p className="text-xs text-text-muted truncate">{conv.leadCompany}</p>
                  )}
                  <p className="text-xs text-text-muted truncate mt-1">{conv.lastMessagePreview}</p>
                  <p className="text-xs text-text-muted mt-1">{formatRelativeTime(conv.updatedAt)}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Message Thread */}
        <div className="flex-1 bg-surface-raised border border-border rounded-lg flex flex-col">
          {!selectedConversation ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Select a conversation to view messages
            </div>
          ) : (
            <>
              {/* Thread Header */}
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">{selectedConversation.leadName}</p>
                  {selectedConversation.leadCompany && (
                    <p className="text-xs text-text-muted">{selectedConversation.leadCompany}</p>
                  )}
                </div>
                {selectedConversation.needsReply && (
                  <span className="text-xs bg-warning/10 text-warning border border-warning/20 px-2 py-0.5 rounded font-medium">
                    Needs Reply
                  </span>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {messages.length === 0 ? (
                  <p className="text-xs text-text-muted text-center py-8">No messages yet</p>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'max-w-[80%] rounded-lg p-3',
                        msg.direction === 'outbound'
                          ? 'ml-auto bg-accent/10 border border-accent/20'
                          : 'bg-surface-overlay border border-border-subtle',
                        msg.isAiDraft && 'border-warning/30 bg-warning/5'
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-muted">
                          {msg.direction === 'outbound' ? 'You' : selectedConversation.leadName}
                          {msg.isAiDraft && ' (AI Draft)'}
                        </span>
                        <span className="text-xs text-text-muted">
                          {formatRelativeTime(msg.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-text-primary whitespace-pre-wrap">{msg.body}</p>
                      {msg.isAiDraft && msg.draftId && (
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => handleApproveDraft(msg.draftId!)}
                            className="px-3 py-1 bg-success/15 text-success text-xs font-medium rounded hover:bg-success/25 transition-colors"
                          >
                            Approve & Send
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Reply Input */}
              <div className="px-5 py-3 border-t border-border">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendReply();
                      }
                    }}
                    placeholder="Type a reply..."
                    className="flex-1 bg-surface-overlay border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent"
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={sending || !replyText.trim()}
                    className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                  >
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
