/**
 * app/api/settings/__tests__/access-requests.test.ts
 *
 * Tests for the admin-only "Access requests" grid routes (Plan 12, 2026-08-14) —
 * added 2026-08-18, previously zero coverage. Mirrors invite-codes.test.ts's
 * structure/pattern in this same folder.
 *
 * Cases:
 *   - unauthenticated → 401 on all three routes
 *   - non-admin → 403 on all three routes
 *   - admin: list / dismiss cycle
 *   - admin: 404 dismissing/generating a code for a non-existent request
 *   - admin: generate-code creates an invite code bound to the request's email,
 *     with an expiry set, and removes the request row
 *   - end-to-end: request access → admin generates a code → signup with that code
 *     succeeds; the same code cannot be redeemed by a different email
 *     (this is the boundEmail enforcement the whole flow depends on)
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

// ── Mock DB client ─────────────────────────────────────────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock getSession — the single auth seam (§10.2) ────────────────────────────
let currentSession: { userId: string; email: string; role: 'admin' | 'user' } | null = null;

vi.mock('../../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// After mocks
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import * as schema from '../../../../lib/db/schema.js';
import { createTestUser } from '../../../../lib/db/__tests__/test-users.js';

import { GET as listRequests } from '../access-requests/route.js';
import { DELETE as dismissRequest } from '../access-requests/[id]/route.js';
import { POST as generateCodeForRequest } from '../access-requests/[id]/generate-code/route.js';
import { POST as requestAccessPOST } from '../../auth/request-access/route.js';
import { POST as signupPOST } from '../../auth/signup/route.js';

let admin: ReturnType<typeof createTestUser>;
let user: ReturnType<typeof createTestUser>;
let ipCounter = 1;
function nextIp() { return `192.168.10.${ipCounter++}`; }

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

function makeRequest(path: string, method = 'GET', body?: object): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeRequestAccessRequest(body: object, ip: string): NextRequest {
  return new NextRequest('http://localhost/api/auth/request-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function makeSignupRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `127.6.${ipCounter++}.1` },
    body: JSON.stringify(body),
  });
}

/** Creates an open access-request row via the real route, returns its id + email. */
async function createOpenRequest(name: string): Promise<{ id: string; email: string }> {
  const email = `${name.toLowerCase()}-${crypto.randomUUID()}@example.com`;
  const res = await requestAccessPOST(makeRequestAccessRequest({ name, email }, nextIp()));
  expect(res.status).toBe(201);
  const row = testDb.select().from(schema.accessRequest).all().find((r) => r.email === email);
  if (!row) throw new Error('access request row not found after creation');
  return { id: row.id, email };
}

// ── unauthenticated → 401 ─────────────────────────────────────────────────────

describe('unauthenticated access', () => {
  it('GET /api/settings/access-requests → 401', async () => {
    currentSession = null;
    const res = await listRequests(makeRequest('/api/settings/access-requests'));
    expect(res.status).toBe(401);
  });

  it('DELETE /api/settings/access-requests/[id] → 401', async () => {
    currentSession = null;
    const res = await dismissRequest(
      makeRequest('/api/settings/access-requests/fake-id', 'DELETE'),
      { params: Promise.resolve({ id: 'fake-id' }) },
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/settings/access-requests/[id]/generate-code → 401', async () => {
    currentSession = null;
    const res = await generateCodeForRequest(
      makeRequest('/api/settings/access-requests/fake-id/generate-code', 'POST'),
      { params: Promise.resolve({ id: 'fake-id' }) },
    );
    expect(res.status).toBe(401);
  });
});

// ── non-admin → 403 ───────────────────────────────────────────────────────────

describe('non-admin access', () => {
  it('GET → 403', async () => {
    currentSession = { userId: user.id, email: user.email, role: 'user' };
    const res = await listRequests(makeRequest('/api/settings/access-requests'));
    expect(res.status).toBe(403);
  });

  it('DELETE → 403', async () => {
    currentSession = { userId: user.id, email: user.email, role: 'user' };
    const res = await dismissRequest(
      makeRequest('/api/settings/access-requests/fake-id', 'DELETE'),
      { params: Promise.resolve({ id: 'fake-id' }) },
    );
    expect(res.status).toBe(403);
  });

  it('POST generate-code → 403', async () => {
    currentSession = { userId: user.id, email: user.email, role: 'user' };
    const res = await generateCodeForRequest(
      makeRequest('/api/settings/access-requests/fake-id/generate-code', 'POST'),
      { params: Promise.resolve({ id: 'fake-id' }) },
    );
    expect(res.status).toBe(403);
  });
});

// ── admin: list / dismiss ─────────────────────────────────────────────────────

describe('admin: list / dismiss', () => {
  it('a submitted request appears in the list, newest first', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };

    const { id: idA, email: emailA } = await createOpenRequest('ListOrderA');
    const { email: emailB } = await createOpenRequest('ListOrderB');

    // createdAt has 1-second resolution (unix epoch seconds) — two rows created back-to-back
    // in the same test can land in the same second, making ORDER BY createdAt DESC alone
    // non-deterministic between them. Backdate A explicitly so the ordering assertion below
    // tests real desc(createdAt) behavior instead of racing the clock.
    testDb.update(schema.accessRequest)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.accessRequest.id, idA))
      .run();

    const res = await listRequests(makeRequest('/api/settings/access-requests'));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      requests: { id: string; name: string; email: string; referralSource: string | null; createdAt: string }[];
    };
    const emails = body.requests.map((r) => r.email);
    expect(emails).toContain(emailA);
    expect(emails).toContain(emailB);
    // Most-recently-created (B) comes before the earlier one (A) — desc(createdAt).
    expect(emails.indexOf(emailB)).toBeLessThan(emails.indexOf(emailA));
  });

  it('dismiss removes the row; second dismiss 404s', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };
    const { id } = await createOpenRequest('DismissMe');

    const delRes = await dismissRequest(
      makeRequest(`/api/settings/access-requests/${id}`, 'DELETE'),
      { params: Promise.resolve({ id }) },
    );
    expect(delRes.status).toBe(204);

    const listRes = await listRequests(makeRequest('/api/settings/access-requests'));
    const { requests } = await listRes.json() as { requests: { id: string }[] };
    expect(requests.some((r) => r.id === id)).toBe(false);

    const delRes2 = await dismissRequest(
      makeRequest(`/api/settings/access-requests/${id}`, 'DELETE'),
      { params: Promise.resolve({ id }) },
    );
    expect(delRes2.status).toBe(404);
  });

  it('generate-code for an unknown request id → 404', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };
    const res = await generateCodeForRequest(
      makeRequest('/api/settings/access-requests/does-not-exist/generate-code', 'POST'),
      { params: Promise.resolve({ id: 'does-not-exist' }) },
    );
    expect(res.status).toBe(404);
  });
});

// ── admin: generate-code ──────────────────────────────────────────────────────

describe('admin: generate-code', () => {
  it('creates an invite code bound to the request email, with an expiry, and removes the request', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };
    const { id, email } = await createOpenRequest('GenerateCodeFor');

    const res = await generateCodeForRequest(
      makeRequest(`/api/settings/access-requests/${id}/generate-code`, 'POST'),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json() as {
      code: string; note: string | null; boundEmail: string; expiresAt: string | null; createdAt: string;
    };
    expect(body.boundEmail).toBe(email);
    expect(body.expiresAt).not.toBeNull();
    expect(typeof body.code).toBe('string');

    // The request row is gone — replaced by the invite code as the durable record.
    const listRes = await listRequests(makeRequest('/api/settings/access-requests'));
    const { requests } = await listRes.json() as { requests: { id: string }[] };
    expect(requests.some((r) => r.id === id)).toBe(false);

    const codeRow = testDb.select().from(schema.inviteCode).all().find((c) => c.code === body.code);
    expect(codeRow).toBeDefined();
    expect(codeRow!.boundEmail).toBe(email);
  });

  it('note includes the requester name and referral source label', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };
    const email = `withsource-${crypto.randomUUID()}@example.com`;
    const submitRes = await requestAccessPOST(makeRequestAccessRequest(
      { name: 'Referral Person', email, referralSource: 'github' },
      nextIp(),
    ));
    expect(submitRes.status).toBe(201);
    const row = testDb.select().from(schema.accessRequest).all().find((r) => r.email === email);
    if (!row) throw new Error('access request row not found');

    const res = await generateCodeForRequest(
      makeRequest(`/api/settings/access-requests/${row.id}/generate-code`, 'POST'),
      { params: Promise.resolve({ id: row.id }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { note: string | null };
    expect(body.note).toContain('Referral Person');
    expect(body.note).toContain('GitHub');
  });
});

// ── end-to-end: request access → admin generates code → signup redeems it ────

describe('end-to-end: request → generate-code → signup', () => {
  it('the generated code lets that email sign up', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };
    const { id, email } = await createOpenRequest('EndToEndSignup');

    const genRes = await generateCodeForRequest(
      makeRequest(`/api/settings/access-requests/${id}/generate-code`, 'POST'),
      { params: Promise.resolve({ id }) },
    );
    expect(genRes.status).toBe(201);
    const { code } = await genRes.json() as { code: string };

    currentSession = null; // signup itself needs no session
    const signupRes = await signupPOST(makeSignupRequest({
      inviteCode: code,
      email,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: true,
    }));
    expect(signupRes.status).toBe(201);
  });

  it('the generated code is bound to the requester email — a different email is rejected', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };
    const { id, email } = await createOpenRequest('EndToEndBoundEmail');

    const genRes = await generateCodeForRequest(
      makeRequest(`/api/settings/access-requests/${id}/generate-code`, 'POST'),
      { params: Promise.resolve({ id }) },
    );
    const { code } = await genRes.json() as { code: string };
    expect(email).toBeTruthy(); // sanity — the bound email itself is tested above

    currentSession = null;
    const signupRes = await signupPOST(makeSignupRequest({
      inviteCode: code,
      email: `someone-else-${crypto.randomUUID()}@example.com`,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: true,
    }));
    expect(signupRes.status).toBe(400);
    const body = await signupRes.json() as { error: string };
    expect(body.error).toBe('invalid_invite_code');
  });
});
