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

import { eq, inArray } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';
import { computeValidation } from '../../blueprint/rules.js';
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
};

export type SectionDefLite = {
  key: string;
  label: string;
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
  source: 'created' | 'imported';
  platform: string;
  splitLevel: number;
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
    nameSpecViolation: boolean;
    descriptionMissing: boolean;
    unknownConfigKeys: string[];
    outdatedOrUnknownValues: { propKey: string; value: unknown }[];
  };
};

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
            label: def.label,
            defaultHeading: def.defaultHeading,
            isCore: def.isCore ?? false,
            defaultOrder: def.defaultOrder,
            template: def.template,
            helpText: def.helpText,
          } satisfies SectionDefLite)
        : null,
    };
  });

  const validation = computeValidation({
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
    config,
    sections,
    validation,
  };
}

// ─────────────────────────────  CRUD  ──────────────────────────────────────

/**
 * Creates an agent row (source:'created', platform:'claude' default) + seeds one
 * AgentSection per SectionDef.isCore template, each with a SectionRevision(author:'scaffold')
 * revision #0. (D5 — 'scaffold' is distinct from 'import'/'user'/'ai'.)
 */
export function createAgent(
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

  db.transaction((tx) => {
    tx.insert(schema.agent).values({
      id: agentId,
      name,
      description,
      source: 'created',
      platform: 'claude',
      splitLevel: 1,
    }).run();

    for (const def of coreDefs) {
      const sectionId = crypto.randomUUID();
      tx.insert(schema.agentSection).values({
        id: sectionId,
        agentId,
        sectionKey: def.key,
        heading: def.defaultHeading,
        content: def.template,
        order: def.defaultOrder,
        version: 0,
      }).run();

      // Revision #0 — author:'scaffold' (D5)
      tx.insert(schema.sectionRevision).values({
        id: crypto.randomUUID(),
        sectionId,
        content: def.template,
        author: 'scaffold',
      }).run();
    }
  });

  const agentRow = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();

  if (!agentRow) throw new Error(`Agent row not found after insert: ${agentId}`);
  return buildAgentDTO(agentRow);
}

/**
 * Returns the full AgentDTO for a given agent ID, or null if not found.
 */
export function getAgentFull(agentId: string): AgentDTO | null {
  const agentRow = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();

  if (!agentRow) return null;
  return buildAgentDTO(agentRow);
}

/**
 * Looks up an agent by its unique name and returns its ID + rawSourceSnapshot.
 * Used by the import route's short-circuit check (Rules Index #36 — B3).
 * Returns null if no agent with that name exists.
 */
export function getAgentSnapshotInfo(
  name: string,
): { id: string; rawSourceSnapshot: string | null } | null {
  const row = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.name, name))
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
 * Returns a lite list of all agents (agent row fields + groupIds; no sections/config/validation).
 * groupIds is populated via a join against membership (Plan 03 A.3).
 */
export function listAgents(): AgentLiteDTO[] {
  const rows = db.select().from(schema.agent).orderBy(schema.agent.name).all();
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
    groupIds: groupIdsByAgent.get(r.id) ?? [],
  }));
}

/**
 * Overwrites a section's content and appends exactly one SectionRevision (rule 3, R4).
 * Throws VersionConflictError if expectedVersion doesn't match the current version.
 */
export function updateSectionContent(
  sectionId: string,
  content: string,
  author: 'import' | 'reimport' | 'scaffold' | 'user' | 'ai',
  expectedVersion: number,
): { version: number } {
  const section = db
    .select()
    .from(schema.agentSection)
    .where(eq(schema.agentSection.id, sectionId))
    .get();

  if (!section) {
    throw new Error(`Section not found: ${sectionId}`);
  }

  // Optimistic concurrency check (R4)
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
 * Creates or updates an agent from import data (Rules Index #11a/#11b/#33).
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
export function upsertAgentFromImport(data: ImportedAgentData): AgentDTO {
  // A2: reject empty/whitespace-only name — flag-don't-block (#1) covers format, not absence.
  if (!data.name || data.name.trim().length === 0) {
    const err = new Error('missing_name');
    err.name = 'MissingNameError';
    throw err;
  }

  const existing = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.name, data.name))
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

      // Reconcile sections by (sectionKey, heading) identity in document order (A1).
      // Rules Index #33: sectionKey alone is not unique per agent — multiple 'custom' rows
      // are routine. Using a sectionKey-only Map collapses distinct rows on re-import.
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

// ─────────────────────────────  Delete  ────────────────────────────────────

/**
 * Deletes an agent and its config/sections/memberships.
 * SectionRevision and AgentSnapshot rows are intentionally retained (rule 4).
 *
 * R3 (Plan 03): membership rows are NOT historical — they are a pure index.
 * Deleting an agent must also delete its membership rows so group queries
 * never return ghost agents (Plan 03 §0 R3 / §5 rule 4).
 */
export function deleteAgent(agentId: string): void {
  db.transaction((tx) => {
    tx.delete(schema.agentConfig).where(eq(schema.agentConfig.agentId, agentId)).run();
    tx.delete(schema.agentSection).where(eq(schema.agentSection.agentId, agentId)).run();
    tx.delete(schema.membership).where(eq(schema.membership.agentId, agentId)).run();
    tx.delete(schema.agent).where(eq(schema.agent.id, agentId)).run();
    // sectionRevision and agentSnapshot rows are NOT deleted (soft ref — rule 4)
  });
}

// ─────────────────────────────  Update (PATCH)  ────────────────────────────

/**
 * Updates an agent's name, description, and/or config rows.
 * Returns the updated AgentDTO, or null if the agent was not found.
 *
 * Throws with name 'NameExistsError' if the new name collides with another agent.
 * name stored verbatim — flag-don't-block (Rules Index #1).
 */
export function updateAgent(
  agentId: string,
  updates: {
    name?: string;
    description?: string;
    config?: { propKey: string; value: unknown }[];
  },
): AgentDTO | null {
  const existing = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();

  if (!existing) return null;

  // Name collision check (only if name is actually changing)
  if (updates.name !== undefined && updates.name !== existing.name) {
    const collision = db
      .select({ id: schema.agent.id })
      .from(schema.agent)
      .where(eq(schema.agent.name, updates.name))
      .get();
    if (collision) {
      const err = new Error('name_exists');
      err.name = 'NameExistsError';
      throw err;
    }
  }

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

  const updatedRow = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();

  if (!updatedRow) return null;
  return buildAgentDTO(updatedRow);
}

// ─────────────────────────────  Read-only export helper  ──────────────────

/**
 * Returns the current exported .md text for an agent — read-only, no snapshot
 * row written. Used by GET /api/agents/[id]/export (R11, Plan 03 A.4).
 *
 * Returns null if the agent does not exist.
 * config.value handling mirrors serializeAgentSnapshot (A3 fix — arrays passed through).
 */
export function exportAgentMarkdown(agentId: string): string | null {
  const agentRow = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
    .get();
  if (!agentRow) return null;

  const sections = db
    .select()
    .from(schema.agentSection)
    .where(eq(schema.agentSection.agentId, agentId))
    .orderBy(schema.agentSection.order)
    .all();

  return serializeAgentSnapshot(agentRow, sections);
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
  // config.value may be a string scalar or a string[] list (A3 — pass arrays through
  // as string[] rather than JSON.stringifying them, so exportAgent emits proper YAML).
  const frontmatter: FrontmatterEntry[] = [
    { key: 'name', rawValue: agentRow.name },
    { key: 'description', rawValue: agentRow.description },
    ...configRows.map((c) => ({
      key: c.propKey,
      rawValue: ((): string | string[] => {
        const v = c.value;
        if (typeof v === 'string') return v;
        if (Array.isArray(v) && (v as unknown[]).every((x) => typeof x === 'string')) {
          return v as string[];
        }
        // Fallback for any other stored shape (e.g. numbers stored as JSON) — stringify.
        return JSON.stringify(v);
      })(),
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
