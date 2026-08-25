/**
 * app/api/auth/__tests__/auth.test.ts
 *
 * Tests for the three auth route handlers (§10.3).
 *
 * Cases:
 *   login:
 *     - ok → 200, Set-Cookie with HttpOnly and SameSite=Lax
 *     - wrong password → 401 invalid_credentials
 *     - unknown email → 401 invalid_credentials
 *     - sentinel-hash user → 401 invalid_credentials
 *
 *   signup:
 *     - ok → 201, Set-Cookie
 *     - bad/already-redeemed invite code → 400 invalid_invite_code
 *     - cap reached → 403 signups_closed
 *     - duplicate email → 409 email_exists
 *     - weak password (< 12 chars) → 400 weak_password
 *     - over-long password (> 72 bytes) → 400 password_too_long
 *     - shareLogsWithAdmin: absent / null / "false" / 0 → user.shareLogsWithAdmin === true
 *       (sharing is the default since 2026-08-18; only a literal `false` opts out)
 *     - shareLogsWithAdmin: false → user.shareLogsWithAdmin === false
 *     - shareLogsWithAdmin: true → user.shareLogsWithAdmin === true
 *
 *   logout:
 *     - returns 204 and clears the cookie (even with no session)
 *
 *   rate limiter:
 *     - 21st attempt from the same (route, IP) → 429 rate_limited
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Replace DB client with in-memory test DB ──────────────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// After mock
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import * as schema from '../../../../lib/db/schema.js';
import { createTestUser } from '../../../../lib/db/__tests__/test-users.js';
import { hashPassword } from '../../../../lib/auth/password.js';
import { generateInviteCode } from '../../../../lib/auth/inviteCode.js';
import { getUserByEmail } from '../../../../lib/db/repository/users.js';

import { POST as loginPOST } from '../login/route.js';
import { POST as signupPOST } from '../signup/route.js';
import { POST as logoutPOST } from '../logout/route.js';

// Each test group uses a distinct IP to avoid cross-test rate-limit accumulation.
// Login tests: 192.168.1.x range
// Signup tests: 192.168.2.x range
// Rate limiter tests: 10.0.0.x (chosen per test)
let loginIpCounter = 1;
let signupIpCounter = 1;

function nextLoginIp() { return `192.168.1.${loginIpCounter++}`; }
function nextSignupIp() { return `192.168.2.${signupIpCounter++}`; }

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeAll(() => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
  }

  // The shared in-memory testDb may already have many user rows from other test
  // files. Set maxUsers to 1000 so signups are never blocked by the cap in these
  // tests (cap-reached is tested explicitly with a targeted override).
  testDb
    .insert(schema.setting)
    .values({ key: 'maxUsers', value: '1000' })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: '1000', updatedAt: new Date() } })
    .run();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeLoginRequest(body: object, ip: string): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

function makeSignupRequest(body: object, ip: string): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

/** Inserts a test user with a real bcrypt hash (for login tests). */
async function createUserWithPassword(
  email: string,
  password: string,
  role: 'admin' | 'user' = 'user',
): Promise<{ id: string; email: string }> {
  const passwordHash = await hashPassword(password);
  const id = crypto.randomUUID();
  testDb
    .insert(schema.user)
    .values({ id, email, passwordHash, role, shareLogsWithAdmin: false })
    .run();
  return { id, email };
}

/** Inserts an unredeemed invite code (using generateInviteCode for valid format). */
function makeInviteCode(createdBy: string): string {
  const code = generateInviteCode();
  testDb
    .insert(schema.inviteCode)
    .values({ code, note: null, createdBy, redeemedBy: null })
    .run();
  return code;
}

// ── login ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns 200 and sets HttpOnly + SameSite=Lax cookie on valid credentials', async () => {
    const email = `login-ok-${crypto.randomUUID()}@example.com`;
    const password = 'correct-horse-battery-staple';
    await createUserWithPassword(email, password);

    const res = await loginPOST(makeLoginRequest({ email, password }, nextLoginIp()));
    expect(res.status).toBe(200);

    const body = await res.json() as { user: { email: string; role: string } };
    expect(body.user.email).toBe(email);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('myagent_session=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
  });

  it('returns 401 for an unknown email', async () => {
    const res = await loginPOST(makeLoginRequest({
      email: 'nobody@nowhere.invalid',
      password: 'some-password-here',
    }, nextLoginIp()));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_credentials');
  });

  it('returns 401 for a wrong password', async () => {
    const email = `login-wrong-pw-${crypto.randomUUID()}@example.com`;
    await createUserWithPassword(email, 'the-correct-password-is-this');

    const res = await loginPOST(makeLoginRequest({ email, password: 'not-the-right-one!' }, nextLoginIp()));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_credentials');
  });

  it('returns 401 for a user with the sentinel hash (no password set)', async () => {
    const email = `sentinel-${crypto.randomUUID()}@example.com`;
    const id = crypto.randomUUID();
    testDb
      .insert(schema.user)
      .values({ id, email, passwordHash: '', role: 'admin', shareLogsWithAdmin: false })
      .run();

    const res = await loginPOST(makeLoginRequest({ email, password: 'any-password-given' }, nextLoginIp()));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_credentials');
  });

  // Plan 06 §10.3 — a Google-only account (passwordHash === '') cannot log in with a password.
  // The response is identical to a wrong password — no user-enumeration oracle (§3.8).
  it('returns 401 invalid_credentials for a Google-only user (passwordHash sentinel) — same body as wrong password', async () => {
    const email = `google-only-${crypto.randomUUID()}@gmail.com`;
    const id = crypto.randomUUID();
    testDb
      .insert(schema.user)
      .values({ id, email, passwordHash: '', role: 'user', shareLogsWithAdmin: false })
      .run();

    const res = await loginPOST(makeLoginRequest({ email, password: 'the-google-users-password' }, nextLoginIp()));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    // Must be the same error code as a wrong password — no oracle (§3.8, §7.3)
    expect(body.error).toBe('invalid_credentials');
  });
});

// ── signup ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/signup', () => {
  it('returns 201 and sets a cookie on successful signup', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);

    const res = await signupPOST(makeSignupRequest({
      inviteCode: code,
      email: `signup-ok-${crypto.randomUUID()}@example.com`,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: false,
    }, nextSignupIp()));

    expect(res.status).toBe(201);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('myagent_session=');
  });

  it('returns 400 for an invalid invite code', async () => {
    const res = await signupPOST(makeSignupRequest({
      inviteCode: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ',
      email: `bad-code-${crypto.randomUUID()}@example.com`,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: false,
    }, nextSignupIp()));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_invite_code');
  });

  it('returns 400 for an already-redeemed invite code', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);

    // First signup — redeems the code
    const ip1 = nextSignupIp();
    await signupPOST(makeSignupRequest({
      inviteCode: code,
      email: `redeemed-first-${crypto.randomUUID()}@example.com`,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: false,
    }, ip1));

    // Second attempt with the same code
    const ip2 = nextSignupIp();
    const res = await signupPOST(makeSignupRequest({
      inviteCode: code,
      email: `redeemed-second-${crypto.randomUUID()}@example.com`,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: false,
    }, ip2));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_invite_code');
  });

  it('returns 403 signups_closed when maxUsers cap is reached', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);

    const { getUserCount } = await import('../../../../lib/db/repository/users.js');
    const currentCount = getUserCount();

    // Set maxUsers to current count so the next signup is blocked
    testDb
      .insert(schema.setting)
      .values({ key: 'maxUsers', value: String(currentCount) })
      .onConflictDoUpdate({ target: schema.setting.key, set: { value: String(currentCount), updatedAt: new Date() } })
      .run();

    let res: Response;
    try {
      res = await signupPOST(makeSignupRequest({
        inviteCode: code,
        email: `cap-test-${crypto.randomUUID()}@example.com`,
        password: 'correct-horse-battery-staple',
        shareLogsWithAdmin: false,
      }, nextSignupIp()));
    } finally {
      // Always restore to 1000 so subsequent tests are not affected
      testDb
        .insert(schema.setting)
        .values({ key: 'maxUsers', value: '1000' })
        .onConflictDoUpdate({ target: schema.setting.key, set: { value: '1000', updatedAt: new Date() } })
        .run();
    }

    expect(res!.status).toBe(403);
    const body = await res!.json() as { error: string };
    expect(body.error).toBe('signups_closed');
  });

  it('returns 409 email_exists for a duplicate email', async () => {
    const admin = createTestUser('admin');
    const email = `dup-email-signup-${crypto.randomUUID()}@example.com`;
    const code1 = makeInviteCode(admin.id);
    const code2 = makeInviteCode(admin.id);

    await signupPOST(makeSignupRequest({
      inviteCode: code1,
      email,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: false,
    }, nextSignupIp()));

    const res = await signupPOST(makeSignupRequest({
      inviteCode: code2,
      email,
      password: 'correct-horse-battery-staple',
      shareLogsWithAdmin: false,
    }, nextSignupIp()));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('email_exists');
  });

  it('returns 400 weak_password for a password shorter than 12 chars', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);

    const res = await signupPOST(makeSignupRequest({
      inviteCode: code,
      email: `weak-pw-${crypto.randomUUID()}@example.com`,
      password: 'short',
      shareLogsWithAdmin: false,
    }, nextSignupIp()));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('weak_password');
  });

  it('returns 400 password_too_long for a password > 72 bytes', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);

    const res = await signupPOST(makeSignupRequest({
      inviteCode: code,
      email: `long-pw-${crypto.randomUUID()}@example.com`,
      password: 'a'.repeat(73),
      shareLogsWithAdmin: false,
    }, nextSignupIp()));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('password_too_long');
  });

  // Consent default flipped 2026-08-18 — sharing is now the default; only
  // literal `false` opts out (mirrors the old §8 invariant 15 shape, guarding
  // the opposite direction). Each case gets its own IP to avoid rate-limit
  // accumulation.
  it('shareLogsWithAdmin absent → stored as true', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);
    const email = `consent-absent-${crypto.randomUUID()}@example.com`;

    const body: Record<string, unknown> = {
      inviteCode: code,
      email,
      password: 'correct-horse-battery-staple',
      // shareLogsWithAdmin intentionally omitted
    };
    const res = await signupPOST(makeSignupRequest(body, nextSignupIp()));
    expect(res.status).toBe(201);
    expect(getUserByEmail(email)?.shareLogsWithAdmin).toBe(true);
  });

  it('shareLogsWithAdmin: null → stored as true', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);
    const email = `consent-null-${crypto.randomUUID()}@example.com`;

    const res = await signupPOST(makeSignupRequest({
      inviteCode: code, email, password: 'correct-horse-battery-staple', shareLogsWithAdmin: null,
    }, nextSignupIp()));
    expect(res.status).toBe(201);
    expect(getUserByEmail(email)?.shareLogsWithAdmin).toBe(true);
  });

  it('shareLogsWithAdmin: "false" (string) → stored as true', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);
    const email = `consent-str-${crypto.randomUUID()}@example.com`;

    const res = await signupPOST(makeSignupRequest({
      inviteCode: code, email, password: 'correct-horse-battery-staple', shareLogsWithAdmin: 'false',
    }, nextSignupIp()));
    expect(res.status).toBe(201);
    expect(getUserByEmail(email)?.shareLogsWithAdmin).toBe(true);
  });

  it('shareLogsWithAdmin: 0 (number) → stored as true', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);
    const email = `consent-num-${crypto.randomUUID()}@example.com`;

    const res = await signupPOST(makeSignupRequest({
      inviteCode: code, email, password: 'correct-horse-battery-staple', shareLogsWithAdmin: 0,
    }, nextSignupIp()));
    expect(res.status).toBe(201);
    expect(getUserByEmail(email)?.shareLogsWithAdmin).toBe(true);
  });

  it('shareLogsWithAdmin: false (literal boolean) → stored as false', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);
    const email = `consent-false-${crypto.randomUUID()}@example.com`;

    const res = await signupPOST(makeSignupRequest({
      inviteCode: code, email, password: 'correct-horse-battery-staple', shareLogsWithAdmin: false,
    }, nextSignupIp()));
    expect(res.status).toBe(201);
    expect(getUserByEmail(email)?.shareLogsWithAdmin).toBe(false);
  });

  it('shareLogsWithAdmin: true (literal boolean) → stored as true', async () => {
    const admin = createTestUser('admin');
    const code = makeInviteCode(admin.id);
    const email = `consent-true-${crypto.randomUUID()}@example.com`;

    const res = await signupPOST(makeSignupRequest({
      inviteCode: code, email, password: 'correct-horse-battery-staple', shareLogsWithAdmin: true,
    }, nextSignupIp()));
    expect(res.status).toBe(201);
    expect(getUserByEmail(email)?.shareLogsWithAdmin).toBe(true);
  });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('returns 204 and clears the session cookie', async () => {
    const res = await logoutPOST();
    expect(res.status).toBe(204);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('myagent_session=');
    const hasZeroMaxAge = setCookie.includes('Max-Age=0') || setCookie.includes('max-age=0');
    const hasExpiredDate = setCookie.includes('1970');
    expect(hasZeroMaxAge || hasExpiredDate).toBe(true);
  });
});

// ── rate limiter ──────────────────────────────────────────────────────────────

describe('rate limiter', () => {
  it('returns 429 after 20 failed login attempts from the same IP', async () => {
    // Use a dedicated IP for the rate limit test only (10.99.x.x range not used above)
    const ip = `10.99.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255) + 1}`;

    let lastStatus = 0;
    for (let i = 0; i < 21; i++) {
      const res = await loginPOST(makeLoginRequest({
        email: 'nobody-ratelimit@nowhere.invalid',
        password: 'wrong-pw-for-rate-test',
      }, ip));
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
