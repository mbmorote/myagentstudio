# Agent Workbench — Technical Design

> The **how**. Companion to `Concept.md` (the what/why). This doc evolves as we build;
> the concept doc stays stable. Start here for data model, stack, and implementation.

## Design principles

These constrain every decision below.

1. **Platform is master.** The structured data in the platform is the source of truth.
   `.md` files are an *export target*, not the storage format.
2. **Structured-first, serialize on export.** Agents are stored as structured data
   (typed frontmatter + ordered body sections), and rendered to `.md` only when
   exporting. Importing an `.md` parses it back into structure.
3. **Lossless round-trip.** Import → edit → export must not silently drop anything.
   Unknown frontmatter keys and unrecognized body sections are preserved verbatim.
4. **Spec-clean export.** Exported Claude agents contain only official frontmatter
   fields. Platform-only concepts (groups, internal ids) never leak into the file.
5. **Two zones** (from Concept): **Config** = frontmatter (official, typed, enumerable);
   **Sections** = body (opinionated section template over a free-form system prompt).
   Both zones use the **same pattern**: a predefined catalog + per-agent values, with
   custom/unknown always allowed (no FK).
6. **Ship the MVP small, keep doors open.** Model for what's coming (nesting, going online)
   without building it yet.
7. **AI key — single local key for dev.** The MVP uses **one API key in a local config /
   `.env`, read server-side, on my machine only** — not online, no key-entry UI, no
   billing. This is neither "hosted" nor "BYOK" (Bring Your Own Key) as a feature; both of
   those are *later* choices for when the app goes online, and both grow from the same core
   (server makes an AI call with a key), so deciding later costs nothing.
8. **🔒 Never leak the key (permanent rule).** The AI key stays **server-side only** — never
   in frontend/browser code, never in an artifact, never committed to git (`.env` is
   git-ignored). **Before every commit / share / deploy, check the key isn't exposed** (not
   hardcoded, not in client bundles, not in logs, not in committed config). This rule holds
   from day one, while it's just me, so it's already habit the day the app goes online.
9. **Import is AI-assisted; export is deterministic.** Messy real-world input needs
   intelligence to map onto the model; clean structured data needs only rules to write out.
   See *The Agent Blueprint* and Drafts A/B.
10. **🛟 Safe conversion (permanent rule).** Import **never deletes or changes content** —
    it only *maps* content onto the Blueprint. If a piece can't be mapped, it becomes
    `custom`, verbatim. Loss/rewording is impossible by construction, so Principle #3
    (lossless) holds even though an AI is in the loop.

## Rules Index

One level more concrete than the 10 Design Principles above: every specific rule that came
out of the pre-build review (`design/DesignReview.md`), in one scannable ledger — what it
is, where it actually lives, and whether it's settled. **Check this table before building
the Blueprint** — that's exactly what it's for. Keep it updated every time a new finding is
folded in or a new rule is added.

**Type** tells you where a rule *should* live: **Schema/Parsing/Infra** facts belong in this
doc; **AI guardrail** rules belong in the relevant `design/system-agents/*.md` file (see
*System agents vs. user agents* below for why).

| # | Rule | Type | Lives in | Status | Source |
|---|------|------|----------|--------|--------|
| 1 | `Agent.name`: flag-don't-block, never silently rewritten on import | Schema/validation | `TechDesign.md` § Entity `Agent` | ✅ Locked | Review 1c |
| 2 | `AgentSection.heading` nullable — represents the headingless preamble | Schema | `TechDesign.md` § Entity `AgentSection` | ✅ Locked | Review 1b |
| 3 | Section content must never contain a heading at the agent's split level | AI guardrail (mediator) | `system-agents/chat-mediator.md` § Guardrails #2 | ✅ Locked | Review 1a |
| 4 | Frontmatter parsed string-preserving (no YAML scalar coercion); comments explicitly lost | Parsing (deterministic) | `TechDesign.md` § Draft B | ✅ Locked | Review 1d |
| 5 | Stage 2 AI output = labels only, `{blockId → sectionKey}` — never content | AI guardrail (converter) | `system-agents/import-converter.md` § Guardrails #1 | ✅ Locked | Review 2 |
| 6 | Merges are `{blockIds → label}`, never rewritten text | AI guardrail (converter) | `system-agents/import-converter.md` § Guardrails #2 | ✅ Locked | Review 2 |
| 7 | Mediator scoped to one server-chosen **agent** (may rewrite any number of its sections in one turn); no tools | AI guardrail (mediator) | `system-agents/chat-mediator.md` § Guardrails #1, #3 | ✅ Locked (superseded 2026-07-26 — was "scoped to one `sectionId`"; see below) | Review 7; re-scoped Plan 01 review, 2026-07-26 |
| 8a | All DB access goes through a repository layer, conservative column types | Infra/stack | `TechDesign.md` § Draft C | ✅ Locked | Review 3 |
| 8b | Storage target dialect (Postgres vs. Azure SQL) | Infra/stack | `TechDesign.md` § Draft C | 🟡 Deferred — no code impact until migration is real | Review 3 |
| 9 | Blueprint = one module exporting data **and** rule functions (name validation, heading render) | Architecture | `TechDesign.md` § Blueprint | 🟢 No debate — apply when `lib/blueprint` is written | Review 4 |
| 10 | `SectionRevision`: append-only history from **import onward** (not just AI edits) — `import`/`user`/`ai` authorship | Schema | `TechDesign.md` § Entity `SectionRevision` | ✅ Locked | Review 5 (extended) |
| 11a | Re-import collision = always update-in-place, never duplicate/error; new revision tagged `author: "reimport"` | Schema/product | `TechDesign.md` § `SectionRevision` + § Draft A | ✅ Locked | Review 6 |
| 11b | Section removed from the incoming file on re-import → **just delete it**, no confirm — `SectionRevision` isn't cascade-deleted, so history survives regardless | Schema/product | `TechDesign.md` § `SectionRevision` + § Draft A | ✅ Locked | Review 6 |
| 14 | Does every manual save append a `SectionRevision`, or debounce to meaningful edit boundaries only | Product/UX | *(not yet added)* | ⬜ Deferred — decide when building the manual-edit save flow | New (not from review) |
| 12 | Missing `description` on import = placeholder + validation flag | Schema/validation | `TechDesign.md` § Entity `Agent` | ✅ Locked | Review 7 |
| 13 | Catalog evolution: distinguish "never known" vs. "was known, catalog changed" | Validation | *(not yet added)* | ⬜ Deferred — needs catalog versioning, doesn't exist yet | Review 7 |
| 15 | `AgentSnapshot`: whole-agent (not per-section) exported-markdown capture on import — `pre-import`/`post-import`, soft-ref to `agentId`, never cascade-deleted | Schema | `TechDesign.md` § Entity `AgentSnapshot`; `plans/01-core-loop-implementation-plan.md` § 3 | ✅ Locked | Plan 01 review, 2026-07-26 |
| 16 | `AgentSnapshot(kind:'export')` capture point + the diff-view UI that reads pre/post snapshots | Product/UX | *(not yet added)* | ⬜ Deferred — needs the export route (later plan); schema already supports it, no migration needed | Plan 01 review, 2026-07-26 |
| 17 | `Agent.platform`: open catalog (`PlatformDefs`), not a DB enum; only `'claude'` exists now | Schema | `TechDesign.md` § Entity `Agent`; `plans/01-core-loop-implementation-plan.md` § 3/§4 | ✅ Locked | Plan 01 review, 2026-07-26 |
| 18 | `ConfigDef` platform-scoping (a `model`/`tools` catalog per platform, not one global catalog) | Schema | *(not yet added)* | ⬜ Deferred — `ConfigDef` stays implicitly Claude-shaped until a second platform's import/create is actually built | Plan 01 review, 2026-07-26 |
| 19 | `model.allowedValues` = full model IDs only, no short aliases; `'inherit'` kept for now | Schema/seed | `plans/01-core-loop-implementation-plan.md` § 4 (D4) | ✅ Locked (list itself); ⬜ `'inherit'`'s membership in the list is flagged for revisit | Plan 01 review, 2026-07-26 |
| 20 | UI displays a short label ("Opus") instead of the raw full model ID — display-only, storage stays the full ID | Product/UX | *(not yet added)* | ⬜ Deferred — not built in this plan; UI renders the full ID verbatim until this lands | Plan 01 review, 2026-07-26 |
| 21 | `SectionRevision.author` gets a fifth value, `'scaffold'`, for platform-created (not imported) section revision #0 — distinct from `import`/`reimport`/`user`/`ai` | Schema | `TechDesign.md` § Entity `SectionRevision`; `plans/01-core-loop-implementation-plan.md` § 3/§4 (D5) | ✅ Locked | Plan 01 review, 2026-07-26 |
| 22 | Chat and manual raw-edit are mutually exclusive per agent, client-enforced (interaction lock) — UI-level prevention only; the per-section version check remains the real backstop | Product/UX | `plans/01-core-loop-implementation-plan.md` § 6 rule 12, § 7 | ✅ Locked | Plan 01 review, 2026-07-26 |
| 23 | Cancellation token for an in-flight mediator call: client `AbortController`, `request.signal` propagated to the Anthropic SDK call. Safe by construction (apply-then-history means nothing is written until the mediator fully responds) | Product/UX | `plans/01-core-loop-implementation-plan.md` § 7, Phase 4.4/4.7 | ✅ Locked | Plan 01 review, 2026-07-26 |
| 24 | Propose-preview: show the mediator's proposed section changes and require explicit "Apply" before the write lands (formalizes D1's original "addable later" note) | Product/UX | *(not yet added)* | ⬜ Deferred — not built in this plan; no schema change needed when it lands | Plan 01 review, 2026-07-26 |
| 25 | Prompt-file source of truth: `design/system-agents/*.md` is the only copy of a system agent's rules, ever. `scripts/build-prompts.ts` compiles both into plain string constants at **build time** (`predev`/`prebuild`), strips title/blockquote; the running server never reads `design/` at all — no `.txt` duplicate, no runtime filesystem access, output gitignored and always regenerated | Architecture | `plans/01-core-loop-implementation-plan.md` § 9 (D6), Phase 0.1/0.3/0.7 | ✅ Locked | Plan 01 review, 2026-07-26 |

**Note on #7's supersession:** the original rule (Review 7, `DesignReview.md` finding 7,
"Injection surface") scoped the mediator to exactly one `sectionId` chosen by the server.
Rereading that finding's own reasoning: the rule was never about section-level granularity
being correct — it's blast-radius containment, and the finding's own words already accept
"worst case, the model corrupts the user's own agent" as tolerable for local single-user,
recoverable via `SectionRevision`. Widening the scope from one section to the whole agent
(so `SectionRevision` stays purely a per-section *log*, not the edit *boundary* — see D2,
Plan 01 review) doesn't cross a line that finding didn't already accept; the two guardrails
that actually bound the risk — **no tools**, **never fabricate a split-level heading** —
are unchanged. `DesignReview.md` itself is left untouched as the historical record of the
original, narrower reasoning; re-audit still applies when sharing/forking (build-order #5)
makes imported foreign agents untrusted input to system prompts.

## Data model

### Overview

```
Group ──< Membership >── Agent ──< AgentConfig >·· ConfigDef    (·· = soft lookup by key, NO FK)
  │                        │
  │                        └──< AgentSection >·· SectionDef  (·· = soft lookup by key, NO FK)
  └─ parentId (self, nullable)
```

**Symmetric by design.** An agent has two zones, each modeled the same way:

| | **Config** (frontmatter) | **Sections** (body) |
|---|---|---|
| Predefined catalog | `ConfigDef` | `SectionDef` |
| Per-agent values | `AgentConfig` | `AgentSection` |
| User action | **picks** from `allowedValues` | **writes** from a `template` |
| Custom/unknown | any `propKey`, no FK | any `sectionKey`, no FK |

Both use **EAV** (Entity-Attribute-Value): rather than a column per field, each value is a
row (`AgentConfig` / `AgentSection`) softly linked to a catalog def by key. The two
spec-**required** fields (`name`, `description`) stay as real columns on `Agent` for
constraints + fast queries; everything else lives in the value tables.

### Entity: `Agent`

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | uuid | PK | internal — **never exported** |
| `name` | string | not null, unique | Config `name`. **Flag, don't block** (review finding 1c): stored verbatim even if not lowercase-hyphen (e.g. imported `Zara`); a `nameSpecViolation` validation flag surfaces it, normalized only on explicit user action. Blocking or silently rewriting on import both violate Principles #3/#10. |
| `description` | text | not null | Config `description`. **Missing on import → placeholder + a `descriptionMissing` validation flag** (review finding 12) — same flag-don't-block pattern as `name`, never a hard block. |
| `createdAt` / `updatedAt` | timestamp | not null | |
| `source` | enum | not null | `created` / `imported` — provenance |
| `platform` | string | not null, default `'claude'` | **Not a closed enum** — its allowed values live in the `PlatformDefs` catalog (plan §4), the same openness pattern as `propKey`/`sectionKey`. Only `'claude'` exists as a catalog entry today; Copilot/other platforms are added later as a catalog entry + export serializer, not a migration. Exists so "which platform is this agent's canonical shape modeled on" is queryable, distinct from *export* (translating to a different platform at export time — see Deferred: Export adapters, below). |
| `rawSourceSnapshot` | text \| null | | The **entire original `.md`** (frontmatter + body), byte-for-byte, captured once at import — independent of how Stage 2 sliced/labeled it into sections. This is the concrete home for Draft A's "the raw original is retained with the import" — previously a sentence with no schema behind it. Lets you always see literally what was imported, even if a Stage-2 mapping decision turns out wrong. `null` for agents created directly in the platform (no import to snapshot). |

---

## Zone 1 — Config (frontmatter)

### Entity: `ConfigDef` (the config catalog)

Defines *what* config props exist and how to render/validate each. Seed data from the
Anthropic spec; updatable as Anthropic evolves (so validation stays current without code
changes). **A lookup, not a gate** — see the no-FK rule below.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | PK |
| `key` | string | unique — the frontmatter key, e.g. `model`, `tools` |
| `label` | string | UI label |
| `datatype` | enum | `string` / `enum` / `int` / `bool` / `list` / **`any`** (freeform, no validation) |
| `allowedValues` | json \| null | options for `enum` / `list` (the dropdown source) |
| `required` | bool | |
| `isCore` | bool | show by default vs. "advanced" |
| `exportable` | bool default true | **deferred lever** — for a future known-but-platform-only prop. Today every def is `true`; unknown props default `true` too. Added now only if/when the first non-exporting prop appears. |

Seed excerpt: `model`(enum), `tools`(list), `permissionMode`(enum), `maxTurns`(int),
`skills`(list), `background`(bool), `effort`(enum). The `any` datatype backs deliberately
freeform slots.

### Entity: `AgentConfig` (per-agent config values — EAV)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `agentId` | uuid → Agent | not null | |
| `propKey` | string | not null | **free text — NO foreign key to `ConfigDef`** |
| `value` | json | not null | scalar **or** list: `"opus"` · `["Read","Edit"]` · `8` · `true` |

PK `(agentId, propKey)` — one value per prop per agent. The **JSON `value`** column is why
lists and scalars share one table and why there's no separate "bucket".

**Openness rules (the "never block me" guarantee):**
- **No FK on `propKey`.** Any invented key stores fine. The catalog only *enriches* a known
  key (label, dropdown, validation); it never rejects an unknown one.
- **Unknown `propKey` → treated as `datatype: any`** — generic input, no validation, still
  stored, still exported. This is the "add a config prop that isn't in the list" case,
  working automatically.
- **Deliberate freeform slot** — seed a `ConfigDef` with `datatype: any` when you want a
  known-but-unvalidated field to appear in the UI on purpose.
- **Deferred escape hatch:** a reserved `propKey = "__raw"` holding a verbatim YAML/text
  blob, appended untouched on export, for anything too messy to parse into key-value.
  Advanced/later — not built in the MVP.

**Worked example — the real `dev` agent:**

`Agent`: `{ id: a-01, name: "dev", description: "Use AFTER @architect…", source: imported }`

`AgentConfig`:
| agentId | propKey | value (JSON) |
|---|---|---|
| a-01 | `model` | `"claude-sonnet-4-6"` |
| a-01 | `tools` | `["Read","Edit","Write","Create","Bash","Grep","Glob","mcp", …]` |

Both surface the review feature for free: `"claude-sonnet-4-6"` isn't in `model`'s
`allowedValues` → flagged as outdated; `"Create"` isn't a standard tool → flagged as
unknown.

---

## Zone 2 — Sections (body)

Same pattern as Config, with one honest difference: config values are **picked** from a
closed set (`allowedValues` → a dropdown), but section content is **written** freeform
markdown. So `SectionDef`'s equivalent of "pre-defined options" isn't a value list — it's a
**`template`** (a pre-filled scaffold) plus **`helpText`** (what belongs here). That
scaffold is the "easy for non-experts" lever: never a blank box.

### Entity: `SectionDef` (the section catalog)

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | PK |
| `key` | string | unique — `role`, `behavior`, `guardrails`, `output`, `sources`, `lifecycle`, `handoffs`, `tone`, `modes` |
| `label` | string | UI label |
| `defaultHeading` | string | the rendered `# HEADING`, e.g. `# ROLE` |
| `isCore` | bool | seeded into every new agent vs. opt-in |
| `defaultOrder` | int | suggested position in the body |
| `template` | text (markdown) | **the pre-filled scaffold** — the "pre-defined option" for a section |
| `helpText` | text | editor guidance: what goes here, common traps |

Seed (core = ✅): `role`(✅,1), `behavior`(✅,2), `guardrails`(✅,3 → `# RULES`),
`output`(✅,4 → `# OUTPUT FORMAT`), then optional `sources`(5), `lifecycle`(6),
`handoffs`(7), `tone`(8), `modes`(9). Example `role.template`:
`"You are a [senior X] specializing in:\n- …\n\nYour job is to …"`

### Entity: `AgentSection` (per-agent section values — EAV)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | uuid | PK | |
| `agentId` | uuid → Agent | not null | |
| `sectionKey` | string | not null | **free text — NO foreign key to `SectionDef`** |
| `heading` | string | **nullable** (review finding 1b) | rendered `# HEADING`; for custom, the original text (lossless). `null` = a headingless block (e.g. Stage 1's pre-heading preamble) — export renders it as bare content, no invented heading. An invented heading would re-parse as a real section on next import, breaking the round-trip. |
| `content` | text (markdown) | | the section body |
| `order` | int | not null | render + export order |

**Openness rules — identical to Config:**
- **No FK on `sectionKey`.** A known key gets the def's template + helpText; an unknown one
  (`sectionKey = "custom"`, or the raw heading) still stores, renders, and exports.
- **New agent** → seed a `AgentSection` per `SectionDef` where `isCore = true`, in
  `defaultOrder`, pre-filled with `template`. No blank page.
- **Add optional section** → "+ Add section" menu populated from non-core `SectionDef`
  rows; picked section drops in with its template + helpText.
- **Custom section** → any heading the user types → `custom`, never blocked, lossless.
- **AI edits a section in place** → chat targets a `AgentSection.id` and rewrites its `content`;
  the structured view re-renders that one block. *This is why the body is rows, not a blob.*
- The full `.md` body = `AgentSection` rows by `order`, each as `# {heading}` + content.

### Entity: `SectionRevision` (append-only edit history — review finding 5, extended)

**Why it exists:** the mediator rewrites `AgentSection.content` in place, and chat is
ephemeral in the MVP. Without history, one bad AI edit ("tighten the guardrails" replaces
80 good lines with 12 mediocre ones) is an **unrecoverable loss** — fatal to trust in a tool
whose whole pitch is *trustworthy* AI editing.

**Scope — logged from import onward, not just from the first AI edit:** every section's
history starts the moment it's *created*, whichever way that happens, and every edit after
that appends a new row. Nothing about a section's content ever changes without a row here.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | uuid | PK | |
| `sectionId` | uuid | not null | **references `AgentSection.id`, but not as a cascading FK.** If the section is later deleted (e.g. removed on re-import, below), its revision rows are *not* deleted with it — the log outlives the live row on purpose. Same "soft reference" pattern already used for `propKey`/`sectionKey` elsewhere in this doc. |
| `content` | text (markdown) | not null | the section's **full content** at this point in time — always the whole text, never a diff. This is what makes the log self-sufficient: no row depends on any other row to be readable. |
| `author` | enum | not null | `import` \| `reimport` \| `scaffold` \| `user` \| `ai` — who produced this revision |
| `createdAt` | timestamp | not null | |

**How the five authors populate it:**
- **`import`** — the moment Stage 2 labels a block and the server creates the
  `AgentSection` row (see Draft A), it also writes revision #0 for that section:
  `author: "import"`, content = exactly what Stage 1 captured. This is the anchor every
  later diff/revert compares against — "what did this look like on day one."
- **`scaffold`** — a section created directly in the platform (not imported) gets its
  revision #0 written with `author: "scaffold"`, content = the `SectionDef.template` text.
  Kept distinct from `import` (no file was involved) and from `user` (no human typed this —
  it's platform-generated starter text) — Rules Index #21.
- **`user`** — every manual save from the structured view appends a row, `author: "user"`.
- **`ai`** — every mediator rewrite appends a row, `author: "ai"`, *before* (or atomically
  with) overwriting `AgentSection.content`.
- **`reimport`** — see the re-import policy below (Draft A). Kept as its own author value,
  distinct from `import`, so the log visually distinguishes "day one" from "an externally
  diverged file landed back in."

**Why "before" never needs a special step:** because every mutation already appends a row,
the "before" state for *any* future overwrite — a re-import included — is simply **the
section's last-existing revision**. Nothing extra has to be written to capture it; it's
already there.

**Append-only, no delete/update.** `AgentSection.content` always holds the current state
(the latest revision, denormalized for fast reads); `SectionRevision` is the log. Revert =
copy an old revision's content back into `AgentSection.content` — which itself appends a
new `user`-authored revision (a revert is just an edit whose new content happens to match
an old one; no special "revert" author needed for the MVP). No revert UI required yet —
the table existing is what matters; "restore this version" is a thin read + write on top,
addable anytime without a schema change.

### Entity: `AgentSnapshot` (whole-agent import/export capture — Rules Index #15/#16)

**Why it exists — separate from `SectionRevision`:** `SectionRevision` is per-section and
answers "what did this one section look like before." It doesn't cheaply answer "what did
the *whole agent* look like right before this re-import landed, vs. right after" — that
would mean reconstructing every section's state at two points in time from an interleaved
per-section log. `AgentSnapshot` answers that directly: one row, one point in time, the
whole agent as exported markdown text.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | uuid | PK | |
| `agentId` | uuid | not null | **soft reference, not a cascading FK** — same pattern as `SectionRevision.sectionId`. Deleting the agent does not delete its snapshots. |
| `kind` | enum | not null | `pre-import` \| `post-import` \| `export` |
| `content` | text (markdown) | not null | the **full exported `.md`** for the whole agent at this point in time (reuses the existing deterministic `export()` function — not a separate serialization) |
| `createdAt` | timestamp | not null | |

**When it's written (Plan 01 scope):**
- **Re-import of an existing agent** — `export()` the agent's *current* state, write
  `kind: "pre-import"`, **before** applying any change from the incoming file.
- **Every import (first-time or re-import)** — after `repository.upsertAgentFromImport`
  completes, `export()` the *new* state, write `kind: "post-import"`.
- First-time import of a brand-new agent has no prior state, so it only ever gets a
  `post-import` snapshot.

**Deferred (Rules Index #16):** `kind: "export"` — written when a user explicitly exports
an agent to a file — has no capture point yet because Plan 01 has no export route (export
is currently only an internal function used for the round-trip test). The enum value
already exists so wiring this in later is one write call, not a migration. Likewise, a
diff view that reads a `pre-import`/`post-import` (or future `export`) pair and shows what
changed is an explicitly future feature — out of scope for Plan 01.

### Entity: `Group`

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | |
| `name` | string | user-defined, unlimited groups |
| `parentId` | uuid → Group \| null | **nullable; always null in flat MVP.** Present now so flat→nested is additive with zero data migration |
| `createdAt` | timestamp | |

### Entity: `Membership` (Agent ↔ Group, many-to-many)

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | uuid → Agent | |
| `groupId` | uuid → Group | |

Composite key `(agentId, groupId)`. This join is what lets one agent live in many groups.
Untagging deletes a membership row only — never the agent. Nesting later does not touch
this table.

### Note on catalogs

The valid model/tool values are **not** separate `ModelCatalog`/`ToolCatalog` tables —
they're absorbed into `ConfigDef.allowedValues` (the `model` def's list of models, the
`tools` def's list of tools). One catalog drives every dropdown and every validation.
`Agent.platform`'s allowed values are the one exception: a small standalone `PlatformDefs`
array (Rules Index #17), not folded into `ConfigDef`, since it describes the agent record
itself rather than a config/section value on it.

### Deferred (not in the data model yet, noted so we don't design them out)

- **AI chat persistence** — a `Conversation` / `Message` per agent, if we decide chats
  should persist. MVP can keep chat ephemeral (in-memory per session).
- **Export adapters** — Copilot/others live as serializers over the same model, not new
  storage.
- **Sharing / public pages, users/auth** — arrive with hosted mode, out of MVP scope.

## The Agent Blueprint

The **Agent Blueprint** is the platform's canonical, authoritative definition of a valid
agent — it holds *all possibilities*: every config prop, every section type, their allowed
values / templates, and the rules. It is the target the AI import converts *toward*, and
the basis of validation.

- **Derived from the catalogs, not hand-maintained.** The Blueprint is generated from
  `ConfigDef` + `SectionDef` (+ the design rules). Those seed tables already enumerate
  "all possibilities", so **the Blueprint exists as soon as the catalog seeds are done.**
- **One source, three consumers.** The same Blueprint drives the **UI** (dropdowns,
  templates), the **AI import** (conversion target), and **validation**. No drift between
  them because they read one definition.
- **Versioned + updatable** as Anthropic's spec evolves — same as the catalogs it comes
  from.
- Naming note: "Blueprint" is deliberately distinct from *data model* (tables) and *AI
  model* (the LLM). Three different things — don't call any of the others "the model".

## System agents vs. user agents

Two AI behaviors are **infrastructure**, not user content:
- **the import converter** — maps a raw `.md` onto the Blueprint (Draft A, Stage 2);
- **the chat mediator** — the agent-aware chat that edits the agent in place (any of its
  sections, per instruction — see Rules Index #7).

These are **system agents**: owned by the platform, seeded at startup, never editable by
end users. They are distinct from **user agents** (the user's own `dev`, `Zara`, … — fully
editable). Same Blueprint format, different ownership/scope.

**Who is who (the mental model):**
- **The waiter = the platform, acting through its system agent** (converter / mediator).
  The platform is the actor; the system agent is how that behavior is *defined*.
- **The meal = the user's agent** — the content being converted or edited.
- **The customer = the user.**

The platform never hands the customer the raw kitchen (the LLM directly) — every AI action
goes *through* the platform's own waiter. That's why the waiter must be platform-owned.

| | System agents | User agents |
|---|---|---|
| Examples | import-converter, chat-mediator | `dev`, `Zara`, `Ada` |
| Owned by | the platform (code/config, versioned in migrations) | the user |
| End-user editable | ❌ no | ✅ yes |
| Breaks the app if wrong | yes → protected | no |
| Format | Agent Blueprint | Agent Blueprint |

**Precedent:** Claude Code itself does this — built-in subagents (Explore, Plan) are
system-owned and non-editable, alongside user subagents (fully editable). Two scopes, one
format.

**MVP call:**
- Write the converter + mediator as **code/config-owned prompt templates** — simplest,
  safest, and it sidesteps the bootstrap problem (import can't depend on an agent that
  itself must be imported first).
- **Author them in the Blueprint shape** so they can graduate to formal system-scope agents
  later (dogfooding; tuned by an admin, never the end user) without a rewrite.
- **Never** put the mediator in the user's editable library — reliability + prompt-injection
  + tool-access control all demand it stay platform-owned.

## Serialization contract (import ↔ export)

- **Export (Claude):** `name` + `description` (columns) and every `AgentConfig` row →
  YAML frontmatter; `AgentSection` rows by `order` → body. **Platform internals never export**
  (`Agent.id`, `Membership` group links — they aren't frontmatter). **Custom/unknown props
  always export** — they're the agent's own, kept losslessly. (`exportable = false` is the
  future lever if a known platform-only prop ever exists.)
- **Import (Claude):** the two-stage, AI-assisted, always-safe conversion — see **Draft A**.
  Stage 1 captures frontmatter + body blocks losslessly; Stage 2 maps them onto the
  Blueprint (`name`/`description` → columns, other keys → `AgentConfig`, blocks →
  `AgentSection` by type), content verbatim, unmappable → `custom`.
- **Round-trip test** (must hold): import an existing agent, export it, and the result is
  semantically identical to the original (props + sections preserved in order).

**Export rule, refined:** "spec-clean" means *don't leak our internals* (ids, groups) —
not *forbid your custom keys*. Your own frontmatter, spec or not, round-trips.

## Decision drafts

Three downstream decisions. A + B are drafted below; C (stack) is a placeholder for the
real debate.

### Draft A — Import: two-stage, AI-assisted, always safe

Import is **AI-assisted conversion toward the Agent Blueprint**, not a dumb parser — but
built so loss/rewording is impossible (Principles #3, #10). Two stages:

> **The system agent's actual rule-set (Stage 2's exact behavior/guardrails/output schema)
> lives in `design/system-agents/import-converter.md`** — a reviewable, testable file, not
> prose buried in this doc. This section covers only what belongs here: the *architecture*
> (the two-stage split, what data each stage owns). The write-time guard that keeps section
> *content* from breaking the split-level rule lives in
> `design/system-agents/chat-mediator.md`, since the mediator (and manual edits) — not
> import — is where that risk actually originates.

**Stage 1 — deterministic lossless capture (the safety net).**
Split the raw `.md` into frontmatter + raw body blocks, byte-for-byte. No intelligence, no
loss. Handles the real-world mess deterministically:
- **Split on the *shallowest heading level present*** — `#`-based agents split on `#`,
  `orchestrator` (top level `##`) splits on `##`. One robust rule.
- **Respect code fences** — a `#` inside a ``` block or a `~~~` block is never a heading.
  An unclosed fence = the rest of the file is one block (stated rule, not an edge case).
- **Pre-heading prose** → a block at `order 0`, **`heading: null`** (see `AgentSection`).
- The **raw original is retained** with the import, so Stage 2 is reviewable + reversible.
- **Split-level policy (review finding 1a) — the rule, briefly:** each agent has one
  shallowest-heading-level used for splitting (`#` normally, `##` for `orchestrator`-style
  agents), and section *content* must never contain a heading at that same level, or
  export→re-import silently fabricates an extra section. The write-time enforcement (who
  checks it, when, how a violation is handled) is the mediator's concern — see
  `design/system-agents/chat-mediator.md` § Guardrails #2.

**Stage 2 — AI labels blocks; the server reassembles content.** The full rule-set (exact
response schema, guardrails, output format) lives in
`design/system-agents/import-converter.md`. The one architectural fact that belongs here:
**content never enters the AI's output.** The AI classifies each Stage-1 block by id
against the Blueprint; the server — deterministic code, not the model — copies `content`
byte-for-byte from Stage 1's capture into the row the AI labeled. This is what makes
"verbatim" a property of the code path instead of a prompt promise a long or busy response
can quietly violate.

Trade-off: richer, cleaner import than a pure parser, with zero loss risk. The AI mapping
can be improved over time without schema changes; until then, anything uncertain simply
lands as `custom`.

**Re-import policy (review finding 11 — locked, the collision-behavior half):** importing
a `.md` whose `name` matches an existing `Agent.name` is **always an update-in-place** —
never a duplicate, never a hard error, never a prompt asking what to do in the moment.
Same "never block me" openness as every other collision in this design. Concretely, per
section the incoming file maps to:
- **Changed content** → the section's `content` is overwritten, and a new `SectionRevision`
  is appended with `author: "reimport"`. The "before" state needs no special handling — it's
  simply the section's prior last revision, already in the log (see `SectionRevision` above).
- **A section present in the file but not previously in the platform** → created fresh,
  revision #0 tagged `author: "reimport"` (distinct from `import`, since it arrived via a
  re-import event, not the agent's original import).
- **A section previously in the platform but absent from the incoming file → deleted,
  no confirmation needed.** Because `SectionRevision` already retains the section's full
  content history independent of the live row (see `sectionId`'s no-cascade note above),
  deleting the `AgentSection` row loses nothing — the log still has everything that was
  ever in it. There's no reason to keep a row alive just to avoid data loss that isn't
  actually at risk.

### Draft B — Round-trip fidelity (semantic, NOT byte-exact)

Storage is structured, so export *regenerates* the file from data — it emits the tool's
formatting, never the original's bytes. Byte-exact would force storing the raw original
text alongside the structure (defeats "structured is master") **and would fight the
mission** — normalizing the drift we found (quoting, outdated models, tool bloat) is a
*feature*, not data loss.

- **Preserve:** every frontmatter key + value (incl. unknowns), every section in order,
  heading + content.
- **Normalize:** YAML/quote/heading/list formatting → the tool's clean canonical output.
- **Hard line:** normalize structure + frontmatter formatting, but leave **section body
  content byte-for-byte untouched** — user prose/tables/code are never reflowed.
- **Testable invariant — structural idempotency, not textual equality:**
  `parse(export(parse(md))) === parse(md)`. Import → export → re-import yields identical
  structured data. This is the real data-loss guard.
- **YAML parsing (review finding 1d):** parse frontmatter with a **string-preserving**
  mode (failsafe schema — scalars stay strings, no `4.6` → float / `no` → bool coercion).
  **Comments are explicitly accepted as lost** — they aren't keys, so there's no `custom`
  slot to hold them; this is a stated exception to losslessness, not a silent gap.
- **Golden-file test (review blind spot #3):** before building the UI, write `lib/serialize`
  and run import → export → re-import over all real agents in `~/.claude/agents/`, asserting
  structural equality. This exercises the split-level rule, the headingless preamble, and
  the `Zara`-style naming case against real data — proving the invariant where it matters.

### Draft C — Stack (SETTLED)

**Decision: a single Next.js full-stack app.** Local-first, single-user, one app that
holds the AI key server-side, talks to SQLite, and serves the 4-pane UI — one process, one
deploy unit. The data model + Drafts A/B are storage-engine-agnostic, so this choice
touches only *how* we build, not *what* we store.

| Layer | Pick | Why |
|-------|------|-----|
| **Shell** | Local web app (`localhost:3000`) | Same codebase goes online later (Vercel/Azure) with no rewrite — just add auth. No native packaging. |
| **Frontend** | **Next.js (React) + App Router** | The 4-pane workbench. React comes with Next; no separate Vite. |
| **Backend** | **Same Next app** — Route Handlers (`app/api/…`) + Server Actions | Run **server-side**, so they hold the key. No second service, no CORS, shared TS types end-to-end. |
| **Styling** | **Tailwind CSS + shadcn/ui** | Fast, polished, accessible components; the mainstream pairing. |
| **Storage** | **Drizzle ORM + SQLite** (`better-sqlite3`), behind a **repository layer** | SQL-first, strong TS types for the EAV tables, simple migrations for the `ConfigDef`/`SectionDef` seeds. **Correction (review finding 3):** this is *not* a driver swap later — Drizzle schemas are dialect-specific (`sqliteTable` vs `pgTable`), and SQLite/Postgres/Azure SQL differ on booleans, timestamps, and JSON storage. Locked now: all DB access goes through a thin **repository layer** (conservative column types — text/integer/JSON-as-text) so a future migration is a schema-file rewrite behind that boundary, not an app-wide rewrite. **Deferred:** the actual target dialect (Postgres vs. Azure SQL) — no code impact today, decide when the migration is real. |
| **AI** | **`@anthropic-ai/sdk`** (official TS SDK) | Called only from Route Handlers. Default model `claude-opus-4-8`. The converter + mediator are server-side prompt templates. |

**Why Next over Vite (the real fork):** the hard constraint is 🔒 *the key must never
reach the browser* (Principle #8). That needs a server. **Vite is client-only** — using it
would force a second backend service (the earlier "Vite + Hono" shape). **Next bundles the
server into the same app**, so the key lives in the server half of one project. Next isn't
simpler in the abstract; it's the simplest way to get **one app that safely holds a
secret.** SSR/SEO (Next's other selling point) is irrelevant for an app-shell tool — we
pick Next purely for the built-in server.

**Key safety, concretely:** the AI key sits in `.env.local` (git-ignored), read only inside
Route Handlers / Server Actions. The browser calls our own `/api/*` endpoints; it never sees
the key or calls Anthropic directly. Matches Principle #8 from day one.

### Project layout (sketch)

```
myagent/
├── app/
│   ├── page.tsx                 # the 4-pane workbench shell (Example A layout)
│   ├── layout.tsx               # root layout, Tailwind + theme
│   ├── components/              # panels: Library · CustomViz · Chat · Raw
│   └── api/
│       ├── agents/route.ts      # CRUD over Agent + zones (server-side)
│       ├── chat/route.ts        # chat-mediator: edits sections in place (holds key)
│       └── import/route.ts      # import-converter: .md → Blueprint (Draft A)
├── lib/
│   ├── db/                      # Drizzle schema (Agent, ConfigDef/AgentConfig,
│   │   │                        #   SectionDef/AgentSection, Group/Membership) + seeds
│   │   └── migrations/          # catalog seeds = the Blueprint source
│   ├── blueprint/               # Blueprint derived from ConfigDef + SectionDef
│   ├── serialize/               # export (deterministic) + import (Stage 1 capture)
│   └── ai/                      # Anthropic client + system-agent prompt templates
├── .env.local                   # AI key — git-ignored, server-only
└── drizzle.config.ts
```

`app/api/*` is the server tier (holds the key); `app/components/*` is the client tier
(never touches it). The two system agents (converter, mediator) live in `lib/ai` as
code-owned prompt templates — not in the user's editable library (see *System agents vs.
user agents*).

### Learning-goals roadmap (staged, non-blocking)

The user is using this project to build production-engineering skills. These are **layered on
after** the core loop works — none gate the MVP:

1. **JWT auth** — arrives with going-online (multi-user); NextAuth or a custom JWT flow.
2. **Unit tests** — Vitest for `lib/` (serialize, blueprint, db) from early on.
3. **Docker** — containerize the Next app once it runs end-to-end.
4. **CI/CD** — GitHub Actions: test → build → (later) deploy.
5. **Azure** — App Service first; AKS/Kubernetes when K8s is the goal. **This is also when
   #8b below gets decided** — the storage target dialect, informed by whatever Drizzle's
   Postgres/Azure SQL maturity looks like at the time, built on the repository layer
   already in place (§ Draft C).

All are stack-agnostic infra skills, fully learnable on the single Next.js app.

## Deferred decisions (roadmap)

Items from the **Rules Index** above that are intentionally left open — not forgotten,
just correctly sequenced to when their trigger actually arrives. Check this list, not just
memory, before assuming something was decided.

| # | Deferred item | Revisit when |
|---|---|---|
| 8b | Storage target dialect (Postgres vs. Azure SQL) | The Azure step of the learning-goals roadmap (above), when the migration is actually happening |
| 13 | Catalog evolution: distinguish "never known" vs. "was known, catalog changed" | Catalog versioning infrastructure exists (post-MVP) |
| 14 | Manual-edit save frequency: every save logs a `SectionRevision`, or debounced to meaningful edit boundaries | Building the structured-view manual-edit save flow |
| 16 | `AgentSnapshot(kind:'export')` capture + the import/export diff-view UI | The export route is built (later plan) |
| 18 | `ConfigDef` platform-scoping (per-platform `model`/`tools`/etc. catalogs, since fields/allowedValues differ by platform) | A second platform's import/create support is actually being built |
| 19 | Whether `'inherit'` should be an `allowedValues` member of `model` at all, vs. modeled as "no value set" | Next time the `model` catalog or validation logic is touched |
| 20 | Display-label lookup for `model` (short name in UI, full ID in storage) | Building any UI surface that renders `model` (later plan) |
| 24 | Propose-preview before applying a mediator rewrite | If apply-then-history ever feels too abrupt in real dogfooding use |

**8a is final, not deferred:** the repository layer over Drizzle is locked and needed
starting now (it's how the app talks to the DB from day one, independent of which future
dialect #8b eventually picks).

## Next step

**Design is complete — start building.** First slice = the **core loop** (Concept build
order #1): the structured **Custom Visualization** pane rendering one seeded agent + the
**agent-aware chat** editing a section in place. Everything else (library/groups, export,
import) layers on after that loop works.