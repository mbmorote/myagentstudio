/**
 * app/api/auth/__tests__/oauth-start.test.ts
 *
 * Tests for POST /api/auth/oauth/[provider]/start (§10.3, §11 Phase 3 step 3.1).
 *
 * Mocking rule (§10.1): the provider registry (lib/auth/oauth/providers.ts) is the
 * THE SEAM. No test constructs a real Google provider, calls createRemoteJWKSet,
 * or sets a real GOOGLE_CLIENT_SECRET. The `getOAuthProvider` and
 * `isOAuthConfigured` functions are replaced by vi.fn() at module scope.
 *
 * Cases (§10.3):
 *   - mode:'signup' without a code → 400 invalid_body
 *   - unknown/redeemed code → 400 invalid_invite_code
 *   - cap reached → 403 signups_closed
 *   - unknown provider → 404 unknown_provider
 *   - unconfigured → 503 oauth_not_configured
 *   - rate limit trips → 429 rate_limited
 *   - success → 200 { authorizeUrl }:
 *       • state in authorizeUrl matches state in tx cookie
 *       • inviteCode does NOT appear anywhere in the returned authorizeUrl
 *       • tx cookie has HttpOnly, SameSite=Lax, Path=/api/auth/oauth, Max-Age=600
 *   - mode:'login' (no inviteCode) → success
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Replace DB client with in-memory test DB ──────────────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock the OAuth provider registry (THE SEAM — §10.1) ──────────────────────
// Must be hoisted before any import that reaches providers.ts
vi.mock('@/lib/auth/oauth/providers.js', () => ({
  getOAuthProvider: vi.fn(),
  listConfiguredProviders: vi.fn(() => ['google']),
}));

// ── Mock isOAuthConfigured from env.ts ────────────────────────────────────────
vi.mock('@/lib/env.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/env.js')>();
  return {
    ...original,
    isOAuthConfigured: vi.fn(() => true),
  };
});

// After mocks
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import * as schema from '../../../../lib/db/schema.js';
import { generateInviteCode } from '../../../../lib/auth/inviteCode.js';
import { getOAuthProvider } from '@/lib/auth/oauth/providers.js';
import { isOAuthConfigured } from '@/lib/env.js';
import { OAUTH_TX_COOKIE } from '../../../../lib/auth/constants.js';

import { POST } from '../oauth/[provider]/start/route.js';

// ── Type casts for mocked functions ─────────────────────────────────────────
const mockGetOAuthProvider = getOAuthProvider as ReturnType<typeof vi.fn>;
const mockIsOAuthConfigured = isOAuthConfigured as ReturnType<typeof vi.fn>;

// ── Fake provider (stateless — createAuthorizationUrl returns a deterministic URL) ──
const fakeProvider = {
  name: 'google',
  createAuthorizationUrl: vi.fn(({ state }: { state: string; codeVerifier: string; nonce: string }) =>
    new URL(`https://accounts.google.com/o/oauth2/auth?state=${state}&client_id=test-client`),
  ),
  exchangeAndVerify: vi.fn(),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

let ipCounter = 1;
function nextIp() { return `10.99.${Math.floor(ipCounter / 255)}.${ipCounter++ % 255}`; }

function makeStartRequest(body: object, ip: string, provider = 'google'): NextRequest {
  return new NextRequest(`http://localhost/api/auth/oauth/${provider}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function makeParams(provider = 'google') {
  return { params: Promise.resolve({ provider }) };
}

/** Inserts an unredeemed invite code and returns its value. */
function makeInviteCode(createdBy = '00000000-0000-4000-8000-00000000b007'): string {
  const code = generateInviteCode();
  testDb.insert(schema.inviteCode)
    .values({ code, note: null, createdBy, redeemedBy: null })
    .run();
  return code;
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
  }
  // Ensure maxUsers is high so we don't trip the cap in most tests
  testDb.insert(schema.setting)
    .values({ key: 'maxUsers', value: '1000' })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: '1000', updatedAt: new Date() } })
    .run();
});

beforeEach(() => {
  mockGetOAuthProvider.mockReturnValue(fakeProvider);
  mockIsOAuthConfigured.mockReturnValue(true);
  fakeProvider.createAuthorizationUrl.mockImplementation(
    ({ state }: { state: string; codeVerifier: string; nonce: string }) =>
      new URL(`https://accounts.google.com/o/oauth2/auth?state=${state}&client_id=test-client`),
  );
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/oauth/[provider]/start', () => {

  it('returns 503 oauth_not_configured when OAuth is not set up', async () => {
    mockIsOAuthConfigured.mockReturnValue(false);
    mockGetOAuthProvider.mockReturnValue(null);

    const res = await POST(
      makeStartRequest({ mode: 'login' }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('oauth_not_configured');
  });

  it('returns 404 unknown_provider for an unregistered provider name', async () => {
    mockGetOAuthProvider.mockReturnValue(null);

    const res = await POST(
      makeStartRequest({ mode: 'login' }, nextIp(), 'github'),
      makeParams('github'),
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unknown_provider');
  });

  it('returns 400 invalid_body when mode is missing', async () => {
    const res = await POST(
      makeStartRequest({ inviteCode: 'AAAA-AAAA-AAAA-AAAA' }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  it('returns 400 invalid_body when mode is invalid', async () => {
    const res = await POST(
      makeStartRequest({ mode: 'register' }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  it('returns 400 invalid_body for signup without an inviteCode', async () => {
    const res = await POST(
      makeStartRequest({ mode: 'signup' }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  it('returns 400 invalid_invite_code for a malformed invite code', async () => {
    const res = await POST(
      makeStartRequest({ mode: 'signup', inviteCode: 'not-a-valid-code' }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_invite_code');
  });

  it('returns 400 invalid_invite_code for an unknown (not in DB) invite code', async () => {
    const fakeCode = generateInviteCode(); // valid format but not inserted
    const res = await POST(
      makeStartRequest({ mode: 'signup', inviteCode: fakeCode }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_invite_code');
  });

  it('returns 400 invalid_invite_code for an already-redeemed code', async () => {
    // Insert a code and mark it redeemed directly
    const code = generateInviteCode();
    const adminId = '00000000-0000-4000-8000-00000000b007';
    const redeemedById = crypto.randomUUID();
    testDb.insert(schema.inviteCode)
      .values({ code, note: null, createdBy: adminId, redeemedBy: redeemedById })
      .run();

    const res = await POST(
      makeStartRequest({ mode: 'signup', inviteCode: code }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_invite_code');
  });

  it('returns 403 signups_closed when maxUsers is reached', async () => {
    const code = makeInviteCode();
    // Insert a sentinel user so there is at least one user in the DB.
    // getMaxUsers() floors at 1, so we need count >= 1 to actually hit the cap.
    const capUserId = crypto.randomUUID();
    testDb.insert(schema.user)
      .values({ id: capUserId, email: `cap-user-${capUserId}@test.com`, passwordHash: 'x', role: 'user', shareLogsWithAdmin: false })
      .run();
    // Set the cap to exactly the current count so the next signup is blocked
    const currentCount = testDb.select().from(schema.user).all().length;
    testDb.insert(schema.setting)
      .values({ key: 'maxUsers', value: String(currentCount) })
      .onConflictDoUpdate({ target: schema.setting.key, set: { value: String(currentCount), updatedAt: new Date() } })
      .run();

    const res = await POST(
      makeStartRequest({ mode: 'signup', inviteCode: code }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('signups_closed');

    // Restore maxUsers
    testDb.insert(schema.setting)
      .values({ key: 'maxUsers', value: '1000' })
      .onConflictDoUpdate({ target: schema.setting.key, set: { value: '1000', updatedAt: new Date() } })
      .run();
  });

  it('returns 429 rate_limited after too many attempts from the same IP', async () => {
    const ip = nextIp();
    // The rate limiter allows 10 attempts per window; the 11th triggers it
    let lastRes!: Response;
    for (let i = 0; i < 11; i++) {
      lastRes = await POST(
        makeStartRequest({ mode: 'login' }, ip),
        makeParams(),
      );
    }
    expect(lastRes.status).toBe(429);
    const body = await lastRes.json() as { error: string };
    expect(body.error).toBe('rate_limited');
  });

  it('success (mode:login) → 200 { authorizeUrl } + tx cookie', async () => {
    const res = await POST(
      makeStartRequest({ mode: 'login' }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { authorizeUrl: string };
    expect(typeof body.authorizeUrl).toBe('string');
    expect(body.authorizeUrl).toContain('accounts.google.com');

    // tx cookie must be set
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(OAUTH_TX_COOKIE + '=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie.toLowerCase()).toContain('path=/api/auth/oauth');
    expect(setCookie.toLowerCase()).toContain('max-age=600');
  });

  it('success (mode:signup) → state in authorizeUrl matches state in tx cookie', async () => {
    const code = makeInviteCode();
    const res = await POST(
      makeStartRequest({ mode: 'signup', inviteCode: code, shareLogsWithAdmin: true }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { authorizeUrl: string };
    const authorizeUrl = new URL(body.authorizeUrl);
    const stateInUrl = authorizeUrl.searchParams.get('state');
    expect(stateInUrl).toBeTruthy();

    // Decode the tx cookie and verify its state matches
    const setCookie = res.headers.get('set-cookie') ?? '';
    const match = setCookie.match(new RegExp(`${OAUTH_TX_COOKIE}=([^;]+)`));
    expect(match).toBeTruthy();
    const txValue = match![1];
    const tx = JSON.parse(Buffer.from(txValue, 'base64url').toString('utf-8')) as {
      state: string;
      inviteCode?: string;
    };

    expect(tx.state).toBe(stateInUrl);

    // Invariant 13: invite code must NOT appear anywhere in the returned authorizeUrl
    expect(body.authorizeUrl).not.toContain(code);
    expect(body.authorizeUrl).not.toContain(tx.inviteCode ?? code);
  });

  it('success (mode:login) — no inviteCode or consent sent to the provider URL', async () => {
    const res = await POST(
      makeStartRequest({ mode: 'login' }, nextIp()),
      makeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { authorizeUrl: string };
    // The authorizeUrl must not contain an invite code query param
    expect(body.authorizeUrl).not.toMatch(/invite/i);
  });
});
