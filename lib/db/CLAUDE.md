# lib/db — Schema, Migrations, Seed, Repository Layer

The database boundary: the Drizzle schema, the migrations that built it, the two seed
scripts, and the repository layer every route and component reads/writes agents, groups,
users, and logs through. Nothing outside `lib/db/` opens the database directly.

## Architecture

```
route handler / server component
        │
        ▼
lib/db/repository/index.ts        ← the ONLY DB import surface outside lib/db
   (barrel re-export)
        │
        ▼
repository/{agents,groups,users,oauthAccounts,settings,catalog,llmCallLog,apiTokens}.ts
        │
        ▼
lib/db/client.ts  ──►  better-sqlite3  ──►  myagent.db
        │
   lib/db/schema.ts  (Drizzle sqliteTable definitions)
```

`client.ts` holds the one `better-sqlite3` + `drizzle()` singleton, `server-only`-guarded,
resolved to `myagent.db` at the project root regardless of working directory, with WAL mode
and foreign-key enforcement turned on. `repository/index.ts` is the only file outside this
folder anything may import from — routes and other `lib/` modules never reach into an
individual `repository/*.ts` file or into `schema.ts` directly. Every repository function
that reads or writes an owned row (`agent`, `group`) takes an `ownerId` as a required,
never-defaulted parameter and applies it in the same statement that touches the row —
there's no function that could accidentally return another user's data.

## Schema (`schema.ts`)

All Drizzle `sqliteTable` definitions in one file, using conservative column types (UUIDs
as text, timestamps as integer, booleans as integer, JSON as text) chosen so a future
storage-engine migration is a schema-file rewrite behind the repository boundary, not an
app-wide one. Soft-reference columns (`agentConfig.agentId`, `agentSection.agentId`,
`sectionRevision.sectionId`, `agentSnapshot.agentId`) deliberately carry no Drizzle
`references()` FK cascade — deletion cascades are handled explicitly in the repository
layer instead, so every soft-reference behaves the same visible way in one place rather
than half being enforced by the database and half by code. See `docs/system-about.md` §4
for the full entity-by-entity description of what's in here (`Agent`, the Config/Section
EAV zones, `SectionRevision`, `AgentSnapshot`, `Group`/`Membership`, `User`, `InviteCode`,
`OAuthAccount`, `llm_call_log`).

## Migrations (`migrations/`)

Nine migrations to date (`0000`–`0008`), applied in order by `drizzle-kit`. `0000`–`0004`
built the original single-tenant schema, groups, and the LLM gateway/settings/log tables;
`0005` added `(platform, key)` scoping to the `configDef`/`sectionDef` catalogs; `0006`
dropped `sectionDef.label` once `defaultHeading` became the single name for a section
(display text included); `0007` (Plan 12) added `access_request` plus
`invite_code.bound_email`/`expires_at` for the signup-request flow; `0008` (Plan 13) added
the `api_token` table and `llm_call_log.origin`. Migration filenames are
`drizzle-kit`-generated (random two-word suffixes) — the leading number is the only part
that matters for ordering.

## Seed (`seed.ts`, `sectionDefsSeed.ts`)

`seed.ts` runs the migrations, then writes `ConfigDef`/`SectionDef` rows for the `'claude'`
platform from `lib/blueprint/catalog.ts` (config) and `sectionDefsSeed.ts` (sections) —
**but only where a `(platform, key)` row doesn't already exist** (`ON CONFLICT DO
NOTHING`). This is deliberate: once seeded, these rows are DB-owned and meant to be
admin-editable, so the seed must never overwrite an in-database edit on the next `npm run
dev`. `sectionDefsSeed.ts` itself is a bootstrap-only default — the live source read by the
running app for every blueprint sent to the AI callers is `repository/catalog.ts`'s
`getSectionDefs(platform)`, not this file; this array only matters the one time a fresh
database is seeded. Run manually via `npm run db:seed`; also wired into `predev`/`prebuild`.
Running it twice is a no-op once the rows exist.

## Repository (`repository/`)

Each file owns one slice of the schema and is the only place in the codebase that touches
its tables directly:

- **`agents.ts`** — agent CRUD, section mutations, import upsert/reconciliation. The only
  file that touches `agent`/`agentSection`/`sectionRevision`/`agentSnapshot` rows. Enforces
  that every content change to a section appends exactly one `SectionRevision`, that
  `SectionRevision`/`AgentSnapshot` rows are never cascade-deleted, and optimistic
  concurrency on manual section edits via a version column.
- **`groups.ts`** — group + membership CRUD. `parentId` is always written `null` (flat
  groups only, per the current design); a duplicate group name throws a typed error mapped
  to `409` at the route layer, matching the pattern `agents.ts` already uses.
- **`catalog.ts`** — read-only access to `ConfigDef`/`SectionDef`, used by blueprint
  validation and UI dropdown population.
- **`users.ts`** — user rows and invite codes. `createUserWithInvite()` accepts a
  pre-computed `passwordHash`, never a plaintext password (hashing must happen outside any
  `db.transaction()` callback, since `better-sqlite3` transactions are synchronous), and
  re-checks every signup precondition — email uniqueness, invite-code validity, the
  `maxUsers` cap — inside one transaction.
- **`oauthAccounts.ts`** — `oauth_account` rows. `linkOAuthAccount()` is a standalone
  single-statement insert, not part of the signup transaction; a race between two
  concurrent links for the same identity is caught by the composite primary key's
  unique-constraint error. No `UPDATE`/`DELETE` is exported — insert-only by convention.
- **`settings.ts`** — raw string get/set for the `setting` table. Has no knowledge of what
  any setting means or its default; typing and fail-safe defaults live in `lib/settings.ts`
  one layer up. Unlike the append-only log tables, `setting` rows are genuinely mutable
  operator state.
- **`llmCallLog.ts`** — append-only audit log for every AI call attempt. The one narrow
  exception to "no `UPDATE`": `reserveCallSlot()`/`finalizeCallLog()` together close a
  cap-check race by updating a single reserved row exactly once, by its own writer, to
  attach the real outcome — documented as the sanctioned exception, not a precedent for
  more. `sharedWithAdmin` is written once by the gateway at call time and never touched
  again; pre-auth rows (`userId IS NULL`) are never redacted regardless of that flag, since
  they predate multi-tenancy and belong to the admin by definition. Gained a nullable
  `origin: 'web' | 'mcp'` column in Plan 13 so the audit log can distinguish MCP-initiated
  calls from browser-initiated ones — written by `lib/ai/gateway.ts` from `LlmCallContext.origin`
  (default `'web'` when absent), the same fidelity fix Plan 11 made for the `provider` column.
- **`apiTokens.ts`** — `api_token` rows (Plan 13, MCP access). The only file that touches
  this table. `tokenHash` is never returned by `listApiTokensForUser()` — only `prefix`/
  `name`/`scope`/dates. `revokeApiToken()` is a soft delete (`revokedAt` set, row never
  deleted, so `lastUsedAt` survives as an audit trail) and requires both `id` and `ownerId`
  to match. `createApiToken()` enforces a per-user cap of 10 active tokens.
- **`index.ts`** — the barrel. Re-exports every function and DTO type the files above
  expose; this is the only import path anything outside `lib/db/` is allowed to use.

## Files in this folder

| File | Role |
|---|---|
| `client.ts` | The `better-sqlite3` + `drizzle()` singleton |
| `schema.ts` | Every Drizzle table definition |
| `seed.ts` | Runs migrations + bootstrap-only catalog seed (`npm run db:seed`) |
| `sectionDefsSeed.ts` | Bootstrap-only default `SectionDef` rows, consumed only by `seed.ts` |
| `migrations/*.sql` | Nine migrations (`0000`–`0008`), `drizzle-kit`-generated, applied in numeric order |
| `repository/agents.ts` | Agent/section/revision/snapshot CRUD |
| `repository/groups.ts` | Group/membership CRUD |
| `repository/catalog.ts` | Read-only `ConfigDef`/`SectionDef` access |
| `repository/users.ts` | User rows + invite codes |
| `repository/oauthAccounts.ts` | `oauth_account` rows |
| `repository/settings.ts` | Raw `setting` table get/set |
| `repository/llmCallLog.ts` | Append-only AI call audit log |
| `repository/apiTokens.ts` | `api_token` rows — Personal Access Tokens for MCP access (Plan 13) |
| `repository/index.ts` | The barrel — sole import surface for everything above |
| `__tests__/test-db.ts`, `__tests__/test-users.ts` | In-memory (`:memory:`) DB + fixture-user helpers shared across the repository test suite |
| `__tests__/migration.test.ts` | Migrations apply cleanly to a fresh database |
| `__tests__/sectionDefsSeed.test.ts` | Structural sanity on the static seed catalog |
| `repository/__tests__/*.test.ts` | One suite per repository file above, plus `index.test.ts` (barrel re-export smoke test) and `llmCallLog-redaction.test.ts` (cross-owner/consent redaction cases) |
