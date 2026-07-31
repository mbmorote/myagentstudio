/**
 * lib/auth/oauth/google.ts
 *
 * Google OAuth 2.0 / OpenID Connect provider implementation.
 *
 * THE ONLY FILE IN THIS REPO THAT MAY IMPORT `arctic` (constraint 9).
 * THE ONLY FILE IN THIS REPO THAT MAY CALL `createRemoteJWKSet` (§2.2).
 *
 * `createGoogleProvider()` returns an `OAuthProvider` so everything above
 * this layer depends only on `lib/auth/oauth/types.ts`.
 *
 * `_verifyGoogleIdToken` is exported for testing with a locally generated
 * JWKS (constraint 11) — no test may call `createRemoteJWKSet` or contact
 * Google. The leading underscore signals "exported for testing, not for
 * external callers". Callers outside tests must go through `exchangeAndVerify`.
 */

import { Google } from 'arctic';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { OAuthConfig } from '../../env.js';
import { OAUTH_SCOPES } from '../constants.js';
import { OAuthError, type OAuthProfile, type OAuthProvider } from './types.js';

/** Google's JWKS endpoint. */
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Google's valid issuer values — they emit both forms in the wild.
 * Passing both to `jwtVerify` makes the check robust (§3.6).
 */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Module-level JWKS getter — `jose` caches the fetched keys and handles rotation.
 * The outbound HTTPS request to Google happens lazily on the first `jwtVerify` call,
 * not on module load. Tests never trigger this because they inject a local JWKS via
 * `_verifyGoogleIdToken(idToken, localJwks, ...)`.
 */
const REMOTE_GOOGLE_JWKS = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

/**
 * Verifies a Google id_token against a JWKS and extracts a validated profile.
 *
 * Checks enforced by `jwtVerify` (§3.6):
 *   - Signature (RS256 against the JWKS)
 *   - `iss` — must be one of GOOGLE_ISSUERS
 *   - `aud` — must equal `clientId`
 *   - `exp` — token must not be expired
 *
 * Checks enforced here after `jwtVerify`:
 *   - `sub`   — non-empty string (the stable provider identity; §3.6, constraint 7)
 *   - `email` — non-empty string
 *   - `nonce` — must exactly equal the nonce from the tx cookie
 *   - `email_verified === true` — the boolean, not a coerced value (§3.6)
 *     Note: this field is extracted and returned but NOT used as a gate here;
 *     the caller (exchangeAndVerify → callback handler) checks `emailVerified`.
 *
 * Exported so tests can inject a locally generated JWKS (constraint 11).
 * Production code calls this via `exchangeAndVerify`, which passes REMOTE_GOOGLE_JWKS.
 * NO token is ever logged here (constraint 8).
 */
export async function _verifyGoogleIdToken(
  idToken: string,
  jwks: JWTVerifyGetKey,
  clientId: string,
  nonce: string,
): Promise<OAuthProfile> {
  let rawPayload: Record<string, unknown>;

  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
    });
    rawPayload = payload as Record<string, unknown>;
  } catch (e) {
    // Do NOT include the idToken or any token content in the thrown message (constraint 8).
    throw new OAuthError(
      'id_token_verification_failed',
      e instanceof Error ? e.message : 'id_token verification failed',
    );
  }

  const sub = rawPayload['sub'];
  if (typeof sub !== 'string' || sub === '') {
    throw new OAuthError('id_token_missing_sub', 'id_token is missing the sub claim');
  }

  const email = rawPayload['email'];
  if (typeof email !== 'string' || email === '') {
    throw new OAuthError('id_token_missing_email', 'id_token is missing the email claim');
  }

  const nonceClaim = rawPayload['nonce'];
  if (nonceClaim !== nonce) {
    throw new OAuthError('id_token_nonce_mismatch', 'id_token nonce does not match the transaction');
  }

  // email_verified must be the literal boolean true — not the string "true", not 1,
  // not undefined. Strict equality is Plan 05 §8 invariant 15 applied to a new claim (§3.6).
  const emailVerified = rawPayload['email_verified'] === true;

  return {
    providerAccountId: sub,
    email,
    emailVerified,
  };
}

/**
 * Creates the Google OAuthProvider instance.
 *
 * Called by `providers.ts` on each request (no singleton — config is read once
 * at start-up and validated in `assertServerEnv()`).
 *
 * The redirect URI is always derived from `config.redirectBaseUrl`, never from
 * any request header (§3.4 — host-header-injection prevention).
 */
export function createGoogleProvider(config: OAuthConfig): OAuthProvider {
  const redirectURI = `${config.redirectBaseUrl}/api/auth/oauth/google/callback`;
  const client = new Google(config.clientId, config.clientSecret, redirectURI);

  return {
    name: 'google',

    createAuthorizationUrl({ state, codeVerifier, nonce }) {
      // arctic's createAuthorizationURL handles PKCE (code_challenge derivation)
      // and includes the required OAuth params. We append nonce separately so it
      // is bound into the id_token Google returns (§3.6).
      const url = client.createAuthorizationURL(state, codeVerifier, [...OAUTH_SCOPES]);
      url.searchParams.set('nonce', nonce);
      return url;
    },

    async exchangeAndVerify({ code, codeVerifier, nonce }) {
      // Exchange the authorization code for tokens (server-to-server call to Google).
      // Throws arctic's own errors on network failure or HTTP 4xx/5xx.
      let tokens;
      try {
        tokens = await client.validateAuthorizationCode(code, codeVerifier);
      } catch (e) {
        // Do NOT include the code or any credential in the thrown message (constraint 8).
        throw new OAuthError(
          'token_exchange_failed',
          e instanceof Error ? e.message : 'authorization code exchange failed',
        );
      }

      // Extract the id_token. Google always includes one for the openid scope.
      let idToken: string;
      try {
        idToken = tokens.idToken();
      } catch {
        throw new OAuthError('id_token_missing', 'token response contained no id_token');
      }

      // Verify the id_token against Google's real JWKS and return a validated profile.
      // The idToken is used here and immediately discarded — never stored, never logged
      // (constraint 8).
      return _verifyGoogleIdToken(idToken, REMOTE_GOOGLE_JWKS, config.clientId, nonce);
    },
  };
}
