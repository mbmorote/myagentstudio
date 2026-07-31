/**
 * lib/auth/__tests__/guard.test.ts
 *
 * Tests for lib/auth/guard.ts (§10.3).
 *
 * Mocks getSession() — the single seam (§10.2).
 *
 * Cases:
 *   - authenticate: no session → 401 with correct body and status
 *   - authenticate: valid session → { ok: true, session }
 *   - authenticateAdmin: user session → 403
 *   - authenticateAdmin: admin session → { ok: true, session }
 *   - authenticateAdmin: no session → 401
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mock getSession ────────────────────────────────────────────────────────────
let currentSession: { userId: string; email: string; role: 'admin' | 'user' } | null = null;

vi.mock('../session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// Must be after mock registration
import { authenticate, authenticateAdmin } from '../guard.js';

// ─────────────────────────────────────────────────────────────────────────────

describe('authenticate', () => {
  it('returns { ok: false, response: 401 } when getSession returns null', async () => {
    currentSession = null;
    const result = await authenticate();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = await result.response.json();
    expect(body).toEqual({ error: 'unauthorized' });
  });

  it('returns { ok: true, session } when a valid session exists', async () => {
    currentSession = { userId: 'u1', email: 'alice@example.com', role: 'user' };
    const result = await authenticate();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toEqual(currentSession);
  });
});

describe('authenticateAdmin', () => {
  it('returns 401 when there is no session', async () => {
    currentSession = null;
    const result = await authenticateAdmin('/api/settings');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = await result.response.json();
    expect(body).toEqual({ error: 'unauthorized' });
  });

  it('returns 403 when the session belongs to a non-admin user', async () => {
    currentSession = { userId: 'u2', email: 'bob@example.com', role: 'user' };
    const result = await authenticateAdmin('/api/settings');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body).toEqual({ error: 'forbidden' });
  });

  it('returns { ok: true, session } for an admin session', async () => {
    currentSession = { userId: 'admin-1', email: 'admin@example.com', role: 'admin' };
    const result = await authenticateAdmin('/api/settings');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.role).toBe('admin');
  });
});
