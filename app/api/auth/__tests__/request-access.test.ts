/**
 * app/api/auth/__tests__/request-access.test.ts
 *
 * Tests for POST /api/auth/request-access — the "no invite code" branch of the
 * signup form (Plan 12, 2026-08-14). Added 2026-08-18 — this route previously had
 * zero test coverage even though login/signup (the other two account-creation
 * paths) were both fully covered.
 *
 * Cases:
 *   - valid submission → 201 generic response, row created
 *   - invalid/missing name or email → 400
 *   - malformed JSON body → 400 invalid_body
 *   - unknown referralSource value → stored as null, not rejected
 *   - anti-enumeration dedupe (§ file header of the route): already-registered email,
 *     already-open request, and already-active bound invite code all return the exact
 *     same generic 201 without creating a duplicate/second row
 *   - rate limiter: 21st attempt from the same IP → 429
 *   - auto-approval: while the user count is below `autoApproveAccessRequestsBelowUsers`,
 *     a bound, expiring invite code is created instead of a request row; at/above it,
 *     the manual-review flow applies. Every other suite pins the setting to 0 (manual
 *     review) so it exercises the request-row path regardless of the default.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock DB client ─────────────────────────────────────────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// After mock
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import * as schema from '../../../../lib/db/schema.js';
import { createTestUser } from '../../../../lib/db/__tests__/test-users.js';
import { generateInviteCode } from '../../../../lib/auth/inviteCode.js';

import { POST as requestAccessPOST } from '../request-access/route.js';

let ipCounter = 1;
function nextIp() { return `192.168.9.${ipCounter++}`; }

beforeAll(() => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
  }
});

function makeRequest(body: unknown, ip: string): NextRequest {
  return new NextRequest('http://localhost/api/auth/request-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function makeMalformedRequest(ip: string): NextRequest {
  return new NextRequest('http://localhost/api/auth/request-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: '{not valid json',
  });
}

function setSetting(key: string, value: string): void {
  testDb.insert(schema.setting).values({ key, value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value } }).run();
}

// Manual-review flow by default for every suite; the auto-approval suite overrides it.
beforeEach(() => {
  setSetting('autoApproveAccessRequestsBelowUsers', '0');
});

function countAccessRequests(email?: string): number {
  const rows = testDb.select().from(schema.accessRequest).all();
  return email ? rows.filter((r) => r.email === email).length : rows.length;
}

// ── happy path ────────────────────────────────────────────────────────────────

describe('POST /api/auth/request-access', () => {
  it('valid submission → 201 generic response, row created', async () => {
    const email = `alice-${crypto.randomUUID()}@example.com`;
    const res = await requestAccessPOST(makeRequest(
      { name: 'Alice', email, referralSource: 'linkedin' },
      nextIp(),
    ));
    expect(res.status).toBe(201);
    const body = await res.json() as { message: string };
    expect(body.message).toMatch(/if we can offer you a spot/i);
    expect(countAccessRequests(email)).toBe(1);

    const row = testDb.select().from(schema.accessRequest).all().find((r) => r.email === email);
    expect(row).toBeDefined();
    expect(row!.name).toBe('Alice');
    expect(row!.referralSource).toBe('linkedin');
  });

  it('unknown referralSource value → stored as null, not rejected', async () => {
    const email = `bob-${crypto.randomUUID()}@example.com`;
    const res = await requestAccessPOST(makeRequest(
      { name: 'Bob', email, referralSource: 'not-a-real-source' },
      nextIp(),
    ));
    expect(res.status).toBe(201);

    const row = testDb.select().from(schema.accessRequest).all()
      .find((r) => r.email === email);
    expect(row).toBeDefined();
    expect(row!.referralSource).toBeNull();
  });

  it('omitted referralSource → stored as null', async () => {
    const email = `carol-${crypto.randomUUID()}@example.com`;
    const res = await requestAccessPOST(makeRequest({ name: 'Carol', email }, nextIp()));
    expect(res.status).toBe(201);

    const row = testDb.select().from(schema.accessRequest).all()
      .find((r) => r.email === email);
    expect(row).toBeDefined();
    expect(row!.referralSource).toBeNull();
  });

  it('trims name and lowercases/trims email before storing', async () => {
    const email = `  Dave-${crypto.randomUUID()}@EXAMPLE.com  `;
    const res = await requestAccessPOST(makeRequest({ name: '  Dave  ', email }, nextIp()));
    expect(res.status).toBe(201);

    const row = testDb.select().from(schema.accessRequest).all()
      .find((r) => r.email === email.trim().toLowerCase());
    expect(row).toBeDefined();
    expect(row!.name).toBe('Dave');
  });
});

// ── validation ────────────────────────────────────────────────────────────────

describe('POST /api/auth/request-access — validation', () => {
  it('missing name → 400 invalid_body (type check runs before the name-specific check)', async () => {
    const res = await requestAccessPOST(makeRequest({ email: 'x@example.com' }, nextIp()));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  it('blank name → 400 invalid_name', async () => {
    const res = await requestAccessPOST(makeRequest({ name: '   ', email: 'x@example.com' }, nextIp()));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_name');
  });

  it('name over 200 chars → 400 invalid_name', async () => {
    const res = await requestAccessPOST(makeRequest(
      { name: 'x'.repeat(201), email: 'x@example.com' },
      nextIp(),
    ));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_name');
  });

  it('missing email → 400 invalid_body (type check runs before the email-specific check)', async () => {
    const res = await requestAccessPOST(makeRequest({ name: 'Eve' }, nextIp()));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  it('email without @ → 400 invalid_email', async () => {
    const res = await requestAccessPOST(makeRequest({ name: 'Eve', email: 'not-an-email' }, nextIp()));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_email');
  });

  it('non-string name/email → 400 invalid_body', async () => {
    const res = await requestAccessPOST(makeRequest({ name: 123, email: 'x@example.com' }, nextIp()));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  it('malformed JSON body → 400 invalid_body', async () => {
    const res = await requestAccessPOST(makeMalformedRequest(nextIp()));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_body');
  });
});

// ── anti-enumeration dedupe ──────────────────────────────────────────────────

describe('POST /api/auth/request-access — dedupe (never reveals which branch fired)', () => {
  it('already-registered email → 201 generic response, no row created', async () => {
    const existing = createTestUser();
    const res = await requestAccessPOST(makeRequest(
      { name: 'Registered Already', email: existing.email },
      nextIp(),
    ));
    expect(res.status).toBe(201);
    const body = await res.json() as { message: string };
    expect(body.message).toMatch(/if we can offer you a spot/i);
    expect(countAccessRequests(existing.email)).toBe(0);
  });

  it('already has an open request → second submit is 201 generic, no duplicate row', async () => {
    const email = `dup-${crypto.randomUUID()}@example.com`;
    const ip = nextIp();

    const r1 = await requestAccessPOST(makeRequest({ name: 'First', email }, ip));
    expect(r1.status).toBe(201);
    expect(countAccessRequests(email)).toBe(1);

    const r2 = await requestAccessPOST(makeRequest({ name: 'First Again', email }, nextIp()));
    expect(r2.status).toBe(201);
    const body2 = await r2.json() as { message: string };
    expect(body2.message).toMatch(/if we can offer you a spot/i);
    expect(countAccessRequests(email)).toBe(1); // still just one row
  });

  it('already has an active bound invite code → 201 generic, no row created', async () => {
    const email = `bound-${crypto.randomUUID()}@example.com`;
    testDb.insert(schema.inviteCode).values({
      code: generateInviteCode(),
      note: 'pre-existing code for this email',
      createdBy: null,
      redeemedBy: null,
      boundEmail: email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h from now
    }).run();

    const res = await requestAccessPOST(makeRequest({ name: 'Already Has Code', email }, nextIp()));
    expect(res.status).toBe(201);
    expect(countAccessRequests(email)).toBe(0);
  });

  it('an EXPIRED bound invite code does not block a new request', async () => {
    const email = `expired-${crypto.randomUUID()}@example.com`;
    testDb.insert(schema.inviteCode).values({
      code: generateInviteCode(),
      note: 'expired code',
      createdBy: null,
      redeemedBy: null,
      boundEmail: email,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1h in the past
    }).run();

    const res = await requestAccessPOST(makeRequest({ name: 'Expired Code Holder', email }, nextIp()));
    expect(res.status).toBe(201);
    expect(countAccessRequests(email)).toBe(1); // a fresh request row IS created this time
  });
});

// ── rate limiter ──────────────────────────────────────────────────────────────

describe('POST /api/auth/request-access — rate limiter', () => {
  it('returns 429 after 20 attempts from the same IP', async () => {
    const ip = `10.98.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255) + 1}`;

    let lastStatus = 0;
    for (let i = 0; i < 21; i++) {
      const res = await requestAccessPOST(makeRequest(
        { name: 'Rate Limited', email: `ratelimit-${i}-${crypto.randomUUID()}@example.com` },
        ip,
      ));
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

// ── auto-approval ─────────────────────────────────────────────────────────────

describe('POST /api/auth/request-access — auto-approval', () => {
  function inviteCodesFor(email: string) {
    return testDb.select().from(schema.inviteCode).all().filter((r) => r.boundEmail === email);
  }

  it('user count below threshold → bound, expiring code created, no request row, same generic 201', async () => {
    setSetting('autoApproveAccessRequestsBelowUsers', '100000');
    setSetting('accessRequestCodeExpiryHours', '120');
    const email = `auto-${crypto.randomUUID()}@example.com`;

    const before = Date.now();
    const res = await requestAccessPOST(makeRequest(
      { name: 'Auto', email, referralSource: 'linkedin' },
      nextIp(),
    ));
    expect(res.status).toBe(201);
    const body = await res.json() as { message: string };
    expect(body.message).toMatch(/if we can offer you a spot/i);

    expect(countAccessRequests(email)).toBe(0);
    const codes = inviteCodesFor(email);
    expect(codes).toHaveLength(1);
    expect(codes[0].redeemedBy).toBeNull();
    expect(codes[0].createdBy).toBeNull();
    expect(codes[0].note).toBe('Auto · via LinkedIn');

    const expiresMs = codes[0].expiresAt instanceof Date
      ? codes[0].expiresAt.getTime()
      : (codes[0].expiresAt as unknown as number) * 1000;
    const fiveDaysMs = 120 * 60 * 60 * 1000;
    // expires_at is stored at second precision — allow a few seconds of slack.
    expect(expiresMs).toBeGreaterThanOrEqual(before + fiveDaysMs - 5000);
    expect(expiresMs).toBeLessThanOrEqual(Date.now() + fiveDaysMs + 5000);
  });

  it('auto-approved email submitting again → no second code (active-code dedupe still applies)', async () => {
    setSetting('autoApproveAccessRequestsBelowUsers', '100000');
    const email = `auto-again-${crypto.randomUUID()}@example.com`;

    await requestAccessPOST(makeRequest({ name: 'Again', email }, nextIp()));
    const res = await requestAccessPOST(makeRequest({ name: 'Again', email }, nextIp()));
    expect(res.status).toBe(201);
    expect(inviteCodesFor(email)).toHaveLength(1);
    expect(countAccessRequests(email)).toBe(0);
  });

  it('user count at/above threshold → falls back to a request row, no code', async () => {
    createTestUser();
    const userCount = testDb.select().from(schema.user).all().length;
    setSetting('autoApproveAccessRequestsBelowUsers', String(userCount));
    const email = `manual-${crypto.randomUUID()}@example.com`;

    const res = await requestAccessPOST(makeRequest({ name: 'Manual', email }, nextIp()));
    expect(res.status).toBe(201);
    expect(countAccessRequests(email)).toBe(1);
    expect(inviteCodesFor(email)).toHaveLength(0);
  });
});
