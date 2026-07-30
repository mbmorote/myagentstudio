'use client';

/**
 * app/components/Settings/SettingsView.tsx
 *
 * Client component: the Settings page body (Plan 04 Phase 4.4, §5.4).
 *
 * Sections:
 *   1. Settings panel — toggle(s) rendered from the settings array
 *   2. Activity log — Dry-run / Live / All filter, table of log entries,
 *      row expand for payloads, ?log=<id> highlight + scroll
 *
 * Status column is derived (§11, Phase 4 note):
 *   dryRun=true → "Dry-run"
 *   error non-null → "Error"
 *   else → "OK"
 *
 * The toggle calls PATCH /api/settings directly (no page reload needed — §6 §8.18).
 * The next gateway call reads the fresh DB value without a restart.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CallLogListItem, CallLogFull } from '@/lib/db/repository';

// ── Types ──────────────────────────────────────────────────────────────────────

type SettingEntry = {
  key: string;
  label: string;
  hint: string;
  datatype: string;
  value: boolean | number | string;
  isDefault: boolean;
  updatedAt: string | null;
};

// createdAt is serialized to ISO string for JSON transport; use Omit to replace the Date type.
type LogListItem = Omit<CallLogListItem, 'createdAt'> & { createdAt: string };
type LogFull = Omit<CallLogFull, 'createdAt'> & { createdAt: string };

type FilterMode = 'all' | 'dry-run' | 'live';

interface SettingsViewProps {
  settings: SettingEntry[];
  entries: LogListItem[];
  highlightId: string | null;
  highlightEntry: LogFull | null;
}

// ── Derived status ─────────────────────────────────────────────────────────────

function deriveStatus(entry: LogListItem): 'Dry-run' | 'Error' | 'OK' {
  if (entry.dryRun) return 'Dry-run';
  if (entry.error) return 'Error';
  return 'OK';
}

function statusClass(status: 'Dry-run' | 'Error' | 'OK'): string {
  if (status === 'Dry-run') return 'text-[var(--warn)]';
  if (status === 'Error') return 'text-[var(--err)]';
  return 'text-[var(--ok)]';
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'import-strict': return 'Import (strict)';
    case 'import-structural': return 'Import (structural)';
    case 'chat': return 'Chat';
    default: return kind;
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SettingsView({
  settings,
  entries,
  highlightId,
  highlightEntry,
}: SettingsViewProps) {
  const router = useRouter();
  const [localSettings, setLocalSettings] = useState<SettingEntry[]>(settings);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [expandedId, setExpandedId] = useState<string | null>(highlightId);
  const [expandedPayload, setExpandedPayload] = useState<LogFull | null>(highlightEntry);
  const [loadingPayload, setLoadingPayload] = useState(false);
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  // Scroll to highlighted row on first paint
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // ── Toggle handler ───────────────────────────────────────────────────────────

  async function handleToggle(key: string, current: boolean) {
    const newValue = !current;
    // Optimistic update
    setLocalSettings((prev) =>
      prev.map((s) =>
        s.key === key ? { ...s, value: newValue, isDefault: false } : s,
      ),
    );
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: newValue }),
      });
      if (!res.ok) {
        // Revert on failure
        setLocalSettings((prev) =>
          prev.map((s) => (s.key === key ? { ...s, value: current } : s)),
        );
        console.error('[settings] PATCH failed:', await res.text());
      } else {
        // Refresh so the page shows the stored updatedAt
        router.refresh();
      }
    } catch (err) {
      // Revert on network error
      setLocalSettings((prev) =>
        prev.map((s) => (s.key === key ? { ...s, value: current } : s)),
      );
      console.error('[settings] PATCH error:', err);
    }
  }

  // ── Row expand ───────────────────────────────────────────────────────────────

  async function handleRowExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedPayload(null);
      return;
    }
    setExpandedId(id);
    // If we already have the payload from the ?log= param, reuse it
    if (highlightEntry && highlightEntry.id === id) {
      setExpandedPayload(highlightEntry);
      return;
    }
    setLoadingPayload(true);
    try {
      const res = await fetch(`/api/llm-call-log/${id}`);
      if (res.ok) {
        setExpandedPayload(await res.json() as LogFull);
      } else {
        setExpandedPayload(null);
      }
    } catch {
      setExpandedPayload(null);
    } finally {
      setLoadingPayload(false);
    }
  }

  // ── Filter entries ───────────────────────────────────────────────────────────

  const filtered = entries.filter((e) => {
    if (filter === 'dry-run') return e.dryRun;
    if (filter === 'live') return !e.dryRun;
    return true;
  });

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8">
      {/* Back link */}
      <div>
        <Link
          href="/"
          className="text-[13px] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
        >
          ← Back to Workbench
        </Link>
      </div>

      {/* ── Settings panel ──────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Settings</h2>
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] divide-y divide-[var(--border)]">
          {localSettings.map((s) => (
            <div key={s.key} className="flex items-start gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-[var(--text)]">{s.label}</span>
                  {s.isDefault && (
                    <span className="text-[11px] text-[var(--faint)]">(default)</span>
                  )}
                </div>
                <p className="text-[12px] text-[var(--muted)] mt-[2px]">{s.hint}</p>
                {s.updatedAt && (
                  <p className="text-[11px] text-[var(--faint)] mt-[2px]">
                    Updated {formatTs(s.updatedAt)}
                  </p>
                )}
              </div>
              {/* Bool toggle */}
              {s.datatype === 'bool' && (
                <button
                  onClick={() => handleToggle(s.key, s.value as boolean)}
                  className={[
                    'flex-none w-10 h-6 rounded-full border transition-colors cursor-pointer',
                    s.value
                      ? 'bg-[var(--accent)] border-[var(--accent)]'
                      : 'bg-[var(--bg)] border-[var(--border)]',
                  ].join(' ')}
                  title={s.value ? 'On — click to turn off' : 'Off — click to turn on'}
                >
                  <span
                    className={[
                      'block w-4 h-4 rounded-full bg-white shadow transition-transform mt-[3px]',
                      s.value ? 'translate-x-[18px]' : 'translate-x-[3px]',
                    ].join(' ')}
                  />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Activity log ────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-[var(--text)]">Activity log</h2>
          {/* Filter buttons */}
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
                  <th className="px-3 py-2 text-[var(--muted)] font-medium w-40">Timestamp</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Kind</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Agent</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium w-20">Status</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Model</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium w-20 text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const status = deriveStatus(entry);
                  const isHighlight = entry.id === highlightId;
                  const isExpanded = entry.id === expandedId;

                  return (
                    <>
                      <tr
                        key={entry.id}
                        ref={isHighlight ? highlightRef : undefined}
                        onClick={() => handleRowExpand(entry.id)}
                        className={[
                          'border-b border-[var(--border)] cursor-pointer transition-colors',
                          isHighlight ? 'bg-[var(--accent-wash)]' : 'hover:bg-[var(--bg)]',
                          isExpanded ? 'bg-[var(--bg)]' : '',
                        ].join(' ')}
                      >
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
                            <span className="text-[var(--muted)]">
                              {entry.agentLabel ?? '—'}
                            </span>
                          )}
                        </td>
                        <td className={['px-3 py-2 font-medium', statusClass(status)].join(' ')}>
                          {status}
                        </td>
                        <td className="px-3 py-2 text-[var(--muted)] font-mono">{entry.model}</td>
                        <td className="px-3 py-2 text-[var(--muted)] text-right whitespace-nowrap">
                          {entry.durationMs}ms
                        </td>
                      </tr>

                      {/* Expanded payload row */}
                      {isExpanded && (
                        <tr key={`${entry.id}-expand`} className="bg-[var(--bg)]">
                          <td colSpan={6} className="px-4 py-3">
                            {loadingPayload && expandedPayload === null ? (
                              <p className="text-[12px] text-[var(--faint)]">Loading…</p>
                            ) : expandedPayload && expandedPayload.id === entry.id ? (
                              <div className="space-y-3">
                                {/* Error row */}
                                {expandedPayload.error && (
                                  <div>
                                    <p className="text-[11px] font-medium text-[var(--err)] mb-1">Error</p>
                                    <pre className="text-[11px] text-[var(--text)] bg-[var(--panel)] border border-[var(--border)] rounded-[6px] p-2 overflow-x-auto whitespace-pre-wrap">
                                      {expandedPayload.error}
                                    </pre>
                                  </div>
                                )}
                                {/* Request payload */}
                                <div>
                                  <p className="text-[11px] font-medium text-[var(--muted)] mb-1">Request payload</p>
                                  <pre className="text-[11px] text-[var(--text)] bg-[var(--panel)] border border-[var(--border)] rounded-[6px] p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
                                    {JSON.stringify(expandedPayload.requestPayload, null, 2)}
                                  </pre>
                                </div>
                                {/* Response payload */}
                                {expandedPayload.responsePayload ? (
                                  <div>
                                    <p className="text-[11px] font-medium text-[var(--muted)] mb-1">Response payload</p>
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
                                )}
                                {/* Usage */}
                                {expandedPayload.usage && (
                                  <p className="text-[11px] text-[var(--muted)]">
                                    Tokens: {expandedPayload.usage.inputTokens} in / {expandedPayload.usage.outputTokens} out
                                  </p>
                                )}
                                {/* Deep link */}
                                <p className="text-[11px] text-[var(--faint)]">
                                  ID: <span className="font-mono">{expandedPayload.id}</span>
                                  {' · '}
                                  <Link
                                    href={`/settings?log=${expandedPayload.id}`}
                                    className="text-[var(--accent)] hover:underline"
                                  >
                                    Permalink
                                  </Link>
                                </p>
                              </div>
                            ) : (
                              <p className="text-[12px] text-[var(--faint)]">Could not load entry.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-[var(--faint)] mt-2 text-right">
          Showing {filtered.length} of {entries.length} entries (limit 200).
        </p>
      </section>
    </div>
  );
}
