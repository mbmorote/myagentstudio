import 'server-only';

/**
 * lib/settings.ts
 *
 * In-code catalog of known settings (SETTING_DEFS) + typed accessors.
 * Mirrors the pattern CONFIG_DEFS / SECTION_DEFS use in lib/blueprint/catalog.ts.
 *
 * The catalog drives:
 *   - Storage parsing (datatype → typed value)
 *   - The PATCH /api/settings allowlist
 *   - The Settings UI
 *
 * New settings are added by appending to SETTING_DEFS only — no schema change,
 * no migration, no route change (§4.1, §8 policy 11).
 */

import { getSetting } from './db/repository/settings.js';

// ─────────────────────────────  Catalog  ──────────────────────────────────────

export type SettingDatatype = 'bool' | 'int' | 'string';

export type SettingDef = {
  key: string;
  datatype: SettingDatatype;
  default: boolean | number | string;
  label: string;
  hint: string;
};

/**
 * The single source of known setting keys, datatypes, defaults, labels, and hints.
 * Drives storage parsing, the PATCH allowlist, and the Settings UI — exactly as
 * CONFIG_DEFS drives the agent config zone.
 */
export const SETTING_DEFS: readonly SettingDef[] = [
  {
    key: 'liveLlmCalls',
    datatype: 'bool',
    default: true,
    label: 'Live LLM calls',
    hint: 'When off, AI calls are recorded and blocked before any network request is made. No response is produced.',
  },
] as const;

// ─────────────────────────────  Parsing  ──────────────────────────────────────

/**
 * Parses a raw string value from the DB according to its datatype.
 * Returns null if the value cannot be parsed (caller decides fail-safe).
 */
export function parseSettingValue(
  raw: string,
  datatype: SettingDatatype,
): boolean | number | string | null {
  switch (datatype) {
    case 'bool':
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return null; // unparseable → fail-closed in getLiveLlmCalls
    case 'int': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'string':
      return raw;
  }
}

// ─────────────────────────────  Typed accessors  ──────────────────────────────

/**
 * Returns the current effective value of `liveLlmCalls`.
 *
 * Semantics (§6, confirmed in §16.3):
 *   - Row absent (post-migration / pre-seed / fresh clone) → TRUE (fail-open)
 *   - `'true'`  → true
 *   - `'false'` → false
 *   - Anything else (garbage, manual DB edit) → FALSE (fail-closed) + console.warn
 *
 * Asymmetric on purpose: money-spending defaults may only come from the ABSENCE
 * of configuration, never from UNPARSEABLE configuration.
 *
 * No cache — fresh SELECT on every call (§6, risk 9). better-sqlite3 is synchronous;
 * this is a single-row PK lookup, sub-millisecond against an operation that costs
 * seconds and real money. A cached value would make the toggle appear unreliable.
 */
export function getLiveLlmCalls(): boolean {
  const raw = getSetting('liveLlmCalls');

  // Row absent → fail-open (default on, preserves today's real behavior)
  if (raw === null) return true;

  const parsed = parseSettingValue(raw, 'bool');
  if (parsed === null) {
    console.warn(
      `[settings] liveLlmCalls has unparseable value "${raw}" — treating as false (fail-closed)`,
    );
    return false;
  }

  return parsed as boolean;
}
