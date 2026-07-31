/**
 * lib/auth/__tests__/password.test.ts
 *
 * Tests for lib/auth/password.ts (§10.3).
 *
 * Cases:
 *   - hash → verify true
 *   - wrong password → false
 *   - '' sentinel never verifies
 *   - < 12 chars → rejected
 *   - > 72 bytes → rejected (incl. a multi-byte UTF-8 case short in chars but long in bytes)
 */

import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
} from '../password.js';

describe('validatePasswordPolicy', () => {
  it('accepts a valid password (≥ 12 chars, ≤ 72 bytes)', () => {
    expect(validatePasswordPolicy('correct-horse-battery-staple')).toEqual({ ok: true });
  });

  it('rejects a password shorter than 12 characters', () => {
    const result = validatePasswordPolicy('short');
    expect(result).toEqual({ ok: false, reason: 'weak_password', minLength: 12 });
  });

  it('rejects a password of exactly 11 characters', () => {
    const result = validatePasswordPolicy('a'.repeat(11));
    expect(result).toEqual({ ok: false, reason: 'weak_password', minLength: 12 });
  });

  it('accepts a password of exactly 12 characters', () => {
    expect(validatePasswordPolicy('a'.repeat(12))).toEqual({ ok: true });
  });

  it('rejects a password exceeding 72 bytes in UTF-8', () => {
    const longPassword = 'a'.repeat(73);  // 73 ASCII chars = 73 bytes
    const result = validatePasswordPolicy(longPassword);
    expect(result).toEqual({ ok: false, reason: 'password_too_long', maxBytes: 72 });
  });

  it('accepts a password of exactly 72 bytes', () => {
    expect(validatePasswordPolicy('a'.repeat(72))).toEqual({ ok: true });
  });

  it('rejects a password that is short in characters but > 72 bytes (multi-byte UTF-8)', () => {
    // Each '🔑' emoji is 4 bytes; 19 of them = 76 bytes but only 19 chars
    const emojiPassword = '🔑'.repeat(19);
    expect(emojiPassword.length).toBeLessThanOrEqual(72);  // char count ≤ 72
    const byteLen = new TextEncoder().encode(emojiPassword).length;
    expect(byteLen).toBeGreaterThan(72);  // byte count > 72

    const result = validatePasswordPolicy(emojiPassword);
    expect(result).toEqual({ ok: false, reason: 'password_too_long', maxBytes: 72 });
  });
});

describe('hashPassword / verifyPassword', () => {
  it('hash → verify returns true for the correct password', async () => {
    const pw = 'correct-horse-battery-staple';
    const hash = await hashPassword(pw);
    expect(typeof hash).toBe('string');
    expect(hash.startsWith('$2')).toBe(true);  // bcrypt prefix

    const ok = await verifyPassword(pw, hash);
    expect(ok).toBe(true);
  });

  it('returns false for the wrong password against a valid hash', async () => {
    const hash = await hashPassword('correct-password-12chars');
    const ok = await verifyPassword('wrong-password-12chars', hash);
    expect(ok).toBe(false);
  });

  it('returns false for the empty-string sentinel (§8 invariant 9)', async () => {
    // Must never call bcrypt.compare on '' — it must short-circuit
    const ok = await verifyPassword('any-password-whatsoever', '');
    expect(ok).toBe(false);
  });

  it('returns false for a garbage hash string', async () => {
    const ok = await verifyPassword('some-valid-password-12+', 'not-a-bcrypt-hash');
    expect(ok).toBe(false);
  });
});
