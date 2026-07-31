/**
 * app/api/auth/logout/route.ts
 *
 * POST /api/auth/logout — clears the session cookie → 204
 *
 * Succeeds even if there is no active session (idempotent).
 * The JWT token itself remains cryptographically valid until `exp` — there is
 * no server-side revocation (§9, §14). Logging out is a best-effort client-side
 * operation: it clears the cookie so the browser stops sending the token.
 */

import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/constants';

export function POST(): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  // Clear the cookie by setting maxAge to 0
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
