'use client';

/**
 * app/components/Account/AccountView.tsx
 *
 * Client component for the User Settings page (/account) — Plan 05 Phase 4.6, §5.7.
 *
 * Displays:
 *   - Read-only: signed-in email and role
 *   - Editable: log-sharing consent toggle (PATCH /api/account)
 *
 * The consent toggle is the one preference that belongs to the person,
 * not the deployment. The page is always available to any authenticated
 * user, including the admin.
 *
 * Non-retroactivity statement: stated explicitly, in both directions, so the
 * user understands that changing the toggle does not affect past calls (§5.6).
 */

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';

interface AccountViewProps {
  email: string;
  role: 'admin' | 'user';
  shareLogsWithAdmin: boolean;
}

export function AccountView({ email, role, shareLogsWithAdmin: initialShare }: AccountViewProps) {
  const [sharing, setSharing] = useState(initialShare);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleToggle() {
    const newValue = !sharing;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await apiFetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareLogsWithAdmin: newValue }),
      });

      if (res.ok) {
        setSharing(newValue);
        setSaved(true);
        // Clear the saved indicator after 2 seconds
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError('Failed to update preference. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-lg">
      {/* Back link */}
      <div>
        <Link
          href="/"
          className="text-[13px] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
        >
          ← Back to Workbench
        </Link>
      </div>

      {/* Account info */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Your account</h2>
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] text-[var(--muted)]">Email</span>
            <span className="text-[13px] text-[var(--text)] font-medium">{email}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] text-[var(--muted)]">Role</span>
            <span className={[
              'text-[12px] font-medium px-[8px] py-[2px] rounded-[5px]',
              role === 'admin'
                ? 'bg-[var(--accent-wash)] text-[var(--accent-ink)]'
                : 'bg-[var(--elev)] text-[var(--muted)]',
            ].join(' ')}>
              {role}
            </span>
          </div>
        </div>
      </section>

      {/* Log sharing consent (§5.6) */}
      <section>
        <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Activity log sharing</h2>
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] p-4 space-y-4">
          <div>
            <p className="text-[13px] text-[var(--text)] mb-2">
              Share prompt and response content with the admin
            </p>
            <p className="text-[12px] text-[var(--muted)] leading-[1.5]">
              The admin can always see <strong>metadata</strong> for your AI calls — which agent,
              when, how many tokens — to audit the shared API key. If you enable this, they can
              also read the <strong>text of your instructions and the AI&apos;s replies</strong>.
            </p>
            <p className="text-[12px] text-[var(--faint)] mt-2 leading-[1.5]">
              Changing this preference is <strong>not retroactive in either direction</strong>:
              turning sharing on does not expose past private calls; turning it off does not hide
              past shared calls. Only future calls are affected.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleToggle}
              disabled={saving}
              className={[
                'flex-none w-10 h-6 rounded-full border transition-colors cursor-pointer disabled:opacity-50',
                sharing
                  ? 'bg-[var(--accent)] border-[var(--accent)]'
                  : 'bg-[var(--bg)] border-[var(--border)]',
              ].join(' ')}
              title={sharing ? 'Sharing — click to make private' : 'Private — click to share'}
            >
              <span
                className={[
                  'block w-4 h-4 rounded-full bg-white shadow transition-transform mt-[3px]',
                  sharing ? 'translate-x-[18px]' : 'translate-x-[3px]',
                ].join(' ')}
              />
            </button>
            <span className="text-[13px] text-[var(--text)]">
              {sharing ? 'Sharing with admin' : 'Private (not sharing)'}
            </span>
            {saved && (
              <span className="text-[12px] text-[var(--ok)]">Saved</span>
            )}
          </div>

          {error && (
            <p className="text-[12px] text-[var(--err)]">{error}</p>
          )}
        </div>
      </section>
    </div>
  );
}
