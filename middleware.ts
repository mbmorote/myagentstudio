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
 *   PUBLIC paths: /login, /signup, /welcome, /terms, /privacy, /api/auth/login,
 *   /api/auth/signup, /api/auth/logout, /api/auth/request-access
 *     - Allowed through without a token.
 *     - If the user already has a valid token and hits /login or /signup, redirect to /.
 *       /welcome (Plan 12's pre-login landing page, 2026-08-14) is NOT in that redirect
 *       check — it's an ordinary public page, not an auth-only one, so an already-signed-in
 *       visitor can still view it instead of being bounced to /.
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
import { verifySessionToken } from '@/lib/auth/jwt';
import { SESSION_COOKIE } from '@/lib/auth/constants';

const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/welcome',
  '/terms',
  '/privacy',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/auth/request-access',
  // Plan 13 (2026-08-15) — MCP server. A console MCP client authenticates with a
  // per-user bearer token (Authorization header), never the session cookie this
  // middleware checks, so the cookie gate here would reject every legitimate MCP
  // request. Bypassing it is safe by this file's own stated design: middleware is
  // NOT the authorization boundary — app/api/mcp/route.ts independently calls
  // authenticateMcpToken() on every request and rejects with 401 on its own if the
  // bearer token is missing, unknown, revoked, or expired.
  '/api/mcp',
]);

// OAuth callback and start routes live under a dynamic segment, so they cannot
// be in the exact-match set above. This prefix is intentionally narrow
// (/api/auth/oauth/, not /api/auth/) so it does not widen to cover a future
// authenticated route (§3.1).
const PUBLIC_PATH_PREFIXES = ['/api/auth/oauth/'];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
    // If the user already has a valid session, bounce them away from /login and /signup
    if (pathname === '/login' || pathname === '/signup') {
      const token = request.cookies.get(SESSION_COOKIE)?.value;
      if (token) {
        const tokenValid = (await verifySessionToken(token)) !== null;
        if (tokenValid) {
          return NextResponse.redirect(new URL('/', request.url));
        }
      }
    }
    return NextResponse.next();
  }

  // Protected path — require a valid token
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const tokenValid = token ? (await verifySessionToken(token)) !== null : false;

  if (!tokenValid) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const nextParam = encodeURIComponent(pathname + search);
    return NextResponse.redirect(new URL(`/login?next=${nextParam}`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
