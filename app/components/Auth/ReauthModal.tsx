'use client';

/**
 * app/components/Auth/ReauthModal.tsx
 *
 * In-place re-login modal (issue #14, 2026-08-28). Mounted once at the root
 * layout (app/layout.tsx) so it covers every apiFetch() call site, not just
 * the main workbench screen — a session can expire while the user is on
 * Settings, the Account panel, or anywhere else that calls apiFetch.
 *
 * Subscribes to apiFetch.ts's re-auth store via useSyncExternalStore (same
 * pattern as lib/proposalStore.ts) and renders only when a 401 is actually
 * pending re-auth. Reuses the real LoginForm in its existing `embedded` mode
 * (already built for /welcome's login modal — same visual, not a new design,
 * so this skips the Layout-Workbench.html mockup step per CLAUDE.md standing
 * rule 4's "trivial"/non-novel-visual carve-out) with the same modal
 * backdrop/card shell WelcomePage.tsx already uses. The only new plumbing is
 * `onLoginSuccess`, which resolves the shared apiFetch wait instead of
 * navigating away — apiFetch then retries the original in-flight request(s)
 * transparently ("resume in place").
 *
 * A user who cancels (✕ or backdrop click) is NOT re-authenticated — apiFetch
 * falls back to its old hard-navigate-to-/login behavior for every request
 * still waiting on this prompt.
 */

import { Suspense, useSyncExternalStore } from 'react';
import { LoginForm } from './LoginForm';
import { subscribeReauth, getReauthSnapshot, getReauthServerSnapshot, resolveReauth } from '@/lib/apiFetch';

export function ReauthModal({ oauthConfigured }: { oauthConfigured: boolean }) {
  const state = useSyncExternalStore(subscribeReauth, getReauthSnapshot, getReauthServerSnapshot);

  if (!state.needed) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-5"
      style={{ background: 'rgba(20,24,30,.55)' }}
      onClick={() => resolveReauth(false)}
    >
      <div
        className="relative w-[min(420px,94vw)] bg-[var(--elev)] border border-[var(--border)] rounded-[12px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)] p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => resolveReauth(false)}
          className="absolute top-[14px] right-[14px] bg-transparent border-none text-[16px] text-[var(--faint)] cursor-pointer p-[6px] hover:text-[var(--text)]"
          title="Cancel — you'll be sent to the login page instead"
        >
          ✕
        </button>
        <p className="mb-4 text-[12px] text-[var(--muted)]">
          Your session expired. Sign back in to continue where you left off.
        </p>
        <Suspense>
          <LoginForm
            oauthConfigured={oauthConfigured}
            embedded
            onLoginSuccess={() => resolveReauth(true)}
          />
        </Suspense>
      </div>
    </div>
  );
}
