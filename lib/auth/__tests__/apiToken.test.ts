/**
 * lib/auth/__tests__/apiToken.test.ts
 *
 * Tests for lib/auth/apiToken.ts (Plan 13 §5.1).
 *
 * Cases:
 *   - Generated tokens match the expected format ('mya_' + 43 base64url chars, 47 total)
 *   - Uniqueness across many generations
 *   - hashApiToken is deterministic and collision-free across distinct plaintexts
 *   - prefix is derived from the plaintext, is 12 chars, and never sufficient to replay
 *   - The plaintext appears in the return value and nowhere else (hash contains no
 *     substring of the plaintext beyond the prefix)
 */

import { describe, it, expect } from 'vitest';
import { generateApiToken, hashApiToken } from '../apiToken.js';

const TOKEN_PATTERN = /^mya_[A-Za-z0-9_-]{43}$/;

describe('generateApiToken', () => {
  it('produces a token matching the mya_ + 43-char base64url format (47 chars total)', () => {
    const { plaintext } = generateApiToken();
    expect(plaintext).toHaveLength(47);
    expect(TOKEN_PATTERN.test(plaintext)).toBe(true);
  });

  it('produces unique plaintexts across 200 generations (probabilistic — collision is astronomically unlikely)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generateApiToken().plaintext);
    }
    expect(seen.size).toBe(200);
  });

  it('derives prefix as the first 12 characters of the plaintext', () => {
    const { plaintext, prefix } = generateApiToken();
    expect(prefix).toHaveLength(12);
    expect(plaintext.startsWith(prefix)).toBe(true);
  });

  it('hash is the sha256 hex of the plaintext, matching hashApiToken()', () => {
    const { plaintext, hash } = generateApiToken();
    expect(hash).toBe(hashApiToken(plaintext));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the hash contains no substring of the plaintext beyond the prefix', () => {
    const { plaintext, hash, prefix } = generateApiToken();
    // The remainder of the plaintext (past the prefix) must not leak into the hash.
    const remainder = plaintext.slice(prefix.length);
    expect(hash.includes(remainder)).toBe(false);
    expect(hash.includes(plaintext)).toBe(false);
  });
});

describe('hashApiToken', () => {
  it('is deterministic — the same plaintext always hashes to the same value', () => {
    const { plaintext } = generateApiToken();
    expect(hashApiToken(plaintext)).toBe(hashApiToken(plaintext));
  });

  it('different plaintexts never collide (200 generations)', () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      hashes.add(hashApiToken(generateApiToken().plaintext));
    }
    expect(hashes.size).toBe(200);
  });
});
