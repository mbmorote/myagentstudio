'use client';

/**
 * app/components/Auth/ConsentPopup.tsx
 *
 * The activity-log-sharing choice (§5.6), offered once after a brand-new
 * signup rather than gating account creation itself (see SignupForm.tsx's
 * header comment for the supersession rationale).
 *
 * Default flipped 2026-08-18: every new account is now created with
 * shareLogsWithAdmin: true ("share by default") — this popup is an opt-OUT
 * prompt, not an opt-in one. Dismissible without consequence — closing it
 * leaves the "sharing" default in place, changeable later from /account
 * exactly as today.
 *
 * Also folds in the beta/sensitive-data notice (roadmap's "Experimental —
 * don't paste sensitive data" item) — previously just a small footnote here
 * with no "this is an early, unencrypted-at-rest beta" framing anywhere in
 * the auth flow at all; the two belong together since the second explains
 * why the first matters. A second, persistent (non-modal, no dismissal
 * needed) reminder also lives near the actual chat/import inputs — see
 * ChatPanel.tsx/ImportDialog.tsx — since a warning seen once at signup and
 * never again is easy to forget by the time it actually matters.
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
          <strong>Your account is currently set to share</strong> — the admin can read the text
          of your instructions and the AI&apos;s replies. You can make this private instead.
        </p>
        <p className="text-[12px] text-[var(--muted)] leading-[1.5]">
          This workbench can use shared API keys paid for by the admin (the person who set up
          this deployment). To audit usage, the admin can always see <strong>metadata</strong> for
          every AI call — which agent, when, how many tokens — regardless of your choice here.
        </p>
        <p className="text-[12px] text-[var(--muted)] leading-[1.5]">
          If you keep sharing on, they can also read the <strong>text of your instructions and
          the AI&apos;s replies</strong>. Making it private stops that, going forward.
        </p>
        <p className="text-[11px] text-[var(--faint)]">
          You can change this choice later at any time in your Account settings. Changing it is
          not retroactive in either direction.
        </p>
        <p className="text-[11px] text-[var(--faint)]">
          This is an early, unencrypted-at-rest beta — please do not paste passwords, API keys,
          or other sensitive or confidential data, regardless of your sharing choice here.
        </p>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => choose(false)}
            disabled={saving}
            className="flex-1 py-2 text-[12px] font-medium rounded-[7px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--text)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Make it private
          </button>
          <button
            type="button"
            onClick={() => choose(true)}
            disabled={saving}
            className="flex-1 py-2 text-[12px] font-medium rounded-[7px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--text)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Keep sharing
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="w-full text-[11px] text-[var(--muted)] hover:underline cursor-pointer disabled:opacity-50"
        >
          Maybe later — keeps it sharing for now
        </button>
      </div>
    </div>
  );
}
