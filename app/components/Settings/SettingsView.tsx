'use client';

/**
 * app/components/Settings/SettingsView.tsx
 *
 * Client component: the System Settings page body (Plan 04 Phase 4.4, §5.4).
 *
 * Plan 05 Phase 4.5 additions:
 *   - Int setting fields (maxUsers, maxLlmCallsPerUserPerHour) with inline
 *     number inputs and save-on-blur / Enter.
 *   - Invite-code panel: list, generate, revoke (admin-only, §7.1).
 *   - Redacted-row treatment in the activity log: rows with `redacted: true`
 *     show a "content hidden" affordance in the list; the detail view shows
 *     a privacy notice instead of payload content (§5.6).
 *
 * Sections:
 *   1. Settings panel — bool toggles + int number inputs
 *   2. Invite codes — generate, list (unredeemed + redeemed), revoke unredeemed
 *   3. Activity log — filter, table, expand for payloads
 *
 * Status column is derived (§11, Phase 4 note):
 *   dryRun=true → "Dry-run"
 *   error non-null → "Error"
 *   else → "OK"
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CallLogListItem, CallLogFull } from '@/lib/db/repository';
import { apiFetch } from '@/lib/apiFetch';

// ── Types ──────────────────────────────────────────────────────────────────────
// Exported 2026-08-06 so a client-side fetch could type the same GET /api/settings
// and GET /api/llm-call-log shapes /settings/page.tsx's server component reads
// directly from the DB. That caller was SettingsModal.tsx (retired 2026-08-18 when
// Settings merged into PreferencesModal.tsx's LLM/Admin/Activity-log categories —
// see prefsShared.tsx for their own, separately-typed equivalents). SettingsView.tsx
// itself is untouched by that merge and today is fed only by /settings/page.tsx —
// kept alive as the admin-only full page the Activity log's Permalink deep-links to.

export type SettingEntry = {
  key: string;
  label: string;
  hint: string;
  datatype: string;
  value: boolean | number | string;
  isDefault: boolean;
  updatedAt: string | null;
  /** Minimum value — only applicable to int settings. */
  min?: number;
  /** Maximum value — only applicable to int settings. */
  max?: number;
  /** Allowed values — only applicable to enum settings (Plan 11). */
  options?: readonly string[];
  /**
   * Subset of options that are currently configured (env vars present on the server).
   * Unconfigured options are rendered disabled/annotated in the <select> so the
   * admin can see which providers are available without having to try selecting them.
   */
  configuredOptions?: readonly string[];
};

// createdAt is serialized to ISO string for JSON transport; use Omit to replace the Date type.
export type LogListItem = Omit<CallLogListItem, 'createdAt'> & { createdAt: string };
export type LogFull = Omit<CallLogFull, 'createdAt'> & { createdAt: string };

type FilterMode = 'all' | 'dry-run' | 'live';

type InviteCodeRow = {
  code: string;
  note: string | null;
  createdAt: string;
  redeemedBy: string | null;
  redeemedAt: string | null;
  boundEmail: string | null;
  expiresAt: string | null;
};

// Plan 12 (2026-08-14) — "Request access" grid. referralSource kept as a plain string
// here (not the ReferralSource union) since a raw fetch response is untyped data, not a
// value this component constructs — matches how the rest of this file treats API JSON.
type AccessRequestRow = {
  id: string;
  name: string;
  email: string;
  referralSource: string | null;
  createdAt: string;
};

// Users grid (admin-only, GET /api/settings/users) — mirrors UserListItem, minus
// the Date→string swap every fetch response in this file already goes through.
type UserListRow = {
  id: string;
  email: string;
  role: 'admin' | 'user';
  shareLogsWithAdmin: boolean;
  createdAt: string;
};

// Rows per page for the Access requests / Users / Activity log grids. Same
// constant everywhere so pagination behaves consistently across the page.
const PAGE_SIZE = 10;

const REFERRAL_SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  thread: 'A thread/post online',
  github: 'GitHub',
  friend: 'A friend',
  other: 'Other',
};

interface SettingsViewProps {
  settings: SettingEntry[];
  entries: LogListItem[];
  highlightId: string | null;
  highlightEntry: LogFull | null;
  /** Historical: set when rendered inside SettingsModal (2026-08-06, retired
   *  2026-08-18) to replace the "← Back to Workbench" link with a "Close" button.
   *  SettingsView.tsx now only ever renders on the full-page /settings route,
   *  which never passes this — kept on the type/JSX for zero behavior change
   *  rather than stripped out for a route not otherwise being touched. */
  onClose?: () => void;
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

/** null → "No expiry". Past → "Expired". Otherwise a short "in Xh Ym" countdown — this
 *  is only ever a few hours out (Plan 12's default is 5h), so a coarser "in 2 days"
 *  granularity would be less useful than minutes here. */
function formatExpiry(iso: string | null): { text: string; expired: boolean } {
  if (!iso) return { text: 'No expiry', expired: false };
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { text: 'Expired', expired: true };
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const text = hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
  return { text, expired: false };
}

/** Pretty-prints a payload and unescapes literal `\r`/`\n` sequences inside string values
 *  into real line breaks, so pasting into an editor reads as formatted text instead of one
 *  line with visible "\n"/"\r" markers. Source agent files are often saved with Windows
 *  CRLF line endings, so `\r\n` pairs are collapsed first — otherwise a leftover `\r` sits
 *  as stray text next to the now-real newline. No longer strictly valid JSON afterward (a
 *  real newline inside a string literal isn't legal JSON) — that trade-off is the point,
 *  this is for reading. */
function copyPayloadFormatted(value: unknown): void {
  const pretty = JSON.stringify(value, null, 2)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n');
  navigator.clipboard.writeText(pretty);
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
  onClose,
}: SettingsViewProps) {
  const [localSettings, setLocalSettings] = useState<SettingEntry[]>(settings);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [expandedId, setExpandedId] = useState<string | null>(highlightId);
  const [expandedPayload, setExpandedPayload] = useState<LogFull | null>(highlightEntry);
  const [loadingPayload, setLoadingPayload] = useState(false);
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  // ── Invite codes state ───────────────────────────────────────────────────────
  const [codes, setCodes] = useState<InviteCodeRow[]>([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [codesError, setCodesError] = useState<string | null>(null);
  const [newCodeNote, setNewCodeNote] = useState('');
  const [generatingCode, setGeneratingCode] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  // Load invite codes on mount
  useEffect(() => {
    setCodesLoading(true);
    apiFetch('/api/settings/invite-codes')
      .then(async (res) => {
        if (res.ok) {
          const body = await res.json() as { codes: InviteCodeRow[] };
          setCodes(body.codes);
        } else {
          setCodesError('Failed to load invite codes.');
        }
      })
      .catch(() => setCodesError('Network error loading invite codes.'))
      .finally(() => setCodesLoading(false));
  }, []);

  // ── Access requests state (Plan 12, 2026-08-14) ─────────────────────────────
  const [accessRequests, setAccessRequests] = useState<AccessRequestRow[]>([]);
  const [accessRequestsLoading, setAccessRequestsLoading] = useState(false);
  const [accessRequestsError, setAccessRequestsError] = useState<string | null>(null);
  // Per-row id currently mid-action, so only that row's buttons show a busy state.
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [accessRequestsPage, setAccessRequestsPage] = useState(1);

  useEffect(() => {
    setAccessRequestsLoading(true);
    apiFetch('/api/settings/access-requests')
      .then(async (res) => {
        if (res.ok) {
          const body = await res.json() as { requests: AccessRequestRow[] };
          setAccessRequests(body.requests);
        } else {
          setAccessRequestsError('Failed to load access requests.');
        }
      })
      .catch(() => setAccessRequestsError('Network error loading access requests.'))
      .finally(() => setAccessRequestsLoading(false));
  }, []);

  // ── Users state (admin-only grid, GET /api/settings/users) ─────────────────
  const [users, setUsers] = useState<UserListRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersPage, setUsersPage] = useState(1);

  useEffect(() => {
    setUsersLoading(true);
    apiFetch('/api/settings/users')
      .then(async (res) => {
        if (res.ok) {
          const body = await res.json() as { users: UserListRow[] };
          setUsers(body.users);
        } else {
          setUsersError('Failed to load users.');
        }
      })
      .catch(() => setUsersError('Network error loading users.'))
      .finally(() => setUsersLoading(false));
  }, []);

  // ── Activity log pagination ─────────────────────────────────────────────────
  const [logPage, setLogPage] = useState(1);
  // Changing the filter changes how many rows exist — stay on page 1 rather than
  // landing on a now-out-of-range page.
  useEffect(() => {
    setLogPage(1);
  }, [filter]);

  // Scroll to highlighted row on first paint
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // ── Toggle handler (bool settings) ──────────────────────────────────────────

  async function handleToggle(key: string, current: boolean) {
    const newValue = !current;
    // Optimistic update
    setLocalSettings((prev) =>
      prev.map((s) =>
        s.key === key ? { ...s, value: newValue, isDefault: false } : s,
      ),
    );
    try {
      const res = await apiFetch('/api/settings', {
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
        // Apply the stored updatedAt from the response directly (2026-08-06 — was
        // router.refresh(), which re-fetches whatever page currently hosts this
        // component; harmless on /settings but would have been wasteful/wrong back
        // when this also rendered inside SettingsModal over an unrelated page —
        // that modal is retired 2026-08-18, but the direct-apply fix stays correct
        // regardless of caller).
        const body = (await res.json()) as { updatedAt: string };
        setLocalSettings((prev) =>
          prev.map((s) => (s.key === key ? { ...s, updatedAt: body.updatedAt } : s)),
        );
      }
    } catch (err) {
      // Revert on network error
      setLocalSettings((prev) =>
        prev.map((s) => (s.key === key ? { ...s, value: current } : s)),
      );
      console.error('[settings] PATCH error:', err);
    }
  }

  // ── Int setting save ─────────────────────────────────────────────────────────

  async function handleIntSave(key: string, rawValue: string, def: SettingEntry) {
    const parsed = parseInt(rawValue, 10);
    if (isNaN(parsed)) return;
    if (def.min !== undefined && parsed < def.min) return;
    if (def.max !== undefined && parsed > def.max) return;
    if (parsed === (def.value as number)) return; // no change

    const prev = def.value;
    setLocalSettings((s) =>
      s.map((entry) =>
        entry.key === key ? { ...entry, value: parsed, isDefault: false } : entry,
      ),
    );

    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: parsed }),
      });
      if (!res.ok) {
        setLocalSettings((s) =>
          s.map((entry) => (entry.key === key ? { ...entry, value: prev } : entry)),
        );
        console.error('[settings] int PATCH failed:', await res.text());
      } else {
        const body = (await res.json()) as { updatedAt: string };
        setLocalSettings((s) =>
          s.map((entry) => (entry.key === key ? { ...entry, updatedAt: body.updatedAt } : entry)),
        );
      }
    } catch (err) {
      setLocalSettings((s) =>
        s.map((entry) => (entry.key === key ? { ...entry, value: prev } : entry)),
      );
      console.error('[settings] int PATCH error:', err);
    }
  }

  // ── Enum setting save (Plan 11) ──────────────────────────────────────────────

  async function handleEnumSave(key: string, newValue: string) {
    const current = localSettings.find((s) => s.key === key)?.value;
    if (newValue === current) return; // no change

    // Optimistic update
    setLocalSettings((prev) =>
      prev.map((s) => (s.key === key ? { ...s, value: newValue, isDefault: false } : s)),
    );

    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: newValue }),
      });
      if (!res.ok) {
        // Revert on failure (e.g. provider_not_configured 400)
        setLocalSettings((prev) =>
          prev.map((s) => (s.key === key ? { ...s, value: current ?? '' } : s)),
        );
        console.error('[settings] enum PATCH failed:', await res.text());
      } else {
        const body = (await res.json()) as { updatedAt: string };
        setLocalSettings((prev) =>
          prev.map((s) => (s.key === key ? { ...s, updatedAt: body.updatedAt } : s)),
        );
      }
    } catch (err) {
      setLocalSettings((prev) =>
        prev.map((s) => (s.key === key ? { ...s, value: current ?? '' } : s)),
      );
      console.error('[settings] enum PATCH error:', err);
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
      const res = await apiFetch(`/api/llm-call-log/${id}`);
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

  // ── Invite code actions ───────────────────────────────────────────────────────

  async function handleGenerateCode() {
    setGeneratingCode(true);
    setNewCode(null);
    try {
      const res = await apiFetch('/api/settings/invite-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: newCodeNote.trim() || undefined }),
      });
      if (res.ok) {
        const row = await res.json() as InviteCodeRow;
        setNewCode(row.code);
        setCodes((prev) => [row, ...prev]);
        setNewCodeNote('');
      } else {
        setCodesError('Failed to generate code.');
      }
    } catch {
      setCodesError('Network error generating code.');
    } finally {
      setGeneratingCode(false);
    }
  }

  async function handleRevokeCode(code: string) {
    if (!window.confirm(`Revoke invite code ${code}?`)) return;
    try {
      const res = await apiFetch(
        `/api/settings/invite-codes/${encodeURIComponent(code)}`,
        { method: 'DELETE' },
      );
      if (res.ok || res.status === 204) {
        setCodes((prev) => prev.filter((c) => c.code !== code));
      } else if (res.status === 409) {
        setCodesError('That code has already been redeemed and cannot be revoked.');
      } else {
        setCodesError('Failed to revoke code.');
      }
    } catch {
      setCodesError('Network error revoking code.');
    }
  }

  // ── Access request actions (Plan 12, 2026-08-14) ────────────────────────────

  async function handleGenerateCodeFromRequest(id: string) {
    setBusyRequestId(id);
    setAccessRequestsError(null);
    try {
      const res = await apiFetch(`/api/settings/access-requests/${encodeURIComponent(id)}/generate-code`, {
        method: 'POST',
      });
      if (res.ok) {
        const row = await res.json() as InviteCodeRow;
        setNewCode(row.code); // reuse the same "here's the code, copy it" banner as + Generate code
        setCodes((prev) => [row, ...prev]);
        setAccessRequests((prev) => prev.filter((r) => r.id !== id));
      } else {
        setAccessRequestsError('Failed to generate a code for this request.');
      }
    } catch {
      setAccessRequestsError('Network error generating code.');
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleDismissRequest(id: string) {
    setBusyRequestId(id);
    setAccessRequestsError(null);
    try {
      const res = await apiFetch(`/api/settings/access-requests/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok || res.status === 204) {
        setAccessRequests((prev) => prev.filter((r) => r.id !== id));
      } else {
        setAccessRequestsError('Failed to dismiss this request.');
      }
    } catch {
      setAccessRequestsError('Network error dismissing request.');
    } finally {
      setBusyRequestId(null);
    }
  }

  // ── Filter entries ───────────────────────────────────────────────────────────

  const filtered = entries.filter((e) => {
    if (filter === 'dry-run') return e.dryRun;
    if (filter === 'live') return !e.dryRun;
    return true;
  });

  // ── Paginated slices (10/page, matching PAGE_SIZE) ──────────────────────────
  const pagedAccessRequests = accessRequests.slice(
    (accessRequestsPage - 1) * PAGE_SIZE,
    accessRequestsPage * PAGE_SIZE,
  );
  const pagedUsers = users.slice((usersPage - 1) * PAGE_SIZE, usersPage * PAGE_SIZE);
  const pagedLog = filtered.slice((logPage - 1) * PAGE_SIZE, logPage * PAGE_SIZE);

  const unredeemedCodes = codes.filter((c) => !c.redeemedBy);
  const redeemedCodes = codes.filter((c) => c.redeemedBy);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8">
      {/* Back link — this component is only ever reached via the full-page /settings
          route now (SettingsModal, which used to pass onClose for a "Close" button
          instead, was retired 2026-08-18 when Settings merged into PreferencesModal). */}
      <div>
        {onClose ? (
          <button
            onClick={onClose}
            className="text-[13px] text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            ← Close
          </button>
        ) : (
          <Link
            href="/"
            className="text-[13px] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            ← Back to Workbench
          </Link>
        )}
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
              {/* Int input */}
              {s.datatype === 'int' && (
                <IntSettingInput setting={s} onSave={handleIntSave} />
              )}
              {/* Enum select (Plan 11) */}
              {s.datatype === 'enum' && s.options && (
                <EnumSettingSelect setting={s} onSave={handleEnumSave} />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Access requests panel (Plan 12, 2026-08-14) ─────────────────── */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Access requests</h2>
        <p className="text-[12px] text-[var(--muted)] mb-3">
          From "Request access" on the signup form. Generate a code to offer a spot (bound
          to their email, expires per the setting above — currently{' '}
          {localSettings.find((s) => s.key === 'accessRequestCodeExpiryHours')?.value ?? 5}h); the
          code isn't emailed automatically yet, so copy it and send it to them yourself.
        </p>

        {accessRequestsError && (
          <p className="text-[12px] text-[var(--err)] mb-3">{accessRequestsError}</p>
        )}

        {accessRequestsLoading ? (
          <p className="text-[12px] text-[var(--faint)]">Loading requests…</p>
        ) : accessRequests.length === 0 ? (
          <p className="text-[12px] text-[var(--faint)]">No open requests.</p>
        ) : (
          <>
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] overflow-hidden mb-4">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left">
                    <th className="px-3 py-2 text-[var(--muted)] font-medium">Name</th>
                    <th className="px-3 py-2 text-[var(--muted)] font-medium">Email</th>
                    <th className="px-3 py-2 text-[var(--muted)] font-medium">Found us via</th>
                    <th className="px-3 py-2 text-[var(--muted)] font-medium">Requested</th>
                    <th className="px-3 py-2 text-[var(--muted)] font-medium w-40"></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedAccessRequests.map((r) => {
                    const busy = busyRequestId === r.id;
                    return (
                      <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--bg)]">
                        <td className="px-3 py-2 text-[var(--text)]">{r.name}</td>
                        <td className="px-3 py-2 text-[var(--muted)]">{r.email}</td>
                        <td className="px-3 py-2 text-[var(--muted)]">
                          {r.referralSource ? (REFERRAL_SOURCE_LABELS[r.referralSource] ?? r.referralSource) : '—'}
                        </td>
                        <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap">{formatTs(r.createdAt)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleGenerateCodeFromRequest(r.id)}
                            disabled={busy}
                            className="text-[11px] text-[var(--accent-ink)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed mr-3"
                          >
                            {busy ? 'Working…' : 'Generate code'}
                          </button>
                          <button
                            onClick={() => handleDismissRequest(r.id)}
                            disabled={busy}
                            className="text-[11px] text-[var(--faint)] hover:text-[var(--err)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Dismiss
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              page={accessRequestsPage}
              totalItems={accessRequests.length}
              pageSize={PAGE_SIZE}
              onPageChange={setAccessRequestsPage}
            />
          </>
        )}
      </section>

      {/* ── Users panel ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Users</h2>
        <p className="text-[12px] text-[var(--muted)] mb-3">
          Every account on this deployment. Read-only here — role and log-sharing changes
          aren't editable from this grid yet.
        </p>

        {usersError && (
          <p className="text-[12px] text-[var(--err)] mb-3">{usersError}</p>
        )}

        {usersLoading ? (
          <p className="text-[12px] text-[var(--faint)]">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-[12px] text-[var(--faint)]">No users.</p>
        ) : (
          <>
            <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left">
                    <th className="px-3 py-2 text-[var(--muted)] font-medium">Email</th>
                    <th className="px-3 py-2 text-[var(--muted)] font-medium w-24">Role</th>
                    <th className="px-3 py-2 text-[var(--muted)] font-medium w-32">Shares logs</th>
                    <th className="px-3 py-2 text-[var(--muted)] font-medium w-40">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedUsers.map((u) => (
                    <tr key={u.id} className="border-b border-[var(--border)] hover:bg-[var(--bg)]">
                      <td className="px-3 py-2 text-[var(--text)]">{u.email}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{u.role}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{u.shareLogsWithAdmin ? 'Yes' : 'No'}</td>
                      <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap">{formatTs(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={usersPage}
              totalItems={users.length}
              pageSize={PAGE_SIZE}
              onPageChange={setUsersPage}
            />
          </>
        )}
      </section>

      {/* ── Invite codes panel ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Invite codes</h2>

        {/* Generate new code */}
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] p-4 mb-4">
          <p className="text-[12px] text-[var(--muted)] mb-3">
            Generate a one-time invite code and share it with a friend. Each code can only be
            used once. The code will appear here so you can copy it again if needed.
          </p>
          {newCode && (
            <div className="mb-3 flex items-center gap-2 bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[7px] px-3 py-2">
              <code className="flex-1 font-mono text-[13px] text-[var(--text)] tracking-wider">
                {newCode}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(newCode)}
                className="text-[11px] text-[var(--accent-ink)] hover:underline flex-none"
              >
                Copy
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={newCodeNote}
              onChange={(e) => setNewCodeNote(e.target.value)}
              placeholder="Label (optional, e.g. &quot;for Alice&quot;)"
              className="flex-1 border border-[var(--border)] rounded-[6px] px-2 py-1 text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={handleGenerateCode}
              disabled={generatingCode}
              className="px-3 py-1 text-[12px] font-medium bg-[var(--accent)] text-white rounded-[6px] hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {generatingCode ? 'Generating…' : '+ Generate code'}
            </button>
          </div>
        </div>

        {codesError && (
          <p className="text-[12px] text-[var(--err)] mb-3">{codesError}</p>
        )}

        {codesLoading ? (
          <p className="text-[12px] text-[var(--faint)]">Loading codes…</p>
        ) : codes.length === 0 ? (
          <p className="text-[12px] text-[var(--faint)]">No invite codes yet.</p>
        ) : (
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Code</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Label</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">For</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Created</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Expires</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Status</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {unredeemedCodes.map((c) => {
                  const expiry = formatExpiry(c.expiresAt);
                  return (
                    <tr key={c.code} className="border-b border-[var(--border)] hover:bg-[var(--bg)]">
                      <td className="px-3 py-2 font-mono text-[var(--text)] tracking-wider">{c.code}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{c.note ?? '—'}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{c.boundEmail ?? 'Anyone'}</td>
                      <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap">{formatTs(c.createdAt)}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expiry.expired ? 'text-[var(--err)]' : 'text-[var(--muted)]'}`}>
                        {expiry.text}
                      </td>
                      <td className={expiry.expired ? 'px-3 py-2 text-[var(--err)]' : 'px-3 py-2 text-[var(--ok)]'}>
                        {expiry.expired ? 'Expired' : 'Unused'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleRevokeCode(c.code)}
                          className="text-[11px] text-[var(--faint)] hover:text-[var(--err)] transition-colors"
                          title="Revoke this code"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {redeemedCodes.map((c) => (
                  <tr key={c.code} className="border-b border-[var(--border)] opacity-50">
                    <td className="px-3 py-2 font-mono text-[var(--muted)] tracking-wider line-through">{c.code}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{c.note ?? '—'}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{c.boundEmail ?? 'Anyone'}</td>
                    <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap">{formatTs(c.createdAt)}</td>
                    <td className="px-3 py-2 text-[var(--faint)]">—</td>
                    <td className="px-3 py-2 text-[var(--faint)]">
                      Redeemed {c.redeemedAt ? formatTs(c.redeemedAt) : ''}
                    </td>
                    <td className="px-3 py-2"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                {pagedLog.map((entry) => {
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
                          {/* Content-hidden affordance for redacted rows (§5.6) */}
                          {entry.redacted && (
                            <span
                              className="ml-1 text-[10px] text-[var(--faint)] font-normal"
                              title="This user has not consented to sharing their prompt content."
                            >
                              🔒
                            </span>
                          )}
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
                                {/* Redacted notice (§5.6) */}
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
                                {/* Error row */}
                                {expandedPayload.error && (
                                  <div>
                                    <p className="text-[11px] font-medium text-[var(--err)] mb-1">Error</p>
                                    <pre className="text-[11px] text-[var(--text)] bg-[var(--panel)] border border-[var(--border)] rounded-[6px] p-2 overflow-x-auto whitespace-pre-wrap">
                                      {expandedPayload.error}
                                    </pre>
                                  </div>
                                )}
                                {/* Request payload — only shown when not redacted */}
                                {!expandedPayload.redacted && (
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
                                {/* Response payload — only shown when not redacted */}
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
        <Pager
          page={logPage}
          totalItems={filtered.length}
          pageSize={PAGE_SIZE}
          onPageChange={setLogPage}
        />
        <p className="text-[11px] text-[var(--faint)] mt-2 text-right">
          Showing {filtered.length} of {entries.length} fetched entries (limit 200).
        </p>
      </section>
    </div>
  );
}

// ── Enum setting sub-component (Plan 11) ─────────────────────────────────────

/**
 * Renders a <select> for enum settings. Options that are not in configuredOptions
 * (server-side env vars absent) are disabled and annotated "(not configured)" so
 * the admin sees what's available without being able to accidentally select an
 * unconfigured provider. The PATCH route also rejects unconfigured selections as
 * a belt-and-braces guard — disabling here is UX, the route rejection is the gate.
 */
function EnumSettingSelect({
  setting,
  onSave,
}: {
  setting: SettingEntry;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  return (
    <select
      value={setting.value as string}
      onChange={(e) => void onSave(setting.key, e.target.value)}
      className="flex-none border border-[var(--border)] rounded-[6px] px-2 py-1 text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] cursor-pointer"
    >
      {setting.options?.map((opt) => {
        const configured = setting.configuredOptions?.includes(opt) ?? true;
        return (
          <option key={opt} value={opt} disabled={!configured}>
            {opt}{!configured ? ' (not configured)' : ''}
          </option>
        );
      })}
    </select>
  );
}

// ── Int setting sub-component ─────────────────────────────────────────────────

function IntSettingInput({
  setting,
  onSave,
}: {
  setting: SettingEntry;
  onSave: (key: string, rawValue: string, def: SettingEntry) => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(setting.value));

  function handleBlur() {
    onSave(setting.key, draft, setting);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === 'Escape') {
      setDraft(String(setting.value));
    }
  }

  return (
    <input
      type="number"
      value={draft}
      min={setting.min}
      max={setting.max}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="flex-none w-20 border border-[var(--border)] rounded-[6px] px-2 py-1 text-[12px] text-right bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
    />
  );
}

// ── Pagination sub-component ────────────────────────────────────────────────

/**
 * Prev/Next pager shared by the Access requests, Users, and Activity log grids
 * (all client-side pagination over an already-fetched array — none of these
 * lists are large enough yet to need a server-side offset). Renders nothing
 * when everything fits on one page.
 */
function Pager({
  page,
  totalItems,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-end gap-3 mt-2">
      <span className="text-[11px] text-[var(--faint)]">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="text-[11px] px-2 py-1 rounded-[6px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          ← Prev
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="text-[11px] px-2 py-1 rounded-[6px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
