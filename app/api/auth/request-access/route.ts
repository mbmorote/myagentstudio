/**
 * app/api/auth/request-access/route.ts
 *
 * POST /api/auth/request-access — "Request access" on the signup form, for visitors
 * without an invite code (Plan 12, 2026-08-14). Public — no session required.
 *
 * Flow: rate limit → validate body → already a registered user? skip → already an open
 * request, or an unexpired code, for this email? skip → otherwise log the request (an
 * admin generates the actual code later, from Settings' Access requests grid).
 *
 * The response is IDENTICAL regardless of which branch fired — this endpoint never
 * tells a visitor whether an email is already registered or already has a pending
 * request, matching the anti-enumeration posture the rest of this auth system already
 * uses (see LoginForm/SignupForm's closed-vocabulary OAuth error messages).
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth/rateLimit';
import { isReferralSource } from '@/lib/auth/referralSource';
import {
  getUserByEmail,
  hasOpenAccessRequest,
  hasActiveInviteCodeForEmail,
  createAccessRequest,
} from '@/lib/db/repository';

const GENERIC_RESPONSE = {
  message: "Thanks — if we can offer you a spot, we'll email your invite code soon.",
};

const MAX_NAME_LENGTH = 200;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateResult = checkRateLimit(request, 'request-access');
  if (rateResult) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSeconds: rateResult.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rateResult.retryAfterSeconds) } },
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

  const { name, email, referralSource } = body as Record<string, unknown>;

  if (typeof name !== 'string' || typeof email !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
  }

  // Same minimal check the signup route uses (§4.1) — not a stricter regex on purpose,
  // for consistency with how email is validated everywhere else in this auth system.
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const normalizedSource = isReferralSource(referralSource) ? referralSource : null;

  try {
    // Every branch below returns the same GENERIC_RESPONSE — see file header. The
    // differences only affect what gets written, never what the visitor sees.
    if (getUserByEmail(normalizedEmail)) {
      return NextResponse.json(GENERIC_RESPONSE, { status: 201 });
    }
    if (hasOpenAccessRequest(normalizedEmail) || hasActiveInviteCodeForEmail(normalizedEmail)) {
      return NextResponse.json(GENERIC_RESPONSE, { status: 201 });
    }

    createAccessRequest({
      name: trimmedName,
      email: normalizedEmail,
      referralSource: normalizedSource,
    });

    return NextResponse.json(GENERIC_RESPONSE, { status: 201 });
  } catch (err) {
    console.error('[request-access] POST error:', String(err));
    // Still generic — an internal error shouldn't distinguish this response from any
    // other branch either.
    return NextResponse.json(GENERIC_RESPONSE, { status: 201 });
  }
}
