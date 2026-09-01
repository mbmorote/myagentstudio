/**
 * lib/db/repository/agents.ts
 *
 * Repository layer for agent CRUD + section mutations.
 * This is the only file that touches agent/section/revision/snapshot tables.
 * Routes and components import from lib/db/repository/index.ts only.
 *
 * IMPORTANT: better-sqlite3 is a synchronous library. drizzle-orm/better-sqlite3
 * operations are synchronous but the query builder is LAZY — you must call .all()
 * (for multiple rows) or .get() (for one row) to actually execute a SELECT.
 * INSERT/UPDATE/DELETE must call .run() to execute.
 * Transaction callbacks MUST be synchronous.
 *
 * Invariants enforced here (§6 business rules):
 *   - Rule 3: every AgentSection.content change appends exactly one SectionRevision.
 *   - Rule 4: SectionRevision and AgentSnapshot rows are never cascade-deleted
 *     (soft ref — deletion cascades handled explicitly below).
 *   - R4: optimistic concurrency via AgentSection.version.
 *   - D5: platform-created sections get author:'scaffold' for revision #0.
 */

import { eq, inArray, and } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';
import { Rules } from '../../blueprint/rules.js';
import { exportAgent } from '../../serialize/index.js';
import type { StructuredAgent, FrontmatterEntry, BodyBlock } from '../../serialize/types.js';

// ─────────────────────────────  DTO types  ─────────────────────────────────

/** Lite shape for configDef and sectionDef embedded in the AgentDTO. */
export type ConfigDefLite = {
  key: string;
  label: string;
  datatype: string;
  allowedValues: string[] | null;
  required: boolean;
  isCore: boolean;
  exportable: boolean;
  hint: string | null;
};

export type SectionDefLite = {
  key: string;
  defaultHeading: string;
  isCore: boolean;
  defaultOrder: number;
  template: string;
  helpText: string;
};

/** Full agent DTO as described in §5 of Plan 01. */
export type AgentDTO = {
  id: string;
  name: string;
  description: string;
  source: 'created' | 'imported' | 'copied';
  platform: string;
  splitLevel: number;
  /** ISO 8601 — bumped on every write to the agent or its sections/config (2026-08-11,
   *  added so the Raw panel can tell content actually changed and re-fetch the export
   *  instead of only re-fetching when the agent switches). */
  updatedAt: string;
  config: { propKey: string; value: unknown; def: ConfigDefLite | null }[];
  sections: {
    id: string;
    sectionKey: string;
    heading: string | null;
    content: string;
    order: number;
    version: number;
    def: SectionDefLite | null;
  }[];
  validation: {
    descriptionMissing: boolean;
    unknownConfigKeys: string[];
    outdatedOrUnknownValues: { propKey: string; value: unknown }[];
  };
};

/** Error thrown when a section is not found or the ownership/agent check fails (§6.4). */
export class SectionNotFoundError extends Error {
  constructor(sectionId: string) {
    super(`Section not found: ${sectionId}`);
    this.name = 'SectionNotFoundError';
  }
}

/** Error thrown when an optimistic version check fails (R4). */
export class VersionConflictError extends Error {
  readonly current: number;
  /** The section's actual current content at the time of the conflict.
   *  Included so /api/chat can return `{conflict:true, current, content}` in
   *  one round trip without a follow-up GET (§5, Draft D). */
  readonly currentContent: string;
  constructor(current: number, currentContent: string) {
    super(`Version conflict: expected version does not match current (${current})`);
    this.name = 'VersionConflictError';
    this.current = current;
    this.currentContent = currentContent;
  }
}

// ─────────────────────────────  Helpers  ───────────────────────────────────

/** Build a full AgentDTO from a raw agent row (synchronous DB reads). */
function buildAgentDTO(
  agentRow: typeof schema.agent.$inferSelect,
): AgentDTO {
  // All .all() calls execute immediately (synchronous better-sqlite3 driver)
  const configDefs = db.select().from(schema.configDef).orderBy(schema.configDef.id).all();
  const sectionDefs = db.select().from(schema.sectionDef).orderBy(schema.sectionDef.defaultOrder).all();
  const configRows = db.select().from(schema.agentConfig).where(eq(schema.agentConfig.agentId, agentRow.id)).all();
  const sectionRows = db
    .select()
    .from(schema.agentSection)
    .where(eq(schema.agentSection.agentId, agentRow.id))
    .orderBy(schema.agentSection.order)
    .all();

  const configDefMap = new Map(configDefs.map((d) => [d.key, d]));
  const sectionDefMap = new Map(sectionDefs.map((d) => [d.key, d]));

  const config = configRows.map((row) => {
    const def = configDefMap.get(row.propKey) ?? null;
    return {
      propKey: row.propKey,
      value: row.value,
      def: def
        ? ({
            key: def.key,
            label: def.label,
            datatype: def.datatype,
            allowedValues: def.allowedValues as string[] | null,
            required: def.required ?? false,
            isCore: def.isCore ?? false,
            exportable: def.exportable ?? true,
            hint: def.hint ?? null,
          } satisfies ConfigDefLite)
        : null,
    };
  });

  const sections = sectionRows.map((row) => {
    const def = sectionDefMap.get(row.sectionKey) ?? null;
    return {
      id: row.id,
      sectionKey: row.sectionKey,
      heading: row.heading ?? null,
      content: row.content,
      order: row.order,
      version: row.version,
      def: def
        ? ({
            key: def.key,
            defaultHeading: def.defaultHeading,
            isCore: def.isCore ?? false,
            defaultOrder: def.defaultOrder,
            template: def.template,
            helpText: def.helpText,
          } satisfies SectionDefLite)
        : null,
    };
  });

  const validation = Rules.computeValidation({
    name: agentRow.name,
    description: agentRow.description,
    config: config.map((c) => ({ propKey: c.propKey, value: c.value })),
  });

  return {
    id: agentRow.id,
    name: agentRow.name,
    description: agentRow.description,
    source: agentRow.source,
    platform: agentRow.platform,
    splitLevel: agentRow.splitLevel,
    updatedAt: agentRow.updatedAt.toISOString(),
    config,
    sections,
    validation,
  };
}

// ─────────────────────────────  CRUD  ──────────────────────────────────────

/**
 * Issue #9 — a brand-new agent used to seed its core sections from
 * SectionDef.template (bare bracket placeholders like "You are a [senior X]…"),
 * which read as empty to a first-time user. createAgent() now seeds a complete,
 * realistic example (a "Code Reviewer" persona) instead — content the user
 * edits or deletes, not a fill-in-the-blank form. def.template is untouched and
 * still used for the "+ Add section" flow (SectionsZone.tsx) on existing agents,
 * which must stay a blank/generic starting point, not this specific persona.
 */
const STARTER_EXAMPLE_SECTIONS: Record<string, string> = {
  role: 'You are a Code Reviewer specializing in:\n- Correctness bugs and edge cases\n- Security vulnerabilities\n- Readability and maintainability\n\nYour job is to review the changes in front of you and flag anything that would cause a wrong result, a crash, or a security issue in production — not to nitpick style.',
  behavior: '1. Read the diff or files in scope before commenting on anything.\n2. Check each change against its likely failure modes: bad input, empty/null values, concurrent access, off-by-one errors.\n3. Rank findings by severity — correctness and security first, style last.\n4. Report findings with the exact file and line, and a concrete scenario that breaks.',
  guardrails: '- Never approve code you have not actually read.\n- Never invent a bug you cannot point to a specific line for.\n- Always distinguish "this is wrong" from "this is a style preference".',
  output: '| Section | Format |\n|---|---|\n| Summary | 1-2 sentences |\n| Findings | Bulleted, file:line, severity-ordered |\n| Verdict | Approve / Needs changes |',
};

/** Config defaults paired with STARTER_EXAMPLE_SECTIONS above — issue #9 also
 *  flagged that a new agent starts with no config at all. */
const STARTER_EXAMPLE_CONFIG: { propKey: string; value: unknown }[] = [
  { propKey: 'model', value: 'sonnet' },
  { propKey: 'tools', value: ['Read', 'Grep', 'Glob'] },
];

/**
 * Creates an agent row (source:'created', platform:'claude' default) + seeds one
 * AgentSection per SectionDef.isCore, each with a SectionRevision(author:'scaffold')
 * revision #0 (D5 — 'scaffold' is distinct from 'import'/'user'/'ai'), plus the
 * STARTER_EXAMPLE_CONFIG rows above.
 *
 * ownerId is required and non-defaulted (constraint 2, §6.2).
 */
export function createAgent(
  ownerId: string,
  name: string,
  description: string,
): AgentDTO {
  const agentId = crypto.randomUUID();
  // Execute the query OUTSIDE the transaction to get the array
  const coreDefs = db
    .select()
    .from(schema.sectionDef)
    .where(eq(schema.sectionDef.isCore, true))
    .orderBy(schema.sectionDef.defaultOrder)
    .all();

  try {
    db.transaction((tx) => {
      tx.insert(schema.agent).values({
        id: agentId,
        ownerId,
        name,
        description,
        source: 'created',
        platform: 'claude',
        splitLevel: 1,
      }).run();

      for (const def of coreDefs) {
        const sectionId = crypto.randomUUID();
        const content = STARTER_EXAMPLE_SECTIONS[def.key] ?? def.template;
        tx.insert(schema.agentSection).values({
          id: sectionId,
          agentId,
          sectionKey: def.key,
          heading: def.defaultHeading,
          content,
          order: def.defaultOrder,
          version: 0,
        }).run();

        // Revision #0 — author:'scaffold' (D5)
        tx.insert(schema.sectionRevision).values({
          id: crypto.randomUUID(),
          sectionId,
          content,
          author: 'scaffold',
        }).run();
      }

      if (STARTER_EXAMPLE_CONFIG.length > 0) {
        tx.insert(schema.agentConfig).values(
          STARTER_EXAMPLE_CONFIG.map((c) => ({ agentId, propKey: c.propKey, value: c.value })),
        ).run();
      }
    });
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

  const agentRow = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();

  if (!agentRow) throw new Error(`Agent row not found after insert: ${agentId}`);
  return buildAgentDTO(agentRow);
}

/**
 * Returns the full AgentDTO for a given agent ID, or null if not found or owner mismatch.
 *
 * ownerId is required — ownership is enforced in the same query (constraint 1, §6.1).
 */
export function getAgentFull(agentId: string, ownerId: string): AgentDTO | null {
  const agentRow = db
    .select()
    .from(schema.agent)
    .where(and(eq(schema.agent.id, agentId), eq(schema.agent.ownerId, ownerId)))
    .get();

  if (!agentRow) return null;
  return buildAgentDTO(agentRow);
}

/**
 * Looks up an agent by name within an owner's scope and returns its ID + rawSourceSnapshot.
 * Used by the import route's re-import short-circuit: if the incoming raw bytes exactly
 * match this snapshot, the AI call is skipped entirely and the current AgentDTO is
 * returned as-is. Returns null if no agent with that name exists for this owner.
 *
 * ownerId is required — owner-scoped, so this can never short-circuit user B's import
 * on user A's identical file and return A's AgentDTO.
 */
export function getAgentSnapshotInfo(
  name: string,
  ownerId: string,
): { id: string; rawSourceSnapshot: string | null } | null {
  const row = db
    .select()
    .from(schema.agent)
    .where(and(eq(schema.agent.name, name), eq(schema.agent.ownerId, ownerId)))
    .get();

  if (!row) return null;
  return { id: row.id, rawSourceSnapshot: row.rawSourceSnapshot ?? null };
}

/**
 * Lite DTO shape returned by listAgents(). Same as AgentDTO minus heavy fields,
 * plus groupIds[] which lists every group this agent belongs to (Plan 03 A.3).
 */
export type AgentLiteDTO = Omit<AgentDTO, 'sections' | 'config' | 'validation'> & {
  groupIds: string[];
};

/**
 * Returns a lite list of agents belonging to the given owner
 * (agent row fields + groupIds; no sections/config/validation).
 * groupIds is populated via a join against membership (Plan 03 A.3).
 *
 * ownerId is required — filters to only this owner's agents (§6.2).
 */
export function listAgents(ownerId: string): AgentLiteDTO[] {
  const rows = db.select().from(schema.agent).where(eq(schema.agent.ownerId, ownerId)).orderBy(schema.agent.name).all();
  const memberships = db.select().from(schema.membership).all();

  // Build agentId → groupId[] map
  const groupIdsByAgent = new Map<string, string[]>();
  for (const m of memberships) {
    const list = groupIdsByAgent.get(m.agentId);
    if (list) {
      list.push(m.groupId);
    } else {
      groupIdsByAgent.set(m.agentId, [m.groupId]);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    source: r.source,
    platform: r.platform,
    splitLevel: r.splitLevel,
    updatedAt: r.updatedAt.toISOString(),
    groupIds: groupIdsByAgent.get(r.id) ?? [],
  }));
}

// ─────────────────────────────  Viewer-scoped reads (Plan 15)  ─────────────
// Owner OR share-holder. A separate function rather than an includeShared flag
// on getAgentFull/listAgents (constraint 2, plans/archive/15-share-agent.md §3): an
// optional parameter would put every one of getAgentFull's ~30 existing call
// sites one wrong default away from leaking. getAgentFull and listAgents are
// NOT modified by this plan — their bodies above are untouched.

/**
 * Lite DTO shape returned by listSharedWithViewer(). Same as AgentLiteDTO minus
 * groupIds (groups are owner-scoped; a shared agent is in none of the viewer's
 * groups and never can be), plus ownerEmail so the library row can say who
 * shared it. Showing the owner's address to the recipient is safe and intended
 * — the owner deliberately granted them access; this is not the
 * account-existence oracle constraint 6 forbids, which is about probing
 * addresses the owner did NOT already choose to share with.
 */
export type SharedAgentLiteDTO = Omit<AgentLiteDTO, 'groupIds'> & {
  ownerEmail: string;
};

/**
 * Returns the full AgentDTO for a given agent ID if the viewer is either the
 * owner OR holds a share grant on it — and which one, so callers can branch
 * explicitly (constraint 1: a 'shared' access value is never treated as
 * ownership by any caller). Returns null if neither applies.
 *
 * Constraint 4: the viewer's email is resolved HERE, from the authoritative
 * user row, by viewerId — never accepted as a parameter and never read from
 * session.email. No authorization decision in this function trusts anything
 * the caller asserts about who they are beyond their own user id.
 */
export function getAgentFullForViewer(
  agentId: string,
  viewerId: string,
): { agent: AgentDTO; access: 'owner' | 'shared'; ownerEmail?: string } | null {
  const agentRow = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();

  if (!agentRow) return null;

  if (agentRow.ownerId === viewerId) {
    return { agent: buildAgentDTO(agentRow), access: 'owner' };
  }

  const viewer = db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, viewerId))
    .get();
  if (!viewer) return null;

  const share = db
    .select({ id: schema.agentShare.id })
    .from(schema.agentShare)
    .where(and(eq(schema.agentShare.agentId, agentId), eq(schema.agentShare.recipientEmail, viewer.email)))
    .get();
  if (!share) return null;

  // ownerEmail (added 2026-08-31, not in the original §4.4 signature) — SharedAgentView's
  // "shared by <owner>" banner needs it and there was no other viewer-scoped path to get
  // it; safe to add since this function has no existing caller depending on the shape
  // NOT carrying an extra optional field (every call site destructures `{ agent, access }`).
  const owner = db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, agentRow.ownerId))
    .get();

  return { agent: buildAgentDTO(agentRow), access: 'shared', ownerEmail: owner?.email };
}

/**
 * Returns every agent shared WITH this viewer — never an agent they own
 * (§4.4's stated invariant, enforced explicitly below rather than assumed from
 * "you can't hold a share on your own agent," since that's a route-layer rule,
 * not a database constraint).
 *
 * Same constraint-4 resolution as getAgentFullForViewer: the viewer's email is
 * read from the user table by viewerId, not accepted as an argument.
 */
export function listSharedWithViewer(viewerId: string): SharedAgentLiteDTO[] {
  const viewer = db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, viewerId))
    .get();
  if (!viewer) return [];

  const shareRows = db
    .select({ agentId: schema.agentShare.agentId })
    .from(schema.agentShare)
    .where(eq(schema.agentShare.recipientEmail, viewer.email))
    .all();
  if (shareRows.length === 0) return [];

  const agentIds = shareRows.map((r) => r.agentId);
  const agentRows = db
    .select()
    .from(schema.agent)
    .where(inArray(schema.agent.id, agentIds))
    .all();

  // Excludes any agent the viewer owns — see the doc comment above.
  const notOwned = agentRows.filter((a) => a.ownerId !== viewerId);
  if (notOwned.length === 0) return [];

  const ownerIds = [...new Set(notOwned.map((a) => a.ownerId))];
  const ownerRows = db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(inArray(schema.user.id, ownerIds))
    .all();
  const ownerEmailById = new Map(ownerRows.map((o) => [o.id, o.email]));

  return notOwned
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      source: r.source,
      platform: r.platform,
      splitLevel: r.splitLevel,
      updatedAt: r.updatedAt.toISOString(),
      ownerEmail: ownerEmailById.get(r.ownerId) ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Returns an agent's ownerId and name with NO viewer scoping — the one
 * deliberate exception to "every read takes an ownerId/viewerId." Used only by
 * the redeem flow (POST /api/agents/redeem): that route has already authorized
 * itself by resolving a caller-supplied publicCode to this exact agentId via
 * findAgentIdByPublicCode() (lib/db/repository/agentShares.ts) BEFORE ever
 * calling this — knowing the code IS the grant, so nothing here decides access,
 * it only reads two display fields. Not a general-purpose unscoped lookup;
 * do not reuse this for any other route.
 */
export function getAgentOwnerAndName(agentId: string): { ownerId: string; name: string } | null {
  const row = db
    .select({ ownerId: schema.agent.ownerId, name: schema.agent.name })
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();
  return row ?? null;
}

/**
 * Overwrites a section's content and appends exactly one SectionRevision (rule 3, R4).
 *
 * Requires that section.id === sectionId, section.agentId === agentId, and the
 * section's agent has ownerId === ownerId. Any mismatch throws SectionNotFoundError
 * (§6.4 — closes the [id]-ignored bug; no oracle about which check failed).
 *
 * Throws VersionConflictError if expectedVersion doesn't match the current version.
 * The ownership check runs BEFORE the version check (§6.4).
 */
export function updateSectionContent(
  agentId: string,
  sectionId: string,
  ownerId: string,
  content: string,
  author: 'import' | 'reimport' | 'scaffold' | 'user' | 'ai',
  expectedVersion: number,
): { version: number } {
  // Load the section
  const section = db
    .select()
    .from(schema.agentSection)
    .where(eq(schema.agentSection.id, sectionId))
    .get();

  if (!section) {
    throw new SectionNotFoundError(sectionId);
  }

  // §6.4: All three must agree — section.id, section.agentId, agent.ownerId
  if (section.agentId !== agentId) {
    throw new SectionNotFoundError(sectionId);
  }

  const agentRow = db
    .select({ ownerId: schema.agent.ownerId })
    .from(schema.agent)
    .where(and(eq(schema.agent.id, agentId), eq(schema.agent.ownerId, ownerId)))
    .get();

  if (!agentRow) {
    throw new SectionNotFoundError(sectionId);
  }

  // Optimistic concurrency check (R4) — runs AFTER ownership (§6.4)
  if (section.version !== expectedVersion) {
    throw new VersionConflictError(section.version, section.content);
  }

  const newVersion = section.version + 1;

  db.transaction((tx) => {
    // Append one SectionRevision (rule 3 — exactly one per content write)
    tx.insert(schema.sectionRevision).values({
      id: crypto.randomUUID(),
      sectionId,
      content,
      author,
    }).run();

    tx
      .update(schema.agentSection)
      .set({ content, version: newVersion })
      .where(eq(schema.agentSection.id, sectionId))
      .run();

    tx
      .update(schema.agent)
      .set({ updatedAt: new Date() })
      .where(eq(schema.agent.id, section.agentId))
      .run();
  });

  return { version: newVersion };
}

/**
 * Adds a new section to an agent — the manual "+" add path (D3, TODO item 1's non-chat
 * half) and, as of 2026-08-11, Prometheus's chat-driven add too (apply-proposal calls
 * this when a proposed sectionKey doesn't match an existing section).
 *
 * Ordering (rewritten 2026-08-11 — found live: a chat-added core "output" section
 * landed after several non-core ones, always-append-at-end had no concept of the
 * blueprint's canonical order). A sectionKey matching the platform's section catalog
 * is inserted at its canonical position *relative to the agent's other catalog-matched
 * sections* — sections with no catalog match (genuinely custom ones, sectionKey
 * "custom" or otherwise unrecognized) keep their existing relative order and the new
 * one, if it's one of them, is appended after all catalog-matched sections, same as
 * before. This reindexes every section's `order` on the agent, not just the new row's —
 * inserting in the middle requires shifting what comes after it. This function doesn't
 * validate content against the blueprint catalog beyond ordering (that stays a
 * route/UI concern, same separation as updateSectionContent not validating content
 * against datatype/allowedValues — the project-wide flag-don't-block posture, applied
 * the same way regardless of who or what produced the value).
 *
 * `author` defaults to 'user' (the manual-add path, a human creating this row
 * directly) — the chat-add caller passes 'ai' explicitly, same convention
 * updateSectionContent's chat-driven calls already use.
 */
export function addSection(
  agentId: string,
  ownerId: string,
  input: { sectionKey: string; heading: string | null; content: string },
  author: 'user' | 'ai' = 'user',
): { id: string; order: number; version: number } {
  const agent = db
    .select({ id: schema.agent.id, platform: schema.agent.platform })
    .from(schema.agent)
    .where(and(eq(schema.agent.id, agentId), eq(schema.agent.ownerId, ownerId)))
    .get();

  if (!agent) {
    throw new SectionNotFoundError(agentId);
  }

  const existing = db
    .select({ id: schema.agentSection.id, sectionKey: schema.agentSection.sectionKey })
    .from(schema.agentSection)
    .where(eq(schema.agentSection.agentId, agentId))
    .orderBy(schema.agentSection.order)
    .all();

  const catalogDefs = db
    .select({ key: schema.sectionDef.key, defaultOrder: schema.sectionDef.defaultOrder })
    .from(schema.sectionDef)
    .where(eq(schema.sectionDef.platform, agent.platform))
    .all();
  const catalogOrder = new Map(catalogDefs.map((d) => [d.key, d.defaultOrder]));

  type Item = { id: string | null; catalogOrder: number };
  const catalogItems: Item[] = [];
  const customItems: Item[] = [];
  for (const s of existing) {
    const order = catalogOrder.get(s.sectionKey);
    if (order !== undefined) catalogItems.push({ id: s.id, catalogOrder: order });
    else customItems.push({ id: s.id, catalogOrder: Infinity });
  }
  const newCatalogOrder = catalogOrder.get(input.sectionKey);
  const sectionId = crypto.randomUUID();
  if (newCatalogOrder !== undefined) {
    catalogItems.push({ id: sectionId, catalogOrder: newCatalogOrder });
  } else {
    customItems.push({ id: sectionId, catalogOrder: Infinity });
  }
  // Stable sort — ties (shouldn't happen for real catalog rows, but harmless if they
  // do) keep their prior relative order since Array.prototype.sort is stable.
  catalogItems.sort((a, b) => a.catalogOrder - b.catalogOrder);
  const finalOrder = [...catalogItems, ...customItems];

  let newOrder = 0;
  db.transaction((tx) => {
    finalOrder.forEach((item, idx) => {
      if (item.id === sectionId) {
        newOrder = idx;
        tx.insert(schema.agentSection).values({
          id: sectionId,
          agentId,
          sectionKey: input.sectionKey,
          heading: input.heading,
          content: input.content,
          order: idx,
          version: 0,
        }).run();
        tx.insert(schema.sectionRevision).values({
          id: crypto.randomUUID(),
          sectionId,
          content: input.content,
          author,
        }).run();
      } else {
        tx.update(schema.agentSection).set({ order: idx }).where(eq(schema.agentSection.id, item.id!)).run();
      }
    });

    tx.update(schema.agent).set({ updatedAt: new Date() }).where(eq(schema.agent.id, agentId)).run();
  });

  return { id: sectionId, order: newOrder, version: 0 };
}

/**
 * Deletes a section — manual remove via the structured view (D3, TODO item 1's
 * non-chat half). Not exposed to chat/Prometheus.
 *
 * SectionRevision rows are NOT cascade-deleted (rule 4, same as every other deletion
 * path in this file) — history outlives the row. No isCore check here or at the
 * route layer — core sections are removable like any other (2026-08-11, at the
 * user's explicit request).
 */
export function deleteSection(agentId: string, sectionId: string, ownerId: string): void {
  const section = db
    .select()
    .from(schema.agentSection)
    .where(eq(schema.agentSection.id, sectionId))
    .get();

  if (!section) {
    throw new SectionNotFoundError(sectionId);
  }

  // §6.4: All three must agree — section.id, section.agentId, agent.ownerId
  if (section.agentId !== agentId) {
    throw new SectionNotFoundError(sectionId);
  }

  const agentRow = db
    .select({ ownerId: schema.agent.ownerId })
    .from(schema.agent)
    .where(and(eq(schema.agent.id, agentId), eq(schema.agent.ownerId, ownerId)))
    .get();

  if (!agentRow) {
    throw new SectionNotFoundError(sectionId);
  }

  db.transaction((tx) => {
    tx.delete(schema.agentSection).where(eq(schema.agentSection.id, sectionId)).run();
    tx.update(schema.agent).set({ updatedAt: new Date() }).where(eq(schema.agent.id, agentId)).run();
  });
}

// ─────────────────────────────  Upsert (import)  ──────────────────────────

export type ImportedAgentData = {
  name: string;
  description: string;
  platform: string;
  splitLevel: number;
  rawSourceSnapshot: string;
  config: { propKey: string; value: unknown }[];
  sections: {
    sectionKey: string;
    heading: string | null;
    content: string;
    order: number;
  }[];
};

/**
 * Creates or updates an agent from import data. A name collision with an existing
 * agent is always an update-in-place — never a duplicate, never an error.
 *
 * ownerId is a separate parameter — never a field on ImportedAgentData.
 * The lookup is owner-scoped (this can never short-circuit B's import from
 * overwriting A's agent when their frontmatter names collide).
 *
 * First-time import: creates agent (source:'imported') + writes AgentSnapshot(post-import).
 * Re-import of existing name:
 *   - writes AgentSnapshot(pre-import) of the current state
 *   - updates agent row + config rows + section reconciliation — all in one db.transaction (A4)
 *   - section reconciliation uses (sectionKey, heading) identity in document order (A1)
 *   - changed/new sections → create/update content + append reimport revision
 *   - deleted sections → delete row; revisions retained (rule 4)
 *   - writes AgentSnapshot(post-import) of the final state
 *
 * Throws with message 'missing_name' when data.name is empty or whitespace-only (A2).
 */
export function upsertAgentFromImport(ownerId: string, data: ImportedAgentData): AgentDTO {
  // A2: reject empty/whitespace-only name — flag-don't-block (#1) covers format, not absence.
  if (!data.name || data.name.trim().length === 0) {
    const err = new Error('missing_name');
    err.name = 'MissingNameError';
    throw err;
  }

  // §6.3 fix: lookup is owner-scoped — B cannot overwrite A's agent
  const existing = db
    .select()
    .from(schema.agent)
    .where(and(eq(schema.agent.name, data.name), eq(schema.agent.ownerId, ownerId)))
    .get();

  const isUpdate = !!existing;
  const agentId = isUpdate ? existing.id : crypto.randomUUID();

  if (isUpdate) {
    // A4: wrap the entire update path (pre-import snapshot, agent update, config replace,
    // section reconcile) in one db.transaction.
    db.transaction((tx) => {
      // Capture pre-import snapshot (rule 7)
      const currentSections = tx
        .select()
        .from(schema.agentSection)
        .where(eq(schema.agentSection.agentId, agentId))
        .orderBy(schema.agentSection.order)
        .all();

      const preSnapshotContent = serializeAgentSnapshot(existing, currentSections);

      tx.insert(schema.agentSnapshot).values({
        id: crypto.randomUUID(),
        agentId,
        kind: 'pre-import',
        content: preSnapshotContent,
      }).run();

      tx
        .update(schema.agent)
        .set({
          description: data.description,
          platform: data.platform,
          splitLevel: data.splitLevel,
          rawSourceSnapshot: data.rawSourceSnapshot,
          source: 'imported',
          updatedAt: new Date(),
        })
        .where(eq(schema.agent.id, agentId))
        .run();

      // Replace all config rows
      tx.delete(schema.agentConfig).where(eq(schema.agentConfig.agentId, agentId)).run();
      if (data.config.length > 0) {
        tx.insert(schema.agentConfig).values(
          data.config.map((c) => ({ agentId, propKey: c.propKey, value: c.value })),
        ).run();
      }

      // Reconcile sections by (sectionKey, heading) identity in document order.
      // sectionKey alone is not unique per agent — multiple 'custom' rows are routine
      // (the headingless preamble, every unmapped/last-resort block). A sectionKey-only
      // Map would silently collapse those distinct rows onto each other on re-import.
      //
      // Algorithm: build a multimap keyed by (sectionKey, heading). Walk incoming sections
      // in document order; for each, pop the first unmatched db section with the same
      // (sectionKey, heading) → update. No match → create fresh. Db sections never matched
      // → delete (revisions retained — rule 4).
      const dbSections = tx
        .select()
        .from(schema.agentSection)
        .where(eq(schema.agentSection.agentId, agentId))
        .all();

      // Multimap: composite key → queue of db rows (in their original DB order, FIFO match).
      const dbByIdentity = new Map<string, (typeof dbSections[number])[]>();
      for (const row of dbSections) {
        const key = `${row.sectionKey}\0${row.heading ?? ''}`;
        const bucket = dbByIdentity.get(key);
        if (bucket) {
          bucket.push(row);
        } else {
          dbByIdentity.set(key, [row]);
        }
      }

      const matchedDbIds = new Set<string>();

      for (const imported of data.sections) {
        const identityKey = `${imported.sectionKey}\0${imported.heading ?? ''}`;
        const bucket = dbByIdentity.get(identityKey);
        const dbRow = bucket && bucket.length > 0 ? bucket.shift() : undefined;

        if (dbRow) {
          matchedDbIds.add(dbRow.id);
          const newVersion = dbRow.version + 1;
          tx
            .update(schema.agentSection)
            .set({
              content: imported.content,
              heading: imported.heading,
              order: imported.order,
              version: newVersion,
            })
            .where(eq(schema.agentSection.id, dbRow.id))
            .run();

          tx.insert(schema.sectionRevision).values({
            id: crypto.randomUUID(),
            sectionId: dbRow.id,
            content: imported.content,
            author: 'reimport',
          }).run();
        } else {
          const sectionId = crypto.randomUUID();
          tx.insert(schema.agentSection).values({
            id: sectionId,
            agentId,
            sectionKey: imported.sectionKey,
            heading: imported.heading,
            content: imported.content,
            order: imported.order,
            version: 0,
          }).run();
          tx.insert(schema.sectionRevision).values({
            id: crypto.randomUUID(),
            sectionId,
            content: imported.content,
            author: 'reimport',
          }).run();
        }
      }

      // Delete sections absent from the incoming import (revisions retained — rule 4)
      const toDelete = dbSections.filter((s) => !matchedDbIds.has(s.id));
      if (toDelete.length > 0) {
        tx.delete(schema.agentSection).where(
          inArray(schema.agentSection.id, toDelete.map((s) => s.id)),
        ).run();
      }
    });
  } else {
    // First-time import
    db.transaction((tx) => {
      tx.insert(schema.agent).values({
        id: agentId,
        ownerId,
        name: data.name,
        description: data.description,
        platform: data.platform,
        splitLevel: data.splitLevel,
        source: 'imported',
        rawSourceSnapshot: data.rawSourceSnapshot,
      }).run();

      if (data.config.length > 0) {
        tx.insert(schema.agentConfig).values(
          data.config.map((c) => ({ agentId, propKey: c.propKey, value: c.value })),
        ).run();
      }

      for (const s of data.sections) {
        const sectionId = crypto.randomUUID();
        tx.insert(schema.agentSection).values({
          id: sectionId,
          agentId,
          sectionKey: s.sectionKey,
          heading: s.heading,
          content: s.content,
          order: s.order,
          version: 0,
        }).run();
        tx.insert(schema.sectionRevision).values({
          id: crypto.randomUUID(),
          sectionId,
          content: s.content,
          author: 'import',
        }).run();
      }
    });
  }

  // Write post-import snapshot (always — rule 7)
  const finalAgentRow = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();

  if (!finalAgentRow) throw new Error(`Agent row not found after upsert: ${agentId}`);

  const finalSections = db
    .select()
    .from(schema.agentSection)
    .where(eq(schema.agentSection.agentId, agentId))
    .orderBy(schema.agentSection.order)
    .all();

  db.insert(schema.agentSnapshot).values({
    id: crypto.randomUUID(),
    agentId,
    kind: 'post-import',
    content: serializeAgentSnapshot(finalAgentRow, finalSections),
  }).run();

  return buildAgentDTO(finalAgentRow);
}

// ─────────────────────────────  Copy ("Copy to me", Plan 15)  ──────────────

/**
 * Forks an independent copy of sourceAgentId into viewerId's own library.
 * viewerId must be the source's owner OR a share-holder (resolved through
 * getAgentFullForViewer — never a bare id lookup); no access, no copy —
 * returns null (the route 404s).
 *
 * Reads the source's agent/config/section rows DIRECTLY, not through
 * exportAgentMarkdown()/parse() — that round trip is lossy: parse() does not
 * recover sectionKey after a heading has been hand-edited away from its
 * defaultHeading (§2 of plans/archive/15-share-agent.md). Delegates the actual write
 * to upsertAgentFromImport() rather than hand-inserting rows, reusing its
 * three invariants (a SectionRevision per section, one config transaction, an
 * always-written post-import AgentSnapshot) instead of risking a second writer
 * that could drift from them — the same reasoning lib/mcp's push_agent tool
 * uses for the identical reason.
 *
 * Step 2 (the name pre-check) is not optional and is the whole reason this
 * isn't a one-liner: upsertAgentFromImport's documented contract is
 * update-in-place on a name collision — "never a duplicate, never an error."
 * That's right for re-importing your own file and catastrophic for copying
 * someone else's: unchecked, it would silently overwrite the copier's own
 * unrelated agent that happens to share a name. So this pre-checks and
 * refuses with NameExistsError, writing nothing, before any source row is
 * even read.
 *
 * D3 resolved (plans/archive/15-share-agent.md §8): after upsertAgentFromImport writes
 * its own fixed source:'imported' / author:'import', this function rewrites
 * BOTH to 'copied' — on the agent row, and on the section_revision rows this
 * exact call just created (scoped by the copy's own fresh section ids, so it
 * can never touch another agent's revision history).
 *
 * Owner self-copy is blocked (added during implementation, not in the
 * original draft): the route's own auth is "owner or share-holder", so an
 * owner CAN reach this function on their own agent — but Plan 15 never
 * designs an owner-facing "Duplicate" feature (§4.9's Copy-to-me action lives
 * only in the recipient's read-only SharedAgentView), so this is an
 * accidental capability of reusing one access check for both viewer kinds,
 * not an intended one. Throws CannotCopyOwnAgentError rather than falling
 * through to the generic name-collision path, which would otherwise trigger
 * ANY time an owner omits newName (the default target name is always the
 * source's own name, which the owner already holds — the source itself) and
 * give a confusing 409 with no indication of why. This check is robust
 * against both share mechanisms by construction: getAgentFullForViewer checks
 * true ownership (agent.ownerId === viewerId) BEFORE ever looking at
 * agent_share rows, so it reports 'owner' regardless of whether the owner
 * also holds a redeemed code or an email grant for their own agent — and
 * neither grant path can create such a row in the first place (constraint 6
 * on the shares route; the redeem route never writes a row for the agent's
 * own owner).
 */
export class CannotCopyOwnAgentError extends Error {
  override name = 'CannotCopyOwnAgentError';
  constructor() {
    super('cannot_copy_own_agent');
  }
}

export function copyAgentForOwner(
  sourceAgentId: string,
  viewerId: string,
  newName?: string,
): AgentDTO | null {
  const resolved = getAgentFullForViewer(sourceAgentId, viewerId);
  if (!resolved) return null;

  if (resolved.access === 'owner') {
    throw new CannotCopyOwnAgentError();
  }

  const targetName = newName ?? resolved.agent.name;

  // Pre-check BEFORE any source row is read or any write happens (see doc
  // comment above). getAgentSnapshotInfo is already owner-scoped.
  const collision = getAgentSnapshotInfo(targetName, viewerId);
  if (collision) {
    const err = new Error('name_exists');
    err.name = 'NameExistsError';
    throw err;
  }

  const sourceAgentRow = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, sourceAgentId))
    .get();
  if (!sourceAgentRow) return null;

  const sourceConfigRows = db
    .select()
    .from(schema.agentConfig)
    .where(eq(schema.agentConfig.agentId, sourceAgentId))
    .all();

  const sourceSectionRows = db
    .select()
    .from(schema.agentSection)
    .where(eq(schema.agentSection.agentId, sourceAgentId))
    .orderBy(schema.agentSection.order)
    .all();

  const data: ImportedAgentData = {
    name: targetName,
    description: sourceAgentRow.description,
    platform: sourceAgentRow.platform,
    splitLevel: sourceAgentRow.splitLevel,
    // The exact export bytes at copy time — not a live re-export later.
    rawSourceSnapshot: serializeAgentSnapshot(sourceAgentRow, sourceSectionRows),
    config: sourceConfigRows.map((c) => ({ propKey: c.propKey, value: c.value })),
    sections: sourceSectionRows.map((s) => ({
      sectionKey: s.sectionKey,
      heading: s.heading,
      content: s.content,
      order: s.order,
    })),
  };

  const dto = upsertAgentFromImport(viewerId, data);

  db.transaction((tx) => {
    tx.update(schema.agent).set({ source: 'copied' }).where(eq(schema.agent.id, dto.id)).run();

    const newSectionIds = tx
      .select({ id: schema.agentSection.id })
      .from(schema.agentSection)
      .where(eq(schema.agentSection.agentId, dto.id))
      .all()
      .map((s) => s.id);

    if (newSectionIds.length > 0) {
      tx
        .update(schema.sectionRevision)
        .set({ author: 'copied' })
        .where(
          and(
            inArray(schema.sectionRevision.sectionId, newSectionIds),
            eq(schema.sectionRevision.author, 'import'),
          ),
        )
        .run();
    }
  });

  const finalRow = db.select().from(schema.agent).where(eq(schema.agent.id, dto.id)).get();
  if (!finalRow) throw new Error(`Agent row not found after copy: ${dto.id}`);
  return buildAgentDTO(finalRow);
}

// ─────────────────────────────  Delete  ────────────────────────────────────

/**
 * Deletes an agent and its config/sections/memberships/shares.
 * SectionRevision and AgentSnapshot rows are intentionally retained (rule 4).
 *
 * ownerId is required and enforced in the same DELETE statement (constraint 1, §6.2).
 * Returns true if the agent existed and was deleted; false if not found or owner mismatch
 * (callers map false to 404 — constraint 3).
 *
 * R3 (Plan 03): membership rows are NOT historical — they are a pure index.
 * Deleting an agent must also delete its membership rows so group queries
 * never return ghost agents (Plan 03 §0 R3 / §5 rule 4).
 *
 * Plan 15 (§4.2): agent_share rows are likewise a pure access index, not
 * history — deleted here for the identical stated reason as membership, so a
 * deleted agent's shares don't outlive it. (Clearing publicCode is implicit —
 * the row is gone.) This is the one place agents.ts writes to the agentShare
 * table directly rather than through agentShares.ts, mirroring how membership
 * is deleted directly here rather than through groups.ts — both are the
 * "cascade must be in this transaction" exception to the sole-owner convention.
 */
export function deleteAgent(agentId: string, ownerId: string): boolean {
  // Pre-check for existence + ownership (returns false on either miss)
  const existing = db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(and(eq(schema.agent.id, agentId), eq(schema.agent.ownerId, ownerId)))
    .get();

  if (!existing) return false;

  db.transaction((tx) => {
    tx.delete(schema.agentConfig).where(eq(schema.agentConfig.agentId, agentId)).run();
    tx.delete(schema.agentSection).where(eq(schema.agentSection.agentId, agentId)).run();
    tx.delete(schema.membership).where(eq(schema.membership.agentId, agentId)).run();
    tx.delete(schema.agentShare).where(eq(schema.agentShare.agentId, agentId)).run();
    tx.delete(schema.agent)
      .where(and(eq(schema.agent.id, agentId), eq(schema.agent.ownerId, ownerId)))
      .run();
    // sectionRevision and agentSnapshot rows are NOT deleted (soft ref — rule 4)
  });

  return true;
}

// ─────────────────────────────  Update (PATCH)  ────────────────────────────

/**
 * Updates an agent's name, description, and/or config rows.
 * Returns the updated AgentDTO, or null if the agent was not found or owner mismatch.
 *
 * ownerId is required — enforced in the same lookup that reads or writes the row,
 * so there is no code path that can return or modify another owner's agent.
 *
 * Throws with name 'NameExistsError' if the new name collides with another agent
 * of the SAME owner (the check is per-owner, not global).
 * name stored verbatim — flag-don't-block: never silently rewritten or rejected.
 */
export function updateAgent(
  agentId: string,
  ownerId: string,
  updates: {
    name?: string;
    description?: string;
    config?: { propKey: string; value: unknown }[];
  },
): AgentDTO | null {
  const existing = db
    .select()
    .from(schema.agent)
    .where(and(eq(schema.agent.id, agentId), eq(schema.agent.ownerId, ownerId)))
    .get();

  if (!existing) return null;

  // Name collision check — per-owner (§6.3 fix: was global, which leaked existence oracle)
  if (updates.name !== undefined && updates.name !== existing.name) {
    const collision = db
      .select({ id: schema.agent.id })
      .from(schema.agent)
      .where(and(eq(schema.agent.name, updates.name), eq(schema.agent.ownerId, ownerId)))
      .get();
    if (collision) {
      const err = new Error('name_exists');
      err.name = 'NameExistsError';
      throw err;
    }
  }

  try {
    db.transaction((tx) => {
      // Build the set payload for agent row fields being updated
      const agentSet: Partial<typeof schema.agent.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (updates.name !== undefined) agentSet.name = updates.name;
      if (updates.description !== undefined) agentSet.description = updates.description;

      tx
        .update(schema.agent)
        .set(agentSet)
        .where(eq(schema.agent.id, agentId))
        .run();

      // Replace all config rows if config is supplied
      if (updates.config !== undefined) {
        tx.delete(schema.agentConfig).where(eq(schema.agentConfig.agentId, agentId)).run();
        if (updates.config.length > 0) {
          tx
            .insert(schema.agentConfig)
            .values(updates.config.map((c) => ({ agentId, propKey: c.propKey, value: c.value })))
            .run();
        }
      }
    });
  } catch (err) {
    // The pre-check above closes most races, but two concurrent renames to the
    // same name can both pass it before either UPDATE commits — catch the raw
    // UNIQUE-constraint failure here too, same pattern createAgent already uses,
    // so this lands on the intended 409 name_exists instead of a generic 500.
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

  const updatedRow = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();

  if (!updatedRow) return null;
  return buildAgentDTO(updatedRow);
}

// ─────────────────────────────  Read-only export helper  ──────────────────

/** Shared by exportAgentMarkdown and exportAgentMarkdownForViewer — builds the
 *  exported .md text from an already-access-checked agent row. Extracted so
 *  the viewer-scoped sibling below doesn't duplicate the section-read + serialize
 *  logic; does not change exportAgentMarkdown's signature or behavior. */
function exportFromAgentRow(agentRow: typeof schema.agent.$inferSelect): string {
  const sections = db
    .select()
    .from(schema.agentSection)
    .where(eq(schema.agentSection.agentId, agentRow.id))
    .orderBy(schema.agentSection.order)
    .all();

  return serializeAgentSnapshot(agentRow, sections);
}

/**
 * Returns the current exported .md text for an agent — read-only, no snapshot
 * row written. Used by GET /api/agents/[id]/export (R11, Plan 03 A.4).
 *
 * ownerId is required — enforced in the same query (constraint 1, §6.2).
 * Returns null if the agent does not exist or owner mismatch.
 * config.value handling mirrors serializeAgentSnapshot (A3 fix — arrays passed through).
 */
export function exportAgentMarkdown(agentId: string, ownerId: string): string | null {
  const agentRow = db
    .select()
    .from(schema.agent)
    .where(and(eq(schema.agent.id, agentId), eq(schema.agent.ownerId, ownerId)))
    .get();
  if (!agentRow) return null;

  return exportFromAgentRow(agentRow);
}

/**
 * Viewer-scoped sibling (D2 resolved, Plan 15 §8) — owner OR share-holder.
 * "Copy to me" already gives a recipient the entire content in a form they
 * fully control, so withholding a download would be an arbitrary hole rather
 * than a protection. Reuses getAgentFullForViewer for the access check rather
 * than duplicating the predicate; exportAgentMarkdown itself is untouched.
 */
export function exportAgentMarkdownForViewer(agentId: string, viewerId: string): string | null {
  const resolved = getAgentFullForViewer(agentId, viewerId);
  if (!resolved) return null;

  const agentRow = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();
  if (!agentRow) return null;

  return exportFromAgentRow(agentRow);
}

// ─────────────────────────────  Internal helpers  ──────────────────────────

/**
 * Serializes an agent row + its sections into a full exported markdown string
 * using the real lib/serialize exportAgent() (wired in Phase 3).
 *
 * Config rows are read from the DB here so the snapshot includes all frontmatter.
 * The resulting string is what an `.md` export of this agent looks like at this
 * instant — used for AgentSnapshot(pre-import) and AgentSnapshot(post-import) rows.
 */
function serializeAgentSnapshot(
  agentRow: typeof schema.agent.$inferSelect,
  sections: (typeof schema.agentSection.$inferSelect)[],
): string {
  // Read config rows for this agent (ordered by propKey for determinism).
  const configRows = db
    .select()
    .from(schema.agentConfig)
    .where(eq(schema.agentConfig.agentId, agentRow.id))
    .all();

  // Build frontmatter: name, description, then config entries in DB row order.
  // config.value may be a string scalar, a string[] list, or a genuine nested
  // object/array (A3/#35/#40 — datatype 'json' fields like hooks/mcpServers). Nested
  // values are passed through as-is so exportAgent emits real YAML, not a JSON.stringify'd
  // scalar (that was a real bug: it produced a quoted JSON-string frontmatter value,
  // which is not a valid Claude Code agent file).
  const frontmatter: FrontmatterEntry[] = [
    { key: 'name', rawValue: agentRow.name },
    { key: 'description', rawValue: agentRow.description },
    ...configRows.map((c) => ({
      key: c.propKey,
      rawValue: c.value as FrontmatterEntry['rawValue'],
    })),
  ];

  // Build blocks from sections (sorted by order).
  const sortedSections = [...sections].sort((a, b) => a.order - b.order);
  const blocks: BodyBlock[] = sortedSections.map((s) => ({
    blockId: `block-${s.order}`,
    heading: s.heading ?? null,
    content: s.content,
    order: s.order,
  }));

  const structured: StructuredAgent = {
    frontmatter,
    splitLevel: agentRow.splitLevel,
    blocks,
  };

  return exportAgent(structured);
}
