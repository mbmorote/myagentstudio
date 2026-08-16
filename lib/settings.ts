import 'server-only';

/**
 * lib/settings.ts
 *
 * In-code catalog of known settings (SETTING_DEFS) + typed accessors.
 * Mirrors the in-code-typed-array pattern CONFIG_DEFS uses in lib/blueprint/catalog.ts.
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

export type SettingDatatype = 'bool' | 'int' | 'string' | 'enum';

export type SettingDef = {
  key: string;
  datatype: SettingDatatype;
  default: boolean | number | string;
  label: string;
  hint: string;
  /** Minimum value (inclusive) — only meaningful for 'int' settings. */
  min?: number;
  /** Maximum value (inclusive) — only meaningful for 'int' settings. */
  max?: number;
  /**
   * Allowed values — only meaningful for 'enum' settings.
   * The PATCH route rejects any value not in this list. getActiveProviderId()
   * falls back to the default on an out-of-list stored value + console.warn.
   */
  options?: readonly string[];
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
  {
    key: 'chatHistoryTurns',
    datatype: 'int',
    default: 10,
    min: 0,
    max: 50,
    label: 'Chat history turns',
    hint: 'How many prior chat messages (user + assistant, combined) Prometheus is shown for conversational context on each new instruction. 0 disables history — every instruction is sent standalone.',
  },
  {
    key: 'chatMaxTokens',
    datatype: 'int',
    default: 8192,
    min: 1024,
    max: 64000,
    label: 'Chat max output tokens',
    hint: 'Max tokens Prometheus may generate per reply. A response that hits this ceiling is truncated mid-generation (max_tokens) and rejected as chat_truncated (2026-08-12) rather than silently losing content — raise this if large rewrites keep getting cut off. The max here is a safety guard against a mistyped huge value, not a confirmed model limit.',
  },
  {
    key: 'accessRequestCodeExpiryHours',
    datatype: 'int',
    default: 5,
    min: 1,
    max: 168,
    label: 'Access-request code expiry (hours)',
    hint: 'How long an invite code generated from an access request ("Request access" on the signup form) stays valid before it expires. Only applies to those codes — one you create yourself via "+ Generate code" never expires.',
  },
  {
    key: 'llmProvider',
    datatype: 'enum',
    default: 'anthropic',
    options: ['anthropic', 'openaiCompatible'] as const,
    label: 'LLM provider',
    hint: 'Which vendor answers every AI call (import and chat). Changing this takes effect on the next call — no restart needed. Each provider reads its own API key and model from the server environment. A provider with no key configured cannot be selected.',
  },
  {
    key: 'mcpWrites',
    datatype: 'bool',
    default: false,
    label: 'MCP writes',
    hint: 'When on, write-scoped MCP tokens can call import_agent, which runs the import pipeline and may spend LLM budget. When off, all MCP import attempts are refused with a clear error — read tools are unaffected. Defaults to off: a deployment that never configures this behaves exactly as before MCP existed. Note: import_agent is the first path where an automated client in a loop can trigger billed AI calls unattended — the shared per-user hourly cap (Max LLM calls per user per hour) is the metering layer, but this toggle is the primary on/off switch.',
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
    case 'enum':
    case 'string':
      // Membership validation for 'enum' is done in the PATCH route and in the
      // typed accessor (getActiveProviderId), not here — this layer just returns
      // the raw string so callers can apply their own fail-safe logic.
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

/**
 * Returns the current effective value of `chatHistoryTurns`.
 *
 * Row absent → returns the SETTING_DEFS default (10).
 * Unparseable or < 0 → returns 0 (most restrictive: history disabled) + console.warn.
 */
export function getChatHistoryTurns(): number {
  const def = SETTING_DEFS.find((d) => d.key === 'chatHistoryTurns')!;
  const raw = getSetting('chatHistoryTurns');
  if (raw === null) return def.default as number;

  const parsed = parseSettingValue(raw, 'int');
  if (parsed === null || (parsed as number) < 0) {
    console.warn(
      `[settings] chatHistoryTurns has invalid value "${raw}" — using 0 (history disabled)`,
    );
    return 0;
  }
  return parsed as number;
}

/**
 * Returns the current effective value of `chatMaxTokens`.
 *
 * Row absent → returns the SETTING_DEFS default (8192).
 * Unparseable or below the def's min → returns that min (most restrictive) + console.warn.
 */
export function getChatMaxTokens(): number {
  const def = SETTING_DEFS.find((d) => d.key === 'chatMaxTokens')!;
  const raw = getSetting('chatMaxTokens');
  if (raw === null) return def.default as number;

  const parsed = parseSettingValue(raw, 'int');
  if (parsed === null || (parsed as number) < def.min!) {
    console.warn(
      `[settings] chatMaxTokens has invalid value "${raw}" — using minimum of ${def.min}`,
    );
    return def.min as number;
  }
  return parsed as number;
}

/**
 * Returns the current effective value of `accessRequestCodeExpiryHours`.
 *
 * Row absent → returns the SETTING_DEFS default (5).
 * Unparseable or below the def's min → returns that min (most restrictive) + console.warn.
 */
export function getAccessRequestCodeExpiryHours(): number {
  const def = SETTING_DEFS.find((d) => d.key === 'accessRequestCodeExpiryHours')!;
  const raw = getSetting('accessRequestCodeExpiryHours');
  if (raw === null) return def.default as number;

  const parsed = parseSettingValue(raw, 'int');
  if (parsed === null || (parsed as number) < def.min!) {
    console.warn(
      `[settings] accessRequestCodeExpiryHours has invalid value "${raw}" — using minimum of ${def.min}`,
    );
    return def.min as number;
  }
  return parsed as number;
}

/**
 * Returns the current effective value of `mcpWrites` (Plan 13).
 *
 * Semantics:
 *   - Row absent → FALSE (fail-closed — MCP writes off by default, same asymmetric
 *     fail-safe as getLiveLlmCalls: money-spending capabilities may only come from the
 *     ABSENCE of configuration in the fail-open direction, never from the fail-closed
 *     direction, and here the safe direction is off).
 *   - `'true'`  → true
 *   - `'false'` → false
 *   - Anything else → FALSE (fail-closed) + console.warn
 *
 * A deployment that never configures this setting behaves exactly as before MCP existed —
 * import_agent calls are refused with a clear, named error.
 */
export function getMcpWrites(): boolean {
  const raw = getSetting('mcpWrites');

  // Row absent → fail-closed (default off)
  if (raw === null) return false;

  const parsed = parseSettingValue(raw, 'bool');
  if (parsed === null) {
    console.warn(
      `[settings] mcpWrites has unparseable value "${raw}" — treating as false (fail-closed)`,
    );
    return false;
  }

  return parsed as boolean;
}

/**
 * Returns the current effective value of `llmProvider`.
 *
 * Semantics (D3, Plan 11):
 *   - Row absent (fresh install, no row written) → 'anthropic' (fail-safe default, D3 §1).
 *   - Known value → returned as-is.
 *   - Unknown / corrupt value → 'anthropic' + console.warn (same asymmetric fail-safe
 *     as getLiveLlmCalls: a money-spending choice is never derived from a garbage value).
 *
 * Reads fresh on every call (no cache) — same rule as getLiveLlmCalls (the toggle that
 * blocks live calls would appear unreliable if its value were cached, and provider
 * selection must follow the same rule so a setting change takes effect on the next call
 * without a restart).
 */
export function getActiveProviderId(): string {
  const def = SETTING_DEFS.find((d) => d.key === 'llmProvider')!;
  const raw = getSetting('llmProvider');

  // Row absent → fail-safe default 'anthropic'
  if (raw === null) return 'anthropic';

  // Validate against the known options list
  if (!def.options?.includes(raw)) {
    console.warn(
      `[settings] llmProvider has unknown value "${raw}" — using default 'anthropic'`,
    );
    return 'anthropic';
  }

  return raw;
}
