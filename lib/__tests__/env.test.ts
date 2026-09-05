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
  isEmailConfigured,
  getResendApiKey,
  getEmailFrom,
  getAppBaseUrl,
  getEmailReplyTo,
  getAdminNotificationEmail,
  _assertEmailEnv,
} from '../env.js';

const OAUTH_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_REDIRECT_BASE_URL'] as const;
const EMAIL_KEYS = ['RESEND_API_KEY', 'EMAIL_FROM', 'APP_BASE_URL', 'EMAIL_REPLY_TO', 'ADMIN_NOTIFICATION_EMAIL'] as const;
const OTHER_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'JWT_SECRET', 'NODE_ENV'] as const;
const ALL_KEYS = [...OAUTH_KEYS, ...EMAIL_KEYS, ...OTHER_KEYS] as const;

const originalValues: Partial<Record<(typeof ALL_KEYS)[number], string | undefined>> = {};

/** process.env.NODE_ENV is typed read-only in recent @types/node; every other
 *  key here is writable. Cast locally so the generic key loop below (and the
 *  direct NODE_ENV assignments further down this file) work uniformly. */
function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>)[key];
  } else {
    (process.env as Record<string, string | undefined>)[key] = value;
  }
}

beforeEach(() => {
  for (const key of ALL_KEYS) {
    originalValues[key] = process.env[key];
    setEnv(key, undefined);
  }
});

afterEach(() => {
  for (const key of ALL_KEYS) {
    setEnv(key, originalValues[key]);
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
    setEnv('NODE_ENV', 'development');
    expect(() => _assertOAuthEnv()).not.toThrow();
  });

  it('rejects http in production', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'http://example.com';
    setEnv('NODE_ENV', 'production');
    expect(() => _assertOAuthEnv()).toThrow(/must use https in production/);
  });

  it('allows https in production', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.OAUTH_REDIRECT_BASE_URL = 'https://example.com';
    setEnv('NODE_ENV', 'production');
    expect(() => _assertOAuthEnv()).not.toThrow();
  });
});

// ── Email (Resend) — Plan 14 ──────────────────────────────────────────────────

describe('isEmailConfigured', () => {
  it('is false when no email env vars are set', () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it('is false when only some are set', () => {
    process.env.RESEND_API_KEY = 're_test';
    expect(isEmailConfigured()).toBe(false);
  });

  it('is true when all three required vars are set', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    process.env.APP_BASE_URL = 'https://myagentstudio.dev';
    expect(isEmailConfigured()).toBe(true);
  });
});

describe('getResendApiKey / getEmailFrom / getAppBaseUrl', () => {
  it('each throws when unset', () => {
    expect(() => getResendApiKey()).toThrow(/RESEND_API_KEY is not set/);
    expect(() => getEmailFrom()).toThrow(/EMAIL_FROM is not set/);
    expect(() => getAppBaseUrl()).toThrow(/APP_BASE_URL is not set/);
  });

  it('each returns the configured value when set', () => {
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    process.env.APP_BASE_URL = 'https://myagentstudio.dev';
    expect(getResendApiKey()).toBe('re_test_123');
    expect(getEmailFrom()).toBe('MyAgentStudio <noreply@myagentstudio.dev>');
    expect(getAppBaseUrl()).toBe('https://myagentstudio.dev');
  });
});

describe('getEmailReplyTo / getAdminNotificationEmail', () => {
  it('both return null when unset — never throw (optional)', () => {
    expect(getEmailReplyTo()).toBeNull();
    expect(getAdminNotificationEmail()).toBeNull();
  });

  it('both return the configured value when set', () => {
    process.env.EMAIL_REPLY_TO = 'support@myagentstudio.dev';
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@myagentstudio.dev';
    expect(getEmailReplyTo()).toBe('support@myagentstudio.dev');
    expect(getAdminNotificationEmail()).toBe('admin@myagentstudio.dev');
  });
});

describe('_assertEmailEnv', () => {
  it('does not throw when none of the three are set (email disabled)', () => {
    expect(() => _assertEmailEnv()).not.toThrow();
  });

  it('throws when only some are set (partial config)', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    expect(() => _assertEmailEnv()).toThrow(/partially configured/);
  });

  it('does not throw for a valid, fully-configured https APP_BASE_URL', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    process.env.APP_BASE_URL = 'https://myagentstudio.dev';
    expect(() => _assertEmailEnv()).not.toThrow();
  });

  it('throws when APP_BASE_URL is not a valid absolute URL', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    process.env.APP_BASE_URL = 'not-a-url';
    expect(() => _assertEmailEnv()).toThrow(/valid absolute URL/);
  });

  it('throws for a non-http(s) scheme', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    process.env.APP_BASE_URL = 'ftp://myagentstudio.dev';
    expect(() => _assertEmailEnv()).toThrow(/http or https scheme/);
  });

  it('throws when the URL has a path/query/fragment', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    process.env.APP_BASE_URL = 'https://myagentstudio.dev/app';
    expect(() => _assertEmailEnv()).toThrow(/no path, query, or fragment/);
  });

  it('throws when the URL has a trailing slash', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    process.env.APP_BASE_URL = 'https://myagentstudio.dev/';
    expect(() => _assertEmailEnv()).toThrow(/trailing slash/);
  });

  it('allows http in non-production', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    setEnv('NODE_ENV', 'development');
    expect(() => _assertEmailEnv()).not.toThrow();
  });

  it('rejects http in production', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    process.env.APP_BASE_URL = 'http://myagentstudio.dev';
    setEnv('NODE_ENV', 'production');
    expect(() => _assertEmailEnv()).toThrow(/must use https in production/);
  });

  it('allows https in production', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
    process.env.APP_BASE_URL = 'https://myagentstudio.dev';
    setEnv('NODE_ENV', 'production');
    expect(() => _assertEmailEnv()).not.toThrow();
  });
});
