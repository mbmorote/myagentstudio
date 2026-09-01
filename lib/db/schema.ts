/**
 * lib/db/schema.ts
 *
 * All Drizzle sqliteTable definitions.
 *
 * Conservative column types (chosen so a future storage-engine migration is a
 * schema-file rewrite behind the repository layer, not an app-wide one):
 *   UUIDs as text, timestamps as integer({mode:'timestamp'}),
 *   booleans as integer({mode:'boolean'}), JSON as text({mode:'json'}).
 *
 * Soft-reference columns (agentConfig.agentId, agentSection.agentId,
 * sectionRevision.sectionId, agentSnapshot.agentId) intentionally have NO
 * Drizzle references() FK cascades — deletion cascades are handled explicitly
 * in the repository so the soft-reference pattern is uniform and visible in
 * one place, rather than half enforced by the database and half by code.
 */

import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────  User  ─────────────────────────────
export const user = sqliteTable('user', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),          // stored lowercased + trimmed
  passwordHash: text('password_hash').notNull(),    // '' = sentinel (§3.7)
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  // Column default (false) is intentionally NOT the real default — every
  // signup path (createUserWithInvite's shareLogsWithAdmin param) always sets
  // this explicitly, so the column default never actually fires; it exists
  // only as an inert SQL-level fallback. The REAL default is enforced in
  // app/api/auth/signup/route.ts and the OAuth callback route: sharing is on
  // by default since 2026-08-18 (was off before) — left as `false` here rather
  // than migrating the column default via a table rebuild for a value nothing
  // reads, but flag this if a future write path ever relies on the bare insert.
  shareLogsWithAdmin: integer('share_logs_with_admin', { mode: 'boolean' })
    .notNull().default(false),                      // consent, §5.6 — see comment above
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ─────────────────────────────  InviteCode  ─────────────────────────────
export const inviteCode = sqliteTable('invite_code', {
  code: text('code').primaryKey(),                  // canonical 'XXXX-XXXX-XXXX-XXXX'
  note: text('note'),                               // optional admin label
  createdBy: text('created_by'),                    // soft ref → user.id; NULL = self-requested
                                                      // (no admin created it — see boundEmail)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  redeemedBy: text('redeemed_by'),                  // soft ref → user.id; NULL = unused
  redeemedAt: integer('redeemed_at', { mode: 'timestamp' }),
  // Plan 12 (2026-08-14) — access-request flow. Both NULL on every code created via the
  // admin's plain "+ Generate code" (today's only path): unbound, never expires, unchanged
  // behavior. Both set only on a code an admin generates from an access request (see
  // accessRequest below): only that email can redeem it, and only before it expires.
  boundEmail: text('bound_email'),                  // NULL = any email may redeem
  expiresAt: integer('expires_at', { mode: 'timestamp' }), // NULL = never expires
}, (t) => ({
  byRedeemed: index('invite_code_redeemed_idx').on(t.redeemedBy),
}));

// ─────────────────────────────  AccessRequest  ─────────────────────────────
// Plan 12 (2026-08-14) — "Request access" on the signup form, for visitors without an
// invite code. A row here is an OPEN request the admin hasn't acted on yet — generating a
// code for one deletes the row (the resulting code, in inviteCode above, is the durable
// record from then on); dismissing one also just deletes it. Rows are deduplicated at
// creation (see hasOpenAccessRequest in the repository) so re-submitting the same email
// while a request is still open doesn't pile up duplicates.
export const accessRequest = sqliteTable('access_request', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull(),
  referralSource: text('referral_source'),          // 'linkedin' | 'thread' | 'github' | 'friend' | 'other' | NULL
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  byEmail: index('access_request_email_idx').on(t.email),
}));

// ─────────────────────────────  Agent  ─────────────────────────────
export const agent = sqliteTable('agent', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text('owner_id').notNull(),              // soft ref → user.id
  name: text('name').notNull(),                     // stored verbatim; flag-don't-block (Rules #1); .unique() removed — per-owner unique (§4.3)
  description: text('description').notNull(),        // missing-on-import ⇒ placeholder (Rules #12)
  // 'copied' added by Plan 15 (D3) — a fork produced by "Copy to me" is distinguishable
  // from a real import in the library's source tag. Written by copyAgentForOwner() as a
  // follow-up update after upsertAgentFromImport() writes 'imported' (that function's own
  // fixed contract; see lib/db/repository/agents.ts).
  source: text('source', { enum: ['created', 'imported', 'copied'] }).notNull(),
  platform: text('platform').notNull().default('claude'),   // NOT a DB enum — open catalog (PLATFORM_DEFS, §4); only 'claude' exists in this plan
  splitLevel: integer('split_level').notNull().default(1),   // R1: 1=#, 2=##…
  rawSourceSnapshot: text('raw_source_snapshot'),   // nullable: whole original .md, byte-for-byte
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  // ─── Plan 15 — Share agent (link sharing) ───
  // NULL = link sharing off. SQLite treats each NULL as distinct in a unique index, so
  // "off" is never a collision — a plain uniqueIndex is correct, no partial index needed.
  publicCode: text('public_code'),
  // Set when the code is generated, cleared with it (D6: kept — backs "link active since…").
  publicCodeCreatedAt: integer('public_code_created_at', { mode: 'timestamp' }),
}, (t) => ({
  ownerName: uniqueIndex('agent_owner_name_unique').on(t.ownerId, t.name),
  byOwner:   index('agent_owner_idx').on(t.ownerId),
  publicCodeUnique: uniqueIndex('agent_public_code_unique').on(t.publicCode),
}));

// ─────────────────────  Zone 1: Config catalog + values  ─────────────────────
export const configDef = sqliteTable('config_def', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platform: text('platform').notNull().default('claude'), // open catalog, not a closed DB enum — same convention as agent.platform, so a second platform is a catalog entry, not a migration
  key: text('key').notNull(),                       // frontmatter key: model, tools… — unique per platform, not globally
  label: text('label').notNull(),
  datatype: text('datatype', {
    // 'json': a real general mechanism for genuinely nested values (e.g. hooks,
    // mcpServers) — added 2026-07-31, roadmap TODO item 2, supersedes the old 'any'
    // placeholder those two keys used. 'any' itself is kept (not yet used by any
    // current key) rather than removed speculatively.
    enum: ['string', 'enum', 'int', 'bool', 'list', 'any', 'json'],
  }).notNull(),
  allowedValues: text('allowed_values', { mode: 'json' }).$type<string[] | null>(),
  required: integer('required', { mode: 'boolean' }).notNull().default(false),
  isCore: integer('is_core', { mode: 'boolean' }).notNull().default(false),
  exportable: integer('exportable', { mode: 'boolean' }).notNull().default(true),
  // Added 2026-07-29 — AgentView.tsx reads the full config catalog (incl. hint) from the
  // DB via a page-load fetch instead of a static CONFIG_DEFS import. Nullable: rows are
  // DB-owned and admin-editable — catalog.ts only seeds a row on first insert
  // (lib/db/seed.ts), it no longer heals it on every reseed.
  hint: text('hint'),
}, (t) => ({
  platformKey: uniqueIndex('config_def_platform_key_unique').on(t.platform, t.key),
}));

export const agentConfig = sqliteTable('agent_config', {
  agentId: text('agent_id').notNull(),              // → agent.id (app-enforced, not FK-cascade here)
  propKey: text('prop_key').notNull(),              // NO FK to config_def (openness rule)
  value: text('value', { mode: 'json' }).notNull().$type<unknown>(), // scalar | list | nested object/array (datatype:'json' keys), JSON-as-text
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.propKey] }),
  byAgent: index('agent_config_agent_idx').on(t.agentId),
}));

// ─────────────────────  Zone 2: Section catalog + values  ─────────────────────
export const sectionDef = sqliteTable('section_def', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platform: text('platform').notNull().default('claude'), // open catalog, not a closed DB enum — same convention as agent.platform, so a second platform is a catalog entry, not a migration
  key: text('key').notNull(),                       // role, behavior, guardrails, output… — unique per platform, not globally
  // No separate `label` column (removed 2026-08-07) — it had exactly one consumer
  // (SectionBlock.tsx's display header) and nothing ever kept it consistent with
  // defaultHeading, which is how "Guardrails" / "# RULES" coexisted silently for
  // this same row. Display text is derived from defaultHeading (or the section's
  // own real heading) instead — see sectionDisplayLabel() in SectionBlock.tsx.
  defaultHeading: text('default_heading').notNull(),// e.g. "# ROLE" — also the display name
  isCore: integer('is_core', { mode: 'boolean' }).notNull().default(false),
  defaultOrder: integer('default_order').notNull(),
  template: text('template').notNull().default(''), // pre-filled scaffold
  helpText: text('help_text').notNull().default(''),
}, (t) => ({
  platformKey: uniqueIndex('section_def_platform_key_unique').on(t.platform, t.key),
}));

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
  // 'copied' added by Plan 15 (D3) — matches agent.source: copyAgentForOwner() rewrites the
  // 'import' author upsertAgentFromImport() wrote on the copy's freshly-created revisions.
  author: text('author', {
    enum: ['import', 'reimport', 'scaffold', 'user', 'ai', 'copied'],
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
  // Plan 13 (2026-08-15) — MCP server. 'web' = browser-initiated call; 'mcp' = MCP-token call.
  // Nullable for existing rows (which predate MCP and are all browser-initiated). NOT NULL DEFAULT 'web'
  // would require a table rebuild to add to an existing deployment, so nullable is more migration-friendly;
  // all new rows written by the gateway carry an explicit 'web' or 'mcp' value.
  origin: text('origin'),                       // 'web' | 'mcp' | null (null = pre-Plan-13 rows)
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull().default(sql`(unixepoch())`),
}, (t) => ({
  byCreated:    index('llm_call_log_created_idx').on(t.createdAt),
  byKind:       index('llm_call_log_kind_idx').on(t.kind),
  byUserCreated: index('llm_call_log_user_created_idx').on(t.userId, t.createdAt), // §3.9 cap count
}));

// ─────────────────────────────  API tokens (Plan 13, MCP access)  ─────────────
// Per-user Personal Access Tokens for console MCP clients (Claude Code and
// equivalents). The plaintext is returned exactly once on creation — only the
// SHA-256 hex hash is ever stored. Soft-reference to user.id, matching the
// schema convention (no FK cascade). `revokedAt` is a soft delete — the row
// is never deleted so lastUsedAt stays available as an audit trail after revocation.
export const apiToken = sqliteTable('api_token', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text('owner_id').notNull(),          // soft ref → user.id
  name: text('name').notNull(),                 // user's own label, e.g. "laptop Claude Code"
  tokenHash: text('token_hash').notNull(),      // sha256 hex — UNIQUE index (the lookup key)
  prefix: text('prefix').notNull(),             // first 12 chars of plaintext — display only, never replayable
  scope: text('scope', { enum: ['read', 'write'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }), // nullable — null = never used
  expiresAt: integer('expires_at', { mode: 'timestamp' }),    // nullable — null = never expires
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),    // nullable — null = active
}, (t) => ({
  byHash:  uniqueIndex('api_token_hash_unique').on(t.tokenHash),
  byOwner: index('api_token_owner_idx').on(t.ownerId),
}));

// ─────────────────────────────  Agent shares (Plan 15)  ─────────────────────
// Read-only access grants on an agent, held against an email address — never a
// userId (constraint 3, §4.2 of plans/archive/15-share-agent.md): a row may legitimately
// pre-date the recipient's account, and storing a userId would create a second
// identity path to reconcile. Two mechanisms write the same row shape:
// granted_via:'email' (owner types an address directly) and granted_via:'code'
// (recipient redeems agent.publicCode, see the Agent table above). Table name
// singular, matching every table in this file. Sole-owner file:
// lib/db/repository/agentShares.ts.
export const agentShare = sqliteTable('agent_share', {
  // Surrogate id (not a composite PK) so the revoke route
  // (DELETE /api/agents/[id]/shares/[shareId]) never carries an email address
  // in its URL / access logs — same shape as api_token (surrogate id + a
  // separate unique index on the real key).
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull(),              // soft ref → agent.id — no references(), cascade is explicit in deleteAgent()
  recipientEmail: text('recipient_email').notNull(), // stored lowercased + trimmed, matching user.email's normalization; never resolved to a userId
  grantedVia: text('granted_via', { enum: ['email', 'code'] }).notNull(), // display-only: "you added them" vs. "redeemed the link" (D6: kept)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  // The idempotency constraint (§4.2) — granting the same (agent, email) twice
  // by either mechanism is turned into a no-op that returns the existing row.
  // Its leading column also serves every WHERE agent_id = ? lookup.
  agentEmailUnique: uniqueIndex('agent_share_agent_email_unique').on(t.agentId, t.recipientEmail),
  // The library query — run on every page load for every user. The hottest
  // query this table adds.
  byEmail: index('agent_share_email_idx').on(t.recipientEmail),
}));

// ─────────────────────  OAuth accounts  ─────────────────────────────────────────────
// Keyed on (provider, providerAccountId) — the composite PK is the unique constraint
// (§4.1). Soft reference to user.id — no references(), matching the schema convention.
export const oauthAccount = sqliteTable('oauth_account', {
  provider: text('provider').notNull(),                        // 'google' — open catalog, no DB enum
  providerAccountId: text('provider_account_id').notNull(),    // Google's `sub` — stable, never the email
  userId: text('user_id').notNull(),                           // soft ref → user.id
  providerEmail: text('provider_email'),                       // audit/display only — never authoritative
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull().default(sql`(unixepoch())`),
}, (t) => ({
  pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  byUser: index('oauth_account_user_idx').on(t.userId),
  userProvider: uniqueIndex('oauth_account_user_provider_unique').on(t.userId, t.provider),
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
