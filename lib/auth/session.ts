import 'server-only';

/**
 * lib/auth/session.ts
 *
 * Session reading for route handlers and server components.
 *
 * `getSession()` is the single seam that route tests mock (§10.2) — it is the
 * only function in the codebase that reads from `next/headers`. Everything above
 * it (route handlers, server components) calls getSession(); everything below it
 * (JWT verification, DB read) is tested directly.
 *
 * Architecture (§2.1, §3.4):
 *   cookies() → token → verifySessionToken() → getUserById(sub) → Session
 *
 * Returns null on: no cookie · bad signature · expired token · user row gone.
 *
 * `Session` deliberately carries only what authorization needs (§3.4):
 *   - `userId` — to scope repository queries
 *   - `email`  — for display only, not authoritative
 *   - `role`   — read from the DB row, never from a JWT claim
 *
 * `shareLogsWithAdmin` is intentionally absent: it is a preference read fresh
 * where it is used (the gateway and /account), not cached in the session.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from './jwt.js';
import { getUserById } from '../db/repository/users.js';
import { SESSION_COOKIE } from './constants.js';

export type Session = {
  userId: string;
  email: string;
  role: 'admin' | 'user';
};

/**
 * Reads and verifies the session cookie, then loads a fresh user row.
 *
 * Returns null when:
 *   - the cookie is absent
 *   - the JWT signature is invalid or the token is expired
 *   - the user row has been deleted since the token was issued
 *
 * This freshness guarantee (§2.1) means a deleted user is locked out on their
 * next request, and a role change takes effect on the next request.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE);
  if (!cookie?.value) return null;

  const tokenPayload = await verifySessionToken(cookie.value);
  if (!tokenPayload) return null;

  const userRow = getUserById(tokenPayload.sub);
  if (!userRow) return null;

  return {
    userId: userRow.id,
    email: userRow.email,
    role: userRow.role,
  };
}

/**
 * Like getSession(), but redirects to /login?next=<path> if the session is absent.
 * For use in server components (page.tsx) that require authentication.
 *
 * Never call from a route handler — route handlers use authenticate() from guard.ts,
 * which returns a proper HTTP response rather than triggering a redirect.
 */
export async function requirePageSession(nextPath: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return session;
}
