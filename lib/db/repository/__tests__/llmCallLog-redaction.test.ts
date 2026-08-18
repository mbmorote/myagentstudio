/**
 * lib/db/repository/__tests__/llmCallLog-redaction.test.ts
 *
 * Tests the §5.6 redaction rule in getCallLog() and the redacted flag in listCallLogs().
 *
 * Redaction rule:
 *   redacted = userId !== null && userId !== viewerUserId && sharedWithAdmin === false
 *
 * Cases to cover:
 *   - Pre-auth row (userId === null): NEVER redacted
 *   - Viewer's own row (userId === viewerUserId): NOT redacted, payloads visible
 *   - Another user, sharedWithAdmin === true: NOT redacted, payloads visible
 *   - Another user, sharedWithAdmin === false: REDACTED, payloads null
 *   - Redacted list item has redacted: true, others false
 *   - countLlmCallsInWindow counts only dry_run=0 rows in the window
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

import { writeCallLog, listCallLogs, getCallLog, countLlmCallsInWindow } from '../llmCallLog.js';
import type { WriteCallLogInput } from '../llmCallLog.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

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

function makeRow(overrides: Partial<WriteCallLogInput> = {}): string {
  return writeCallLog({
    kind: 'chat',
    provider: 'anthropic',
    agentId: null,
    agentLabel: 'test',
    dryRun: false,
    model: 'claude-opus-4-8',
    requestPayload: REQ,
    responsePayload: RESP,
    durationMs: 100,
    userId: null,
    sharedWithAdmin: false,
    ...overrides,
  });
}

const VIEWER_ID = 'viewer-user-id';
const OTHER_USER_ID = 'other-user-id';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('§5.6 redaction rule — getCallLog', () => {
  it('pre-auth row (userId null): payloads visible, redacted false', () => {
    const id = makeRow({ userId: null, sharedWithAdmin: false });
    const row = getCallLog(id, VIEWER_ID);
    expect(row).not.toBeNull();
    expect(row!.redacted).toBe(false);
    expect(row!.requestPayload).not.toBeNull();
    expect(row!.responsePayload).not.toBeNull();
  });

  it("viewer's own row (userId === viewerUserId): payloads visible, redacted false", () => {
    const id = makeRow({ userId: VIEWER_ID, sharedWithAdmin: false });
    const row = getCallLog(id, VIEWER_ID);
    expect(row).not.toBeNull();
    expect(row!.redacted).toBe(false);
    expect(row!.requestPayload).toMatchObject({ system: REQ.system });
    expect(row!.responsePayload).not.toBeNull();
  });

  it('another user, sharedWithAdmin true: payloads visible, redacted false', () => {
    const id = makeRow({ userId: OTHER_USER_ID, sharedWithAdmin: true });
    const row = getCallLog(id, VIEWER_ID);
    expect(row).not.toBeNull();
    expect(row!.redacted).toBe(false);
    expect(row!.requestPayload).toMatchObject({ system: REQ.system });
    expect(row!.responsePayload).not.toBeNull();
  });

  it('another user, sharedWithAdmin false: payloads null, redacted true', () => {
    const id = makeRow({ userId: OTHER_USER_ID, sharedWithAdmin: false });
    const row = getCallLog(id, VIEWER_ID);
    expect(row).not.toBeNull();
    expect(row!.redacted).toBe(true);
    expect(row!.requestPayload).toBeNull();
    expect(row!.responsePayload).toBeNull();
  });

  it('metadata fields are always visible on redacted row', () => {
    const id = makeRow({ userId: OTHER_USER_ID, sharedWithAdmin: false, model: 'test-model-x' });
    const row = getCallLog(id, VIEWER_ID);
    expect(row!.id).toBe(id);
    expect(row!.model).toBe('test-model-x');
    expect(row!.durationMs).toBe(100);
    expect(row!.userId).toBe(OTHER_USER_ID);
  });
});

describe('§5.6 redaction rule — listCallLogs', () => {
  it('redacted flag matches getCallLog for each row type', () => {
    const idPreAuth = makeRow({ userId: null, sharedWithAdmin: false });
    const idOwn = makeRow({ userId: VIEWER_ID, sharedWithAdmin: false });
    const idShared = makeRow({ userId: OTHER_USER_ID, sharedWithAdmin: true });
    const idPrivate = makeRow({ userId: OTHER_USER_ID, sharedWithAdmin: false });

    const list = listCallLogs({ limit: 500, viewerUserId: VIEWER_ID });

    const preAuthItem = list.find((r) => r.id === idPreAuth);
    const ownItem = list.find((r) => r.id === idOwn);
    const sharedItem = list.find((r) => r.id === idShared);
    const privateItem = list.find((r) => r.id === idPrivate);

    expect(preAuthItem?.redacted).toBe(false);
    expect(ownItem?.redacted).toBe(false);
    expect(sharedItem?.redacted).toBe(false);
    expect(privateItem?.redacted).toBe(true);
  });

  it('list DTO never includes payload fields', () => {
    const id = makeRow({ userId: VIEWER_ID, sharedWithAdmin: false });
    const item = listCallLogs({ limit: 500 }).find((r) => r.id === id);
    expect(item).toBeDefined();
    expect('requestPayload' in (item as object)).toBe(false);
    expect('responsePayload' in (item as object)).toBe(false);
  });
});

describe('countLlmCallsInWindow', () => {
  it('counts only dry_run=0 rows for the user in the window', () => {
    const userId = `cap-test-${crypto.randomUUID()}`;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sinceSeconds = nowSeconds - 3600;

    // Write 2 live rows + 1 dry-run row
    makeRow({ userId, dryRun: false, sharedWithAdmin: false });
    makeRow({ userId, dryRun: false, sharedWithAdmin: false });
    makeRow({ userId, dryRun: true, sharedWithAdmin: false });

    const { count } = countLlmCallsInWindow(userId, sinceSeconds);
    expect(count).toBe(2); // dry-run row excluded
  });

  it('returns count=0 and oldestAt=null for a user with no live rows', () => {
    const userId = `cap-zero-${crypto.randomUUID()}`;
    const sinceSeconds = Math.floor(Date.now() / 1000) - 3600;
    const { count, oldestAt } = countLlmCallsInWindow(userId, sinceSeconds);
    expect(count).toBe(0);
    expect(oldestAt).toBeNull();
  });

  it('does not count rows from a different user', () => {
    const myId = `cap-mine-${crypto.randomUUID()}`;
    const otherId = `cap-other-${crypto.randomUUID()}`;
    const sinceSeconds = Math.floor(Date.now() / 1000) - 3600;

    // Write one row for myId, two for otherId
    makeRow({ userId: myId, dryRun: false, sharedWithAdmin: false });
    makeRow({ userId: otherId, dryRun: false, sharedWithAdmin: false });
    makeRow({ userId: otherId, dryRun: false, sharedWithAdmin: false });

    const { count } = countLlmCallsInWindow(myId, sinceSeconds);
    expect(count).toBe(1);
  });

  it('returns a non-null oldestAt when there are rows', () => {
    const userId = `cap-oldest-${crypto.randomUUID()}`;
    const sinceSeconds = Math.floor(Date.now() / 1000) - 3600;
    makeRow({ userId, dryRun: false, sharedWithAdmin: false });
    const { count, oldestAt } = countLlmCallsInWindow(userId, sinceSeconds);
    expect(count).toBe(1);
    expect(oldestAt).toBeInstanceOf(Date);
  });
});
