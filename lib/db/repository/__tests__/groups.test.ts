/**
 * lib/db/repository/__tests__/groups.test.ts
 *
 * Plan 03 Phase A, A.11 — Repository tests for groups + membership.
 *
 * Tests (all via the mocked-in-memory DB, same pattern as repo.test.ts):
 *   - createGroup: creates a group; throws NameExistsError on duplicate name for same owner
 *   - listGroups: returns groups with their member agent IDs
 *   - deleteGroup: deletes group + membership rows; member agents survive
 *   - addMembership: creates membership; idempotent on repeat; returns null for missing agent/group
 *   - removeMembership: removes membership; returns false if not found
 *   - deleteAgent no longer orphans membership rows (R3 regression test — Plan 03 §8 hard gate)
 *   - listAgents() lite DTO carries correct groupIds
 *   - exportAgentMarkdown round-trips through parse() back to the same sections/frontmatter
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

// ── Replace lib/db/client.ts with in-memory test DB ─────────────────────────
vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

// ── All other imports after mock ─────────────────────────────────────────────
import { eq } from 'drizzle-orm';
import * as schema from '../../schema.js';
import { testDb } from '../../__tests__/test-db.js';
import { CONFIG_DEFS, SECTION_DEFS } from '../../../blueprint/catalog.js';
import { parse } from '../../../serialize/index.js';
import { createTestUser } from '../../__tests__/test-users.js';

import {
  createAgent,
  deleteAgent,
  listAgents,
  exportAgentMarkdown,
} from '../agents.js';

import {
  createGroup,
  listGroups,
  deleteGroup,
  addMembership,
  removeMembership,
} from '../groups.js';

// Shared owner for all tests in this suite
let owner: { id: string; email: string };

// ── Seed catalog tables + create a test owner before any test runs ───────────
beforeAll(() => {
  for (const def of CONFIG_DEFS) {
    testDb
      .insert(schema.configDef)
      .values({
        key: def.key,
        label: def.label,
        datatype: def.datatype,
        allowedValues: def.allowedValues as string[] | null,
        required: def.required,
        isCore: def.isCore,
        exportable: true,
      })
      .onConflictDoNothing()
      .run();
  }
  for (const def of SECTION_DEFS) {
    testDb
      .insert(schema.sectionDef)
      .values({
        key: def.key,
        label: def.label,
        defaultHeading: def.defaultHeading,
        isCore: def.isCore,
        defaultOrder: def.defaultOrder,
        template: def.template,
        helpText: def.helpText,
      })
      .onConflictDoNothing()
      .run();
  }

  owner = createTestUser('user');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('createGroup', () => {
  it('creates a group and returns it with empty memberAgentIds', () => {
    const g = createGroup(owner.id, 'grp-create-test');
    expect(g.name).toBe('grp-create-test');
    expect(g.memberAgentIds).toEqual([]);
    expect(typeof g.id).toBe('string');
    expect(g.id.length).toBeGreaterThan(0);
  });

  it('throws NameExistsError on duplicate name for same owner', () => {
    createGroup(owner.id, 'grp-duplicate');
    expect(() => createGroup(owner.id, 'grp-duplicate')).toThrow(
      expect.objectContaining({ name: 'NameExistsError' }),
    );
  });

  it('per-owner name uniqueness: two different owners may both have a group with the same name', () => {
    // Positive case required by §10.1 — the composite unique index (owner_id, name)
    // allows the same group name across owners; the second createGroup must succeed.
    const secondOwner = createTestUser('user');
    const sharedName = `grp-shared-name-${crypto.randomUUID().slice(0, 8)}`;

    const g1 = createGroup(owner.id, sharedName);
    const g2 = createGroup(secondOwner.id, sharedName);

    expect(g1.name).toBe(sharedName);
    expect(g2.name).toBe(sharedName);
    expect(g1.id).not.toBe(g2.id);
  });
});

describe('listGroups', () => {
  it('returns groups with their member agent IDs', () => {
    // Create a group and two agents; add one to the group
    const agent1 = createAgent(owner.id, 'grp-list-agent-1', 'list test agent 1');
    const agent2 = createAgent(owner.id, 'grp-list-agent-2', 'list test agent 2');
    const group = createGroup(owner.id, 'grp-list-group');

    addMembership(agent1.id, group.id, owner.id);

    const groups = listGroups(owner.id);
    const found = groups.find((g) => g.id === group.id);
    expect(found).toBeDefined();
    expect(found!.memberAgentIds).toContain(agent1.id);
    expect(found!.memberAgentIds).not.toContain(agent2.id);
  });
});

describe('deleteGroup', () => {
  it('deletes the group and its membership rows; member agents survive', () => {
    const agent = createAgent(owner.id, 'grp-del-agent', 'delete group agent');
    const group = createGroup(owner.id, 'grp-del-group');
    addMembership(agent.id, group.id, owner.id);

    const deleted = deleteGroup(group.id, owner.id);
    expect(deleted).toBe(true);

    // Group row gone
    const groupRow = testDb
      .select()
      .from(schema.group)
      .where(eq(schema.group.id, group.id))
      .get();
    expect(groupRow).toBeUndefined();

    // Membership row gone
    const membershipRows = testDb
      .select()
      .from(schema.membership)
      .where(eq(schema.membership.groupId, group.id))
      .all();
    expect(membershipRows).toHaveLength(0);

    // Agent row still exists (R4)
    const agentRow = testDb
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.id, agent.id))
      .get();
    expect(agentRow).toBeDefined();
  });

  it('returns false when group does not exist', () => {
    expect(deleteGroup('no-such-group-id', owner.id)).toBe(false);
  });
});

describe('addMembership', () => {
  it('creates a new membership', () => {
    const agent = createAgent(owner.id, 'grp-add-mem-agent', 'add membership agent');
    const group = createGroup(owner.id, 'grp-add-mem-group');

    const result = addMembership(agent.id, group.id, owner.id);
    expect(result).toEqual({ created: true });

    // Verify in DB
    const row = testDb
      .select()
      .from(schema.membership)
      .where(
        eq(schema.membership.agentId, agent.id),
      )
      .all()
      .find((m) => m.groupId === group.id);
    expect(row).toBeDefined();
  });

  it('is idempotent — returns { created: false } on second call', () => {
    const agent = createAgent(owner.id, 'grp-idem-agent', 'idempotent agent');
    const group = createGroup(owner.id, 'grp-idem-group');

    addMembership(agent.id, group.id, owner.id);
    const result = addMembership(agent.id, group.id, owner.id);
    expect(result).toEqual({ created: false });
  });

  it('returns null if agent does not exist', () => {
    const group = createGroup(owner.id, 'grp-null-agent-group');
    const result = addMembership('non-existent-agent-id', group.id, owner.id);
    expect(result).toBeNull();
  });

  it('returns null if group does not exist', () => {
    const agent = createAgent(owner.id, 'grp-null-group-agent', 'null group agent');
    const result = addMembership(agent.id, 'non-existent-group-id', owner.id);
    expect(result).toBeNull();
  });

  it('returns null if agent belongs to a different owner (cross-owner guard, §6.3)', () => {
    const otherOwner = createTestUser('user');
    const agentOther = createAgent(otherOwner.id, 'grp-cross-agent', 'cross owner agent');
    const group = createGroup(owner.id, 'grp-cross-group');
    // agentOther belongs to otherOwner, but we pass owner.id — must reject
    const result = addMembership(agentOther.id, group.id, owner.id);
    expect(result).toBeNull();
  });
});

describe('removeMembership', () => {
  it('removes an existing membership', () => {
    const agent = createAgent(owner.id, 'grp-rem-mem-agent', 'remove membership agent');
    const group = createGroup(owner.id, 'grp-rem-mem-group');
    addMembership(agent.id, group.id, owner.id);

    const removed = removeMembership(agent.id, group.id, owner.id);
    expect(removed).toBe(true);

    const rows = testDb
      .select()
      .from(schema.membership)
      .where(eq(schema.membership.agentId, agent.id))
      .all()
      .filter((m) => m.groupId === group.id);
    expect(rows).toHaveLength(0);
  });

  it('returns false when membership does not exist', () => {
    const agent = createAgent(owner.id, 'grp-rem-none-agent', 'remove none agent');
    const group = createGroup(owner.id, 'grp-rem-none-group');

    expect(removeMembership(agent.id, group.id, owner.id)).toBe(false);
  });
});

// ── Hard gate (Plan 03 §8): deleteAgent no longer orphans membership rows ─────
describe('deleteAgent — R3 regression: membership rows deleted', () => {
  it('deletes membership rows along with the agent (no orphan rows)', () => {
    const agent = createAgent(owner.id, 'grp-orphan-agent', 'orphan test');
    const group = createGroup(owner.id, 'grp-orphan-group');
    addMembership(agent.id, group.id, owner.id);

    // Confirm membership exists before delete
    const beforeRows = testDb
      .select()
      .from(schema.membership)
      .where(eq(schema.membership.agentId, agent.id))
      .all();
    expect(beforeRows).toHaveLength(1);

    deleteAgent(agent.id, owner.id);

    // After delete: agent row gone AND membership row gone (not orphaned)
    const agentRow = testDb
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.id, agent.id))
      .get();
    expect(agentRow).toBeUndefined();

    const afterRows = testDb
      .select()
      .from(schema.membership)
      .where(eq(schema.membership.agentId, agent.id))
      .all();
    expect(afterRows).toHaveLength(0);
  });
});

// ── listAgents() lite DTO carries correct groupIds ────────────────────────────
describe('listAgents — groupIds field', () => {
  it('includes groupIds for agents with memberships', () => {
    const agent = createAgent(owner.id, 'grp-lite-agent', 'lite dto test');
    const group = createGroup(owner.id, 'grp-lite-group');
    addMembership(agent.id, group.id, owner.id);

    const all = listAgents(owner.id);
    const lite = all.find((a) => a.id === agent.id);
    expect(lite).toBeDefined();
    expect(lite!.groupIds).toContain(group.id);
  });

  it('returns empty groupIds for agents with no memberships', () => {
    const agent = createAgent(owner.id, 'grp-no-mem-agent', 'no memberships');

    const all = listAgents(owner.id);
    const lite = all.find((a) => a.id === agent.id);
    expect(lite).toBeDefined();
    expect(lite!.groupIds).toEqual([]);
  });

  it('does not include another owner\'s agents (isolation check)', () => {
    const otherOwner = createTestUser('user');
    const myAgent = createAgent(owner.id, 'grp-isolation-mine', 'my agent');
    createAgent(otherOwner.id, 'grp-isolation-other', 'other agent');

    const all = listAgents(owner.id);
    const ids = all.map((a) => a.id);
    expect(ids).toContain(myAgent.id);
    // The other owner's agent must not appear
    const otherAll = listAgents(otherOwner.id);
    const otherIds = otherAll.map((a) => a.id);
    for (const id of otherIds) {
      expect(ids).not.toContain(id);
    }
  });
});

// ── exportAgentMarkdown round-trip ────────────────────────────────────────────
describe('exportAgentMarkdown', () => {
  it('returns null for a non-existent agent', () => {
    expect(exportAgentMarkdown('no-such-id', owner.id)).toBeNull();
  });

  it('produces markdown that round-trips through parse() back to the same sections', () => {
    const agent = createAgent(owner.id, 'grp-export-agent', 'export round-trip test');
    const md = exportAgentMarkdown(agent.id, owner.id);
    expect(typeof md).toBe('string');
    expect(md!.length).toBeGreaterThan(0);

    // Must begin with YAML frontmatter
    expect(md!.startsWith('---')).toBe(true);

    // Round-trip: parse the exported markdown
    const parsed = parse(md!);
    expect(parsed).not.toBeNull();

    // Frontmatter must contain the agent name and description
    const nameEntry = parsed!.frontmatter.find((f) => f.key === 'name');
    expect(nameEntry?.rawValue).toBe('grp-export-agent');

    const descEntry = parsed!.frontmatter.find((f) => f.key === 'description');
    expect(descEntry?.rawValue).toBe('export round-trip test');

    // parse() must return at least 1 block (sections with content round-trip;
    // empty-template sections may be coalesced by the serializer)
    expect(parsed!.blocks.length).toBeGreaterThanOrEqual(1);

    // All non-empty section content from the original agent must appear verbatim
    // in at least one parsed block
    const allParsedContent = parsed!.blocks.map((b) => b.content.trim()).join('\n');
    for (const section of agent.sections) {
      if (section.content.trim().length > 0) {
        expect(allParsedContent).toContain(section.content.trim());
      }
    }
  });
});
