'use client';

/**
 * app/components/Settings/PreferencesModal.tsx
 *
 * Merged Account + Settings modal (2026-08-18) — replaces the old separate
 * SettingsModal.tsx (admin-only "⚙ System Settings") and AccountModal.tsx
 * ("Account", everyone) with ONE modal opened from ONE topbar button, a left
 * sidebar of categories inside. Prototyped first in
 * architecture/layout/Layout-Workbench.html per CLAUDE.md standing rule 4;
 * this is the real-code migration of that prototype.
 *
 * Categories:
 *   - Account   — everyone. Reuses AccountView.tsx unchanged (this modal fetches
 *                 GET /api/account and passes props, exactly like the retired
 *                 AccountModal.tsx did).
 *   - LLM       — admin only. LlmSettingsPane.tsx.
 *   - Admin     — admin only. AdminSettingsPane.tsx (platform settings, access
 *                 requests, invite codes, users).
 *   - Activity log — everyone, scoped by role server-side. ActivityLogPane.tsx.
 * A non-admin's sidebar lists Account + Activity log only — LLM/Admin are
 * absent, not greyed out (2026-08-18 decision).
 *
 * Each pane is mounted only while active (not kept hidden-but-mounted) — data
 * is cheap (a handful of settings rows, activity log capped at 200) so a brief
 * "Loading…" on tab switch is an acceptable trade for a much simpler component
 * than four permanently-mounted subtrees.
 *
 * SettingsView.tsx and AccountView.tsx's full-page routes (/settings, /account)
 * are deliberately left untouched — /settings still admin-gated and still the
 * Activity log Permalink's target (see ActivityLogPane.tsx), /account still
 * reachable directly though no longer linked from the topbar.
 */

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/apiFetch';
import type { Session } from '@/lib/auth/session';
import { AccountView } from '@/app/components/Account/AccountView';
import { LlmSettingsPane } from './LlmSettingsPane';
import { AdminSettingsPane } from './AdminSettingsPane';
import { ActivityLogPane } from './ActivityLogPane';

type Category = 'account' | 'llm' | 'admin' | 'activity';

interface AccountData {
  email: string;
  role: 'admin' | 'user';
  shareLogsWithAdmin: boolean;
  hasPassword: boolean;
  linkedAccounts: { provider: string; providerEmail: string | null }[];
}

interface PreferencesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
}

export function PreferencesModal({ open, onOpenChange, session }: PreferencesModalProps) {
  const isAdmin = session.role === 'admin';
  const [category, setCategory] = useState<Category>('account');

  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Re-fetch fresh on every open (mirrors the retired AccountModal.tsx).
  useEffect(() => {
    if (!open) return;
    setAccountData(null);
    setAccountError(null);
    setCategory('account');

    apiFetch('/api/account')
      .then((res) => {
        if (!res.ok) throw new Error('account');
        return res.json() as Promise<AccountData>;
      })
      .then(setAccountData)
      .catch(() => setAccountError('Failed to load account. Please try again.'));
  }, [open]);

  const navItems: { cat: Category; label: string; icon: string; adminOnly: boolean }[] = [
    { cat: 'account', label: 'Account', icon: '👤', adminOnly: false },
    { cat: 'llm', label: 'LLM', icon: '⚡', adminOnly: true },
    { cat: 'admin', label: 'Admin', icon: '🛠', adminOnly: true },
    { cat: 'activity', label: 'Activity log', icon: '📜', adminOnly: false },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent's own base classes (components/ui/dialog.tsx) include
          `grid gap-4 p-6` — grid must be overridden to `flex flex-col` (and
          gap-4 to gap-0) or the inner flex/h-full chain below has no real
          bounded height to work against and silently never scrolls (found in
          browser review, 2026-08-18). twMerge (via cn()) resolves each
          same-property conflict in favor of whichever is listed last, so these
          overrides only work because they're passed here, not because of
          class-string order. */}
      <DialogContent className="flex flex-col gap-0 bg-[var(--panel)] border-[var(--border)] text-[var(--text)] max-w-5xl h-[700px] max-h-[85vh] overflow-hidden p-0">
        {/* Visually hidden — the sidebar's active category already provides context.
            sr-only is position:absolute, so these don't consume flex space. */}
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Account, LLM, Admin, and Activity log settings
        </DialogDescription>

        <div className="flex flex-1 min-h-0">
          {/* ── Sidebar ─────────────────────────────────────────────────── */}
          <nav className="flex-none w-[190px] border-r border-[var(--border)] py-3 px-2 overflow-y-auto">
            {navItems
              .filter((item) => !item.adminOnly || isAdmin)
              .map((item) => (
                <button
                  key={item.cat}
                  onClick={() => setCategory(item.cat)}
                  className={[
                    'w-full text-left text-[12.5px] px-[10px] py-2 rounded-[7px] mb-[2px] flex items-center gap-2 cursor-pointer transition-colors',
                    category === item.cat
                      ? 'bg-[var(--accent-wash)] text-[var(--accent-ink)] font-semibold'
                      : 'text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)]',
                  ].join(' ')}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
          </nav>

          {/* ── Active pane ─────────────────────────────────────────────── */}
          {/* min-h-0 is required here: a flex item defaults to min-height:auto,
              which refuses to shrink below its content size and silently breaks
              overflow-y-auto — the content just gets clipped by the Dialog's own
              overflow-hidden instead of scrolling (found in browser review,
              2026-08-18). */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {category === 'account' && (
              accountError ? (
                <p className="p-6 text-[12px] text-[var(--err)]">{accountError}</p>
              ) : accountData ? (
                <AccountView
                  email={accountData.email}
                  role={accountData.role}
                  shareLogsWithAdmin={accountData.shareLogsWithAdmin}
                  hasPassword={accountData.hasPassword}
                  linkedAccounts={accountData.linkedAccounts}
                  hideBackLink
                />
              ) : (
                <p className="p-6 text-[12px] text-[var(--faint)]">Loading…</p>
              )
            )}
            {category === 'llm' && isAdmin && <LlmSettingsPane />}
            {category === 'admin' && isAdmin && <AdminSettingsPane />}
            {category === 'activity' && <ActivityLogPane isAdmin={isAdmin} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
