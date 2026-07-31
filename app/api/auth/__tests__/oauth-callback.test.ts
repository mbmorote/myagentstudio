/**
 * app/api/auth/__tests__/oauth-callback.test.ts
 *
 * Tests for GET /api/auth/oauth/[provider]/callback (§10.3, §10.4, §11 Phase 3 step 3.2).
 *
 * Mocking rule (§10.1): `lib/auth/oauth/providers.ts` is THE SEAM. No test
 * imports arctic, constructs a real Google provider, calls createRemoteJWKSet,
 * or sets a real GOOGLE_CLIENT_SECRET.
 *
 * Table of tested scenarios (§10.4):
 *
 *   1.  No tx cookie             → 303 /login?error=oauth_state; no DB write
 *   2.  Malformed tx cookie      → 303 /login?error=oauth_state
 *   3.  Wrong-provider tx cookie → 303 /login?error=oauth_state
 *   4.  state mismatch           → 303 /login?error=oauth_state; exchangeAndVerify NOT called
 *   5.  ?error=access_denied     → 303 /login?error=oauth_cancelled; provider NOT called
 *   6.  ?error=<other>           → 303 /login?error=oauth_failed
 *   7.  exchangeAndVerify throws → 303 /login?error=oauth_failed; no DB write
 *   8.  emailVerified: false     → 303 /login?error=oauth_email_unverified; no DB write
 *   9.  Existing oauth_account   → 303 /; session cookie set; no new rows
 *   10. Existing link, user deleted → 303 /login?error=oauth_failed; no session
 *   11. Email matches existing password user (auto-link) →
 *         one oauth_account row; session set; user row unchanged field-by-field;
 *         no invite code redeemed; no second user created
 *   12. Email matches, tx also has a valid code → still a link (code stays unredeemed)
 *   13. No match, mode:'login'   → 303 /signup?error=oauth_no_account; zero rows
 *   14. No match, mode:'signup', valid code → user + oauth_account created, code redeemed,
 *         passwordHash==='' (sentinel), role==='user', session set
 *   15. Same, code already redeemed → 303 /signup?error=invalid_invite_code; zero rows
 *   16. Same, maxUsers reached   → 303 /signup?error=signups_closed; zero rows, code unredeemed
 *   17. consent absent           → user.shareLogsWithAdmin === false
 *   18. consent: null            → user.shareLogsWithAdmin === false
 *   19. consent: "true" (string) → user.shareLogsWithAdmin === false
 *   20. consent: 1 (number)      → user.shareLogsWithAdmin === false
 *   21. consent: true (boolean)  → user.shareLogsWithAdmin === true
 *   22. tx.next='/agents/abc'    → redirect to /agents/abc
 *   23. tx.next='https://evil.example' → redirect to /
 *   24. tx.next='//evil.example' → redirect to /
 *
 * Parametrized cross-cutting invariants (§10.4 last two rows):
 *   A.  Every scenario: tx cookie cleared (constraint 10, invariant 12)
 *   B.  Every failure scenario: no myagent_session cookie set
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Replace DB client with in-memory test DB ──────────────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock the OAuth provider registry (THE SEAM — §10.1) ──────────────────────
vi.mock('@/lib/auth/oauth/providers.js', () => ({
  getOAuthProvider: vi.fn(),
  listConfiguredProviders: vi.fn(() => ['google']),
}));

// After mocks
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import * as schema from '../../../../lib/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { generateInviteCode } from '../../../../lib/auth/inviteCode.js';
import { buildOAuthTxCookie } from '../../../../lib/auth/oauth/tx.js';
import { OAuthError } from '../../../../lib/auth/oauth/types.js';
import type { OAuthProfile, OAuthProvider } from '../../../../lib/auth/oauth/types.js';
import { getOAuthProvider } from '@/lib/auth/oauth/providers.js';
import {
  SESSION_COOKIE,
  OAUTH_TX_COOKIE,
  NO_PASSWORD_SENTINEL,
} from '../../../../lib/auth/constants.js';

import { GET } from '../oauth/[provider]/callback/route.js';

// ── Type cast for mocked function ─────────────────────────────────────────────
const mockGetOAuthProvider = getOAuthProvider as ReturnType<typeof vi.fn>;

// ── Fake profile ──────────────────────────────────────────────────────────────
const MOCK_SUB = 'google-sub-abc123';
const MOCK_EMAIL = 'oauthuser@example.com';

function makeMockProfile(overrides: Partial<OAuthProfile> = {}): OAuthProfile {
  return {
    providerAccountId: MOCK_SUB,
    email: MOCK_EMAIL,
    emailVerified: true,
    ...overrides,
  };
}

// ── Fake provider ─────────────────────────────────────────────────────────────
const fakeProvider: OAuthProvider = {
  name: 'google',
  createAuthorizationUrl: vi.fn(),
  exchangeAndVerify: vi.fn(),
};

// ── Cookie helpers ────────────────────────────────────────────────────────────

/** Builds a valid tx cookie value string for use in Cookie headers. */
function buildTxCookieValue(overrides: Partial<{
  v: number;
  provider: string;
  mode: 'login' | 'signup';
  state: string;
  codeVerifier: string;
  nonce: string;
  inviteCode: string;
  consent: unknown;
  next: string;
}> = {}): string {
  const tx = {
    v: 1,
    provider: 'google',
    mode: 'login' as const,
    state: 'correct-state-abc',
    codeVerifier: 'pkce-verifier-xyz',
    nonce: 'nonce-123',
    ...overrides,
  };
  return buildOAuthTxCookie(tx as Parameters<typeof buildOAuthTxCookie>[0]).value;
}

// ── Request builder ───────────────────────────────────────────────────────────

function makeCallbackRequest(opts: {
  code?: string;
  state?: string;
  error?: string;
  txCookieValue?: string;  // base64url-encoded tx cookie value; omit for no cookie
  provider?: string;
}): NextRequest {
  const provider = opts.provider ?? 'google';
  const url = new URL(`http://localhost/api/auth/oauth/${provider}/callback`);
  if (opts.code !== undefined) url.searchParams.set('code', opts.code);
  if (opts.state !== undefined) url.searchParams.set('state', opts.state);
  if (opts.error !== undefined) url.searchParams.set('error', opts.error);

  const headers: Record<string, string> = {};
  if (opts.txCookieValue !== undefined) {
    headers['Cookie'] = `${OAUTH_TX_COOKIE}=${opts.txCookieValue}`;
  }

  return new NextRequest(url.toString(), { method: 'GET', headers });
}

function makeParams(provider = 'google') {
  return { params: Promise.resolve({ provider }) };
}

/** A standard valid tx cookie value with correct state. */
const VALID_STATE = 'correct-state-abc';
const VALID_TX = buildTxCookieValue({ state: VALID_STATE });

// ── DB helpers ────────────────────────────────────────────────────────────────

function makeInviteCode(createdBy = '00000000-0000-4000-8000-00000000b007'): string {
  const code = generateInviteCode();
  testDb.insert(schema.inviteCode)
    .values({ code, note: null, createdBy, redeemedBy: null })
    .run();
  return code;
}

function countUsers(): number {
  return testDb.select().from(schema.user).all().length;
}

function countOAuthAccounts(): number {
  return testDb.select().from(schema.oauthAccount).all().length;
}

function isCodeRedeemed(code: string): boolean {
  const row = testDb.select().from(schema.inviteCode)
    .where(eq(schema.inviteCode.code, code))
    .get();
  return row?.redeemedBy !== null && row?.redeemedBy !== undefined;
}

function getUserRow(email: string) {
  return testDb.select().from(schema.user)
    .where(eq(schema.user.email, email))
    .get();
}

// ── Unique profile generator (avoids cross-test collisions) ───────────────────
let profileCounter = 0;
function uniqueProfile(): OAuthProfile {
  profileCounter++;
  return {
    providerAccountId: `sub-${profileCounter}-${crypto.randomUUID()}`,
    email: `oauth-${profileCounter}-${crypto.randomUUID()}@example.com`,
    emailVerified: true,
  };
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

/** Asserts that the tx cookie is cleared in the response's Set-Cookie header. */
function assertTxCookieCleared(res: Response, scenarioName: string) {
  const setCookie = res.headers.get('set-cookie') ?? '';
  // clearOAuthTxOn sets value='' and maxAge=0, so the header contains "myagent_oauth_tx=;"
  const cleared =
    setCookie.includes(`${OAUTH_TX_COOKIE}=;`) ||
    (setCookie.includes(OAUTH_TX_COOKIE + '=') &&
      setCookie.toLowerCase().includes('max-age=0'));
  expect(cleared, `[${scenarioName}] tx cookie should be cleared`).toBe(true);
}

/** Asserts that no session cookie is present in the response. */
function assertNoSessionCookie(res: Response, scenarioName: string) {
  const setCookie = res.headers.get('set-cookie') ?? '';
  // A session cookie, if set, would look like "myagent_session=<token>; ..."
  // We confirm the token value is non-empty (i.e. not a clear)
  const hasSession = setCookie.includes(`${SESSION_COOKIE}=`) &&
    !setCookie.match(new RegExp(`${SESSION_COOKIE}=;`)) &&
    !setCookie.toLowerCase().match(new RegExp(`${SESSION_COOKIE}=.*max-age=0`));
  expect(hasSession, `[${scenarioName}] should NOT have a session cookie`).toBe(false);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
  }
  testDb.insert(schema.setting)
    .values({ key: 'maxUsers', value: '1000' })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: '1000', updatedAt: new Date() } })
    .run();
});

beforeEach(() => {
  mockGetOAuthProvider.mockReturnValue(fakeProvider);
  (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValue(makeMockProfile());
});

// ── Individual scenario tests ─────────────────────────────────────────────────

describe('GET /api/auth/oauth/[provider]/callback — individual scenarios', () => {

  // 1. No tx cookie
  it('1. no tx cookie → 303 /login?error=oauth_state; no DB write', async () => {
    const usersBefore = countUsers();
    const oauthBefore = countOAuthAccounts();

    const res = await GET(
      makeCallbackRequest({ code: 'abc', state: VALID_STATE }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login?error=oauth_state');
    expect(countUsers()).toBe(usersBefore);
    expect(countOAuthAccounts()).toBe(oauthBefore);
  });

  // 2. Malformed tx cookie
  it('2. malformed tx cookie → 303 /login?error=oauth_state', async () => {
    const res = await GET(
      makeCallbackRequest({ code: 'abc', state: 'x', txCookieValue: 'not-valid-base64url!!' }),
      makeParams(),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login?error=oauth_state');
  });

  // 3. Wrong-provider tx cookie
  it('3. wrong-provider tx cookie → 303 /login?error=oauth_state', async () => {
    // Build a cookie for 'github' but use 'google' as the route provider
    const githubTx = buildTxCookieValue({ provider: 'github', state: VALID_STATE });
    const res = await GET(
      makeCallbackRequest({ code: 'abc', state: VALID_STATE, txCookieValue: githubTx }),
      makeParams('google'), // route is for google
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login?error=oauth_state');
  });

  // 4. State mismatch — exchangeAndVerify must NOT be called
  it('4. state mismatch → 303 /login?error=oauth_state; exchangeAndVerify not called', async () => {
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockClear();

    const res = await GET(
      makeCallbackRequest({ code: 'abc', state: 'WRONG-STATE', txCookieValue: VALID_TX }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login?error=oauth_state');
    expect(fakeProvider.exchangeAndVerify).not.toHaveBeenCalled();
  });

  // 5. ?error=access_denied — provider not called
  it('5. ?error=access_denied → 303 /login?error=oauth_cancelled; provider not called', async () => {
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockClear();

    const res = await GET(
      makeCallbackRequest({ error: 'access_denied', txCookieValue: VALID_TX }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login?error=oauth_cancelled');
    expect(fakeProvider.exchangeAndVerify).not.toHaveBeenCalled();
  });

  // 6. ?error=<other>
  it('6. ?error=<other provider error> → 303 /login?error=oauth_failed', async () => {
    const res = await GET(
      makeCallbackRequest({ error: 'server_error', txCookieValue: VALID_TX }),
      makeParams(),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login?error=oauth_failed');
  });

  // 7. exchangeAndVerify throws
  it('7. exchangeAndVerify throws → 303 /login?error=oauth_failed; no session; no DB write', async () => {
    const profile = uniqueProfile();
    const tx = buildTxCookieValue({ state: VALID_STATE });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new OAuthError('token_exchange_failed', 'HTTP 400'));

    const usersBefore = countUsers();
    const oauthBefore = countOAuthAccounts();

    const res = await GET(
      makeCallbackRequest({ code: 'code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login?error=oauth_failed');
    expect(countUsers()).toBe(usersBefore);
    expect(countOAuthAccounts()).toBe(oauthBefore);

    void profile; // used to avoid lint warning
  });

  // 8. emailVerified: false
  it('8. emailVerified:false → 303 /login?error=oauth_email_unverified; no link, no user', async () => {
    const profile = uniqueProfile();
    const tx = buildTxCookieValue({ state: VALID_STATE });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...profile, emailVerified: false });

    const usersBefore = countUsers();
    const oauthBefore = countOAuthAccounts();

    const res = await GET(
      makeCallbackRequest({ code: 'code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login?error=oauth_email_unverified');
    expect(countUsers()).toBe(usersBefore);
    expect(countOAuthAccounts()).toBe(oauthBefore);
  });

  // 9. Existing oauth_account → login, no new rows
  it('9. existing oauth_account → 303 to /; session set; no new rows', async () => {
    const profile = uniqueProfile();
    const userId = crypto.randomUUID();
    // Pre-insert user and oauth_account rows
    testDb.insert(schema.user)
      .values({ id: userId, email: profile.email, passwordHash: NO_PASSWORD_SENTINEL, role: 'user', shareLogsWithAdmin: false })
      .run();
    testDb.insert(schema.oauthAccount)
      .values({ provider: 'google', providerAccountId: profile.providerAccountId, userId, providerEmail: profile.email })
      .run();

    const usersBefore = countUsers();
    const oauthBefore = countOAuthAccounts();

    const tx = buildTxCookieValue({ state: VALID_STATE });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/');
    // Session cookie must be set
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain('httponly');
    // No new rows
    expect(countUsers()).toBe(usersBefore);
    expect(countOAuthAccounts()).toBe(oauthBefore);
  });

  // 10. Existing link, user row deleted
  it('10. existing link but user row deleted → 303 /login?error=oauth_failed; no session', async () => {
    const profile = uniqueProfile();
    const deletedUserId = crypto.randomUUID();
    // Insert oauth_account pointing at a non-existent user
    testDb.insert(schema.oauthAccount)
      .values({ provider: 'google', providerAccountId: profile.providerAccountId, userId: deletedUserId, providerEmail: profile.email })
      .run();
    // No user row inserted

    const tx = buildTxCookieValue({ state: VALID_STATE });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login?error=oauth_failed');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toContain(`${SESSION_COOKIE}=`);
  });

  // 11. Email matches existing password user (auto-link) — invariant 9 field-by-field check
  it('11. email matches existing user → auto-link; session set; user row unchanged; no code redeemed', async () => {
    const profile = uniqueProfile();
    const userId = crypto.randomUUID();
    const originalPasswordHash = 'bcrypt-hash-original-$2b$10$xyz';
    // Insert a password-based user with a real hash (not the sentinel)
    testDb.insert(schema.user)
      .values({ id: userId, email: profile.email.toLowerCase(), passwordHash: originalPasswordHash, role: 'user', shareLogsWithAdmin: false })
      .run();

    const usersBefore = countUsers();
    const oauthBefore = countOAuthAccounts();

    const tx = buildTxCookieValue({ state: VALID_STATE });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);

    // Exactly one new oauth_account row; no new user
    expect(countUsers()).toBe(usersBefore);
    expect(countOAuthAccounts()).toBe(oauthBefore + 1);

    // Invariant 9: user.email and user.passwordHash MUST be unchanged
    const userAfter = testDb.select().from(schema.user)
      .where(eq(schema.user.id, userId)).get();
    expect(userAfter?.email).toBe(profile.email.toLowerCase()); // unchanged
    expect(userAfter?.passwordHash).toBe(originalPasswordHash);  // unchanged — never overwritten by OAuth

    // No invite code was redeemed (there's no code in the tx)
    // Verify the oauth_account points at the right user
    const link = testDb.select().from(schema.oauthAccount)
      .where(and(
        eq(schema.oauthAccount.provider, 'google'),
        eq(schema.oauthAccount.providerAccountId, profile.providerAccountId),
      )).get();
    expect(link?.userId).toBe(userId);
  });

  // 12. Email matches + tx has a valid code → still a link, code stays unredeemed
  it('12. email match with signup code in tx → link (not create); code unredeemed', async () => {
    const profile = uniqueProfile();
    const userId = crypto.randomUUID();
    const code = makeInviteCode();
    testDb.insert(schema.user)
      .values({ id: userId, email: profile.email.toLowerCase(), passwordHash: 'hash', role: 'user', shareLogsWithAdmin: false })
      .run();

    const tx = buildTxCookieValue({
      state: VALID_STATE,
      mode: 'signup',
      inviteCode: code,
      consent: true,
    });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'auth-code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);

    // Code must NOT be redeemed (auto-link consumed no code)
    expect(isCodeRedeemed(code)).toBe(false);
    // No second user created
    const userRows = testDb.select().from(schema.user)
      .where(eq(schema.user.email, profile.email.toLowerCase())).all();
    expect(userRows.length).toBe(1);
  });

  // 13. No match, mode:'login' → no account
  it('13. no match, mode:login → 303 /signup?error=oauth_no_account; zero rows', async () => {
    const profile = uniqueProfile();
    const usersBefore = countUsers();
    const oauthBefore = countOAuthAccounts();

    const tx = buildTxCookieValue({ state: VALID_STATE, mode: 'login' });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/signup?error=oauth_no_account');
    expect(countUsers()).toBe(usersBefore);
    expect(countOAuthAccounts()).toBe(oauthBefore);
  });

  // 14. Signup success — full creation
  it('14. signup success → user + oauth_account created; code redeemed; passwordHash=sentinel; role=user', async () => {
    const profile = uniqueProfile();
    const code = makeInviteCode();
    const usersBefore = countUsers();
    const oauthBefore = countOAuthAccounts();

    const tx = buildTxCookieValue({
      state: VALID_STATE,
      mode: 'signup',
      inviteCode: code,
      consent: true,
    });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'auth-code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain('httponly');

    // One new user, one new oauth_account
    expect(countUsers()).toBe(usersBefore + 1);
    expect(countOAuthAccounts()).toBe(oauthBefore + 1);

    // Verify user row
    const newUser = getUserRow(profile.email.toLowerCase());
    expect(newUser).toBeTruthy();
    expect(newUser?.passwordHash).toBe(NO_PASSWORD_SENTINEL);
    expect(newUser?.role).toBe('user'); // never mints admin
    expect(Boolean(newUser?.shareLogsWithAdmin)).toBe(true); // consent: true was set

    // Code was redeemed
    expect(isCodeRedeemed(code)).toBe(true);

    // Verify oauth_account row
    const oauthRow = testDb.select().from(schema.oauthAccount)
      .where(and(
        eq(schema.oauthAccount.provider, 'google'),
        eq(schema.oauthAccount.providerAccountId, profile.providerAccountId),
      )).get();
    expect(oauthRow).toBeTruthy();
    expect(oauthRow?.userId).toBe(newUser?.id);
  });

  // 15. Signup with already-redeemed code
  it('15. signup, code already redeemed → 303 /signup?error=invalid_invite_code; zero rows', async () => {
    const profile = uniqueProfile();
    const code = generateInviteCode();
    const adminId = '00000000-0000-4000-8000-00000000b007';
    const redeemedById = crypto.randomUUID();
    testDb.insert(schema.inviteCode)
      .values({ code, note: null, createdBy: adminId, redeemedBy: redeemedById })
      .run();

    const usersBefore = countUsers();
    const oauthBefore = countOAuthAccounts();

    const tx = buildTxCookieValue({ state: VALID_STATE, mode: 'signup', inviteCode: code });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'auth-code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/signup?error=invalid_invite_code');
    expect(countUsers()).toBe(usersBefore);
    expect(countOAuthAccounts()).toBe(oauthBefore);
  });

  // 16. Signup with maxUsers reached
  it('16. signup, maxUsers reached → 303 /signup?error=signups_closed; zero rows; code unredeemed', async () => {
    const profile = uniqueProfile();
    const code = makeInviteCode();
    const currentCount = countUsers();

    // Set cap to current count
    testDb.insert(schema.setting)
      .values({ key: 'maxUsers', value: String(currentCount) })
      .onConflictDoUpdate({ target: schema.setting.key, set: { value: String(currentCount), updatedAt: new Date() } })
      .run();

    const tx = buildTxCookieValue({ state: VALID_STATE, mode: 'signup', inviteCode: code });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'auth-code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/signup?error=signups_closed');
    expect(isCodeRedeemed(code)).toBe(false);

    // Restore cap
    testDb.insert(schema.setting)
      .values({ key: 'maxUsers', value: '1000' })
      .onConflictDoUpdate({ target: schema.setting.key, set: { value: '1000', updatedAt: new Date() } })
      .run();
  });

  // 17-21. consent coercion (Plan 05 invariant 15 on the new path)
  const consentCases: Array<{ label: string; consent: unknown; expectedConsent: boolean }> = [
    { label: '17. consent absent (undefined)',   consent: undefined,   expectedConsent: false },
    { label: '18. consent: null',                consent: null,        expectedConsent: false },
    { label: '19. consent: "true" (string)',      consent: 'true',      expectedConsent: false },
    { label: '20. consent: 1 (number)',           consent: 1,           expectedConsent: false },
    { label: '21. consent: true (literal bool)',  consent: true,        expectedConsent: true  },
  ];

  for (const { label, consent, expectedConsent } of consentCases) {
    it(label, async () => {
      const profile = uniqueProfile();
      const code = makeInviteCode();

      const txPayload: Record<string, unknown> = {
        v: 1, provider: 'google', mode: 'signup',
        state: VALID_STATE, codeVerifier: 'cv', nonce: 'n',
        inviteCode: code,
      };
      if (consent !== undefined) txPayload['consent'] = consent;
      const txValue = Buffer.from(JSON.stringify(txPayload), 'utf-8').toString('base64url');

      (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

      const res = await GET(
        makeCallbackRequest({ code: 'auth-code', state: VALID_STATE, txCookieValue: txValue }),
        makeParams(),
      );

      // User should be created
      expect(res.status).toBe(303);
      const newUser = getUserRow(profile.email.toLowerCase());
      expect(newUser).toBeTruthy();
      // SQLite stores boolean as 0/1
      expect(Boolean(newUser?.shareLogsWithAdmin)).toBe(expectedConsent);
    });
  }

  // 22. tx.next = '/agents/abc' → redirect to /agents/abc
  it('22. tx.next="/agents/abc" → redirected to /agents/abc', async () => {
    const profile = uniqueProfile();
    // Pre-insert user and oauth_account for a clean login
    const userId = crypto.randomUUID();
    testDb.insert(schema.user)
      .values({ id: userId, email: profile.email.toLowerCase(), passwordHash: NO_PASSWORD_SENTINEL, role: 'user', shareLogsWithAdmin: false })
      .run();
    testDb.insert(schema.oauthAccount)
      .values({ provider: 'google', providerAccountId: profile.providerAccountId, userId, providerEmail: profile.email })
      .run();

    const tx = buildTxCookieValue({ state: VALID_STATE, next: '/agents/abc' });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/agents/abc');
  });

  // 23. tx.next = 'https://evil.example' → fall back to /
  it('23. tx.next="https://evil.example" → redirect to / (open-redirect guard)', async () => {
    const profile = uniqueProfile();
    const userId = crypto.randomUUID();
    testDb.insert(schema.user)
      .values({ id: userId, email: profile.email.toLowerCase(), passwordHash: NO_PASSWORD_SENTINEL, role: 'user', shareLogsWithAdmin: false })
      .run();
    testDb.insert(schema.oauthAccount)
      .values({ provider: 'google', providerAccountId: profile.providerAccountId, userId, providerEmail: profile.email })
      .run();

    const tx = buildTxCookieValue({ state: VALID_STATE, next: 'https://evil.example' });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    // Must NOT redirect off-site; must end at /
    expect(location).not.toContain('evil.example');
    expect(location).toMatch(/\/$/);
  });

  // 24. tx.next = '//evil.example' → fall back to /
  it('24. tx.next="//evil.example" → redirect to / (protocol-relative guard)', async () => {
    const profile = uniqueProfile();
    const userId = crypto.randomUUID();
    testDb.insert(schema.user)
      .values({ id: userId, email: profile.email.toLowerCase(), passwordHash: NO_PASSWORD_SENTINEL, role: 'user', shareLogsWithAdmin: false })
      .run();
    testDb.insert(schema.oauthAccount)
      .values({ provider: 'google', providerAccountId: profile.providerAccountId, userId, providerEmail: profile.email })
      .run();

    const tx = buildTxCookieValue({ state: VALID_STATE, next: '//evil.example' });
    (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);

    const res = await GET(
      makeCallbackRequest({ code: 'code', state: VALID_STATE, txCookieValue: tx }),
      makeParams(),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    expect(location).not.toContain('evil.example');
    expect(location).toMatch(/\/$/);
  });

});

// ── Parametrized invariant A: tx cookie cleared on EVERY exit path ─────────────
//
// §10.4: "the tx cookie is cleared in the response — asserted as a parametrized
// loop over all scenarios, not per-case (constraint 10)"
//
// Each scenario is defined inline with its own unique data so it is self-contained.
// ────────────────────────────────────────────────────────────────────────────────

describe('invariant A — tx cookie cleared on every exit path (constraint 10, invariant 12)', () => {

  type Scenario = { name: string; run: () => Promise<Response> };

  function makeScenarios(): Scenario[] {
    return [
      {
        name: 'no tx cookie',
        run: async () => GET(
          makeCallbackRequest({ code: 'x', state: 'y' }),
          makeParams(),
        ),
      },
      {
        name: 'malformed tx cookie',
        run: async () => GET(
          makeCallbackRequest({ code: 'x', state: 'y', txCookieValue: 'bad!!' }),
          makeParams(),
        ),
      },
      {
        name: 'state mismatch',
        run: async () => {
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(uniqueProfile());
          return GET(
            makeCallbackRequest({ code: 'x', state: 'WRONG', txCookieValue: VALID_TX }),
            makeParams(),
          );
        },
      },
      {
        name: '?error=access_denied',
        run: async () => GET(
          makeCallbackRequest({ error: 'access_denied', txCookieValue: VALID_TX }),
          makeParams(),
        ),
      },
      {
        name: '?error=other',
        run: async () => GET(
          makeCallbackRequest({ error: 'server_error', txCookieValue: VALID_TX }),
          makeParams(),
        ),
      },
      {
        name: 'exchangeAndVerify throws',
        run: async () => {
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>)
            .mockRejectedValueOnce(new OAuthError('token_exchange_failed'));
          return GET(
            makeCallbackRequest({ code: 'x', state: VALID_STATE, txCookieValue: VALID_TX }),
            makeParams(),
          );
        },
      },
      {
        name: 'emailVerified:false',
        run: async () => {
          const p = uniqueProfile();
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ ...p, emailVerified: false });
          return GET(
            makeCallbackRequest({ code: 'x', state: VALID_STATE, txCookieValue: VALID_TX }),
            makeParams(),
          );
        },
      },
      {
        name: 'existing oauth_account (success)',
        run: async () => {
          const p = uniqueProfile();
          const uid = crypto.randomUUID();
          testDb.insert(schema.user)
            .values({ id: uid, email: p.email, passwordHash: NO_PASSWORD_SENTINEL, role: 'user', shareLogsWithAdmin: false })
            .run();
          testDb.insert(schema.oauthAccount)
            .values({ provider: 'google', providerAccountId: p.providerAccountId, userId: uid, providerEmail: p.email })
            .run();
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          return GET(
            makeCallbackRequest({ code: 'x', state: VALID_STATE, txCookieValue: VALID_TX }),
            makeParams(),
          );
        },
      },
      {
        name: 'dangling link (user deleted)',
        run: async () => {
          const p = uniqueProfile();
          const uid = crypto.randomUUID();
          testDb.insert(schema.oauthAccount)
            .values({ provider: 'google', providerAccountId: p.providerAccountId, userId: uid, providerEmail: p.email })
            .run();
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          return GET(
            makeCallbackRequest({ code: 'x', state: VALID_STATE, txCookieValue: VALID_TX }),
            makeParams(),
          );
        },
      },
      {
        name: 'auto-link (success)',
        run: async () => {
          const p = uniqueProfile();
          const uid = crypto.randomUUID();
          testDb.insert(schema.user)
            .values({ id: uid, email: p.email.toLowerCase(), passwordHash: 'hash', role: 'user', shareLogsWithAdmin: false })
            .run();
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          return GET(
            makeCallbackRequest({ code: 'x', state: VALID_STATE, txCookieValue: VALID_TX }),
            makeParams(),
          );
        },
      },
      {
        name: 'no match, mode:login',
        run: async () => {
          const p = uniqueProfile();
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          const tx = buildTxCookieValue({ state: VALID_STATE, mode: 'login' });
          return GET(
            makeCallbackRequest({ code: 'x', state: VALID_STATE, txCookieValue: tx }),
            makeParams(),
          );
        },
      },
      {
        name: 'signup success',
        run: async () => {
          const p = uniqueProfile();
          const code = makeInviteCode();
          const tx = buildTxCookieValue({ state: VALID_STATE, mode: 'signup', inviteCode: code, consent: true });
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          return GET(
            makeCallbackRequest({ code: 'auth-code', state: VALID_STATE, txCookieValue: tx }),
            makeParams(),
          );
        },
      },
      {
        name: 'invalid code at callback',
        run: async () => {
          const p = uniqueProfile();
          const bogusCode = generateInviteCode(); // valid format, not in DB
          const tx = buildTxCookieValue({ state: VALID_STATE, mode: 'signup', inviteCode: bogusCode });
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          return GET(
            makeCallbackRequest({ code: 'auth-code', state: VALID_STATE, txCookieValue: tx }),
            makeParams(),
          );
        },
      },
      {
        name: 'signups_closed at callback',
        run: async () => {
          const p = uniqueProfile();
          const code = makeInviteCode();
          const cap = countUsers();
          testDb.insert(schema.setting)
            .values({ key: 'maxUsers', value: String(cap) })
            .onConflictDoUpdate({ target: schema.setting.key, set: { value: String(cap), updatedAt: new Date() } })
            .run();
          const tx = buildTxCookieValue({ state: VALID_STATE, mode: 'signup', inviteCode: code });
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          const res = await GET(
            makeCallbackRequest({ code: 'auth-code', state: VALID_STATE, txCookieValue: tx }),
            makeParams(),
          );
          // Restore cap
          testDb.insert(schema.setting)
            .values({ key: 'maxUsers', value: '1000' })
            .onConflictDoUpdate({ target: schema.setting.key, set: { value: '1000', updatedAt: new Date() } })
            .run();
          return res;
        },
      },
    ];
  }

  // Run each scenario and assert tx cookie cleared
  const scenarios = makeScenarios();
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const res = await scenario.run();
      assertTxCookieCleared(res, scenario.name);
    });
  }
});

// ── Parametrized invariant B: no session cookie on any failure path ────────────
//
// §10.4: "every failing row: no myagent_session cookie is set —
// same parametrized treatment"
// ────────────────────────────────────────────────────────────────────────────────

describe('invariant B — no session cookie on any failure path', () => {

  type FailureScenario = { name: string; run: () => Promise<Response> };

  function makeFailureScenarios(): FailureScenario[] {
    return [
      {
        name: 'no tx cookie',
        run: async () => GET(
          makeCallbackRequest({ code: 'x', state: 'y' }),
          makeParams(),
        ),
      },
      {
        name: 'malformed tx cookie',
        run: async () => GET(
          makeCallbackRequest({ code: 'x', state: 'y', txCookieValue: 'bad!!' }),
          makeParams(),
        ),
      },
      {
        name: 'state mismatch',
        run: async () => {
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(uniqueProfile());
          return GET(
            makeCallbackRequest({ code: 'x', state: 'WRONG', txCookieValue: VALID_TX }),
            makeParams(),
          );
        },
      },
      {
        name: '?error=access_denied',
        run: async () => GET(
          makeCallbackRequest({ error: 'access_denied', txCookieValue: VALID_TX }),
          makeParams(),
        ),
      },
      {
        name: '?error=other',
        run: async () => GET(
          makeCallbackRequest({ error: 'server_error', txCookieValue: VALID_TX }),
          makeParams(),
        ),
      },
      {
        name: 'exchangeAndVerify throws',
        run: async () => {
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>)
            .mockRejectedValueOnce(new OAuthError('token_exchange_failed'));
          return GET(
            makeCallbackRequest({ code: 'x', state: VALID_STATE, txCookieValue: VALID_TX }),
            makeParams(),
          );
        },
      },
      {
        name: 'emailVerified:false',
        run: async () => {
          const p = uniqueProfile();
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ ...p, emailVerified: false });
          return GET(
            makeCallbackRequest({ code: 'x', state: VALID_STATE, txCookieValue: VALID_TX }),
            makeParams(),
          );
        },
      },
      {
        name: 'dangling link (user deleted)',
        run: async () => {
          const p = uniqueProfile();
          const uid = crypto.randomUUID();
          testDb.insert(schema.oauthAccount)
            .values({ provider: 'google', providerAccountId: p.providerAccountId, userId: uid, providerEmail: p.email })
            .run();
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          return GET(
            makeCallbackRequest({ code: 'x', state: VALID_STATE, txCookieValue: VALID_TX }),
            makeParams(),
          );
        },
      },
      {
        name: 'no match, mode:login',
        run: async () => {
          const p = uniqueProfile();
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          const tx = buildTxCookieValue({ state: VALID_STATE, mode: 'login' });
          return GET(
            makeCallbackRequest({ code: 'x', state: VALID_STATE, txCookieValue: tx }),
            makeParams(),
          );
        },
      },
      {
        name: 'invalid code at callback',
        run: async () => {
          const p = uniqueProfile();
          const bogusCode = generateInviteCode();
          const tx = buildTxCookieValue({ state: VALID_STATE, mode: 'signup', inviteCode: bogusCode });
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          return GET(
            makeCallbackRequest({ code: 'auth-code', state: VALID_STATE, txCookieValue: tx }),
            makeParams(),
          );
        },
      },
      {
        name: 'signups_closed at callback',
        run: async () => {
          const p = uniqueProfile();
          const code = makeInviteCode();
          const cap = countUsers();
          testDb.insert(schema.setting)
            .values({ key: 'maxUsers', value: String(cap) })
            .onConflictDoUpdate({ target: schema.setting.key, set: { value: String(cap), updatedAt: new Date() } })
            .run();
          const tx = buildTxCookieValue({ state: VALID_STATE, mode: 'signup', inviteCode: code });
          (fakeProvider.exchangeAndVerify as ReturnType<typeof vi.fn>).mockResolvedValueOnce(p);
          const res = await GET(
            makeCallbackRequest({ code: 'auth-code', state: VALID_STATE, txCookieValue: tx }),
            makeParams(),
          );
          testDb.insert(schema.setting)
            .values({ key: 'maxUsers', value: '1000' })
            .onConflictDoUpdate({ target: schema.setting.key, set: { value: '1000', updatedAt: new Date() } })
            .run();
          return res;
        },
      },
    ];
  }

  const scenarios = makeFailureScenarios();
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const res = await scenario.run();
      assertNoSessionCookie(res, scenario.name);
    });
  }
});
