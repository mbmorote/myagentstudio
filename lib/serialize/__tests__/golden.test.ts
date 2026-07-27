/**
 * lib/serialize/__tests__/golden.test.ts
 *
 * THE golden-file round-trip harness — the most important test in the project.
 *
 * Gate 1: this must be green before Phase 2 starts.
 *
 * Asserts:
 * 1. parse(exportAgent(parse(md))) deep-equals parse(md) for every one of the
 *    15 real agent fixtures.
 * 2. orchestrator.md splits at the ## level (splitLevel === 2).
 * 3. scribe.md has a heading:null, order:0 block (bare-prose preamble).
 * 4. ux.md has a heading:null, order:0 block (bare-prose preamble).
 * 5. zara.md's agent name is stored verbatim as "Zara" (capital Z).
 * 6. Any model: value in the real fixture files is stored as a string
 *    (FAILSAFE_SCHEMA — no YAML float/bool coercion).
 *
 * These six assertions discharge Rules Index #1–#6.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { parse } from '../importParse.js';
import { exportAgent } from '../export.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

const FIXTURE_NAMES = [
  'ada',
  'analyst',
  'architect',
  'aria',
  'codeauditor',
  'datasync',
  'dev',
  'impact',
  'mobile',
  'notion',
  'orchestrator',
  'qa',
  'scribe',
  'ux',
  'zara',
] as const;

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, `${name}.md`), 'utf8');
}

// ─────────────────────────────  Round-trip suite  ─────────────────────────────

describe('golden round-trip', () => {
  for (const name of FIXTURE_NAMES) {
    it(`parse(exportAgent(parse(md))) deep-equals parse(md) — ${name}`, () => {
      const md = readFixture(name);
      const first = parse(md);
      const exported = exportAgent(first);
      const second = parse(exported);

      expect(second).toEqual(first);
    });
  }
});

// ─────────────────────────────  Targeted edge-case asserts  ───────────────────

describe('targeted asserts', () => {
  it('orchestrator.md splits on ## (splitLevel === 2)', () => {
    const md = readFixture('orchestrator');
    const result = parse(md);
    expect(result.splitLevel).toBe(2);
  });

  it('scribe.md has a heading:null order:0 block (bare-prose preamble)', () => {
    const md = readFixture('scribe');
    const result = parse(md);
    const block0 = result.blocks.find((b) => b.order === 0);
    expect(block0).toBeDefined();
    expect(block0!.heading).toBeNull();
  });

  it('ux.md has a heading:null order:0 block (bare-prose preamble)', () => {
    const md = readFixture('ux');
    const result = parse(md);
    const block0 = result.blocks.find((b) => b.order === 0);
    expect(block0).toBeDefined();
    expect(block0!.heading).toBeNull();
  });

  it("zara.md's name is stored verbatim as 'Zara' (capital Z)", () => {
    const md = readFixture('zara');
    const result = parse(md);
    const nameEntry = result.frontmatter.find((e) => e.key === 'name');
    expect(nameEntry).toBeDefined();
    expect(nameEntry!.rawValue).toBe('Zara');
  });

  it('any model: value in fixture files stays a string (no YAML coercion)', () => {
    for (const name of FIXTURE_NAMES) {
      const md = readFixture(name);
      const result = parse(md);
      const modelEntry = result.frontmatter.find((e) => e.key === 'model');
      if (modelEntry !== undefined) {
        expect(typeof modelEntry.rawValue, `${name}.md: model rawValue should be a string`).toBe(
          'string',
        );
      }
    }
  });
});
