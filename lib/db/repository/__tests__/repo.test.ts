/**
 * lib/db/repository/__tests__/repo.test.ts
 *
 * Repository round-trip tests (Phase 2, step 2.9).
 *
 * Uses a fresh in-memory SQLite database shared via lib/db/__tests__/test-db.ts.
 * The vi.mock() factory and the test body both import the same module, so they
 * see the same in-memory DB instance (ES module cache).
 *
 * NOTE: drizzle-orm/better-sqlite3 is lazy — all SELECT queries require .all()
 * (multiple rows) or .get() (one row) to actually execute.
 *
 * Assertions:
 *   - create → getAgentFull round-trip produces the correct AgentDTO shape
 *   - every content write appends exactly one SectionRevision (rule 3)
 *   - optimistic-version conflict is properly signaled (R4)
 *   - deleting an agent retains its SectionRevision and AgentSnapshot rows (rule 4)
 *   - createAgent seeds core sections with author:'scaffold' (D5)
 *   - platform column defaults to 'claude'
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

// ── Replace lib/db/client.ts with our in-memory instance ──────────────────
vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

// ── All other imports ──────────────────────────────────────────────────────
import { eq } from 'drizzle-orm';

import * as schema from '../../schema.js';
import { CONFIG_DEFS, SECTION_DEFS } from '../../../blueprint/catalog.js';
import { testDb } from '../../__tests__/test-db.js';

import {
  createAgent,
  getAgentFull,
  deleteAgent,
  updateSectionContent,
  upsertAgentFromImport,
  VersionConflictError,
} from '../agents.js';

// ── Seed catalog tables before any test runs ──────────────────────────────
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

describe('createAgent', () => {
  it('creates agent row with platform:claude by default', () => {
    const dto = createAgent('test-agent-platform', 'A test agent for platform check');
    expect(dto.platform).toBe('claude');
    expect(dto.source).toBe('created');
  });

  it('seeds core sections with author:scaffold (D5)', () => {
    const coreDefs = SECTION_DEFS.filter((d) => d.isCore);
    const dto = createAgent('scaffold-test-agent', 'Testing scaffold revisions');

    expect(dto.sections.length).toBe(coreDefs.length);

    for (const section of dto.sections) {
      const revisions = testDb
        .select()
        .from(schema.sectionRevision)
        .where(eq(schema.sectionRevision.sectionId, section.id))
        .all();

      expect(revisions.length).toBe(1);
      expect(revisions[0].author).toBe('scaffold');
    }
  });
});

describe('getAgentFull round-trip', () => {
  it('returns the correct AgentDTO shape after create', () => {
    const created = createAgent('round-trip-agent', 'Description for round-trip test');
    const dto = getAgentFull(created.id);

    expect(dto).not.toBeNull();
    expect(dto!.id).toBe(created.id);
    expect(dto!.name).toBe('round-trip-agent');
    expect(dto!.description).toBe('Description for round-trip test');
    expect(dto!.source).toBe('created');
    expect(dto!.platform).toBe('claude');
    expect(dto!.splitLevel).toBe(1);

    expect(dto!.sections.length).toBeGreaterThan(0);
    for (const section of dto!.sections) {
      expect(typeof section.id).toBe('string');
      expect(typeof section.sectionKey).toBe('string');
      expect(typeof section.content).toBe('string');
      expect(typeof section.order).toBe('number');
      expect(typeof section.version).toBe('number');
    }

    // Validation block shape (§5)
    expect(dto!.validation).toBeDefined();
    expect(typeof dto!.validation.nameSpecViolation).toBe('boolean');
    expect(typeof dto!.validation.descriptionMissing).toBe('boolean');
    expect(Array.isArray(dto!.validation.unknownConfigKeys)).toBe(true);
    expect(Array.isArray(dto!.validation.outdatedOrUnknownValues)).toBe(true);
  });

  it('returns null for a non-existent agentId', () => {
    const dto = getAgentFull('00000000-0000-0000-0000-000000000000');
    expect(dto).toBeNull();
  });

  it('nameSpecViolation is true for a non-lowercase-hyphen name', () => {
    const dto = createAgent('ValidName', 'description');
    const full = getAgentFull(dto.id);
    expect(full!.validation.nameSpecViolation).toBe(true);
  });
});

describe('updateSectionContent', () => {
  it('appends exactly one SectionRevision per write (rule 3)', () => {
    const dto = createAgent('write-test-agent', 'Testing writes');
    const section = dto.sections[0];

    const before = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, section.id))
      .all();
    expect(before.length).toBe(1); // scaffold revision

    updateSectionContent(section.id, 'Updated content', 'user', section.version);

    const after = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, section.id))
      .all();
    expect(after.length).toBe(2); // scaffold + user
    expect(after[after.length - 1].author).toBe('user');
    expect(after[after.length - 1].content).toBe('Updated content');
  });

  it('bumps the section version after a write', () => {
    const dto = createAgent('version-bump-agent', 'Testing version bump');
    const section = dto.sections[0];
    const originalVersion = section.version; // 0

    const result = updateSectionContent(section.id, 'New content', 'ai', originalVersion);
    expect(result.version).toBe(originalVersion + 1);

    const rows = testDb
      .select()
      .from(schema.agentSection)
      .where(eq(schema.agentSection.id, section.id))
      .all();
    expect(rows[0].version).toBe(originalVersion + 1);
    expect(rows[0].content).toBe('New content');
  });

  it('throws VersionConflictError on version mismatch (R4)', () => {
    const dto = createAgent('conflict-test-agent', 'Testing optimistic locking');
    const section = dto.sections[0];

    // Advance version to 1
    updateSectionContent(section.id, 'First write', 'user', section.version);

    // Stale version — must throw
    expect(() =>
      updateSectionContent(section.id, 'Second write', 'user', section.version),
    ).toThrow(VersionConflictError);
  });

  it('does not write a revision when version conflict occurs', () => {
    const dto = createAgent('no-write-on-conflict-agent', 'Testing no write on conflict');
    const section = dto.sections[0];

    updateSectionContent(section.id, 'Advanced', 'user', section.version);

    const before = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, section.id))
      .all();

    try {
      updateSectionContent(section.id, 'Conflict write', 'user', 0); // stale
    } catch {
      // expected VersionConflictError
    }

    const after = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, section.id))
      .all();

    expect(after.length).toBe(before.length);
  });
});

describe('deleteAgent', () => {
  it('retains SectionRevision rows after agent deletion (rule 4)', () => {
    const dto = createAgent('to-be-deleted-agent', 'This agent will be deleted');
    const section = dto.sections[0];

    updateSectionContent(section.id, 'Content before delete', 'user', section.version);

    const revisionsBefore = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, section.id))
      .all();
    expect(revisionsBefore.length).toBeGreaterThan(0);

    deleteAgent(dto.id);

    // Agent row gone
    const agentRows = testDb
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.id, dto.id))
      .all();
    expect(agentRows.length).toBe(0);

    // Section row gone
    const sectionRows = testDb
      .select()
      .from(schema.agentSection)
      .where(eq(schema.agentSection.id, section.id))
      .all();
    expect(sectionRows.length).toBe(0);

    // SectionRevision rows MUST still exist (soft ref — rule 4)
    const revisionsAfter = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, section.id))
      .all();
    expect(revisionsAfter.length).toBe(revisionsBefore.length);
  });

  it('retains AgentSnapshot rows after agent deletion (rule 4)', () => {
    const dto = upsertAgentFromImport({
      name: 'snapshot-delete-agent',
      description: 'Snapshot retention test',
      platform: 'claude',
      splitLevel: 1,
      rawSourceSnapshot: '---\n---\n',
      config: [],
      sections: [
        { sectionKey: 'role', heading: '# ROLE', content: 'You are a test.', order: 1 },
      ],
    });

    const snapshotsBefore = testDb
      .select()
      .from(schema.agentSnapshot)
      .where(eq(schema.agentSnapshot.agentId, dto.id))
      .all();
    expect(snapshotsBefore.length).toBeGreaterThan(0);

    deleteAgent(dto.id);

    // AgentSnapshot rows MUST still exist (soft ref — rule 4)
    const snapshotsAfter = testDb
      .select()
      .from(schema.agentSnapshot)
      .where(eq(schema.agentSnapshot.agentId, dto.id))
      .all();
    expect(snapshotsAfter.length).toBe(snapshotsBefore.length);
  });
});

describe('upsertAgentFromImport', () => {
  it('creates a new agent on first import with author:import revisions', () => {
    const dto = upsertAgentFromImport({
      name: 'new-import-agent',
      description: 'Imported for the first time',
      platform: 'claude',
      splitLevel: 1,
      rawSourceSnapshot: '---\n---\n# ROLE\nYou are test.\n',
      config: [{ propKey: 'model', value: 'claude-opus-4-8' }],
      sections: [
        { sectionKey: 'role', heading: '# ROLE', content: 'You are test.', order: 1 },
      ],
    });

    expect(dto.name).toBe('new-import-agent');
    expect(dto.source).toBe('imported');
    expect(dto.sections.length).toBe(1);

    const section = dto.sections[0];
    const revisions = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, section.id))
      .all();
    expect(revisions.length).toBe(1);
    expect(revisions[0].author).toBe('import');

    // Post-import written; no pre-import on first import
    const snapshots = testDb
      .select()
      .from(schema.agentSnapshot)
      .where(eq(schema.agentSnapshot.agentId, dto.id))
      .all();
    const kinds = snapshots.map((s) => s.kind);
    expect(kinds).toContain('post-import');
    expect(kinds).not.toContain('pre-import');
  });

  it('updates in place on re-import and writes pre+post snapshots', () => {
    const name = 'reimport-test-agent';
    const firstDto = upsertAgentFromImport({
      name,
      description: 'First import',
      platform: 'claude',
      splitLevel: 1,
      rawSourceSnapshot: '---\n---\n# ROLE\nOriginal.\n',
      config: [],
      sections: [{ sectionKey: 'role', heading: '# ROLE', content: 'Original.', order: 1 }],
    });

    const secondDto = upsertAgentFromImport({
      name,
      description: 'Second import',
      platform: 'claude',
      splitLevel: 1,
      rawSourceSnapshot: '---\n---\n# ROLE\nUpdated.\n',
      config: [],
      sections: [{ sectionKey: 'role', heading: '# ROLE', content: 'Updated.', order: 1 }],
    });

    expect(secondDto.id).toBe(firstDto.id); // update in place
    expect(secondDto.description).toBe('Second import');
    expect(secondDto.sections[0].content).toBe('Updated.');

    // 1 post-import (first) + 1 pre-import (second) + 1 post-import (second) = 3 total
    const snapshots = testDb
      .select()
      .from(schema.agentSnapshot)
      .where(eq(schema.agentSnapshot.agentId, firstDto.id))
      .all();
    const kinds = snapshots.map((s) => s.kind);
    expect(kinds.filter((k) => k === 'post-import').length).toBe(2);
    expect(kinds.filter((k) => k === 'pre-import').length).toBe(1);
  });

  it('deletes absent sections on re-import but retains their revisions (rules 4 + §6 rule 14)', () => {
    const name = 'section-delete-agent';
    const firstDto = upsertAgentFromImport({
      name,
      description: 'Has two sections',
      platform: 'claude',
      splitLevel: 1,
      rawSourceSnapshot: '---\n---\n',
      config: [],
      sections: [
        { sectionKey: 'role', heading: '# ROLE', content: 'Role content.', order: 1 },
        { sectionKey: 'output', heading: '# OUTPUT FORMAT', content: 'Output content.', order: 2 },
      ],
    });

    const outputSection = firstDto.sections.find((s) => s.sectionKey === 'output')!;
    const outputSectionId = outputSection.id;

    // Re-import without the output section
    const secondDto = upsertAgentFromImport({
      name,
      description: 'Now only role',
      platform: 'claude',
      splitLevel: 1,
      rawSourceSnapshot: '---\n---\n',
      config: [],
      sections: [
        { sectionKey: 'role', heading: '# ROLE', content: 'Role content updated.', order: 1 },
      ],
    });

    expect(secondDto.sections.find((s) => s.sectionKey === 'output')).toBeUndefined();

    // But its revisions must survive (soft ref — rule 4)
    const orphanRevisions = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, outputSectionId))
      .all();
    expect(orphanRevisions.length).toBeGreaterThan(0);
  });
});
