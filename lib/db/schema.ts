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

import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────  User  ─────────────────────────────
export const user = sqliteTable('user', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),          // stored lowercased + trimmed
  passwordHash: text('password_hash').notNull(),    // '' = sentinel (§3.7)
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  shareLogsWithAdmin: integer('share_logs_with_admin', { mode: 'boolean' })
    .notNull().default(false),                      // opt-in consent, §5.6
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ─────────────────────────────  InviteCode  ─────────────────────────────
export const inviteCode = sqliteTable('invite_code', {
  code: text('code').primaryKey(),                  // canonical 'XXXX-XXXX-XXXX-XXXX'
  note: text('note'),                               // optional admin label
  createdBy: text('created_by').notNull(),          // soft ref → user.id
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  redeemedBy: text('redeemed_by'),                  // soft ref → user.id; NULL = unused
  redeemedAt: integer('redeemed_at', { mode: 'timestamp' }),
}, (t) => ({
  byRedeemed: index('invite_code_redeemed_idx').on(t.redeemedBy),
}));

// ─────────────────────────────  Agent  ─────────────────────────────
export const agent = sqliteTable('agent', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text('owner_id').notNull(),              // soft ref → user.id
  name: text('name').notNull(),                     // stored verbatim; flag-don't-block (Rules #1); .unique() removed — per-owner unique (§4.3)
  description: text('description').notNull(),        // missing-on-import ⇒ placeholder (Rules #12)
  source: text('source', { enum: ['created', 'imported'] }).notNull(),
  platform: text('platform').notNull().default('claude'),   // NOT a DB enum — open catalog (PLATFORM_DEFS, §4); only 'claude' exists in this plan
  splitLevel: integer('split_level').notNull().default(1),   // R1: 1=#, 2=##…
  rawSourceSnapshot: text('raw_source_snapshot'),   // nullable: whole original .md, byte-for-byte
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  ownerName: uniqueIndex('agent_owner_name_unique').on(t.ownerId, t.name),
  byOwner:   index('agent_owner_idx').on(t.ownerId),
}));

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
  // Added 2026-07-29 — closes catalog seed drift at the root: AgentView.tsx now reads the
  // full config catalog (incl. hint) from the DB via a page-load fetch instead of a static
  // CONFIG_DEFS import, so a `catalog.ts` edit + `npm run db:seed` + page reload is enough
  // to update the UI — no rebuild/redeploy needed. Nullable: existing rows heal via reseed.
  hint: text('hint'),
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
  ownerId: text('owner_id').notNull(),              // soft ref → user.id
  name: text('name').notNull(),                     // per-owner unique (§4.3)
  parentId: text('parent_id'),                      // nullable; always null in flat MVP
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  ownerName: uniqueIndex('group_owner_name_unique').on(t.ownerId, t.name),
  byOwner:   index('group_owner_idx').on(t.ownerId),
}));

export const membership = sqliteTable('membership', {
  agentId: text('agent_id').notNull(),
  groupId: text('group_id').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.groupId] }),
}));

// ─────────────────────  Settings (generic EAV — §4.1)  ─────────────────────────
// Operator-owned runtime state. Rows created on first write; a missing row is
// a valid state meaning "never configured" (default-on in getLiveLlmCalls()).
// Table name: singular, matching codebase convention (§15.1).
export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),              // always stringified; typing lives in SETTING_DEFS
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull().default(sql`(unixepoch())`),
});

// ─────────────────────  LLM call log (append-only audit — §4.2)  ─────────────
// Every AI call attempt (live or dry-run, success or failure) writes one row.
// Soft agentId ref (never cascade-deleted), matching sectionRevision/agentSnapshot.
// No UPDATE/DELETE exported from the repository — append-only by convention + test.

/** Shape stored in requestPayload — no credentials. */
export type LoggedRequest = {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  model: string;
};

/** Shape stored in responsePayload — always null for dry-run and errored calls. */
export type LoggedResponse = {
  text: string;
  stopReason: string;
};

export const llmCallLog = sqliteTable('llm_call_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  kind: text('kind', { enum: ['import-strict', 'import-structural', 'chat'] }).notNull(),
  provider: text('provider').notNull().default('anthropic'),
  agentId: text('agent_id'),                    // SOFT ref, nullable — never cascade-deleted
  agentLabel: text('agent_label'),              // display fallback (§5.2)
  dryRun: integer('dry_run', { mode: 'boolean' }).notNull(),
  model: text('model').notNull(),
  requestPayload: text('request_payload', { mode: 'json' }).notNull().$type<LoggedRequest>(),
  responsePayload: text('response_payload', { mode: 'json' }).$type<LoggedResponse | null>(),
  error: text('error'),                         // '<ErrorName>: <message>', ≤2000 chars
  durationMs: integer('duration_ms').notNull(),
  usage: text('usage', { mode: 'json' }).$type<{ inputTokens: number; outputTokens: number } | null>(),
  userId: text('user_id'),                      // SOFT ref → user.id; NULL = pre-auth row (§4.3)
  sharedWithAdmin: integer('shared_with_admin', { mode: 'boolean' })
    .notNull().default(false),                  // consent snapshot at write time — never updated (§5.6)
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull().default(sql`(unixepoch())`),
}, (t) => ({
  byCreated:    index('llm_call_log_created_idx').on(t.createdAt),
  byKind:       index('llm_call_log_kind_idx').on(t.kind),
  byUserCreated: index('llm_call_log_user_created_idx').on(t.userId, t.createdAt), // §3.9 cap count
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
