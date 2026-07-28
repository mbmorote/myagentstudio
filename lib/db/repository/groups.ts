/**
 * lib/db/repository/groups.ts
 *
 * Repository layer for group + membership operations (Plan 03 Phase A, A.2).
 * All groups have parentId: null in this plan (R1 — flat MVP, no nesting).
 *
 * Routes and components import from lib/db/repository/index.ts only.
 *
 * Invariants enforced here:
 *   - R1: parentId is always null (flat groups only).
 *   - R2: many-to-many — one agent may belong to zero, one, or many groups.
 *   - R4: deleting a group deletes its membership rows only; member agents are untouched.
 *   - A1 (of Plan 03): a duplicate group name throws NameExistsError (→ 409 at route layer),
 *     consistent with the pattern agents.ts already uses for updateAgent.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';

// ─────────────────────────────  DTO types  ─────────────────────────────────

/** Shape returned by listGroups() and createGroup(). */
export type GroupDTO = {
  id: string;
  name: string;
  memberAgentIds: string[];
};

// ─────────────────────────────  Groups CRUD  ───────────────────────────────

/**
 * Creates a new group with the given name (parentId always null — R1).
 * Returns the new GroupDTO with memberAgentIds: [] (freshly created).
 *
 * Throws with name 'NameExistsError' on duplicate name (→ 409 at the route layer),
 * consistent with the updateAgent pattern in agents.ts.
 */
export function createGroup(name: string): GroupDTO {
  const groupId = crypto.randomUUID();

  try {
    db.insert(schema.group).values({
      id: groupId,
      name,
      parentId: null, // R1 — flat MVP
    }).run();
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('UNIQUE constraint failed') ||
        err.message.includes('SQLITE_CONSTRAINT'))
    ) {
      const nameErr = new Error('name_exists');
      nameErr.name = 'NameExistsError';
      throw nameErr;
    }
    throw err;
  }

  return { id: groupId, name, memberAgentIds: [] };
}

/**
 * Returns all groups, each with their current member agent IDs.
 * Order is by createdAt ascending (insertion order).
 */
export function listGroups(): GroupDTO[] {
  const groups = db
    .select()
    .from(schema.group)
    .orderBy(schema.group.createdAt)
    .all();

  const memberships = db.select().from(schema.membership).all();

  // Build groupId → agentId[] map
  const agentsByGroup = new Map<string, string[]>();
  for (const m of memberships) {
    const list = agentsByGroup.get(m.groupId);
    if (list) {
      list.push(m.agentId);
    } else {
      agentsByGroup.set(m.groupId, [m.agentId]);
    }
  }

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    memberAgentIds: agentsByGroup.get(g.id) ?? [],
  }));
}

/**
 * Deletes a group and its membership rows.
 * Member agents are untouched (R4 — groups are organizational labels, not containers).
 * Returns true if the group existed and was deleted; false if it wasn't found.
 */
export function deleteGroup(groupId: string): boolean {
  const existing = db
    .select({ id: schema.group.id })
    .from(schema.group)
    .where(eq(schema.group.id, groupId))
    .get();

  if (!existing) return false;

  db.transaction((tx) => {
    tx.delete(schema.membership).where(eq(schema.membership.groupId, groupId)).run();
    tx.delete(schema.group).where(eq(schema.group.id, groupId)).run();
  });

  return true;
}

// ─────────────────────────────  Membership  ───────────────────────────────

/**
 * Adds an agent to a group.
 *
 * Idempotent: if the membership already exists, returns { created: false } rather
 * than throwing (the route layer returns 200 in that case, 201 for new).
 *
 * Returns null if either the agent or the group does not exist.
 */
export function addMembership(
  agentId: string,
  groupId: string,
): { created: boolean } | null {
  // Verify both exist
  const agentRow = db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();
  if (!agentRow) return null;

  const groupRow = db
    .select({ id: schema.group.id })
    .from(schema.group)
    .where(eq(schema.group.id, groupId))
    .get();
  if (!groupRow) return null;

  // Check for existing membership
  const existing = db
    .select()
    .from(schema.membership)
    .where(
      and(
        eq(schema.membership.agentId, agentId),
        eq(schema.membership.groupId, groupId),
      ),
    )
    .get();

  if (existing) return { created: false };

  db.insert(schema.membership).values({ agentId, groupId }).run();
  return { created: true };
}

/**
 * Removes an agent from a group.
 * Returns true if the membership existed and was deleted; false if not found.
 */
export function removeMembership(agentId: string, groupId: string): boolean {
  const existing = db
    .select()
    .from(schema.membership)
    .where(
      and(
        eq(schema.membership.agentId, agentId),
        eq(schema.membership.groupId, groupId),
      ),
    )
    .get();

  if (!existing) return false;

  db
    .delete(schema.membership)
    .where(
      and(
        eq(schema.membership.agentId, agentId),
        eq(schema.membership.groupId, groupId),
      ),
    )
    .run();

  return true;
}
