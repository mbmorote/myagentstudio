/**
 * app/api/__tests__/account-tokens.test.ts
 *
 * Tests for GET/POST /api/account/tokens and DELETE /api/account/tokens/[id]
 * (Plan 13 §5 — token subsystem route coverage).
 *
 * Cases:
 *   - GET/POST/DELETE unauthenticated → 401
 *   - POST creates a token; the plaintext appears ONLY in that 201 response
 *   - GET never returns a hash or plaintext field
 *   - GET only returns the caller's own tokens (tenancy)
 *   - POST validation: missing/blank name → 400; invalid scope → 400
 *   - POST enforces the per-user active-token cap → 422
 *   - DELETE revokes the caller's own token; a foreign id → 404 (non-disclosure)
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

let currentSession: { userId: string; email: string; role: 'admin' | 'user' } | null = null;

vi.mock('../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

import { createTestUser } from '../../../lib/db/__tests__/test-users.js';
import { GET as tokensGET, POST as tokensPOST } from '../account/tokens/route.js';
import { DELETE as tokensDELETE } from '../account/tokens/[id]/route.js';

let userA: ReturnType<typeof createTestUser>;
let userB: ReturnType<typeof createTestUser>;

beforeAll(() => {
  userA = createTestUser('user');
  userB = createTestUser('user');
});

function postRequest(body?: object): NextRequest {
  return new NextRequest('http://localhost/api/account/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ── Unauthenticated ────────────────────────────────────────────────────────────

describe('unauthenticated', () => {
  it('GET → 401', async () => {
    currentSession = null;
    const res = await tokensGET();
    expect(res.status).toBe(401);
  });

  it('POST → 401', async () => {
    currentSession = null;
    const res = await tokensPOST(postRequest({ name: 'x', scope: 'read' }));
    expect(res.status).toBe(401);
  });

  it('DELETE → 401', async () => {
    currentSession = null;
    const res = await tokensDELETE(
      new Request('http://localhost/api/account/tokens/abc', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'abc' }) },
    );
    expect(res.status).toBe(401);
  });
});

// ── POST /api/account/tokens ──────────────────────────────────────────────────

describe('POST /api/account/tokens', () => {
  it('creates a token; the plaintext is present ONLY in this response', async () => {
    currentSession = { userId: userA.id, email: userA.email, role: 'user' };
    const res = await tokensPOST(postRequest({ name: 'laptop Claude Code', scope: 'read' }));
    expect(res.status).toBe(201);
    const body = await res.json() as { token: { id: string; prefix: string; scope: string }; plaintext: string };
    expect(body.plaintext).toMatch(/^mya_/);
    expect(body.token.scope).toBe('read');
    expect(body.token.prefix).toBe(body.plaintext.slice(0, 12));
    // The 201 body must never carry a raw hash field
    expect('tokenHash' in body.token).toBe(false);
  });

  it('missing/blank name → 400', async () => {
    currentSession = { userId: userA.id, email: userA.email, role: 'user' };
    const res1 = await tokensPOST(postRequest({ scope: 'read' }));
    expect(res1.status).toBe(400);
    const res2 = await tokensPOST(postRequest({ name: '   ', scope: 'read' }));
    expect(res2.status).toBe(400);
  });

  it('invalid scope → 400', async () => {
    currentSession = { userId: userA.id, email: userA.email, role: 'user' };
    const res = await tokensPOST(postRequest({ name: 'x', scope: 'admin' }));
    expect(res.status).toBe(400);
  });

  it('enforces the per-user active-token cap (10) → 422', async () => {
    currentSession = { userId: userB.id, email: userB.email, role: 'user' };
    for (let i = 0; i < 10; i++) {
      const res = await tokensPOST(postRequest({ name: `t${i}`, scope: 'read' }));
      expect(res.status).toBe(201);
    }
    const overflow = await tokensPOST(postRequest({ name: 't11', scope: 'read' }));
    expect(overflow.status).toBe(422);
    const body = await overflow.json() as { error: string };
    expect(body.error).toBe('too_many_tokens');
  });
});

// ── GET /api/account/tokens ───────────────────────────────────────────────────

describe('GET /api/account/tokens', () => {
  it("never returns a hash or plaintext field, and only the caller's own tokens", async () => {
    const owner = createTestUser('user');
    const stranger = createTestUser('user');

    currentSession = { userId: owner.id, email: owner.email, role: 'user' };
    await tokensPOST(postRequest({ name: 'owner-token', scope: 'read' }));

    currentSession = { userId: stranger.id, email: stranger.email, role: 'user' };
    await tokensPOST(postRequest({ name: 'stranger-token', scope: 'read' }));

    currentSession = { userId: owner.id, email: owner.email, role: 'user' };
    const res = await tokensGET();
    expect(res.status).toBe(200);
    const rows = await res.json() as Array<Record<string, unknown>>;

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => !('tokenHash' in r) && !('plaintext' in r))).toBe(true);
    expect(rows.every((r) => r.name !== 'stranger-token')).toBe(true);
  });
});

// ── DELETE /api/account/tokens/[id] ───────────────────────────────────────────

describe('DELETE /api/account/tokens/[id]', () => {
  it("revokes the caller's own token", async () => {
    const owner = createTestUser('user');
    currentSession = { userId: owner.id, email: owner.email, role: 'user' };
    const created = await tokensPOST(postRequest({ name: 'to-revoke', scope: 'read' }));
    const { token } = await created.json() as { token: { id: string } };

    const res = await tokensDELETE(
      new Request(`http://localhost/api/account/tokens/${token.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: token.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { revoked: boolean };
    expect(body.revoked).toBe(true);
  });

  it("returns 404 for another user's token id (non-disclosure — same as unknown id)", async () => {
    const owner = createTestUser('user');
    const attacker = createTestUser('user');

    currentSession = { userId: owner.id, email: owner.email, role: 'user' };
    const created = await tokensPOST(postRequest({ name: 'owner-only', scope: 'read' }));
    const { token } = await created.json() as { token: { id: string } };

    currentSession = { userId: attacker.id, email: attacker.email, role: 'user' };
    const res = await tokensDELETE(
      new Request(`http://localhost/api/account/tokens/${token.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: token.id }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown token id', async () => {
    const owner = createTestUser('user');
    currentSession = { userId: owner.id, email: owner.email, role: 'user' };
    const res = await tokensDELETE(
      new Request('http://localhost/api/account/tokens/does-not-exist', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'does-not-exist' }) },
    );
    expect(res.status).toBe(404);
  });
});
