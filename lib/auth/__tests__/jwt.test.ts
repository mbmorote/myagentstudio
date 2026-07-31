/**
 * lib/auth/__tests__/jwt.test.ts
 *
 * Tests for lib/auth/jwt.ts (§10.3).
 *
 * Cases:
 *   - round-trip sign → verify returns the original payload
 *   - tampered payload → null
 *   - expired → null
 *   - wrong secret → null
 *   - the token contains no `role` claim
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { signSessionToken, verifySessionToken } from '../jwt.js';

// The test must run with a valid JWT_SECRET in env.
// The vitest environment inherits process.env; set it explicitly here if absent.
beforeEach(() => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
  }
});

describe('signSessionToken / verifySessionToken', () => {
  it('round-trip: sign then verify returns the original sub and email', async () => {
    const payload = { sub: 'user-123', email: 'alice@example.com' };
    const token = await signSessionToken(payload);
    const result = await verifySessionToken(token);

    expect(result).not.toBeNull();
    expect(result!.sub).toBe('user-123');
    expect(result!.email).toBe('alice@example.com');
  });

  it('the token does not carry a role claim (§3.3)', async () => {
    const token = await signSessionToken({ sub: 'u1', email: 'x@y.com' });
    // Decode the payload without verification to inspect claims
    const parts = token.split('.');
    const rawPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

    expect(rawPayload).not.toHaveProperty('role');
    expect(rawPayload).toHaveProperty('sub', 'u1');
    expect(rawPayload).toHaveProperty('email', 'x@y.com');
  });

  it('returns null for a token signed with a different secret (tampered)', async () => {
    const wrongSecret = new TextEncoder().encode(
      'a-completely-different-secret-that-is-also-at-least-32-chars',
    );
    const token = await new SignJWT({ email: 'x@y.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u-bad')
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(wrongSecret);

    const result = await verifySessionToken(token);
    expect(result).toBeNull();
  });

  it('returns null for a token with a tampered payload', async () => {
    const token = await signSessionToken({ sub: 'u1', email: 'x@y.com' });
    // Flip the FIRST character of the signature segment, not the last: the
    // last base64url character of a 32-byte HMAC-SHA256 digest carries 2
    // padding bits that decoders discard, so e.g. 'A' (000000) <-> 'B'
    // (000001) there decodes to an identical byte and isn't a real tamper.
    // The first character always encodes real data bits.
    const parts = token.split('.');
    const flipped = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    const tampered = [parts[0], parts[1], flipped].join('.');

    const result = await verifySessionToken(tampered);
    expect(result).toBeNull();
  });

  it('returns null for an already-expired token', async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    // Sign with exp in the past
    const token = await new SignJWT({ email: 'x@y.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u-expired')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3700)  // issued >1 hour ago
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)  // expired 1 hour ago
      .sign(secret);

    const result = await verifySessionToken(token);
    expect(result).toBeNull();
  });

  it('returns null for a garbage string', async () => {
    expect(await verifySessionToken('not.a.jwt')).toBeNull();
    expect(await verifySessionToken('')).toBeNull();
    expect(await verifySessionToken('totally-invalid')).toBeNull();
  });
});
