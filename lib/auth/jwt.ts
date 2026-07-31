/**
 * lib/auth/jwt.ts
 *
 * JWT sign / verify for session tokens.
 *
 * Deliberately Edge-safe: no Node-only imports, no `server-only`. This lets
 * middleware.ts (which runs on the Next.js Edge runtime) verify tokens using
 * the same code path as route handlers. `jose` uses the WebCrypto API, which
 * is available on both runtimes (§3.1).
 *
 * Claims carried in the token (§3.3):
 *   sub   — user id
 *   email — convenience field, NEVER trusted for authorization
 *   iat   — issued-at (set by jose)
 *   exp   — expires-at (set by jose)
 *
 * No `role` claim. Role is read fresh from the DB on every request (§2.1).
 */

import { SignJWT, jwtVerify } from 'jose';
import { getJwtSecret } from '../env.js';
import { getSessionTtlSeconds } from './constants.js';

export type SessionTokenPayload = {
  sub: string;    // user id
  email: string;  // convenience only — not authoritative
};

/**
 * Signs a new session token.
 * Returns the compact JWT string.
 */
export async function signSessionToken(payload: SessionTokenPayload): Promise<string> {
  const secret = getJwtSecret();
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${getSessionTtlSeconds()}s`)
    .sign(secret);
}

/**
 * Verifies a session token and returns its payload, or null if it is invalid,
 * expired, or tampered.
 *
 * Never throws — all errors are swallowed and returned as null so callers
 * can treat "bad token" and "expired token" identically.
 */
export async function verifySessionToken(
  token: string,
): Promise<SessionTokenPayload | null> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });

    const sub = payload.sub;
    const email = payload['email'];

    if (typeof sub !== 'string' || typeof email !== 'string') return null;

    return { sub, email };
  } catch {
    return null;
  }
}
