/**
 * lib/auth/__tests__/inviteCode.test.ts
 *
 * Tests for lib/auth/inviteCode.ts (§10.3).
 *
 * Cases:
 *   - Generated format matches ^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$
 *   - Excluded characters (I, L, O, 0, 1) never appear across many generations
 *   - normalizeInviteCode accepts lowercase, missing dashes, surrounding whitespace
 *   - normalizeInviteCode rejects garbage
 */

import { describe, it, expect } from 'vitest';
import { generateInviteCode, normalizeInviteCode } from '../inviteCode.js';

const CANONICAL_PATTERN = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;
const EXCLUDED_CHARS = /[ILO01]/;

describe('generateInviteCode', () => {
  it('produces a code in the canonical XXXX-XXXX-XXXX-XXXX format', () => {
    const code = generateInviteCode();
    expect(CANONICAL_PATTERN.test(code)).toBe(true);
  });

  it('never contains excluded characters (I, L, O, 0, 1) across 200 generations', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      const chars = code.replace(/-/g, '');
      expect(EXCLUDED_CHARS.test(chars)).toBe(false);
    }
  });

  it('produces unique codes across 50 generations (probabilistic — collision is astronomically unlikely)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      codes.add(generateInviteCode());
    }
    expect(codes.size).toBe(50);
  });
});

describe('normalizeInviteCode', () => {
  it('accepts a code in canonical form unchanged', () => {
    expect(normalizeInviteCode('ABCD-EFGH-JKMN-PQRS')).toBe('ABCD-EFGH-JKMN-PQRS');
  });

  it('accepts lowercase letters and uppercases them', () => {
    expect(normalizeInviteCode('abcd-efgh-jkmn-pqrs')).toBe('ABCD-EFGH-JKMN-PQRS');
  });

  it('accepts a code without dashes and inserts them', () => {
    expect(normalizeInviteCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS');
  });

  it('strips surrounding whitespace', () => {
    expect(normalizeInviteCode('  ABCD-EFGH-JKMN-PQRS  ')).toBe('ABCD-EFGH-JKMN-PQRS');
  });

  it('rejects a code with excluded character I', () => {
    expect(normalizeInviteCode('ABCD-EFGH-IJKL-MNPQ')).toBeNull();
  });

  it('rejects a code with excluded character L', () => {
    expect(normalizeInviteCode('ABCD-EFGL-JKMN-PQRS')).toBeNull();
  });

  it('rejects a code with excluded character O', () => {
    expect(normalizeInviteCode('ABCD-EFGO-JKMN-PQRS')).toBeNull();
  });

  it('rejects a code with excluded character 0 (zero)', () => {
    expect(normalizeInviteCode('ABCD-0FGH-JKMN-PQRS')).toBeNull();
  });

  it('rejects a code with excluded character 1 (one)', () => {
    expect(normalizeInviteCode('ABCD-1FGH-JKMN-PQRS')).toBeNull();
  });

  it('rejects a completely invalid string', () => {
    expect(normalizeInviteCode('hello world')).toBeNull();
    expect(normalizeInviteCode('')).toBeNull();
    expect(normalizeInviteCode('TOO-SHORT')).toBeNull();
    expect(normalizeInviteCode('ABCD-EFGH-JKMN-PQRS-EXTRA')).toBeNull();
  });
});
