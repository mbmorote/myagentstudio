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
 *   PUBLIC paths: /, /login, /signup, /welcome, /terms, /privacy, /api/auth/login,
 *   /api/auth/signup, /api/auth/logout, /api/auth/request-access
 *     - Allowed through without a token.
 *     - If the user already has a valid token and hits /login or /signup, redirect to /.
 *       /welcome (Plan 12's pre-login landing page, 2026-08-14) is NOT in that redirect
 *       check — it's an ordinary public page, not an auth-only one, so an already-signed-in
 *       visitor can still view it instead of being bounced to /.
 *     - / (the site root) is public too, for the same reason as /welcome: an
 *       unauthenticated visitor should see the landing page there instead of being
 *       redirected to /login. app/page.tsx itself branches on session presence — no
 *       session renders the same landing content as /welcome; a valid session falls
 *       through to the existing authenticated behaviour (redirect to the user's first
 *       agent, or the empty-library WorkbenchShell). / is NOT in the /login-or-/signup
 *       bounce check above for the same reason /welcome isn't.
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
  '/',
  '/login',
  '/signup',
  '/welcome',
  '/terms',
  '/privacy',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/auth/request-access',
]);

// Plan 13 (2026-08-15) — MCP server. NOT unauthenticated: a console MCP client
// authenticates with a per-user bearer token (Authorization header), never the session
// cookie this middleware checks, so the cookie gate here would reject every legitimate
// MCP request. Bypassing it is safe by this file's own stated design: middleware is NOT
// the authorization boundary — app/api/mcp/route.ts independently calls
// authenticateMcpToken() on every request and rejects with 401 on its own if the bearer
// token is missing, unknown, revoked, or expired. Kept separate from PUBLIC_PATHS so
// this set never reads as "no auth required" — every path here still authenticates
// itself downstream, just not via cookie.
const ALTERNATE_AUTH_PATHS = new Set([
  '/api/mcp',
]);

// OAuth callback and start routes live under a dynamic segment, so they cannot
// be in the exact-match set above. This prefix is intentionally narrow
// (/api/auth/oauth/, not /api/auth/) so it does not widen to cover a future
// authenticated route (§3.1).
//
// /welcome/ (2026-08-17) — static screenshot assets in public/welcome/ (the "How it
// works" walkthrough's real step images, WelcomePage.tsx's WALK_STEPS.image) need to
// load for a signed-out visitor, same as the /welcome page itself. Without this, an
// <img> request for e.g. /welcome/step-1-import.png hit this middleware's matcher
// (which covers every path, per the `config.matcher` below), found no exact match in
// PUBLIC_PATHS, and got 307-redirected to /login — a redirect response instead of PNG
// bytes, which renders as a broken image. Safe to widen to a prefix here (unlike
// /api/auth/oauth/'s narrower reasoning): there is no nested dynamic route under
// app/welcome/ that this could accidentally expose, only the static asset folder.
const PUBLIC_PATH_PREFIXES = ['/api/auth/oauth/', '/welcome/'];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (
    PUBLIC_PATHS.has(pathname) ||
    ALTERNATE_AUTH_PATHS.has(pathname) ||
    PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
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
