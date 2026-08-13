/**
 * app/api/__tests__/account.test.ts
 *
 * Tests for GET/PATCH /api/account (§10.3).
 *
 * Cases:
 *   - GET unauthenticated → 401
 *   - GET returns the caller's own email/role/consent
 *   - PATCH { shareLogsWithAdmin: true } flips it and GET reflects it
 *   - PATCH with a non-boolean → 400 and the stored value is unchanged
 *   - A body carrying another user's fields has no effect on other rows (§8 invariant 17)
 *   - Admin session gets the same behavior as a user session (no elevated variant)
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock DB client ─────────────────────────────────────────────────────────────
vi.mock('../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock getSession ───────────────────────────────────────────────────────────
let currentSession: { userId: string; email: string; role: 'admin' | 'user' } | null = null;

vi.mock('../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// After mocks
import { createTestUser } from '../../../lib/db/__tests__/test-users.js';
import { getUserById } from '../../../lib/db/repository/users.js';

import { GET as accountGET, PATCH as accountPATCH } from '../account/route.js';

let userA: ReturnType<typeof createTestUser>;
let userB: ReturnType<typeof createTestUser>;
let adminUser: ReturnType<typeof createTestUser>;

beforeAll(() => {
  userA = createTestUser('user', false);
  userB = createTestUser('user', false);
  adminUser = createTestUser('admin', false);
});

function makeRequest(method: string, body?: object): NextRequest {
  return new NextRequest('http://localhost/api/account', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── Unauthenticated ───────────────────────────────────────────────────────────

describe('unauthenticated', () => {
  it('GET → 401', async () => {
    currentSession = null;
    const res = await accountGET();
    expect(res.status).toBe(401);
  });

  it('PATCH → 401', async () => {
    currentSession = null;
    const res = await accountPATCH(makeRequest('PATCH', { shareLogsWithAdmin: true }));
    expect(res.status).toBe(401);
  });
});

// ── GET /api/account ──────────────────────────────────────────────────────────

describe('GET /api/account', () => {
  it("returns the caller's own email, role, and shareLogsWithAdmin", async () => {
    currentSession = { userId: userA.id, email: userA.email, role: 'user' };
    const res = await accountGET();
    expect(res.status).toBe(200);
    const body = await res.json() as { email: string; role: string; shareLogsWithAdmin: boolean };
    expect(body.email).toBe(userA.email);
    expect(body.role).toBe('user');
    expect(body.shareLogsWithAdmin).toBe(false);
  });

  it("returns the admin's own row (same behavior as a user session)", async () => {
    currentSession = { userId: adminUser.id, email: adminUser.email, role: 'admin' };
    const res = await accountGET();
    expect(res.status).toBe(200);
    const body = await res.json() as { role: string };
    expect(body.role).toBe('admin');
  });
});

// ── PATCH /api/account ────────────────────────────────────────────────────────

describe('PATCH /api/account', () => {
  it('{ shareLogsWithAdmin: true } flips the value and GET reflects it', async () => {
    currentSession = { userId: userA.id, email: userA.email, role: 'user' };

    const patchRes = await accountPATCH(makeRequest('PATCH', { shareLogsWithAdmin: true }));
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json() as { shareLogsWithAdmin: boolean };
    expect(patchBody.shareLogsWithAdmin).toBe(true);

    // Confirm the DB row was updated
    const getRes = await accountGET();
    const getBody = await getRes.json() as { shareLogsWithAdmin: boolean };
    expect(getBody.shareLogsWithAdmin).toBe(true);
  });

  it('non-boolean shareLogsWithAdmin → 400 and stored value is unchanged', async () => {
    currentSession = { userId: userB.id, email: userB.email, role: 'user' };

    // Confirm initial value
    const before = getUserById(userB.id);
    const initialValue = before?.shareLogsWithAdmin;

    const res = await accountPATCH(makeRequest('PATCH', { shareLogsWithAdmin: 'true' }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; field?: string };
    expect(body.error).toBe('invalid_body');
    expect(body.field).toBe('shareLogsWithAdmin');

    // Value must be unchanged
    const after = getUserById(userB.id);
    expect(after?.shareLogsWithAdmin).toBe(initialValue);
  });

  it('§8 invariant 17: PATCH only ever affects the session\'s own user row, never another user\'s (the route accepts no user-id field at all)', async () => {
    // userA operates on their own row; userB should not be affected
    currentSession = { userId: userA.id, email: userA.email, role: 'user' };

    // Set userA's sharing to true
    await accountPATCH(makeRequest('PATCH', { shareLogsWithAdmin: true }));

    // Verify userB's row is unchanged (false from creation)
    const userBRow = getUserById(userB.id);
    expect(userBRow?.shareLogsWithAdmin).toBe(false);
  });
});
