/**
 * app/api/auth/oauth/[provider]/start/route.ts
 *
 * POST /api/auth/oauth/[provider]/start — initiate an OAuth 2.0 / OIDC flow.
 *
 * Returns 200 { authorizeUrl } and sets the oauth transaction cookie.
 * The client calls window.location.assign(authorizeUrl) to navigate to the
 * provider's consent screen.
 *
 * Route shape rationale (§5.2):
 *   POST returning JSON was chosen over a plain GET <a href> so that the invite
 *   code stays in a request body and never enters a URL, browser history, or a
 *   Referer header (constraint 13). A POST returning a 303 was rejected because
 *   the client cannot then render validation errors inline.
 *
 * Flow (§6 Leg 1):
 *   1. rate-limit ('oauth_start' bucket — §3.8)
 *   2. configured / provider known check
 *   3. body validation (mode, inviteCode for signup)
 *   4. signup pre-checks (non-authoritative: code format + DB + cap)
 *   5. generate state / codeVerifier / nonce (32 random bytes → base64url each)
 *   6. build authorizeUrl via provider.createAuthorizationUrl()
 *   7. 200 { authorizeUrl } + Set-Cookie: myagent_oauth_tx
 *
 * Error vocabulary (§7.3):
 *   400 invalid_body        — missing/invalid mode, or signup without inviteCode
 *   400 invalid_invite_code — code format bad, unknown, or already redeemed
 *   403 signups_closed      — maxUsers cap reached
 *   404 unknown_provider    — not in the provider registry
 *   429 rate_limited        — too many attempts from this IP
 *   503 oauth_not_configured — OAuth env vars not set
 *
 * Invariant 13 — invite code is stored in the httpOnly tx cookie, never in the URL,
 *   query string, state value, log line, or response body.
 * Invariant 16 — redirect URI is built from OAUTH_REDIRECT_BASE_URL inside the
 *   provider implementation (google.ts), never derived from a request header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth/rateLimit';
import { isOAuthConfigured } from '@/lib/env';
import { getOAuthProvider } from '@/lib/auth/oauth/providers';
import { buildOAuthTxCookie } from '@/lib/auth/oauth/tx';
import { normalizeInviteCode } from '@/lib/auth/inviteCode';
import { getUserCount, getInviteCode } from '@/lib/db/repository/users';
import { getMaxUsers } from '@/lib/settings';

type Params = { provider: string };

/**
 * Generates `byteCount` cryptographically random bytes as a base64url-encoded
 * string. Used for state, codeVerifier (PKCE), and nonce — all three are random
 * URL-safe strings; the provider's `createAuthorizationUrl` computes the
 * code_challenge from the verifier.
 */
function randomBase64url(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> },
): Promise<NextResponse> {
  // 1. Rate limit (§3.8 — 'oauth_start' inherits the same in-process limiter)
  const rateResult = checkRateLimit(request, 'oauth_start');
  if (rateResult) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSeconds: rateResult.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rateResult.retryAfterSeconds) } },
    );
  }

  // 2. Provider check (§6 Leg 1 step 2):
  //    Check isOAuthConfigured() FIRST so 503 and 404 are distinguishable.
  const { provider } = await params;
  if (!isOAuthConfigured()) {
    console.error('[auth] oauth start attempted but OAuth is not configured');
    return NextResponse.json({ error: 'oauth_not_configured' }, { status: 503 });
  }
  const oauthProvider = getOAuthProvider(provider);
  if (!oauthProvider) {
    return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
  }

  // 3. Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const { mode, inviteCode, shareLogsWithAdmin, next } = raw;

  if (mode !== 'login' && mode !== 'signup') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (mode === 'signup' && typeof inviteCode !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // 4. Signup pre-checks — cheap, NON-authoritative (authoritative checks re-run
  //    inside createUserWithInvite's transaction in the callback — §4.2).
  //    Purpose: avoid sending someone through a Google consent screen only to
  //    refuse them on the return leg.
  let normalizedCode: string | undefined;
  if (mode === 'signup') {
    const nc = normalizeInviteCode(inviteCode as string);
    if (!nc) {
      console.warn('[auth] oauth start: invite code format invalid');
      return NextResponse.json({ error: 'invalid_invite_code' }, { status: 400 });
    }

    // Pre-check DB: is the code known and unredeemed?
    const codeRow = getInviteCode(nc);
    if (!codeRow || codeRow.redeemedBy !== null) {
      console.warn('[auth] oauth start: invite code unknown or already redeemed');
      return NextResponse.json({ error: 'invalid_invite_code' }, { status: 400 });
    }

    // Pre-check cap
    const count = getUserCount();
    const maxUsers = getMaxUsers();
    if (count >= maxUsers) {
      console.warn(`[auth] oauth start: signups closed (${count}/${maxUsers})`);
      return NextResponse.json({ error: 'signups_closed' }, { status: 403 });
    }

    normalizedCode = nc;
  }

  // 5. Generate CSRF state, PKCE code verifier, and nonce (all 32 random bytes → base64url)
  const state = randomBase64url(32);
  const codeVerifier = randomBase64url(32);
  const nonce = randomBase64url(32);

  // 6. Build the provider's authorization URL (no access_type=offline; no prompt=consent — §6)
  const authorizeUrl = oauthProvider.createAuthorizationUrl({ state, codeVerifier, nonce });

  // 7. Build response: 200 { authorizeUrl } + Set-Cookie tx
  //
  //    consent is stored as-is from the body — coercion to === true happens in the
  //    callback (§8 invariant 14). This lets a "true" string vs boolean true
  //    distinction survive the round trip.
  //
  //    inviteCode is stored ONLY in the httpOnly tx cookie (constraint 13).
  //    It must NOT appear in the authorizeUrl, the state, any log line, or the body.
  const txCookie = buildOAuthTxCookie({
    v: 1,
    provider,
    mode: mode as 'login' | 'signup',
    state,
    codeVerifier,
    nonce,
    ...(normalizedCode !== undefined ? { inviteCode: normalizedCode } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(shareLogsWithAdmin !== undefined ? { consent: shareLogsWithAdmin as any } : {}),
    ...(typeof next === 'string' ? { next } : {}),
  });

  const response = NextResponse.json({ authorizeUrl: authorizeUrl.toString() }, { status: 200 });
  response.cookies.set(txCookie.name, txCookie.value, txCookie.options);
  return response;
}
