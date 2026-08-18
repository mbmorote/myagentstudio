'use client';

/**
 * app/components/Auth/LoginForm.tsx
 *
 * Client component for the /login page (Plan 06 Phase 4.1, §7.2, §5.4).
 *
 * Extracted from app/login/page.tsx so that the server page.tsx can call
 * isOAuthConfigured() and pass it as a prop — one source of truth, no
 * client-side fetch, no NEXT_PUBLIC_ env var, no render flash (§5.4).
 *
 * Uses useSearchParams() to read the ?error= vocabulary from OAuth callback
 * redirects (§7.3). The server page.tsx wraps this component in <Suspense>
 * so Next 15 static rendering does not throw on useSearchParams().
 *
 * Note: this file uses bare fetch() for /api/auth/login intentionally — NOT
 * apiFetch. The login route returns 401 for wrong credentials, not for session
 * expiry; using apiFetch here would create a circular redirect (401 → redirect
 * to /login → loop). This file is excluded from the no-bare-fetch fitness test
 * (route-guard.test.ts) for this reason.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { GoogleButton } from './GoogleButton';

/** Validates the `next` parameter: must be a path starting with exactly one /. */
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  if (/^\/(?!\/)/.test(raw)) return raw;
  return '/';
}

/**
 * Closed vocabulary of ?error= codes sent by the OAuth callback to /login (§7.3).
 * An unknown code renders the generic fallback — the raw value is NEVER rendered
 * (prevents copy-injection via a hand-crafted URL).
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_cancelled: 'Sign-in cancelled.',
  oauth_state: "That sign-in link expired or didn't match. Please try again.",
  oauth_failed: 'Google sign-in failed. Please try again.',
  oauth_email_unverified:
    "Your Google account's email address isn't verified, so it can't be used to sign in here.",
};

const OAUTH_ERROR_FALLBACK = 'Something went wrong. Please try again.';

interface LoginFormProps {
  oauthConfigured: boolean;
  /** When true, renders just the card (no full-viewport centering wrapper) — for use
   *  inside a modal that already provides its own backdrop/centering (Plan 12,
   *  WelcomePage.tsx's login modal, 2026-08-14). The standalone /login page omits this. */
  embedded?: boolean;
  /** When set (embedded mode only), the two account-creation links below switch to the
   *  signup modal (in the given sub-mode) instead of navigating to /signup — keeps the
   *  modal flow from breaking out to a full-page nav mid-flow. Standalone /login has no
   *  modal to switch to, so it keeps plain Links (`/signup` and `/signup?mode=request`,
   *  the latter read by SignupForm itself — see its file header). */
  onSwitchToSignup?: (mode: 'signup' | 'request') => void;
}

export function LoginForm({ oauthConfigured, embedded = false, onSwitchToSignup }: LoginFormProps) {
  const searchParams = useSearchParams();
  const nextPath = safeNext(searchParams.get('next'));

  // Read ?error= from the OAuth callback redirect (§7.3).
  // Match against the closed vocabulary — never render the raw value.
  const errorCode = searchParams.get('error');
  const oauthErrorMessage = errorCode
    ? (OAUTH_ERROR_MESSAGES[errorCode] ?? OAUTH_ERROR_FALLBACK)
    : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.status === 429) {
        const body = (await res.json()) as { retryAfterSeconds?: number };
        const secs = body.retryAfterSeconds ?? 60;
        setFormError(`Too many attempts. Try again in ${secs} seconds.`);
        return;
      }
      if (res.status === 401) {
        setFormError('Incorrect email or password.');
        return;
      }
      if (!res.ok) {
        setFormError('Login failed. Please try again.');
        return;
      }

      window.location.href = nextPath;
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const card = (
      <div className={embedded ? 'w-full' : 'w-full max-w-sm mx-6 border border-[var(--border)] rounded-[14px] bg-[var(--elev)] p-8'}>
        {/* Brand */}
        <div className="flex items-center gap-[9px] mb-8">
          <span
            className="w-[9px] h-[9px] rounded-[2px] bg-[var(--accent)]"
            style={{ boxShadow: '0 0 0 3px var(--accent-wash)' }}
          />
          <span className="font-semibold tracking-[-0.01em] text-[var(--text)]">
            Agent Workbench
          </span>
        </div>

        <h1 className="text-[20px] font-semibold text-[var(--text)] mb-6">Sign in</h1>

        {/* OAuth callback error (from ?error= query param — closed vocabulary only) */}
        {oauthErrorMessage && (
          <p className="mb-4 text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)] rounded-[6px] px-3 py-2">
            {oauthErrorMessage}
          </p>
        )}

        {/* Google sign-in — shown above the password form when OAuth is configured (§5.4) */}
        {oauthConfigured && (
          <>
            <GoogleButton
              mode="login"
              next={nextPath !== '/' ? nextPath : undefined}
              disabled={submitting}
            />
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-[var(--border)]" />
              <span className="text-[11px] text-[var(--faint)]">or</span>
              <div className="flex-1 h-px bg-[var(--border)]" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-[.05em] mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              disabled={submitting}
              className="w-full border border-[var(--border)] rounded-[7px] px-3 py-2 text-[13px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:[box-shadow:0_0_0_3px_var(--accent-wash)] disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-[.05em] mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={submitting}
              className="w-full border border-[var(--border)] rounded-[7px] px-3 py-2 text-[13px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:[box-shadow:0_0_0_3px_var(--accent-wash)] disabled:opacity-50"
            />
          </div>

          {formError && (
            <p className="text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)] rounded-[6px] px-3 py-2">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 text-[13px] font-medium bg-[var(--accent)] text-white rounded-[7px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/*
          Static hint — shown unconditionally relative to input (§3.8, §5.4).
          Its purpose is anti-enumeration: it does NOT say "this email uses Google",
          it just tells every visitor that a Google path exists above. Only rendered
          when OAuth is actually configured (otherwise there is no button "above").
        */}
        {oauthConfigured && (
          <p className="mt-4 text-[12px] text-[var(--muted)] text-center">
            Signed up with Google? Use &ldquo;Continue with Google&rdquo; above.
          </p>
        )}

        <p className="mt-4 text-[12px] text-[var(--muted)] text-center">
          Have an invite code?{' '}
          {onSwitchToSignup ? (
            <button
              type="button"
              onClick={() => onSwitchToSignup('signup')}
              className="text-[var(--accent)] hover:underline bg-transparent border-none p-0 font-[inherit] cursor-pointer"
            >
              Sign up
            </button>
          ) : (
            <Link href="/signup" className="text-[var(--accent)] hover:underline">
              Sign up
            </Link>
          )}
        </p>
        <p className="mt-1 text-[12px] text-[var(--muted)] text-center">
          Don&apos;t have one?{' '}
          {onSwitchToSignup ? (
            <button
              type="button"
              onClick={() => onSwitchToSignup('request')}
              className="text-[var(--accent)] hover:underline bg-transparent border-none p-0 font-[inherit] cursor-pointer"
            >
              Request access
            </button>
          ) : (
            <Link href="/signup?mode=request" className="text-[var(--accent)] hover:underline">
              Request access
            </Link>
          )}
        </p>
      </div>
  );

  if (embedded) return card;

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg)]">{card}</div>
  );
}
