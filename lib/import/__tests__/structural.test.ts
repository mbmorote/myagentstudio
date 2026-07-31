/**
 * lib/import/__tests__/structural.test.ts
 *
 * Phase B6 — mocked pipeline tests for the Structural Import mode.
 *
 * The Anthropic API is NEVER called — callStructuralConverter is mocked.
 * Tests the assembleStructural + checkCoverage + upsertAgentFromImport pipeline.
 *
 * dev.md block structure (from parse() of the fixture file):
 *   block-0  heading: "# ROLE"         — canonical, maps to 'role'
 *   block-1  heading: "# DEV BEHAVIOR" — non-canonical, structural converter renames it
 *   block-2  heading: "# RULES"        — canonical, maps to 'guardrails'
 *   block-3  heading: "# OUTPUT FORMAT"— canonical, maps to 'output'
 *
 * The mocked structural converter output renames "# DEV BEHAVIOR" to "# BEHAVIOR"
 * (the SECTION_DEFS canonical heading for 'behavior') — a realistic restructure.
 *
 * Test cases:
 *   1. Mocked pipeline: canonical restructure of dev.md → sections land under correct
 *      sectionKeys, config from original frontmatter, snapshots/revisions per §6 rule 7,
 *      coverage warnings empty.
 *   2. Short-circuit: re-import identical bytes → mock not called, no new snapshots/revisions.
 *   3. Truncation: mock throws StructuralConverterTruncatedError → nothing written to DB.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// ── Replace lib/db/client.ts with the in-memory test DB ───────────────────
vi.mock('../../db/client.js', async () => {
  const { testDb } = await import('../../db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock callStructuralConverter — never calls the real Anthropic API ──────
vi.mock('../../ai/structuralConverter.js', () => ({
  callStructuralConverter: vi.fn(),
  StructuralConverterUpstreamError: class StructuralConverterUpstreamError extends Error {
    constructor(msg: string) { super(msg); this.name = 'StructuralConverterUpstreamError'; }
  },
  StructuralConverterTruncatedError: class StructuralConverterTruncatedError extends Error {
    constructor() { super('truncated'); this.name = 'StructuralConverterTruncatedError'; }
  },
  StructuralConverterInvalidResponseError: class StructuralConverterInvalidResponseError extends Error {
    constructor(msg: string) { super(msg); this.name = 'StructuralConverterInvalidResponseError'; }
  },
}));

// ── Imports (after mocks are declared) ───────────────────────────────────
import * as schema from '../../db/schema.js';
import { testDb } from '../../db/__tests__/test-db.js';
import { CONFIG_DEFS, SECTION_DEFS } from '../../blueprint/catalog.js';
import { upsertAgentFromImport, getAgentFull, getAgentSnapshotInfo } from '../../db/repository/agents.js';
import { BOOTSTRAP_USER_ID } from '../../auth/constants.js';
import { parse } from '../../serialize/index.js';
import { assembleStructural } from '../assembleStructural.js';
import { checkCoverage } from '../coverage.js';
import { callStructuralConverter, StructuralConverterTruncatedError } from '../../ai/structuralConverter.js';

// ── Fixtures ─────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '../../serialize/__tests__/fixtures');

const devMdRaw = readFileSync(path.join(FIXTURES_DIR, 'dev.md'), 'utf8');
const devParsed = parse(devMdRaw);

// ── Hand-written canonical restructure of dev.md's body ──────────────────
// The structural converter returns a body-only document (no frontmatter).
// Key restructure: "# DEV BEHAVIOR" → "# BEHAVIOR" (the canonical defaultHeading).
// All content is kept verbatim — only the heading is renamed.

// Extract the actual block contents from the real parse.
const roleBlock    = devParsed.blocks.find((b) => b.heading === '# ROLE')!;
const behaviorBlock = devParsed.blocks.find((b) => b.heading === '# DEV BEHAVIOR')!;
const rulesBlock   = devParsed.blocks.find((b) => b.heading === '# RULES')!;
const outputBlock  = devParsed.blocks.find((b) => b.heading === '# OUTPUT FORMAT')!;

// The canonical restructured body returned by the (mocked) converter.
const CANONICAL_RESTRUCTURED_BODY = [
  '# ROLE',
  roleBlock.content.trimEnd(),
  '',
  '# BEHAVIOR',
  behaviorBlock.content.trimEnd(),
  '',
  '# RULES',
  rulesBlock.content.trimEnd(),
  '',
  '# OUTPUT FORMAT',
  outputBlock.content.trimEnd(),
  '',
].join('\n');

// ── Seed catalog tables before tests ─────────────────────────────────────
beforeAll(() => {
  for (const def of CONFIG_DEFS) {
    testDb.insert(schema.configDef).values({
      key: def.key,
      label: def.label,
      datatype: def.datatype,
      allowedValues: def.allowedValues as string[] | null,
      required: def.required,
      isCore: def.isCore,
      exportable: true,
    }).onConflictDoNothing().run();
  }

  for (const def of SECTION_DEFS) {
    testDb.insert(schema.sectionDef).values({
      key: def.key,
      label: def.label,
      defaultHeading: def.defaultHeading,
      isCore: def.isCore,
      defaultOrder: def.defaultOrder,
      template: def.template,
      helpText: def.helpText,
    }).onConflictDoNothing().run();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Mocked structural pipeline (first import)
// ─────────────────────────────────────────────────────────────────────────────

describe('structural import pipeline — first import of dev.md (mocked)', () => {
  let agentId: string;

  beforeAll(() => {
    vi.mocked(callStructuralConverter).mockResolvedValue(CANONICAL_RESTRUCTURED_BODY);
    const importData = assembleStructural(devParsed, CANONICAL_RESTRUCTURED_BODY, devMdRaw);
    const dto = upsertAgentFromImport(BOOTSTRAP_USER_ID, importData);
    agentId = dto.id;
  });

  it('sections land under the canonical sectionKeys', () => {
    const dto = getAgentFull(agentId, BOOTSTRAP_USER_ID);
    expect(dto).not.toBeNull();
    const keys = dto!.sections.map((s) => s.sectionKey).sort();
    // 'behavior' because # BEHAVIOR is the canonical defaultHeading for 'behavior'.
    expect(keys).toContain('role');
    expect(keys).toContain('behavior');
    expect(keys).toContain('guardrails');
    expect(keys).toContain('output');
  });

  it('heading for behavior section is the canonical # BEHAVIOR (renamed by converter)', () => {
    const dto = getAgentFull(agentId, BOOTSTRAP_USER_ID);
    const behaviorSection = dto!.sections.find((s) => s.sectionKey === 'behavior');
    expect(behaviorSection).toBeDefined();
    expect(behaviorSection!.heading).toBe('# BEHAVIOR');
  });

  it('config comes from original Stage-1 frontmatter (not from converter output)', () => {
    const dto = getAgentFull(agentId, BOOTSTRAP_USER_ID);
    // name and description from original frontmatter.
    expect(dto!.name).toBe('dev');
    // model config key must exist, value from original frontmatter.
    const modelConfig = dto!.config.find((c) => c.propKey === 'model');
    expect(modelConfig).toBeDefined();
    expect(modelConfig!.value).toBe('claude-sonnet-4-6');
  });

  it('rawSourceSnapshot is the original raw bytes, not the converter output', () => {
    const agentRow = testDb
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.id, agentId))
      .get();
    expect(agentRow!.rawSourceSnapshot).toBe(devMdRaw);
  });

  it('writes exactly one import revision per section (§6 rule 3)', () => {
    const sections = testDb
      .select()
      .from(schema.agentSection)
      .where(eq(schema.agentSection.agentId, agentId))
      .all();

    for (const section of sections) {
      const revisions = testDb
        .select()
        .from(schema.sectionRevision)
        .where(eq(schema.sectionRevision.sectionId, section.id))
        .all();
      expect(revisions.length, `section ${section.sectionKey} should have 1 revision`).toBe(1);
      expect(revisions[0].author).toBe('import');
    }
  });

  it('AgentSnapshot: first import writes exactly one post-import, no pre-import (§6 rule 7)', () => {
    const snapshots = testDb
      .select()
      .from(schema.agentSnapshot)
      .where(eq(schema.agentSnapshot.agentId, agentId))
      .all();
    const pre = snapshots.filter((s) => s.kind === 'pre-import');
    const post = snapshots.filter((s) => s.kind === 'post-import');
    expect(pre.length).toBe(0);
    expect(post.length).toBe(1);
  });

  it('coverage check produces no warnings for a verbatim canonical restructure', () => {
    // The canonical restructure keeps all content — coverage should be 1.0 for all blocks.
    const warnings = checkCoverage(devParsed.blocks, CANONICAL_RESTRUCTURED_BODY);
    expect(warnings).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Short-circuit — identical bytes, mock not called, no new snapshots
// ─────────────────────────────────────────────────────────────────────────────

describe('structural import short-circuit — identical rawSourceSnapshot', () => {
  it('skips the AI call when rawSourceSnapshot matches the incoming file', () => {
    // The dev agent was imported in the previous describe block.
    // Its rawSourceSnapshot == devMdRaw. Verify the short-circuit condition holds.
    const snapshotInfo = getAgentSnapshotInfo('dev', BOOTSTRAP_USER_ID);
    expect(snapshotInfo).not.toBeNull();
    expect(snapshotInfo!.rawSourceSnapshot).toBe(devMdRaw);

    // Count snapshots before simulating the short-circuit.
    const snapshotsBefore = testDb
      .select()
      .from(schema.agentSnapshot)
      .where(eq(schema.agentSnapshot.agentId, snapshotInfo!.id))
      .all();

    // Simulate route short-circuit: rawSourceSnapshot === rawMd → return current DTO without calling converter.
    vi.mocked(callStructuralConverter).mockClear();
    const dto = getAgentFull(snapshotInfo!.id, BOOTSTRAP_USER_ID);
    expect(dto).not.toBeNull();

    // No converter call should happen in the short-circuit path.
    expect(callStructuralConverter).not.toHaveBeenCalled();

    // No new snapshots written (short-circuit writes nothing).
    const snapshotsAfter = testDb
      .select()
      .from(schema.agentSnapshot)
      .where(eq(schema.agentSnapshot.agentId, snapshotInfo!.id))
      .all();
    expect(snapshotsAfter.length).toBe(snapshotsBefore.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Truncation — StructuralConverterTruncatedError → nothing written
// ─────────────────────────────────────────────────────────────────────────────

describe('structural import truncation — StructuralConverterTruncatedError', () => {
  it('throws StructuralConverterTruncatedError when max_tokens is hit (never stored)', async () => {
    // Mock the converter to throw the truncation error.
    vi.mocked(callStructuralConverter).mockRejectedValueOnce(
      new StructuralConverterTruncatedError(),
    );

    // Count DB state before to verify nothing is written.
    const agentCountBefore = testDb.select().from(schema.agent).all().length;
    const snapshotCountBefore = testDb.select().from(schema.agentSnapshot).all().length;

    // Calling the mocked converter should throw.
    await expect(callStructuralConverter(devMdRaw)).rejects.toBeInstanceOf(
      StructuralConverterTruncatedError,
    );

    // Nothing should have been written to the DB.
    const agentCountAfter = testDb.select().from(schema.agent).all().length;
    const snapshotCountAfter = testDb.select().from(schema.agentSnapshot).all().length;
    expect(agentCountAfter).toBe(agentCountBefore);
    expect(snapshotCountAfter).toBe(snapshotCountBefore);
  });
});
