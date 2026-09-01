import 'server-only';

/**
 * lib/db/repository/agentShares.ts
 *
 * Sole owner of the agent_share table (Plan 15 — Share agent), plus the
 * agent.publicCode link-sharing accessors — kept here rather than agents.ts
 * because both are share-feature state; one file to read covers all of "how
 * does someone come to have read access to an agent they don't own."
 *
 * Ownership is NOT enforced here. Every function below is scoped by agentId
 * only — the caller (a route handler) is responsible for first confirming the
 * caller owns that agent, via the existing owner-scoped functions in
 * agents.ts (e.g. getAgentFull(agentId, ownerId)). This mirrors the schema:
 * agent_share has no ownerId column of its own — ownership lives on the agent
 * row, not here (plans/archive/15-share-agent.md §4.2).
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';

// ─────────────────────────────  DTO types  ─────────────────────────────────

export type AgentShareRow = {
  id: string;
  agentId: string;
  recipientEmail: string;
  grantedVia: 'email' | 'code';
  createdAt: Date;
};

// ─────────────────────────────  Normalization  ──────────────────────────────

/** Matches user.email's stored normalization (lowercased + trimmed) — §4.8 rule 4. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─────────────────────────────  agent_share CRUD  ───────────────────────────

/**
 * Grants access — idempotent. If a row for (agentId, normalized email) already
 * exists (by either mechanism), returns that existing row unchanged rather than
 * inserting a second one or throwing (§4.5's "idempotent-grant" rule — and the
 * cross-mechanism case: granting by code for an agent already granted by email
 * is likewise a no-op, since both write into the same agent_share row shape).
 */
export function createShare(
  agentId: string,
  recipientEmail: string,
  grantedVia: 'email' | 'code',
): AgentShareRow {
  const email = normalizeEmail(recipientEmail);

  const existing = db
    .select()
    .from(schema.agentShare)
    .where(and(eq(schema.agentShare.agentId, agentId), eq(schema.agentShare.recipientEmail, email)))
    .get();

  if (existing) return mapRow(existing);

  const id = crypto.randomUUID();
  const now = new Date();

  try {
    db.insert(schema.agentShare).values({
      id,
      agentId,
      recipientEmail: email,
      grantedVia,
      createdAt: now,
    }).run();
  } catch (err) {
    // Race: two concurrent grants for the same (agentId, email) can both pass
    // the pre-check above before either INSERT commits. Re-read and return the
    // now-existing row rather than surfacing a raw constraint failure — same
    // posture updateAgent() in agents.ts takes for its own name-collision race.
    if (
      err instanceof Error &&
      (err.message.includes('UNIQUE constraint failed') || err.message.includes('SQLITE_CONSTRAINT'))
    ) {
      const row = db
        .select()
        .from(schema.agentShare)
        .where(and(eq(schema.agentShare.agentId, agentId), eq(schema.agentShare.recipientEmail, email)))
        .get();
      if (row) return mapRow(row);
    }
    throw err;
  }

  return { id, agentId, recipientEmail: email, grantedVia, createdAt: now };
}

/** Lists every share row for an agent, newest first — the owner's Access panel. */
export function listSharesForAgent(agentId: string): AgentShareRow[] {
  const rows = db
    .select()
    .from(schema.agentShare)
    .where(eq(schema.agentShare.agentId, agentId))
    .all();
  return rows.map(mapRow).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Revokes one share row. Requires both shareId and agentId to match, so a
 * revoke request can never touch a different agent's row (the caller has
 * already confirmed ownership of agentId before calling this).
 * Returns true if a row was deleted, false if not found.
 */
export function deleteShare(shareId: string, agentId: string): boolean {
  const result = db
    .delete(schema.agentShare)
    .where(and(eq(schema.agentShare.id, shareId), eq(schema.agentShare.agentId, agentId)))
    .run();
  return result.changes > 0;
}

/** Deletes every share row for an agent — used by deleteAgent()'s cascade (§4.2). */
export function deleteSharesForAgent(agentId: string): void {
  db.delete(schema.agentShare).where(eq(schema.agentShare.agentId, agentId)).run();
}

/**
 * Finds the share row (if any) for a specific (agentId, email) pair —
 * normalized the same way createShare() writes it. Null if no such grant.
 */
export function findShare(agentId: string, recipientEmail: string): AgentShareRow | null {
  const email = normalizeEmail(recipientEmail);
  const row = db
    .select()
    .from(schema.agentShare)
    .where(and(eq(schema.agentShare.agentId, agentId), eq(schema.agentShare.recipientEmail, email)))
    .get();
  return row ? mapRow(row) : null;
}

// ─────────────────────────────  agent.publicCode accessors  ─────────────────
// Link-sharing state lives on the agent row itself (two nullable columns), not
// a separate table — but the functions that touch it live here, not in
// agents.ts, since they are share-feature state (§4.11).

/**
 * Sets agent.publicCode + publicCodeCreatedAt — the "enable link sharing" write.
 * Callers own idempotent-enable (D9): if a code already exists, the route must
 * return it unchanged rather than calling this again. Collision retry on the
 * 256-bit code (§4.3: up to 3 attempts) is the caller's responsibility, matching
 * where the equivalent retry loop lives for invite codes
 * (app/api/settings/invite-codes/route.ts) — not in the repository.
 */
export function setPublicCode(agentId: string, code: string): { publicCode: string; publicCodeCreatedAt: Date } {
  const now = new Date();
  db.update(schema.agent)
    .set({ publicCode: code, publicCodeCreatedAt: now })
    .where(eq(schema.agent.id, agentId))
    .run();
  return { publicCode: code, publicCodeCreatedAt: now };
}

/** Clears agent.publicCode + publicCodeCreatedAt — the "disable link sharing" write. */
export function clearPublicCode(agentId: string): void {
  db.update(schema.agent)
    .set({ publicCode: null, publicCodeCreatedAt: null })
    .where(eq(schema.agent.id, agentId))
    .run();
}

/** Resolves a public code to its agent's id, or null if no agent currently has this code. */
export function findAgentIdByPublicCode(code: string): string | null {
  const row = db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(eq(schema.agent.publicCode, code))
    .get();
  return row?.id ?? null;
}

/**
 * Reads an agent's current link-sharing state — not part of AgentDTO (§4.5:
 * link state is deliberately returned by its own small route, not folded into
 * the general agent read). Returns null if the agent doesn't exist.
 */
export function getPublicCodeInfo(
  agentId: string,
): { publicCode: string | null; publicCodeCreatedAt: Date | null } | null {
  const row = db
    .select({ publicCode: schema.agent.publicCode, publicCodeCreatedAt: schema.agent.publicCodeCreatedAt })
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();
  return row ?? null;
}

// ─────────────────────────────  Internal helpers  ───────────────────────────

function mapRow(row: typeof schema.agentShare.$inferSelect): AgentShareRow {
  return {
    id: row.id,
    agentId: row.agentId,
    recipientEmail: row.recipientEmail,
    grantedVia: row.grantedVia as 'email' | 'code',
    createdAt: row.createdAt,
  };
}
