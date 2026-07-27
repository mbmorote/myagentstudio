/**
 * lib/db/schema.ts
 *
 * All Drizzle sqliteTable definitions — verbatim from §3 of Plan 01.
 *
 * Conservative column types (Rules Index #8a):
 *   UUIDs as text, timestamps as integer({mode:'timestamp'}),
 *   booleans as integer({mode:'boolean'}), JSON as text({mode:'json'}).
 *
 * Soft-reference columns (agentConfig.agentId, agentSection.agentId,
 * sectionRevision.sectionId, agentSnapshot.agentId) intentionally have NO
 * Drizzle references() FK cascades — deletion cascades are handled explicitly
 * in the repository so the soft-reference pattern is uniform and visible in
 * one place (Plan §3 notes, Rules Index #8a).
 */

import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────  Agent  ─────────────────────────────
export const agent = sqliteTable('agent', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),            // stored verbatim; flag-don't-block (Rules #1)
  description: text('description').notNull(),        // missing-on-import ⇒ placeholder (Rules #12)
  source: text('source', { enum: ['created', 'imported'] }).notNull(),
  platform: text('platform').notNull().default('claude'),   // NOT a DB enum — open catalog (PLATFORM_DEFS, §4); only 'claude' exists in this plan
  splitLevel: integer('split_level').notNull().default(1),   // R1: 1=#, 2=##…
  rawSourceSnapshot: text('raw_source_snapshot'),   // nullable: whole original .md, byte-for-byte
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ─────────────────────  Zone 1: Config catalog + values  ─────────────────────
export const configDef = sqliteTable('config_def', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),              // frontmatter key: model, tools…
  label: text('label').notNull(),
  datatype: text('datatype', {
    enum: ['string', 'enum', 'int', 'bool', 'list', 'any'],
  }).notNull(),
  allowedValues: text('allowed_values', { mode: 'json' }).$type<string[] | null>(),
  required: integer('required', { mode: 'boolean' }).notNull().default(false),
  isCore: integer('is_core', { mode: 'boolean' }).notNull().default(false),
  exportable: integer('exportable', { mode: 'boolean' }).notNull().default(true),
});

export const agentConfig = sqliteTable('agent_config', {
  agentId: text('agent_id').notNull(),              // → agent.id (app-enforced, not FK-cascade here)
  propKey: text('prop_key').notNull(),              // NO FK to config_def (openness rule)
  value: text('value', { mode: 'json' }).notNull().$type<unknown>(), // scalar | list, JSON-as-text
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.propKey] }),
  byAgent: index('agent_config_agent_idx').on(t.agentId),
}));

// ─────────────────────  Zone 2: Section catalog + values  ─────────────────────
export const sectionDef = sqliteTable('section_def', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),              // role, behavior, guardrails, output…
  label: text('label').notNull(),
  defaultHeading: text('default_heading').notNull(),// e.g. "# ROLE"
  isCore: integer('is_core', { mode: 'boolean' }).notNull().default(false),
  defaultOrder: integer('default_order').notNull(),
  template: text('template').notNull().default(''), // pre-filled scaffold
  helpText: text('help_text').notNull().default(''),
});

export const agentSection = sqliteTable('agent_section', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull(),              // → agent.id
  sectionKey: text('section_key').notNull(),        // NO FK to section_def (openness); "custom" allowed
  heading: text('heading'),                         // NULLABLE — headingless preamble (Rules #2)
  content: text('content').notNull().default(''),   // current state (latest revision, denormalized)
  order: integer('order').notNull(),
  version: integer('version').notNull().default(0), // R4: optimistic concurrency
}, (t) => ({
  byAgent: index('agent_section_agent_idx').on(t.agentId),
}));

// ─────────────────────  Append-only history  ─────────────────────
export const sectionRevision = sqliteTable('section_revision', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sectionId: text('section_id').notNull(),          // SOFT ref — NOT cascade-deleted (log outlives row)
  content: text('content').notNull(),               // full content at this point, never a diff
  author: text('author', {
    enum: ['import', 'reimport', 'scaffold', 'user', 'ai'],
  }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  bySection: index('section_revision_section_idx').on(t.sectionId),
}));

// ─────────────────────  Grouping (schema now, UI later)  ─────────────────────
export const group = sqliteTable('group', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),            // globally unique now → per-parent later (additive)
  parentId: text('parent_id'),                      // nullable; always null in flat MVP
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const membership = sqliteTable('membership', {
  agentId: text('agent_id').notNull(),
  groupId: text('group_id').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.groupId] }),
}));

// ─────────────────────  Whole-agent snapshots (import/export)  ─────────────────────
export const agentSnapshot = sqliteTable('agent_snapshot', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull(),              // SOFT ref — NOT cascade-deleted (log outlives row)
  kind: text('kind', { enum: ['pre-import', 'post-import', 'export'] }).notNull(),
  content: text('content').notNull(),               // full exported .md text at this point in time
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  byAgent: index('agent_snapshot_agent_idx').on(t.agentId),
}));
