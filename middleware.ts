/**
 * middleware.ts — coarse route gate (§3.6)
 *
 * Runs on the Edge runtime. Verifies the session cookie's JWT signature and
 * expiry only — it cannot read the SQLite DB (§3.6, constraint 4).
 *
 * This middleware is NOT the authorization boundary.  Per constraint 4, every
 * route handler calls authenticate() / authenticateAdmin() independently, and the
 * repository's WHERE owner_id = ? is the actual data-access control. A bypass of
 * this middleware gains an attacker exactly nothing: the downstream guards are still
 * in the path.
 *
 * Behaviour:
 *   PUBLIC paths: /login, /signup, /api/auth/login, /api/auth/signup, /api/auth/logout
 *     - Allowed through without a token.
 *     - If the user already has a valid token and hits /login or /signup, redirect to /.
 *
 *   Protected paths (everything else after the static-asset exclusions):
 *     - Token absent or invalid:
 *         /api/* → 401 JSON { error: 'unauthorized' }
 *         other  → 307 redirect /login?next=<pathname><search>
 *     - Token valid → allow through.
 *
 * Security note (§3.6): the `next` query parameter written here is validated on
 * consumption in app/login/page.tsx — only a value matching ^/(?!/) is honoured,
 * preventing the open-redirect `?next=https://evil.example` vector.
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { SESSION_COOKIE } from '@/lib/auth/constants';

const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
]);

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    // If the user already has a valid session, bounce them away from /login and /signup
    if (pathname === '/login' || pathname === '/signup') {
      const token = request.cookies.get(SESSION_COOKIE)?.value;
      if (token) {
        const tokenValid = await verifyToken(token);
        if (tokenValid) {
          return NextResponse.redirect(new URL('/', request.url));
        }
      }
    }
    return NextResponse.next();
  }

  // Protected path — require a valid token
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const tokenValid = token ? await verifyToken(token) : false;

  if (!tokenValid) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const nextParam = encodeURIComponent(pathname + search);
    return NextResponse.redirect(new URL(`/login?next=${nextParam}`, request.url));
  }

  return NextResponse.next();
}

async function verifyToken(token: string): Promise<boolean> {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return false;
  try {
    const key = new TextEncoder().encode(secret);
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
