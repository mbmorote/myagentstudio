/**
 * lib/ai/__tests__/gateway-cap.test.ts
 *
 * Per-user rolling LLM cap behaviour (§3.9, confirmed at review).
 *
 * Uses createGateway(fakeProvider) — tests the gateway in isolation without
 * touching the getGateway() singleton. The DB client is replaced with the
 * in-memory test DB so all log writes and reads are contained here.
 *
 * Assertions:
 *   - Under the cap → provider called, log row written
 *   - At the cap → { ok:false, reason:'llm_cap_reached' }, provider NOT called,
 *     NO new log row (§3.9 — the log IS the counter)
 *   - Admin at cap → provider called (exempt, §3.9)
 *   - ctx.userId null at cap → provider called (no cap outside a request)
 *   - Dry-run rows do not count toward the limit
 *   - A row exactly 61 minutes old does NOT count; one 59 minutes old does
 *     (rolling-window boundary, the most likely off-by-one)
 *   - retryAfterSeconds is derived from the oldest in-window row
 *   - forceDryRun: true with liveLlmCalls on → dry-run row, provider untouched,
 *     cap NOT consulted (dry-run fires at step 3, cap is step 4)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../db/client.js', async () => {
  const { testDb } = await import('../../db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mock ────────────────────────────────────────────────────────
import * as schema from '../../db/schema.js';
import { testDb } from '../../db/__tests__/test-db.js';
import { createTestUser } from '../../db/__tests__/test-users.js';
import { createGateway } from '../gateway.js';
import type { LlmRequest, LlmResponse } from '../provider.js';

// ── Fake provider ──────────────────────────────────────────────────────────────

const FAKE_RESPONSE: LlmResponse = {
  text: 'test response',
  stopReason: 'end_turn',
  model: 'claude-opus-4-8',
  usage: { inputTokens: 10, outputTokens: 20 },
};

const fakeComplete = vi.fn(async (): Promise<LlmResponse> => FAKE_RESPONSE);
const fakeStream = vi.fn(async (): Promise<LlmResponse> => FAKE_RESPONSE);

const fakeProvider = {
  id: 'fake',
  defaultModel: () => 'claude-opus-4-8',
  complete: fakeComplete,
  stream: fakeStream,
};

// ── Settings helpers ───────────────────────────────────────────────────────────

function setSetting(key: string, value: string): void {
  testDb
    .insert(schema.setting)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
    .run();
}

// ── Test data ──────────────────────────────────────────────────────────────────

let userId: string;
let adminId: string;

const MINIMAL_REQ: LlmRequest = {
  system: 'You are a test agent.',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 100,
};

// ── Seed users and settings once ───────────────────────────────────────────────

beforeAll(() => {
  const user = createTestUser('user');
  userId = user.id;
  const admin = createTestUser('admin');
  adminId = admin.id;

  // Live mode on — required for the live path and cap check
  setSetting('liveLlmCalls', 'true');
  // Low cap (2) for easy testing
  setSetting('maxLlmCallsPerUserPerHour', '2');
});

beforeEach(() => {
  fakeComplete.mockClear();
  fakeStream.mockClear();
  // Remove log rows between tests to isolate counts
  testDb.delete(schema.llmCallLog).run();
});

// ── Helper: insert a log row with an explicit createdAt ───────────────────────

function insertLogRow(overrides: {
  userId?: string | null;
  dryRun?: boolean;
  createdAt?: Date;
} = {}): void {
  testDb
    .insert(schema.llmCallLog)
    .values({
      id: crypto.randomUUID(),
      kind: 'chat',
      provider: 'anthropic',
      agentId: null,
      agentLabel: 'test',
      dryRun: overrides.dryRun ?? false,
      model: 'claude-opus-4-8',
      requestPayload: {
        system: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 100,
        model: 'claude-opus-4-8',
      },
      responsePayload: null,
      error: null,
      durationMs: 10,
      usage: null,
      userId: overrides.userId !== undefined ? overrides.userId : userId,
      sharedWithAdmin: false,
      ...(overrides.createdAt !== undefined ? { createdAt: overrides.createdAt } : {}),
    })
    .run();
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('per-user cap gate', () => {
  it('under the cap → provider called and log row written', async () => {
    // 0 rows in window, cap = 2 → not capped
    const gw = createGateway(fakeProvider);
    const result = await gw.complete(MINIMAL_REQ, { kind: 'chat', userId });

    expect(result.ok).toBe(true);
    expect(fakeComplete).toHaveBeenCalledTimes(1);

    // Log row was written
    const rows = testDb.select().from(schema.llmCallLog).all();
    expect(rows.length).toBe(1);
    expect(rows[0].dryRun).toBe(false);
  });

  it('at the cap → llm_cap_reached, provider NOT called, NO new log row', async () => {
    // Insert 2 recent live rows (= cap)
    insertLogRow();
    insertLogRow();
    const rowsBefore = testDb.select().from(schema.llmCallLog).all().length;

    const gw = createGateway(fakeProvider);
    const result = await gw.complete(MINIMAL_REQ, { kind: 'chat', userId });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'llm_cap_reached') {
      expect(result.logId).toBeNull();
      expect(typeof result.limit).toBe('number');
      expect(typeof result.windowSeconds).toBe('number');
      expect(typeof result.retryAfterSeconds).toBe('number');
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    } else if (!result.ok) {
      // Should not reach here — always llm_cap_reached when at the cap
      expect(result.reason).toBe('llm_cap_reached');
    }

    // Provider never called
    expect(fakeComplete).not.toHaveBeenCalled();

    // No new log row written
    const rowsAfter = testDb.select().from(schema.llmCallLog).all().length;
    expect(rowsAfter).toBe(rowsBefore);
  });

  it('concurrent burst at the cap boundary: exactly `limit` calls succeed, the rest are capped (race fix, 2026-08-12)', async () => {
    // cap = 2 (beforeAll). Fire 4 concurrent complete() calls with none of
    // them individually awaited first — this is exactly the scenario the
    // pre-fix code got wrong: the cap-check read and the log-write that made
    // a call "count" were separated by the provider round-trip (an awaited
    // call), so concurrent requests could all read the same stale count and
    // all pass. The fix (reserveCallSlot before the network call, synchronous
    // with the cap check) closes this — see gateway.ts Step 4.5.
    const gw = createGateway(fakeProvider);
    const results = await Promise.all([
      gw.complete(MINIMAL_REQ, { kind: 'chat', userId }),
      gw.complete(MINIMAL_REQ, { kind: 'chat', userId }),
      gw.complete(MINIMAL_REQ, { kind: 'chat', userId }),
      gw.complete(MINIMAL_REQ, { kind: 'chat', userId }),
    ]);

    const succeeded = results.filter((r) => r.ok);
    const capped = results.filter((r) => !r.ok && r.reason === 'llm_cap_reached');

    expect(succeeded.length).toBe(2); // exactly the cap, never more
    expect(capped.length).toBe(2);
    expect(fakeComplete).toHaveBeenCalledTimes(2); // provider never over-called either

    // The DB agrees: exactly 2 live rows for this user, not 4.
    const rows = testDb
      .select()
      .from(schema.llmCallLog)
      .where(and(eq(schema.llmCallLog.userId, userId), eq(schema.llmCallLog.dryRun, false)))
      .all();
    expect(rows.length).toBe(2);
  });

  it('admin at the cap → provider called (admin exempt)', async () => {
    // Insert 2 live rows as admin (at cap)
    insertLogRow({ userId: adminId });
    insertLogRow({ userId: adminId });

    const gw = createGateway(fakeProvider);
    const result = await gw.complete(MINIMAL_REQ, { kind: 'chat', userId: adminId });

    expect(result.ok).toBe(true);
    expect(fakeComplete).toHaveBeenCalledTimes(1);
  });

  it('ctx.userId null → provider called (no cap outside a request)', async () => {
    // Insert 2 live rows as userId (at cap), but this call has userId: null
    insertLogRow();
    insertLogRow();

    const gw = createGateway(fakeProvider);
    const result = await gw.complete(MINIMAL_REQ, { kind: 'chat', userId: null });

    expect(result.ok).toBe(true);
    expect(fakeComplete).toHaveBeenCalledTimes(1);
  });

  it('dry-run rows do not count toward the limit', async () => {
    // Insert 2 dry-run rows — should not count toward the live cap
    insertLogRow({ dryRun: true });
    insertLogRow({ dryRun: true });
    // 0 live rows → under cap = 2

    const gw = createGateway(fakeProvider);
    const result = await gw.complete(MINIMAL_REQ, { kind: 'chat', userId });

    expect(result.ok).toBe(true);
    expect(fakeComplete).toHaveBeenCalledTimes(1);
  });
});

describe('rolling-window boundary', () => {
  it('a row exactly 61 minutes old does NOT count (outside window)', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sixtyOneMinutesAgo = new Date((nowSeconds - 61 * 60) * 1000);

    // Insert 2 rows: one exactly 61 min old (outside), one fresh
    insertLogRow({ createdAt: sixtyOneMinutesAgo });
    insertLogRow({ createdAt: sixtyOneMinutesAgo });
    // Count in window = 0 (both are outside) → under cap = 2

    const gw = createGateway(fakeProvider);
    const result = await gw.complete(MINIMAL_REQ, { kind: 'chat', userId });

    expect(result.ok).toBe(true);
    expect(fakeComplete).toHaveBeenCalledTimes(1);
  });

  it('a row 59 minutes old DOES count (inside window)', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fiftyNineMinutesAgo = new Date((nowSeconds - 59 * 60) * 1000);

    // Insert 2 rows: both 59 min old (inside window) → count = 2 = cap
    insertLogRow({ createdAt: fiftyNineMinutesAgo });
    insertLogRow({ createdAt: fiftyNineMinutesAgo });

    const gw = createGateway(fakeProvider);
    const result = await gw.complete(MINIMAL_REQ, { kind: 'chat', userId });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('llm_cap_reached');
    }
    expect(fakeComplete).not.toHaveBeenCalled();
  });
});

describe('retryAfterSeconds derivation', () => {
  it('retryAfterSeconds is derived from the oldest in-window row (≈ 30 min)', async () => {
    // Cap = 2, insert 2 rows from ~30 minutes ago
    const nowSeconds = Math.floor(Date.now() / 1000);
    const thirtyMinutesAgo = new Date((nowSeconds - 30 * 60) * 1000);

    insertLogRow({ createdAt: thirtyMinutesAgo });
    insertLogRow({ createdAt: thirtyMinutesAgo });
    // oldest row is 30 min old → free at 30 min from now → retryAfterSeconds ≈ 1800

    const gw = createGateway(fakeProvider);
    const result = await gw.complete(MINIMAL_REQ, { kind: 'chat', userId });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'llm_cap_reached') {
      // Allow ±60s margin for test execution time
      expect(result.retryAfterSeconds).toBeGreaterThan(30 * 60 - 60);
      expect(result.retryAfterSeconds).toBeLessThan(30 * 60 + 60);
    }
  });
});

describe('forceDryRun: cap not consulted', () => {
  it('forceDryRun: true with liveLlmCalls on → dry-run row, provider untouched, cap skipped', async () => {
    // Insert 2 live rows (at cap) — but forceDryRun fires before cap check
    insertLogRow();
    insertLogRow();
    const rowsBefore = testDb.select().from(schema.llmCallLog).all().length;

    const gw = createGateway(fakeProvider);
    const result = await gw.complete(MINIMAL_REQ, {
      kind: 'chat',
      userId,
      forceDryRun: true,
    });

    // Returns dry_run_blocked (not llm_cap_reached)
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('dry_run_blocked');
    }

    // Provider never called
    expect(fakeComplete).not.toHaveBeenCalled();

    // Exactly one NEW log row written (the dry-run log row)
    const rowsAfter = testDb.select().from(schema.llmCallLog).all().length;
    expect(rowsAfter).toBe(rowsBefore + 1);
    const latest = testDb.select().from(schema.llmCallLog).all().at(-1)!;
    expect(latest.dryRun).toBe(true);
  });
});
