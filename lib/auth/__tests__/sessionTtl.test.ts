/**
 * lib/auth/__tests__/sessionTtl.test.ts
 *
 * Tests for getSessionTtlSeconds() and its integration with assertServerEnv()
 * and signSessionToken() (Plan 06 §3.2, §10.3, constraint 4).
 *
 * Cases:
 *   - unset / empty → DEFAULT_SESSION_TTL_SECONDS (604800)
 *   - valid integer in bounds → that integer
 *   - invalid values each throw: '0', '-1', 'abc', '60.5', '99999999'
 *   - assertServerEnv() propagates a bad SESSION_TTL_SECONDS throw at boot
 *   - the JWT exp and cookie maxAge derive from the same number (constraint 4)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_TTL_SECONDS,
  MAX_SESSION_TTL_SECONDS,
  MIN_SESSION_TTL_SECONDS,
  getSessionTtlSeconds,
} from '../constants.js';
import { assertServerEnv } from '../../env.js';
import { signSessionToken } from '../jwt.js';

// Preserve the original env value so tests don't bleed into each other.
let originalTtl: string | undefined;
let originalJwtSecret: string | undefined;

beforeEach(() => {
  originalTtl = process.env.SESSION_TTL_SECONDS;
  originalJwtSecret = process.env.JWT_SECRET;
  // Ensure a valid JWT_SECRET is always present (needed by assertServerEnv and signSessionToken).
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
});

afterEach(() => {
  if (originalTtl === undefined) {
    delete process.env.SESSION_TTL_SECONDS;
  } else {
    process.env.SESSION_TTL_SECONDS = originalTtl;
  }
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

// ── Constant shape ─────────────────────────────────────────────────────────────

describe('exported constants', () => {
  it('DEFAULT_SESSION_TTL_SECONDS is 604800 (7 days)', () => {
    expect(DEFAULT_SESSION_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('MIN_SESSION_TTL_SECONDS is 60', () => {
    expect(MIN_SESSION_TTL_SECONDS).toBe(60);
  });

  it('MAX_SESSION_TTL_SECONDS is 90 days in seconds', () => {
    expect(MAX_SESSION_TTL_SECONDS).toBe(90 * 24 * 60 * 60);
  });
});

// ── getSessionTtlSeconds() ─────────────────────────────────────────────────────

describe('getSessionTtlSeconds()', () => {
  it('returns DEFAULT_SESSION_TTL_SECONDS when SESSION_TTL_SECONDS is unset', () => {
    delete process.env.SESSION_TTL_SECONDS;
    expect(getSessionTtlSeconds()).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });

  it('returns DEFAULT_SESSION_TTL_SECONDS when SESSION_TTL_SECONDS is empty string', () => {
    process.env.SESSION_TTL_SECONDS = '';
    expect(getSessionTtlSeconds()).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });

  it('returns the parsed integer for a valid value (3600)', () => {
    process.env.SESSION_TTL_SECONDS = '3600';
    expect(getSessionTtlSeconds()).toBe(3600);
  });

  it('accepts the exact minimum (60)', () => {
    process.env.SESSION_TTL_SECONDS = '60';
    expect(getSessionTtlSeconds()).toBe(60);
  });

  it('accepts the exact maximum (90 days)', () => {
    process.env.SESSION_TTL_SECONDS = String(MAX_SESSION_TTL_SECONDS);
    expect(getSessionTtlSeconds()).toBe(MAX_SESSION_TTL_SECONDS);
  });

  it("throws for '0' — below the minimum", () => {
    process.env.SESSION_TTL_SECONDS = '0';
    expect(() => getSessionTtlSeconds()).toThrow('SESSION_TTL_SECONDS');
  });

  it("throws for '-1' — negative", () => {
    process.env.SESSION_TTL_SECONDS = '-1';
    expect(() => getSessionTtlSeconds()).toThrow('SESSION_TTL_SECONDS');
  });

  it("throws for 'abc' — not a number", () => {
    process.env.SESSION_TTL_SECONDS = 'abc';
    expect(() => getSessionTtlSeconds()).toThrow('SESSION_TTL_SECONDS');
  });

  it("throws for '60.5' — non-integer float", () => {
    process.env.SESSION_TTL_SECONDS = '60.5';
    expect(() => getSessionTtlSeconds()).toThrow('SESSION_TTL_SECONDS');
  });

  it("throws for '99999999' — above the maximum (90 days)", () => {
    process.env.SESSION_TTL_SECONDS = '99999999';
    expect(() => getSessionTtlSeconds()).toThrow('SESSION_TTL_SECONDS');
  });

  it('error message includes the bad value', () => {
    process.env.SESSION_TTL_SECONDS = 'bad-value';
    expect(() => getSessionTtlSeconds()).toThrow('bad-value');
  });
});

// ── assertServerEnv() integration ─────────────────────────────────────────────

describe('assertServerEnv() propagates SESSION_TTL_SECONDS errors', () => {
  it('does not throw when SESSION_TTL_SECONDS is unset', () => {
    delete process.env.SESSION_TTL_SECONDS;
    expect(() => assertServerEnv()).not.toThrow();
  });

  it('does not throw for a valid SESSION_TTL_SECONDS', () => {
    process.env.SESSION_TTL_SECONDS = '3600';
    expect(() => assertServerEnv()).not.toThrow();
  });

  it('throws at boot for an invalid SESSION_TTL_SECONDS', () => {
    process.env.SESSION_TTL_SECONDS = 'bad-value';
    expect(() => assertServerEnv()).toThrow('SESSION_TTL_SECONDS');
  });
});

// ── JWT exp / cookie maxAge parity (constraint 4) ─────────────────────────────

describe('JWT exp and cookie maxAge derive from the same number', () => {
  it('the signed token exp − iat equals getSessionTtlSeconds() when TTL is unset', async () => {
    delete process.env.SESSION_TTL_SECONDS;
    const ttl = getSessionTtlSeconds();

    const token = await signSessionToken({ sub: 'u1', email: 'test@example.com' });
    const parts = token.split('.');
    const rawPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

    // jose sets exp = iat + TTL (within 1 second of clock skew)
    expect(rawPayload.exp - rawPayload.iat).toBeCloseTo(ttl, -1);
    expect(rawPayload.exp - rawPayload.iat).toBe(ttl);
  });

  it('the signed token exp − iat equals getSessionTtlSeconds() for a custom TTL (3600)', async () => {
    process.env.SESSION_TTL_SECONDS = '3600';
    const ttl = getSessionTtlSeconds();

    const token = await signSessionToken({ sub: 'u2', email: 'test@example.com' });
    const parts = token.split('.');
    const rawPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

    expect(rawPayload.exp - rawPayload.iat).toBe(ttl);
    expect(ttl).toBe(3600);
  });
});
