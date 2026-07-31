'use client';

/**
 * app/signup/page.tsx
 *
 * Invite-code-gated signup form (Plan 05 Phase 4.3, §4.2, §5.6, §16 item 10).
 *
 * The consent block (§5.6) is presented in the UX treatment of a cookie banner:
 *   - Its own bordered, visually distinct section with a heading
 *   - Two explicit action buttons (Share / Keep private)
 *   - No pre-selected answer; the form cannot be submitted without one
 *   - States plainly who sees the data, what they see, and why
 *   - States that the choice is changeable later at /account
 *
 * Invite codes are plaintext per §4.2 / §16 item 10.
 *
 * This page is exempt from the layout-mockup detour (§16.11).
 */

import { useState } from 'react';
import Link from 'next/link';

type ConsentChoice = 'share' | 'private' | null;

export default function SignupPage() {
  const [inviteCode, setInviteCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState<ConsentChoice>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !submitting && consent !== null;

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
          shareLogsWithAdmin: consent === 'share',
        }),
      });

      const body = (await res.json()) as { error?: string; retryAfterSeconds?: number; minLength?: number; maxBytes?: number };

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

      // Success — navigate to the workbench
      window.location.href = '/';
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-[var(--bg)] py-12 px-4">
      <div className="w-full max-w-sm">
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

        <h1 className="text-[20px] font-semibold text-[var(--text)] mb-6">Create an account</h1>

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

          {/* ── Consent block — cookie-banner style (§5.6) ─────────────────── */}
          <div className="border-2 border-[var(--border)] rounded-[9px] p-4 bg-[var(--elev)] space-y-3">
            <div>
              <h2 className="text-[13px] font-semibold text-[var(--text)] mb-1">
                Activity log sharing
              </h2>
              <p className="text-[12px] text-[var(--muted)] leading-[1.5]">
                This workbench uses one shared API key paid for by the admin (the person who set up
                this deployment). To audit usage, the admin can see <strong>metadata</strong> for
                every AI call — which agent, when, how many tokens — regardless of your choice here.
              </p>
              <p className="text-[12px] text-[var(--muted)] leading-[1.5] mt-2">
                You can also allow the admin to read the <strong>text of your instructions and the
                AI&apos;s replies</strong>. This is optional and off by default.
              </p>
              <p className="text-[11px] text-[var(--faint)] mt-2">
                You can change this choice later at any time in your Account settings. Changing it
                is not retroactive in either direction.
              </p>
            </div>

            {/* Two explicit actions — no pre-selection */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConsent('private')}
                disabled={submitting}
                className={[
                  'flex-1 py-2 text-[12px] font-medium rounded-[7px] border transition-colors cursor-pointer disabled:opacity-50',
                  consent === 'private'
                    ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                    : 'bg-[var(--bg)] text-[var(--text)] border-[var(--border)] hover:border-[var(--text)]',
                ].join(' ')}
              >
                Keep private
              </button>
              <button
                type="button"
                onClick={() => setConsent('share')}
                disabled={submitting}
                className={[
                  'flex-1 py-2 text-[12px] font-medium rounded-[7px] border transition-colors cursor-pointer disabled:opacity-50',
                  consent === 'share'
                    ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                    : 'bg-[var(--bg)] text-[var(--text)] border-[var(--border)] hover:border-[var(--accent)]',
                ].join(' ')}
              >
                Share with admin
              </button>
            </div>

            {consent === null && (
              <p className="text-[11px] text-[var(--warn)]">
                Please choose one of the options above before continuing.
              </p>
            )}
          </div>
          {/* ── End consent block ──────────────────────────────────────────── */}

          {error && (
            <p className="text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)] rounded-[6px] px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-2 text-[13px] font-medium bg-[var(--accent)] text-white rounded-[7px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-[12px] text-[var(--muted)] text-center">
          Already have an account?{' '}
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
