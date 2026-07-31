import 'server-only';

/**
 * lib/auth/guard.ts
 *
 * Route handler authentication guards (§3.5).
 *
 * Pattern — every non-/api/auth/* handler opens with:
 *
 *   const auth = await authenticate();
 *   if (!auth.ok) return auth.response;
 *   const { session } = auth;
 *
 * Deliberately a plain function returning a discriminated union rather than
 * a higher-order withAuth(handler) wrapper (§3.5 rationale):
 *   - Matches this codebase's uniformly explicit, non-HOF route style.
 *   - The handler's own signature stays intact (tests import and call directly).
 *   - `if (!auth.ok) return auth.response;` is visible in a diff; a missing
 *     decorator is invisible.
 *
 * Error logging (§7.3):
 *   - 403 (forbidden) is always logged — a user hitting an admin route is
 *     either a bug or probing.
 *   - 401 (unauthorized) is routine (expired session, no cookie) and is not
 *     logged.
 */

import { NextResponse } from 'next/server';
import { getSession, type Session } from './session.js';

type AuthOk = { ok: true; session: Session };
type AuthFail = { ok: false; response: NextResponse };

/**
 * Verifies that a session exists.
 * Returns { ok: true, session } or { ok: false, response: 401 }.
 */
export async function authenticate(): Promise<AuthOk | AuthFail> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true, session };
}

/**
 * Verifies that a session exists AND the user has the 'admin' role.
 * Returns { ok: true, session } or { ok: false, response: 401|403 }.
 *
 * Logs the 403 case (§7.3): a non-admin hitting an admin-only route is unusual.
 */
export async function authenticateAdmin(
  /** The URL pathname — used in the log line. Pass `request.nextUrl.pathname`. */
  path?: string,
): Promise<AuthOk | AuthFail> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }
  if (session.role !== 'admin') {
    console.warn(`[auth] forbidden userId=${session.userId} path=${path ?? 'unknown'}`);
    return {
      ok: false,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    };
  }
  return { ok: true, session };
}
