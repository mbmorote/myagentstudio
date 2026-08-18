'use client';

/**
 * app/components/Settings/prefsShared.tsx
 *
 * Shared types/helpers/sub-components for the Preferences modal panes
 * (LlmSettingsPane, AdminSettingsPane, ActivityLogPane — 2026-08-18 Account +
 * Settings merge). Deliberately a SEPARATE copy from the equivalent pieces
 * inlined in SettingsView.tsx, not an extraction of them — SettingsView.tsx
 * still backs the admin-only full-page `/settings` route (kept alive for the
 * Activity log Permalink deep link) and is left untouched on purpose, so nothing
 * here changes its behavior. A little duplication of small, stable primitives
 * (Pager, formatTs, the int/enum inputs) across two independent surfaces is the
 * accepted trade-off for not touching a route that already works.
 */

import { useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type SettingEntry = {
  key: string;
  label: string;
  hint: string;
  datatype: string;
  value: boolean | number | string;
  isDefault: boolean;
  updatedAt: string | null;
  min?: number;
  max?: number;
  options?: readonly string[];
  configuredOptions?: readonly string[];
};

// Rows per page for the Access requests / Users / Activity log grids.
export const PAGE_SIZE = 10;

// ── Formatting helpers ─────────────────────────────────────────────────────────

export function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** null → "No expiry". Past → "Expired". Otherwise a short "in Xh Ym" countdown. */
export function formatExpiry(iso: string | null): { text: string; expired: boolean } {
  if (!iso) return { text: 'No expiry', expired: false };
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { text: 'Expired', expired: true };
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const text = hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
  return { text, expired: false };
}

/** Pretty-prints a payload and unescapes literal \r\n sequences into real line breaks. */
export function copyPayloadFormatted(value: unknown): void {
  const pretty = JSON.stringify(value, null, 2)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n');
  navigator.clipboard.writeText(pretty);
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'import-strict': return 'Import (strict)';
    case 'import-structural': return 'Import (structural)';
    case 'chat': return 'Chat';
    default: return kind;
  }
}

export function deriveStatus(entry: { dryRun: boolean; error: string | null }): 'Dry-run' | 'Error' | 'OK' {
  if (entry.dryRun) return 'Dry-run';
  if (entry.error) return 'Error';
  return 'OK';
}

export function statusClass(status: 'Dry-run' | 'Error' | 'OK'): string {
  if (status === 'Dry-run') return 'text-[var(--warn)]';
  if (status === 'Error') return 'text-[var(--err)]';
  return 'text-[var(--ok)]';
}

// ── Pagination ───────────────────────────────────────────────────────────────

/** Prev/Next pager over an already-fetched array — client-side slicing only. */
export function Pager({
  page,
  totalItems,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-end gap-3 mt-2">
      <span className="text-[11px] text-[var(--faint)]">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="text-[11px] px-2 py-1 rounded-[6px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          ← Prev
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="text-[11px] px-2 py-1 rounded-[6px] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ── Int / enum setting inputs ────────────────────────────────────────────────

export function IntSettingInput({
  setting,
  onSave,
}: {
  setting: SettingEntry;
  onSave: (key: string, rawValue: string, def: SettingEntry) => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(setting.value));

  function handleBlur() {
    onSave(setting.key, draft, setting);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === 'Escape') {
      setDraft(String(setting.value));
    }
  }

  return (
    <input
      type="number"
      value={draft}
      min={setting.min}
      max={setting.max}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="flex-none w-20 border border-[var(--border)] rounded-[6px] px-2 py-1 text-[12px] text-right bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
    />
  );
}

/**
 * Renders a <select> for enum settings. Options not in configuredOptions
 * (server-side env vars absent) are disabled and annotated "(not configured)".
 */
export function EnumSettingSelect({
  setting,
  onSave,
}: {
  setting: SettingEntry;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  return (
    <select
      value={setting.value as string}
      onChange={(e) => void onSave(setting.key, e.target.value)}
      className="flex-none border border-[var(--border)] rounded-[6px] px-2 py-1 text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] cursor-pointer"
    >
      {setting.options?.map((opt) => {
        const configured = setting.configuredOptions?.includes(opt) ?? true;
        return (
          <option key={opt} value={opt} disabled={!configured}>
            {opt}{!configured ? ' (not configured)' : ''}
          </option>
        );
      })}
    </select>
  );
}
