'use client';

/**
 * app/components/Settings/ActivityLogPane.tsx
 *
 * "Activity log" category of the Preferences modal (2026-08-18 Account +
 * Settings merge, prototyped in architecture/layout/Layout-Workbench.html per
 * CLAUDE.md standing rule 4). Visible to EVERY authenticated user, unlike the
 * other two Settings-derived panes — the whole point of this category split is
 * that a regular user can now see their own calls too (roadmap's "Per-user view
 * of the activity log" item, closed same day). Scoping happens server-side
 * (GET /api/llm-call-log forces userId to the caller for non-admins) — this
 * component just renders whatever it's handed and adds a User column only for
 * `isAdmin` (regular user's own rows would all show the same email, which adds
 * nothing).
 *
 * Same click-to-expand-for-payload behavior as the pre-redesign SettingsView.tsx
 * grid this replaces, including the §5.6 redacted-content case. Two deliberate
 * differences from the admin view: the "Permalink" link is admin-only — it points
 * at `/settings?log=id`, which is still an admin-gated full page, so surfacing it
 * to a non-admin would be a dead link, not a smaller feature. And the raw "Request
 * payload" block is admin-only too (2026-08-18) — it's the literal API request
 * body, which embeds the full agent definition text (system prompt) sent to the
 * provider; not something to expose to the owning user yet. Response payload
 * (the AI's reply) stays visible to everyone — it's just what they already got
 * back in the chat.
 */

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import {
  PAGE_SIZE, Pager, formatTs, copyPayloadFormatted, kindLabel, deriveStatus, statusClass,
} from './prefsShared';

type FilterMode = 'all' | 'dry-run' | 'live';

interface LogListItem {
  id: string;
  kind: string;
  agentId: string | null;
  agentLabel: string | null;
  dryRun: boolean;
  model: string;
  error: string | null;
  durationMs: number;
  userId: string | null;
  userEmail: string | null;
  redacted: boolean;
  createdAt: string;
}

interface LogFull extends LogListItem {
  requestPayload: unknown;
  responsePayload: unknown;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export function ActivityLogPane({ isAdmin }: { isAdmin: boolean }) {
  const [entries, setEntries] = useState<LogListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedPayload, setExpandedPayload] = useState<LogFull | null>(null);
  const [loadingPayload, setLoadingPayload] = useState(false);

  useEffect(() => {
    apiFetch('/api/llm-call-log?limit=200')
      .then(async (res) => {
        if (!res.ok) throw new Error('llm-call-log');
        const body = await res.json() as { entries: LogListItem[] };
        setEntries(body.entries);
      })
      .catch(() => setError('Failed to load activity log.'));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  async function handleRowExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedPayload(null);
      return;
    }
    setExpandedId(id);
    setLoadingPayload(true);
    try {
      const res = await apiFetch(`/api/llm-call-log/${id}`);
      setExpandedPayload(res.ok ? (await res.json() as LogFull) : null);
    } catch {
      setExpandedPayload(null);
    } finally {
      setLoadingPayload(false);
    }
  }

  if (error) return <p className="p-6 text-[12px] text-[var(--err)]">{error}</p>;
  if (!entries) return <p className="p-6 text-[12px] text-[var(--faint)]">Loading…</p>;

  const filtered = entries.filter((e) => {
    if (filter === 'dry-run') return e.dryRun;
    if (filter === 'live') return !e.dryRun;
    return true;
  });
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const colSpan = isAdmin ? 7 : 6;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-[var(--text)]">
          Activity log
          <span className="font-normal text-[var(--faint)] text-[11px] ml-2">
            {isAdmin ? '— all users' : '— your calls'}
          </span>
        </h2>
        <div className="flex gap-1">
          {(['all', 'dry-run', 'live'] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={[
                'text-[12px] px-3 py-[4px] rounded-[6px] border transition-colors cursor-pointer',
                filter === f
                  ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                  : 'bg-[var(--bg)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              {f === 'all' ? 'All' : f === 'dry-run' ? 'Dry-run' : 'Live'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-[13px] text-[var(--faint)] py-8 text-center">
          No log entries{filter !== 'all' ? ` matching "${filter}"` : ''}.
        </p>
      ) : (
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                {isAdmin && <th className="px-3 py-2 text-[var(--muted)] font-medium">User</th>}
                <th className="px-3 py-2 text-[var(--muted)] font-medium w-40">Timestamp</th>
                <th className="px-3 py-2 text-[var(--muted)] font-medium">Kind</th>
                <th className="px-3 py-2 text-[var(--muted)] font-medium">Agent</th>
                <th className="px-3 py-2 text-[var(--muted)] font-medium w-20">Status</th>
                <th className="px-3 py-2 text-[var(--muted)] font-medium whitespace-nowrap">Model</th>
                <th className="px-3 py-2 text-[var(--muted)] font-medium w-20 text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((entry) => {
                const status = deriveStatus(entry);
                const isExpanded = entry.id === expandedId;

                return (
                  <Fragment key={entry.id}>
                    <tr
                      onClick={() => handleRowExpand(entry.id)}
                      className={[
                        'border-b border-[var(--border)] cursor-pointer transition-colors',
                        isExpanded ? 'bg-[var(--bg)]' : 'hover:bg-[var(--bg)]',
                      ].join(' ')}
                    >
                      {isAdmin && (
                        <td className="px-3 py-2 text-[var(--muted)] max-w-[180px] truncate">
                          {entry.userEmail ?? (entry.userId ? entry.userId : '—')}
                        </td>
                      )}
                      <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap">
                        {formatTs(entry.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-[var(--text)]">{kindLabel(entry.kind)}</td>
                      <td className="px-3 py-2 text-[var(--text)] max-w-[160px] truncate">
                        {entry.agentId ? (
                          <Link
                            href={`/agents/${entry.agentId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[var(--accent)] hover:underline"
                          >
                            {entry.agentLabel ?? entry.agentId}
                          </Link>
                        ) : (
                          <span className="text-[var(--muted)]">{entry.agentLabel ?? '—'}</span>
                        )}
                      </td>
                      <td className={['px-3 py-2 font-medium', statusClass(status)].join(' ')}>
                        {status}
                        {entry.redacted && (
                          <span
                            className="ml-1 text-[10px] text-[var(--faint)] font-normal"
                            title="This user has not consented to sharing their prompt content."
                          >
                            🔒
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[var(--muted)] font-mono whitespace-nowrap">{entry.model}</td>
                      <td className="px-3 py-2 text-[var(--muted)] text-right whitespace-nowrap">
                        {entry.durationMs}ms
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${entry.id}-expand`} className="bg-[var(--bg)]">
                        <td colSpan={colSpan} className="px-4 py-3">
                          {loadingPayload && expandedPayload === null ? (
                            <p className="text-[12px] text-[var(--faint)]">Loading…</p>
                          ) : expandedPayload && expandedPayload.id === entry.id ? (
                            <div className="space-y-3">
                              {expandedPayload.redacted && (
                                <div className="bg-[var(--elev)] border border-[var(--border)] rounded-[6px] px-3 py-2">
                                  <p className="text-[12px] font-medium text-[var(--muted)] flex items-center gap-2">
                                    <span>🔒</span>
                                    <span>Content hidden</span>
                                  </p>
                                  <p className="text-[11px] text-[var(--faint)] mt-1">
                                    This user has not consented to sharing their prompt and response
                                    content with the admin. You can see metadata (agent, model,
                                    tokens, duration) but not the text of their instructions or the
                                    AI&apos;s replies.
                                  </p>
                                </div>
                              )}
                              {expandedPayload.error && (
                                <div>
                                  <p className="text-[11px] font-medium text-[var(--err)] mb-1">Error</p>
                                  <pre className="text-[11px] text-[var(--text)] bg-[var(--panel)] border border-[var(--border)] rounded-[6px] p-2 overflow-x-auto whitespace-pre-wrap">
                                    {expandedPayload.error}
                                  </pre>
                                </div>
                              )}
                              {isAdmin && !expandedPayload.redacted && (
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-[11px] font-medium text-[var(--muted)]">Request payload</p>
                                    <button
                                      onClick={() => copyPayloadFormatted(expandedPayload.requestPayload)}
                                      className="text-[11px] text-[var(--accent-ink)] hover:underline"
                                    >
                                      Copy
                                    </button>
                                  </div>
                                  <pre className="text-[11px] text-[var(--text)] bg-[var(--panel)] border border-[var(--border)] rounded-[6px] p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
                                    {JSON.stringify(expandedPayload.requestPayload, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {!expandedPayload.redacted && (
                                expandedPayload.responsePayload ? (
                                  <div>
                                    <div className="flex items-center justify-between mb-1">
                                      <p className="text-[11px] font-medium text-[var(--muted)]">Response payload</p>
                                      <button
                                        onClick={() => copyPayloadFormatted(expandedPayload.responsePayload)}
                                        className="text-[11px] text-[var(--accent-ink)] hover:underline"
                                      >
                                        Copy
                                      </button>
                                    </div>
                                    <pre className="text-[11px] text-[var(--text)] bg-[var(--panel)] border border-[var(--border)] rounded-[6px] p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
                                      {JSON.stringify(expandedPayload.responsePayload, null, 2)}
                                    </pre>
                                  </div>
                                ) : (
                                  <p className="text-[12px] text-[var(--faint)]">
                                    {expandedPayload.dryRun
                                      ? 'No response — call was blocked (dry-run).'
                                      : 'No response payload.'}
                                  </p>
                                )
                              )}
                              {expandedPayload.usage && (
                                <p className="text-[11px] text-[var(--muted)]">
                                  Tokens: {expandedPayload.usage.inputTokens} in / {expandedPayload.usage.outputTokens} out
                                </p>
                              )}
                              <p className="text-[11px] text-[var(--faint)]">
                                ID: <span className="font-mono">{expandedPayload.id}</span>
                                {isAdmin && (
                                  <>
                                    {' · '}
                                    <Link
                                      href={`/settings?log=${expandedPayload.id}`}
                                      className="text-[var(--accent)] hover:underline"
                                    >
                                      Permalink
                                    </Link>
                                  </>
                                )}
                              </p>
                            </div>
                          ) : (
                            <p className="text-[12px] text-[var(--faint)]">Could not load entry.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      <p className="text-[11px] text-[var(--faint)] mt-2 text-right">
        Showing {filtered.length} of {entries.length} fetched entries (limit 200).
      </p>
    </div>
  );
}
