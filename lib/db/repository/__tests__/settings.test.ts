/**
 * lib/db/repository/__tests__/settings.test.ts
 *
 * Repository tests for settings (§10.3).
 *
 * Tests:
 *   - getSetting returns null for missing key
 *   - setSetting upserts and returns the row
 *   - setSetting a second time updates value (updatedAt bumps)
 *   - getAllSettings shape and contents
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mock ─────────────────────────────────────────────────────────
import { getSetting, setSetting, getAllSettings } from '../settings.js';

describe('settings repository', () => {
  it('getSetting returns null for a missing key', () => {
    const result = getSetting('nonexistent_key_xyz');
    expect(result).toBeNull();
  });

  it('setSetting inserts a new row and returns it', () => {
    const row = setSetting('liveLlmCalls', 'false');
    expect(row.key).toBe('liveLlmCalls');
    expect(row.value).toBe('false');
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it('getSetting returns the value that was set', () => {
    setSetting('testSetting', 'hello');
    const raw = getSetting('testSetting');
    expect(raw).toBe('hello');
  });

  it('setSetting a second time updates the value', () => {
    setSetting('upsertKey', 'first');
    const second = setSetting('upsertKey', 'second');
    expect(second.value).toBe('second');
    expect(getSetting('upsertKey')).toBe('second');
  });

  it('getAllSettings returns an array of row objects', () => {
    setSetting('keyA', 'valA');
    setSetting('keyB', 'valB');
    const all = getAllSettings();
    expect(Array.isArray(all)).toBe(true);
    const keys = all.map((r) => r.key);
    expect(keys).toContain('keyA');
    expect(keys).toContain('keyB');
    for (const row of all) {
      expect(typeof row.key).toBe('string');
      expect(typeof row.value).toBe('string');
      expect(row.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('getAllSettings does not include keys that were never written', () => {
    const all = getAllSettings();
    const keys = all.map((r) => r.key);
    expect(keys).not.toContain('nonexistent_key_xyz');
  });
});
