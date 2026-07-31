/**
 * app/api/auth/login/route.ts
 *
 * POST /api/auth/login — email + password → session cookie
 *
 * Flow (§8 sequence 26):
 *   rate-limit → normalize email → load user → reject empty-sentinel hash →
 *   bcrypt.compare → sign JWT → Set-Cookie → 200
 *
 * A missing user and a wrong password produce identical 401 responses (§7.3).
 * The sentinel hash ('') is rejected before bcrypt.compare is ever called (§8 invariant 9).
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth/rateLimit';
import { verifyPassword } from '@/lib/auth/password';
import { signSessionToken } from '@/lib/auth/jwt';
import { getUserByEmail } from '@/lib/db/repository/users';
import { SESSION_COOKIE, getSessionTtlSeconds, NO_PASSWORD_SENTINEL } from '@/lib/auth/constants';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Rate limit check (§3.8)
  const rateResult = checkRateLimit(request, 'login');
  if (rateResult) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSeconds: rateResult.retryAfterSeconds },
      {
        status: 429,
        headers: { 'Retry-After': String(rateResult.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Normalize email (§4.1)
  const normalizedEmail = email.trim().toLowerCase();

  // Load user — missing user and wrong password are indistinguishable (§7.3)
  const user = getUserByEmail(normalizedEmail);

  // Reject the sentinel hash before bcrypt (§8 invariant 9)
  if (!user || user.passwordHash === NO_PASSWORD_SENTINEL) {
    if (user && user.passwordHash === NO_PASSWORD_SENTINEL) {
      console.warn(`[auth] password login attempted on a passwordless account (oauth-only or un-bootstrapped): ${normalizedEmail}`);
    } else {
      console.warn(`[auth] failed login attempt for unknown email: ${normalizedEmail}`);
    }
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    console.warn(`[auth] failed login — wrong password for email: ${normalizedEmail}`);
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  // Issue session token
  const token = await signSessionToken({ sub: user.id, email: user.email });

  const response = NextResponse.json(
    { user: { id: user.id, email: user.email, role: user.role } },
    { status: 200 },
  );

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: getSessionTtlSeconds(),
  });

  return response;
}
