/**
 * lib/auth/oauth/tx.ts
 *
 * OAuth transaction cookie — single owner, three operations (§3.5).
 *
 * The tx cookie survives the browser round trip through the OAuth provider:
 *   buildOAuthTxCookie() → Set-Cookie on the /start response
 *   readOAuthTx()        → read and validate in the /callback handler
 *   clearOAuthTxOn()     → delete on EVERY exit path from /callback (constraint 10)
 *
 * COOKIE_PATH is the single source of truth for the path used on all three
 * operations. A mismatch between set-path and clear-path causes the browser
 * to silently ignore the deletion, leaving a replayable tx cookie behind —
 * the canonical form of the "cleared on the happy path only" bug (§3.5).
 *
 * No dependency on arctic. The contents are base64url-encoded JSON; they are
 * not signed because every value is re-validated authoritatively downstream
 * (§3.5 — the explicit design note about why signing is omitted).
 */

import type { NextRequest, NextResponse } from 'next/server';
import { OAUTH_TX_COOKIE, OAUTH_TX_TTL_SECONDS } from '../constants.js';
import type { OAuthTx } from './types.js';

/** Both OAuth routes live under this path. Set and clear must use identical value. */
const COOKIE_PATH = '/api/auth/oauth';

export type OAuthTxCookieOptions = {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
};

export type OAuthTxCookieResult = {
  name: string;
  value: string;
  options: OAuthTxCookieOptions;
};

/**
 * Encodes an OAuthTx as base64url JSON and returns the cookie name, value, and
 * attributes. The start-route handler calls this and sets the result on its response.
 *
 * Cookie properties (§3.5):
 *   httpOnly=true  — the invite code is a bearer credential; no script needs it
 *   sameSite=lax   — LOAD-BEARING: the callback is a cross-site top-level GET
 *                    navigation from the provider; 'strict' would withhold the
 *                    cookie on that navigation in most browsers
 *   secure=prod    — same rule as the session cookie
 *   path=COOKIE_PATH — scoped; the cookie never rides along on other requests
 *   maxAge=600     — 10 minutes; long enough for a real consent screen,
 *                    short enough to block resuming an abandoned flow
 */
export function buildOAuthTxCookie(tx: OAuthTx): OAuthTxCookieResult {
  const value = Buffer.from(JSON.stringify(tx), 'utf-8').toString('base64url');
  return {
    name: OAUTH_TX_COOKIE,
    value,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: COOKIE_PATH,
      maxAge: OAUTH_TX_TTL_SECONDS,
    },
  };
}

/**
 * Reads and validates the OAuth transaction cookie from the incoming request.
 *
 * Returns `null` (uniformly, never throws) on:
 *   - absent cookie
 *   - non-base64url or non-JSON value
 *   - `v` !== 1 (format changed; reject stale cookies after a schema bump)
 *   - `provider` does not match the expected provider (a GitHub tx cannot
 *     satisfy a Google callback)
 *
 * The caller must independently validate all OAuthTx fields before use (§3.5).
 */
export function readOAuthTx(request: NextRequest, provider: string): OAuthTx | null {
  const raw = request.cookies.get(OAUTH_TX_COOKIE)?.value;
  if (!raw) return null;

  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    const parsed: unknown = JSON.parse(decoded);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as Record<string, unknown>)['v'] !== 1 ||
      (parsed as Record<string, unknown>)['provider'] !== provider
    ) {
      return null;
    }

    return parsed as OAuthTx;
  } catch {
    return null;
  }
}

/**
 * Clears the OAuth transaction cookie on `response`.
 *
 * Uses the identical path, httpOnly, sameSite, and secure values as
 * `buildOAuthTxCookie`. A missing or mismatched path causes the browser to
 * silently ignore the deletion — see the file-level comment on COOKIE_PATH.
 *
 * Must be called on every exit path from the callback handler (constraint 10).
 */
export function clearOAuthTxOn(response: NextResponse): void {
  response.cookies.set(OAUTH_TX_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: COOKIE_PATH,
    maxAge: 0,
  });
}
