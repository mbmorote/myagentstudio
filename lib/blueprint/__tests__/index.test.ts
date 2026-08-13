/**
 * lib/blueprint/__tests__/index.test.ts
 *
 * lib/blueprint/index.ts is a pure re-export barrel (the only import surface
 * blueprint consumers are meant to use) — this just confirms every re-export is
 * actually wired through, not lost/renamed by the barrel.
 */

import { describe, expect, it } from 'vitest';
import * as blueprint from '../index.js';

describe('lib/blueprint barrel exports', () => {
  it('re-exports the catalog data', () => {
    expect(Array.isArray(blueprint.PLATFORM_DEFS)).toBe(true);
    expect(Array.isArray(blueprint.CONFIG_DEFS)).toBe(true);
    expect(blueprint.CONFIG_DEFS.length).toBeGreaterThan(0);
  });

  it('re-exports Rules with all its rule functions', () => {
    expect(typeof blueprint.Rules.renderHeading).toBe('function');
    expect(typeof blueprint.Rules.configDatatypeFor).toBe('function');
    expect(typeof blueprint.Rules.sectionDefFor).toBe('function');
    expect(typeof blueprint.Rules.computeValidation).toBe('function');
  });

  it('re-exports renderBlueprintForPrompt', () => {
    expect(typeof blueprint.renderBlueprintForPrompt).toBe('function');
  });
});
