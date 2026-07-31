/**
 * app/settings/page.tsx
 *
 * /settings — System Settings page (Plan 04 Phase 4.3, §5.4 / §5.7).
 *
 * Admin-only. Non-admin sessions are redirected to / by this page after the
 * session check. Middleware does the coarse gate; requirePageSession and the
 * role check here are the authoritative guards.
 *
 * Server component: loads settings + log directly from the repository,
 * then passes plain data to the client component <SettingsView>.
 *
 * When ?log=<id> is in the URL, the full log entry (with payloads) is
 * fetched so the client can scroll to and highlight it on first paint.
 * Payloads are subject to §5.6 redaction: the admin's userId is used as
 * viewerUserId so rows from non-consenting users are redacted correctly.
 *
 * Rendering note (§5.4): this page renders <Topbar /> itself. WorkbenchShell
 * and app/layout.tsx are untouched — this is the smallest-diff approach for
 * a single extra top-level page.
 */

import { redirect } from 'next/navigation';
import { getAllSettings, listCallLogs, getCallLog } from '@/lib/db/repository';
import { SETTING_DEFS, parseSettingValue } from '@/lib/settings';
import { Topbar } from '@/app/components/shell/Topbar';
import { SettingsView } from '@/app/components/Settings/SettingsView';
import type { CallLogListItem, CallLogFull } from '@/lib/db/repository';
import { requirePageSession } from '@/lib/auth/session';

interface SettingsPageProps {
  searchParams: Promise<{ log?: string }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  // Only admins may access System Settings (§5.7); redirect others to /
  const session = await requirePageSession('/settings');
  if (session.role !== 'admin') {
    redirect('/');
  }

  const { log: highlightId } = await searchParams;

  // Load settings with defaults applied (mirrors GET /api/settings)
  const rows = getAllSettings();
  const rowMap = new Map(rows.map((r) => [r.key, r]));

  const settings = SETTING_DEFS.map((def) => {
    const row = rowMap.get(def.key);
    if (row) {
      const parsed = parseSettingValue(row.value, def.datatype);
      return {
        key: def.key,
        label: def.label,
        hint: def.hint,
        datatype: def.datatype as string,
        value: parsed ?? def.default,
        isDefault: false,
        updatedAt: row.updatedAt.toISOString(),
        min: def.min,
        max: def.max,
      };
    }
    return {
      key: def.key,
      label: def.label,
      hint: def.hint,
      datatype: def.datatype as string,
      value: def.default,
      isDefault: true,
      updatedAt: null,
      min: def.min,
      max: def.max,
    };
  });

  // Load recent log entries (no payloads).
  // viewerUserId = admin's id so redaction flags are computed correctly (§5.6).
  type SerializedEntry = Omit<CallLogListItem, 'createdAt'> & { createdAt: string };
  type SerializedFull = Omit<CallLogFull, 'createdAt'> & { createdAt: string };

  const rawEntries = listCallLogs({ limit: 200, viewerUserId: session.userId });
  const entries: SerializedEntry[] = rawEntries.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
  }));

  // Load the highlighted entry (with payloads) if ?log=<id> is present.
  // Admin is the viewer — §5.6 redaction applies.
  let highlightEntry: SerializedFull | null = null;
  if (highlightId) {
    const full = getCallLog(highlightId, session.userId);
    if (full) {
      highlightEntry = { ...full, createdAt: full.createdAt.toISOString() };
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--bg)]">
      <Topbar session={session} />
      <SettingsView
        settings={settings}
        entries={entries}
        highlightId={highlightId ?? null}
        highlightEntry={highlightEntry}
      />
    </div>
  );
}
