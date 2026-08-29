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
import { CONFIG_DEFS } from '../../../blueprint/catalog.js';
import { SECTION_DEFS } from '../../sectionDefsSeed.js';
import { testDb } from '../../__tests__/test-db.js';
import { createTestUser } from '../../__tests__/test-users.js';

import {
  createAgent,
  getAgentFull,
  deleteAgent,
  updateSectionContent,
  addSection,
  deleteSection,
  upsertAgentFromImport,
  VersionConflictError,
  SectionNotFoundError,
  listAgents,
  getAgentFullForViewer,
  listSharedWithViewer,
  copyAgentForOwner,
  CannotCopyOwnAgentError,
  exportAgentMarkdown,
  exportAgentMarkdownForViewer,
} from '../agents.js';

import { createShare } from '../agentShares.js';

import { getConfigDefs, getSectionDefs } from '../catalog.js';

// Shared owner for all tests in this suite
let owner: { id: string; email: string };

// ── Seed catalog tables + create a test owner before any test runs ─────────
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
      defaultHeading: def.defaultHeading,
      isCore: def.isCore,
      defaultOrder: def.defaultOrder,
      template: def.template,
      helpText: def.helpText,
    }).onConflictDoNothing().run();
  }

  owner = createTestUser('user');
});

// ─────────────────────────────────────────────────────────────────────────────

describe('createAgent', () => {
  it('creates agent row with platform:claude by default', () => {
    const dto = createAgent(owner.id, 'test-agent-platform', 'A test agent for platform check');
    expect(dto.platform).toBe('claude');
    expect(dto.source).toBe('created');
  });

  it('per-owner name uniqueness: two different owners may both own an agent with the same name', () => {
    // Positive case required by §10.1 — the composite unique index (owner_id, name)
    // allows the same name across owners; createAgent must succeed for the second owner.
    const secondOwner = createTestUser('user');
    const sharedName = `shared-name-repo-${crypto.randomUUID().slice(0, 8)}`;

    // First owner creates the agent — no throw
    const first = createAgent(owner.id, sharedName, 'first owner copy');
    // Second owner creates an agent with the SAME name — must not throw
    const second = createAgent(secondOwner.id, sharedName, 'second owner copy');

    expect(first.name).toBe(sharedName);
    expect(second.name).toBe(sharedName);
    // They are distinct agents (different ids, different owners)
    expect(first.id).not.toBe(second.id);
  });

  it('seeds core sections with author:scaffold (D5)', () => {
    const coreDefs = SECTION_DEFS.filter((d) => d.isCore);
    const dto = createAgent(owner.id, 'scaffold-test-agent', 'Testing scaffold revisions');

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
    const created = createAgent(owner.id, 'round-trip-agent', 'Description for round-trip test');
    const dto = getAgentFull(created.id, owner.id);

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
    expect(typeof dto!.validation.descriptionMissing).toBe('boolean');
    expect(Array.isArray(dto!.validation.unknownConfigKeys)).toBe(true);
    expect(Array.isArray(dto!.validation.outdatedOrUnknownValues)).toBe(true);
  });

  it('returns null for a non-existent agentId', () => {
    const dto = getAgentFull('00000000-0000-0000-0000-000000000000', owner.id);
    expect(dto).toBeNull();
  });
});

describe('updateSectionContent', () => {
  it('appends exactly one SectionRevision per write (rule 3)', () => {
    const dto = createAgent(owner.id, 'write-test-agent', 'Testing writes');
    const section = dto.sections[0];

    const before = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, section.id))
      .all();
    expect(before.length).toBe(1); // scaffold revision

    updateSectionContent(dto.id, section.id, owner.id, 'Updated content', 'user', section.version);

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
    const dto = createAgent(owner.id, 'version-bump-agent', 'Testing version bump');
    const section = dto.sections[0];
    const originalVersion = section.version; // 0

    const result = updateSectionContent(dto.id, section.id, owner.id, 'New content', 'ai', originalVersion);
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
    const dto = createAgent(owner.id, 'conflict-test-agent', 'Testing optimistic locking');
    const section = dto.sections[0];

    // Advance version to 1
    updateSectionContent(dto.id, section.id, owner.id, 'First write', 'user', section.version);

    // Stale version — must throw
    expect(() =>
      updateSectionContent(dto.id, section.id, owner.id, 'Second write', 'user', section.version),
    ).toThrow(VersionConflictError);
  });

  it('does not write a revision when version conflict occurs', () => {
    const dto = createAgent(owner.id, 'no-write-on-conflict-agent', 'Testing no write on conflict');
    const section = dto.sections[0];

    updateSectionContent(dto.id, section.id, owner.id, 'Advanced', 'user', section.version);

    const before = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, section.id))
      .all();

    try {
      updateSectionContent(dto.id, section.id, owner.id, 'Conflict write', 'user', 0); // stale
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

describe('addSection', () => {
  it('creates a new section appended after the existing ones, with author:user revision #0', () => {
    const dto = createAgent(owner.id, 'add-section-agent', 'Testing manual section add');
    // addSection() reindexes every section to a contiguous 0-based order on each call
    // (see the "Ordering" tests below) — createAgent() itself seeds order:defaultOrder
    // (1-based, e.g. 1..4), so the count of existing sections, not their max raw order
    // value, is what predicts where an appended one lands post-reindex.
    const existingCount = dto.sections.length;

    const result = addSection(dto.id, owner.id, {
      sectionKey: 'sources',
      heading: '# SOURCES',
      content: 'Files it reads.',
    });

    expect(result.order).toBe(existingCount);
    expect(result.version).toBe(0);

    const row = testDb
      .select()
      .from(schema.agentSection)
      .where(eq(schema.agentSection.id, result.id))
      .get();
    expect(row?.sectionKey).toBe('sources');
    expect(row?.heading).toBe('# SOURCES');
    expect(row?.content).toBe('Files it reads.');
    expect(row?.order).toBe(existingCount);

    const revisions = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, result.id))
      .all();
    expect(revisions.length).toBe(1);
    expect(revisions[0].author).toBe('user');
    expect(revisions[0].content).toBe('Files it reads.');
  });

  it('throws SectionNotFoundError for a nonexistent or not-owned agent', () => {
    const dto = createAgent(owner.id, 'add-section-owner-check-agent', 'Testing ownership');
    const otherOwner = createTestUser('user');

    expect(() =>
      addSection(dto.id, otherOwner.id, { sectionKey: 'sources', heading: null, content: 'x' }),
    ).toThrow(SectionNotFoundError);
    expect(() =>
      addSection('not-a-real-agent-id', owner.id, { sectionKey: 'sources', heading: null, content: 'x' }),
    ).toThrow(SectionNotFoundError);
  });

  // ── Ordering (2026-08-11 — found live: a chat-added core "output" section landed
  // after several non-core sections; addSection() used to always append at the end
  // with no concept of the blueprint's canonical order). ──
  it('a catalog-matched sectionKey is inserted at its canonical position, reindexing sections after it', () => {
    const dto = createAgent(owner.id, 'add-section-ordering-agent', 'Testing catalog-order insertion');
    // createAgent seeds only the 4 core sections: role(1) behavior(2) guardrails(3) output(4)
    expect(dto.sections.map((s) => s.sectionKey)).toEqual(['role', 'behavior', 'guardrails', 'output']);

    // Add 'tone' (catalog order 8) first — lands right after the 4 core sections, index 4.
    const tone = addSection(dto.id, owner.id, { sectionKey: 'tone', heading: '# TONE', content: 'x' });
    expect(tone.order).toBe(4);

    // Now add 'sources' (catalog order 5) — must be inserted BEFORE 'tone' (order 8),
    // not appended after it, and 'tone' must be shifted from index 4 to index 5.
    const sources = addSection(dto.id, owner.id, { sectionKey: 'sources', heading: '# SOURCES', content: 'y' });
    expect(sources.order).toBe(4);

    const rows = testDb
      .select({ sectionKey: schema.agentSection.sectionKey, order: schema.agentSection.order })
      .from(schema.agentSection)
      .where(eq(schema.agentSection.agentId, dto.id))
      .orderBy(schema.agentSection.order)
      .all();
    expect(rows.map((r) => r.sectionKey)).toEqual([
      'role', 'behavior', 'guardrails', 'output', 'sources', 'tone',
    ]);
  });

  it('a sectionKey with no catalog match still appends at the end, same as before', () => {
    const dto = createAgent(owner.id, 'add-section-custom-agent', 'Testing custom-key append');
    const existingCount = dto.sections.length;

    const result = addSection(dto.id, owner.id, {
      sectionKey: 'custom',
      heading: '# MISSION',
      content: 'z',
    });

    expect(result.order).toBe(existingCount);
  });

  it('author defaults to "user" but a chat-add caller can pass "ai" explicitly', () => {
    const dto = createAgent(owner.id, 'add-section-author-agent', 'Testing author param');

    const result = addSection(
      dto.id,
      owner.id,
      { sectionKey: 'sources', heading: '# SOURCES', content: 'Chat-proposed content.' },
      'ai',
    );

    const revisions = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, result.id))
      .all();
    expect(revisions.length).toBe(1);
    expect(revisions[0].author).toBe('ai');
  });
});

describe('deleteSection', () => {
  it('removes the section row but retains its SectionRevision rows (rule 4)', () => {
    const dto = createAgent(owner.id, 'delete-section-agent', 'Testing manual section delete');
    const added = addSection(dto.id, owner.id, {
      sectionKey: 'sources',
      heading: '# SOURCES',
      content: 'Files it reads.',
    });

    deleteSection(dto.id, added.id, owner.id);

    const row = testDb
      .select()
      .from(schema.agentSection)
      .where(eq(schema.agentSection.id, added.id))
      .get();
    expect(row).toBeUndefined();

    const revisions = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, added.id))
      .all();
    expect(revisions.length).toBe(1); // the add's own revision, retained
  });

  it('throws SectionNotFoundError for wrong owner, cross-agent sectionId, or nonexistent section', () => {
    const dto = createAgent(owner.id, 'delete-section-owner-check-agent', 'Testing ownership');
    const otherDto = createAgent(owner.id, 'delete-section-other-agent', 'A different agent');
    const otherOwner = createTestUser('user');
    const section = dto.sections[0];

    expect(() => deleteSection(dto.id, section.id, otherOwner.id)).toThrow(SectionNotFoundError);
    // sectionId belongs to a different agent than the one named
    expect(() => deleteSection(otherDto.id, section.id, owner.id)).toThrow(SectionNotFoundError);
    expect(() => deleteSection(dto.id, 'not-a-real-section-id', owner.id)).toThrow(SectionNotFoundError);
  });
});

describe('deleteAgent', () => {
  it('retains SectionRevision rows after agent deletion (rule 4)', () => {
    const dto = createAgent(owner.id, 'to-be-deleted-agent', 'This agent will be deleted');
    const section = dto.sections[0];

    updateSectionContent(dto.id, section.id, owner.id, 'Content before delete', 'user', section.version);

    const revisionsBefore = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, section.id))
      .all();
    expect(revisionsBefore.length).toBeGreaterThan(0);

    deleteAgent(dto.id, owner.id);

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
    const dto = upsertAgentFromImport(owner.id, {
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

    deleteAgent(dto.id, owner.id);

    // AgentSnapshot rows MUST still exist (soft ref — rule 4)
    const snapshotsAfter = testDb
      .select()
      .from(schema.agentSnapshot)
      .where(eq(schema.agentSnapshot.agentId, dto.id))
      .all();
    expect(snapshotsAfter.length).toBe(snapshotsBefore.length);
  });

  it('deletes its agent_share rows in the same transaction (Plan 15 §4.2, §5.3)', () => {
    const dto = createAgent(owner.id, `share-cascade-agent-${crypto.randomUUID()}`, 'cascade test');

    testDb.insert(schema.agentShare).values({
      id: crypto.randomUUID(),
      agentId: dto.id,
      recipientEmail: 'cascade@example.com',
      grantedVia: 'email',
    }).run();

    const sharesBefore = testDb
      .select()
      .from(schema.agentShare)
      .where(eq(schema.agentShare.agentId, dto.id))
      .all();
    expect(sharesBefore.length).toBe(1);

    deleteAgent(dto.id, owner.id);

    const sharesAfter = testDb
      .select()
      .from(schema.agentShare)
      .where(eq(schema.agentShare.agentId, dto.id))
      .all();
    expect(sharesAfter.length).toBe(0);
  });
});

describe('upsertAgentFromImport', () => {
  it('creates a new agent on first import with author:import revisions', () => {
    const dto = upsertAgentFromImport(owner.id, {
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
    const firstDto = upsertAgentFromImport(owner.id, {
      name,
      description: 'First import',
      platform: 'claude',
      splitLevel: 1,
      rawSourceSnapshot: '---\n---\n# ROLE\nOriginal.\n',
      config: [],
      sections: [{ sectionKey: 'role', heading: '# ROLE', content: 'Original.', order: 1 }],
    });

    const secondDto = upsertAgentFromImport(owner.id, {
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
    const firstDto = upsertAgentFromImport(owner.id, {
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
    const secondDto = upsertAgentFromImport(owner.id, {
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

// ─────────────────────  Plan 15 §5.3 — viewer-scoped reads  ─────────────────

describe('getAgentFullForViewer', () => {
  it("owner reads own agent → access:'owner'", () => {
    const dto = createAgent(owner.id, `viewer-owner-${crypto.randomUUID()}`, 'owner read test');
    const result = getAgentFullForViewer(dto.id, owner.id);
    expect(result).not.toBeNull();
    expect(result?.access).toBe('owner');
    expect(result?.agent.id).toBe(dto.id);
  });

  it("share-holder reads → access:'shared', DTO field-identical to the owner's own read", () => {
    const dto = createAgent(owner.id, `viewer-shared-${crypto.randomUUID()}`, 'shared read test');
    const recipient = createTestUser('user');
    createShare(dto.id, recipient.email, 'email');

    const ownerRead = getAgentFullForViewer(dto.id, owner.id);
    const sharedRead = getAgentFullForViewer(dto.id, recipient.id);

    expect(sharedRead).not.toBeNull();
    expect(sharedRead?.access).toBe('shared');
    // Live reference, not a reduced projection — field-identical to the owner's own read.
    expect(sharedRead?.agent).toEqual(ownerRead?.agent);
  });

  it('a stranger (no owner, no share) reads → null', () => {
    const dto = createAgent(owner.id, `viewer-stranger-${crypto.randomUUID()}`, 'stranger test');
    const stranger = createTestUser('user');
    expect(getAgentFullForViewer(dto.id, stranger.id)).toBeNull();
  });

  it('the share-before-signup case: a share row for an email with no account yet grants nothing and breaks nothing; creating the account afterwards makes the same call start returning the agent', () => {
    const dto = createAgent(owner.id, `viewer-presignup-${crypto.randomUUID()}`, 'presignup test');
    const futureEmail = `presignup-${crypto.randomUUID()}@example.com`;
    createShare(dto.id, futureEmail, 'email');

    // No account with this email exists yet — no viewerId to even query with,
    // but confirm no crash / no false grant against an unrelated existing user.
    const someoneElse = createTestUser('user');
    expect(getAgentFullForViewer(dto.id, someoneElse.id)).toBeNull();

    // Now the account with the shared address is created.
    const newlyRegistered = testDb.insert(schema.user).values({
      id: crypto.randomUUID(),
      email: futureEmail,
      passwordHash: '$2a$10$placeholder-hash-for-tests',
      role: 'user',
      shareLogsWithAdmin: false,
    }).run();
    void newlyRegistered;
    const newUserRow = testDb.select().from(schema.user).all().find((u) => u.email === futureEmail)!;

    const result = getAgentFullForViewer(dto.id, newUserRow.id);
    expect(result).not.toBeNull();
    expect(result?.access).toBe('shared');
  });
});

describe('listSharedWithViewer', () => {
  it('excludes agents the viewer owns and includes ownerEmail', () => {
    const dtoOwned = createAgent(owner.id, `owned-not-shared-${crypto.randomUUID()}`, 'owned');
    const dtoShared = createAgent(owner.id, `owned-and-shared-${crypto.randomUUID()}`, 'shared');
    const recipient = createTestUser('user');
    createShare(dtoShared.id, recipient.email, 'email');

    const list = listSharedWithViewer(recipient.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(dtoShared.id);
    expect(list[0].ownerEmail).toBe(owner.email);
    expect(list.some((a) => a.id === dtoOwned.id)).toBe(false);
  });

  it('returns [] for a viewer with no shares', () => {
    const viewer = createTestUser('user');
    expect(listSharedWithViewer(viewer.id)).toEqual([]);
  });
});

describe('listAgents(ownerId) is unaffected by share rows existing (constraint 2)', () => {
  it('returns byte-identical results before and after a share row is created for the same agent', () => {
    const dto = createAgent(owner.id, `constraint2-${crypto.randomUUID()}`, 'constraint 2 test');
    const before = listAgents(owner.id);

    const recipient = createTestUser('user');
    createShare(dto.id, recipient.email, 'email');

    const after = listAgents(owner.id);
    expect(after).toEqual(before);
  });
});

describe('a share-holder sees live edits, not a snapshot', () => {
  it("the owner's section edit is immediately visible on the share-holder's next read", () => {
    const dto = createAgent(owner.id, `live-read-${crypto.randomUUID()}`, 'live read test');
    const recipient = createTestUser('user');
    createShare(dto.id, recipient.email, 'email');

    const section = dto.sections[0];
    updateSectionContent(dto.id, section.id, owner.id, 'Freshly edited by the owner', 'user', section.version);

    const sharedRead = getAgentFullForViewer(dto.id, recipient.id);
    const editedSection = sharedRead?.agent.sections.find((s) => s.id === section.id);
    expect(editedSection?.content).toBe('Freshly edited by the owner');
  });
});

// ─────────────────────  Plan 15 §5.4 — copyAgentForOwner  ───────────────────

describe('copyAgentForOwner', () => {
  function makeRichSource(sourceOwnerId: string) {
    return upsertAgentFromImport(sourceOwnerId, {
      name: `copy-source-${crypto.randomUUID()}`,
      description: 'a rich source agent',
      platform: 'claude',
      splitLevel: 2,
      rawSourceSnapshot: '---\n---\n',
      config: [
        { propKey: 'model', value: 'claude-opus-4-8' },
        { propKey: 'hooks', value: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } },
      ],
      sections: [
        { sectionKey: 'custom', heading: null, content: 'Headerless preamble content.', order: 0 },
        { sectionKey: 'role', heading: '# ROLE', content: 'You are a test agent.', order: 1 },
        { sectionKey: 'output', heading: '## Output', content: 'Formatted output.', order: 2 },
      ],
    });
  }

  /** A fresh user holding a share grant on `source` — copyAgentForOwner requires
   *  the viewer to be the owner OR a share-holder (§4.6); most of these tests
   *  exercise the share-holder path since that's the primary "Copy to me" case. */
  function makeAuthorizedCopier(source: { id: string }) {
    const copier = createTestUser('user');
    createShare(source.id, copier.email, 'email');
    return copier;
  }

  it('copies every field verbatim: sections (incl. null preamble heading), order, config (incl. nested json), splitLevel, platform, description', () => {
    const source = makeRichSource(owner.id);
    const copier = makeAuthorizedCopier(source);

    const copy = copyAgentForOwner(source.id, copier.id);
    expect(copy).not.toBeNull();
    expect(copy!.description).toBe('a rich source agent');
    expect(copy!.platform).toBe('claude');
    expect(copy!.splitLevel).toBe(2);

    const sortedSource = [...source.sections].sort((a, b) => a.order - b.order);
    const sortedCopy = [...copy!.sections].sort((a, b) => a.order - b.order);
    expect(sortedCopy.map((s) => ({ sectionKey: s.sectionKey, heading: s.heading, content: s.content, order: s.order })))
      .toEqual(sortedSource.map((s) => ({ sectionKey: s.sectionKey, heading: s.heading, content: s.content, order: s.order })));
    // The headingless preamble survives as null, not '', not dropped.
    expect(sortedCopy[0].heading).toBeNull();

    const sourceConfigByKey = new Map(source.config.map((c) => [c.propKey, c.value]));
    const copyConfigByKey = new Map(copy!.config.map((c) => [c.propKey, c.value]));
    expect(copyConfigByKey.get('model')).toBe(sourceConfigByKey.get('model'));
    expect(copyConfigByKey.get('hooks')).toEqual(sourceConfigByKey.get('hooks')); // nested json survives structurally
  });

  it("the copy's source is 'copied' (D3), not 'imported'", () => {
    const source = makeRichSource(owner.id);
    const copier = makeAuthorizedCopier(source);
    const copy = copyAgentForOwner(source.id, copier.id);
    expect(copy!.source).toBe('copied');
  });

  it("a section_revision with author:'copied' exists for every section of the copy", () => {
    const source = makeRichSource(owner.id);
    const copier = makeAuthorizedCopier(source);
    const copy = copyAgentForOwner(source.id, copier.id);

    for (const section of copy!.sections) {
      const revisions = testDb
        .select()
        .from(schema.sectionRevision)
        .where(eq(schema.sectionRevision.sectionId, section.id))
        .all();
      expect(revisions.length).toBeGreaterThan(0);
      expect(revisions.every((r) => r.author === 'copied')).toBe(true);
    }
  });

  it('a post-import agent_snapshot exists for the copy', () => {
    const source = makeRichSource(owner.id);
    const copier = makeAuthorizedCopier(source);
    const copy = copyAgentForOwner(source.id, copier.id);

    const snapshots = testDb
      .select()
      .from(schema.agentSnapshot)
      .where(eq(schema.agentSnapshot.agentId, copy!.id))
      .all();
    expect(snapshots.some((s) => s.kind === 'post-import')).toBe(true);
  });

  it('independence: editing the copy leaves the source byte-identical, and vice versa', () => {
    const source = makeRichSource(owner.id);
    const copier = makeAuthorizedCopier(source);
    const copy = copyAgentForOwner(source.id, copier.id)!;

    const copySection = copy.sections.find((s) => s.sectionKey === 'role')!;
    updateSectionContent(copy.id, copySection.id, copier.id, 'Edited on the copy only.', 'user', copySection.version);

    const sourceAfter = getAgentFull(source.id, owner.id)!;
    const sourceRoleSection = sourceAfter.sections.find((s) => s.sectionKey === 'role')!;
    expect(sourceRoleSection.content).toBe('You are a test agent.');

    const sourceSection = sourceAfter.sections.find((s) => s.sectionKey === 'output')!;
    updateSectionContent(source.id, sourceSection.id, owner.id, 'Edited on the source only.', 'user', sourceSection.version);

    const copyAfter = getAgentFull(copy.id, copier.id)!;
    const copyOutputSection = copyAfter.sections.find((s) => s.sectionKey === 'output')!;
    expect(copyOutputSection.content).toBe('Formatted output.');
  });

  it('name collision with the copier\'s OWN existing agent throws NameExistsError and writes nothing', () => {
    const source = makeRichSource(owner.id);
    const copier = makeAuthorizedCopier(source);
    const existing = createAgent(copier.id, `copy-collision-${crypto.randomUUID()}`, 'my own unrelated agent');
    const existingSectionsBefore = testDb
      .select()
      .from(schema.agentSection)
      .where(eq(schema.agentSection.agentId, existing.id))
      .all();

    expect(() => copyAgentForOwner(source.id, copier.id, existing.name)).toThrow(
      expect.objectContaining({ name: 'NameExistsError' }),
    );

    // The existing agent's row and sections are untouched — not just a 409.
    const existingAfter = getAgentFull(existing.id, copier.id)!;
    expect(existingAfter.description).toBe('my own unrelated agent');
    const existingSectionsAfter = testDb
      .select()
      .from(schema.agentSection)
      .where(eq(schema.agentSection.agentId, existing.id))
      .all();
    expect(existingSectionsAfter).toEqual(existingSectionsBefore);
  });

  it('an explicit newName is used and is itself collision-checked', () => {
    const source = makeRichSource(owner.id);
    const copier = makeAuthorizedCopier(source);
    const explicitName = `explicit-copy-name-${crypto.randomUUID()}`;

    const copy = copyAgentForOwner(source.id, copier.id, explicitName);
    expect(copy!.name).toBe(explicitName);

    // A second copy under the SAME explicit name collides with the first copy.
    expect(() => copyAgentForOwner(source.id, copier.id, explicitName)).toThrow(
      expect.objectContaining({ name: 'NameExistsError' }),
    );
  });

  it('copying a shared agent works (share-holder access)', () => {
    const source = makeRichSource(owner.id);
    const recipient = createTestUser('user');
    createShare(source.id, recipient.email, 'email');

    const copy = copyAgentForOwner(source.id, recipient.id);
    expect(copy).not.toBeNull();
    expect(copy!.name).toBe(source.name);
  });

  it("copying a stranger's agent (no owner, no share) returns null", () => {
    const source = makeRichSource(owner.id);
    const stranger = createTestUser('user');
    expect(copyAgentForOwner(source.id, stranger.id)).toBeNull();
  });

  it('the owner copying their OWN agent throws CannotCopyOwnAgentError and writes nothing (added during implementation)', () => {
    const source = makeRichSource(owner.id);
    const agentsBefore = testDb.select().from(schema.agent).all().length;

    expect(() => copyAgentForOwner(source.id, owner.id)).toThrow(CannotCopyOwnAgentError);

    const agentsAfter = testDb.select().from(schema.agent).all().length;
    expect(agentsAfter).toBe(agentsBefore);
  });
});

// ─────────────────────  Plan 15 §8b — exportAgentMarkdownForViewer (D2)  ────

describe('exportAgentMarkdownForViewer', () => {
  it('a share-holder gets byte-identical export output to the owner', () => {
    const dto = createAgent(owner.id, `export-viewer-${crypto.randomUUID()}`, 'export test');
    const recipient = createTestUser('user');
    createShare(dto.id, recipient.email, 'email');

    const ownerExport = exportAgentMarkdown(dto.id, owner.id);
    const sharedExport = exportAgentMarkdownForViewer(dto.id, recipient.id);
    expect(sharedExport).not.toBeNull();
    expect(sharedExport).toBe(ownerExport);
  });

  it('the owner themself still gets their export via the viewer-scoped sibling', () => {
    const dto = createAgent(owner.id, `export-viewer-owner-${crypto.randomUUID()}`, 'export test');
    expect(exportAgentMarkdownForViewer(dto.id, owner.id)).toBe(exportAgentMarkdown(dto.id, owner.id));
  });

  it('a stranger (no owner, no share) gets null', () => {
    const dto = createAgent(owner.id, `export-viewer-stranger-${crypto.randomUUID()}`, 'export test');
    const stranger = createTestUser('user');
    expect(exportAgentMarkdownForViewer(dto.id, stranger.id)).toBeNull();
  });

  it("exportAgentMarkdown's own behavior is unchanged (unaffected by a share existing)", () => {
    const dto = createAgent(owner.id, `export-unmodified-${crypto.randomUUID()}`, 'export test');
    const recipient = createTestUser('user');

    const before = exportAgentMarkdown(dto.id, owner.id);
    createShare(dto.id, recipient.email, 'email');
    const after = exportAgentMarkdown(dto.id, owner.id);
    expect(after).toBe(before);

    // Still owner-scoped only — the recipient gets null from the original function.
    expect(exportAgentMarkdown(dto.id, recipient.id)).toBeNull();
  });
});

describe('getConfigDefs / getSectionDefs (catalog.ts)', () => {
  it('getConfigDefs returns a real array of rows matching CONFIG_DEFS', () => {
    const rows = getConfigDefs();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(CONFIG_DEFS.length);
    // Every row must have the expected fields
    for (const row of rows) {
      expect(typeof row.key).toBe('string');
      expect(typeof row.label).toBe('string');
      expect(typeof row.datatype).toBe('string');
    }
    // Keys must match the catalog exactly
    const rowKeys = rows.map((r) => r.key).sort();
    const defKeys = CONFIG_DEFS.map((d) => d.key).sort();
    expect(rowKeys).toEqual(defKeys);
  });

  it('getSectionDefs returns a real array of rows matching SECTION_DEFS', () => {
    const rows = getSectionDefs();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(SECTION_DEFS.length);
    // Every row must have the expected fields
    for (const row of rows) {
      expect(typeof row.key).toBe('string');
      expect(typeof row.defaultHeading).toBe('string');
      expect(typeof row.defaultOrder).toBe('number');
    }
    // Keys must match the catalog exactly
    const rowKeys = rows.map((r) => r.key).sort();
    const defKeys = SECTION_DEFS.map((d) => d.key).sort();
    expect(rowKeys).toEqual(defKeys);
  });

  it('getSectionDefs returns rows ordered by defaultOrder ascending', () => {
    const rows = getSectionDefs();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].defaultOrder).toBeGreaterThanOrEqual(rows[i - 1].defaultOrder);
    }
  });
});
