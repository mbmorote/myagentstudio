/**
 * lib/blueprint/__tests__/catalog.test.ts
 *
 * Structural sanity checks on the static CONFIG_DEFS / PLATFORM_DEFS catalog data.
 * No I/O, no mocks — this is declarative data, not logic, so the checks are about
 * internal consistency (unique keys, valid datatypes, allowedValues shape) rather
 * than behavior.
 */

import { describe, expect, it } from 'vitest';
import { CONFIG_DEFS, PLATFORM_DEFS } from '../catalog.js';

const VALID_DATATYPES = new Set(['string', 'enum', 'int', 'bool', 'list', 'json', 'any']);

describe('PLATFORM_DEFS', () => {
  it('contains the claude platform', () => {
    expect(PLATFORM_DEFS.some((p) => p.key === 'claude')).toBe(true);
  });

  it('has unique keys', () => {
    const keys = PLATFORM_DEFS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('CONFIG_DEFS', () => {
  it('has unique keys', () => {
    const keys = CONFIG_DEFS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry has a known datatype', () => {
    for (const def of CONFIG_DEFS) {
      expect(VALID_DATATYPES.has(def.datatype)).toBe(true);
    }
  });

  it('every entry with allowedValues declares a non-empty array', () => {
    for (const def of CONFIG_DEFS) {
      if (def.allowedValues !== null) {
        expect(Array.isArray(def.allowedValues)).toBe(true);
        expect((def.allowedValues as readonly string[]).length).toBeGreaterThan(0);
      }
    }
  });

  it('enum entries declare allowedValues (nothing to pick from otherwise)', () => {
    for (const def of CONFIG_DEFS) {
      if (def.datatype === 'enum') {
        expect(def.allowedValues).not.toBeNull();
      }
    }
  });

  it('the model key includes the documented default alias "inherit"', () => {
    const model = CONFIG_DEFS.find((d) => d.key === 'model');
    expect(model?.allowedValues).toContain('inherit');
  });

  it('hooks and mcpServers use datatype json (the real nested-object escape hatch)', () => {
    const hooks = CONFIG_DEFS.find((d) => d.key === 'hooks');
    const mcpServers = CONFIG_DEFS.find((d) => d.key === 'mcpServers');
    expect(hooks?.datatype).toBe('json');
    expect(mcpServers?.datatype).toBe('json');
  });
});
