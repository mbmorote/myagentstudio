/**
 * app/api/auth/__tests__/request-access-notice.test.ts
 *
 * Tests for the D4 admin-notification trigger on POST /api/auth/request-access
 * (Plan 14, §5.5). Covers:
 *   - the notice fires ONLY on the "new request created" branch, never on any
 *     anti-enumeration dedupe branch
 *   - the response body and status are byte-identical across every branch,
 *     regardless of whether the send succeeds, fails, or never fires (§7 risk 10)
 *   - the send is fire-and-forget — the response resolves without waiting on it
 *
 * The real transport (resendProvider.js) is mocked — never a real network call.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock DB client ─────────────────────────────────────────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock the ONE transport (resendProvider) — never a real network call ──────
import type { EmailMessage, ProviderSendResult } from '../../../../lib/email/provider.js';

const sendMock = vi.fn<(msg: EmailMessage, opts: { signal: AbortSignal }) => Promise<ProviderSendResult>>(
  async () => ({ providerMessageId: 'msg_test_notice' }),
);
vi.mock('../../../../lib/email/resendProvider.js', () => ({
  createResendProvider: () => ({ id: 'resend', send: sendMock }),
}));

// After mocks
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import * as schema from '../../../../lib/db/schema.js';
import { createTestUser } from '../../../../lib/db/__tests__/test-users.js';
import { generateInviteCode } from '../../../../lib/auth/inviteCode.js';
import { POST as requestAccessPOST } from '../request-access/route.js';

let ipCounter = 1;
function nextIp() { return `192.168.40.${ipCounter++}`; }

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
  }
});

beforeEach(() => {
  sendMock.mockClear();
  sendMock.mockImplementation(async () => ({ providerMessageId: 'msg_test_notice' }));
  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
  process.env.APP_BASE_URL = 'https://myagentstudio.dev';
  process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@myagentstudio.dev';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeRequest(body: unknown, ip: string): NextRequest {
  return new NextRequest('http://localhost/api/auth/request-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/request-access — D4 admin notice', () => {
  it('fires on a brand-new request, addressed to ADMIN_NOTIFICATION_EMAIL', async () => {
    const email = `notice-new-${crypto.randomUUID()}@example.com`;
    const res = await requestAccessPOST(makeRequest({ name: 'New Requester', email }, nextIp()));
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    const [msg] = sendMock.mock.calls[0];
    expect(msg.to).toBe('admin@myagentstudio.dev');
    expect(msg.subject).toContain('access request');
  });

  it('does NOT fire when the email is already registered', async () => {
    const existing = createTestUser();
    const res = await requestAccessPOST(makeRequest({ name: 'Registered', email: existing.email }, nextIp()));
    expect(res.status).toBe(201);

    await new Promise((r) => setTimeout(r, 20)); // let any stray async work run
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does NOT fire on a second submit for an already-open request', async () => {
    const email = `notice-dup-${crypto.randomUUID()}@example.com`;
    await requestAccessPOST(makeRequest({ name: 'First' , email }, nextIp()));
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1)); // the first submit fires it
    sendMock.mockClear();

    const res2 = await requestAccessPOST(makeRequest({ name: 'First Again', email }, nextIp()));
    expect(res2.status).toBe(201);
    await new Promise((r) => setTimeout(r, 20));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does NOT fire when an active bound invite code already exists for the email', async () => {
    const email = `notice-bound-${crypto.randomUUID()}@example.com`;
    testDb.insert(schema.inviteCode).values({
      code: generateInviteCode(),
      note: 'pre-existing',
      createdBy: null,
      redeemedBy: null,
      boundEmail: email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }).run();

    const res = await requestAccessPOST(makeRequest({ name: 'Bound Already', email }, nextIp()));
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 20));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does NOT fire when ADMIN_NOTIFICATION_EMAIL is unset', async () => {
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    const email = `notice-noadmin-${crypto.randomUUID()}@example.com`;
    const res = await requestAccessPOST(makeRequest({ name: 'No Admin Configured', email }, nextIp()));
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 20));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('response body and status are byte-identical across every branch', async () => {
    const responses: unknown[] = [];

    // Branch: brand-new request
    const r1 = await requestAccessPOST(makeRequest(
      { name: 'Branch New', email: `branch-new-${crypto.randomUUID()}@example.com` }, nextIp(),
    ));
    expect(r1.status).toBe(201);
    responses.push(await r1.json());

    // Branch: already registered
    const existing = createTestUser();
    const r2 = await requestAccessPOST(makeRequest({ name: 'Branch Registered', email: existing.email }, nextIp()));
    expect(r2.status).toBe(201);
    responses.push(await r2.json());

    // Branch: already-open request (second submit)
    const dupEmail = `branch-dup-${crypto.randomUUID()}@example.com`;
    await requestAccessPOST(makeRequest({ name: 'Branch Dup First', email: dupEmail }, nextIp()));
    const r3 = await requestAccessPOST(makeRequest({ name: 'Branch Dup Second', email: dupEmail }, nextIp()));
    expect(r3.status).toBe(201);
    responses.push(await r3.json());

    // Branch: already-bound active invite code
    const boundEmail = `branch-bound-${crypto.randomUUID()}@example.com`;
    testDb.insert(schema.inviteCode).values({
      code: generateInviteCode(), note: null, createdBy: null, redeemedBy: null,
      boundEmail, expiresAt: new Date(Date.now() + 3600_000),
    }).run();
    const r4 = await requestAccessPOST(makeRequest({ name: 'Branch Bound', email: boundEmail }, nextIp()));
    expect(r4.status).toBe(201);
    responses.push(await r4.json());

    for (const body of responses) {
      expect(body).toEqual(responses[0]);
    }
  });

  it('response body/status are identical whether the notice send succeeds or fails', async () => {
    const emailOk = `notice-ok-${crypto.randomUUID()}@example.com`;
    const resOk = await requestAccessPOST(makeRequest({ name: 'Ok Path', email: emailOk }, nextIp()));
    const bodyOk = await resOk.json();

    sendMock.mockImplementationOnce(async () => { throw new Error('simulated provider failure'); });
    const emailFail = `notice-fail-${crypto.randomUUID()}@example.com`;
    const resFail = await requestAccessPOST(makeRequest({ name: 'Fail Path', email: emailFail }, nextIp()));
    const bodyFail = await resFail.json();

    expect(resFail.status).toBe(resOk.status);
    expect(bodyFail).toEqual(bodyOk);

    // Let the failing send settle so it doesn't leak an unhandled rejection into another test.
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledTimes(2));
  });

  it('is fire-and-forget: the response resolves without waiting on a slow send', async () => {
    let resolveSend!: () => void;
    sendMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSend = () => resolve({ providerMessageId: 'slow' });
    }));

    const email = `notice-slow-${crypto.randomUUID()}@example.com`;
    const start = Date.now();
    const res = await requestAccessPOST(makeRequest({ name: 'Slow Notice', email }, nextIp()));
    const elapsedMs = Date.now() - start;

    expect(res.status).toBe(201);
    // The response came back without waiting on the still-pending send.
    expect(elapsedMs).toBeLessThan(500);

    resolveSend();
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
  });
});
