/**
 * lib/db/repository/__tests__/users.test.ts
 *
 * Tests for lib/db/repository/users.ts (§10.3).
 *
 * Covers:
 *   - createUserWithInvite happy path and every failure path, with invariants:
 *     on failure, zero rows are written and the code stays unredeemed
 *   - getUserCount
 *   - revokeInviteCode on a redeemed code fails
 *   - createUserWithInvite stores the consent value it was given (both ways)
 *   - getUserPolicy returns role + consent and does NOT return passwordHash
 *   - setUserLogSharing flips the value and returns false for an unknown id
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

// Must be after mock registration
import { testDb } from '../../__tests__/test-db.js';
import * as schema from '../../schema.js';
import { createTestUser } from '../../__tests__/test-users.js';

import {
  createUserWithInvite,
  getUserById,
  getUserByEmail,
  getUserCount,
  getUserPolicy,
  setUserLogSharing,
  createInviteCode,
  listInviteCodes,
  revokeInviteCode,
} from '../users.js';
import { getOAuthAccount } from '../oauthAccounts.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create and return an unredeemed invite code in the DB. */
function makeCode(createdBy: string, suffix = ''): string {
  const code = `TEST-${suffix || crypto.randomUUID().slice(0, 4).toUpperCase()}-AABB-CCDD`;
  testDb.insert(schema.inviteCode).values({
    code,
    note: null,
    createdBy,
    redeemedBy: null,
  }).run();
  return code;
}

let admin: ReturnType<typeof createTestUser>;

beforeAll(() => {
  admin = createTestUser('admin');
});

// ── getUserCount ──────────────────────────────────────────────────────────────

describe('getUserCount', () => {
  it('returns the current number of user rows (increases as tests run)', () => {
    const before = getUserCount();
    createTestUser('user');
    expect(getUserCount()).toBe(before + 1);
  });
});

// ── createUserWithInvite — happy path ─────────────────────────────────────────

describe('createUserWithInvite — happy path', () => {
  it('returns ok:true and a user row with role:user', () => {
    const code = makeCode(admin.id, 'HP01');
    const before = getUserCount();

    const result = createUserWithInvite({
      email: `happy-path-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$placeholder-hash',
      code,
      maxUsers: before + 5,
      shareLogsWithAdmin: false,
      oauth: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.user.role).toBe('user');          // signup never mints admin
    expect(typeof result.user.id).toBe('string');
    expect(result.user.passwordHash).toBe('$2a$10$placeholder-hash');
  });

  it('marks the invite code redeemed after success', () => {
    const code = makeCode(admin.id, 'HP02');

    const email = `redeemed-check-${crypto.randomUUID()}@example.com`;
    createUserWithInvite({
      email,
      passwordHash: '$2a$10$x',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: false,
      oauth: null,
    });

    const codeRow = testDb.select().from(schema.inviteCode)
      .all().find((r) => r.code === code);
    expect(codeRow?.redeemedBy).not.toBeNull();
    expect(codeRow?.redeemedAt).not.toBeNull();
  });

  it('stores shareLogsWithAdmin: false when given false', () => {
    const code = makeCode(admin.id, 'SLA0');
    const result = createUserWithInvite({
      email: `consent-false-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$x',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: false,
      oauth: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.shareLogsWithAdmin).toBe(false);
  });

  it('stores shareLogsWithAdmin: true when given true (both consent paths must work)', () => {
    const code = makeCode(admin.id, 'SLA1');
    const result = createUserWithInvite({
      email: `consent-true-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$x',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: true,
      oauth: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.shareLogsWithAdmin).toBe(true);
  });
});

// ── createUserWithInvite — failure paths ──────────────────────────────────────

describe('createUserWithInvite — invalid_code', () => {
  it('returns invalid_code for an unknown code and writes nothing', () => {
    const countBefore = getUserCount();
    const codesBefore = listInviteCodes().length;

    const result = createUserWithInvite({
      email: `unknown-code-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$x',
      code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ',
      maxUsers: 100,
      shareLogsWithAdmin: false,
      oauth: null,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_code' });
    expect(getUserCount()).toBe(countBefore);     // no user row written
    expect(listInviteCodes().length).toBe(codesBefore); // no code row changed
  });

  it('returns invalid_code for an already-redeemed code and writes nothing', () => {
    const code = makeCode(admin.id, 'RC01');

    // Redeem it once
    createUserWithInvite({
      email: `first-redeemer-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$x',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: false,
      oauth: null,
    });

    const countBefore = getUserCount();
    const result = createUserWithInvite({
      email: `second-redeemer-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$x',
      code,                          // same code — now redeemed
      maxUsers: 100,
      shareLogsWithAdmin: false,
      oauth: null,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_code' });
    expect(getUserCount()).toBe(countBefore);     // no new user row
  });
});

describe('createUserWithInvite — cap_reached', () => {
  it('returns cap_reached when userCount >= maxUsers and writes nothing', () => {
    const code = makeCode(admin.id, 'CAP1');
    const current = getUserCount();
    const countBefore = current;

    const result = createUserWithInvite({
      email: `cap-test-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$x',
      code,
      maxUsers: current,            // exactly at the limit
      shareLogsWithAdmin: false,
      oauth: null,
    });

    expect(result).toEqual({ ok: false, reason: 'cap_reached' });
    expect(getUserCount()).toBe(countBefore);     // no user row written

    // The code must still be unredeemed
    const codeRow = testDb.select().from(schema.inviteCode)
      .all().find((r) => r.code === code);
    expect(codeRow?.redeemedBy).toBeNull();
  });
});

describe('createUserWithInvite — email_exists', () => {
  it('returns email_exists for a duplicate email and writes nothing', () => {
    const email = `dup-email-${crypto.randomUUID()}@example.com`;
    const code1 = makeCode(admin.id, 'EM01');
    const code2 = makeCode(admin.id, 'EM02');

    // First signup succeeds
    createUserWithInvite({
      email,
      passwordHash: '$2a$10$x',
      code: code1,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: false,
      oauth: null,
    });

    const countBefore = getUserCount();
    const result = createUserWithInvite({
      email,                         // same email
      passwordHash: '$2a$10$y',
      code: code2,
      maxUsers: 100,
      shareLogsWithAdmin: false,
      oauth: null,
    });

    expect(result).toEqual({ ok: false, reason: 'email_exists' });
    expect(getUserCount()).toBe(countBefore);     // no new user row written

    // code2 must stay unredeemed
    const codeRow = testDb.select().from(schema.inviteCode)
      .all().find((r) => r.code === code2);
    expect(codeRow?.redeemedBy).toBeNull();
  });
});

// ── getUserPolicy ─────────────────────────────────────────────────────────────

describe('getUserPolicy', () => {
  it('returns role and shareLogsWithAdmin, no passwordHash', () => {
    const code = makeCode(admin.id, 'GP01');
    const result = createUserWithInvite({
      email: `policy-user-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$secret-hash',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: true,
      oauth: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const policy = getUserPolicy(result.user.id);
    expect(policy).not.toBeNull();
    expect(policy!.role).toBe('user');
    expect(policy!.shareLogsWithAdmin).toBe(true);

    // The key 'passwordHash' must be absent from the returned object (constraint 7)
    expect(Object.keys(policy as object)).not.toContain('passwordHash');
    expect(Object.keys(policy as object)).not.toContain('password_hash');
  });

  it('returns null for an unknown userId', () => {
    expect(getUserPolicy('no-such-user-id')).toBeNull();
  });
});

// ── revokeInviteCode ──────────────────────────────────────────────────────────

describe('revokeInviteCode', () => {
  it('returns deleted for an unredeemed code and removes the row', () => {
    const code = makeCode(admin.id, 'RV01');
    const result = revokeInviteCode(code);
    expect(result).toBe('deleted');

    const row = testDb.select().from(schema.inviteCode).all().find((r) => r.code === code);
    expect(row).toBeUndefined();
  });

  it('returns already_redeemed for a redeemed code', () => {
    const code = makeCode(admin.id, 'RV02');

    // Redeem it
    createUserWithInvite({
      email: `revoke-redeemed-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$x',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: false,
      oauth: null,
    });

    const result = revokeInviteCode(code);
    expect(result).toBe('already_redeemed');
  });

  it('returns not_found for an unknown code', () => {
    expect(revokeInviteCode('XXXX-XXXX-XXXX-XXXX')).toBe('not_found');
  });
});

// ── setUserLogSharing ─────────────────────────────────────────────────────────

describe('setUserLogSharing', () => {
  it('flips shareLogsWithAdmin from false to true', () => {
    const code = makeCode(admin.id, 'SLS1');
    const result = createUserWithInvite({
      email: `sharing-toggle-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$x',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: false,
      oauth: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const userId = result.user.id;

    const updated = setUserLogSharing(userId, true);
    expect(updated).toBe(true);

    const policy = getUserPolicy(userId);
    expect(policy?.shareLogsWithAdmin).toBe(true);
  });

  it('flips shareLogsWithAdmin from true to false', () => {
    const code = makeCode(admin.id, 'SLS2');
    const result = createUserWithInvite({
      email: `sharing-flip-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$x',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: true,
      oauth: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const userId = result.user.id;

    const updated = setUserLogSharing(userId, false);
    expect(updated).toBe(true);

    const policy = getUserPolicy(userId);
    expect(policy?.shareLogsWithAdmin).toBe(false);
  });

  it('returns false for an unknown userId', () => {
    expect(setUserLogSharing('no-such-user', true)).toBe(false);
  });
});

// ── createInviteCode + listInviteCodes ────────────────────────────────────────

describe('createInviteCode / listInviteCodes', () => {
  it('createInviteCode inserts a row and it appears in listInviteCodes', () => {
    const code = `LIST-TEST-${crypto.randomUUID().slice(0, 4).toUpperCase()}-AAAA`;
    const before = listInviteCodes().length;

    createInviteCode({ code, note: 'for testing', createdBy: admin.id });
    const after = listInviteCodes();
    expect(after.length).toBe(before + 1);
    const found = after.find((c) => c.code === code);
    expect(found).toBeDefined();
    expect(found?.note).toBe('for testing');
    expect(found?.redeemedBy).toBeNull();
  });
});

// ── getUserById / getUserByEmail ──────────────────────────────────────────────

describe('getUserById / getUserByEmail', () => {
  it('getUserById returns the user row or null', () => {
    const code = makeCode(admin.id, 'GBI1');
    const r = createUserWithInvite({
      email: `byid-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$x',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: false,
      oauth: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const found = getUserById(r.user.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(r.user.id);

    expect(getUserById('no-such-id')).toBeNull();
  });

  it('getUserByEmail finds by email or returns null', () => {
    const email = `byemail-${crypto.randomUUID()}@example.com`;
    const code = makeCode(admin.id, 'GBE1');
    createUserWithInvite({
      email,
      passwordHash: '$2a$10$x',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: false,
      oauth: null,
    });

    const found = getUserByEmail(email);
    expect(found?.email).toBe(email);
    expect(getUserByEmail('nobody@nowhere.invalid')).toBeNull();
  });
});

// ── createUserWithInvite — OAuth field (§4.2) ─────────────────────────────────

describe('createUserWithInvite — with oauth (happy path)', () => {
  it('creates both a user row and an oauth_account row, redeems the code', () => {
    const code = makeCode(admin.id, 'OA01');
    const providerAccountId = `sub-${crypto.randomUUID()}`;
    const before = getUserCount();

    const result = createUserWithInvite({
      email: `oauth-signup-${crypto.randomUUID()}@example.com`,
      passwordHash: '',                  // NO_PASSWORD_SENTINEL for an OAuth-only user
      code,
      maxUsers: before + 5,
      shareLogsWithAdmin: false,
      oauth: {
        provider: 'google',
        providerAccountId,
        providerEmail: 'alice@gmail.com',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // User row exists with role: 'user' and the sentinel hash
    expect(result.user.role).toBe('user');
    expect(result.user.passwordHash).toBe('');

    // oauth_account row exists and points at the new user
    const oauthRow = getOAuthAccount('google', providerAccountId);
    expect(oauthRow).not.toBeNull();
    expect(oauthRow?.userId).toBe(result.user.id);
    expect(oauthRow?.providerEmail).toBe('alice@gmail.com');

    // Invite code was redeemed
    const codeRow = testDb.select().from(schema.inviteCode).all().find((r) => r.code === code);
    expect(codeRow?.redeemedBy).toBe(result.user.id);
  });

  it('with oauth: null behaves exactly as the pre-OAuth password path — no oauth_account row', () => {
    const code = makeCode(admin.id, 'OA02');
    const result = createUserWithInvite({
      email: `password-signup-${crypto.randomUUID()}@example.com`,
      passwordHash: '$2a$10$placeholder',
      code,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: false,
      oauth: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Confirm no oauth_account row was created for this user
    const rows = testDb
      .select()
      .from(schema.oauthAccount)
      .all()
      .filter((r) => r.userId === result.user.id);
    expect(rows).toHaveLength(0);
  });
});

describe('createUserWithInvite — oauth_account_exists', () => {
  it('returns oauth_account_exists and writes zero rows when the (provider, sub) is already linked', () => {
    const code1 = makeCode(admin.id, 'OAE1');
    const code2 = makeCode(admin.id, 'OAE2');
    const providerAccountId = `sub-${crypto.randomUUID()}`;

    // First signup succeeds, creating an oauth_account row
    const first = createUserWithInvite({
      email: `oae-first-${crypto.randomUUID()}@example.com`,
      passwordHash: '',
      code: code1,
      maxUsers: getUserCount() + 5,
      shareLogsWithAdmin: false,
      oauth: { provider: 'google', providerAccountId, providerEmail: 'x@gmail.com' },
    });
    expect(first.ok).toBe(true);

    const countBefore = getUserCount();

    // Second signup with the same (provider, providerAccountId) must fail
    const result = createUserWithInvite({
      email: `oae-second-${crypto.randomUUID()}@example.com`,
      passwordHash: '',
      code: code2,
      maxUsers: 100,
      shareLogsWithAdmin: false,
      oauth: { provider: 'google', providerAccountId, providerEmail: 'x@gmail.com' },
    });

    expect(result).toEqual({ ok: false, reason: 'oauth_account_exists' });

    // No new user row written
    expect(getUserCount()).toBe(countBefore);

    // code2 must remain unredeemed
    const codeRow = testDb.select().from(schema.inviteCode).all().find((r) => r.code === code2);
    expect(codeRow?.redeemedBy).toBeNull();
  });
});
