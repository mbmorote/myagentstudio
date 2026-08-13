/**
 * lib/__tests__/env.test.ts
 *
 * Tests for lib/env.ts's OAuth/Anthropic/JWT env-var accessors.
 * lib/auth/__tests__/sessionTtl.test.ts already covers SESSION_TTL_SECONDS and
 * its assertServerEnv() integration — not repeated here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAnthropicApiKey,
  getAnthropicModel,
  getJwtSecret,
  isOAuthConfigured,
  getOAuthConfig,
  _assertOAuthEnv,
} from '../env.js';

const OAUTH_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_REDIRECT_BASE_URL'] as const;
const OTHER_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'JWT_SECRET', 'NODE_ENV'] as const;
const ALL_KEYS = [...OAUTH_KEYS, ...OTHER_KEYS] as const;

const originalValues: Partial<Record<(typeof ALL_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ALL_KEYS) {
    originalValues[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ALL_KEYS) {
    if (originalValues[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValues[key];
    }
  }
});

// ── getAnthropicApiKey ──────────────────────────────────────────────────────────

describe('getAnthropicApiKey', () => {
  it('throws when unset', () => {
    expect(() => getAnthropicApiKey()).toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it('returns the key when set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    expect(getAnthropicApiKey()).toBe('sk-test-key');
  });
});

// ── getAnthropicModel ────────────────────────────────────────────────────────────

describe('getAnthropicModel', () => {
  it('defaults to claude-opus-4-8 when unset', () => {
    expect(getAnthropicModel()).toBe('claude-opus-4-8');
  });

  it('returns the configured model when set', () => {
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-5';
    expect(getAnthropicModel()).toBe('claude-sonnet-5');
  });
});

// ── getJwtSecret ─────────────────────────────────────────────────────────────────

describe('getJwtSecret', () => {
  it('throws when unset', () => {
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET is not set/);
  });

  it('throws when shorter than 32 characters', () => {
    process.env.JWT_SECRET = 'too-short';
    expect(() => getJwtSecret()).toThrow(/too short/);
  });

  it('returns a Uint8Array encoding of a valid secret', () => {
    const secret = 'a'.repeat(32);
    process.env.JWT_SECRET = secret;
    const result = getJwtSecret();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toBe(secret);
  });

  it('accepts exactly 32 characters (boundary)', () => {
    process.env.JWT_SECRET = 'x'.repeat(32);
    expect(() => getJwtSecret()).not.toThrow();
  });
});

// ── isOAuthConfigured / getOAuthConfig ────────────────────────────────────────────

describe('isOAuthConfigured', () => {
  it('is false when no OAuth env vars are set', () => {
    expect(isOAuthConfigured()).toBe(false);
  });

  it('is false when only some are set', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    expect(isOAuthConfigured()).toBe(false);
  });

  it('is true when all three are set', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'https://example.com';
    expect(isOAuthConfigured()).toBe(true);
  });
});

describe('getOAuthConfig', () => {
  it('throws when not configured', () => {
    expect(() => getOAuthConfig()).toThrow(/OAuth is not configured/);
  });

  it('returns the three values when fully configured', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'https://example.com';
    expect(getOAuthConfig()).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      redirectBaseUrl: 'https://example.com',
    });
  });
});

// ── _assertOAuthEnv ────────────────────────────────────────────────────────────

describe('_assertOAuthEnv', () => {
  it('does not throw when none of the three are set (OAuth disabled)', () => {
    expect(() => _assertOAuthEnv()).not.toThrow();
  });

  it('throws when only some are set (partial config)', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    expect(() => _assertOAuthEnv()).toThrow(/partially configured/);
  });

  it('does not throw for a valid, fully-configured https base URL', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'https://example.com';
    expect(() => _assertOAuthEnv()).not.toThrow();
  });

  it('throws when the base URL is not a valid absolute URL', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'not-a-url';
    expect(() => _assertOAuthEnv()).toThrow(/valid absolute URL/);
  });

  it('throws for a non-http(s) scheme', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'ftp://example.com';
    expect(() => _assertOAuthEnv()).toThrow(/http or https scheme/);
  });

  it('throws when the URL has a path/query/fragment', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'https://example.com/callback';
    expect(() => _assertOAuthEnv()).toThrow(/no path, query, or fragment/);
  });

  it('throws when the URL has a trailing slash', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    // A bare origin with a trailing slash parses with pathname '/', so it passes
    // the path/query/fragment check above and must be caught by the dedicated
    // trailing-slash check instead.
    process.env.OAUTH_REDIRECT_BASE_URL = 'https://example.com/';
    expect(() => _assertOAuthEnv()).toThrow(/trailing slash/);
  });

  it('allows http in non-production', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'http://localhost:3000';
    process.env.NODE_ENV = 'development';
    expect(() => _assertOAuthEnv()).not.toThrow();
  });

  it('rejects http in production', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'http://example.com';
    process.env.NODE_ENV = 'production';
    expect(() => _assertOAuthEnv()).toThrow(/must use https in production/);
  });

  it('allows https in production', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'https://example.com';
    process.env.NODE_ENV = 'production';
    expect(() => _assertOAuthEnv()).not.toThrow();
  });
});
