'use client';

/**
 * app/components/Settings/LlmSettingsPane.tsx
 *
 * "LLM" category of the Preferences modal (2026-08-18 Account + Settings merge,
 * prototyped in architecture/layout/Layout-Workbench.html per CLAUDE.md standing
 * rule 4). Admin-only pane — PreferencesModal never mounts this for a non-admin.
 *
 * Scope: the subset of SETTING_DEFS that governs which vendor answers an AI call
 * and how much of it a caller may use — liveLlmCalls, llmProvider, chatMaxTokens,
 * chatHistoryTurns, maxLlmCallsPerUserPerHour. Everything else in SETTING_DEFS
 * (maxUsers, accessRequestCodeExpiryHours, mcpWrites) lives in AdminSettingsPane.
 *
 * Self-contained fetch/save, same PATCH round-trip SettingsView.tsx already used —
 * GET /api/settings returns every setting; this pane filters to its own keys.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { formatTs, IntSettingInput, EnumSettingSelect, type SettingEntry } from './prefsShared';

const LLM_KEYS = new Set([
  'liveLlmCalls',
  'llmProvider',
  'chatMaxTokens',
  'chatHistoryTurns',
  'maxLlmCallsPerUserPerHour',
]);

export function LlmSettingsPane() {
  const [settings, setSettings] = useState<SettingEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/settings')
      .then(async (res) => {
        if (!res.ok) throw new Error('settings');
        const body = await res.json() as { settings: SettingEntry[] };
        setSettings(body.settings.filter((s) => LLM_KEYS.has(s.key)));
      })
      .catch(() => setError('Failed to load settings.'));
  }, []);

  async function handleToggle(key: string, current: boolean) {
    const newValue = !current;
    setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, value: newValue, isDefault: false } : s)) ?? prev);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: newValue }),
      });
      if (!res.ok) {
        setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, value: current } : s)) ?? prev);
      } else {
        const body = await res.json() as { updatedAt: string };
        setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, updatedAt: body.updatedAt } : s)) ?? prev);
      }
    } catch {
      setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, value: current } : s)) ?? prev);
    }
  }

  async function handleIntSave(key: string, rawValue: string, def: SettingEntry) {
    const parsed = parseInt(rawValue, 10);
    if (isNaN(parsed)) return;
    if (def.min !== undefined && parsed < def.min) return;
    if (def.max !== undefined && parsed > def.max) return;
    if (parsed === (def.value as number)) return;

    const prev = def.value;
    setSettings((s) => s?.map((entry) => (entry.key === key ? { ...entry, value: parsed, isDefault: false } : entry)) ?? s);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: parsed }),
      });
      if (!res.ok) {
        setSettings((s) => s?.map((entry) => (entry.key === key ? { ...entry, value: prev } : entry)) ?? s);
      } else {
        const body = await res.json() as { updatedAt: string };
        setSettings((s) => s?.map((entry) => (entry.key === key ? { ...entry, updatedAt: body.updatedAt } : entry)) ?? s);
      }
    } catch {
      setSettings((s) => s?.map((entry) => (entry.key === key ? { ...entry, value: prev } : entry)) ?? s);
    }
  }

  async function handleEnumSave(key: string, newValue: string) {
    const current = settings?.find((s) => s.key === key)?.value;
    if (newValue === current) return;
    setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, value: newValue, isDefault: false } : s)) ?? prev);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: newValue }),
      });
      if (!res.ok) {
        setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, value: current ?? '' } : s)) ?? prev);
      } else {
        const body = await res.json() as { updatedAt: string };
        setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, updatedAt: body.updatedAt } : s)) ?? prev);
      }
    } catch {
      setSettings((prev) => prev?.map((s) => (s.key === key ? { ...s, value: current ?? '' } : s)) ?? prev);
    }
  }

  if (error) return <p className="p-6 text-[12px] text-[var(--err)]">{error}</p>;
  if (!settings) return <p className="p-6 text-[12px] text-[var(--faint)]">Loading…</p>;

  return (
    <div className="p-6">
      <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">LLM</h2>
      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[9px] divide-y divide-[var(--border)]">
        {settings.map((s) => (
          <div key={s.key} className="flex items-start gap-4 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[var(--text)]">{s.label}</span>
                {s.isDefault && <span className="text-[11px] text-[var(--faint)]">(default)</span>}
              </div>
              <p className="text-[12px] text-[var(--muted)] mt-[2px]">{s.hint}</p>
              {s.updatedAt && (
                <p className="text-[11px] text-[var(--faint)] mt-[2px]">Updated {formatTs(s.updatedAt)}</p>
              )}
            </div>
            {s.datatype === 'bool' && (
              <button
                onClick={() => handleToggle(s.key, s.value as boolean)}
                className={[
                  'flex-none w-10 h-6 rounded-full border transition-colors cursor-pointer',
                  s.value ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-[var(--bg)] border-[var(--border)]',
                ].join(' ')}
                title={s.value ? 'On — click to turn off' : 'Off — click to turn on'}
              >
                <span
                  className={[
                    'block w-4 h-4 rounded-full bg-white shadow transition-transform mt-[3px]',
                    s.value ? 'translate-x-[18px]' : 'translate-x-[3px]',
                  ].join(' ')}
                />
              </button>
            )}
            {s.datatype === 'int' && <IntSettingInput setting={s} onSave={handleIntSave} />}
            {s.datatype === 'enum' && s.options && <EnumSettingSelect setting={s} onSave={handleEnumSave} />}
          </div>
        ))}
      </div>
    </div>
  );
}
