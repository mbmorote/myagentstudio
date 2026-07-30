/**
 * lib/ai/__tests__/architecture.test.ts
 *
 * Fitness function: enforces the single-SDK-importer invariant (§10.2, constraint 1).
 *
 * Reads every .ts/.tsx under lib/, app/, and scripts/ and asserts:
 *   - @anthropic-ai/sdk is imported by EXACTLY ONE file: lib/ai/anthropicProvider.ts
 *   - The strings getClient( and .messages.create( / .messages.stream( appear
 *     nowhere outside that file.
 *
 * This is the only durable defense against a future session quietly re-opening
 * a direct SDK path. No new dependency needed — just file I/O.
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
      // Skip node_modules, .next, generated output
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

describe('Architecture fitness — single SDK importer', () => {
  it('exactly one file imports @anthropic-ai/sdk', () => {
    const importers = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes('@anthropic-ai/sdk');
    });
    const relative_paths = importers.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relative_paths).toEqual(['lib/ai/anthropicProvider.ts']);
  });

  it('getClient( does not appear outside anthropicProvider.ts', () => {
    const violators = files.filter((f) => {
      if (f.endsWith('anthropicProvider.ts')) return false;
      return readFileSync(f, 'utf8').includes('getClient(');
    });
    const relative_paths = violators.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relative_paths).toEqual([]);
  });

  it('.messages.create( does not appear outside anthropicProvider.ts', () => {
    const violators = files.filter((f) => {
      if (f.endsWith('anthropicProvider.ts')) return false;
      return readFileSync(f, 'utf8').includes('.messages.create(');
    });
    const relative_paths = violators.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relative_paths).toEqual([]);
  });

  it('.messages.stream( does not appear outside anthropicProvider.ts', () => {
    const violators = files.filter((f) => {
      if (f.endsWith('anthropicProvider.ts')) return false;
      return readFileSync(f, 'utf8').includes('.messages.stream(');
    });
    const relative_paths = violators.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relative_paths).toEqual([]);
  });
});
