'use client';

/**
 * app/login/page.tsx
 *
 * Public login form (Plan 05 Phase 4.2, §3.6).
 *
 * On success, redirects to the `next` query parameter if it is a valid
 * single-leading-slash path (§3.6 open-redirect guard), otherwise to /.
 *
 * This page is exempt from the layout-mockup detour (§16.11): it is a
 * simple form built from existing tokens, and the mockup's value is in
 * resolving layout questions this page does not raise.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/** Validates the `next` parameter: must be a path starting with exactly one /. */
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  // Accept only a single leading slash — no protocol, no //host
  if (/^\/(?!\/)/.test(raw)) return raw;
  return '/';
}

export default function LoginPage() {
  const searchParams = useSearchParams();
  const nextPath = safeNext(searchParams.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
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
        setError(`Too many attempts. Try again in ${secs} seconds.`);
        return;
      }
      if (res.status === 401) {
        setError('Incorrect email or password.');
        return;
      }
      if (!res.ok) {
        setError('Login failed. Please try again.');
        return;
      }

      // Success — navigate to the intended destination
      window.location.href = nextPath;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
      <div className="w-full max-w-sm px-6">
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

          {error && (
            <p className="text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)] rounded-[6px] px-3 py-2">
              {error}
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

        <p className="mt-6 text-[12px] text-[var(--muted)] text-center">
          Need an account?{' '}
          <Link href="/signup" className="text-[var(--accent)] hover:underline">
            Sign up with an invite code
          </Link>
        </p>
      </div>
    </div>
  );
}
