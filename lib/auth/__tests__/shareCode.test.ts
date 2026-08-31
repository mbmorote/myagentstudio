/**
 * lib/auth/__tests__/shareCode.test.ts
 *
 * Tests for lib/auth/shareCode.ts (Plan 15 §5.1).
 *
 * Structural facts only — no keyword or wording assertions, per this repo's
 * rule that content validation is quantitative, never phrase-matching.
 *
 * Cases:
 *   - Generated codes match the expected format ('shr_' + 43 base64url chars, 47 total)
 *   - 1000 generated codes are all distinct (a smoke check on the RNG wiring,
 *     not a statistical claim)
 */

import { describe, it, expect } from 'vitest';
import { generateShareCode } from '../shareCode.js';

const CODE_PATTERN = /^shr_[A-Za-z0-9_-]{43}$/;

describe('generateShareCode', () => {
  it('produces a code matching the shr_ + 43-char base64url format (47 chars total)', () => {
    const code = generateShareCode();
    expect(code).toHaveLength(47);
    expect(CODE_PATTERN.test(code)).toBe(true);
  });

  it('produces 1000 distinct codes (smoke check on the RNG wiring)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateShareCode());
    }
    expect(seen.size).toBe(1000);
  });
});
