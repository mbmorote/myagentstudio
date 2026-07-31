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
  /** Minimum value (inclusive) — only meaningful for 'int' settings (§15.5). */
  min?: number;
  /** Maximum value (inclusive) — only meaningful for 'int' settings. */
  max?: number;
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
  {
    key: 'maxUsers',
    datatype: 'int',
    default: 5,
    min: 1,
    label: 'Max users',
    hint: 'Maximum number of user accounts that may be created via signup (including the admin). Lowering it below the current count does not remove anyone; it only blocks new signups.',
  },
  {
    key: 'maxLlmCallsPerUserPerHour',
    datatype: 'int',
    default: 15,
    min: 1,
    label: 'Max LLM calls per user per hour',
    hint: 'Per-user hourly LLM call cap (rolling 60-minute window). Admin is exempt. Setting to 0 is not allowed; use "Live LLM calls: off" to block all calls globally.',
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

/**
 * Returns the current effective value of `maxUsers`.
 *
 * Row absent → returns the SETTING_DEFS default (5).
 * Unparseable value → returns 1 (minimum, most restrictive) + console.warn.
 * A value below 1 stored in the DB (shouldn't happen — PATCH validates) → treated as 1.
 */
export function getMaxUsers(): number {
  const def = SETTING_DEFS.find((d) => d.key === 'maxUsers')!;
  const raw = getSetting('maxUsers');
  if (raw === null) return def.default as number;

  const parsed = parseSettingValue(raw, 'int');
  if (parsed === null || (parsed as number) < 1) {
    console.warn(
      `[settings] maxUsers has invalid value "${raw}" — using minimum of 1`,
    );
    return 1;
  }
  return parsed as number;
}

/**
 * Returns the current effective value of `maxLlmCallsPerUserPerHour`.
 *
 * Row absent → returns the SETTING_DEFS default (15).
 * Unparseable or < 1 → returns 1 (minimum) + console.warn.
 */
export function getMaxLlmCallsPerUserPerHour(): number {
  const def = SETTING_DEFS.find((d) => d.key === 'maxLlmCallsPerUserPerHour')!;
  const raw = getSetting('maxLlmCallsPerUserPerHour');
  if (raw === null) return def.default as number;

  const parsed = parseSettingValue(raw, 'int');
  if (parsed === null || (parsed as number) < 1) {
    console.warn(
      `[settings] maxLlmCallsPerUserPerHour has invalid value "${raw}" — using minimum of 1`,
    );
    return 1;
  }
  return parsed as number;
}
