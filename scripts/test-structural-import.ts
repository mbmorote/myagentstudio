/**
 * scripts/test-structural-import.ts
 *
 * Manual live-fixture harness for Structural Import rule refinement (Phase B6).
 *
 * USAGE (requires a real ANTHROPIC_API_KEY — spends money):
 *   npx tsx scripts/test-structural-import.ts
 *
 * DO NOT run this in CI or without an explicit decision to spend API credits.
 * This is the "test a lot with my agents until the rules are good" loop:
 *   1. Run this script against all 15 golden fixtures.
 *   2. Read the per-fixture output in the scratch folder.
 *   3. If coverage warnings or restructuring issues appear, edit:
 *        design/system-agents/import-instructions-structural.md
 *   4. Restart dev server (or re-run build-prompts.ts) to recompile the prompt.
 *   5. Re-run this script and iterate.
 *
 * Output:
 *   - For each fixture: prints coverage warnings + the restructured body to stdout.
 *   - Writes restructured body to:
 *       scripts/scratch/structural-output-{agentName}.md
 *
 * This script bypasses the DB layer entirely — it only calls the AI converter
 * and runs the coverage check, then prints results. Nothing is persisted.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, basename } from 'path';
import { glob } from 'node:fs/promises';

// ANTHROPIC_API_KEY must be set in the environment before running this script.
// Next.js doesn't auto-load .env.local when running tsx directly.
// Set it manually: $env:ANTHROPIC_API_KEY="sk-ant-..." (PowerShell)
//                  export ANTHROPIC_API_KEY="sk-ant-..." (bash)
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[harness] ERROR: ANTHROPIC_API_KEY is not set in the environment.');
  console.error('  Set it before running: $env:ANTHROPIC_API_KEY="sk-ant-..." (PowerShell)');
  process.exit(1);
}

// Run build-prompts first to ensure the latest rule-set is compiled.
// (Do NOT import from the generated files before they exist.)
const { execSync } = await import('child_process');
try {
  execSync('npx tsx scripts/build-prompts.ts', { stdio: 'inherit' });
} catch (err) {
  console.error('[harness] build-prompts failed:', err);
  process.exit(1);
}

// Import AI modules after build-prompts has run.
const { callStructuralConverter } = await import('../lib/ai/structuralConverter.js');
const { parse } = await import('../lib/serialize/index.js');
const { checkCoverage } = await import('../lib/import/coverage.js');

// ─────────────────────────────  Config  ─────────────────────────────────────

const FIXTURES_DIR = resolve('lib/serialize/__tests__/fixtures');
const SCRATCH_DIR = resolve('scripts/scratch');

mkdirSync(SCRATCH_DIR, { recursive: true });

// ─────────────────────────────  Run  ────────────────────────────────────────

// Collect all .md fixtures.
const fixtureFiles: string[] = [];
for await (const entry of glob('*.md', { cwd: FIXTURES_DIR })) {
  fixtureFiles.push(resolve(FIXTURES_DIR, entry));
}
fixtureFiles.sort();

console.log(`\n[harness] Running structural import on ${fixtureFiles.length} fixtures...\n`);
console.log('='.repeat(72));

let totalWarnings = 0;
let totalFixed = 0;

for (const fixturePath of fixtureFiles) {
  const agentName = basename(fixturePath, '.md');
  const rawMd = readFileSync(fixturePath, 'utf8');

  console.log(`\n[${agentName}]`);
  console.log('-'.repeat(40));

  // Stage 1: parse to get source blocks + frontmatter.
  let parsed;
  try {
    parsed = parse(rawMd);
  } catch (err) {
    console.error(`  ✗ Stage-1 parse failed: ${err}`);
    continue;
  }

  // Stage 2b: call structural converter.
  let restructuredBody: string;
  try {
    restructuredBody = await callStructuralConverter(rawMd);
  } catch (err) {
    console.error(`  ✗ Structural converter error: ${err}`);
    continue;
  }

  // Coverage check.
  const warnings = checkCoverage(parsed.blocks, restructuredBody);
  totalWarnings += warnings.length;

  if (warnings.length === 0) {
    console.log(`  ✓ Coverage: full (no warnings)`);
    totalFixed++;
  } else {
    console.warn(`  ⚠  Coverage warnings (${warnings.length}):`);
    for (const w of warnings) {
      console.warn(`     - ${w.blockId} "${w.heading ?? '(no heading)'}" → ${(w.coverage * 100).toFixed(1)}% covered`);
    }
  }

  // Write restructured output to scratch folder.
  const outputPath = resolve(SCRATCH_DIR, `structural-output-${agentName}.md`);
  writeFileSync(outputPath, restructuredBody, 'utf8');
  console.log(`  → Output written: ${outputPath}`);
}

console.log('\n' + '='.repeat(72));
console.log(`[harness] Done. ${fixtureFiles.length} fixtures processed.`);
console.log(`  Fixtures with full coverage: ${totalFixed}/${fixtureFiles.length}`);
console.log(`  Total coverage warnings:      ${totalWarnings}`);
if (totalWarnings > 0) {
  console.log('\n  Refine the rule-set in design/system-agents/import-instructions-structural.md');
  console.log('  then re-run this script to iterate.');
}
console.log('');
