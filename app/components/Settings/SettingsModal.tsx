'use client';

/**
 * app/components/Settings/SettingsModal.tsx
 *
 * Roadmap TODO item 6 (2026-08-06) — Settings modal instead of full-page navigation.
 * Prototyped first in architecture/layout/Layout-Workbench.html per standing rule 4;
 * this is the real-code migration of that prototype.
 *
 * Why: the old <Link href="/settings"> full-page nav unmounted the whole workbench,
 * which meant ChatPanel's local (in-memory, no persistence yet — see roadmap NEXT
 * item 2) message history was lost every time an admin opened Settings. This renders
 * SettingsView inside a Dialog overlay instead, so the workbench underneath (and
 * ChatPanel's state) never unmounts.
 *
 * Data: /settings/page.tsx is a server component that loads settings + log entries
 * directly via the repository. A modal that doesn't navigate can't do that, so this
 * fetches the same shapes client-side from the two API routes that already existed
 * for other callers — GET /api/settings (used today by SettingsView's own PATCH
 * round-trips) and GET /api/llm-call-log (used today by the row-expand payload
 * fetch) — both already admin-gated via authenticateAdmin. No new backend work.
 *
 * Scope note: this covers "how you get to Settings," not "what it looks like once
 * you're there" — the three sections rendered (General / Invite codes / Activity
 * log) are the exact same SettingsView used by the full-page route, unchanged. The
 * sidebar-navigated internal redesign is a separate, later item (roadmap NEXT #3).
 *
 * The `?log=<id>` deep-link/permalink path (used by activity-log payload rows'
 * "Permalink" link) intentionally still goes through the full-page /settings route,
 * not this modal — a bookmark/share link should land on something reloadable from a
 * fresh tab, which this modal (no URL of its own) can't offer.
 */

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/apiFetch';
import { SettingsView, type SettingEntry, type LogListItem } from './SettingsView';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [settings, setSettings] = useState<SettingEntry[] | null>(null);
  const [entries, setEntries] = useState<LogListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch fresh on every open (2026-08-06) — an admin toggling a setting, then
  // closing and reopening moments later, expects to see its current state, and
  // this data is cheap/small (SETTING_DEFS is a handful of rows, log capped at 200).
  useEffect(() => {
    if (!open) return;
    setSettings(null);
    setEntries(null);
    setError(null);

    Promise.all([
      apiFetch('/api/settings').then((res) => {
        if (!res.ok) throw new Error('settings');
        return res.json() as Promise<{ settings: SettingEntry[] }>;
      }),
      apiFetch('/api/llm-call-log?limit=200').then((res) => {
        if (!res.ok) throw new Error('llm-call-log');
        return res.json() as Promise<{ entries: LogListItem[] }>;
      }),
    ])
      .then(([settingsBody, logBody]) => {
        setSettings(settingsBody.settings);
        setEntries(logBody.entries);
      })
      .catch(() => setError('Failed to load settings. Please try again.'));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--panel)] border-[var(--border)] text-[var(--text)] max-w-3xl max-h-[85vh] overflow-y-auto p-0">
        {/* Visually hidden — SettingsView's own "System Settings" context comes from
            the ⚙ trigger the user just clicked; Radix requires a Title/Description
            for accessibility regardless. */}
        <DialogTitle className="sr-only">System Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Admin settings, invite codes, and activity log
        </DialogDescription>

        {error ? (
          <p className="p-6 text-[12px] text-[var(--err)]">{error}</p>
        ) : settings && entries ? (
          <SettingsView
            settings={settings}
            entries={entries}
            highlightId={null}
            highlightEntry={null}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <p className="p-6 text-[12px] text-[var(--faint)]">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
