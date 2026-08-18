/**
 * app/api/auth/signup/route.ts
 *
 * POST /api/auth/signup — invite code + email + password + consent → user + cookie
 *
 * Flow (§8 sequence 25):
 *   validate body (including the explicit consent choice, invariant 15) →
 *   normalize email + code → policy-check the password →
 *   hash (outside any transaction) →
 *   createUserWithInvite() (atomic: code check → cap check → email check →
 *     insert user with its consent value → redeem code) →
 *   sign JWT → Set-Cookie → 201
 *
 * Consent coercion (flipped 2026-08-18 — sharing is now the default, mirroring the
 * old §8 invariant 15 shape): only a literal boolean `false` opts out. Absent, null,
 * "false", 0, or malformed → true (shared). A malformed body can never produce an
 * opt-out — the same "no accidental effect from garbage input" rigor as before,
 * just guarding the opposite direction since the default itself flipped.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth/rateLimit';
import { validatePasswordPolicy, hashPassword } from '@/lib/auth/password';
import { signSessionToken } from '@/lib/auth/jwt';
import { normalizeInviteCode } from '@/lib/auth/inviteCode';
import { createUserWithInvite } from '@/lib/db/repository/users';
import { getMaxUsers } from '@/lib/settings';
import { SESSION_COOKIE, getSessionTtlSeconds } from '@/lib/auth/constants';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Rate limit check (§3.8)
  const rateResult = checkRateLimit(request, 'signup');
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

  const { inviteCode, email, password, shareLogsWithAdmin } = body as Record<string, unknown>;

  if (typeof inviteCode !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Normalize email (§4.1)
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  // Normalize invite code
  const normalizedCode = normalizeInviteCode(inviteCode);
  if (!normalizedCode) {
    console.warn(`[auth] signup attempted with malformed invite code`);
    return NextResponse.json({ error: 'invalid_invite_code' }, { status: 400 });
  }

  // Validate password policy (§3.7)
  const policyResult = validatePasswordPolicy(password);
  if (!policyResult.ok) {
    return NextResponse.json(
      { error: policyResult.reason, ...(policyResult.reason === 'weak_password' ? { minLength: policyResult.minLength } : { maxBytes: policyResult.maxBytes }) },
      { status: 400 },
    );
  }

  // Consent coercion (flipped 2026-08-18 — sharing is now the default; only
  // literal `false` opts out). Same asymmetric-fail-safe shape as before
  // (§8 invariant 15), just mirrored: a malformed/wrong-type value used to
  // fail toward the safer "private" state, now it fails toward the new
  // default "shared" state, since that default itself is what changed, not
  // the rigor of guarding against a malformed value.
  const consentGranted: boolean = shareLogsWithAdmin !== false;

  // Hash the password outside any transaction (constraint 5)
  const passwordHash = await hashPassword(password);

  // Read maxUsers fresh (§8 policy 18)
  const maxUsers = getMaxUsers();

  // Atomic signup transaction (§4.4)
  const result = createUserWithInvite({
    email: normalizedEmail,
    passwordHash,
    code: normalizedCode,
    maxUsers,
    shareLogsWithAdmin: consentGranted,
    oauth: null,   // password signup — no OAuth identity (§4.2)
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'invalid_code':
        console.warn(`[auth] signup failed — invalid or already-redeemed invite code`);
        return NextResponse.json({ error: 'invalid_invite_code' }, { status: 400 });
      case 'email_exists':
        return NextResponse.json({ error: 'email_exists' }, { status: 409 });
      case 'cap_reached':
        console.warn(`[auth] signup refused — maxUsers cap reached (${maxUsers})`);
        return NextResponse.json({ error: 'signups_closed' }, { status: 403 });
    }
  }

  const { user } = result as { ok: true; user: { id: string; email: string; role: 'admin' | 'user' } };

  // Issue session token
  const token = await signSessionToken({ sub: user.id, email: user.email });

  const response = NextResponse.json(
    { user: { id: user.id, email: user.email, role: user.role } },
    { status: 201 },
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
