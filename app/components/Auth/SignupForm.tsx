'use client';

/**
 * app/components/Auth/SignupForm.tsx
 *
 * Client component for the /signup page (Plan 06 Phase 4.2, §7.2, §5.4).
 *
 * Extracted from app/signup/page.tsx so that the server page.tsx can call
 * isOAuthConfigured() and pass it as a prop (§5.4 chosen design — no client
 * fetch, no NEXT_PUBLIC_, no render flash).
 *
 * Uses useSearchParams() to read the ?error= vocabulary from OAuth callback
 * redirects to /signup (§7.3). The server page.tsx wraps this component in
 * <Suspense> so Next 15 static rendering does not throw on useSearchParams().
 *
 * Activity-log-sharing consent (§5.6) is deliberately NOT asked here. Every new
 * account is created with shareLogsWithAdmin: true ("share by default", flipped
 * 2026-08-18 — was false/"keep private" before); the choice to opt out is offered
 * afterward as a dismissible popup on first load of the main app (WorkbenchShell),
 * so it never blocks or gates account creation. This is a conscious supersession
 * of §5.6/§7.2's original "must answer before submit" design — see
 * plans/archive/06-auth-review-google-oauth.md's Phase 5 note for the original
 * context (that note predates the 2026-08-18 default flip).
 * SIGNUP_CONSENT_FLAG_KEY is the handoff: set here right before navigating to
 * '/', read once by WorkbenchShell, then cleared.
 *
 * Note: bare fetch() for /api/auth/signup is intentional — NOT apiFetch. This
 * endpoint returns 401 for session issues but also returns non-401 errors for
 * wrong credentials (invalid_invite_code, etc.), and the password path needs to
 * render those inline. This file is excluded from the no-bare-fetch fitness
 * test (route-guard.test.ts) for the same reason as LoginForm.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { GoogleButton } from './GoogleButton';
import { SIGNUP_CONSENT_FLAG_KEY } from '@/lib/auth/consentPopupFlag';
import { REFERRAL_SOURCES, REFERRAL_SOURCE_LABELS, type ReferralSource } from '@/lib/auth/referralSource';

/**
 * Closed vocabulary of ?error= codes sent by the OAuth callback to /signup (§7.3).
 * An unknown code renders the generic fallback — the raw value is NEVER rendered.
 *
 * invalid_invite_code and signups_closed reuse the existing signup copy (§7.3 note).
 */
const SIGNUP_ERROR_MESSAGES: Record<string, string> = {
  oauth_no_account: 'No account yet. Sign up with an invite code first.',
  // These two reuse the same copy already shown for the password signup path:
  invalid_invite_code: 'Invalid or already-used invite code. Ask the admin for a new one.',
  signups_closed: 'Signups are currently closed. The admin can increase the user limit.',
};

const SIGNUP_ERROR_FALLBACK = 'Something went wrong. Please try again.';

interface SignupFormProps {
  oauthConfigured: boolean;
  /** When true, renders just the card (no full-viewport centering wrapper) — for use
   *  inside a modal that already provides its own backdrop/centering (Plan 12,
   *  WelcomePage.tsx's "Get started" modal, 2026-08-14). The standalone /signup page
   *  omits this. Same pattern as LoginForm.tsx's `embedded` prop. */
  embedded?: boolean;
  /** When set (embedded mode only), "Sign in" switches to the login modal instead of
   *  navigating to /login — same reasoning as LoginForm.tsx's onSwitchToSignup. */
  onSwitchToLogin?: () => void;
  /** Which of the two sub-forms (invite-code signup vs. no-code request-access) opens
   *  first. Defaults to 'signup' — right for the standalone /signup page (a visitor who
   *  typed the URL directly usually already has a code) and for LoginForm's "Sign up"
   *  switch-over (same assumption). WelcomePage.tsx's "Get started — ask for an invite"
   *  CTA overrides this to 'request', since that button's own label promises the
   *  no-code flow — opening the code-required form first there is the wrong default. */
  initialMode?: 'signup' | 'request';
}

export function SignupForm({
  oauthConfigured,
  embedded = false,
  onSwitchToLogin,
  initialMode = 'signup',
}: SignupFormProps) {
  // Read ?error= from the OAuth callback redirect (§7.3).
  // Match against the closed vocabulary — never render the raw value.
  const searchParams = useSearchParams();
  const errorCode = searchParams.get('error');
  const oauthErrorMessage = errorCode
    ? (SIGNUP_ERROR_MESSAGES[errorCode] ?? SIGNUP_ERROR_FALLBACK)
    : null;

  const [inviteCode, setInviteCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── "Request access" — for visitors without an invite code (Plan 12, 2026-08-14) ──
  // A toggle inside this same component, not a separate route/page, so it works both
  // standalone (/signup) and inside WelcomePage's modal for free.
  const [mode, setMode] = useState<'signup' | 'request'>(initialMode);
  const [requestName, setRequestName] = useState('');
  const [requestEmail, setRequestEmail] = useState('');
  const [requestSource, setRequestSource] = useState<ReferralSource | ''>('');
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function handleRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (requestSubmitting) return;
    setRequestError(null);
    setRequestSubmitting(true);

    try {
      const res = await fetch('/api/auth/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: requestName.trim(),
          email: requestEmail.trim(),
          referralSource: requestSource || undefined,
        }),
      });

      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { retryAfterSeconds?: number };
        const secs = body.retryAfterSeconds ?? 60;
        setRequestError(`Too many attempts. Try again in ${secs} seconds.`);
        return;
      }
      if (!res.ok) {
        setRequestError('Something went wrong. Please try again.');
        return;
      }

      // The response is deliberately generic (see the API route) — the confirmation
      // shown here doesn't depend on it beyond "the request succeeded."
      setRequestSubmitted(true);
    } catch {
      setRequestError('Network error. Please try again.');
    } finally {
      setRequestSubmitting(false);
    }
  }

  const canSubmit = !submitting;

  // Precondition for the Google button: invite code field filled (the Google
  // button bypasses HTML form validation, so this is checked explicitly).
  const canSubmitGoogle = !submitting && inviteCode.trim() !== '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteCode: inviteCode.trim(),
          email: email.trim(),
          password,
          // Sharing is the default (flipped 2026-08-18, see file header) — the
          // post-signup popup is where a user opts out, not this form.
          shareLogsWithAdmin: true,
        }),
      });

      const body = (await res.json()) as {
        error?: string;
        retryAfterSeconds?: number;
        minLength?: number;
        maxBytes?: number;
      };

      if (res.status === 429) {
        const secs = body.retryAfterSeconds ?? 60;
        setError(`Too many attempts. Try again in ${secs} seconds.`);
        return;
      }
      if (!res.ok) {
        switch (body.error) {
          case 'invalid_invite_code':
            setError('Invalid or already-used invite code. Ask the admin for a new one.');
            break;
          case 'email_exists':
            setError('An account with that email already exists.');
            break;
          case 'signups_closed':
            setError('Signups are currently closed. The admin can increase the user limit.');
            break;
          case 'weak_password':
            setError(`Password must be at least ${body.minLength ?? 12} characters.`);
            break;
          case 'password_too_long':
            setError(`Password must be ${body.maxBytes ?? 72} bytes or fewer.`);
            break;
          case 'invalid_email':
            setError('Please enter a valid email address.');
            break;
          default:
            setError('Signup failed. Please try again.');
        }
        return;
      }

      sessionStorage.setItem(SIGNUP_CONSENT_FLAG_KEY, '1');
      window.location.href = '/';
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const card = (
      <div className={embedded ? 'w-full' : 'w-full max-w-sm border border-[var(--border)] rounded-[14px] bg-[var(--elev)] p-8'}>
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

        <h1 className="text-[20px] font-semibold text-[var(--text)] mb-1">
          {mode === 'signup' ? 'Create an account' : 'Request access'}
        </h1>
        <p className="text-[12px] text-[var(--muted)] mb-6">
          {mode === 'signup' ? (
            <>
              Don&apos;t have an invite code?{' '}
              <button
                type="button"
                onClick={() => setMode('request')}
                className="text-[var(--accent)] hover:underline bg-transparent border-none p-0 font-[inherit] cursor-pointer"
              >
                Request access
              </button>
            </>
          ) : (
            <>
              Have an invite code?{' '}
              <button
                type="button"
                onClick={() => setMode('signup')}
                className="text-[var(--accent)] hover:underline bg-transparent border-none p-0 font-[inherit] cursor-pointer"
              >
                Sign up
              </button>
            </>
          )}
        </p>

        {/* OAuth callback error (from ?error= query param — closed vocabulary only) */}
        {mode === 'signup' && oauthErrorMessage && (
          <p className="mb-4 text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)] rounded-[6px] px-3 py-2">
            {oauthErrorMessage}
          </p>
        )}

        {mode === 'request' ? (
          requestSubmitted ? (
            <p className="text-[13px] text-[var(--text)] bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[7px] px-3 py-3">
              Thanks — if we can offer you a spot, we&apos;ll email your invite code to{' '}
              <strong>{requestEmail.trim()}</strong> soon.
            </p>
          ) : (
            <form onSubmit={handleRequestSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-[.05em] mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={requestName}
                  onChange={(e) => setRequestName(e.target.value)}
                  autoComplete="name"
                  required
                  disabled={requestSubmitting}
                  className="w-full border border-[var(--border)] rounded-[7px] px-3 py-2 text-[13px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:[box-shadow:0_0_0_3px_var(--accent-wash)] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-[.05em] mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={requestEmail}
                  onChange={(e) => setRequestEmail(e.target.value)}
                  autoComplete="email"
                  required
                  disabled={requestSubmitting}
                  className="w-full border border-[var(--border)] rounded-[7px] px-3 py-2 text-[13px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:[box-shadow:0_0_0_3px_var(--accent-wash)] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-[.05em] mb-1">
                  How did you hear about us? <span className="normal-case font-normal text-[var(--faint)]">(optional)</span>
                </label>
                <select
                  value={requestSource}
                  onChange={(e) => setRequestSource(e.target.value as ReferralSource | '')}
                  disabled={requestSubmitting}
                  className="w-full border border-[var(--border)] rounded-[7px] px-3 py-2 text-[13px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:[box-shadow:0_0_0_3px_var(--accent-wash)] disabled:opacity-50"
                >
                  <option value="">Select one…</option>
                  {REFERRAL_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {REFERRAL_SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>

              {requestError && (
                <p className="text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)] rounded-[6px] px-3 py-2">
                  {requestError}
                </p>
              )}

              <button
                type="submit"
                disabled={requestSubmitting}
                className="w-full py-2 text-[13px] font-medium bg-[var(--accent)] text-white rounded-[7px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {requestSubmitting ? 'Sending…' : 'Request access'}
              </button>
            </form>
          )
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-[.05em] mb-1">
              Invite code
            </label>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              required
              disabled={submitting}
              className="w-full border border-[var(--border)] rounded-[7px] px-3 py-2 text-[13px] font-mono bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:[box-shadow:0_0_0_3px_var(--accent-wash)] disabled:opacity-50"
            />
          </div>

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
              autoComplete="new-password"
              required
              disabled={submitting}
              className="w-full border border-[var(--border)] rounded-[7px] px-3 py-2 text-[13px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:[box-shadow:0_0_0_3px_var(--accent-wash)] disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-[var(--faint)]">At least 12 characters.</p>
          </div>

          {/*
            No consent block here — every account is created with
            shareLogsWithAdmin: true (see file header). The choice to opt out is
            offered afterward as a dismissible popup on first load of the main app.
          */}

          {error && (
            <p className="text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)] rounded-[6px] px-3 py-2">
              {error}
            </p>
          )}

          {/* Google sign-in — disabled until the invite code field is filled. */}
          {oauthConfigured && (
            <>
              <GoogleButton
                mode="signup"
                inviteCode={inviteCode.trim()}
                disabled={!canSubmitGoogle}
              />
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[var(--border)]" />
                <span className="text-[11px] text-[var(--faint)]">or</span>
                <div className="flex-1 h-px bg-[var(--border)]" />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-2 text-[13px] font-medium bg-[var(--accent)] text-white rounded-[7px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        )}

        <p className="mt-6 text-[12px] text-[var(--muted)] text-center">
          Already have an account?{' '}
          {onSwitchToLogin ? (
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-[var(--accent)] hover:underline bg-transparent border-none p-0 font-[inherit] cursor-pointer"
            >
              Sign in
            </button>
          ) : (
            <Link href="/login" className="text-[var(--accent)] hover:underline">
              Sign in
            </Link>
          )}
        </p>
      </div>
  );

  if (embedded) return card;

  return (
    <div className="flex min-h-screen items-start justify-center bg-[var(--bg)] py-12 px-4">{card}</div>
  );
}
