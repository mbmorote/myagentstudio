/**
 * lib/blueprint/__tests__/rules.test.ts
 *
 * Unit tests for the pure rule functions in lib/blueprint/rules.ts. No I/O, no
 * mocks — computeValidation/renderHeading/configDatatypeFor/sectionDefFor are
 * pure functions over the in-code catalog + real SECTION_DEFS seed data.
 */

import { describe, expect, it } from 'vitest';
import { Rules } from '../rules.js';
import { SECTION_DEFS } from '../../db/sectionDefsSeed.js';

describe('Rules.renderHeading', () => {
  it('returns a heading string verbatim', () => {
    expect(Rules.renderHeading('# CUSTOM HEADING')).toBe('# CUSTOM HEADING');
  });

  it('resolves a known sectionKey to its catalog defaultHeading', () => {
    expect(Rules.renderHeading('role')).toBe('# ROLE');
  });

  it('synthesizes a heading for an unknown sectionKey', () => {
    expect(Rules.renderHeading('some-custom-key')).toBe('# SOME-CUSTOM-KEY');
  });
});

describe('Rules.configDatatypeFor', () => {
  it('returns the real datatype for a known key', () => {
    expect(Rules.configDatatypeFor('model')).toBe('enum');
    expect(Rules.configDatatypeFor('tools')).toBe('list');
    expect(Rules.configDatatypeFor('maxTurns')).toBe('int');
  });

  it('returns "any" for an unknown key', () => {
    expect(Rules.configDatatypeFor('totally_made_up_key')).toBe('any');
  });
});

describe('Rules.sectionDefFor', () => {
  it('returns the SectionDef for a known key', () => {
    const def = Rules.sectionDefFor('role');
    expect(def?.defaultHeading).toBe('# ROLE');
  });

  it('returns undefined for an unknown key', () => {
    expect(Rules.sectionDefFor('not-a-real-section')).toBeUndefined();
  });

  it('every real SECTION_DEFS entry round-trips through sectionDefFor', () => {
    for (const def of SECTION_DEFS) {
      expect(Rules.sectionDefFor(def.key)).toEqual(def);
    }
  });
});

describe('Rules.computeValidation', () => {
  it('flags a missing/blank description', () => {
    expect(Rules.computeValidation({ name: 'x', description: '', config: [] }).descriptionMissing).toBe(true);
    expect(Rules.computeValidation({ name: 'x', description: '   ', config: [] }).descriptionMissing).toBe(true);
    expect(
      Rules.computeValidation({ name: 'x', description: 'a real description', config: [] }).descriptionMissing,
    ).toBe(false);
  });

  it('flags a config key not in CONFIG_DEFS as unknown', () => {
    const result = Rules.computeValidation({
      name: 'x',
      description: 'y',
      config: [{ propKey: 'not_a_real_prop', value: 'z' }],
    });
    expect(result.unknownConfigKeys).toEqual(['not_a_real_prop']);
  });

  it('does not flag a known config key as unknown', () => {
    const result = Rules.computeValidation({
      name: 'x',
      description: 'y',
      config: [{ propKey: 'model', value: 'opus' }],
    });
    expect(result.unknownConfigKeys).toEqual([]);
  });

  it('flags a scalar (enum) value not in allowedValues as outdated/unknown', () => {
    const result = Rules.computeValidation({
      name: 'x',
      description: 'y',
      config: [{ propKey: 'model', value: 'claude-sonnet-4-6' }],
    });
    expect(result.outdatedOrUnknownValues).toEqual([{ propKey: 'model', value: 'claude-sonnet-4-6' }]);
  });

  it('does not flag a valid enum value', () => {
    const result = Rules.computeValidation({
      name: 'x',
      description: 'y',
      config: [{ propKey: 'model', value: 'opus' }],
    });
    expect(result.outdatedOrUnknownValues).toEqual([]);
  });

  it('flags a list value containing an entry not in allowedValues', () => {
    const result = Rules.computeValidation({
      name: 'x',
      description: 'y',
      config: [{ propKey: 'tools', value: ['Read', 'Create'] }],
    });
    expect(result.outdatedOrUnknownValues).toEqual([{ propKey: 'tools', value: ['Read', 'Create'] }]);
  });

  it('does not flag a list value whose every entry is valid', () => {
    const result = Rules.computeValidation({
      name: 'x',
      description: 'y',
      config: [{ propKey: 'tools', value: ['Read', 'Edit'] }],
    });
    expect(result.outdatedOrUnknownValues).toEqual([]);
  });

  it('never flags a key with allowedValues:null (e.g. maxTurns) regardless of value', () => {
    const result = Rules.computeValidation({
      name: 'x',
      description: 'y',
      config: [{ propKey: 'maxTurns', value: 'literally anything' }],
    });
    expect(result.outdatedOrUnknownValues).toEqual([]);
  });
});
