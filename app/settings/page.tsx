/**
 * app/settings/page.tsx
 *
 * /settings — Settings page (Plan 04 Phase 4.3, §5.4).
 *
 * Server component: loads settings + log directly from the repository,
 * then passes plain data to the client component <SettingsView>.
 *
 * When ?log=<id> is in the URL, the full log entry (with payloads) is
 * fetched so the client can scroll to and highlight it on first paint.
 *
 * Rendering note (§5.4): this page renders <Topbar /> itself. WorkbenchShell
 * and app/layout.tsx are untouched — this is the smallest-diff approach for
 * a single extra top-level page.
 */

import { getAllSettings, listCallLogs, getCallLog } from '@/lib/db/repository';
import { SETTING_DEFS, parseSettingValue } from '@/lib/settings';
import { Topbar } from '@/app/components/shell/Topbar';
import { SettingsView } from '@/app/components/Settings/SettingsView';
import type { CallLogListItem, CallLogFull } from '@/lib/db/repository';

interface SettingsPageProps {
  searchParams: Promise<{ log?: string }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
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
    };
  });

  // Load recent log entries (no payloads)
  // Serialize Date to string for JSON transport to the client component.
  type SerializedEntry = Omit<CallLogListItem, 'createdAt'> & { createdAt: string };
  type SerializedFull = Omit<CallLogFull, 'createdAt'> & { createdAt: string };

  const rawEntries = listCallLogs({ limit: 200 });
  const entries: SerializedEntry[] = rawEntries.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
  }));

  // Load the highlighted entry (with payloads) if ?log=<id> is present
  let highlightEntry: SerializedFull | null = null;
  if (highlightId) {
    const full = getCallLog(highlightId);
    if (full) {
      highlightEntry = { ...full, createdAt: full.createdAt.toISOString() };
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--bg)]">
      <Topbar />
      <SettingsView
        settings={settings}
        entries={entries}
        highlightId={highlightId ?? null}
        highlightEntry={highlightEntry}
      />
    </div>
  );
}
