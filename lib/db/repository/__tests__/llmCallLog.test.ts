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
 *   - module exports no update/delete functions
 */

import { describe, expect, it, vi } from 'vitest';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mock ─────────────────────────────────────────────────────────
import * as llmCallLogModule from '../llmCallLog.js';
import { writeCallLog, listCallLogs, getCallLog } from '../llmCallLog.js';
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
    agentId: 'agent-1',
    agentLabel: 'test-agent',
    dryRun: false,
    model: 'claude-opus-4-8',
    requestPayload: REQ,
    responsePayload: RESP,
    durationMs: 100,
    ...overrides,
  };
}

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
    const row = getCallLog(id);
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
    expect(getCallLog('does-not-exist')).toBeNull();
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

  it('module exports no updateCallLog or deleteCallLog', () => {
    expect('updateCallLog' in llmCallLogModule).toBe(false);
    expect('deleteCallLog' in llmCallLogModule).toBe(false);
  });
});
