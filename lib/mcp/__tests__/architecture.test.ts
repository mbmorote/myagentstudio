/**
 * lib/mcp/__tests__/architecture.test.ts
 *
 * Fitness function: enforces the MCP layer's guardrails (Plan 13 constraints 4, 6, 9;
 * §4.8). Landed while lib/mcp/ genuinely has zero writers and zero AI callers, rather
 * than after Phase 4 makes any of these a carve-out.
 *
 * Reads every .ts file under lib/mcp/ (excluding __tests__) and asserts:
 *
 *   1. One-importer rule (constraint 9): @modelcontextprotocol/sdk is imported by
 *      lib/mcp/server.ts and no other file in the whole codebase (lib/, app/, scripts/).
 *   2. Write-surface containment (constraint 4): no lib/mcp/ file references any
 *      mutating repository function other than upsertAgentFromImport — specifically
 *      not updateAgent, updateSectionContent, addSection, deleteSection, createAgent,
 *      or deleteAgent. This is the assertion that keeps a future session from quietly
 *      re-adding the structured-write surface D3 deliberately dropped.
 *   3. Gateway choke point (constraint 6): no lib/mcp/ file imports a provider file
 *      (anthropicProvider.ts, openaiCompatibleProvider.ts) or the Anthropic SDK
 *      directly — every AI call must go tool → caller (hermes/daedalus) → gateway.
 *   4. Session/token isolation: no lib/mcp/ file imports next/headers or reads the
 *      session cookie — the MCP principal comes from a bearer token
 *      (lib/auth/mcpGuard.ts) only, and the two auth models must never cross-contaminate.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '../../..'); // project root (from lib/mcp/__tests__)

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
const allSourceFiles = SOURCE_DIRS.flatMap(collectTsFiles);

const MCP_DIR = join(ROOT, 'lib', 'mcp');
const mcpFiles = allSourceFiles.filter((f) => f.startsWith(MCP_DIR));

describe('MCP architecture fitness — one SDK importer', () => {
  it('@modelcontextprotocol/sdk is imported by exactly lib/mcp/server.ts', () => {
    const importers = allSourceFiles.filter((f) => readFileSync(f, 'utf8').includes('@modelcontextprotocol/sdk'));
    const relPaths = importers.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(relPaths).toEqual(['lib/mcp/server.ts']);
  });
});

describe('MCP architecture fitness — write-surface containment (constraint 4)', () => {
  const FORBIDDEN_MUTATORS = [
    'updateAgent(',
    'updateSectionContent(',
    'addSection(',
    'deleteSection(',
    'createAgent(',
    'deleteAgent(',
  ];

  it('no lib/mcp/ file references a mutating repository function other than upsertAgentFromImport(', () => {
    const violations: string[] = [];
    for (const file of mcpFiles) {
      const src = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN_MUTATORS) {
        if (src.includes(token)) {
          violations.push(`${relative(ROOT, file).replaceAll('\\', '/')} (uses ${token})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('MCP architecture fitness — gateway is the only route to a model (constraint 6)', () => {
  const FORBIDDEN_AI_IMPORTS = [
    '@anthropic-ai/sdk',
    'anthropicProvider.js',
    'anthropicProvider.ts',
    'openaiCompatibleProvider.js',
    'openaiCompatibleProvider.ts',
  ];

  it('no lib/mcp/ file imports a provider file or the Anthropic SDK directly', () => {
    const violations: string[] = [];
    for (const file of mcpFiles) {
      const src = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN_AI_IMPORTS) {
        if (src.includes(token)) {
          violations.push(`${relative(ROOT, file).replaceAll('\\', '/')} (imports ${token})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('MCP architecture fitness — session/token isolation', () => {
  it('no lib/mcp/ file imports next/headers or reads the session cookie', () => {
    const violations: string[] = [];
    for (const file of mcpFiles) {
      const src = readFileSync(file, 'utf8');
      const importsNextHeaders = /from\s+['"]next\/headers['"]/.test(src);
      const readsSession = src.includes('getSession(') || src.includes('SESSION_COOKIE');
      if (importsNextHeaders || readsSession) {
        violations.push(relative(ROOT, file).replaceAll('\\', '/'));
      }
    }
    expect(violations).toEqual([]);
  });
});
