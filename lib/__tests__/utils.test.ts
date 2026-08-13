/**
 * lib/__tests__/utils.test.ts
 *
 * Unit tests for cn() — the clsx + tailwind-merge class-name combiner.
 */

import { describe, expect, it } from 'vitest';
import { cn } from '../utils.js';

describe('cn', () => {
  it('joins plain string classes', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, '', 'b')).toBe('a b');
  });

  it('applies conditional object syntax', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });

  it('merges conflicting Tailwind classes, keeping the last one', () => {
    // tailwind-merge's whole job: later conflicting utility wins.
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('keeps non-conflicting classes from multiple arguments', () => {
    expect(cn('flex', 'items-center', 'p-2')).toBe('flex items-center p-2');
  });
});
