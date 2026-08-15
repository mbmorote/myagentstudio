'use client';

/**
 * app/components/shell/Topbar.tsx
 *
 * Plan 03 Phase B, B.5 — Brand bar with theme toggle.
 * Plan 04 Phase 4.5 — ⚙ Settings link (§5.4, §11 step 4.5).
 * Plan 05 Phase 4.4 — session prop, email display, Logout, Account link,
 *   admin-only System Settings link (§5.7). The old plain "⚙ Settings" link
 *   is replaced by two distinctly labelled entry points so neither reads as
 *   "the settings page" (the ambiguity this split exists to remove).
 * Roadmap TODO item 6 (2026-08-06) — "⚙ System Settings" changed from a
 *   <Link href="/settings"> full-page nav to a button opening SettingsModal,
 *   so opening Settings no longer unmounts the workbench (and loses ChatPanel's
 *   in-memory message history). See SettingsModal.tsx for the data/scope notes.
 * 2026-08-12 — "Account" changed the same way, to AccountModal. See
 *   AccountModal.tsx for the data/scope notes (one real difference from
 *   Settings: GET /api/account needed extending to also return hasPassword
 *   and linkedAccounts' providerEmail).
 *
 * Right-to-left order: theme toggle · ⚙ System Settings (admin only) ·
 * Account (always) · signed-in email · Logout.
 *
 * Matches the mockup's .topbar. No layout switcher — Example A is the only
 * layout (R10).
 */

import { useState } from 'react';
import type { Session } from '@/lib/auth/session';
import { apiFetch } from '@/lib/apiFetch';
import { SettingsModal } from '@/app/components/Settings/SettingsModal';
import { AccountModal } from '@/app/components/Account/AccountModal';

interface TopbarProps {
  session: Session;
  /** Replays the guided tour (Plan 12, GuidedTour.tsx) regardless of its localStorage
   *  seen-flag — owned by WorkbenchShell since it's a sibling of GuidedTour there. */
  onReplayTour?: () => void;
}

export function Topbar({ session, onReplayTour }: TopbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  function toggleTheme() {
    const root = document.documentElement;
    const current =
      root.getAttribute('data-theme') ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
  }

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Continue with navigation regardless of network errors
    }
    window.location.href = '/login';
  }

  return (
    <div className="flex-none flex items-center gap-4 px-4 py-[9px] bg-[var(--panel)] border-b border-[var(--border)]">
      {/* Brand */}
      <div className="flex items-center gap-[9px] font-semibold tracking-[-0.01em] text-[var(--text)]">
        <span
          className="w-[9px] h-[9px] rounded-[2px] bg-[var(--accent)]"
          style={{ boxShadow: '0 0 0 3px var(--accent-wash)' }}
        />
        <span>Agent Workbench</span>
      </div>

      {/* Right side controls */}
      <div className="ml-auto flex items-center gap-2">
        {/* Guided tour replay (Plan 12, 2026-08-14) */}
        {onReplayTour && (
          <button
            onClick={onReplayTour}
            title="Replay the guided tour"
            className="text-[12px] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[7px] px-[11px] py-[5px] cursor-pointer hover:text-[var(--text)]"
          >
            ⓘ Guided tour
          </button>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="text-[12px] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[7px] px-[11px] py-[5px] cursor-pointer hover:text-[var(--text)]"
        >
          ◐ Theme
        </button>

        {/* System Settings — admin only (§5.7). Opens SettingsModal (2026-08-06,
            roadmap TODO item 6) instead of navigating to /settings. */}
        {session.role === 'admin' && (
          <>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-[12px] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[7px] px-[11px] py-[5px] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              ⚙ System Settings
            </button>
            <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
          </>
        )}

        {/* Account — always visible (§5.7). Opens AccountModal (2026-08-12) instead
            of navigating to /account. */}
        <button
          onClick={() => setAccountOpen(true)}
          className="text-[12px] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[7px] px-[11px] py-[5px] hover:text-[var(--text)] transition-colors cursor-pointer"
        >
          Account
        </button>
        <AccountModal open={accountOpen} onOpenChange={setAccountOpen} />

        {/* Signed-in email */}
        <span className="text-[12px] text-[var(--faint)] hidden sm:block">
          {session.email}
        </span>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="text-[12px] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[7px] px-[11px] py-[5px] cursor-pointer hover:text-[var(--text)]"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
