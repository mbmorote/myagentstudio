/**
 * lib/email/__tests__/architecture.test.ts
 *
 * Fitness function for the email subsystem (Plan 14, §4.10). Table-driven so a
 * second provider adds a row rather than an exception — same shape as
 * lib/ai/__tests__/architecture.test.ts and lib/mcp/__tests__/architecture.test.ts.
 *
 * Reads every .ts/.tsx under lib/ and app/ (excluding node_modules, .next,
 * generated, __tests__) and asserts:
 *
 *   - Transport isolation: 'api.resend.com' appears in exactly lib/email/resendProvider.ts.
 *   - DB boundary: no file under lib/email/ except gateway.ts imports from lib/db/.
 *   - Single choke point: no route/component/lib file outside lib/email/ calls
 *     provider.send( directly or constructs a provider itself.
 *   - No body persistence: writeEmailLog( is called only from gateway.ts, and
 *     WriteEmailLogInput carries no body/html field at all (structural, on the type).
 *   - Templates stay pure: no file under lib/email/templates/ imports lib/db/ or lib/env.js.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '../../..'); // project root (from lib/email/__tests__)

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
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

function relPath(f: string): string {
  return relative(ROOT, f).replaceAll('\\', '/');
}

describe('Architecture fitness — email subsystem isolation', () => {
  it("exactly one file contains 'api.resend.com' (transport isolation)", () => {
    const owners = files.filter((f) => readFileSync(f, 'utf8').includes('api.resend.com'));
    expect(owners.map(relPath)).toEqual(['lib/email/resendProvider.ts']);
  });

  it('no file under lib/email/ except gateway.ts imports from lib/db/', () => {
    const emailFiles = files.filter((f) => relPath(f).startsWith('lib/email/'));
    const violators = emailFiles.filter((f) => {
      if (f.endsWith('gateway.ts')) return false;
      const src = readFileSync(f, 'utf8');
      const runtimeSrc = src
        .split('\n')
        .filter((line) => !/^\s*import\s+type\s/.test(line))
        .join('\n');
      return runtimeSrc.includes("'../db/") || runtimeSrc.includes('"../db/');
    });
    expect(violators.map(relPath)).toEqual([]);
  });

  it('"provider.send(" (or a direct provider construction) appears in no file outside lib/email/', () => {
    const violators = files.filter((f) => {
      if (relPath(f).startsWith('lib/email/')) return false;
      const src = readFileSync(f, 'utf8');
      return src.includes('provider.send(') || src.includes('createResendProvider(');
    });
    expect(violators.map(relPath)).toEqual([]);
  });

  it('writeEmailLog( is called only from lib/email/gateway.ts', () => {
    const violators = files.filter((f) => {
      const rel = relPath(f);
      if (rel === 'lib/email/gateway.ts') return false;
      if (rel === 'lib/db/repository/emailLog.ts') return false; // defines it, doesn't call it
      if (rel === 'lib/db/repository/__tests__/emailLog.test.ts') return false; // repository-level unit test, not a caller in production shape
      const src = readFileSync(f, 'utf8');
      return src.includes('writeEmailLog(');
    });
    expect(violators.map(relPath)).toEqual([]);
  });

  it('WriteEmailLogInput carries no body/html field — the no-body-persistence constraint is structural', () => {
    const target = files.find((f) => relPath(f) === 'lib/db/repository/emailLog.ts')!;
    const src = readFileSync(target, 'utf8');
    const typeBlockMatch = src.match(/export type WriteEmailLogInput = \{[\s\S]*?\};/);
    expect(typeBlockMatch).not.toBeNull();
    const typeBlock = typeBlockMatch![0];
    expect(/\bhtml\b/i.test(typeBlock)).toBe(false);
    expect(/\bbody\b/i.test(typeBlock)).toBe(false);
  });

  it('no file under lib/email/templates/ imports lib/db/ or lib/env.js', () => {
    const templateFiles = files.filter((f) => relPath(f).startsWith('lib/email/templates/'));
    const violators = templateFiles.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes("'../../db/") || src.includes('"../../db/')
        || src.includes("'../../env.js'") || src.includes('"../../env.js"');
    });
    expect(violators.map(relPath)).toEqual([]);
  });
});
