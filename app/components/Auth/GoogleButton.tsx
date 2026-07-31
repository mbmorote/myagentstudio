'use client';

/**
 * app/components/Auth/GoogleButton.tsx
 *
 * Shared "Continue with Google" OAuth entry point (Plan 06 Phase 4.3, §7.2).
 *
 * Calls POST /api/auth/oauth/google/start via apiFetch (constraint: no bare
 * fetch in app/components/*, §10.4 Gate 4). The start route never returns 401,
 * so apiFetch's 401→/login redirect is harmless here (the plan's own rationale
 * for using apiFetch for consistency despite the 401 behaviour mismatch).
 *
 * On success, navigates to the returned authorizeUrl with window.location.assign.
 * On any error, displays an inline message below the button.
 *
 * The `disabled` prop is the external precondition gate: the parent form is
 * responsible for enforcing invite-code-filled AND consent-answered before
 * enabling this button on the signup page (§7.2 — a UI mistake here cannot
 * bypass the server's tx.consent === true enforcement, but the user must be
 * *asked*, not just silently defaulted).
 */

import { useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

interface GoogleButtonProps {
  mode: 'login' | 'signup';
  /** The invite code — required when mode === 'signup'. */
  inviteCode?: string;
  /** Whether to share logs with admin — required when mode === 'signup'. */
  shareLogsWithAdmin?: boolean;
  /** Optional post-login destination (single-leading-slash path). */
  next?: string;
  /** When true the button is disabled and cannot be clicked. */
  disabled?: boolean;
}

export function GoogleButton({
  mode,
  inviteCode,
  shareLogsWithAdmin,
  next,
  disabled,
}: GoogleButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { mode };
      if (mode === 'signup') {
        body.inviteCode = inviteCode;
        body.shareLogsWithAdmin = shareLogsWithAdmin;
      }
      if (next) body.next = next;

      const res = await apiFetch('/api/auth/oauth/google/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        const data = (await res.json()) as { retryAfterSeconds?: number };
        const secs = data.retryAfterSeconds ?? 60;
        setError(`Too many attempts. Try again in ${secs} seconds.`);
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError('Could not start Google sign-in. Please try again.');
        setBusy(false);
        return;
      }

      const data = (await res.json()) as { authorizeUrl: string };
      // Navigate to Google — page is leaving, intentionally leave busy=true
      window.location.assign(data.authorizeUrl);
    } catch {
      setError('Network error. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || !!disabled}
        className="w-full flex items-center justify-center gap-2 py-2 px-3 text-[13px] font-medium border border-[var(--border)] rounded-[7px] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--elev)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {/* Google G logo */}
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        {busy ? 'Connecting…' : 'Continue with Google'}
      </button>
      {error && (
        <p className="mt-2 text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)] rounded-[6px] px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
