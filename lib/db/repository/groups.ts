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
 * ownerId is required — scoped to this owner (§6.2).
 * Throws with name 'NameExistsError' on duplicate name for this owner (→ 409 at the route layer),
 * consistent with the updateAgent pattern in agents.ts.
 */
export function createGroup(ownerId: string, name: string): GroupDTO {
  const groupId = crypto.randomUUID();

  try {
    db.insert(schema.group).values({
      id: groupId,
      ownerId,
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
 * Returns all groups belonging to the given owner, each with their current member agent IDs.
 * Order is by createdAt ascending (insertion order).
 *
 * ownerId is required — filters to this owner's groups only (§6.2).
 */
export function listGroups(ownerId: string): GroupDTO[] {
  const groups = db
    .select()
    .from(schema.group)
    .where(eq(schema.group.ownerId, ownerId))
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
 *
 * ownerId is required — enforced in the same lookup (constraint 1, §6.2).
 * Returns true if the group existed and was deleted; false if not found or owner mismatch.
 */
export function deleteGroup(groupId: string, ownerId: string): boolean {
  const existing = db
    .select({ id: schema.group.id })
    .from(schema.group)
    .where(and(eq(schema.group.id, groupId), eq(schema.group.ownerId, ownerId)))
    .get();

  if (!existing) return false;

  db.transaction((tx) => {
    tx.delete(schema.membership).where(eq(schema.membership.groupId, groupId)).run();
    tx.delete(schema.group)
      .where(and(eq(schema.group.id, groupId), eq(schema.group.ownerId, ownerId)))
      .run();
  });

  return true;
}

// ─────────────────────────────  Membership  ───────────────────────────────

/**
 * Adds an agent to a group.
 *
 * ownerId is required — the agent AND the group must both belong to this owner
 * (§6.3 fix #3: prevents cross-owner group membership).
 *
 * Idempotent: if the membership already exists, returns { created: false } rather
 * than throwing (the route layer returns 200 in that case, 201 for new).
 *
 * Returns null if either the agent or the group does not exist, or if either
 * belongs to a different owner.
 */
export function addMembership(
  agentId: string,
  groupId: string,
  ownerId: string,
): { created: boolean } | null {
  // Verify both exist and belong to the same owner
  const agentRow = db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(and(eq(schema.agent.id, agentId), eq(schema.agent.ownerId, ownerId)))
    .get();
  if (!agentRow) return null;

  const groupRow = db
    .select({ id: schema.group.id })
    .from(schema.group)
    .where(and(eq(schema.group.id, groupId), eq(schema.group.ownerId, ownerId)))
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
 *
 * ownerId is required — verifies both the agent and the group belong to this owner
 * (§6.3 fix #3: prevents cross-owner membership removal).
 *
 * Returns true if the membership existed and was deleted; false if not found or
 * the agent/group belongs to a different owner.
 */
export function removeMembership(agentId: string, groupId: string, ownerId: string): boolean {
  // Ownership check: both agent and group must belong to this owner
  const agentRow = db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(and(eq(schema.agent.id, agentId), eq(schema.agent.ownerId, ownerId)))
    .get();
  if (!agentRow) return false;

  const groupRow = db
    .select({ id: schema.group.id })
    .from(schema.group)
    .where(and(eq(schema.group.id, groupId), eq(schema.group.ownerId, ownerId)))
    .get();
  if (!groupRow) return false;

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
