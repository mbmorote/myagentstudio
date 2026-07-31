/**
 * app/api/settings/__tests__/invite-codes.test.ts
 *
 * Tests for invite-code management routes (§10.3).
 *
 * Cases:
 *   - Admin: generate → list → revoke cycle
 *   - Non-admin user → 403
 *   - Unauthenticated → 401
 *   - Generated code is single-use end-to-end (generate → signup → second signup fails)
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

import { GET as listCodes, POST as generateCode } from '../invite-codes/route.js';
import { DELETE as revokeCode } from '../invite-codes/[code]/route.js';
import { POST as signupPOST } from '../../auth/signup/route.js';

let admin: ReturnType<typeof createTestUser>;
let user: ReturnType<typeof createTestUser>;

beforeAll(() => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
  }
  admin = createTestUser('admin');
  user = createTestUser('user');

  // Ensure a high maxUsers cap so signups are not blocked
  testDb.insert(schema.setting).values({ key: 'maxUsers', value: '1000' })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: '1000', updatedAt: new Date() } })
    .run();
});

function makeAdminRequest(path: string, method = 'GET', body?: object): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeSignupRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.5.0.1' },
    body: JSON.stringify(body),
  });
}

// ── unauthenticated → 401 ─────────────────────────────────────────────────────

describe('unauthenticated access', () => {
  it('GET /api/settings/invite-codes → 401', async () => {
    currentSession = null;
    const res = await listCodes(makeAdminRequest('/api/settings/invite-codes'));
    expect(res.status).toBe(401);
  });

  it('POST /api/settings/invite-codes → 401', async () => {
    currentSession = null;
    const res = await generateCode(makeAdminRequest('/api/settings/invite-codes', 'POST'));
    expect(res.status).toBe(401);
  });

  it('DELETE /api/settings/invite-codes/[code] → 401', async () => {
    currentSession = null;
    const res = await revokeCode(
      makeAdminRequest('/api/settings/invite-codes/AAAA-BBBB-CCCC-DDDD', 'DELETE'),
      { params: Promise.resolve({ code: 'AAAA-BBBB-CCCC-DDDD' }) },
    );
    expect(res.status).toBe(401);
  });
});

// ── non-admin → 403 ───────────────────────────────────────────────────────────

describe('non-admin access', () => {
  it('GET → 403', async () => {
    currentSession = { userId: user.id, email: user.email, role: 'user' };
    const res = await listCodes(makeAdminRequest('/api/settings/invite-codes'));
    expect(res.status).toBe(403);
  });

  it('POST → 403', async () => {
    currentSession = { userId: user.id, email: user.email, role: 'user' };
    const res = await generateCode(makeAdminRequest('/api/settings/invite-codes', 'POST'));
    expect(res.status).toBe(403);
  });

  it('DELETE → 403', async () => {
    currentSession = { userId: user.id, email: user.email, role: 'user' };
    const res = await revokeCode(
      makeAdminRequest('/api/settings/invite-codes/AAAA-BBBB-CCCC-DDDD', 'DELETE'),
      { params: Promise.resolve({ code: 'AAAA-BBBB-CCCC-DDDD' }) },
    );
    expect(res.status).toBe(403);
  });
});

// ── Admin generate → list → revoke cycle ─────────────────────────────────────

describe('admin: generate / list / revoke', () => {
  it('generates a code and it appears in the list', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };

    const genRes = await generateCode(
      makeAdminRequest('/api/settings/invite-codes', 'POST', { note: 'for alice' }),
    );
    expect(genRes.status).toBe(201);
    const { code } = await genRes.json() as { code: string; note: string };
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);

    // List — code must appear
    const listRes = await listCodes(makeAdminRequest('/api/settings/invite-codes'));
    expect(listRes.status).toBe(200);
    const { codes } = await listRes.json() as { codes: { code: string }[] };
    expect(codes.some((c) => c.code === code)).toBe(true);

    // Revoke it
    const delRes = await revokeCode(
      makeAdminRequest(`/api/settings/invite-codes/${code}`, 'DELETE'),
      { params: Promise.resolve({ code }) },
    );
    expect(delRes.status).toBe(204);

    // No longer appears in list
    const listRes2 = await listCodes(makeAdminRequest('/api/settings/invite-codes'));
    const { codes: codes2 } = await listRes2.json() as { codes: { code: string }[] };
    expect(codes2.some((c) => c.code === code)).toBe(false);
  });

  it('404 when revoking a non-existent code', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };
    const res = await revokeCode(
      makeAdminRequest('/api/settings/invite-codes/ZZZZ-ZZZZ-ZZZZ-ZZZZ', 'DELETE'),
      { params: Promise.resolve({ code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' }) },
    );
    expect(res.status).toBe(404);
  });

  it('409 already_redeemed when revoking a used code', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };

    // Generate a code
    const genRes = await generateCode(
      makeAdminRequest('/api/settings/invite-codes', 'POST'),
    );
    const { code } = await genRes.json() as { code: string };

    // Redeem it via signup (no session needed for signup)
    currentSession = null;
    await signupPOST(makeSignupRequest({
      inviteCode: code,
      email: `redeem-for-revoke-${crypto.randomUUID()}@example.com`,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: false,
    }));

    // Now try to revoke — should 409
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };
    const res = await revokeCode(
      makeAdminRequest(`/api/settings/invite-codes/${code}`, 'DELETE'),
      { params: Promise.resolve({ code }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('already_redeemed');
  });

  it('a generated code is single-use: second signup with the same code fails', async () => {
    currentSession = { userId: admin.id, email: admin.email, role: 'admin' };
    const genRes = await generateCode(makeAdminRequest('/api/settings/invite-codes', 'POST'));
    const { code } = await genRes.json() as { code: string };

    currentSession = null;

    // First signup
    const r1 = await signupPOST(makeSignupRequest({
      inviteCode: code,
      email: `single-use-1-${crypto.randomUUID()}@example.com`,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: false,
    }));
    expect(r1.status).toBe(201);

    // Second signup — must fail
    const r2 = await signupPOST(makeSignupRequest({
      inviteCode: code,
      email: `single-use-2-${crypto.randomUUID()}@example.com`,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: false,
    }));
    expect(r2.status).toBe(400);
    const body = await r2.json() as { error: string };
    expect(body.error).toBe('invalid_invite_code');
  });
});
