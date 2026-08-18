/**
 * lib/ai/__tests__/providerRegistry.test.ts
 *
 * Unit tests for the provider registry (Plan 11 §5.2).
 * DB is the in-memory test instance. Env vars are stubbed per-test.
 *
 * Assertions:
 *   - Setting row absent → resolveActiveProvider returns anthropic
 *   - Setting = unknown string → 'anthropic' + console.warn
 *   - Setting = 'openaiCompatible' → returns openaiCompatible provider
 *   - Two calls with the same id return the SAME instance (connection pooling)
 *   - Changing the setting between two calls switches provider without a restart
 *     (proves constraint 4 — resolution is fresh per call, not at gateway init)
 *   - isProviderConfigured: true/false per env var presence
 *   - getProviderById with unknown id → throws
 *   - getProviderById with an UNCONFIGURED id does NOT throw (fixed 2026-08-18 —
 *     see providerRegistry.ts's getProviderById docstring for why: constructing a
 *     provider object needs no credential, only an actual network call does, and
 *     an eager throw here broke the documented no-API-key dry-run deployment mode
 *     since gateway.ts resolves the provider before its dry-run gate)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../db/client.js', async () => {
  const { testDb } = await import('../../db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mock ─────────────────────────────────────────────────────────
import * as schema from '../../db/schema.js';
import { testDb } from '../../db/__tests__/test-db.js';
import {
  isProviderConfigured,
  getProviderById,
  resolveActiveProvider,
} from '../providerRegistry.js';

// ── DB helpers ─────────────────────────────────────────────────────────────────

function setLlmProviderSetting(value: string) {
  testDb
    .insert(schema.setting)
    .values({ key: 'llmProvider', value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
    .run();
}

function deleteLlmProviderSetting() {
  testDb.delete(schema.setting).where(eq(schema.setting.key, 'llmProvider')).run();
}

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeEach(() => {
  // Provide env vars for both providers so isProviderConfigured returns true
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
  vi.stubEnv('OPENAI_COMPATIBLE_API_KEY', 'test-compat-key');
  vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', 'https://api.test.example.com');
  vi.stubEnv('OPENAI_COMPATIBLE_MODEL', 'test-model');
  // Start each test with no stored llmProvider row
  deleteLlmProviderSetting();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  deleteLlmProviderSetting();
});

// ── isProviderConfigured ──────────────────────────────────────────────────────

describe('isProviderConfigured', () => {
  it('anthropic: true when ANTHROPIC_API_KEY is set', () => {
    expect(isProviderConfigured('anthropic')).toBe(true);
  });

  it('anthropic: false when ANTHROPIC_API_KEY is absent', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(isProviderConfigured('anthropic')).toBe(false);
  });

  it('openaiCompatible: true when both key and base URL are set', () => {
    expect(isProviderConfigured('openaiCompatible')).toBe(true);
  });

  it('openaiCompatible: false when key is missing', () => {
    vi.stubEnv('OPENAI_COMPATIBLE_API_KEY', '');
    expect(isProviderConfigured('openaiCompatible')).toBe(false);
  });

  it('openaiCompatible: false when base URL is missing', () => {
    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', '');
    expect(isProviderConfigured('openaiCompatible')).toBe(false);
  });

  it('unknown id → false', () => {
    expect(isProviderConfigured('nonexistent')).toBe(false);
  });
});

// ── getProviderById ───────────────────────────────────────────────────────────

describe('getProviderById', () => {
  it('returns anthropic provider with correct id', () => {
    const p = getProviderById('anthropic');
    expect(p.id).toBe('anthropic');
  });

  it('returns openaiCompatible provider with correct id', () => {
    const p = getProviderById('openaiCompatible');
    expect(p.id).toBe('openaiCompatible');
  });

  it('two calls with same id return the SAME instance (connection pooling)', () => {
    const first = getProviderById('anthropic');
    const second = getProviderById('anthropic');
    expect(first).toBe(second); // toBe = object identity
  });

  it('throws on unknown id', () => {
    expect(() => getProviderById('nonexistent')).toThrow('Unknown provider id');
  });

  it('does NOT throw for an unconfigured-but-known id — construction needs no credential (2026-08-18)', () => {
    vi.stubEnv('OPENAI_COMPATIBLE_API_KEY', '');
    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', '');
    const p = getProviderById('openaiCompatible');
    expect(p.id).toBe('openaiCompatible');
    // isProviderConfigured still correctly reports false — PATCH /api/settings
    // is where that's actually enforced (D3), not here.
    expect(isProviderConfigured('openaiCompatible')).toBe(false);
  });
});

// ── resolveActiveProvider ─────────────────────────────────────────────────────

describe('resolveActiveProvider', () => {
  it('setting row absent → returns anthropic (fail-safe default)', () => {
    // no row written in this test (deleteLlmProviderSetting in beforeEach)
    const p = resolveActiveProvider();
    expect(p.id).toBe('anthropic');
  });

  it('setting = unknown string → logs warn and returns anthropic', () => {
    setLlmProviderSetting('garbage_value_that_is_not_a_provider');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = resolveActiveProvider();
    expect(p.id).toBe('anthropic');
    // getActiveProviderId() emits a warn for unknown values (Plan 11 D3)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('garbage_value'));
  });

  it('setting = openaiCompatible → returns openaiCompatible provider', () => {
    setLlmProviderSetting('openaiCompatible');
    const p = resolveActiveProvider();
    expect(p.id).toBe('openaiCompatible');
  });

  it('changing setting between calls switches provider without restart', () => {
    // First call — anthropic (default / no row)
    const first = resolveActiveProvider();
    expect(first.id).toBe('anthropic');

    // Change setting — should take effect on the NEXT call with no restart
    setLlmProviderSetting('openaiCompatible');
    const second = resolveActiveProvider();
    expect(second.id).toBe('openaiCompatible');

    // Switch back
    setLlmProviderSetting('anthropic');
    const third = resolveActiveProvider();
    expect(third.id).toBe('anthropic');
  });
});
