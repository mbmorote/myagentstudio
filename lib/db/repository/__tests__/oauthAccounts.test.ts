/**
 * lib/db/repository/__tests__/oauthAccounts.test.ts
 *
 * Tests for lib/db/repository/oauthAccounts.ts (§10.3).
 *
 * Covers:
 *   - linkOAuthAccount inserts and is readable via getOAuthAccount
 *   - a duplicate (provider, providerAccountId) violates the composite PK
 *   - a second provider for the same user is allowed (one row per provider per user)
 *   - a second Google account for the same user violates oauth_account_user_provider_unique
 *   - listOAuthAccountsForUser returns [] for a password-only user
 *   - listOAuthAccountsForUser returns all rows for a user with multiple providers
 */

import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

import { testDb } from '../../__tests__/test-db.js';
import { createTestUser } from '../../__tests__/test-users.js';
import * as schema from '../../schema.js';
import { getOAuthAccount, listOAuthAccountsForUser, linkOAuthAccount } from '../oauthAccounts.js';

// ── linkOAuthAccount + getOAuthAccount ────────────────────────────────────────
// Each test creates its own user(s) via createTestUser() so that the
// oauth_account_user_provider_unique index (one provider per user) does not
// cause cross-test collisions when tests share state through the module-level
// in-memory DB.

describe('linkOAuthAccount', () => {
  it('inserts a row and it is readable via getOAuthAccount', () => {
    const user = createTestUser('user');
    const providerAccountId = `sub-${crypto.randomUUID()}`;

    const linked = linkOAuthAccount({
      provider: 'google',
      providerAccountId,
      userId: user.id,
      providerEmail: 'alice@gmail.com',
    });

    expect(linked.provider).toBe('google');
    expect(linked.providerAccountId).toBe(providerAccountId);
    expect(linked.userId).toBe(user.id);
    expect(linked.providerEmail).toBe('alice@gmail.com');
    expect(linked.createdAt).toBeInstanceOf(Date);

    const fetched = getOAuthAccount('google', providerAccountId);
    expect(fetched).not.toBeNull();
    expect(fetched?.userId).toBe(user.id);
  });

  it('stores null providerEmail when none is supplied', () => {
    const user = createTestUser('user');
    const providerAccountId = `sub-${crypto.randomUUID()}`;

    linkOAuthAccount({
      provider: 'google',
      providerAccountId,
      userId: user.id,
      providerEmail: null,
    });

    const fetched = getOAuthAccount('google', providerAccountId);
    expect(fetched?.providerEmail).toBeNull();
  });

  it('throws on a duplicate (provider, providerAccountId) — composite PK violation', () => {
    const userA = createTestUser('user');
    const userB = createTestUser('user');
    const providerAccountId = `sub-${crypto.randomUUID()}`;

    linkOAuthAccount({
      provider: 'google',
      providerAccountId,
      userId: userA.id,
      providerEmail: 'alice@gmail.com',
    });

    expect(() => {
      linkOAuthAccount({
        provider: 'google',
        providerAccountId,  // same sub — composite PK collision
        userId: userB.id,
        providerEmail: 'bob@gmail.com',
      });
    }).toThrow();
  });

  it('allows a second provider for the same user (one row per provider per user)', () => {
    const user = createTestUser('user');
    const googleId = `sub-${crypto.randomUUID()}`;
    const githubId = `gh-${crypto.randomUUID()}`;

    linkOAuthAccount({
      provider: 'google',
      providerAccountId: googleId,
      userId: user.id,
      providerEmail: 'alice@gmail.com',
    });

    // Using 'github' as the provider name — schema is open-catalog
    linkOAuthAccount({
      provider: 'github',
      providerAccountId: githubId,
      userId: user.id,
      providerEmail: 'alice@users.noreply.github.com',
    });

    const row = getOAuthAccount('github', githubId);
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(user.id);
  });

  it('throws when the same user tries to link a second Google account — oauth_account_user_provider_unique', () => {
    const user = createTestUser('user');
    const firstGoogleId = `sub-${crypto.randomUUID()}`;
    const secondGoogleId = `sub-${crypto.randomUUID()}`;

    linkOAuthAccount({
      provider: 'google',
      providerAccountId: firstGoogleId,
      userId: user.id,
      providerEmail: 'bob@gmail.com',
    });

    // A second Google account for the same user must be refused
    expect(() => {
      linkOAuthAccount({
        provider: 'google',
        providerAccountId: secondGoogleId,  // different sub — not a PK collision
        userId: user.id,                    // but same user + same provider → UNIQUE violation
        providerEmail: 'bob2@gmail.com',
      });
    }).toThrow();
  });
});

// ── getOAuthAccount ──────────────────────────────────────────────────────────

describe('getOAuthAccount', () => {
  it('returns null for a (provider, providerAccountId) that does not exist', () => {
    expect(getOAuthAccount('google', 'no-such-sub')).toBeNull();
  });
});

// ── listOAuthAccountsForUser ─────────────────────────────────────────────────

describe('listOAuthAccountsForUser', () => {
  it('returns [] for a password-only user (no oauth_account rows)', () => {
    const passwordOnlyUser = createTestUser('user');
    const rows = listOAuthAccountsForUser(passwordOnlyUser.id);
    expect(rows).toEqual([]);
  });

  it('returns the linked rows for a user who has them', () => {
    const user = createTestUser('user');
    const sub1 = `sub-${crypto.randomUUID()}`;
    const sub2 = `sub-${crypto.randomUUID()}`;

    // Link two different providers to the same user
    linkOAuthAccount({ provider: 'google', providerAccountId: sub1, userId: user.id, providerEmail: 'u@gmail.com' });
    linkOAuthAccount({ provider: 'github', providerAccountId: sub2, userId: user.id, providerEmail: null });

    const rows = listOAuthAccountsForUser(user.id);
    expect(rows).toHaveLength(2);

    const providers = rows.map((r) => r.provider).sort();
    expect(providers).toEqual(['github', 'google']);
  });

  it('does not return rows belonging to a different user', () => {
    const userC = createTestUser('user');
    const userD = createTestUser('user');

    const subC = `sub-${crypto.randomUUID()}`;
    linkOAuthAccount({ provider: 'google', providerAccountId: subC, userId: userC.id, providerEmail: 'c@gmail.com' });

    // userD has no rows
    const rows = listOAuthAccountsForUser(userD.id);
    expect(rows).toHaveLength(0);
  });
});

// ── Direct schema verification: composite PK columns ─────────────────────────

describe('oauth_account table shape', () => {
  it('can insert and read a row via the raw schema (confirms columns exist)', () => {
    const provider = 'google';
    const providerAccountId = `schema-check-${crypto.randomUUID()}`;
    const user = createTestUser('user');

    testDb.insert(schema.oauthAccount).values({
      provider,
      providerAccountId,
      userId: user.id,
      providerEmail: 'schema@example.com',
    }).run();

    const row = testDb
      .select()
      .from(schema.oauthAccount)
      .all()
      .find((r) => r.providerAccountId === providerAccountId);

    expect(row).toBeDefined();
    expect(row?.provider).toBe(provider);
    expect(row?.userId).toBe(user.id);
    expect(row?.providerEmail).toBe('schema@example.com');
    expect(row?.createdAt).toBeDefined();
  });
});
