/**
 * app/api/settings/__tests__/settings.test.ts
 *
 * Route tests for GET + PATCH /api/settings (§10.4).
 *
 * GET  — returns defaults with isDefault:true when no row exists.
 * PATCH — valid → persisted and isDefault:false; unknown key → 400;
 *          wrong datatype → 400.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mock ─────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { GET, PATCH } from '../route.js';

// Clear the setting table before each test so tests are independent
beforeEach(() => {
  testDb.delete(schema.setting).run();
});

function makePatch(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/settings', () => {
  it('returns liveLlmCalls with isDefault:true and value:true when no row exists', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json() as { settings: Record<string, unknown>[] };
    expect(Array.isArray(body.settings)).toBe(true);
    const liveEntry = body.settings.find((s) => s.key === 'liveLlmCalls');
    expect(liveEntry).toBeDefined();
    expect(liveEntry?.isDefault).toBe(true);
    expect(liveEntry?.value).toBe(true);
    expect(liveEntry?.label).toBe('Live LLM calls');
    expect(typeof liveEntry?.hint).toBe('string');
    expect(liveEntry?.datatype).toBe('bool');
    expect(liveEntry?.updatedAt).toBeNull();
  });

  it('returns isDefault:false with stored value after a PATCH', async () => {
    await PATCH(makePatch({ key: 'liveLlmCalls', value: false }));
    const res = GET();
    const body = await res.json() as { settings: Record<string, unknown>[] };
    const liveEntry = body.settings.find((s) => s.key === 'liveLlmCalls');
    expect(liveEntry?.isDefault).toBe(false);
    expect(liveEntry?.value).toBe(false);
    expect(typeof liveEntry?.updatedAt).toBe('string');
  });
});

describe('PATCH /api/settings', () => {
  it('valid bool true → persists and returns isDefault:false', async () => {
    const res = await PATCH(makePatch({ key: 'liveLlmCalls', value: true }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.key).toBe('liveLlmCalls');
    expect(body.value).toBe(true);
    expect(body.isDefault).toBe(false);
    expect(typeof body.updatedAt).toBe('string');
  });

  it('valid bool false → persists false', async () => {
    const res = await PATCH(makePatch({ key: 'liveLlmCalls', value: false }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.value).toBe(false);
  });

  it('unknown key → 400 unknown_setting_key', async () => {
    const res = await PATCH(makePatch({ key: 'nonexistent', value: true }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('unknown_setting_key');
    expect(body.key).toBe('nonexistent');
  });

  it('wrong datatype (string for bool) → 400 invalid_setting_value', async () => {
    const res = await PATCH(makePatch({ key: 'liveLlmCalls', value: 'yes' }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_setting_value');
    expect(body.key).toBe('liveLlmCalls');
    expect(body.datatype).toBe('bool');
  });

  it('missing key field → 400 invalid_body', async () => {
    const res = await PATCH(makePatch({ value: true }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_body');
  });

  it('toggle round-trip: true then false, then GET reflects false', async () => {
    await PATCH(makePatch({ key: 'liveLlmCalls', value: true }));
    await PATCH(makePatch({ key: 'liveLlmCalls', value: false }));
    const res = GET();
    const body = await res.json() as { settings: Record<string, unknown>[] };
    const liveEntry = body.settings.find((s) => s.key === 'liveLlmCalls');
    expect(liveEntry?.value).toBe(false);
    expect(liveEntry?.isDefault).toBe(false);
  });
});
