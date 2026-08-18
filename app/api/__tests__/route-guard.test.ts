/**
 * app/api/__tests__/route-guard.test.ts
 *
 * Fitness function (§10.4, extended Plan 13 §4.8): reads every route.ts under app/api/
 * and asserts, via a path-prefix → required-guard table:
 *
 *   1. app/api/auth/**              — no guard required (public by design).
 *   2. app/api/settings/**          — must contain authenticateAdmin(. (llm-call-log/**
 *      moved OUT of this admin-only bucket 2026-08-18 — a non-admin may now call it,
 *      scoped to their own rows inside the handler; it still needs SOME guard, which
 *      the generic assertion 5 below already covers via authenticate(.)
 *   3. app/api/account/**           — must contain authenticate( and must NOT contain
 *                                      authenticateAdmin( — the user settings surface must
 *                                      never acquire an admin gate by copy-paste (§5.7).
 *   4. app/api/mcp/**               — must contain authenticateMcpToken( and must NOT
 *                                      contain authenticate( (Plan 13 §4.8) — the MCP
 *                                      endpoint is bearer-token authenticated, never by the
 *                                      browser session cookie a copy-pasted authenticate(
 *                                      call would silently accept. The regex is
 *                                      deliberately NOT widened to also match
 *                                      authenticateMcpToken( under the generic
 *                                      authenticate( check — a rule that passes by
 *                                      coincidence is a rule that has stopped testing
 *                                      anything.
 *   5. everything else              — must contain authenticate( or authenticateAdmin(.
 *
 * Also: no 'use client' file under app/ calls a bare fetch('/api/ — they must use
 * apiFetch (assertion 4 below, apiFetch migration is complete).
 *
 * No mocks — pure file I/O. Kept short so it is easy to understand and maintain.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, extname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// From app/api/__tests__/ → app/api/ is one level up
const API_DIR = join(__dirname, '..');
// From app/api/__tests__/ → root is three levels up
const ROOT = join(__dirname, '../../..');

// ── File collection ────────────────────────────────────────────────────────────

function collectRouteFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === '.next') continue;
      results.push(...collectRouteFiles(full));
    } else if (entry === 'route.ts') {
      results.push(full);
    }
  }
  return results;
}

const allRouteFiles = collectRouteFiles(API_DIR);

function inAuthDir(absPath: string): boolean {
  const rel = relative(API_DIR, absPath);
  return rel.startsWith('auth' + sep) || rel === 'auth';
}

function inAdminOnlyDir(absPath: string): boolean {
  const rel = relative(API_DIR, absPath);
  // llm-call-log/** deliberately excluded (2026-08-18) — it's authenticate(-guarded
  // and scopes non-admins to their own rows internally, not admin-only anymore.
  return rel.startsWith('settings' + sep);
}

function inAccountDir(absPath: string): boolean {
  const rel = relative(API_DIR, absPath);
  return rel.startsWith('account' + sep);
}

function inMcpDir(absPath: string): boolean {
  const rel = relative(API_DIR, absPath);
  return rel.startsWith('mcp' + sep) || rel === 'mcp';
}

// ── Fitness assertions ─────────────────────────────────────────────────────────

describe('Route-guard fitness — every non-auth route is guarded', () => {
  const nonAuthRoutes = allRouteFiles.filter((f) => !inAuthDir(f));
  // mcp/** is guarded by a different function entirely (authenticateMcpToken() —
  // Plan 13 §4.8) — excluded from the generic authenticate(/authenticateAdmin( check
  // below and asserted separately instead.
  const nonAuthNonMcpRoutes = nonAuthRoutes.filter((f) => !inMcpDir(f));

  it('every non-auth, non-mcp route.ts contains authenticate( or authenticateAdmin(', () => {
    const unguarded = nonAuthNonMcpRoutes.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return !src.includes('authenticate(') && !src.includes('authenticateAdmin(');
    });
    const relPaths = unguarded.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual([]);
  });

  it('settings/** uses authenticateAdmin( (not just authenticate()', () => {
    const adminRoutes = nonAuthRoutes.filter((f) => inAdminOnlyDir(f));
    const missingAdminGuard = adminRoutes.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return !src.includes('authenticateAdmin(');
    });
    const relPaths = missingAdminGuard.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual([]);
  });

  it('account/** uses authenticate( and does NOT use authenticateAdmin(', () => {
    const accountRoutes = nonAuthRoutes.filter((f) => inAccountDir(f));
    // At least one account route must exist (fail loudly if the whole surface is missing)
    expect(accountRoutes.length).toBeGreaterThan(0);

    const missingUserGuard = accountRoutes.filter((f) => !readFileSync(f, 'utf8').includes('authenticate('));
    const hasAdminGuard = accountRoutes.filter((f) => readFileSync(f, 'utf8').includes('authenticateAdmin('));

    const missingPaths = missingUserGuard.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    const adminPaths = hasAdminGuard.map((f) => relative(ROOT, f).replaceAll('\\', '/'));

    expect(missingPaths).toEqual([]);
    expect(adminPaths).toEqual([]);
  });

  it('mcp/** uses authenticateMcpToken( and does NOT use authenticate( (Plan 13 §4.8)', () => {
    const mcpRoutes = allRouteFiles.filter((f) => inMcpDir(f));
    // At least one mcp route must exist (fail loudly if the whole surface is missing)
    expect(mcpRoutes.length).toBeGreaterThan(0);

    const missingMcpGuard = mcpRoutes.filter((f) => !readFileSync(f, 'utf8').includes('authenticateMcpToken('));
    // Deliberately NOT a substring check that could accidentally match
    // authenticateMcpToken( — this asserts the literal session-cookie guard call
    // authenticate( is absent, not merely that some prefix overlaps.
    const hasSessionGuard = mcpRoutes.filter((f) => readFileSync(f, 'utf8').includes('authenticate('));

    const missingPaths = missingMcpGuard.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    const sessionGuardPaths = hasSessionGuard.map((f) => relative(ROOT, f).replaceAll('\\', '/'));

    expect(missingPaths).toEqual([]);
    expect(sessionGuardPaths).toEqual([]);
  });
});

// ── Phase 0 fitness (Plan 06 §10.4) ───────────────────────────────────────────

/**
 * Assertion 1 — One JWT verifier (constraint 1, §3.1).
 *
 * Only lib/auth/jwt.ts may import jwtVerify or SignJWT from 'jose'.
 * middleware.ts must not contain the literal string 'jwtVerify(' — it
 * must call verifySessionToken() from lib/auth/jwt instead.
 *
 * This stops the §3.1 duplication from growing back silently.
 */
describe('Phase 0 fitness — single JWT verifier', () => {
  function collectSourceFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      // Skip __tests__ dirs so test helpers that use SignJWT for fixtures don't trip this
      if (['node_modules', '.next', 'generated', '__tests__'].includes(entry)) continue;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...collectSourceFiles(full));
      } else if (/\.(ts|tsx)$/.test(entry)) {
        results.push(full);
      }
    }
    return results;
  }

  const SOURCE_DIRS = ['lib', 'app', 'scripts'].map((d) => join(ROOT, d));
  const sourceFiles = SOURCE_DIRS.flatMap(collectSourceFiles);

  // lib/auth/jwt.ts — session-token sign / verify
  // lib/auth/oauth/google.ts — OIDC id_token verify (added Phase 1, Plan 06 §3.6)
  const ALLOWED_JOSE_IMPORTERS = new Set([
    join(ROOT, 'lib', 'auth', 'jwt.ts'),
    join(ROOT, 'lib', 'auth', 'oauth', 'google.ts'),
  ]);

  it('only lib/auth/jwt.ts and lib/auth/oauth/google.ts import jwtVerify or SignJWT from jose', () => {
    const violations = sourceFiles.filter((f) => {
      if (ALLOWED_JOSE_IMPORTERS.has(f)) return false;
      const src = readFileSync(f, 'utf8');
      return (src.includes('jwtVerify') || src.includes('SignJWT')) &&
             (src.includes("from 'jose'") || src.includes('from "jose"'));
    });
    const relPaths = violations.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual([]);
  });

  it('SignJWT is only in lib/auth/jwt.ts (session-token signing is a single file)', () => {
    const JWT_FILE = join(ROOT, 'lib', 'auth', 'jwt.ts');
    const violations = sourceFiles.filter((f) => {
      if (f === JWT_FILE) return false;
      const src = readFileSync(f, 'utf8');
      return src.includes('SignJWT') &&
             (src.includes("from 'jose'") || src.includes('from "jose"'));
    });
    const relPaths = violations.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual([]);
  });

  it('middleware.ts does not contain jwtVerify( — it calls verifySessionToken() instead', () => {
    const middlewareSrc = readFileSync(join(ROOT, 'middleware.ts'), 'utf8');
    expect(middlewareSrc).not.toContain('jwtVerify(');
    expect(middlewareSrc).toContain('verifySessionToken(');
  });
});

/**
 * Assertion 2 — Middleware's import closure is Edge-clean (constraint 3, §3.1).
 *
 * Starting from middleware.ts, follows every relative and @/-aliased import
 * transitively. Asserts:
 *   (a) No resolved file path falls under lib/db/
 *   (b) No file in the closure imports from next/headers, bcryptjs, or node:*
 *
 * This is the guard against the next person wiring middleware to something that
 * only runs on Node — a broken Edge build discovered at deploy time, not in tests.
 */
describe('Phase 0 fitness — middleware import closure is Edge-clean', () => {
  /** Resolve a local import specifier to an absolute .ts path, or null if not local. */
  function resolveSpecifier(specifier: string, fromFile: string): string | null {
    let candidate: string | null = null;

    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      // Relative import
      let p = join(dirname(fromFile), specifier);
      if (p.endsWith('.js')) p = p.slice(0, -3) + '.ts';
      else if (p.endsWith('.tsx')) { /* keep */ }
      else if (!extname(p)) p += '.ts';
      candidate = existsSync(p) ? p : null;
    } else if (specifier.startsWith('@/')) {
      // @/ alias → project root
      let p = join(ROOT, specifier.slice(2));
      if (p.endsWith('.js')) p = p.slice(0, -3) + '.ts';
      else if (!extname(p)) {
        const ts = p + '.ts';
        const tsx = p + '.tsx';
        p = existsSync(ts) ? ts : existsSync(tsx) ? tsx : p;
      }
      candidate = existsSync(p) ? p : null;
    }
    // else: npm package — not a local file

    return candidate;
  }

  /** Walk the transitive import closure of a file. Returns absolute paths of all reached files. */
  function buildClosure(startFile: string): Set<string> {
    const visited = new Set<string>();
    const queue = [startFile];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (visited.has(file)) continue;
      visited.add(file);

      let src: string;
      try {
        src = readFileSync(file, 'utf8');
      } catch {
        continue;
      }

      const importRegex = /from\s+['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = importRegex.exec(src)) !== null) {
        const resolved = resolveSpecifier(m[1], file);
        if (resolved && !visited.has(resolved)) queue.push(resolved);
      }

      // Also capture side-effect imports: import 'specifier'
      const sideEffectRegex = /^import\s+['"]([^'"]+)['"]/gm;
      while ((m = sideEffectRegex.exec(src)) !== null) {
        const resolved = resolveSpecifier(m[1], file);
        if (resolved && !visited.has(resolved)) queue.push(resolved);
      }
    }
    return visited;
  }

  const MIDDLEWARE = join(ROOT, 'middleware.ts');
  const LIB_DB = join(ROOT, 'lib', 'db') + sep;

  it('no file in the middleware closure resolves under lib/db/', () => {
    const closure = buildClosure(MIDDLEWARE);
    const violations = [...closure].filter((f) => f.startsWith(LIB_DB));
    const relPaths = violations.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual([]);
  });

  it('no file in the middleware closure imports next/headers, bcryptjs, or node:*', () => {
    const closure = buildClosure(MIDDLEWARE);
    const FORBIDDEN = [
      { label: 'next/headers', test: (src: string) => /from\s+['"]next\/headers['"]/.test(src) },
      { label: 'bcryptjs', test: (src: string) => /from\s+['"]bcryptjs['"]/.test(src) },
      { label: 'node:*', test: (src: string) => /from\s+['"]node:/.test(src) || /import\s+['"]node:/.test(src) },
    ];

    const violations: string[] = [];
    for (const file of closure) {
      let src: string;
      try { src = readFileSync(file, 'utf8'); } catch { continue; }
      for (const { label, test } of FORBIDDEN) {
        if (test(src)) {
          violations.push(`${relative(ROOT, file).replaceAll('\\', '/')} (imports ${label})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ── Phase 1 fitness (Plan 06 §10.4) ───────────────────────────────────────────

/**
 * Assertion 3 — One arctic importer (constraints 9 and 11).
 *
 * `arctic` is imported by exactly `lib/auth/oauth/google.ts`.
 * No other source file and no test file may import it directly.
 *
 * Modelled on lib/ai/__tests__/architecture.test.ts's one-SDK-importer test —
 * the same fitness-function pattern applied to middleware.ts's import graph.
 */
describe('Phase 1 fitness — single arctic importer', () => {
  /** Non-test source files — mirrors the helper in the Phase 0 block. */
  function collectPhase1SourceFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (['node_modules', '.next', 'generated', '__tests__'].includes(entry)) continue;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...collectPhase1SourceFiles(full));
      } else if (/\.(ts|tsx)$/.test(entry)) {
        results.push(full);
      }
    }
    return results;
  }
  const P1_SOURCE_DIRS = ['lib', 'app', 'scripts'].map((d) => join(ROOT, d));
  const p1SourceFiles = P1_SOURCE_DIRS.flatMap(collectPhase1SourceFiles);

  const ALLOWED_ARCTIC_IMPORTER = join(ROOT, 'lib', 'auth', 'oauth', 'google.ts');

  /** Returns true if `src` contains an ES import statement that imports from 'arctic'. */
  function importsArctic(src: string): boolean {
    return /^\s*import\s[^;]+from\s+['"]arctic['"]/m.test(src);
  }

  it('arctic is imported by exactly lib/auth/oauth/google.ts and no other source file', () => {
    const violations = p1SourceFiles.filter((f) => {
      if (f === ALLOWED_ARCTIC_IMPORTER) return false;
      return importsArctic(readFileSync(f, 'utf8'));
    });
    const relPaths = violations.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual([]);
  });

  it('no test file directly imports arctic (constraint 11)', () => {
    /** Collects .test.ts files under __tests__/ directories. */
    function collectTestFiles(dir: string): string[] {
      const results: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (['node_modules', '.next', 'generated'].includes(entry)) continue;
        const stat = statSync(full);
        if (stat.isDirectory()) {
          results.push(...collectTestFiles(full));
        } else if (/\.test\.(ts|tsx)$/.test(entry)) {
          results.push(full);
        }
      }
      return results;
    }

    const TEST_SOURCE_DIRS = ['lib', 'app', 'scripts'].map((d) => join(ROOT, d));
    const testFiles = TEST_SOURCE_DIRS.flatMap(collectTestFiles);

    const violations = testFiles.filter((f) => importsArctic(readFileSync(f, 'utf8')));
    const relPaths = violations.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual([]);
  });
});

describe('Route-guard fitness — Phase 4 (apiFetch migration)', () => {
  it('no use-client file under app/ calls bare fetch("/api/")', () => {
    // app/login/ and app/signup/ are deliberately excluded: they are the public
    // auth pages that call /api/auth/* endpoints. Those endpoints return 401 to
    // mean "wrong credentials", not "session expired", so using apiFetch there
    // would create a circular redirect (login → 401 → redirect to /login → loop).
    //
    // app/components/Auth/ is also excluded for the same reason (Plan 06 Phase 4):
    // LoginForm.tsx and SignupForm.tsx were split out of the login/signup pages and
    // call the same public /api/auth/login and /api/auth/signup endpoints with bare
    // fetch for the same reason. GoogleButton.tsx in the same directory uses apiFetch
    // correctly, but excluding the whole directory is simpler than per-file exclusions.
    //
    // All other 'use client' files must use apiFetch for /api/ calls (§5.4).
    const AUTH_PAGE_DIRS = ['login', 'signup'];
    const AUTH_COMPONENT_PATHS = ['components/Auth'];

    function collectClientFiles(dir: string): string[] {
      const results: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          if (['node_modules', '.next', '__tests__'].includes(entry)) continue;
          // Skip auth page directories (top-level under app/)
          const relToApp = relative(join(ROOT, 'app'), full).split(sep)[0];
          if (AUTH_PAGE_DIRS.includes(relToApp)) continue;
          // Skip auth component directories (nested under app/components/)
          const relToAppNorm = relative(join(ROOT, 'app'), full).replaceAll(sep, '/');
          if (AUTH_COMPONENT_PATHS.some((p) => relToAppNorm === p || relToAppNorm.startsWith(p + '/'))) continue;
          results.push(...collectClientFiles(full));
        } else if (/\.(ts|tsx)$/.test(entry)) {
          const src = readFileSync(full, 'utf8');
          if (src.includes("'use client'") || src.includes('"use client"')) {
            results.push(full);
          }
        }
      }
      return results;
    }

    const appDir = join(ROOT, 'app');
    const clientFiles = collectClientFiles(appDir);
    const violators = clientFiles.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes("fetch('/api/") || src.includes('fetch("/api/');
    });
    const relPaths = violators.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual([]);
  });
});
