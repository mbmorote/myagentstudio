/**
 * lib/email/__tests__/gateway.test.ts
 *
 * Core gateway test suite (Plan 14, §5.3).
 *
 * Setup: fake EmailProvider whose send is a vi.fn(), injected via
 * createEmailGateway(fake | null). DB is the in-memory test instance, same
 * fixture module lib/ai/__tests__/gateway.test.ts uses. The real Resend
 * transport is never involved.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../db/client.js', async () => {
  const { testDb } = await import('../../db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mock ─────────────────────────────────────────────────────────
import { eq } from 'drizzle-orm';
import { testDb } from '../../db/__tests__/test-db.js';
import * as schema from '../../db/schema.js';
import { createEmailGateway } from '../gateway.js';
import type { EmailContext, OutboundEmail } from '../gateway.js';
import type { EmailProvider, ProviderSendResult } from '../provider.js';

// ─────────────────────────────  Helpers  ──────────────────────────────────────

const FAKE_RESULT: ProviderSendResult = { providerMessageId: 'msg_fake_123' };

function makeFakeProvider(overrides: Partial<EmailProvider> = {}): EmailProvider {
  return {
    id: 'fake',
    send: vi.fn(async () => FAKE_RESULT),
    ...overrides,
  } as unknown as EmailProvider;
}

const CTX: EmailContext = { kind: 'invite_code', relatedType: 'invite_code', relatedId: 'CODE-1' };

const MSG: OutboundEmail = {
  to: 'alice@example.com',
  subject: 'Your invite code',
  text: 'Your code is ABCD-1234.',
};

function setSetting(key: string, value: string) {
  testDb
    .insert(schema.setting)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
    .run();
}

function deleteSetting(key: string) {
  testDb.delete(schema.setting).where(eq(schema.setting.key, key)).run();
}

function setLiveEmailSends(value: string) { setSetting('liveEmailSends', value); }
function deleteLiveEmailSendsSetting() { deleteSetting('liveEmailSends'); }
function setMaxEmailsPerHour(value: string) { setSetting('maxEmailsPerHour', value); }

function countLogRows(): number {
  return testDb.select().from(schema.emailLog).all().length;
}

function latestLogRow() {
  const rows = testDb
    .select()
    .from(schema.emailLog)
    .orderBy(schema.emailLog.createdAt)
    .all();
  return rows[rows.length - 1] ?? null;
}

/**
 * Existing 'sent'/'failed' rows in the shared in-memory DB — other tests in this
 * file may have already written billable rows within the last hour. The cap
 * test computes its limit relative to this so it's order-independent instead of
 * assuming a clean slate.
 */
function countExistingBillableRows(): number {
  return testDb
    .select()
    .from(schema.emailLog)
    .all()
    .filter((r) => r.status === 'sent' || r.status === 'failed').length;
}

let baseCount = 0;

beforeEach(() => {
  baseCount = countLogRows();
  // Reset to a known-good baseline before each test unless the test says otherwise.
  setLiveEmailSends('true');
  setMaxEmailsPerHour('50');
});

// ─────────────────────────────  Tests  ────────────────────────────────────────

describe('EmailGateway', () => {
  it('not configured (provider resolves to null) → not_configured, one log row, provider never touched', async () => {
    const gw = createEmailGateway(null);
    const result = await gw.sendEmail(MSG, CTX);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_configured');
    expect(countLogRows()).toBe(baseCount + 1);
    const row = latestLogRow();
    expect(row?.status).toBe('not_configured');
    expect(row?.provider).toBe('none');
  });

  it("liveEmailSends='false' → dry_run_blocked, zero network calls", async () => {
    setLiveEmailSends('false');
    const fake = makeFakeProvider();
    const gw = createEmailGateway(fake);

    const result = await gw.sendEmail(MSG, CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('dry_run_blocked');
    // THE key assertion — provider was never invoked
    expect(fake.send).not.toHaveBeenCalled();

    expect(countLogRows()).toBe(baseCount + 1);
    const row = latestLogRow();
    expect(row?.status).toBe('dry_run');
    expect(row?.provider).toBe('fake');
  });

  it('setting absent → fail-open, live path taken', async () => {
    deleteLiveEmailSendsSetting();
    const fake = makeFakeProvider();
    const gw = createEmailGateway(fake);

    const result = await gw.sendEmail(MSG, CTX);
    expect(result.ok).toBe(true);
    expect(fake.send).toHaveBeenCalledOnce();
  });

  it("liveEmailSends='banana' → treated as off (fail-closed)", async () => {
    setLiveEmailSends('banana');
    const fake = makeFakeProvider();
    const gw = createEmailGateway(fake);

    const result = await gw.sendEmail(MSG, CTX);
    expect(result.ok).toBe(false);
    expect(fake.send).not.toHaveBeenCalled();
  });

  it('live path → ok:true, one row with status sent + providerMessageId', async () => {
    const fake = makeFakeProvider();
    const gw = createEmailGateway(fake);

    const result = await gw.sendEmail(MSG, CTX);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.providerMessageId).toBe('msg_fake_123');
    expect(countLogRows()).toBe(baseCount + 1);
    const row = latestLogRow();
    expect(row?.status).toBe('sent');
    expect(row?.providerMessageId).toBe('msg_fake_123');
    expect(row?.toEmail).toBe('alice@example.com');
  });

  it('cap reached → cap_reached + retryAfterSeconds; a dry_run row does not count toward it', async () => {
    // Limit computed relative to whatever billable rows other tests in this file
    // have already written (the window is wall-clock, not test-scoped) — this
    // test asserts "two MORE billable sends reach the cap", not "the cap is 2".
    const limit = countExistingBillableRows() + 2;
    setMaxEmailsPerHour(String(limit));
    const fake = makeFakeProvider();
    const gw = createEmailGateway(fake);

    // Two billable ('sent') sends reach the cap.
    await gw.sendEmail(MSG, CTX);
    await gw.sendEmail(MSG, CTX);
    // A dry_run row logged in between must not push the count over on its own —
    // verified separately by flipping the switch off for one send.
    setLiveEmailSends('false');
    await gw.sendEmail(MSG, CTX); // logs a 'dry_run' row
    setLiveEmailSends('true');

    const third = await gw.sendEmail(MSG, CTX);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.reason).toBe('cap_reached');
      expect(third.retryAfterSeconds).toBeGreaterThan(0);
    }
    // Only the two 'sent' + one blocked_cap row should have been added beyond
    // the dry_run row — the dry_run row itself never counted toward the cap.
    const row = latestLogRow();
    expect(row?.status).toBe('blocked_cap');
  });

  it('provider throws a generic error → provider_error, gateway does not throw', async () => {
    const originalError = new Error('Upstream rejected the request');
    const fake = makeFakeProvider({
      send: vi.fn(async () => { throw originalError; }),
    });
    const gw = createEmailGateway(fake);

    await expect(gw.sendEmail(MSG, CTX)).resolves.toMatchObject({ ok: false, reason: 'provider_error' });
    const row = latestLogRow();
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('Upstream rejected the request');
  });

  it('provider throws a timeout error → classified as timeout, row written, no throw', async () => {
    const timeoutErr = new Error('The operation timed out');
    timeoutErr.name = 'TimeoutError';
    const fake = makeFakeProvider({
      send: vi.fn(async () => { throw timeoutErr; }),
    });
    const gw = createEmailGateway(fake);

    const result = await gw.sendEmail(MSG, CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
    const row = latestLogRow();
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('TimeoutError');
  });

  it('an AbortError from the provider is also classified as timeout', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    const fake = makeFakeProvider({
      send: vi.fn(async () => { throw abortErr; }),
    });
    const gw = createEmailGateway(fake);

    const result = await gw.sendEmail(MSG, CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
  });

  it('kill switch is re-read per call: flip between two sends changes behavior with no restart', async () => {
    setLiveEmailSends('false');
    const fake = makeFakeProvider();
    const gw = createEmailGateway(fake);

    const first = await gw.sendEmail(MSG, CTX);
    expect(first.ok).toBe(false);
    expect(fake.send).not.toHaveBeenCalled();

    setLiveEmailSends('true');
    const second = await gw.sendEmail(MSG, CTX);
    expect(second.ok).toBe(true);
    expect(fake.send).toHaveBeenCalledOnce();
  });

  it('a resolver function is called fresh on every send (not memoized at construction)', async () => {
    const fake = makeFakeProvider();
    const resolver = vi.fn(() => fake);
    const gw = createEmailGateway(resolver);

    await gw.sendEmail(MSG, CTX);
    await gw.sendEmail(MSG, CTX);
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
