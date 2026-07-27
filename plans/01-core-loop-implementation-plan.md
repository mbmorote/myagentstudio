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
- **Mediator is server-scoped to one agent (may rewrite any number of its sections in one
  turn), has no tools.** (Rules Index #7 — re-scoped 2026-07-26; `SectionRevision` stays a
  per-section log, not the edit boundary.)
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
Phase 3  Import pipeline ....... /api/agents/import (Stage 1 deterministic + Stage 2 AI labels)     [GATE: dev.md imports, re-import updates in place]
Phase 4  Core loop ............ workbench shell → CustomViz pane → /api/chat mediator        [GATE: chat edits dev's guardrails, viz re-renders, revision logged]
```

### Phase 0 — Scaffold

| Order | File | Responsibility |
|---|---|---|
| 0.1 | `package.json`, `tsconfig.json`, `next.config.ts` | Next 15 App Router, TypeScript strict, path alias `@/*`. `predev`/`prebuild` scripts run `scripts/build-prompts.ts` (Phase 0.7) before `next dev`/`next build` (D6) — the compiled system-agent prompts always exist before the app boots, generated fresh from `design/system-agents/*.md` every time, never hand-edited or committed. |
| 0.2 | `.env.local` (+ `.env.example` committed, `.env.local` git-ignored) | `ANTHROPIC_API_KEY=` and `ANTHROPIC_MODEL=claude-opus-4-8`. Example file has empty values only. |
| 0.3 | `.gitignore` | `.env.local`, `node_modules`, `*.db`, `.next`, drizzle temp, `lib/ai/prompts/generated/` (build artifact, regenerated every `predev`/`prebuild`, never committed). **Verify key-safety before any commit (Principle #8).** |
| 0.4 | `vitest.config.ts` | Vitest for `lib/**`. Node environment for serialize/blueprint/db tests. |
| 0.5 | `app/layout.tsx`, `app/globals.css`, `tailwind.config.ts`, shadcn init | Tailwind + shadcn/ui baseline; empty root layout + theme. No panes yet. |
| 0.6 | `lib/env.ts` | Server-only env accessor (`import 'server-only'` at top). Throws if `ANTHROPIC_API_KEY` is read in a client bundle. Single choke point for the secret. |
| 0.7 | `scripts/build-prompts.ts` + generated `lib/ai/prompts/generated/{import-converter,chat-mediator}.ts` | **Compile-time, not runtime (D6, resolved 2026-07-26; moved here from Phase 3 during §11 review — sequencing fix, since Phase 0.1's `predev`/`prebuild` needs this script to already exist).** Reads `design/system-agents/{name}.md` for both system agents (only dependency: those two already-existing files), strips the leading title + `>` blockquote (human-facing intro, not prompt content), writes each as a plain exported string constant (e.g. `export const IMPORT_CONVERTER_PROMPT = "..."`) into the generated file. By the time the server actually runs, the prompt text is already compiled JS — no filesystem read of `design/` at request time or server start. Generated files are gitignored (0.3), always regenerated, never hand-edited. **`design/system-agents/*.md` remains the one and only place the rules are ever reviewed or edited** — same reasoning as Rules Index #9 (Blueprint = one module, no divergent second copy). |

**Gate 0:** `npm run dev` boots a blank page (which means `predev` → `scripts/build-prompts.ts`
ran successfully and both generated prompt files exist); `npm test` runs (zero tests);
`lib/env.ts` cannot be imported from a client component (build fails if attempted).

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
| 3.2 | `lib/ai/importConverter.ts` | Stage-2 caller: sends Stage-1 `blockId`s + `renderBlueprintForPrompt()` + the compiled `IMPORT_CONVERTER_PROMPT` (Phase 0.7); parses the **labels-only JSON** (`{mappings, unmapped}`). Rejects any response carrying a `content`/`text` field (defense-in-depth on Rules Index #5). |
| 3.3 | *(moved to Phase 0.7)* | `scripts/build-prompts.ts` has no dependency on Phases 1–3 — its only input is `design/system-agents/*.md`, which already exists. Moved earlier (sequencing fix, 2026-07-26) so `predev`/`prebuild` (wired in Phase 0.1) has something to run from Phase 0 onward — otherwise Gate 0 would fail immediately. Kept as a row only so the phase's numbering stays in sync. |
| 3.4 | `lib/import/assemble.ts` | Deterministic reassembly: takes Stage-1 blocks + Stage-2 labels, **copies content bytes by `blockId`** into `AgentSection` rows; unmapped/low-confidence ⇒ `sectionKey: "custom"`; order-0 headingless block passes through unclassified with `heading: null`. Applies `nameSpecViolation`/`descriptionMissing` handling (store verbatim + placeholder, never block — Rules Index #1/#12). |
| 3.5 | `app/api/agents/import/route.ts` | `POST` — orchestrates Stage 1 (`lib/serialize`) → Stage 2 (`lib/ai/importConverter`) → assemble (`lib/import/assemble`) → `repository.upsertAgentFromImport`. Captures `rawSourceSnapshot`. Re-import of existing `name` = update-in-place, revisions tagged `reimport`; sections absent from the incoming file are deleted (history survives). (Rules Index #11a/#11b.) If an agent with this `name` already exists, writes an `AgentSnapshot(kind:'pre-import')` from its current exported form **before** applying any change; always writes an `AgentSnapshot(kind:'post-import')` from the exported form **after** the upsert completes (first-time import only gets the post snapshot). |
| 3.6 | `lib/import/__tests__/import.test.ts` | With a **mocked** Stage-2 (fixed label map for `dev.md`), assert the assembled agent's exported form round-trips to the original; assert a re-import with a changed section appends a `reimport` revision and overwrites content; assert a removed section is deleted but its revisions remain. |

**Gate 3:** importing `dev.md` produces an agent whose `getAgentFull` DTO renders and whose
export round-trips; re-import behavior verified. This also produces the **seeded agent** for
Phase 4 (R8).

### Phase 4 — Core loop (UI + chat)

| Order | File | Responsibility |
|---|---|---|
| 4.1 | `app/page.tsx` | The workbench shell — 3-pane grid (Library placeholder · CustomViz · Chat). MVP renders the single imported `dev` agent; left pane is a static placeholder (real library is a later plan). Server Component that loads the agent via repository. |
| 4.2 | `app/components/CustomViz/AgentView.tsx` | Renders the two zones: Config (typed rows from `AgentConfig` + `ConfigDef`, with validation flags surfaced) and Sections (ordered `AgentSection` rows, each `# HEADING` + rendered markdown). Reads the DTO; no key access. |
| 4.3 | `app/components/CustomViz/SectionBlock.tsx` | One section: heading + content (rendered markdown / raw toggle). No "chat target" selection (D2 removed that — chat is agent-scoped, not section-scoped). Opening raw-edit mode with unsaved changes engages the **interaction lock** (§7): chat is disabled for the agent until raw-edit is saved or cancelled. |
| 4.4 | `app/components/Chat/ChatPanel.tsx` | The agent-aware chat. Sends `{agentId, instruction}` to `/api/chat` via a client-side `AbortController` — no section selection required. While the request is in flight: the send control is disabled (no concurrent chat turns for one agent), every section's raw-edit entry point is disabled across the viz (interaction lock, §7), and a "Cancel" button is shown, calling `controller.abort()` (Rules Index #23) — cancelling releases the lock immediately, same as a normal response landing. On response, updates every returned section's content in the viz (re-render each changed block; untouched blocks don't re-render); conflicted sections re-render from the `content` the conflict response carries, no extra fetch. Ephemeral (in-memory) history — no persistence (TechDesign "Deferred"). |
| 4.5 | `lib/ai/chatMediator.ts` | Mediator caller: given the **whole agent's current content** (every section, fetched server-side, never from the client) + instruction + the compiled `CHAT_MEDIATOR_PROMPT` (Phase 0.7) + `renderBlueprintForPrompt()`, returns `{ sections: { [sectionKey]: string } }` — only the sections that changed. Enforces split-level demotion guardrail is in the prompt; server double-checks **each returned section's** output contains no heading at `agent.splitLevel` and demotes if found (defense-in-depth on Rules Index #3). |
| 4.6 | *(no new file)* | The chat mediator's compiled prompt (`CHAT_MEDIATOR_PROMPT`) was already generated in Phase 0.7 alongside the converter's — nothing new to build here, kept as a row only so the phase's file list stays in sync with the original numbering. |
| 4.7 | `app/api/chat/route.ts` | `POST` — **server loads the whole agent** (all current sections + each section's current `version` as the request's baseline), calls `lib/ai/chatMediator` passing the Route Handler's `request.signal` through to the Anthropic SDK call (Rules Index #23 — an aborted client request stops the upstream call too), and for **each** `sectionKey` the mediator returned, writes via `repository.updateSectionContent(..., author:'ai', expectedVersion: <that section's baseline>)` (appends one `ai` revision per changed section; a section whose version moved since baseline — e.g. a manual edit landed mid-turn — conflicts independently, so one section conflicting doesn't block the others from applying). Returns `{ sections: { [sectionKey]: {content, version} \| {conflict:true, current:number, content:string} } }` — the conflict case carries the section's **current** content too (the server already read it to detect the mismatch), so the client re-renders in one round trip instead of issuing a follow-up `GET`. Holds the key. No tools exposed. (Rules Index #7.) |
| 4.8 | `app/api/agents/route.ts` + `app/api/agents/[id]/route.ts` | CRUD: `GET` list, `GET` one (full DTO), `POST` create (seeds core sections from `SectionDef.isCore` templates), `PATCH` (name/description/config), `DELETE`. Section-level `PATCH` for manual content edits (author `user`) lives under `[id]/sections/[sectionId]`. |

**Gate 4 (core loop proven):** open the app → `dev` renders in the center pane with its
config + 4 sections and its two validation flags → type "tighten the guardrails" (no
section selection) → mediator rewrites the Guardrails section only, since that's all the
instruction required → viz re-renders that block, others untouched → a
`SectionRevision(author:'ai')` row exists for Guardrails only → export still round-trips (no
fabricated split-level heading). **This is the reason-to-open-the-app loop working end to
end.**

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
- `AgentSnapshot` is whole-agent, not per-section — it's a separate concern from
  `SectionRevision` (which is per-section and drives the chat/manual-edit history). It exists
  to answer "what did the *entire* agent look like right before vs. right after an
  import," which reconstructing from many `SectionRevision` rows would make awkward. Only
  `'pre-import'`/`'post-import'` are wired in this plan (§5, import route); `'export'` is
  reserved for when the export route is built in a later plan — no schema change will be
  needed then, just one more write site. The diff-view UI that reads these snapshots is a
  future feature, out of scope here.
- `agent.platform` is deliberately **not** a closed DB enum (unlike `source`, which really is
  a fixed dichotomy forever) — its allowed values live in the `PLATFORM_DEFS` catalog (§4),
  same openness pattern as `sectionKey`/`propKey`. Only `'claude'` exists as a catalog entry
  in this plan; adding Copilot/other platforms later is a data change, not a migration.
  `ConfigDef` (the `model`/`tools`/etc. catalog) is **not** scoped per-platform in this plan —
  it's implicitly Claude-shaped today, which is fine since this plan only creates/imports
  Claude agents. Platform-scoping `ConfigDef` is a new Deferred Decision (TechDesign.md Rules
  Index), triggered when a second platform's import/create is actually being built.

---

## 4. Seed data shape (`lib/blueprint/catalog.ts` → `lib/db/seed.ts`)

The catalog arrays live in code (`lib/blueprint/catalog.ts`) so the Blueprint rules and the
DB seed read **one** source. `seed.ts` just inserts them idempotently.

### PlatformDefs (not a DB table — `agent.platform`'s allowed-values catalog)

```ts
export const PLATFORM_DEFS = [
  { key: 'claude', label: 'Claude' },
] as const;
```
- This is the catalog behind `agent.platform` (§3) — a plain array, not a `platformDef` table,
  since nothing else currently needs to join against it (unlike `ConfigDef`/`SectionDef`,
  which back real per-agent value rows). Adding Copilot/other platforms later means adding an
  entry here plus building their export serializer — no schema migration.
- Every agent created or imported in this plan is stamped `platform: 'claude'` — it's the
  only entry that exists. `ConfigDef` stays implicitly Claude-shaped (see §3 notes); it does
  **not** read from or branch on this catalog yet.

### ConfigDef seed (frontmatter catalog)

```ts
export const CONFIG_DEFS = [
  { key: 'model',          label: 'Model',           datatype: 'enum', isCore: true,  required: false,
    allowedValues: ['claude-opus-4-8','claude-sonnet-5','claude-haiku-4-5-20251001','claude-fable-5','inherit'] },
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
- **D4 resolved:** `model.allowedValues` is **full model IDs only** (`claude-opus-4-8`,
  `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-fable-5`), not short aliases
  (`opus`/`sonnet`/`haiku`/`fable`) — an imported agent using a short alias will simply be
  flagged outdated/unrecognized rather than treated as valid shorthand. `'inherit'` is kept
  in the list for now (it's a real, meaningful frontmatter value — "use the caller's model,
  don't override" — not itself a model ID), but flagged for revisit: is `'inherit'` really
  an `allowedValues` member of `model`, or should it be modeled as "no value set" instead?
  Tracked as a new Deferred Decision (see TechDesign.md Rules Index).

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
  `template`, and write revision #0 `author:'scaffold'` for platform-created sections
  (D5, resolved) — distinct from `'import'` (came from a file) and `'user'` (a human typed
  it), since neither is true of template-filled scaffold content.

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
  platform: string;                   // e.g. 'claude' — PLATFORM_DEFS catalog (§4), open set
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
| `POST` | `/api/agents/import` | none (local) | `{ md: string }` (raw file text) | `AgentDTO` (new or updated) | `400` bad `.md`; `422` Stage-2 AI returned content-bearing/invalid JSON; `502` Anthropic failure | Creates/updates `Agent` (+ zones), captures `rawSourceSnapshot`, writes `import`/`reimport` revisions; re-import deletes absent sections; writes `AgentSnapshot(pre-import)` (if updating) + `AgentSnapshot(post-import)` (always) |
| `GET` | `/api/agents` | none | – | `AgentDTO[]` (lite: no sections) | – | none |
| `GET` | `/api/agents/[id]` | none | – | `AgentDTO` (full) | `404` | none |
| `POST` | `/api/agents` | none | `{ name, description }` | `AgentDTO` | `409` name exists; `400` invalid body | Creates agent + core sections from templates; revision #0 per section, `author:'scaffold'` |
| `PATCH` | `/api/agents/[id]` | none | `{ name?, description?, config?: {propKey,value}[] }` | `AgentDTO` | `404`; `409` name collision | Upserts config rows; name stored verbatim (flag, don't block) |
| `DELETE` | `/api/agents/[id]` | none | – | `{ ok: true }` | `404` | Deletes agent + its config/sections; **`SectionRevision` rows retained** (soft ref) |
| `PATCH` | `/api/agents/[id]/sections/[sectionId]` | none | `{ content, expectedVersion }` | `{ content, version }` | `404`; `409` version mismatch (R4) | Overwrites content; appends `user` revision; bumps version |
| `POST` | `/api/chat` | none | `{ agentId, instruction }` | `{ sections: { [sectionKey]: {content, version} \| {conflict:true, current, content} } }` | `404`; `502` Anthropic failure | **Server scopes to `agentId`**, loads every section's current content + version server-side, mediator rewrites whichever section(s) the instruction requires, appends one `ai` revision per changed section, per-section version check (conflicting sections reported individually, others still apply), split-level demotion double-checked per section |

**`POST /api/chat` — the contract in detail (Draft D, MVP):**
- Request carries only `agentId` + `instruction` — **no section selection**. The **server
  re-loads every section's current content + version from the DB** (never trusts
  client-supplied content) and passes the whole agent + instruction to the mediator
  (Rules Index #7).
- Non-streaming (single JSON response). Apply-then-history: each changed section's rewrite
  is applied immediately and its pre-edit content is already the prior revision (revert =
  read + write per section, no separate "undo" endpoint needed for MVP).
- Response returns, per changed `sectionKey`, either the new `{content, version}` or a
  `{conflict:true, current, content}` if that section's version moved since the server's
  baseline read (e.g. a manual edit landed mid-turn) — the `content` is the section's actual
  current state, included so the client can re-render it in this same round trip rather than
  issuing a follow-up `GET`. The client swaps each successfully-updated block and surfaces
  conflicts individually; one section conflicting doesn't roll back the others.
- The mediator has **no tools**; the route exposes none.

**Error-handling policy (all routes):**

| Scenario | HTTP | Response shape | Logged? |
|---|---|---|---|
| Malformed request body | 400 | `{ error, field? }` | no |
| Not found | 404 | `{ error: 'not_found' }` | no |
| Optimistic version conflict (`PATCH .../sections/[sectionId]`, single section) | 409 | `{ error: 'version_conflict', current: number }` | no |
| Optimistic version conflict (`POST /api/chat`, per section) | 200 (not an error) | reported per `sectionKey` as `{conflict:true, current, content}` inside the normal response — other sections still applied | no |
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
   `AgentSnapshot` rows follow the same soft-ref pattern against `agentId`.
5. The AI key never appears in any client bundle, response body, or log (Principle #8).
6. A section's `content` never contains a heading at the agent's `splitLevel` after a
   mediator/manual write (demoted if it would — Rules Index #3).
7. Every `/api/agents/import` call writes exactly one `AgentSnapshot(kind:'post-import')`,
   plus one `AgentSnapshot(kind:'pre-import')` if-and-only-if the agent already existed
   (first-time import gets post only) — Rules Index #15.

**Policies (configurable / catalog-driven):**
8. `ConfigDef.allowedValues` drives both dropdowns and validation flags; editing the seed
   updates both with no code change.
9. `name` stored verbatim; `nameSpecViolation` flag computed; normalized only on explicit
   user action (Rules Index #1).
10. Missing `description` on import ⇒ placeholder + `descriptionMissing` flag (Rules Index #12).
11. Unknown `propKey`/`sectionKey` always stored, rendered, exported (no FK openness).
12. Chat and manual raw-edit are mutually exclusive per agent, client-enforced (interaction
    lock, Rules Index #22) — the per-section version check (§7) remains the real backstop;
    the client-side lock is not trusted as the only protection.

**State transitions (sequences):**
13. **Import:** Stage 1 deterministic capture → Stage 2 AI labels-only → server reassembles
    bytes → repository upserts → revisions written (`import` first-time / `reimport` on
    collision).
14. **Re-import collision:** existing `name` ⇒ update-in-place; changed section overwritten +
    `reimport` revision; new section created + `reimport` revision #0; absent section deleted
    (revisions retained). Never duplicate, never hard error (Rules Index #11a/#11b). The
    whole-agent before/after state is additionally captured as `AgentSnapshot(pre-import)` /
    `AgentSnapshot(post-import)` (rule 7) — this is separate from, and does not replace, the
    per-section `SectionRevision` log.
15. **Chat edit:** type instruction (no section selection, interaction lock engaged, rule 12)
    → server-scoped-to-agent mediator call over every current section → mediator returns
    only the section(s) it changed → apply + one `ai` revision + version bump **per changed
    section** (per-section conflict check against the server's baseline read) → viz
    re-renders each changed block only.
16. **Manual edit:** structured-view save → `user` revision + version bump (frequency policy
    deferred, Rules Index #14 — see §9).

---

## 7. Draft D (resolved for MVP) — mediator ↔ UI contract

DesignReview blind spot #2 flagged this as undrafted and "the hardest engineering." The MVP
resolution, kept deliberately minimal so the core loop is buildable and richer UX layers on
without schema change:

- **Turn shape:** one instruction → the mediator sees the **whole agent** (every current
  section) and rewrites whichever section(s) the instruction actually requires — often one,
  sometimes two or three (D2, resolved 2026-07-26). `SectionRevision` stays the per-section
  *log*; it is not the edit *boundary*. No section-selection step in the UI.
- **Streaming:** **no** for MVP (single JSON response) (D1, confirmed 2026-07-26). Streaming
  is additive later (swap the route to a stream; the viz already re-renders per-block).
- **Apply model:** **apply-then-history**, not propose-then-preview (D1, confirmed). Each
  changed section's rewrite lands immediately; its prior state is already the last
  `SectionRevision`, so recovery is a revert-read per section. (Propose-preview is a UX
  upgrade addable later with no data change.)
- **Scoping:** the **server** loads the whole agent (all sections + each section's current
  `version` as baseline) server-side; the mediator is told the whole agent, never trusts
  client-supplied content, and has no tools (Rules Index #7, re-scoped 2026-07-26 — was
  "scoped to one `sectionId`," see TechDesign.md's note on #7's supersession for why
  widening this didn't cross a line the original guardrail hadn't already accepted).
- **Per-section conflict handling:** a section whose version moved since the server's
  baseline read (e.g. a manual edit landed mid-turn) is reported as `{conflict:true,
  current}` for that `sectionKey` only — it does not block the other changed sections from
  applying.
- **Safety net:** server post-checks **each returned section's** output for a heading at
  `agent.splitLevel` and demotes it before writing (defense-in-depth on the prompt-level
  guardrail, Rules Index #3).
- **Interaction lock (added 2026-07-26, Rules Index #22):** chat and manual raw-edit are
  **mutually exclusive per agent**, client-side. While a chat request is in flight, every
  section's raw-edit entry point is disabled and a second chat instruction can't be sent.
  While a section's raw-edit mode has unsaved changes, chat is disabled for that agent. This
  is UI-level prevention, not a substitute for the per-section version check above — the
  server never trusts the client actually enforced this (a second tab, or a bug, could still
  race), so the version check stays as the real defense-in-depth backstop.
- **Cancellation (added 2026-07-26, Rules Index #23 — built now, not deferred):** the
  `ChatPanel` fires `/api/chat` with a client-side `AbortController` and shows a "Cancel"
  button while the request is in flight. `app/api/chat/route.ts` passes the Route Handler's
  own `request.signal` through to the Anthropic SDK call (`client.messages.create(..., {
  signal })`), so an aborted request also stops the upstream call, not just the client-side
  wait. Safe by construction with apply-then-history: nothing is written until the
  mediator's response fully resolves, so cancelling at any point simply never reaches the
  write step — no DB write, no revision, nothing to revert. Cancelling immediately releases
  the interaction lock (rule 12) — chat and raw-edit become available again right away,
  same as a normal response landing.

**Future feature, explicitly deferred (not built in this plan):**
- **Propose-preview: show the diff before applying** (Rules Index #24) — formalizes D1's
  original "addable later with no data change" note. The mediator's returned sections would
  be held client-side (or server-side, unpersisted) until an explicit "Apply" action; only
  then does the existing apply-then-history write path run. No schema change needed — this
  is purely an added confirmation step in front of the write that already exists.

Escalated to §9 originally: whether to upgrade to streaming + propose-preview before
dogfooding (D1), and whether to allow multi-section edits (D2). **Both resolved 2026-07-26:**
D1 keeps the MVP default (non-streaming, apply-then-history); D2 opens the mediator to the
whole agent, exactly as described above.

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
  (no divergent second copy). **D4 test:** a `model` value not in the current full-ID list
  (e.g. a short alias like `"sonnet"`, or a retired ID) is flagged outdated/unrecognized, not
  silently accepted.
- `lib/db/repository`: create→read round-trip; every content write appends exactly one
  revision; optimistic-version conflict throws; delete retains `SectionRevision` rows.
  **D5 test:** `createAgent` seeds core sections with `SectionRevision(author:'scaffold')`,
  never `'user'`. **Platform test:** a created or imported agent's `platform` column is
  `'claude'` by default.
- `lib/import/assemble`: with a mocked Stage-2 label map, assembled `dev` exports to a form
  that round-trips; re-import changed/added/removed section behavior (Rules Index #11).
- `scripts/build-prompts`: **D6/Rules Index #25 test** — for both `import-instructions.md` and
  `chat-mediator.md`, asserts the build script finds the first `##` heading, strips
  everything before it, and the generated constant contains that file's locked guardrail
  lines verbatim — catches a doc restructure silently breaking the compiled prompt before
  it ever reaches a running server.

**Integration (route-level, mocked Anthropic):**
- `/api/agents/import` with a canned Stage-2 response → agent persisted, DTO shape correct,
  `rawSourceSnapshot` captured. **`AgentSnapshot` test (rule 7):** first-time import writes
  exactly one `AgentSnapshot(post-import)` and no `pre-import`; a re-import of an existing
  `name` writes exactly one `pre-import` (matching the prior exported state) **and** one
  `post-import` (matching the new state).
- `/api/chat` scoping: request with a bogus/foreign `agentId` is rejected; server uses DB
  content for every section, not client-supplied; a mediator response touching two sections
  bumps both their versions and writes two `ai` revisions; a mediator response containing
  `# Heading` is demoted before persistence, checked per returned section; a section whose
  baseline version moved mid-turn reports `{conflict:true}` for that section only, other
  changed sections still apply. **Cancellation test (#23):** aborting the request mid-flight
  (mocked Anthropic call never resolves, signal fires) results in zero DB writes, zero new
  `SectionRevision` rows, and no version bump on any section of that agent.
- `/api/agents` CRUD happy paths + `409` name collision.

**End-to-end (manual, Gate 4 checklist for @dev):**
1. `db:seed` + import `dev.md` → app shows `dev` with config + 4 sections + 2 validation
   flags (outdated model, tool bloat).
2. Send "tighten the guardrails" (no section selection) → only the Guardrails block
   changes, since that's all the instruction required.
3. A `SectionRevision(author:'ai')` row now exists for that section (and only that one).
4. Export `dev` → round-trips (no fabricated section from an in-content heading).
5. Re-import a hand-edited `dev.md` → updates in place, `reimport` revision appears, no
   duplicate agent.
6. **Interaction lock (#22):** while a chat instruction is in flight, confirm raw-edit is
   disabled on every section and the send control is disabled; open raw-edit on a section
   with unsaved changes, confirm chat is disabled until saved/cancelled.
7. **Cancellation (#23):** send a chat instruction, click "Cancel" mid-flight, confirm no
   section changes, the lock releases immediately, and chat/raw-edit are usable again.

**Special setup:** golden fixtures are committed copies of the 15 agents
(`lib/serialize/__tests__/fixtures/`) so tests are hermetic. Anthropic is **mocked** in all
automated tests — no real key in CI. A single seeded `dev` agent is the E2E fixture.

---

## 9. Decisions needed (surface before / during build)

These are genuine product/UX decisions, not implementation gaps — @dev should not invent
them. None block Phases 0–3; D1/D2 are needed before Phase 4 chat UX is finalized.

1. **D1 — Mediator UX depth (Draft D upgrade). RESOLVED (2026-07-26):** keep the MVP default
   — non-streaming, apply-then-history. Revert is already safe via `SectionRevision`;
   revisit only if latency becomes a felt problem once real usage starts.
2. **D2 — Multi-section edits in one chat turn. RESOLVED (2026-07-26):** the mediator is
   scoped to the **whole agent**, not one section (Rules Index #7, re-scoped) — a single
   instruction may rewrite several sections in one turn if it genuinely requires it.
   `SectionRevision` remains a per-section *log*; it is no longer the edit *boundary*. See
   §7 Draft D and TechDesign.md's note on #7's supersession for the full reasoning.
3. **D3 — Manual-save revision frequency (Rules Index #14).** When the structured-view
   manual-edit flow is built (after this plan), decide: append a `user` revision on every
   save, or debounce to edit boundaries (blur / explicit save). Default assumed: on explicit
   save/blur.
4. **D4 — `model` `allowedValues` authoritative list. RESOLVED (2026-07-26):** full model IDs
   only — `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-fable-5`
   — not short aliases. `'inherit'` kept for now (see Rules Index #19, flagged for revisit:
   whether `'inherit'` belongs in `allowedValues` at all vs. being modeled as "no value set").
   **Future feature (Rules Index #20, deferred):** the UI should eventually display a short
   label ("Opus", "Sonnet") instead of the raw full ID, via a display-only label lookup —
   storage stays the full ID regardless, this is presentation only, not a new allowed value
   or a second way to store `model`. Not built in this plan: the UI renders the full ID
   verbatim for now.
5. **D5 — Revision author for a section created directly in the platform. RESOLVED
   (2026-07-26):** added a fifth `SectionRevision.author` enum value, **`'scaffold'`**
   (§3), distinct from `'import'`/`'reimport'` (file-origin) and `'user'` (a human typed
   it) — template-filled platform-created content is neither. See Rules Index #21.
6. **D6 — Prompt-file source of truth. RESOLVED (2026-07-26):** no separate `.txt` copy, and
   no runtime file read either. `design/system-agents/*.md` is the one and only place the
   rules are ever reviewed or edited; `scripts/build-prompts.ts` (Phase 0.7) compiles both
   `.md` files into plain string constants at **build time** (`predev`/`prebuild`), strips
   the title/blockquote. The running server never touches `design/` at all — no filesystem
   read at request time or server start, and the generated output isn't committed (always
   regenerated from the one source). Drift between two copies is impossible by construction.
   See Rules Index #25.

---

## 10. Risks per phase & mitigation

| Phase | Risk | Mitigation |
|---|---|---|
| 1 | Golden test fails on a real agent (e.g. Aria's 557 lines, an unclosed fence) — the invariant genuinely doesn't hold. | This is the *point* of doing it first. Fix the spec/parser before any DB/UI is built on top (the DesignReview's entire thesis). Each failing agent is a cheap fix now, a migration later. |
| 2 | EAV DTO assembly (agent + config + sections + defs) is fiddly / N+1. | One `getAgentFull` query per agent is the only hot path (Review "leave alone"); load all zones for one agent in a few queries and assemble in the repository. |
| 3 | Stage-2 AI returns content or malformed JSON. | Hard schema check in `importConverter.ts` → `422`; server always reassembles bytes from Stage 1 regardless (Rules Index #5). Loss is impossible by construction. |
| 3 | Prompt drift risk. **Resolved by construction (D6):** no second hand-maintained copy exists — `scripts/build-prompts.ts` compiles `design/system-agents/*.md` at build time, never committed, always regenerated. Residual risk: the strip transform (title/blockquote removal) silently breaks if the doc's structure changes unexpectedly. | Test asserts the build script finds the first `##` heading in each `.md` and the generated constant contains the locked guardrail lines (Rules Index #25). |
| 4 | Mediator's blast radius widened (D2): one instruction may now rewrite several sections in a single turn, not just one — a misinterpreted or (in principle) injected instruction has more surface to touch than before, since the mediator reads the whole agent's content, not one isolated section. | No new capability was added — still no tools, still can't reach anything outside this one agent. Split-level heading guardrail still checked per returned section; every section is still independently one `SectionRevision` revert away, regardless of how many changed in one turn. This matches the original design review's own accepted worst case ("the model corrupts the user's own agent," not "one section of it") — see `TechDesign.md`'s note on Rules Index #7's supersession. Re-audit still required once sharing/forking (build-order #5) makes imported foreign agents untrusted input to system prompts. |
| 4 | Concurrent edit clobbers (typing while AI rewrites, or two chat turns overlapping). | **Primary defense: the interaction lock (#22)** — chat and manual raw-edit are mutually exclusive per agent, client-side, so this race shouldn't occur in normal single-tab use. **Backstop: per-section `version` optimistic check** (R4) — a section whose version moved since the server's baseline read reports `{conflict:true, current, content}` for that section only; other changed sections still apply, client re-renders from the returned content, no extra fetch. |
| 4 | Key leakage into a client bundle. | `lib/env.ts` + `lib/db/client.ts` + `lib/ai/client.ts` all `import 'server-only'`; pre-commit key-safety check (Principle #8). |

---

## 11. Parallelization & dependencies

- **Strictly serial gates:** Phase 1 (round-trip) must be green before Phase 2; Phase 2
  before Phase 3; Phase 3 before Phase 4 (Phase 3 produces the seeded agent Phase 4 renders).
- **Parallelizable within phases:**
  - Phase 0: **0.7 (`scripts/build-prompts.ts`) has no dependency on 0.1–0.6** — its only
    input is `design/system-agents/*.md`, which already exists. Found during this review:
    it must not be sequenced *after* 0.1, since 0.1's `predev`/`prebuild` hook needs it to
    already exist for `npm run dev` to boot at all (Gate 0). Build it early in Phase 0, not
    as an afterthought once Phase 3 needs it.
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
| 7 (mediator server-scoped to whole agent, no tools) | `/api/chat` loads every section server-side, mediator rewrites only what's needed, no tools (Phase 4.5/4.7) |
| 8a (repository layer, conservative types) | `lib/db/repository/*` sole DB surface; text/int/JSON-as-text (§3) |
| 9 (blueprint = data + rule fns) | `lib/blueprint` single module (Phase 1.1–1.4) + Review#4 test |
| 10 (SectionRevision from import onward) | `sectionRevision` table + repo appends on every write (§3, Phase 2.6) |
| 11a/11b (re-import update-in-place / delete-absent) | `upsertAgentFromImport` + `/api/agents/import` (Phase 3.5, §6 rule 14) |
| 12 (missing description → placeholder+flag) | `assemble.ts` + `computeValidation` (Phase 3.4, R2) |
| 15 (AgentSnapshot pre/post-import) | `agentSnapshot` table + `/api/agents/import` writes both kinds (§3, Phase 3.5) |
| 17 (Agent.platform open catalog) | `agent.platform` column + `PLATFORM_DEFS` catalog, defaulted `'claude'` (§3/§4) |
| 19 (model.allowedValues = full IDs) | `CONFIG_DEFS.model.allowedValues` (§4, D4) |
| 21 (SectionRevision.author adds 'scaffold') | `sectionRevision.author` enum widened; seed writes `author:'scaffold'` for platform-created sections (§3/§4, D5) |
| 22 (chat/manual-edit interaction lock) | `ChatPanel`/`SectionBlock` mutual exclusion, client-side; version check remains the real backstop (Phase 4.3/4.4, §6 rule 12, §7) |
| 23 (mediator-call cancellation) | `ChatPanel` `AbortController` + `request.signal` passed to the Anthropic SDK call (Phase 4.4/4.7, §7) |
| 25 (prompt-file single source of truth) | `scripts/build-prompts.ts` compiles `design/system-agents/*.md` at build time, no `.txt` copy, no runtime file read (Phase 0.1/0.3/0.7, §9 D6) |
| 8b, 13, 14, 16, 18, 20, 24 | **Deferred** (Rules Index) — not built in this plan; 14 noted in §9 D3, 16 is the export-kind capture + diff-view UI, 18 is per-platform `ConfigDef` scoping, 20 is the model display-label lookup, 24 is propose-preview |
