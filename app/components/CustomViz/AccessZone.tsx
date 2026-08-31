'use client';

/**
 * app/components/CustomViz/AccessZone.tsx
 *
 * Plan 15 — Share Agent, §4.9 surface B ("Owner Access zone"), relocated 2026-08-31:
 * originally speced as a third zone inside AgentView.tsx (D1's own resolution), moved
 * during layout review into the right-panel dock as the "Share" tab (see
 * RightDockPanel.tsx) — this component is the tab's content, not a zone. Owner-only,
 * matching WorkbenchShell's current scope: the page has no shared/read-only branch yet
 * (Plan 15 §6 step 10 — page.tsx viewer-scoped read — is not built), so every agent
 * reaching this component is being viewed by its owner.
 *
 * Two independent controls per constraint 5 (plans/15-share-agent.md §3): disabling the
 * link and revoking a person never imply each other — the Google Docs model, not a
 * single "make private" button.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';

interface AccessZoneProps {
  agentId: string;
}

interface ShareRow {
  id: string;
  recipientEmail: string;
  grantedVia: string;
  createdAt: string;
}

interface SharesState {
  publicCode: string | null;
  shares: ShareRow[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Icons — inline stroke SVGs, matching the dock's Raw-tab icon treatment (no
//    emoji/dingbats) ──────────────────────────────────────────────────────────

function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 11.5 11.5 8.5" />
      <path d="M9.8 6.6 11 5.4a2.6 2.6 0 0 1 3.6 3.6l-1.2 1.2" />
      <path d="M10.2 13.4 9 14.6a2.6 2.6 0 0 1-3.6-3.6l1.2-1.2" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="7" width="9" height="9" rx="1.8" />
      <path d="M13 7V5.8A1.8 1.8 0 0 0 11.2 4H5.8A1.8 1.8 0 0 0 4 5.8v5.4A1.8 1.8 0 0 0 5.8 13H7" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 10.5 8 14l7-8" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function AccessZone({ agentId }: AccessZoneProps) {
  const [state, setState] = useState<SharesState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch(`/api/agents/${agentId}/shares`)
      .then(async (res) => {
        if (!res.ok) {
          setError(`Failed to load (${res.status})`);
          return;
        }
        const data = await res.json();
        setState({ publicCode: data.publicCode ?? null, shares: data.shares ?? [] });
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleEnableLink() {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/agents/${agentId}/share-link`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setState((prev) => (prev ? { ...prev, publicCode: data.publicCode } : prev));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDisableLink() {
    if (!window.confirm('Disable this share link? It stops working immediately and permanently — re-enabling later makes a brand-new code, never this one again.')) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/agents/${agentId}/share-link`, { method: 'DELETE' });
      if (res.ok) {
        setState((prev) => (prev ? { ...prev, publicCode: null } : prev));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyCode() {
    if (!state?.publicCode) return;
    try {
      await navigator.clipboard.writeText(state.publicCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available — no-op, matching AccountView's established fallback
    }
  }

  async function handleAddEmail() {
    const email = addDraft.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setAddError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setAddError(null);
    try {
      const res = await apiFetch(`/api/agents/${agentId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail: email }),
      });
      if (res.ok) {
        const share = await res.json();
        setState((prev) => {
          if (!prev) return prev;
          const exists = prev.shares.some((s) => s.id === share.id);
          return exists ? prev : { ...prev, shares: [...prev.shares, share] };
        });
        setAddOpen(false);
        setAddDraft('');
      } else {
        const data = await res.json().catch(() => ({}));
        setAddError(
          data.error === 'cannot_share_with_self'
            ? "That's your own address — you already have full access."
            : 'Enter a valid email address.',
        );
      }
    } catch {
      setAddError('Network error.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(shareId: string) {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/agents/${agentId}/shares/${shareId}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        setState((prev) => (prev ? { ...prev, shares: prev.shares.filter((s) => s.id !== shareId) } : prev));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="p-[18px] text-[12px] text-[var(--faint)]">Loading…</div>;
  }
  if (error || !state) {
    return <div className="p-[18px] text-[12px] text-[var(--err)]">{error ?? 'Failed to load'}</div>;
  }

  return (
    <div className="p-[18px] pb-[16px] flex flex-col gap-[18px]">
      {/* ── Share link ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-[10px]">
        <div className="flex items-center gap-[7px]">
          <span className="flex text-[var(--muted)]"><LinkIcon /></span>
          <span className="text-[10.5px] font-bold tracking-[.07em] uppercase text-[var(--muted)]">Share link</span>
          <span
            className={`ml-auto text-[9.5px] font-bold tracking-[.04em] uppercase px-[8px] py-[3px] rounded-full ${
              state.publicCode ? 'text-[#1e7a45] bg-[rgba(47,158,95,.14)]' : 'text-[var(--muted)] bg-[var(--bg)]'
            }`}
          >
            {state.publicCode ? 'On' : 'Off'}
          </span>
        </div>

        {state.publicCode ? (
          <>
            <div className="flex items-center gap-[8px] bg-[var(--elev)] border border-[var(--border)] rounded-[8px] pl-[12px] pr-[8px] py-[8px]">
              <code className="flex-1 min-w-0 font-mono text-[11.5px] text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap">
                {state.publicCode}
              </code>
              <button
                type="button"
                title="Copy link"
                onClick={handleCopyCode}
                className="flex-none w-[26px] h-[26px] rounded-[6px] border border-transparent bg-transparent text-[var(--faint)] cursor-pointer flex items-center justify-center hover:bg-[var(--bg)] hover:text-[var(--text)] hover:border-[var(--border)]"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleDisableLink}
              className="self-start text-[11.5px] font-semibold text-[var(--err)] bg-transparent border-none p-0 cursor-pointer hover:underline disabled:opacity-50"
            >
              Disable link
            </button>
          </>
        ) : (
          <div className="flex items-center justify-between gap-[12px] bg-[var(--elev)] border border-dashed border-[var(--border)] rounded-[8px] px-[14px] py-[12px]">
            <span className="text-[12px] text-[var(--faint)] italic">Link sharing is off</span>
            <button
              type="button"
              disabled={busy}
              onClick={handleEnableLink}
              className="text-[11.5px] font-semibold text-white bg-[var(--accent)] border border-[var(--accent)] rounded-[7px] px-[14px] py-[7px] cursor-pointer whitespace-nowrap hover:brightness-[1.08] disabled:opacity-50"
            >
              Enable link
            </button>
          </div>
        )}
      </section>

      <div className="h-px bg-[var(--border)]" />

      {/* ── People with access ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-[10px]">
        <div className="flex items-center gap-[7px]">
          <span className="text-[10.5px] font-bold tracking-[.07em] uppercase text-[var(--muted)]">People with access</span>
          {state.shares.length > 0 && (
            <span className="ml-auto text-[10.5px] font-bold text-[var(--muted)] bg-[var(--bg)] rounded-full px-[8px] py-[2px]">
              {state.shares.length}
            </span>
          )}
        </div>

        {state.shares.length > 0 ? (
          <div className="flex flex-col gap-[2px]">
            {state.shares.map((s) => (
              <div key={s.id} className="group flex items-center gap-[10px] px-[6px] py-[7px] rounded-[7px] hover:bg-[var(--bg)]">
                <span className="flex-none w-[24px] h-[24px] rounded-[6px] bg-[var(--elev)] border border-[var(--border)] flex items-center justify-center text-[10.5px] font-bold text-[var(--muted)]">
                  {s.recipientEmail[0]?.toUpperCase()}
                </span>
                <div className="flex flex-col min-w-0 gap-[1px]">
                  <span className="text-[12px] text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap">
                    {s.recipientEmail}
                  </span>
                  <span className="text-[10.5px] text-[var(--faint)]">
                    {s.grantedVia === 'code' ? 'redeemed the link' : 'added by you'} · {formatDate(s.createdAt)}
                  </span>
                </div>
                <button
                  type="button"
                  title={`Revoke ${s.recipientEmail}'s access`}
                  disabled={busy}
                  onClick={() => handleRevoke(s.id)}
                  className="ml-auto flex-none w-[22px] h-[22px] rounded-[6px] border border-transparent bg-transparent text-[var(--faint)] cursor-pointer flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-[var(--err)] hover:bg-[var(--elev)] hover:border-[var(--border)] disabled:opacity-50"
                >
                  <XIcon />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-[var(--faint)] italic px-[2px] py-[4px]">No one has access yet.</div>
        )}

        {addOpen ? (
          <div className="flex flex-col gap-[6px]">
            <div className="flex gap-[6px]">
              <input
                type="text"
                autoFocus
                placeholder="name@example.com"
                value={addDraft}
                onChange={(e) => setAddDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddEmail();
                  if (e.key === 'Escape') { setAddOpen(false); setAddError(null); }
                }}
                className="flex-1 font-inherit text-[12px] px-[10px] py-[6px] border border-[var(--border)] rounded-[7px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleAddEmail()}
                className="text-[11.5px] font-semibold text-white bg-[var(--accent)] border border-[var(--accent)] rounded-[7px] px-[12px] py-[6px] cursor-pointer hover:brightness-[1.08] disabled:opacity-50"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setAddOpen(false); setAddError(null); }}
                className="text-[11.5px] font-semibold text-[var(--muted)] bg-transparent border border-[var(--border)] rounded-[7px] px-[12px] py-[6px] cursor-pointer hover:text-[var(--text)]"
              >
                Cancel
              </button>
            </div>
            {addError && <div className="text-[10.5px] text-[var(--err)]">{addError}</div>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="self-start inline-flex items-center gap-[6px] text-[11.5px] font-semibold text-[var(--muted)] bg-transparent border border-dashed border-[var(--border)] rounded-[7px] px-[12px] py-[7px] cursor-pointer hover:text-[var(--text)] hover:border-[var(--faint)] hover:border-solid"
          >
            <PlusIcon /> Add by email
          </button>
        )}
      </section>

      <div className="pt-[14px] border-t border-[var(--border)] text-[10.5px] leading-[1.55] text-[var(--faint)]">
        Everyone with access here — whether they redeemed the link or were added by email — can view this agent,
        never edit it. Revoke anyone&apos;s access, or disable the link, at any time; a disabled link is dead for
        good, and re-enabling always issues a brand-new one.
      </div>
    </div>
  );
}
