/**
 * app/api/__tests__/route-guard.test.ts
 *
 * Fitness function (§10.4): reads every route.ts under app/api/ and asserts:
 *
 *   1. Every file outside app/api/auth/ contains authenticate( or authenticateAdmin(.
 *   2. Files under app/api/settings/** and app/api/llm-call-log/** contain authenticateAdmin(.
 *   3. Files under app/api/account/** contain authenticate( and do NOT contain
 *      authenticateAdmin( — the user settings surface must never acquire an admin gate
 *      by copy-paste from its neighbour (§5.7).
 *   4. (Phase 4 — skipped until apiFetch migration is complete) No 'use client' file
 *      under app/ calls a bare fetch('/api/ — they must use apiFetch.
 *
 * No mocks — pure file I/O. Kept short so it is easy to understand and maintain.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
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

// ── Helper: path segment check ────────────────────────────────────────────────

/** Returns true if `absPath` is under a subdirectory named `segment` of the API dir. */
function underSegment(absPath: string, ...segments: string[]): boolean {
  const rel = relative(API_DIR, absPath);
  const parts = rel.split(sep);
  return segments.every((seg, i) => parts[i] === seg);
}

function inAuthDir(absPath: string): boolean {
  const rel = relative(API_DIR, absPath);
  return rel.startsWith('auth' + sep) || rel === 'auth';
}

function inAdminOnlyDir(absPath: string): boolean {
  const rel = relative(API_DIR, absPath);
  return rel.startsWith('settings' + sep) ||
         rel.startsWith('llm-call-log' + sep);
}

function inAccountDir(absPath: string): boolean {
  const rel = relative(API_DIR, absPath);
  return rel.startsWith('account' + sep);
}

// ── Fitness assertions ─────────────────────────────────────────────────────────

describe('Route-guard fitness — every non-auth route is guarded', () => {
  const nonAuthRoutes = allRouteFiles.filter((f) => !inAuthDir(f));

  it('every non-auth route.ts contains authenticate( or authenticateAdmin(', () => {
    const unguarded = nonAuthRoutes.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return !src.includes('authenticate(') && !src.includes('authenticateAdmin(');
    });
    const relPaths = unguarded.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual([]);
  });

  it('settings/** and llm-call-log/** use authenticateAdmin( (not just authenticate()', () => {
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
});

describe('Route-guard fitness — Phase 4 (apiFetch migration)', () => {
  it('no use-client file under app/ calls bare fetch("/api/")', () => {
    // app/login/ and app/signup/ are deliberately excluded: they are the public
    // auth pages that call /api/auth/* endpoints. Those endpoints return 401 to
    // mean "wrong credentials", not "session expired", so using apiFetch there
    // would create a circular redirect (login → 401 → redirect to /login → loop).
    // All other 'use client' files must use apiFetch for /api/ calls (§5.4).
    const AUTH_PAGE_DIRS = ['login', 'signup'];

    function collectClientFiles(dir: string): string[] {
      const results: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          if (['node_modules', '.next', '__tests__'].includes(entry)) continue;
          // Skip auth page directories (they call public auth endpoints directly)
          const relToApp = relative(join(ROOT, 'app'), full).split(sep)[0];
          if (AUTH_PAGE_DIRS.includes(relToApp)) continue;
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
