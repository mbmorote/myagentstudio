# Plan 01 — Core Loop Implementation

> The first build-sequence plan for MyAgent. Turns the settled design (`design/Concept.md`,
> `design/TechDesign.md`, the two system-agent rule-sets, `design/DesignReview.md`) into an
> ordered, file-by-file build @dev executes against.
>
> **Scope of this plan:** everything up to and including Concept build-order #1 — the *core
> loop* (structured Custom-Visualization pane rendering one seeded agent + the agent-aware
> chat editing a section in place), preceded by the round-trip proof the DesignReview
> mandates. Library/groups UI, export-to-Claude UX, Copilot translation, and sharing are
> **out of scope for this plan** (later plans in `plans/`).
>
> **Golden rule of sequencing (DesignReview blind spot #3, Draft B):** the golden-file
> round-trip harness over the real `~/.claude/agents/` library is built and green **before
> any UI exists.** If the round-trip invariant survives the real 15-agent library, the
> riskiest part of the design is proven where it matters. Nothing UI-shaped starts until
> Phase 1 is green.

---

## 0. Ambiguities resolved before build

TechDesign.md is settled at the architecture level but leaves a handful of things
underspecified for actual code. Each is resolved here so @dev never guesses. Anything that
is a genuine *business/product* decision (not just an implementation gap) is escalated to
§9 Decisions Needed instead of being silently resolved.

| # | Gap in the design | Resolution for this plan | Why this is safe / where it's anchored |
|---|---|---|---|
| R1 | **Where is the per-agent split level stored?** Mediator Guardrail #2 and Draft A both reference "the agent's split level" but no entity carries it. | Add a `splitLevel` integer column to `Agent` (1 = `#`, 2 = `##`, …). Set deterministically by Stage 1 capture (= the shallowest heading depth actually present in the body; default `1` when the body has no headings and for platform-created agents). | Draft A already names "store a per-agent `splitLevel` and validate content against it" as an accepted option (Review finding 1a, fix bullet). Deriving it is deterministic, so it never becomes a source of drift. |
| R2 | **How are validation flags (`nameSpecViolation`, `descriptionMissing`, outdated `model`, unknown `tools`) represented?** TechDesign calls them "flags" but lists no columns. | **Derived, never stored.** They are pure functions in `lib/blueprint` computed on read from live data (`Agent.name`, `Agent.description`, `AgentConfig` rows vs. `ConfigDef.allowedValues`). The API returns them in a `validation` block on the agent DTO. | Storing them would create a second source of truth that drifts from the data (exactly Review finding 4). Blueprint = one module with data + rule functions (Rules Index #9). |
| R3 | **What is the canonical "structured" form the golden-file test compares for equality?** Draft B states `parse(export(parse(md))) === parse(md)` but not the shape of `parse`'s output. | Define a `StructuredAgent` type in `lib/serialize` (frontmatter as an **ordered** array of `{key, rawValue}` string pairs + sections as an ordered array of `{heading: string \| null, content: string}`). Equality = deep-equal of that normalized object. `content` compared **byte-for-byte**; frontmatter compared as **strings** (no coercion). | Draft B: string-preserving YAML, section body byte-for-byte, structural (not textual) idempotency. The type *is* the operational definition of the invariant. |
| R4 | **Concurrent edit of one section** (structured-view typing vs. mediator rewrite). Blind spot #1 recommends a `version` int + optimistic check; TechDesign didn't add the column. | Add `version` integer (default 0) to `AgentSection`; every write increments it; writes carry the expected version and fail `409` on mismatch. | Blind spot #1, "ten lines now." Cheap, additive, prevents silent last-write-wins. |
| R5 | **The chat-mediator ↔ UI contract (Draft D) has no draft** (Blind spot #2). The core loop cannot be built without *a* contract. | Resolve a **minimal MVP contract** (see §7 Draft D): non-streaming, **apply-then-history** (server applies the rewrite, appends an `ai` `SectionRevision`, returns the new content + new version; the pre-edit state is already the prior revision, so "undo" is a revert-read, no confirm dialog). Single section per turn. Streaming / propose-preview escalated to §9. | SectionRevision (Rules Index #10) makes apply-then-history safe by construction — a bad edit is one revert away. Keeps the first slice buildable; richer UX layers on without schema change. |
| R6 | **Manual-save → SectionRevision frequency** (Rules Index #14, explicitly deferred). | Core loop ships with **AI edits** as the write path, so #14 does not block. When manual editing lands, default to *append on explicit save/blur*, not per keystroke. Flagged in §9 for confirmation when the manual-edit flow is built. | Rules Index #14 is marked "decide when building the manual-edit save flow." Not now. |
| R7 | **`AgentConfig.value` JSON in SQLite** — SQLite has no JSON column. | Store as `text({ mode: 'json' })` in Drizzle (JSON-as-text), consistent with the conservative-column-type mandate. Repository returns parsed JS values. | Rules Index #8a: conservative column types (text/integer/JSON-as-text) behind the repository so a future Postgres port is a schema rewrite, not an app rewrite. |
| R8 | **Which agent is "the one seeded agent" the core-loop pane renders?** | Seed the DB by running the real import over **`dev.md`** (clean `#`-level agent, canonical 4-section shape, real `tools` bloat + `claude-sonnet-4-6` outdated-model flag to exercise validation). Golden-file harness still runs all 15. | `dev` is the cleanest instance of the dominant convention (Concept audit) and surfaces two validation flags for free. |

---

## 1. Guiding constraints (locked — do not replan)

Restated so they are in front of @dev while building; sources in parentheses.

- **Single Next.js App-Router app.** The Anthropic key lives only in Route Handlers /
  Server Actions, read from `.env.local` (git-ignored). Never in a client component, never
  in a response body, never logged. (Principle #8, Draft C.)
- **Drizzle + `better-sqlite3`, all access through `lib/db/repository`.** No route or
  component imports `drizzle`/schema directly. (Rules Index #8a.)
- **Two-zone EAV exactly as specified:** `Agent`, `ConfigDef`/`AgentConfig`,
  `SectionDef`/`AgentSection`, `Group`/`Membership`, `SectionRevision`. No FK on
  `propKey`/`sectionKey`/`SectionRevision.sectionId`. (TechDesign data model.)
- **`lib/blueprint` is ONE module** exporting catalog data *and* rule functions
  (`validateName`, `renderHeading`, `computeValidation`, `renderBlueprintForPrompt`).
  Both system agents and the UI import the same functions. (Rules Index #9, Review #4.)
- **Stage 2 import AI returns labels only** (`{blockId → key}` / `{blockIds[] → key}`),
  never content; server reassembles bytes from Stage 1. (Rules Index #5/#6.)
- **Mediator is server-scoped to one `sectionId`, has no tools.** (Rules Index #7.)
- Tailwind + shadcn/ui. `@anthropic-ai/sdk`, default model `claude-opus-4-8`.
- Future DB dialect (Postgres vs Azure SQL) is **deferred** — do not build for it now,
  just keep column types conservative. (Rules Index #8b.)

---

## 2. File creation order (the build phases)

Build strictly top-to-bottom. Each phase has an exit gate that must be green before the
next starts. Phases 1a–1c are the DesignReview-mandated round-trip proof and come **before
any DB or UI**.

```
Phase 0  Scaffold ............... project boots, key is server-only, lint/test run
Phase 1  Round-trip proof ....... lib/blueprint (data+rules) → lib/serialize → golden test  [GATE: green on all 15]
Phase 2  Persistence ........... lib/db schema → repository → migrations+seed (catalogs)     [GATE: seed loads, repo round-trips a row]
Phase 3  Import pipeline ....... /api/import (Stage 1 deterministic + Stage 2 AI labels)     [GATE: dev.md imports, re-import updates in place]
Phase 4  Core loop ............ workbench shell → CustomViz pane → /api/chat mediator        [GATE: chat edits dev's guardrails, viz re-renders, revision logged]
```

### Phase 0 — Scaffold

| Order | File | Responsibility |
|---|---|---|
| 0.1 | `package.json`, `tsconfig.json`, `next.config.ts` | Next 15 App Router, TypeScript strict, path alias `@/*`. |
| 0.2 | `.env.local` (+ `.env.example` committed, `.env.local` git-ignored) | `ANTHROPIC_API_KEY=` and `ANTHROPIC_MODEL=claude-opus-4-8`. Example file has empty values only. |
| 0.3 | `.gitignore` | `.env.local`, `node_modules`, `*.db`, `.next`, drizzle temp. **Verify key-safety before any commit (Principle #8).** |
| 0.4 | `vitest.config.ts` | Vitest for `lib/**`. Node environment for serialize/blueprint/db tests. |
| 0.5 | `app/layout.tsx`, `app/globals.css`, `tailwind.config.ts`, shadcn init | Tailwind + shadcn/ui baseline; empty root layout + theme. No panes yet. |
| 0.6 | `lib/env.ts` | Server-only env accessor (`import 'server-only'` at top). Throws if `ANTHROPIC_API_KEY` is read in a client bundle. Single choke point for the secret. |

**Gate 0:** `npm run dev` boots a blank page; `npm test` runs (zero tests); `lib/env.ts`
cannot be imported from a client component (build fails if attempted).

### Phase 1 — Round-trip proof (no DB, no UI)

| Order | File | Responsibility |
|---|---|---|
| 1.1 | `lib/blueprint/catalog.ts` | The **in-code seed source** for `ConfigDef` + `SectionDef` as plain typed arrays (see §4). This is the single enumeration both the DB seed (Phase 2) and the Blueprint rules read — no duplication. |
| 1.2 | `lib/blueprint/rules.ts` | Rule **functions**: `validateName(name)`, `renderHeading(sectionKey \| heading)`, `computeValidation(agent)`, `configDatatypeFor(propKey)`, `sectionDefFor(sectionKey)`. Pure, no I/O. |
| 1.3 | `lib/blueprint/prompt.ts` | `renderBlueprintForPrompt()` — turns the catalog into the text block injected into both system-agent prompts. **Consumed by `lib/ai`, generated from the same arrays the validator uses** (Review #4 test target). |
| 1.4 | `lib/blueprint/index.ts` | Barrel; the *only* import surface for blueprint consumers. |
| 1.5 | `lib/serialize/types.ts` | `StructuredAgent`, `FrontmatterEntry`, `BodyBlock` types (R3). The operational definition of the invariant. |
| 1.6 | `lib/serialize/parseFrontmatter.ts` | String-preserving YAML (failsafe schema — scalars stay strings; no `4.6`→float, no `no`→bool). Returns **ordered** `{key, rawValue}[]`. Comments explicitly dropped (documented, tested as accepted loss). (Rules Index #4.) |
| 1.7 | `lib/serialize/splitBody.ts` | **Stage 1 deterministic split.** Split on the shallowest heading level actually present. Respect ```` ``` ```` and `~~~` fences (a `#` inside a fence is not a heading; unclosed fence ⇒ rest-of-file is one block). Pre-heading prose ⇒ block `order 0`, `heading: null`. Emits `splitLevel` + `BodyBlock[]` each with a stable `blockId`. |
| 1.8 | `lib/serialize/importParse.ts` | Compose 1.6 + 1.7 into `parse(md): StructuredAgent`. The **left side** of the invariant. (No AI — Stage-1 only; Stage-2 labeling happens in Phase 3 against the DB.) |
| 1.9 | `lib/serialize/export.ts` | `export(structured): string`. Deterministic write-out: `name`+`description`+config → normalized YAML frontmatter; sections by `order` → `# {heading}` + content, **headingless blocks rendered as bare content (no invented heading)**; section body byte-for-byte untouched. (Draft B, Rules Index #2.) |
| 1.10 | `lib/serialize/index.ts` | Barrel: `parse`, `export`, types. |
| 1.11 | `lib/serialize/__tests__/golden.test.ts` | **The golden-file harness.** Reads all 15 files from a fixtures copy of `~/.claude/agents/`, asserts `parse(export(parse(md)))` deep-equals `parse(md)` per agent. Plus targeted asserts: orchestrator `##` split level, scribe/ux bare-prose preamble (`heading: null` order-0 block), `Zara` name stored verbatim, `model: claude-sonnet-4-6` stays a string. |
| 1.12 | `lib/serialize/__tests__/fixtures/` | Byte-for-byte copies of the 15 real agents (committed as test fixtures so the suite is hermetic and CI-runnable, not dependent on `~/.claude`). |

**Gate 1 (the big one):** golden test green on all 15 agents + all targeted edge asserts.
This proves Rules Index #1–#6 hold on real data. **No Phase 2 work starts until this is
green.**

### Phase 2 — Persistence

| Order | File | Responsibility |
|---|---|---|
| 2.1 | `lib/db/schema.ts` | All Drizzle `sqliteTable` definitions (see §3). Conservative column types. |
| 2.2 | `lib/db/client.ts` | `better-sqlite3` + `drizzle()` singleton. **Server-only** (`import 'server-only'`). |
| 2.3 | `drizzle.config.ts` | Drizzle-kit config → `lib/db/migrations`. |
| 2.4 | `lib/db/migrations/*` | Generated schema migration(s). |
| 2.5 | `lib/db/seed.ts` | Idempotent seed: writes `ConfigDef` + `SectionDef` rows **from `lib/blueprint/catalog.ts`** (same source as the rules — no second copy). Run via `npm run db:seed`. |
| 2.6 | `lib/db/repository/agents.ts` | Repository: `createAgent`, `getAgentFull` (agent + config + sections joined into the DTO), `listAgents`, `updateSectionContent(sectionId, content, author, expectedVersion)` (optimistic — R4), `upsertAgentFromImport(...)` (re-import update-in-place, R-11). Appends `SectionRevision` on every content mutation. |
| 2.7 | `lib/db/repository/catalog.ts` | `getConfigDefs()`, `getSectionDefs()` — reads for blueprint validation & UI. |
| 2.8 | `lib/db/repository/index.ts` | Barrel — **the only DB import surface for routes/components** (Rules Index #8a). |
| 2.9 | `lib/db/repository/__tests__/repo.test.ts` | Round-trip a created agent through the repo; assert every content write appends exactly one `SectionRevision`; assert optimistic-version conflict throws. |

**Gate 2:** `db:seed` populates the catalogs; repo test green; `getAgentFull` returns the
DTO shape §5 expects.

### Phase 3 — Import pipeline

| Order | File | Responsibility |
|---|---|---|
| 3.1 | `lib/ai/client.ts` | `@anthropic-ai/sdk` singleton, model from `lib/env`. **Server-only.** |
| 3.2 | `lib/ai/importConverter.ts` | Stage-2 caller: sends Stage-1 `blockId`s + `renderBlueprintForPrompt()` + the `import-converter.md` rule text; parses the **labels-only JSON** (`{mappings, unmapped}`). Rejects any response carrying a `content`/`text` field (defense-in-depth on Rules Index #5). |
| 3.3 | `lib/ai/prompts/import-converter.txt` | The system prompt = the `design/system-agents/import-converter.md` rule-set, loaded at runtime (single source; if it changes in `design/`, sync here or import it). |
| 3.4 | `lib/import/assemble.ts` | Deterministic reassembly: takes Stage-1 blocks + Stage-2 labels, **copies content bytes by `blockId`** into `AgentSection` rows; unmapped/low-confidence ⇒ `sectionKey: "custom"`; order-0 headingless block passes through unclassified with `heading: null`. Applies `nameSpecViolation`/`descriptionMissing` handling (store verbatim + placeholder, never block — Rules Index #1/#12). |
| 3.5 | `app/api/import/route.ts` | `POST` — orchestrates Stage 1 (`lib/serialize`) → Stage 2 (`lib/ai/importConverter`) → assemble (`lib/import/assemble`) → `repository.upsertAgentFromImport`. Captures `rawSourceSnapshot`. Re-import of existing `name` = update-in-place, revisions tagged `reimport`; sections absent from the incoming file are deleted (history survives). (Rules Index #11a/#11b.) |
| 3.6 | `lib/import/__tests__/import.test.ts` | With a **mocked** Stage-2 (fixed label map for `dev.md`), assert the assembled agent's exported form round-trips to the original; assert a re-import with a changed section appends a `reimport` revision and overwrites content; assert a removed section is deleted but its revisions remain. |

**Gate 3:** importing `dev.md` produces an agent whose `getAgentFull` DTO renders and whose
export round-trips; re-import behavior verified. This also produces the **seeded agent** for
Phase 4 (R8).

### Phase 4 — Core loop (UI + chat)

| Order | File | Responsibility |
|---|---|---|
| 4.1 | `app/page.tsx` | The workbench shell — 3-pane grid (Library placeholder · CustomViz · Chat). MVP renders the single imported `dev` agent; left pane is a static placeholder (real library is a later plan). Server Component that loads the agent via repository. |
| 4.2 | `app/components/CustomViz/AgentView.tsx` | Renders the two zones: Config (typed rows from `AgentConfig` + `ConfigDef`, with validation flags surfaced) and Sections (ordered `AgentSection` rows, each `# HEADING` + rendered markdown). Reads the DTO; no key access. |
| 4.3 | `app/components/CustomViz/SectionBlock.tsx` | One section: heading + content (rendered markdown / raw toggle). Emits "this section is the chat target" selection → sets the `sectionId` the server will scope the mediator to. |
| 4.4 | `app/components/Chat/ChatPanel.tsx` | The agent-aware chat. Sends `{agentId, sectionId, instruction}` to `/api/chat`; on response, updates the selected section's content in the viz (re-render that one block). Ephemeral (in-memory) history — no persistence (TechDesign "Deferred"). |
| 4.5 | `lib/ai/chatMediator.ts` | Mediator caller: given `sectionId`'s **current content** (fetched server-side, never from the client) + instruction + `chat-mediator.md` rules + `renderBlueprintForPrompt()`, returns plain-markdown new content. Enforces split-level demotion guardrail is in the prompt; server double-checks output contains no heading at `agent.splitLevel` and demotes if found (defense-in-depth on Rules Index #3). |
| 4.6 | `lib/ai/prompts/chat-mediator.txt` | The `design/system-agents/chat-mediator.md` rule-set as the system prompt. |
| 4.7 | `app/api/chat/route.ts` | `POST` — **server chooses/validates the `sectionId`**, loads current content from the repository, calls `lib/ai/chatMediator`, writes via `repository.updateSectionContent(..., author:'ai', expectedVersion)` (appends `ai` revision), returns `{content, version}`. Holds the key. No tools exposed. (Rules Index #7.) |
| 4.8 | `app/api/agents/route.ts` + `app/api/agents/[id]/route.ts` | CRUD: `GET` list, `GET` one (full DTO), `POST` create (seeds core sections from `SectionDef.isCore` templates), `PATCH` (name/description/config), `DELETE`. Section-level `PATCH` for manual content edits (author `user`) lives under `[id]/sections/[sectionId]`. |

**Gate 4 (core loop proven):** open the app → `dev` renders in the center pane with its
config + 4 sections and its two validation flags → type "tighten the guardrails" scoped to
the Guardrails section → mediator rewrites *that section only* → viz re-renders that block →
a `SectionRevision(author:'ai')` row exists → export still round-trips (no fabricated
split-level heading). **This is the reason-to-open-the-app loop working end to end.**

---

## 3. Exact Drizzle schema (`lib/db/schema.ts`)

Conservative column types (Rules Index #8a): UUIDs as `text`, timestamps as
`integer({mode:'timestamp'})`, booleans as `integer({mode:'boolean'})`, JSON as
`text({mode:'json'})`. No FK on soft-reference columns.

```ts
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const uuid = () => text().$defaultFn(() => crypto.randomUUID());

// ─────────────────────────────  Agent  ─────────────────────────────
export const agent = sqliteTable('agent', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),            // stored verbatim; flag-don't-block (Rules #1)
  description: text('description').notNull(),        // missing-on-import ⇒ placeholder (Rules #12)
  source: text('source', { enum: ['created', 'imported'] }).notNull(),
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
    enum: ['import', 'reimport', 'user', 'ai'],
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
```

**Notes for @dev**
- `agentConfig.agentId` / `agentSection.agentId` are intentionally *not* declared as Drizzle
  `references()` cascades — deletion cascades are handled explicitly in the repository so the
  soft-reference pattern (and `SectionRevision`'s deliberate no-cascade) is uniform and
  visible in one place.
- `order` and `group` are SQL reserved-ish words — Drizzle quotes identifiers, but keep the
  JS property names as given.
- `Group`/`Membership` tables ship now (schema is cheap, additive-later is the point) but no
  UI/route touches them in this plan.

---

## 4. Seed data shape (`lib/blueprint/catalog.ts` → `lib/db/seed.ts`)

The catalog arrays live in code (`lib/blueprint/catalog.ts`) so the Blueprint rules and the
DB seed read **one** source. `seed.ts` just inserts them idempotently.

### ConfigDef seed (frontmatter catalog)

```ts
export const CONFIG_DEFS = [
  { key: 'model',          label: 'Model',           datatype: 'enum', isCore: true,  required: false,
    allowedValues: ['opus','sonnet','haiku','fable','inherit','claude-opus-4-8'] },
  { key: 'tools',          label: 'Tools',           datatype: 'list', isCore: true,  required: false,
    allowedValues: ['Read','Write','Edit','Create','Bash','Grep','Glob','WebFetch','WebSearch','Task'] },
  { key: 'disallowedTools',label: 'Disallowed tools',datatype: 'list', isCore: false, required: false, allowedValues: null },
  { key: 'permissionMode', label: 'Permission mode', datatype: 'enum', isCore: false, required: false,
    allowedValues: ['default','acceptEdits','auto','dontAsk','bypassPermissions','plan'] },
  { key: 'maxTurns',       label: 'Max turns',       datatype: 'int',  isCore: false, required: false, allowedValues: null },
  { key: 'skills',         label: 'Skills',          datatype: 'list', isCore: false, required: false, allowedValues: null },
  { key: 'mcpServers',     label: 'MCP servers',     datatype: 'list', isCore: false, required: false, allowedValues: null },
  { key: 'memory',         label: 'Memory',          datatype: 'enum', isCore: false, required: false,
    allowedValues: ['user','project','local'] },
  { key: 'effort',         label: 'Effort',          datatype: 'enum', isCore: false, required: false,
    allowedValues: ['low','medium','high','xhigh','max'] },
  { key: 'background',     label: 'Background',       datatype: 'bool', isCore: false, required: false, allowedValues: null },
] as const;
```
- `name` and `description` are **not** in this catalog — they are real `Agent` columns.
- `allowedValues` is the single source for both dropdowns and validation flags (a real
  `model: "claude-sonnet-4-6"` is *not* in the list ⇒ `computeValidation` flags it outdated;
  `tools: "Create"` is standard in this seed so it won't flag — adjust the list against the
  live Anthropic spec when seeding). The catalog is data, so this is a seed edit, not code.
- Any imported key not in this list stores fine as `datatype: any` (openness rule).

### SectionDef seed (body catalog)

```ts
export const SECTION_DEFS = [
  { key: 'role',       label: 'Role',       defaultHeading: '# ROLE',          isCore: true,  defaultOrder: 1,
    template: 'You are a [senior X] specializing in:\n- …\n\nYour job is to …',
    helpText: 'Identity + mandate. Open with "You are…". End with a STOP clause if the agent must refuse ambiguous input.' },
  { key: 'behavior',   label: 'Behavior',   defaultHeading: '# BEHAVIOR',      isCore: true,  defaultOrder: 2,
    template: '1. …\n2. …\n3. …',
    helpText: 'How it works — the numbered process. (This is the section that has 6 different names across real libraries; the tool standardizes it.)' },
  { key: 'guardrails', label: 'Guardrails', defaultHeading: '# RULES',         isCore: true,  defaultOrder: 3,
    template: '- Never …\n- Always …',
    helpText: 'Hard rules / what it must not do.' },
  { key: 'output',     label: 'Output',     defaultHeading: '# OUTPUT FORMAT', isCore: true,  defaultOrder: 4,
    template: '| Section | Format |\n|---|---|\n| … | … |',
    helpText: 'The shape of what the agent returns.' },
  { key: 'sources',    label: 'Sources',    defaultHeading: '# SOURCES',       isCore: false, defaultOrder: 5, template: '', helpText: 'Files/inputs it reads.' },
  { key: 'lifecycle',  label: 'Lifecycle',  defaultHeading: '# LIFECYCLE',     isCore: false, defaultOrder: 6, template: '', helpText: 'Start/end-of-session duties (read memory / write report).' },
  { key: 'handoffs',   label: 'Handoffs',   defaultHeading: '# HANDOFFS',      isCore: false, defaultOrder: 7, template: '', helpText: 'Relationships to other agents.' },
  { key: 'tone',       label: 'Tone',       defaultHeading: '# TONE',          isCore: false, defaultOrder: 8, template: '', helpText: 'Voice.' },
  { key: 'modes',      label: 'Modes',      defaultHeading: '# MODES',         isCore: false, defaultOrder: 9, template: '', helpText: 'Sub-modes (e.g. dev Mode A/B, session modes).' },
] as const;
```
- `defaultHeading` is stored `# …`; `renderHeading` derives the real emitted heading and, on
  import, an unknown block keeps its **original** heading text verbatim (lossless).
- New agent ⇒ seed one `AgentSection` per `isCore` def at `defaultOrder`, pre-filled with
  `template`, and write revision #0 `author:'import'` (or `'user'` for platform-created —
  see §9 Decision D5 for which author a fresh created-in-platform section gets).

---

## 5. API route contracts

All routes are server-side (hold the key), return JSON, and go through the repository. DTOs
shared via `lib/serialize/types.ts` + a `lib/dto.ts`.

### Agent DTO (returned by `GET /api/agents/[id]` and consumed by the viz)

```ts
type AgentDTO = {
  id: string;
  name: string;
  description: string;
  source: 'created' | 'imported';
  splitLevel: number;
  config: { propKey: string; value: unknown; def: ConfigDefLite | null }[]; // def null = unknown key
  sections: {
    id: string; sectionKey: string; heading: string | null;
    content: string; order: number; version: number;
    def: SectionDefLite | null;
  }[];
  validation: {                       // R2 — derived, never stored
    nameSpecViolation: boolean;
    descriptionMissing: boolean;
    unknownConfigKeys: string[];
    outdatedOrUnknownValues: { propKey: string; value: unknown }[];
  };
};
```

| Method | Path | Auth (MVP) | Request | Response | Errors | Side effects |
|---|---|---|---|---|---|---|
| `POST` | `/api/import` | none (local) | `{ md: string }` (raw file text) | `AgentDTO` (new or updated) | `400` bad `.md`; `422` Stage-2 AI returned content-bearing/invalid JSON; `502` Anthropic failure | Creates/updates `Agent` (+ zones), captures `rawSourceSnapshot`, writes `import`/`reimport` revisions; re-import deletes absent sections |
| `GET` | `/api/agents` | none | – | `AgentDTO[]` (lite: no sections) | – | none |
| `GET` | `/api/agents/[id]` | none | – | `AgentDTO` (full) | `404` | none |
| `POST` | `/api/agents` | none | `{ name, description }` | `AgentDTO` | `409` name exists; `400` invalid body | Creates agent + core sections from templates; revision #0 per section |
| `PATCH` | `/api/agents/[id]` | none | `{ name?, description?, config?: {propKey,value}[] }` | `AgentDTO` | `404`; `409` name collision | Upserts config rows; name stored verbatim (flag, don't block) |
| `DELETE` | `/api/agents/[id]` | none | – | `{ ok: true }` | `404` | Deletes agent + its config/sections; **`SectionRevision` rows retained** (soft ref) |
| `PATCH` | `/api/agents/[id]/sections/[sectionId]` | none | `{ content, expectedVersion }` | `{ content, version }` | `404`; `409` version mismatch (R4) | Overwrites content; appends `user` revision; bumps version |
| `POST` | `/api/chat` | none | `{ agentId, sectionId, instruction }` | `{ sectionId, content, version }` | `404`; `409` version mismatch; `502` Anthropic failure | **Server scopes to `sectionId`**, loads current content server-side, mediator rewrites, appends `ai` revision, bumps version, split-level demotion double-checked |

**`POST /api/chat` — the contract in detail (Draft D, MVP):**
- Request carries the `sectionId` the UI selected; the **server re-loads that section's
  current content from the DB** (never trusts client-supplied content) and passes only that
  one section + instruction to the mediator (Rules Index #7).
- Non-streaming (single JSON response). Apply-then-history: the rewrite is applied
  immediately and the pre-edit content is already the prior revision (revert = read + write,
  no separate "undo" endpoint needed for MVP).
- Response returns the new `content` + new `version`; the client swaps that one block.
- The mediator has **no tools**; the route exposes none.

**Error-handling policy (all routes):**

| Scenario | HTTP | Response shape | Logged? |
|---|---|---|---|
| Malformed request body | 400 | `{ error, field? }` | no |
| Not found | 404 | `{ error: 'not_found' }` | no |
| Optimistic version conflict | 409 | `{ error: 'version_conflict', current: number }` | no |
| Name unique collision (create) | 409 | `{ error: 'name_exists' }` | no |
| Stage-2 AI returned content-bearing / non-JSON labels | 422 | `{ error: 'invalid_ai_labels' }` | **yes** (integrity signal) |
| Anthropic API failure/timeout | 502 | `{ error: 'ai_upstream' }` | **yes** |
| Unexpected server error | 500 | `{ error: 'internal' }` | **yes** (never include the key or prompt text) |

Validation problems on user data (bad name casing, missing description, outdated model) are
**never errors** — they surface as `validation` flags on the DTO (flag-don't-block).

---

## 6. Business rules (grouped)

**Invariants (always true):**
1. `parse(export(parse(md))) === parse(md)` structurally for every agent (Gate 1).
2. Import never deletes or alters content bytes; unmappable content ⇒ `custom`, verbatim
   (Principle #10; Rules Index #5/#6).
3. Every change to any `AgentSection.content` appends exactly one `SectionRevision`; the row
   is never updated or deleted (append-only). `AgentSection.content` = latest revision.
4. `SectionRevision` rows are never cascade-deleted with their section (log outlives row).
5. The AI key never appears in any client bundle, response body, or log (Principle #8).
6. A section's `content` never contains a heading at the agent's `splitLevel` after a
   mediator/manual write (demoted if it would — Rules Index #3).

**Policies (configurable / catalog-driven):**
7. `ConfigDef.allowedValues` drives both dropdowns and validation flags; editing the seed
   updates both with no code change.
8. `name` stored verbatim; `nameSpecViolation` flag computed; normalized only on explicit
   user action (Rules Index #1).
9. Missing `description` on import ⇒ placeholder + `descriptionMissing` flag (Rules Index #12).
10. Unknown `propKey`/`sectionKey` always stored, rendered, exported (no FK openness).

**State transitions (sequences):**
11. **Import:** Stage 1 deterministic capture → Stage 2 AI labels-only → server reassembles
    bytes → repository upserts → revisions written (`import` first-time / `reimport` on
    collision).
12. **Re-import collision:** existing `name` ⇒ update-in-place; changed section overwritten +
    `reimport` revision; new section created + `reimport` revision #0; absent section deleted
    (revisions retained). Never duplicate, never hard error (Rules Index #11a/#11b).
13. **Chat edit:** select section → server-scoped mediator call → apply + `ai` revision +
    version bump → viz re-renders that block.
14. **Manual edit:** structured-view save → `user` revision + version bump (frequency policy
    deferred, Rules Index #14 — see §9).

---

## 7. Draft D (resolved for MVP) — mediator ↔ UI contract

DesignReview blind spot #2 flagged this as undrafted and "the hardest engineering." The MVP
resolution, kept deliberately minimal so the core loop is buildable and richer UX layers on
without schema change:

- **Turn shape:** one instruction → one section rewrite. Multi-section edits in one turn are
  **out of scope** for MVP (a follow-up instruction is a new server-scoped call).
- **Streaming:** **no** for MVP (single JSON response). Streaming is additive later (swap the
  route to a stream, viz already re-renders one block).
- **Apply model:** **apply-then-history**, not propose-then-preview. The rewrite lands
  immediately; the prior state is already the last `SectionRevision`, so recovery is a
  revert-read. (Propose-preview is a UX upgrade addable later with no data change.)
- **Scoping:** the **server** picks/validates the `sectionId` from the request and loads its
  content server-side; the mediator is told exactly one section (Rules Index #7).
- **Safety net:** server post-checks the mediator output for a heading at `agent.splitLevel`
  and demotes it before writing (defense-in-depth on the prompt-level guardrail, Rules
  Index #3).

Escalated to §9: whether to upgrade to streaming + propose-preview before dogfooding, and
multi-section edits.

---

## 8. Testing approach

**Unit (Vitest, `lib/**`) — the backbone, from Phase 1:**
- `lib/serialize`: the **golden-file round-trip** over all 15 real agents (Gate 1) — the
  single most important test in the project. Plus targeted cases: orchestrator `##` split
  level; scribe/ux headingless bare-prose preamble → `heading:null` order-0 block; `Zara`
  name verbatim; `model: claude-sonnet-4-6` stays a string; a `#` inside a fenced code block
  is not a split; an unclosed fence ⇒ rest-of-file one block; comments dropped (asserted as
  accepted loss).
- `lib/blueprint`: `validateName` (lowercase-hyphen), `renderHeading`, `computeValidation`
  flags (outdated model, unknown tool, missing description). **Review #4 test:** assert
  `renderBlueprintForPrompt()` is generated from the same catalog arrays the validator reads
  (no divergent second copy).
- `lib/db/repository`: create→read round-trip; every content write appends exactly one
  revision; optimistic-version conflict throws; delete retains `SectionRevision` rows.
- `lib/import/assemble`: with a mocked Stage-2 label map, assembled `dev` exports to a form
  that round-trips; re-import changed/added/removed section behavior (Rules Index #11).

**Integration (route-level, mocked Anthropic):**
- `/api/import` with a canned Stage-2 response → agent persisted, DTO shape correct,
  `rawSourceSnapshot` captured.
- `/api/chat` scoping: request with a bogus/foreign `sectionId` is rejected/ignored; server
  uses DB content, not client-supplied; response bumps version; a mediator response
  containing `# Heading` is demoted before persistence; version conflict returns 409.
- `/api/agents` CRUD happy paths + `409` name collision.

**End-to-end (manual, Gate 4 checklist for @dev):**
1. `db:seed` + import `dev.md` → app shows `dev` with config + 4 sections + 2 validation
   flags (outdated model, tool bloat).
2. Select Guardrails, send "tighten the guardrails" → only that block changes.
3. A `SectionRevision(author:'ai')` row now exists for that section.
4. Export `dev` → round-trips (no fabricated section from an in-content heading).
5. Re-import a hand-edited `dev.md` → updates in place, `reimport` revision appears, no
   duplicate agent.

**Special setup:** golden fixtures are committed copies of the 15 agents
(`lib/serialize/__tests__/fixtures/`) so tests are hermetic. Anthropic is **mocked** in all
automated tests — no real key in CI. A single seeded `dev` agent is the E2E fixture.

---

## 9. Decisions needed (surface before / during build)

These are genuine product/UX decisions, not implementation gaps — @dev should not invent
them. None block Phases 0–3; D1/D2 are needed before Phase 4 chat UX is finalized.

1. **D1 — Mediator UX depth (Draft D upgrade).** MVP ships non-streaming, apply-then-history
   (§7). Confirm that's acceptable for first dogfooding, or prioritize streaming /
   propose-preview now. *Blocks:* the polish of Phase 4.4/4.7, not the loop itself.
2. **D2 — Multi-section edits in one chat turn.** MVP = one section per turn. Confirm this is
   fine, or specify how a "touch several sections" instruction should fan out. *Blocks:*
   chat panel interaction design.
3. **D3 — Manual-save revision frequency (Rules Index #14).** When the structured-view
   manual-edit flow is built (after this plan), decide: append a `user` revision on every
   save, or debounce to edit boundaries (blur / explicit save). Default assumed: on explicit
   save/blur.
4. **D4 — `model` `allowedValues` authoritative list.** The seed list here is a reasonable
   snapshot; confirm the exact current Anthropic model aliases/full-IDs to seed so validation
   flags the right values. It's a seed edit, not code, so low-cost to change.
5. **D5 — Revision author for a section created directly in the platform** (not imported).
   Options: reuse `import` as "genesis" semantics, or add a `create` author. This plan
   assumes **`user`** for platform-created sections (keeps the enum as specified:
   `import|reimport|user|ai`), reserving `import`/`reimport` strictly for file-origin. Confirm.
6. **D6 — Prompt-file source of truth.** The system-agent prompts live as design docs in
   `design/system-agents/*.md` *and* must be loaded at runtime from `lib/ai/prompts/*.txt`.
   Decide whether the runtime copy is generated from the design doc (build step) or kept in
   sync manually. Assumed manual-sync for MVP with a note; flag if drift risk is a concern.

---

## 10. Risks per phase & mitigation

| Phase | Risk | Mitigation |
|---|---|---|
| 1 | Golden test fails on a real agent (e.g. Aria's 557 lines, an unclosed fence) — the invariant genuinely doesn't hold. | This is the *point* of doing it first. Fix the spec/parser before any DB/UI is built on top (the DesignReview's entire thesis). Each failing agent is a cheap fix now, a migration later. |
| 2 | EAV DTO assembly (agent + config + sections + defs) is fiddly / N+1. | One `getAgentFull` query per agent is the only hot path (Review "leave alone"); load all zones for one agent in a few queries and assemble in the repository. |
| 3 | Stage-2 AI returns content or malformed JSON. | Hard schema check in `importConverter.ts` → `422`; server always reassembles bytes from Stage 1 regardless (Rules Index #5). Loss is impossible by construction. |
| 3 | Prompt drift between `design/system-agents/*.md` and `lib/ai/prompts/*.txt`. | D6 — pick a sync strategy; add a test that the runtime prompt contains the locked guardrail lines. |
| 4 | Concurrent edit clobbers (typing while AI rewrites). | `version` optimistic check (R4) → `409`; UI reloads section. |
| 4 | Key leakage into a client bundle. | `lib/env.ts` + `lib/db/client.ts` + `lib/ai/client.ts` all `import 'server-only'`; pre-commit key-safety check (Principle #8). |

---

## 11. Parallelization & dependencies

- **Strictly serial gates:** Phase 1 (round-trip) must be green before Phase 2; Phase 2
  before Phase 3; Phase 3 before Phase 4 (Phase 3 produces the seeded agent Phase 4 renders).
- **Parallelizable within phases:**
  - Phase 1: `lib/blueprint/*` and `lib/serialize/parseFrontmatter`+`splitBody` can be built
    in parallel; they converge at `importParse`/`export`.
  - Phase 4: the three panes (`CustomViz`, `Chat`, shell) can be built in parallel against
    the DTO contract (§5) once `/api/agents/[id]` exists; `/api/chat` + `lib/ai/chatMediator`
    in parallel with the viz.
- **Cross-cutting, do continuously:** the key-safety check (Principle #8) and Vitest coverage
  for each `lib/` module as it lands.

---

## Appendix — where each Rules Index item is discharged in this plan

| Rules Index # | Discharged by |
|---|---|
| 1 (name flag-don't-block) | `agent.name` verbatim + `computeValidation.nameSpecViolation` (R2, §3/§4) |
| 2 (nullable heading) | `agentSection.heading` nullable + export bare-content path (§3, Phase 1.9) |
| 3 (no split-level heading in content) | mediator prompt + server demotion double-check (Phase 4.5/4.7, §7) |
| 4 (string-preserving YAML, comments lost) | `parseFrontmatter.ts` (Phase 1.6) + golden test |
| 5 (Stage-2 labels only) | `importConverter.ts` schema check + `assemble.ts` byte-copy (Phase 3.2/3.4) |
| 6 (merges = blockIds→label) | Stage-2 response schema + server reassembly (Phase 3) |
| 7 (mediator server-scoped, no tools) | `/api/chat` loads content server-side, no tools (Phase 4.7) |
| 8a (repository layer, conservative types) | `lib/db/repository/*` sole DB surface; text/int/JSON-as-text (§3) |
| 9 (blueprint = data + rule fns) | `lib/blueprint` single module (Phase 1.1–1.4) + Review#4 test |
| 10 (SectionRevision from import onward) | `sectionRevision` table + repo appends on every write (§3, Phase 2.6) |
| 11a/11b (re-import update-in-place / delete-absent) | `upsertAgentFromImport` + `/api/import` (Phase 3.5, §6 rule 12) |
| 12 (missing description → placeholder+flag) | `assemble.ts` + `computeValidation` (Phase 3.4, R2) |
| 8b, 13, 14 | **Deferred** (Rules Index) — not built in this plan; 14 noted in §9 D3 |
```
