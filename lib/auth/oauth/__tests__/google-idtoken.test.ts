/**
 * lib/auth/oauth/__tests__/google-idtoken.test.ts
 *
 * Tests for `_verifyGoogleIdToken` in google.ts (§10.3, constraint 11).
 *
 * Uses a locally generated RSA key pair — never contacts Google, never uses
 * a real GOOGLE_CLIENT_SECRET. The JWKS is passed directly to the exported
 * internal function so `createRemoteJWKSet` (the live network path) is never called.
 *
 * This file MUST NOT import `arctic` directly (constraint 11).
 * Fitness test in route-guard.test.ts asserts this mechanically.
 *
 * Cases:
 *   - valid token with all required claims → OAuthProfile
 *   - wrong `aud` → throws OAuthError
 *   - wrong `iss` → throws OAuthError
 *   - expired token → throws OAuthError
 *   - nonce mismatch → throws OAuthError
 *   - email_verified: false → profile with emailVerified: false
 *   - email_verified: "true" (string) → emailVerified: false (no coercion)
 *   - missing sub claim → throws OAuthError
 *   - missing email claim → throws OAuthError
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import type { CryptoKey } from 'jose';
import { _verifyGoogleIdToken } from '../google.js';
import { OAuthError } from '../types.js';

// ── Test key pair ──────────────────────────────────────────────────────────────

let privateKey: CryptoKey;
let localJwks: ReturnType<typeof createLocalJWKSet>;

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const ISSUER = 'https://accounts.google.com';
const NONCE = 'test-nonce-abc123';

beforeAll(async () => {
  // Generate a real RSA key pair for signing test tokens.
  // createLocalJWKSet accepts the public key as a JWK.
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  const publicJwk = await exportJWK(pair.publicKey);
  // jose requires a `kty` field in the key set
  localJwks = createLocalJWKSet({ keys: [publicJwk] });
});

/** Build a valid base token payload and let the test override specific fields. */
async function makeToken(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const base: Record<string, unknown> = {
    sub: 'google-sub-123',
    email: 'alice@example.com',
    email_verified: true,
    nonce: NONCE,
    ...overrides,
  };

  const builder = new SignJWT(base)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setIssuedAt(now);

  // Allow overriding expiry for the "expired" test case
  if ('exp' in overrides) {
    // exp is already in the payload — jose picks it up
    return builder.sign(privateKey);
  }

  return builder.setExpirationTime('1h').sign(privateKey as CryptoKey);
}

// ── Happy path ─────────────────────────────────────────────────────────────────

describe('_verifyGoogleIdToken — happy path', () => {
  it('returns a valid OAuthProfile for a well-formed token', async () => {
    const token = await makeToken();
    const profile = await _verifyGoogleIdToken(token, localJwks, CLIENT_ID, NONCE);
    expect(profile).toEqual({
      providerAccountId: 'google-sub-123',
      email: 'alice@example.com',
      emailVerified: true,
    });
  });
});

// ── iss / aud / exp ────────────────────────────────────────────────────────────

describe('_verifyGoogleIdToken — iss / aud / exp checks', () => {
  it('throws OAuthError when aud does not match clientId', async () => {
    const token = await makeToken();
    await expect(
      _verifyGoogleIdToken(token, localJwks, 'wrong-client-id', NONCE),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it('the OAuthError code for wrong aud is id_token_verification_failed', async () => {
    const token = await makeToken();
    await expect(
      _verifyGoogleIdToken(token, localJwks, 'wrong-client-id', NONCE),
    ).rejects.toMatchObject({ code: 'id_token_verification_failed' });
  });

  it('throws OAuthError when iss does not match expected issuers', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: 'google-sub-123',
      email: 'alice@example.com',
      email_verified: true,
      nonce: NONCE,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://evil.example.com')
      .setAudience(CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(
      _verifyGoogleIdToken(token, localJwks, CLIENT_ID, NONCE),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it('throws OAuthError for an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    // Build token with exp already in the past
    const token = await new SignJWT({
      sub: 'google-sub-123',
      email: 'alice@example.com',
      email_verified: true,
      nonce: NONCE,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt(past - 60)
      .setExpirationTime(past)
      .sign(privateKey);

    await expect(
      _verifyGoogleIdToken(token, localJwks, CLIENT_ID, NONCE),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});

// ── Nonce ──────────────────────────────────────────────────────────────────────

describe('_verifyGoogleIdToken — nonce checks', () => {
  it('throws OAuthError when nonce does not match', async () => {
    const token = await makeToken({ nonce: 'different-nonce' });
    await expect(
      _verifyGoogleIdToken(token, localJwks, CLIENT_ID, NONCE),
    ).rejects.toMatchObject({ code: 'id_token_nonce_mismatch' });
  });
});

// ── email_verified ─────────────────────────────────────────────────────────────

describe('_verifyGoogleIdToken — email_verified handling (§3.6)', () => {
  it('returns emailVerified: false when email_verified is the boolean false', async () => {
    const token = await makeToken({ email_verified: false });
    const profile = await _verifyGoogleIdToken(token, localJwks, CLIENT_ID, NONCE);
    expect(profile.emailVerified).toBe(false);
  });

  it('returns emailVerified: false when email_verified is the string "true" (no coercion)', async () => {
    // Some non-OIDC providers send "true" as a string — Google does not, but we
    // must be strict regardless. This test documents and enforces the no-coercion rule.
    const token = await makeToken({ email_verified: 'true' });
    const profile = await _verifyGoogleIdToken(token, localJwks, CLIENT_ID, NONCE);
    expect(profile.emailVerified).toBe(false);
  });

  it('returns emailVerified: false when email_verified is the number 1 (no coercion)', async () => {
    const token = await makeToken({ email_verified: 1 });
    const profile = await _verifyGoogleIdToken(token, localJwks, CLIENT_ID, NONCE);
    expect(profile.emailVerified).toBe(false);
  });
});

// ── Missing required claims ────────────────────────────────────────────────────

describe('_verifyGoogleIdToken — missing required claims', () => {
  it('throws OAuthError with code id_token_missing_sub when sub is absent', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Build without a sub — SignJWT.setSubject sets sub; omitting it leaves it absent
    const token = await new SignJWT({
      email: 'alice@example.com',
      email_verified: true,
      nonce: NONCE,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(
      _verifyGoogleIdToken(token, localJwks, CLIENT_ID, NONCE),
    ).rejects.toMatchObject({ code: 'id_token_missing_sub' });
  });

  it('throws OAuthError with code id_token_missing_email when email is absent', async () => {
    const token = await makeToken({ email: undefined });
    await expect(
      _verifyGoogleIdToken(token, localJwks, CLIENT_ID, NONCE),
    ).rejects.toMatchObject({ code: 'id_token_missing_email' });
  });
});
