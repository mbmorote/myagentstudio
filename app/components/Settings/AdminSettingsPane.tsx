'use client';

/**
 * app/components/Settings/AdminSettingsPane.tsx
 *
 * "Admin" category of the Preferences modal (2026-08-18 Account + Settings
 * merge, prototyped in reference/layout/Layout-Workbench.html per CLAUDE.md
 * standing rule 4). Admin-only pane — PreferencesModal never mounts this for a
 * non-admin.
 *
 * Bundles everything that isn't Account or LLM: the platform settings
 * (maxUsers, accessRequestCodeExpiryHours, mcpWrites), Access requests, Invite
 * codes, and the Users grid — each paginated 10/page (Access requests and
 * Users since 2026-08-18's modal redesign; Invite codes added 2026-08-28,
 * issue #10). Self-contained fetch/save for all four, same round-trips
 * SettingsView.tsx already used.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  PAGE_SIZE, Pager, formatTs, formatExpiry, IntSettingInput, type SettingEntry,
} from './prefsShared';

const ADMIN_KEYS = new Set(['maxUsers', 'accessRequestCodeExpiryHours', 'mcpWrites']);

/**
 * DD/MM hh:mm — compact date format for the invite-codes "Created" column only
 * (2026-08-28, at the user's request). Deliberately a local helper, not a change
 * to prefsShared.tsx's shared formatTs() — that's also used by Access requests,
 * Users, and Activity log, which weren't asked to change.
 */
function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

const REFERRAL_SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  thread: 'A thread/post online',
  github: 'GitHub',
  friend: 'A friend',
  other: 'Other',
};

type InviteCodeRow = {
  code: string;
  note: string | null;
  createdAt: string;
  redeemedBy: string | null;
  redeemedAt: string | null;
  boundEmail: string | null;
  expiresAt: string | null;
};

type AccessRequestRow = {
  id: string;
  name: string;
  email: string;
  referralSource: string | null;
  createdAt: string;
};

type UserListRow = {
  id: string;
  email: string;
  role: 'admin' | 'user';
  shareLogsWithAdmin: boolean;
  createdAt: string;
};

export function AdminSettingsPane() {
  // ── Platform settings ────────────────────────────────────────────────────
  const [settings, setSettings] = useState<SettingEntry[] | null>(null);

  useEffect(() => {
    apiFetch('/api/settings')
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json() as { settings: SettingEntry[] };
        setSettings(body.settings.filter((s) => ADMIN_KEYS.has(s.key)));
      })
      .catch(() => {});
  }, []);

  async function handleToggle(key: string, current: boolean) {
    const newValue = !current;
    setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, value: newValue, isDefault: false } : s)) ?? prev);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: newValue }),
      });
      if (!res.ok) {
        setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, value: current } : s)) ?? prev);
      } else {
        const body = await res.json() as { updatedAt: string };
        setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, updatedAt: body.updatedAt } : s)) ?? prev);
      }
    } catch {
      setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, value: current } : s)) ?? prev);
    }
  }

  async function handleIntSave(key: string, rawValue: string, def: SettingEntry) {
    const parsed = parseInt(rawValue, 10);
    if (isNaN(parsed)) return;
    if (def.min !== undefined && parsed < def.min) return;
    if (def.max !== undefined && parsed > def.max) return;
    if (parsed === (def.value as number)) return;

    const prev = def.value;
    setSettings((s) => s?.map((entry) => (entry.key === key ? { ...entry, value: parsed, isDefault: false } : entry)) ?? s);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: parsed }),
      });
      if (!res.ok) {
        setSettings((s) => s?.map((entry) => (entry.key === key ? { ...entry, value: prev } : entry)) ?? s);
      } else {
        const body = await res.json() as { updatedAt: string };
        setSettings((s) => s?.map((entry) => (entry.key === key ? { ...entry, updatedAt: body.updatedAt } : entry)) ?? s);
      }
    } catch {
      setSettings((s) => s?.map((entry) => (entry.key === key ? { ...entry, value: prev } : entry)) ?? s);
    }
  }

  // ── Access requests ───────────────────────────────────────────────────────
  const [accessRequests, setAccessRequests] = useState<AccessRequestRow[]>([]);
  const [accessRequestsLoading, setAccessRequestsLoading] = useState(false);
  const [accessRequestsError, setAccessRequestsError] = useState<string | null>(null);
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

  // ── Invite codes ──────────────────────────────────────────────────────────
  const [codes, setCodes] = useState<InviteCodeRow[]>([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [codesError, setCodesError] = useState<string | null>(null);
  const [newCodeNote, setNewCodeNote] = useState('');
  const [generatingCode, setGeneratingCode] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [codesPage, setCodesPage] = useState(1);

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

  // ── Users ─────────────────────────────────────────────────────────────────
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

  // ── Handlers ──────────────────────────────────────────────────────────────

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
      const res = await apiFetch(`/api/settings/invite-codes/${encodeURIComponent(code)}`, { method: 'DELETE' });
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

  async function handleGenerateCodeFromRequest(id: string) {
    setBusyRequestId(id);
    setAccessRequestsError(null);
    try {
      const res = await apiFetch(`/api/settings/access-requests/${encodeURIComponent(id)}/generate-code`, {
        method: 'POST',
      });
      if (res.ok) {
        const row = await res.json() as InviteCodeRow;
        setNewCode(row.code);
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
      const res = await apiFetch(`/api/settings/access-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

  // Unredeemed codes always sort first (most actionable), redeemed after — same
  // grouping as before pagination, just applied to the paged slice now.
  const orderedCodes = [...codes.filter((c) => !c.redeemedBy), ...codes.filter((c) => c.redeemedBy)];
  const pagedCodes = orderedCodes.slice((codesPage - 1) * PAGE_SIZE, codesPage * PAGE_SIZE);
  const pagedUnredeemedCodes = pagedCodes.filter((c) => !c.redeemedBy);
  const pagedRedeemedCodes = pagedCodes.filter((c) => c.redeemedBy);
  const pagedAccessRequests = accessRequests.slice((accessRequestsPage - 1) * PAGE_SIZE, accessRequestsPage * PAGE_SIZE);
  const pagedUsers = users.slice((usersPage - 1) * PAGE_SIZE, usersPage * PAGE_SIZE);

  return (
    <div className="p-6 space-y-8">
      {/* ── Platform settings ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Platform</h2>
        {!settings ? (
          <p className="text-[12px] text-[var(--faint)]">Loading…</p>
        ) : (
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] divide-y divide-[var(--border)]">
            {settings.map((s) => (
              <div key={s.key} className="flex items-start gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--text)]">{s.label}</span>
                    {s.isDefault && <span className="text-[11px] text-[var(--faint)]">(default)</span>}
                  </div>
                  <p className="text-[12px] text-[var(--muted)] mt-[2px]">{s.hint}</p>
                  {s.updatedAt && (
                    <p className="text-[11px] text-[var(--faint)] mt-[2px]">Updated {formatTs(s.updatedAt)}</p>
                  )}
                </div>
                {s.datatype === 'bool' && (
                  <button
                    onClick={() => handleToggle(s.key, s.value as boolean)}
                    className={[
                      'flex-none w-10 h-6 rounded-full border transition-colors cursor-pointer',
                      s.value ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-[var(--bg)] border-[var(--border)]',
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
                {s.datatype === 'int' && <IntSettingInput setting={s} onSave={handleIntSave} />}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Access requests ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Access requests</h2>
        <p className="text-[12px] text-[var(--muted)] mb-3">
          From &quot;Request access&quot; on the signup form. Generate a code to offer a spot (bound
          to their email, expires per the setting above); the code isn&apos;t emailed
          automatically yet, so copy it and send it to them yourself.
        </p>

        {accessRequestsError && <p className="text-[12px] text-[var(--err)] mb-3">{accessRequestsError}</p>}

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
            <Pager page={accessRequestsPage} totalItems={accessRequests.length} pageSize={PAGE_SIZE} onPageChange={setAccessRequestsPage} />
          </>
        )}
      </section>

      {/* ── Invite codes ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Invite codes</h2>
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] p-4 mb-4">
          <p className="text-[12px] text-[var(--muted)] mb-3">
            Generate a one-time invite code and share it with a friend. Each code can only be
            used once. The code will appear here so you can copy it again if needed.
          </p>
          {newCode && (
            <div className="mb-3 flex items-center gap-2 bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[7px] px-3 py-2">
              <code className="flex-1 font-mono text-[13px] text-[var(--text)] tracking-wider">{newCode}</code>
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
              placeholder='Label (optional, e.g. "for Alice")'
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

        {codesError && <p className="text-[12px] text-[var(--err)] mb-3">{codesError}</p>}

        {codesLoading ? (
          <p className="text-[12px] text-[var(--faint)]">Loading codes…</p>
        ) : codes.length === 0 ? (
          <p className="text-[12px] text-[var(--faint)]">No invite codes yet.</p>
        ) : (
          <>
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="px-3 py-2 text-[var(--muted)] font-medium w-16"></th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Code</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">For</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Created</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Expires</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Status</th>
                  <th className="px-3 py-2 text-[var(--muted)] font-medium">Label</th>
                </tr>
              </thead>
              <tbody>
                {pagedUnredeemedCodes.map((c) => {
                  const expiry = formatExpiry(c.expiresAt);
                  return (
                    <tr key={c.code} className="border-b border-[var(--border)] hover:bg-[var(--bg)]">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => handleRevokeCode(c.code)}
                          className="text-[11px] text-[var(--faint)] hover:text-[var(--err)] transition-colors"
                          title="Revoke this code"
                        >
                          Revoke
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[var(--text)] tracking-wider">{c.code}</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(c.code)}
                            className="text-[11px] text-[var(--accent-ink)] hover:underline flex-none"
                            title="Copy this code"
                          >
                            Copy
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--muted)]">
                        <span className="block max-w-[110px] truncate" title={c.boundEmail ?? undefined}>{c.boundEmail ?? 'Anyone'}</span>
                      </td>
                      <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap">{formatShortDate(c.createdAt)}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expiry.expired ? 'text-[var(--err)]' : 'text-[var(--muted)]'}`}>
                        {expiry.text}
                      </td>
                      <td className={expiry.expired ? 'px-3 py-2 text-[var(--err)] whitespace-nowrap' : 'px-3 py-2 text-[var(--ok)] whitespace-nowrap'}>
                        {expiry.expired ? 'Expired' : 'Unused'}
                      </td>
                      <td className="px-3 py-2 text-[var(--muted)]">
                        <span className="block max-w-[110px] truncate" title={c.note ?? undefined}>{c.note ?? '—'}</span>
                      </td>
                    </tr>
                  );
                })}
                {pagedRedeemedCodes.map((c) => (
                  <tr key={c.code} className="border-b border-[var(--border)] opacity-50">
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 font-mono text-[var(--muted)] tracking-wider line-through whitespace-nowrap">{c.code}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">
                      <span className="block max-w-[110px] truncate" title={c.boundEmail ?? undefined}>{c.boundEmail ?? 'Anyone'}</span>
                    </td>
                    <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap">{formatShortDate(c.createdAt)}</td>
                    <td className="px-3 py-2 text-[var(--faint)] whitespace-nowrap">—</td>
                    <td className="px-3 py-2 text-[var(--faint)] whitespace-nowrap">Redeemed {c.redeemedAt ? formatShortDate(c.redeemedAt) : ''}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">
                      <span className="block max-w-[110px] truncate" title={c.note ?? undefined}>{c.note ?? '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
          <Pager page={codesPage} totalItems={codes.length} pageSize={PAGE_SIZE} onPageChange={setCodesPage} />
          </>
        )}
      </section>

      {/* ── Users ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Users</h2>
        <p className="text-[12px] text-[var(--muted)] mb-3">
          Every account on this deployment. Read-only here — role and log-sharing changes
          aren&apos;t editable from this grid yet.
        </p>

        {usersError && <p className="text-[12px] text-[var(--err)] mb-3">{usersError}</p>}

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
            <Pager page={usersPage} totalItems={users.length} pageSize={PAGE_SIZE} onPageChange={setUsersPage} />
          </>
        )}
      </section>
    </div>
  );
}
