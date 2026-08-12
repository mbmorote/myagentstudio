'use client';

/**
 * app/components/Account/AccountModal.tsx
 *
 * Small layout fix (2026-08-12) — Account modal instead of full-page navigation,
 * mirroring SettingsModal.tsx (roadmap TODO item 6, 2026-08-06) exactly.
 *
 * Why: the old <Link href="/account"> full-page nav unmounted the whole workbench,
 * losing ChatPanel's local (in-memory, no persistence yet) message history every
 * time any user opened Account — the same problem Settings had before its fix.
 * This renders AccountView inside a Dialog overlay instead, so the workbench
 * underneath (and ChatPanel's state) never unmounts.
 *
 * Data: app/account/page.tsx is a server component that loads the user row +
 * OAuth accounts directly via the repository. A modal that doesn't navigate can't
 * do that, so this fetches the same shape client-side from GET /api/account —
 * extended the same session to also return hasPassword and linkedAccounts'
 * providerEmail (previously bare provider-name strings only), since AccountView
 * needs both for the "Signed in with" line and the server page already had them
 * from its own direct DB read.
 *
 * Scope note: this covers "how you get to Account," not "what it looks like once
 * you're there" — AccountView is rendered unchanged (with the new onClose prop).
 */

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/apiFetch';
import { AccountView } from './AccountView';

interface AccountData {
  email: string;
  role: 'admin' | 'user';
  shareLogsWithAdmin: boolean;
  hasPassword: boolean;
  linkedAccounts: { provider: string; providerEmail: string | null }[];
}

interface AccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountModal({ open, onOpenChange }: AccountModalProps) {
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch fresh on every open (mirrors SettingsModal) — cheap, single-row read.
  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);

    apiFetch('/api/account')
      .then((res) => {
        if (!res.ok) throw new Error('account');
        return res.json() as Promise<AccountData>;
      })
      .then(setData)
      .catch(() => setError('Failed to load account. Please try again.'));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--panel)] border-[var(--border)] text-[var(--text)] max-w-lg max-h-[85vh] overflow-y-auto p-0">
        {/* Visually hidden — AccountView's own "Your account" heading already
            provides context; Radix requires a Title/Description regardless. */}
        <DialogTitle className="sr-only">Your Account</DialogTitle>
        <DialogDescription className="sr-only">
          Account info and activity log sharing preference
        </DialogDescription>

        {error ? (
          <p className="p-6 text-[12px] text-[var(--err)]">{error}</p>
        ) : data ? (
          <AccountView
            email={data.email}
            role={data.role}
            shareLogsWithAdmin={data.shareLogsWithAdmin}
            hasPassword={data.hasPassword}
            linkedAccounts={data.linkedAccounts}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <p className="p-6 text-[12px] text-[var(--faint)]">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
