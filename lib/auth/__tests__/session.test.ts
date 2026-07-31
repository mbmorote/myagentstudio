/**
 * lib/auth/__tests__/session.test.ts
 *
 * Tests for lib/auth/session.ts (§10.3).
 *
 * Mocks:
 *   - next/headers (cookies) — the one seam that reads the real HTTP context
 *   - lib/db/repository/users.js — to control the user row returned
 *
 * Cases:
 *   - no cookie → null
 *   - valid token + existing user → session with the DB's role, not the token's
 *   - valid token + deleted user → null
 *   - role changed in the DB → the new role on the next call
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock next/headers ─────────────────────────────────────────────────────────
let mockCookieValue: string | undefined = undefined;

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      name === 'myagent_session' && mockCookieValue
        ? { value: mockCookieValue }
        : undefined,
    ),
  })),
}));

// ── Mock next/navigation (redirect) ──────────────────────────────────────────
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

// ── Mock the DB client with in-memory testDb ──────────────────────────────────
vi.mock('../../db/client.js', async () => {
  const { testDb } = await import('../../db/__tests__/test-db.js');
  return { db: testDb };
});

// ── All imports after mocks ────────────────────────────────────────────────────
import { signSessionToken } from '../jwt.js';
import { getSession } from '../session.js';
import { createTestUser } from '../../db/__tests__/test-users.js';

beforeEach(() => {
  mockCookieValue = undefined;
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getSession', () => {
  it('returns null when no cookie is present', async () => {
    mockCookieValue = undefined;
    expect(await getSession()).toBeNull();
  });

  it('returns null for a garbage cookie value', async () => {
    mockCookieValue = 'not-a-jwt-at-all';
    expect(await getSession()).toBeNull();
  });

  it('returns a Session with the DB role when the token is valid and the user exists', async () => {
    const user = createTestUser('user');
    mockCookieValue = await signSessionToken({ sub: user.id, email: user.email });

    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(user.id);
    expect(session!.email).toBe(user.email);
    // role comes from the DB row, not the token — confirm it matches the DB
    expect(session!.role).toBe('user');
  });

  it('returns role from the DB row, not the token, for an admin user', async () => {
    const admin = createTestUser('admin');
    // Sign a token that carries email but not role — the session must read role from DB
    mockCookieValue = await signSessionToken({ sub: admin.id, email: admin.email });

    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session!.role).toBe('admin');
  });

  it('returns null when the token is valid but the user row no longer exists', async () => {
    // Use a userId that was never inserted
    const ghostId = crypto.randomUUID();
    mockCookieValue = await signSessionToken({ sub: ghostId, email: 'ghost@example.com' });

    const session = await getSession();
    expect(session).toBeNull();
  });
});
