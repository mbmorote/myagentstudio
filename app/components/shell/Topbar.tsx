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
 *
 * Right-to-left order: theme toggle · ⚙ System Settings (admin only) ·
 * Account (always) · signed-in email · Logout.
 *
 * Matches the mockup's .topbar. No layout switcher — Example A is the only
 * layout (R10).
 */

import { useState } from 'react';
import Link from 'next/link';
import type { Session } from '@/lib/auth/session';
import { apiFetch } from '@/lib/apiFetch';
import { SettingsModal } from '@/app/components/Settings/SettingsModal';

interface TopbarProps {
  session: Session;
}

export function Topbar({ session }: TopbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

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

        {/* Account — always visible (§5.7) */}
        <Link
          href="/account"
          className="text-[12px] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[7px] px-[11px] py-[5px] hover:text-[var(--text)] transition-colors"
        >
          Account
        </Link>

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
