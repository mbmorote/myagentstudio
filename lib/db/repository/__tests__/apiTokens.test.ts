/**
 * lib/db/repository/__tests__/apiTokens.test.ts
 *
 * Tests for lib/db/repository/apiTokens.ts (Plan 13 §5.2).
 *
 * Covers:
 *   - createApiToken → findApiTokenByHash returns it; a wrong hash returns null
 *   - A revoked/expired token is still findable as a row (the guard, not the
 *     repository, decides what a revoked/expired row means)
 *   - listApiTokensForUser returns only that user's tokens and never the hash
 *   - touchApiTokenLastUsed updates only the target row
 *   - revokeApiToken only revokes the caller's own token (owner + id match)
 *   - createApiToken enforces the per-user active-token cap (10)
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

import { createTestUser } from '../../__tests__/test-users.js';
import {
  createApiToken,
  findApiTokenByHash,
  listApiTokensForUser,
  touchApiTokenLastUsed,
  revokeApiToken,
  TooManyTokensError,
} from '../apiTokens.js';

function fakeHash(): string {
  return crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
}

describe('createApiToken + findApiTokenByHash', () => {
  it('creates a row that is readable via findApiTokenByHash', () => {
    const user = createTestUser('user');
    const hash = fakeHash();

    const created = createApiToken({
      ownerId: user.id,
      name: 'laptop Claude Code',
      tokenHash: hash,
      prefix: 'mya_abcd1234',
      scope: 'read',
    });

    expect(created.ownerId).toBe(user.id);
    expect(created.scope).toBe('read');
    expect(created.revokedAt).toBeNull();
    expect(created.lastUsedAt).toBeNull();

    const found = findApiTokenByHash(hash);
    expect(found).not.toBeNull();
    expect(found?.ownerId).toBe(user.id);
    expect(found?.tokenId).toBe(created.id);
  });

  it('returns null for a hash that does not exist', () => {
    expect(findApiTokenByHash(fakeHash())).toBeNull();
  });

  it('a revoked token is still findable as a row (guard decides meaning, not the repository)', () => {
    const user = createTestUser('user');
    const hash = fakeHash();
    const created = createApiToken({
      ownerId: user.id,
      name: 'revoked-token',
      tokenHash: hash,
      prefix: 'mya_revk1234',
      scope: 'read',
    });

    revokeApiToken(created.id, user.id);

    const found = findApiTokenByHash(hash);
    expect(found).not.toBeNull();
    expect(found?.revokedAt).not.toBeNull();
  });

  it('an expired token is still findable as a row', () => {
    const user = createTestUser('user');
    const hash = fakeHash();
    createApiToken({
      ownerId: user.id,
      name: 'expired-token',
      tokenHash: hash,
      prefix: 'mya_expr1234',
      scope: 'read',
      expiresAt: new Date(Date.now() - 1000 * 60), // 1 minute in the past
    });

    const found = findApiTokenByHash(hash);
    expect(found).not.toBeNull();
    expect(found?.expiresAt).not.toBeNull();
    expect((found!.expiresAt as Date).getTime()).toBeLessThan(Date.now());
  });
});

describe('listApiTokensForUser', () => {
  it("returns only that user's tokens, never the hash", () => {
    const userA = createTestUser('user');
    const userB = createTestUser('user');

    createApiToken({ ownerId: userA.id, name: 'a1', tokenHash: fakeHash(), prefix: 'mya_aaaa1111', scope: 'read' });
    createApiToken({ ownerId: userA.id, name: 'a2', tokenHash: fakeHash(), prefix: 'mya_aaaa2222', scope: 'write' });
    createApiToken({ ownerId: userB.id, name: 'b1', tokenHash: fakeHash(), prefix: 'mya_bbbb1111', scope: 'read' });

    const rowsA = listApiTokensForUser(userA.id);
    expect(rowsA).toHaveLength(2);
    expect(rowsA.every((r) => r.ownerId === userA.id)).toBe(true);
    // Never leaks a hash field on the DTO
    expect(rowsA.every((r) => !('tokenHash' in r))).toBe(true);

    const rowsB = listApiTokensForUser(userB.id);
    expect(rowsB).toHaveLength(1);
  });

  it('returns [] for a user with no tokens', () => {
    const user = createTestUser('user');
    expect(listApiTokensForUser(user.id)).toEqual([]);
  });
});

describe('touchApiTokenLastUsed', () => {
  it('updates only the target row', () => {
    const user = createTestUser('user');
    const hashA = fakeHash();
    const hashB = fakeHash();
    const tokenA = createApiToken({ ownerId: user.id, name: 'a', tokenHash: hashA, prefix: 'mya_touc1111', scope: 'read' });
    const tokenB = createApiToken({ ownerId: user.id, name: 'b', tokenHash: hashB, prefix: 'mya_touc2222', scope: 'read' });

    touchApiTokenLastUsed(tokenA.id);

    const foundA = findApiTokenByHash(hashA);
    const foundB = findApiTokenByHash(hashB);
    expect(foundA?.lastUsedAt).not.toBeNull();
    expect(foundB?.lastUsedAt).toBeNull();
    void tokenB;
  });
});

describe('revokeApiToken', () => {
  it("revokes the caller's own token and returns true", () => {
    const user = createTestUser('user');
    const hash = fakeHash();
    const created = createApiToken({ ownerId: user.id, name: 'r', tokenHash: hash, prefix: 'mya_revk9999', scope: 'read' });

    const result = revokeApiToken(created.id, user.id);
    expect(result).toBe(true);

    const found = findApiTokenByHash(hash);
    expect(found?.revokedAt).not.toBeNull();
  });

  it("returns false and leaves the row untouched when the id belongs to a different owner", () => {
    const owner = createTestUser('user');
    const attacker = createTestUser('user');
    const hash = fakeHash();
    const created = createApiToken({ ownerId: owner.id, name: 'r', tokenHash: hash, prefix: 'mya_xown1111', scope: 'read' });

    const result = revokeApiToken(created.id, attacker.id);
    expect(result).toBe(false);

    const found = findApiTokenByHash(hash);
    expect(found?.revokedAt).toBeNull();
  });

  it('returns false for an unknown token id', () => {
    const user = createTestUser('user');
    expect(revokeApiToken(crypto.randomUUID(), user.id)).toBe(false);
  });

  it('does not double-revoke (second call on an already-revoked token returns false)', () => {
    const user = createTestUser('user');
    const created = createApiToken({ ownerId: user.id, name: 'r', tokenHash: fakeHash(), prefix: 'mya_dblr1111', scope: 'read' });

    expect(revokeApiToken(created.id, user.id)).toBe(true);
    expect(revokeApiToken(created.id, user.id)).toBe(false);
  });
});

describe('createApiToken — per-user active-token cap', () => {
  it('throws TooManyTokensError on the 11th active token for the same user', () => {
    const user = createTestUser('user');
    for (let i = 0; i < 10; i++) {
      createApiToken({ ownerId: user.id, name: `t${i}`, tokenHash: fakeHash(), prefix: `mya_cap${i}xxxx`, scope: 'read' });
    }

    expect(() => {
      createApiToken({ ownerId: user.id, name: 't11', tokenHash: fakeHash(), prefix: 'mya_capoverflow', scope: 'read' });
    }).toThrow(TooManyTokensError);
  });

  it('a revoked token does not count against the cap', () => {
    const user = createTestUser('user');
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const t = createApiToken({ ownerId: user.id, name: `u${i}`, tokenHash: fakeHash(), prefix: `mya_upd${i}xxxx`, scope: 'read' });
      ids.push(t.id);
    }
    // Revoke one — the 11th create should now succeed
    revokeApiToken(ids[0], user.id);

    expect(() => {
      createApiToken({ ownerId: user.id, name: 'fresh', tokenHash: fakeHash(), prefix: 'mya_freshxxxxx', scope: 'read' });
    }).not.toThrow();
  });

  it("a different user's tokens do not count against this user's cap", () => {
    const userA = createTestUser('user');
    const userB = createTestUser('user');
    for (let i = 0; i < 10; i++) {
      createApiToken({ ownerId: userA.id, name: `a${i}`, tokenHash: fakeHash(), prefix: `mya_capA${i}xxx`, scope: 'read' });
    }
    expect(() => {
      createApiToken({ ownerId: userB.id, name: 'b0', tokenHash: fakeHash(), prefix: 'mya_capB0xxxx', scope: 'read' });
    }).not.toThrow();
  });
});
