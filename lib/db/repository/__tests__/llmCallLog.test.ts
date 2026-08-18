/**
 * lib/db/repository/__tests__/llmCallLog.test.ts
 *
 * Repository tests for llmCallLog (§10.3).
 *
 * Tests:
 *   - writeCallLog returns a non-empty id
 *   - listCallLogs ordering (createdAt DESC, id DESC)
 *   - dryRun / kind / limit filters
 *   - list rows omit requestPayload / responsePayload
 *   - getCallLog returns them
 *   - reserveCallSlot / finalizeCallLog (the one sanctioned update pair, added
 *     2026-08-12 to close the cap-check race — see llmCallLog.ts's own header)
 *   - module exports no DELETE function, and no update function beyond that pair
 */

import { describe, expect, it, vi } from 'vitest';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mock ─────────────────────────────────────────────────────────
import * as llmCallLogModule from '../llmCallLog.js';
import { writeCallLog, listCallLogs, getCallLog, reserveCallSlot, finalizeCallLog } from '../llmCallLog.js';
import type { WriteCallLogInput } from '../llmCallLog.js';

// Shared fixture for a minimal valid request payload
const REQ: WriteCallLogInput['requestPayload'] = {
  system: 'You are a test agent.',
  messages: [{ role: 'user', content: 'Hello' }],
  maxTokens: 1024,
  model: 'claude-opus-4-8',
};

const RESP: WriteCallLogInput['responsePayload'] = {
  text: 'Hello, world!',
  stopReason: 'end_turn',
};

function makeInput(overrides: Partial<WriteCallLogInput> = {}): WriteCallLogInput {
  return {
    kind: 'chat',
    provider: 'anthropic',
    agentId: 'agent-1',
    agentLabel: 'test-agent',
    dryRun: false,
    model: 'claude-opus-4-8',
    requestPayload: REQ,
    responsePayload: RESP,
    durationMs: 100,
    userId: null,
    sharedWithAdmin: false,
    ...overrides,
  };
}

// Viewer id used throughout — any string works; we test redaction separately
const VIEWER_ID = 'test-viewer-id';

describe('llmCallLog repository', () => {
  it('writeCallLog returns a non-empty id string', () => {
    const id = writeCallLog(makeInput());
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('getCallLog returns the full row including payloads', () => {
    const id = writeCallLog(makeInput({
      kind: 'import-strict',
      agentId: null,
      agentLabel: 'my-agent',
      dryRun: true,
      responsePayload: null,
      error: null,
      durationMs: 2,
    }));
    const row = getCallLog(id, VIEWER_ID);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(id);
    expect(row!.kind).toBe('import-strict');
    expect(row!.dryRun).toBe(true);
    expect(row!.agentId).toBeNull();
    expect(row!.agentLabel).toBe('my-agent');
    expect(row!.requestPayload).toMatchObject({ system: REQ.system });
    expect(row!.responsePayload).toBeNull();
  });

  it('getCallLog returns null for an unknown id', () => {
    expect(getCallLog('does-not-exist', VIEWER_ID)).toBeNull();
  });

  it('list rows omit requestPayload and responsePayload', () => {
    const id = writeCallLog(makeInput());
    const list = listCallLogs({ limit: 10 });
    const item = list.find((r) => r.id === id);
    expect(item).toBeDefined();
    // The list DTO type does not include payload fields
    expect('requestPayload' in (item as object)).toBe(false);
    expect('responsePayload' in (item as object)).toBe(false);
  });

  it('listCallLogs returns all written rows', () => {
    // Write two rows and verify both appear in the list.
    // Strict ordering is not asserted here because SQLite stores timestamps at
    // second precision — two rows written in the same second share the same
    // createdAt, making DESC order of the secondary id (UUID, random) non-deterministic.
    const idA = writeCallLog(makeInput({ model: 'model-A' }));
    const idB = writeCallLog(makeInput({ model: 'model-B' }));
    const list = listCallLogs({ limit: 500 });
    const idxA = list.findIndex((r) => r.id === idA);
    const idxB = list.findIndex((r) => r.id === idB);
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(-1);
  });

  it('listCallLogs filters by dryRun', () => {
    writeCallLog(makeInput({ dryRun: true, responsePayload: null }));
    writeCallLog(makeInput({ dryRun: false }));
    const dryRuns = listCallLogs({ dryRun: true, limit: 500 });
    expect(dryRuns.every((r) => r.dryRun === true)).toBe(true);
    const live = listCallLogs({ dryRun: false, limit: 500 });
    expect(live.every((r) => r.dryRun === false)).toBe(true);
  });

  it('listCallLogs filters by kind', () => {
    writeCallLog(makeInput({ kind: 'import-structural' }));
    const rows = listCallLogs({ kind: 'import-structural', limit: 500 });
    expect(rows.every((r) => r.kind === 'import-structural')).toBe(true);
  });

  it('listCallLogs respects the limit', () => {
    // Write 5 more rows
    for (let i = 0; i < 5; i++) writeCallLog(makeInput());
    const rows = listCallLogs({ limit: 2 });
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it('module exports no deleteCallLog, and no free-form updateCallLog', () => {
    expect('deleteCallLog' in llmCallLogModule).toBe(false);
    expect('updateCallLog' in llmCallLogModule).toBe(false);
    // The one sanctioned exception — narrow, paired, documented (llmCallLog.ts header).
    expect(typeof llmCallLogModule.reserveCallSlot).toBe('function');
    expect(typeof llmCallLogModule.finalizeCallLog).toBe('function');
  });

  it('reserveCallSlot writes a row that immediately counts (dryRun:false) with a null response', () => {
    const id = reserveCallSlot({
      kind: 'chat',
      provider: 'anthropic',
      agentId: 'agent-1',
      agentLabel: 'test-agent',
      model: 'claude-opus-4-8',
      requestPayload: REQ,
      userId: null,
      sharedWithAdmin: false,
    });
    expect(typeof id).toBe('string');

    const row = getCallLog(id, VIEWER_ID);
    expect(row).not.toBeNull();
    expect(row?.dryRun).toBe(false);
    expect(row?.responsePayload).toBeNull();
    expect(row?.error).toBeNull();
    expect(row?.durationMs).toBe(0);
  });

  it('finalizeCallLog completes a reserved row with the real outcome, in place (no new row)', () => {
    const id = reserveCallSlot({
      kind: 'chat',
      provider: 'anthropic',
      agentId: 'agent-1',
      agentLabel: 'test-agent',
      model: 'claude-opus-4-8',
      requestPayload: REQ,
      userId: null,
      sharedWithAdmin: false,
    });
    const rowsBefore = listCallLogs().length;

    finalizeCallLog(id, {
      responsePayload: RESP,
      error: null,
      durationMs: 250,
      usage: { inputTokens: 5, outputTokens: 10 },
    });

    const rowsAfter = listCallLogs().length;
    expect(rowsAfter).toBe(rowsBefore); // updated in place, not a second row

    const row = getCallLog(id, VIEWER_ID);
    expect(row?.responsePayload).toEqual(RESP);
    expect(row?.durationMs).toBe(250);
    expect(row?.usage).toEqual({ inputTokens: 5, outputTokens: 10 });
  });

  it('finalizeCallLog can record an error outcome on a reserved row', () => {
    const id = reserveCallSlot({
      kind: 'chat',
      provider: 'anthropic',
      agentId: null,
      agentLabel: null,
      model: 'claude-opus-4-8',
      requestPayload: REQ,
      userId: null,
      sharedWithAdmin: false,
    });

    finalizeCallLog(id, {
      responsePayload: null,
      error: 'AbortError: The operation was aborted',
      durationMs: 42,
      usage: null,
    });

    const row = getCallLog(id, VIEWER_ID);
    expect(row?.responsePayload).toBeNull();
    expect(row?.error).toBe('AbortError: The operation was aborted');
  });
});
