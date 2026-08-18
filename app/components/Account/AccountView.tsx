'use client';

/**
 * app/components/Account/AccountView.tsx
 *
 * Client component for the User Settings page (/account) — Plan 05 Phase 4.6, §5.7.
 * Extended in Plan 06 Phase 4.4 to show the "Signed in with" line (§7.2).
 * Extended in Plan 13 (2026-08-15) to add the "API tokens (MCP access)" panel.
 *
 * Displays:
 *   - Read-only: signed-in email, role, and sign-in method(s)
 *   - Editable: log-sharing consent toggle (PATCH /api/account)
 *   - API tokens panel: list, create (name + scope), one-time reveal, revoke
 *
 * The consent toggle is the one preference that belongs to the person,
 * not the deployment. The page is always available to any authenticated
 * user, including the admin.
 *
 * Non-retroactivity statement: stated explicitly, in both directions, so the
 * user understands that changing the toggle does not affect past calls (§5.6).
 *
 * apiFetch is used for all /api/ calls (not the bare fetch() global), per
 * fitness rule 4 — the route-guard fitness test bars a raw call to fetch
 * against an /api/ path from any 'use client' file.
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';

/** One linked OAuth provider row, passed from the server page (§7.2, Plan 06 §4.1). */
interface LinkedAccount {
  provider: string;
  providerEmail: string | null;
}

/** An API token row as returned by GET /api/account/tokens (Plan 13). */
interface ApiTokenListItem {
  id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface AccountViewProps {
  email: string;
  role: 'admin' | 'user';
  shareLogsWithAdmin: boolean;
  /** True when the user has a password hash (false for Google-only accounts). */
  hasPassword: boolean;
  /** OAuth provider links for this user — [] for password-only accounts. */
  linkedAccounts: LinkedAccount[];
  /** Historical: used to render a "← Close" button when this component was
   *  reached via AccountModal.tsx (2026-08-12, retired 2026-08-18). No current
   *  caller passes this — PreferencesModal.tsx's Account category passes
   *  hideBackLink instead (its Dialog already has its own ✕), and the full-page
   *  /account route never passed it. Kept on the type for now rather than
   *  removed, since a bare unused prop costs nothing and stripping it isn't
   *  otherwise part of this pass. */
  onClose?: () => void;
  /** When true, hides the whole back/close navigation row — used by
   *  PreferencesModal.tsx's Account category (2026-08-18), whose Dialog already
   *  renders its own ✕ close button; a second "← Close" text link right below
   *  it was redundant (found in browser review). Omitted (false) by the
   *  full-page /account route, which still needs its "← Back to Workbench" link. */
  hideBackLink?: boolean;
}

export function AccountView({
  email,
  role,
  shareLogsWithAdmin: initialShare,
  hasPassword,
  linkedAccounts,
  onClose,
  hideBackLink,
}: AccountViewProps) {
  const [sharing, setSharing] = useState(initialShare);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ── API tokens state (Plan 13) ─────────────────────────────────────────────
  const [tokens, setTokens] = useState<ApiTokenListItem[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [tokensError, setTokensError] = useState<string | null>(null);

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenScope, setNewTokenScope] = useState<'read' | 'write'>('read');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // One-time plaintext reveal after creation
  const [revealedPlaintext, setRevealedPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load tokens on mount
  useEffect(() => {
    async function loadTokens() {
      try {
        const res = await apiFetch('/api/account/tokens');
        if (res.ok) {
          const data = await res.json() as ApiTokenListItem[];
          setTokens(data);
        } else {
          setTokensError('Failed to load tokens.');
        }
      } catch {
        setTokensError('Network error loading tokens.');
      } finally {
        setTokensLoading(false);
      }
    }
    void loadTokens();
  }, []);

  async function handleToggle() {
    const newValue = !sharing;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await apiFetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareLogsWithAdmin: newValue }),
      });

      if (res.ok) {
        setSharing(newValue);
        setSaved(true);
        // Clear the saved indicator after 2 seconds
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError('Failed to update preference. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── API token handlers (Plan 13) ──────────────────────────────────────────

  async function handleCreateToken() {
    if (!newTokenName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch('/api/account/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim(), scope: newTokenScope }),
      });
      if (res.ok) {
        const data = await res.json() as { token: ApiTokenListItem; plaintext: string };
        setTokens((prev) => [data.token, ...prev]);
        setRevealedPlaintext(data.plaintext);
        setNewTokenName('');
        setNewTokenScope('read');
        setShowCreateForm(false);
      } else {
        const body = await res.json() as { message?: string; error?: string };
        setCreateError(body.message ?? body.error ?? 'Failed to create token.');
      }
    } catch {
      setCreateError('Network error.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeToken(id: string) {
    try {
      const res = await apiFetch(`/api/account/tokens/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTokens((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t,
          ),
        );
      } else {
        setTokensError('Failed to revoke token.');
      }
    } catch {
      setTokensError('Network error revoking token.');
    }
  }

  async function handleCopy() {
    if (!revealedPlaintext) return;
    try {
      await navigator.clipboard.writeText(revealedPlaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available — no-op
    }
  }

  // ── Build the "Signed in with" display string from the passed props (§7.2).
  const signinMethods: string[] = [];
  if (hasPassword) signinMethods.push('password');
  for (const acc of linkedAccounts) {
    const label = acc.provider.charAt(0).toUpperCase() + acc.provider.slice(1); // 'google' → 'Google'
    signinMethods.push(acc.providerEmail ? `${label} (${acc.providerEmail})` : label);
  }
  const signinDisplay = signinMethods.length > 0 ? signinMethods.join(', ') : '—';

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-lg">
      {/* Back link (full-page /account route only) — hidden inside
          PreferencesModal.tsx (hideBackLink, 2026-08-18), whose Dialog already
          has its own ✕ close button; a second text link was redundant. */}
      {!hideBackLink && (
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
      )}

      {/* Account info */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Your account</h2>
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] text-[var(--muted)]">Email</span>
            <span className="text-[13px] text-[var(--text)] font-medium">{email}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] text-[var(--muted)]">Role</span>
            <span className={[
              'text-[12px] font-medium px-[8px] py-[2px] rounded-[5px]',
              role === 'admin'
                ? 'bg-[var(--accent-wash)] text-[var(--accent-ink)]'
                : 'bg-[var(--elev)] text-[var(--muted)]',
            ].join(' ')}>
              {role}
            </span>
          </div>
          {/* Sign-in method — read-only (Plan 06 §7.2, Phase 4.4) */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] text-[var(--muted)]">Signed in with</span>
            <span className="text-[13px] text-[var(--text)] font-medium">{signinDisplay}</span>
          </div>
        </div>
      </section>

      {/* Log sharing consent (§5.6) */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Activity log sharing</h2>
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] p-4 space-y-4">
          <div>
            <p className="text-[13px] text-[var(--text)] mb-2">
              Share prompt and response content with the admin
            </p>
            <p className="text-[12px] text-[var(--muted)] leading-[1.5]">
              The admin can always see <strong>metadata</strong> for your AI calls — which agent,
              when, how many tokens — to audit the shared API key. If you enable this, they can
              also read the <strong>text of your instructions and the AI&apos;s replies</strong>.
            </p>
            <p className="text-[12px] text-[var(--faint)] mt-2 leading-[1.5]">
              Changing this preference is <strong>not retroactive in either direction</strong>:
              turning sharing on does not expose past private calls; turning it off does not hide
              past shared calls. Only future calls are affected.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleToggle}
              disabled={saving}
              className={[
                'flex-none w-10 h-6 rounded-full border transition-colors cursor-pointer disabled:opacity-50',
                sharing
                  ? 'bg-[var(--accent)] border-[var(--accent)]'
                  : 'bg-[var(--bg)] border-[var(--border)]',
              ].join(' ')}
              title={sharing ? 'Sharing — click to make private' : 'Private — click to share'}
            >
              <span
                className={[
                  'block w-4 h-4 rounded-full bg-white shadow transition-transform mt-[3px]',
                  sharing ? 'translate-x-[18px]' : 'translate-x-[3px]',
                ].join(' ')}
              />
            </button>
            <span className="text-[13px] text-[var(--text)]">
              {sharing ? 'Sharing with admin' : 'Private (not sharing)'}
            </span>
            {saved && (
              <span className="text-[12px] text-[var(--ok)]">Saved</span>
            )}
          </div>

          {error && (
            <p className="text-[12px] text-[var(--err)]">{error}</p>
          )}
        </div>
      </section>

      {/* API tokens (Plan 13 — MCP access) */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-[var(--text)]">API tokens (MCP access)</h2>
          {!showCreateForm && (
            <button
              onClick={() => { setShowCreateForm(true); setCreateError(null); }}
              className="text-[12px] px-3 py-1 rounded-[6px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-opacity cursor-pointer"
            >
              + New token
            </button>
          )}
        </div>

        {/* One-time plaintext reveal */}
        {revealedPlaintext && (
          <div className="mb-4 bg-[var(--panel)] border border-[var(--ok)] rounded-[9px] p-4 space-y-2">
            <p className="text-[12px] text-[var(--ok)] font-medium">
              Token created — copy it now. You will not see this again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] font-mono text-[var(--text)] bg-[var(--elev)] px-2 py-1 rounded break-all">
                {revealedPlaintext}
              </code>
              <button
                onClick={() => void handleCopy()}
                className="flex-none text-[12px] px-3 py-1 rounded-[6px] bg-[var(--elev)] text-[var(--text)] hover:bg-[var(--border)] transition-colors cursor-pointer"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              Use with:{' '}
              <code className="font-mono">claude mcp add --transport http myagent &lt;url&gt; --header &quot;Authorization: Bearer &lt;token&gt;&quot;</code>
            </p>
            <button
              onClick={() => setRevealedPlaintext(null)}
              className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Create form */}
        {showCreateForm && (
          <div className="mb-4 bg-[var(--panel)] border border-[var(--border)] rounded-[9px] p-4 space-y-3">
            <div className="space-y-2">
              <label className="block text-[12px] text-[var(--muted)]">Token name</label>
              <input
                type="text"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder="e.g. laptop Claude Code"
                className="w-full text-[13px] bg-[var(--elev)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[var(--text)] placeholder:text-[var(--faint)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[12px] text-[var(--muted)]">Scope</label>
              <select
                value={newTokenScope}
                onChange={(e) => setNewTokenScope(e.target.value as 'read' | 'write')}
                className="text-[13px] bg-[var(--elev)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[var(--text)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
              >
                <option value="read">read — list, view, export agents</option>
                <option value="write">write — also import/update agents (requires mcpWrites setting)</option>
              </select>
            </div>
            {createError && <p className="text-[12px] text-[var(--err)]">{createError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => void handleCreateToken()}
                disabled={creating || !newTokenName.trim()}
                className="text-[12px] px-3 py-1 rounded-[6px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create token'}
              </button>
              <button
                onClick={() => { setShowCreateForm(false); setNewTokenName(''); setCreateError(null); }}
                className="text-[12px] px-3 py-1 rounded-[6px] bg-[var(--elev)] text-[var(--text)] hover:bg-[var(--border)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Token list */}
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] divide-y divide-[var(--border)]">
          {tokensLoading && (
            <div className="px-4 py-3 text-[13px] text-[var(--muted)]">Loading…</div>
          )}
          {!tokensLoading && tokensError && (
            <div className="px-4 py-3 text-[12px] text-[var(--err)]">{tokensError}</div>
          )}
          {!tokensLoading && !tokensError && tokens.length === 0 && (
            <div className="px-4 py-3 text-[13px] text-[var(--muted)]">No tokens yet.</div>
          )}
          {tokens.map((token) => (
            <div key={token.id} className="flex items-center justify-between px-4 py-3 gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-[var(--text)] font-medium truncate">{token.name}</span>
                  <span className={[
                    'flex-none text-[11px] px-[6px] py-[1px] rounded-[4px]',
                    token.scope === 'write'
                      ? 'bg-[var(--warn-wash,#fef3c7)] text-[var(--warn-ink,#92400e)]'
                      : 'bg-[var(--elev)] text-[var(--muted)]',
                  ].join(' ')}>
                    {token.scope}
                  </span>
                  {token.revokedAt && (
                    <span className="flex-none text-[11px] px-[6px] py-[1px] rounded-[4px] bg-[var(--err-wash,#fee2e2)] text-[var(--err)]">
                      revoked
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--muted)] mt-[2px]">
                  <code className="font-mono">{token.prefix}…</code>
                  {' · '}
                  created {new Date(token.createdAt).toLocaleDateString()}
                  {token.lastUsedAt && ` · last used ${new Date(token.lastUsedAt).toLocaleDateString()}`}
                </div>
              </div>
              {!token.revokedAt && (
                <button
                  onClick={() => void handleRevokeToken(token.id)}
                  className="flex-none text-[12px] px-2 py-1 rounded-[5px] text-[var(--err)] hover:bg-[var(--err-wash,#fee2e2)] transition-colors cursor-pointer"
                  title="Revoke this token"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[var(--muted)] mt-2 leading-[1.5]">
          A leaked token grants full read (or write) access to your agents —
          treat it like a password. Revocation takes effect immediately on the next call.
        </p>
      </section>
    </div>
  );
}
