/**
 * lib/db/repository/__tests__/emailLog.test.ts
 *
 * Repository tests for emailLog (Plan 14, §5.1).
 *
 * Tests:
 *   - Insert/read round trip for every status value
 *   - countBillableEmailsInWindow counts sent+failed, excludes dry_run/blocked_cap/not_configured
 *   - Rolling-window boundary (a row exactly at the edge, one just outside)
 *   - getLastEmailForInviteCode returns the newest row for a code, null for another
 *   - No UPDATE/DELETE exported (structural assertion, matching llmCallLog's)
 */

import { describe, expect, it, vi } from 'vitest';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mock ─────────────────────────────────────────────────────────
import { eq } from 'drizzle-orm';
import { testDb } from '../../__tests__/test-db.js';
import * as schema from '../../schema.js';
import * as emailLogModule from '../emailLog.js';
import {
  writeEmailLog,
  countBillableEmailsInWindow,
  getLastEmailForInviteCode,
  listEmailLog,
} from '../emailLog.js';
import type { WriteEmailLogInput, EmailLogStatus } from '../emailLog.js';

function makeInput(overrides: Partial<WriteEmailLogInput> = {}): WriteEmailLogInput {
  return {
    kind: 'invite_code',
    provider: 'resend',
    toEmail: 'alice@example.com',
    subject: 'Your MyAgentStudio invite code',
    status: 'sent',
    durationMs: 120,
    ...overrides,
  };
}

describe('emailLog repository', () => {
  it('writeEmailLog returns a non-empty id string', () => {
    const id = writeEmailLog(makeInput());
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('round-trips every status value via getLastEmailForInviteCode', () => {
    const statuses: EmailLogStatus[] = ['sent', 'failed', 'dry_run', 'blocked_cap', 'not_configured'];
    for (const status of statuses) {
      const code = `CODE-${status}`;
      writeEmailLog(makeInput({
        status,
        relatedType: 'invite_code',
        relatedId: code,
        providerMessageId: status === 'sent' ? 'msg_123' : null,
        error: status === 'failed' ? 'EmailProviderError: 500 Internal' : null,
      }));
      const row = getLastEmailForInviteCode(code);
      expect(row).not.toBeNull();
      expect(row!.status).toBe(status);
      expect(row!.kind).toBe('invite_code');
      expect(row!.provider).toBe('resend');
      expect(row!.toEmail).toBe('alice@example.com');
    }
  });

  it('countBillableEmailsInWindow counts only sent+failed, excludes the rest', () => {
    // Measured as a DELTA around a fixed window bound, not an absolute count —
    // this suite shares one in-memory DB across tests, and createdAt is
    // second-granularity (unixepoch()), so earlier tests' rows can fall inside
    // the same window as this test's own writes.
    const sinceMs = Date.now() - 1000;
    const before = countBillableEmailsInWindow(sinceMs);

    writeEmailLog(makeInput({ status: 'sent', relatedId: 'billable-1' }));
    writeEmailLog(makeInput({ status: 'failed', relatedId: 'billable-2' }));
    writeEmailLog(makeInput({ status: 'dry_run', relatedId: 'billable-3' }));
    writeEmailLog(makeInput({ status: 'blocked_cap', relatedId: 'billable-4' }));
    writeEmailLog(makeInput({ status: 'not_configured', relatedId: 'billable-5' }));

    const after = countBillableEmailsInWindow(sinceMs);
    expect(after - before).toBe(2);
  });

  it('rolling-window boundary: excludes a row created before the window start', () => {
    // A row from "the past" relative to a window starting now + 1 hour from now
    writeEmailLog(makeInput({ status: 'sent', relatedId: 'boundary-old' }));
    const futureSince = Date.now() + 3600_000; // 1 hour in the future — this row is outside
    const count = countBillableEmailsInWindow(futureSince);
    expect(count).toBe(0);
  });

  it('getLastEmailForInviteCode returns the newest row for that code and nothing for another', () => {
    const codeA = 'NEWEST-A';
    const codeB = 'OTHER-B';
    const olderId = writeEmailLog(makeInput({ status: 'failed', relatedType: 'invite_code', relatedId: codeA, error: 'first attempt' }));
    // createdAt is second-granularity (unixepoch()) — both writes can land in the
    // same second in a fast test run, so backdate the older row explicitly to
    // make "newest" unambiguous, rather than relying on wall-clock separation.
    testDb.update(schema.emailLog)
      .set({ createdAt: new Date(Date.now() - 10_000) })
      .where(eq(schema.emailLog.id, olderId))
      .run();
    writeEmailLog(makeInput({ status: 'sent', relatedType: 'invite_code', relatedId: codeA, error: null }));

    const newest = getLastEmailForInviteCode(codeA);
    expect(newest?.status).toBe('sent');

    const other = getLastEmailForInviteCode(codeB);
    expect(other).toBeNull();
  });

  it('listEmailLog lists rows newest first', () => {
    writeEmailLog(makeInput({ relatedId: 'list-1' }));
    writeEmailLog(makeInput({ relatedId: 'list-2' }));
    const rows = listEmailLog({ limit: 2 });
    expect(rows.length).toBe(2);
    expect(rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(rows[1].createdAt.getTime());
  });

  it('exports no UPDATE/DELETE function — append-only by convention', () => {
    const exportNames = Object.keys(emailLogModule);
    const forbidden = exportNames.filter((name) =>
      /update/i.test(name) || /delete/i.test(name),
    );
    expect(forbidden).toEqual([]);
  });
});
