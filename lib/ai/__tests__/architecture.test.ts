/**
 * lib/ai/__tests__/architecture.test.ts
 *
 * Fitness function: enforces per-provider transport isolation (Plan 11 §5.4).
 *
 * Reads every .ts/.tsx under lib/, app/, and scripts/ (excluding node_modules,
 * .next, generated, __tests__) and asserts:
 *
 * Single-importer rules (a given string must appear in EXACTLY ONE file):
 *   @anthropic-ai/sdk                → lib/ai/anthropicProvider.ts only
 *
 * Single-owner rules (a given string must NOT appear outside the named file):
 *   getClient(           → anthropicProvider.ts only
 *   .messages.create(    → anthropicProvider.ts only
 *   .messages.stream(    → anthropicProvider.ts only
 *   /v1/chat/completions → openaiCompatibleProvider.ts only
 *     (guards the OpenAI-compatible endpoint path so a future provider cannot
 *     quietly re-open the transport without registering itself properly)
 *
 * DB-import boundary rule:
 *   No file under lib/ai/ except gateway.ts may import from lib/db/.
 *   (gateway.ts is the single choke point; providers and callers are pure transport
 *   or domain logic — they must never reach the DB directly. This rule is documented
 *   in lib/ai/CLAUDE.md and was previously only in docs, not test-enforced.)
 *
 * Table-driven (not hardcoded exceptions) so adding a third provider means adding
 * one row per rule, not rewriting any assertion.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '../../..'); // project root (from lib/ai/__tests__)

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Skip node_modules, .next, generated output, and test directories
      if (['node_modules', '.next', 'generated', '__tests__'].includes(entry)) continue;
      results.push(...collectTsFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

const SOURCE_DIRS = ['lib', 'app', 'scripts'].map((d) => join(ROOT, d));
const files = SOURCE_DIRS.flatMap(collectTsFiles);

// ── Table definitions ──────────────────────────────────────────────────────────

/**
 * Single-importer table: the given pattern (a package name or import string) must
 * appear in EXACTLY the listed file path (relative to root, forward slashes).
 */
const SOLE_IMPORTER_TABLE: Array<{ pattern: string; file: string; description: string }> = [
  {
    pattern: '@anthropic-ai/sdk',
    file: 'lib/ai/anthropicProvider.ts',
    description: 'Anthropic SDK',
  },
];

/**
 * Single-owner table: the given token must NOT appear in any file OTHER than the
 * named owner file basename (compared with endsWith so path separators don't matter).
 */
const SOLE_OWNER_TABLE: Array<{ token: string; owner: string; description: string }> = [
  { token: 'getClient(',            owner: 'anthropicProvider.ts', description: 'Anthropic getClient()' },
  { token: '.messages.create(',     owner: 'anthropicProvider.ts', description: 'Anthropic .messages.create()' },
  { token: '.messages.stream(',     owner: 'anthropicProvider.ts', description: 'Anthropic .messages.stream()' },
  {
    token: '/v1/chat/completions',
    owner: 'openaiCompatibleProvider.ts',
    description: 'OpenAI-compatible completions path',
  },
];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Architecture fitness — provider transport isolation', () => {
  // Single-importer assertions
  for (const { pattern, file, description } of SOLE_IMPORTER_TABLE) {
    it(`exactly one file imports "${pattern}" (${description})`, () => {
      const importers = files.filter((f) => readFileSync(f, 'utf8').includes(pattern));
      const relPaths = importers.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
      expect(relPaths).toEqual([file]);
    });
  }

  // Single-owner assertions
  for (const { token, owner, description } of SOLE_OWNER_TABLE) {
    it(`"${token}" does not appear outside ${owner} (${description})`, () => {
      const violators = files.filter((f) => {
        if (f.endsWith(owner)) return false;
        return readFileSync(f, 'utf8').includes(token);
      });
      const relPaths = violators.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
      expect(relPaths).toEqual([]);
    });
  }

  // DB-import boundary: no lib/ai file except gateway.ts may import from lib/db/
  it('no lib/ai file except gateway.ts imports from lib/db/', () => {
    const aiSourceFiles = files.filter((f) => {
      const rel = relative(ROOT, f).replaceAll('\\', '/');
      return rel.startsWith('lib/ai/');
    });
    const violators = aiSourceFiles.filter((f) => {
      if (f.endsWith('gateway.ts')) return false;
      const src = readFileSync(f, 'utf8');
      // Type-only imports (e.g. daedalus.ts's `import type { SectionDefLite }`) are
      // erased at compile time and create no runtime coupling to lib/db — that's the
      // established, documented pattern (a caller receives a DB-owned type through its
      // function signature; the route, not the caller, owns the actual DB read). Only a
      // runtime import would violate the boundary this rule enforces, so type-only
      // import lines are excluded before searching.
      const runtimeSrc = src
        .split('\n')
        .filter((line) => !/^\s*import\s+type\s/.test(line))
        .join('\n');
      // Both single- and double-quoted relative imports from lib/db/ look like
      // '../db/' in any lib/ai/ file (one directory up, then into db/).
      return runtimeSrc.includes("'../db/") || runtimeSrc.includes('"../db/');
    });
    const relPaths = violators.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual([]);
  });
});
