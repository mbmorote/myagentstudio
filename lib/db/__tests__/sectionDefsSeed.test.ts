/**
 * lib/db/__tests__/sectionDefsSeed.test.ts
 *
 * Structural sanity checks on the static SECTION_DEFS bootstrap-seed data.
 * Pure data, no I/O — checks internal consistency, not behavior.
 */

import { describe, expect, it } from 'vitest';
import { SECTION_DEFS } from '../sectionDefsSeed.js';

describe('SECTION_DEFS', () => {
  it('has unique keys', () => {
    const keys = SECTION_DEFS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has unique defaultOrder values', () => {
    const orders = SECTION_DEFS.map((d) => d.defaultOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('every defaultHeading is a real markdown heading', () => {
    for (const def of SECTION_DEFS) {
      expect(def.defaultHeading.startsWith('# ')).toBe(true);
    }
  });

  it('every entry has non-empty helpText', () => {
    for (const def of SECTION_DEFS) {
      expect(def.helpText.length).toBeGreaterThan(0);
    }
  });

  it('the four canonical core sections (role, behavior, guardrails, output) are all isCore', () => {
    const coreKeys = ['role', 'behavior', 'guardrails', 'output'];
    for (const key of coreKeys) {
      const def = SECTION_DEFS.find((d) => d.key === key);
      expect(def?.isCore).toBe(true);
    }
  });

  it('core sections sort before optional sections by defaultOrder', () => {
    const sorted = [...SECTION_DEFS].sort((a, b) => a.defaultOrder - b.defaultOrder);
    const firstOptionalIndex = sorted.findIndex((d) => !d.isCore);
    // Every entry after the first optional one must also be non-core —
    // i.e. no core section appears after an optional one in order.
    for (let i = firstOptionalIndex; i < sorted.length; i++) {
      expect(sorted[i].isCore).toBe(false);
    }
  });

  it('guardrails uses the corrected "# GUARDRAILS" heading, not the old "# RULES"', () => {
    const guardrails = SECTION_DEFS.find((d) => d.key === 'guardrails');
    expect(guardrails?.defaultHeading).toBe('# GUARDRAILS');
  });
});
