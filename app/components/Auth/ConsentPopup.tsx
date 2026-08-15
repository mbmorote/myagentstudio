'use client';

/**
 * app/components/Auth/ConsentPopup.tsx
 *
 * The activity-log-sharing choice (§5.6), offered once after a brand-new
 * signup rather than gating account creation itself (see SignupForm.tsx's
 * header comment for the supersession rationale). Every new account already
 * has shareLogsWithAdmin: false; this is purely an optional upgrade prompt.
 *
 * Dismissible without consequence — closing it leaves the "keep private"
 * default in place, changeable later from /account exactly as today.
 */

import { useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

interface ConsentPopupProps {
  onClose: () => void;
}

export function ConsentPopup({ onClose }: ConsentPopupProps) {
  const [saving, setSaving] = useState(false);

  async function choose(shareLogsWithAdmin: boolean) {
    setSaving(true);
    try {
      await apiFetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareLogsWithAdmin }),
      });
    } catch {
      // Non-blocking by design — a failed save here just means the default
      // (private) stands; the user can still set it from /account later.
    } finally {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm border border-[var(--border)] rounded-[12px] bg-[var(--elev)] p-5 shadow-lg space-y-3">
        <h2 className="text-[13px] font-semibold text-[var(--text)]">Activity log sharing</h2>
        <p className="text-[12px] text-[var(--text)] leading-[1.5]">
          <strong>Your account is currently set to private</strong> — the admin cannot read the
          text of your instructions or the AI&apos;s replies unless you turn this on.
        </p>
        <p className="text-[12px] text-[var(--muted)] leading-[1.5]">
          This workbench uses one shared API key paid for by the admin (the person who set up
          this deployment). To audit usage, the admin can always see <strong>metadata</strong> for
          every AI call — which agent, when, how many tokens — regardless of your choice here.
        </p>
        <p className="text-[12px] text-[var(--muted)] leading-[1.5]">
          You can optionally also allow the admin to read the <strong>text of your instructions
          and the AI&apos;s replies</strong>.
        </p>
        <p className="text-[11px] text-[var(--faint)]">
          You can change this choice later at any time in your Account settings. Changing it is
          not retroactive in either direction.
        </p>
        <p className="text-[11px] text-[var(--faint)]">
          Content you enter here is sent to an external AI provider — do not paste passwords,
          API keys, or other sensitive or confidential data.
        </p>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => choose(false)}
            disabled={saving}
            className="flex-1 py-2 text-[12px] font-medium rounded-[7px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--text)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Keep private
          </button>
          <button
            type="button"
            onClick={() => choose(true)}
            disabled={saving}
            className="flex-1 py-2 text-[12px] font-medium rounded-[7px] border border-[var(--accent)] bg-[var(--accent)] text-white hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50"
          >
            Share with admin
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="w-full text-[11px] text-[var(--muted)] hover:underline cursor-pointer disabled:opacity-50"
        >
          Maybe later — keeps it private for now
        </button>
      </div>
    </div>
  );
}
