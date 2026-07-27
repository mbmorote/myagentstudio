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
  constructor(current: number) {
    super(`Version conflict: expected version does not match current (${current})`);
    this.name = 'VersionConflictError';
    this.current = current;
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
 * Returns a lite list of all agents (agent row fields only, no sections/config).
 */
export function listAgents(): Omit<AgentDTO, 'sections' | 'config' | 'validation'>[] {
  const rows = db.select().from(schema.agent).orderBy(schema.agent.name).all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    source: r.source,
    platform: r.platform,
    splitLevel: r.splitLevel,
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
    throw new VersionConflictError(section.version);
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
 * Creates or updates an agent from import data (Rules Index #11a/#11b).
 *
 * First-time import: creates agent (source:'imported') + writes AgentSnapshot(post-import).
 * Re-import of existing name:
 *   - writes AgentSnapshot(pre-import) of the current state
 *   - updates agent row + config rows (full replace)
 *   - changed sections → overwrite content + append reimport revision
 *   - new sections → create + reimport revision #0
 *   - deleted sections → delete row; revisions retained (rule 4)
 *   - writes AgentSnapshot(post-import) of the final state
 */
export function upsertAgentFromImport(data: ImportedAgentData): AgentDTO {
  const existing = db
    .select()
    .from(schema.agent)
    .where(eq(schema.agent.name, data.name))
    .get();

  const isUpdate = !!existing;
  const agentId = isUpdate ? existing.id : crypto.randomUUID();

  if (isUpdate) {
    // Capture pre-import snapshot (rule 7)
    const currentSections = db
      .select()
      .from(schema.agentSection)
      .where(eq(schema.agentSection.agentId, agentId))
      .orderBy(schema.agentSection.order)
      .all();

    const preSnapshotContent = serializeAgentSnapshot(existing, currentSections);

    db.insert(schema.agentSnapshot).values({
      id: crypto.randomUUID(),
      agentId,
      kind: 'pre-import',
      content: preSnapshotContent,
    }).run();

    db
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
    db.delete(schema.agentConfig).where(eq(schema.agentConfig.agentId, agentId)).run();
    if (data.config.length > 0) {
      db.insert(schema.agentConfig).values(
        data.config.map((c) => ({ agentId, propKey: c.propKey, value: c.value })),
      ).run();
    }

    // Reconcile sections
    const dbSections = db
      .select()
      .from(schema.agentSection)
      .where(eq(schema.agentSection.agentId, agentId))
      .all();

    const dbSectionsByKey = new Map(dbSections.map((s) => [s.sectionKey, s]));
    const importKeys = new Set(data.sections.map((s) => s.sectionKey));

    db.transaction((tx) => {
      for (const imported of data.sections) {
        const dbRow = dbSectionsByKey.get(imported.sectionKey);

        if (dbRow) {
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
      const toDelete = dbSections.filter((s) => !importKeys.has(s.sectionKey));
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
 * Deletes an agent and its config/sections.
 * SectionRevision and AgentSnapshot rows are intentionally retained (rule 4).
 */
export function deleteAgent(agentId: string): void {
  db.transaction((tx) => {
    tx.delete(schema.agentConfig).where(eq(schema.agentConfig.agentId, agentId)).run();
    tx.delete(schema.agentSection).where(eq(schema.agentSection.agentId, agentId)).run();
    tx.delete(schema.agent).where(eq(schema.agent.id, agentId)).run();
    // sectionRevision and agentSnapshot rows are NOT deleted (soft ref — rule 4)
  });
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
  const frontmatter: FrontmatterEntry[] = [
    { key: 'name', rawValue: agentRow.name },
    { key: 'description', rawValue: agentRow.description },
    ...configRows.map((c) => ({
      key: c.propKey,
      rawValue: typeof c.value === 'string' ? c.value : JSON.stringify(c.value),
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
