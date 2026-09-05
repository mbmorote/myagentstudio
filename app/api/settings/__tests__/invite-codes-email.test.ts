/**
 * app/api/settings/__tests__/invite-codes-email.test.ts
 *
 * Tests for the Plan 14 email triggers wired into the invite-code routes (§5.5):
 *   - POST .../access-requests/[id]/generate-code — auto-send (D3)
 *   - POST .../invite-codes — optional sendTo (D3)
 *   - POST .../invite-codes/[code]/send — admin manual (re)send, the recovery path
 *
 * The real transport (resendProvider.js) is mocked — never a real network call.
 * Mirrors access-requests.test.ts / invite-codes.test.ts's structure in this folder.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock DB client ─────────────────────────────────────────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock getSession — the single auth seam ────────────────────────────────────
let currentSession: { userId: string; email: string; role: 'admin' | 'user' } | null = null;
vi.mock('../../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// ── Mock the ONE transport (resendProvider) — never a real network call ──────
import type { EmailMessage, ProviderSendResult } from '../../../../lib/email/provider.js';

const sendMock = vi.fn<(msg: EmailMessage, opts: { signal: AbortSignal }) => Promise<ProviderSendResult>>(
  async () => ({ providerMessageId: 'msg_test' }),
);
vi.mock('../../../../lib/email/resendProvider.js', () => ({
  createResendProvider: () => ({ id: 'resend', send: sendMock }),
}));

// After mocks
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import * as schema from '../../../../lib/db/schema.js';
import { createTestUser } from '../../../../lib/db/__tests__/test-users.js';

import { POST as requestAccessPOST } from '../../auth/request-access/route.js';
import { POST as generateCodeForRequest } from '../access-requests/[id]/generate-code/route.js';
import { POST as createInviteCodePOST } from '../invite-codes/route.js';
import { POST as sendInviteCodePOST } from '../invite-codes/[code]/send/route.js';

let admin: ReturnType<typeof createTestUser>;
let user: ReturnType<typeof createTestUser>;
let ipCounter = 1;
function nextIp() { return `192.168.30.${ipCounter++}`; }

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
  }
  admin = createTestUser('admin');
  user = createTestUser('user');
  testDb.insert(schema.setting).values({ key: 'maxUsers', value: '1000' })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: '1000', updatedAt: new Date() } })
    .run();
});

beforeEach(() => {
  sendMock.mockClear();
  sendMock.mockImplementation(async () => ({ providerMessageId: 'msg_test' }));
  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
  process.env.APP_BASE_URL = 'https://myagentstudio.dev';
  currentSession = { userId: admin.id, email: admin.email, role: 'admin' };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeRequest(path: string, method = 'GET', body?: object): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Creates an open access-request row via the real (public) route. */
async function createOpenRequest(name: string): Promise<{ id: string; email: string }> {
  const email = `${name.toLowerCase()}-${crypto.randomUUID()}@example.com`;
  const res = await requestAccessPOST(new NextRequest('http://localhost/api/auth/request-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify({ name, email }),
  }));
  expect(res.status).toBe(201);
  sendMock.mockClear(); // request-access may itself fire a D4 notice — isolate that from this file's assertions
  const row = testDb.select().from(schema.accessRequest).all().find((r) => r.email === email);
  if (!row) throw new Error('access request row not found after creation');
  return { id: row.id, email };
}

// ── generate-code — auto-send (D3) ────────────────────────────────────────────

describe('generate-code — auto-send (D3)', () => {
  it('happy path: 201, emailStatus sent, exactly one send addressed to the request email', async () => {
    const { id, email } = await createOpenRequest('AutoSendHappy');
    const res = await generateCodeForRequest(
      makeRequest(`/api/settings/access-requests/${id}/generate-code`, 'POST'),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { code: string; emailStatus: string };
    expect(body.emailStatus).toBe('sent');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [msg] = sendMock.mock.calls[0];
    expect(msg.to).toBe(email); // never any address from the request body
  });

  it('provider throws → still 201, still returns the code, request still deleted, emailStatus failed', async () => {
    sendMock.mockImplementationOnce(async () => { throw new Error('simulated provider failure'); });
    const { id } = await createOpenRequest('AutoSendFails');

    const res = await generateCodeForRequest(
      makeRequest(`/api/settings/access-requests/${id}/generate-code`, 'POST'),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { code: string; emailStatus: string };
    expect(typeof body.code).toBe('string');
    expect(body.emailStatus).toBe('failed');

    const codeRow = testDb.select().from(schema.inviteCode).all().find((c) => c.code === body.code);
    expect(codeRow).toBeDefined(); // the code IS still created and committed
    const requestRow = testDb.select().from(schema.accessRequest).all().find((r) => r.id === id);
    expect(requestRow).toBeUndefined(); // the request row IS still deleted
  });

  it('email unconfigured → 201, emailStatus not_configured, no send attempted', async () => {
    delete process.env.RESEND_API_KEY;
    const { id } = await createOpenRequest('AutoSendUnconfigured');

    const res = await generateCodeForRequest(
      makeRequest(`/api/settings/access-requests/${id}/generate-code`, 'POST'),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { emailStatus: string };
    expect(body.emailStatus).toBe('not_configured');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

// ── invite-codes POST — optional sendTo (D3) ──────────────────────────────────

describe('POST /api/settings/invite-codes — optional sendTo (D3)', () => {
  it('without sendTo: response has no emailStatus field at all, no send attempted', async () => {
    const res = await createInviteCodePOST(makeRequest('/api/settings/invite-codes', 'POST', { note: 'manual' }));
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect('emailStatus' in body).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('with sendTo: 201, emailStatus sent, addressed to sendTo', async () => {
    const to = `manual-recipient-${crypto.randomUUID()}@example.com`;
    const res = await createInviteCodePOST(makeRequest('/api/settings/invite-codes', 'POST', { sendTo: to }));
    expect(res.status).toBe(201);
    const body = await res.json() as { emailStatus: string };
    expect(body.emailStatus).toBe('sent');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [msg] = sendMock.mock.calls[0];
    expect(msg.to).toBe(to);
  });

  it('an invalid sendTo (no @) → 400 invalid_send_to, no code created', async () => {
    const before = testDb.select().from(schema.inviteCode).all().length;
    const res = await createInviteCodePOST(makeRequest('/api/settings/invite-codes', 'POST', { sendTo: 'not-an-email' }));
    expect(res.status).toBe(400);
    const after = testDb.select().from(schema.inviteCode).all().length;
    expect(after).toBe(before);
  });
});

// ── manual (re)send route ─────────────────────────────────────────────────────

describe('POST /api/settings/invite-codes/[code]/send', () => {
  it('unauthenticated → 401', async () => {
    currentSession = null;
    const res = await sendInviteCodePOST(
      makeRequest('/api/settings/invite-codes/FAKE-CODE/send', 'POST', {}),
      { params: Promise.resolve({ code: 'FAKE-CODE' }) },
    );
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    currentSession = { userId: user.id, email: user.email, role: 'user' };
    const res = await sendInviteCodePOST(
      makeRequest('/api/settings/invite-codes/FAKE-CODE/send', 'POST', {}),
      { params: Promise.resolve({ code: 'FAKE-CODE' }) },
    );
    expect(res.status).toBe(403);
  });

  it('unknown code → 404', async () => {
    const res = await sendInviteCodePOST(
      makeRequest('/api/settings/invite-codes/DOES-NOT-EXIST/send', 'POST', {}),
      { params: Promise.resolve({ code: 'DOES-NOT-EXIST' }) },
    );
    expect(res.status).toBe(404);
  });

  it('already-redeemed code → 409 already_redeemed', async () => {
    const redeemer = createTestUser();
    const code = `REDEEMED-${crypto.randomUUID().slice(0, 8)}`;
    testDb.insert(schema.inviteCode).values({
      code, note: null, createdBy: admin.id, redeemedBy: redeemer.id, redeemedAt: new Date(),
      boundEmail: null, expiresAt: null,
    }).run();

    const res = await sendInviteCodePOST(
      makeRequest(`/api/settings/invite-codes/${code}/send`, 'POST', {}),
      { params: Promise.resolve({ code }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('already_redeemed');
  });

  it('expired code → 409 expired', async () => {
    const code = `EXPIRED-${crypto.randomUUID().slice(0, 8)}`;
    testDb.insert(schema.inviteCode).values({
      code, note: null, createdBy: admin.id, redeemedBy: null,
      boundEmail: 'someone@example.com', expiresAt: new Date(Date.now() - 60_000),
    }).run();

    const res = await sendInviteCodePOST(
      makeRequest(`/api/settings/invite-codes/${code}/send`, 'POST', {}),
      { params: Promise.resolve({ code }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('expired');
  });

  it('no boundEmail and no body `to` → 400 no_recipient', async () => {
    const code = `NORECIPIENT-${crypto.randomUUID().slice(0, 8)}`;
    testDb.insert(schema.inviteCode).values({
      code, note: null, createdBy: admin.id, redeemedBy: null, boundEmail: null, expiresAt: null,
    }).run();

    const res = await sendInviteCodePOST(
      makeRequest(`/api/settings/invite-codes/${code}/send`, 'POST', {}),
      { params: Promise.resolve({ code }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('no_recipient');
  });

  it('boundEmail set → 200, sent to boundEmail (body `to` ignored)', async () => {
    const code = `BOUND-${crypto.randomUUID().slice(0, 8)}`;
    testDb.insert(schema.inviteCode).values({
      code, note: null, createdBy: null, redeemedBy: null,
      boundEmail: 'bound-recipient@example.com', expiresAt: null,
    }).run();

    const res = await sendInviteCodePOST(
      makeRequest(`/api/settings/invite-codes/${code}/send`, 'POST', { to: 'attacker-supplied@example.com' }),
      { params: Promise.resolve({ code }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { emailStatus: string; logId: string | null };
    expect(body.emailStatus).toBe('sent');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [msg] = sendMock.mock.calls[0];
    expect(msg.to).toBe('bound-recipient@example.com'); // boundEmail wins over body.to
  });

  it('no boundEmail, body `to` provided → 200, sent to that address', async () => {
    const code = `MANUALTO-${crypto.randomUUID().slice(0, 8)}`;
    testDb.insert(schema.inviteCode).values({
      code, note: null, createdBy: admin.id, redeemedBy: null, boundEmail: null, expiresAt: null,
    }).run();

    const to = `typed-in-${crypto.randomUUID()}@example.com`;
    const res = await sendInviteCodePOST(
      makeRequest(`/api/settings/invite-codes/${code}/send`, 'POST', { to }),
      { params: Promise.resolve({ code }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { emailStatus: string };
    expect(body.emailStatus).toBe('sent');
    const [msg] = sendMock.mock.calls[0];
    expect(msg.to).toBe(to);
  });
});
