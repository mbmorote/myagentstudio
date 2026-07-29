# MyAgent — Agent Workbench (folder map)

A workbench for building and managing AI agents: an **agent-aware AI chat** next to an
**always-visible structured view** of the agent it's editing. Design is complete; Plan 01
(core loop), Plan 02 (import hardening + Structural Import), and Plan 03 (visual-shell
alignment + Library/groups + import UI) are all built and committed. The Blueprint catalog
was refreshed against the real Claude Code subagent docs. The hands-on UI punch-list from
the user's own testing is now fully resolved (see pointer below); one new item (#7,
dedicated group-management view) is logged as future scope, not started. `README.md`,
`docs/user-guide.md`, and per-flow `CLAUDE.md` files (`lib/import/`, `lib/ai/`,
`lib/serialize/`) were also written this session — see the Documentation pointer below.
This file is the map.

**Start at `plans/roadmap.md` for "what's next."** 2026-07-29: a stability pass (typecheck,
132/132 tests, and a production build all clean) confirmed a good checkpoint, so the
scattered open items across this file, `TechDesign.md`, and `Concept.md` were consolidated
into one prioritized roadmap there — check it before assuming something is or isn't done.

## Standing project rules

These apply to **every** session and every subagent (`@dev`, `@architect`, etc.) working in
this repo — not just the session that set them. If you're a subagent picking up work here,
follow these even though you have no memory of when they were agreed:

1. **Never commit without explicit ask.** Don't run `git commit` (or delegate one) just
   because a phase/gate/milestone completed — report status and wait for the user to say
   "commit this."
2. **Never make a real Anthropic API call without explicit ask, first.** This project's
   import pipeline (Strict + Structural) and chat mediator all call the real Anthropic API
   and spend the user's money. During implementation, testing, or verification work in this
   repo: keep all automated tests mocked (already the existing pattern — see
   `vi.mock('.../ai/*.js', ...)` in the test suites), and if a task would require an actual
   API call — seeding the real local DB via `/api/agents/import`, running
   `scripts/test-structural-import.ts`, manually exercising `/api/chat` against the running
   dev server, etc. — **stop and ask the user before making that call**, even if the task
   description seems to imply it should happen automatically. Say what call you'd make and
   roughly what it costs; don't just do it.
3. **Shut down the dev server (`npm run dev`) after a testing/verification session ends —
   default is off.** Only leave it running if the user explicitly says to keep it up. Reason
   this rule exists: on 2026-07-28, four separate `next dev` processes (ports 3000–3003)
   accumulated across sessions that never got shut down, all pointing at the same SQLite
   file — one of them hung indefinitely on the `/export` route (SQLite lock contention),
   which looked like a real app bug ("Raw pane stuck on Loading…") until traced back to the
   stray processes. Before starting a fresh one, check `netstat -ano | grep LISTENING` (or
   equivalent) for leftover Node processes on 3000+ and kill them first.

## ✅ Plan 01 review — complete (2026-07-26)

`plans/01-core-loop-implementation-plan.md` was walked **section by section** with the user
before any code was written (§0 through the Appendix), and all six §9 decisions (D1–D6) are
resolved. The plan file itself is the source of truth for the resulting design — this entry
is just a pointer to what changed *during* review, so a future session doesn't need to
re-derive it from scratch.

**Real design changes that came out of review** (beyond just confirming the original draft):
- **`AgentSnapshot`** — new whole-agent (not per-section) table capturing full exported
  markdown at `pre-import`/`post-import`. Future diff-view feature; `export`-kind capture is
  deferred (Rules Index #16) until a later plan adds the export route. Plan §3.
- **`Agent.platform`** — open catalog (`PLATFORM_DEFS`), not a DB enum; only `'claude'`
  exists today. Platform is tracked *on the agent*, not just translated at export time.
  `ConfigDef` deliberately stays un-scoped per-platform for now (Rules Index #18). Plan §3/§4.
- **D4/D5 resolved** — `model.allowedValues` = full model IDs only, `'inherit'` kept but
  flagged (#19); a future display-label lookup is noted, not built (#20).
  `SectionRevision.author` gained a 5th value, `'scaffold'`, for platform-created (not
  imported) sections (#21). Plan §4.
- **Import route moved**: `POST /api/import` → `POST /api/agents/import` (organizational).
  `AgentDTO` gained the `platform` field. Plan §5.
- **D2 reopened Rules Index #7** (previously "✅ Locked"): the mediator is no longer scoped
  to one `sectionId` — it's scoped to the **whole agent**, may rewrite any number of
  sections one instruction genuinely requires. `SectionRevision` is a per-section *log*, not
  the edit *boundary*. Rewrote `design/system-agents/chat-mediator.md` in full. Per-section
  optimistic concurrency preserved (baseline version per section, conflicts reported
  per-section with fresh `content`, one conflicting section doesn't block others). See
  `TechDesign.md` Rules Index #7's supersession note for why this didn't cross a line the
  original design review hadn't already accepted. Plan §5/§6/§7/§8, Phase 4.4/4.5/4.7.
- **Interaction lock** (#22) — chat and manual raw-edit are mutually exclusive per agent,
  client-enforced; the per-section version check remains the real backstop. Built now.
- **Cancellation** (#23) — `ChatPanel`'s `AbortController` + `request.signal` propagated to
  the Anthropic SDK call. Built now (safe by construction: apply-then-history means nothing
  is written until the mediator fully responds). Propose-preview (#24) remains the one
  deferred future feature.
- **D6 resolved, compile-time not runtime** (#25): no `lib/ai/prompts/*.txt` copy, no
  runtime file read either. `scripts/build-prompts.ts` (**Phase 0.7** — moved there from an
  initial Phase 3.3 placement after a real sequencing bug surfaced during §11 review: Phase
  0.1's `predev`/`prebuild` needs the script to already exist) compiles both
  `design/system-agents/*.md` files into string constants at build time. The running server
  never touches `design/` at all. `design/system-agents/*.md` remains the **one and only
  place** system-agent rules are ever reviewed or edited.
- **New business rule** (§6 rule 7): every `/api/agents/import` call writes exactly one
  `AgentSnapshot(post-import)`, plus `pre-import` iff the agent already existed.
- **§10** gained two rows: the mediator's widened blast radius (an accepted tradeoff, not a
  new hole — matches the original review's own worst-case framing) and the interaction lock
  named as primary defense against concurrent-edit clobbers.

Full detail for all of the above lives in the plan itself and in `TechDesign.md`'s Rules
Index (all 25 entries, cross-checked complete and consistent with the plan's Appendix).

**Next session starts here:** the review is done — nothing left to confirm in Plan 01
itself. Start Phase 0 (`@dev` executes the plan), or do a final skim if picking this back up
after a gap.

## ✅ Plan 02 — complete (2026-07-28)

*(Corrected 2026-07-29 — this section previously said "ready for `@dev`" / "still pending"
after the work had actually already landed. The file's own opening paragraph already said
"built and committed" the whole time; this section just never got updated to match. Caught
during an MVP-readiness review — verified directly against `git log`, not assumed.)*

`plans/02-import-hardening-structural.md` is the execution spec produced from
`design/Fable-Review-1.md` (a Fable 5 audit of the built Phase 1–3 code + a head-to-head
comparison of two competing Structural Import rule-set drafts) plus a follow-up strategy
discussion with the user. It bundled two things: **hardening real bugs found in the
already-built Strict import pipeline** (Phase A) and **finishing Structural Import**
(Phase B — designed in TechDesign.md Rules Index #27/#31/#32, previously rule-set-only).
Structural Import is the **primary/default** import mode; Strict is the secondary verbatim
option — both selectable via `ImportDialog.tsx`'s mode radio (Structural default).

**All landed in commit `b5da391` ("Import hardening + Structural Import (Plan 02)"),
2026-07-28:**
- **B1** — merged best-of-both rule-set drafts adopted: `import-instructions.md` and
  `import-instructions-structural.md` hold the final text; the `-copilot`/`-merged` drafts
  deleted (git history keeps them). `scripts/build-prompts.ts` compiles all three prompts
  (strict, structural, mediator).
- **Phase A** (shared correctness fixes) — A1: re-import reconciliation now matches by
  `(sectionKey, heading)` identity, not a sectionKey-only `Map` (fixed the most severe
  finding — distinct `custom` rows no longer collapse on re-import). A2: malformed YAML
  frontmatter throws `FrontmatterParseError` instead of silently returning `[]`; empty/
  whitespace names rejected with 400. A3: `FrontmatterEntry.rawValue` is `string | string[]`
  so flat YAML lists survive parse→export→parse; nested maps/non-scalar arrays fail loudly
  (400) instead of being destroyed into `"[object Object]"`. A4: the full re-import update
  runs in one transaction; overlapping `blockId` mappings rejected; strict Stage-2
  `max_tokens` raised 1024→4096.
- **Phase B** (Structural Import, code) — `lib/ai/structuralConverter.ts` (streaming Stage-2b
  caller), `POST /api/agents/import`'s `mode` field (default `'structural'`) + unchanged-
  `rawSourceSnapshot` short-circuit, `lib/import/coverage.ts` (deterministic line-coverage
  check → warnings, never a hard block; a truncated/`max_tokens` response is a hard 422
  reject), plus a real bug found during review fixed in the same commit: the structural
  prompt wrapped raw agent text in a ` ``` ` fence, which broke on fixtures containing their
  own fenced code blocks — switched to XML-style delimiters. Tests: `structural.test.ts` (9),
  `coverage.test.ts` (6), both passing.
- **Phase C** — `TechDesign.md` Rules Index #27/#31/#32 updated to locked/built status; new
  entries #33–#36 for the Phase A bugs + the B3 short-circuit; the Draft A "two import
  modes" paragraph flipped to structural-first; two stale doc references fixed
  (`design/AI behavior.txt`, which never existed, and the layout sketch's `import/route.ts`).

**Phase D — status corrected 2026-07-29, was listed as entirely "not in scope"; one item is
actually done:**
- ✅ **UI mode picker** — built (`ImportDialog.tsx`: Structural/Strict radio, Structural
  default). This item should never have been listed as deferred.
- 🔴 **Catalog seed drift — still genuinely open.** `lib/db/seed.ts` has upsert logic that
  would heal the DB's `configDef`/`sectionDef` rows on next seed, but that seed script
  (`npm run db:seed`) isn't wired into `predev`/`prebuild` — only `build-prompts.ts` runs
  automatically. Editing `catalog.ts` does NOT auto-propagate to the DB. Current mitigation
  is `AgentView.tsx` reading live in-code `CONFIG_DEFS` for validation instead of trusting
  the DB-embedded `ConfigDefLite` — a workaround, not a fix.
- 🔴 **`__raw` frontmatter escape hatch — still not built.** A real `mcpServers` file with an
  inline nested server-config object still hits A3's loud `unsupported_frontmatter` 400 on
  import (confirmed real via the Blueprint catalog refresh session, not hypothetical).
- ⬜ **Strict-mode merged-heading instability, adversarial-file re-audit** — not re-verified
  this pass; no evidence either way, presume still open until checked.

## ✅ UI punch-list — 6 of 7 fixed, item 7 logged as future scope (2026-07-28)

After Plan 03 landed, the user did a hands-on pass and flagged a punch-list of small
bugs/polish items. Two real bugs (stray dev-server SQLite lock, "imported from imported"
label) were fixed and verified live earlier in the same day; the remaining six items were
implemented and visually verified live (dev server + Chrome) in a later session, no
pipeline agents — done directly plus one `@ux` consult (item 2's color scheme) and one
`@scribe` dispatch (unrelated docs work run in parallel, see the Documentation pointer
below):

1. **Tools/skills/mcpServers as one pill per item** — done, `AgentView.tsx`. Also handles
   list values stored as a plain comma-separated string (not a real JSON array) via a new
   `listItemsOf()` helper — some imported agents have this shape, and the original
   `Array.isArray` check silently missed them, falling through to the old collapsed-blob
   rendering. Per-item badness is checked against the **live in-code `CONFIG_DEFS`
   catalog**, not the row's DB-embedded `ConfigDefLite` def — the DB's seeded `configDef`
   table can lag the catalog after a refresh (this is the "catalog seed drift" issue,
   Plan 02 Phase D — confirmed live during verification: `dev.md`'s `Create`/`mcp` tool
   entries only rendered as unrecognized once the check stopped trusting the stale
   DB-seeded def).
2. **Pill color + hint system** — done. Four semantic color groups (capability/control/
   resources/presentation — `--cap`/`--ctl`/`--res`/`--prs` token triads in `globals.css`,
   light+dark), designed via an `@ux` consult; status (warn) always fully overrides
   category color rather than layering. `title` tooltips added throughout (datatype +
   description for valid pills, reason + recognized values for warn pills).
3. **Model moved to top-right as its own dropdown** — done, top-right of `AgentView`'s
   header row (not the global Topbar — model is per-agent). Saves via the existing
   `PATCH /api/agents/[id]` config array (full-replace semantics, so the handler rebuilds
   the whole config array, not just the one field).
4. **Groups collapse/expand for "All agents"/"Ungrouped"** — done, same local
   `useState`-per-section pattern `GroupSection.tsx` already used for real groups.
5. **Agent name editable in place** — done. Click the `<h1>` in `AgentView.tsx`, same
   interaction-lock pattern (`onEditStart`/`onEditEnd`) `SectionBlock.tsx` uses, saves via
   `PATCH /api/agents/[id]` `{name}`, 409 → inline "name already exists" error.
6. **Lowercase-hyphen name validation** — removed entirely, per explicit user decision (not
   just left as a soft warning). `validateName`/`nameSpecViolation` deleted from
   `lib/blueprint/rules.ts`, `ValidationResult`, the `AgentDTO.validation` shape, and the
   one test that asserted it. Rules Index's name-spec entries in `TechDesign.md` are now
   stale and unreviewed this session — revisit if anything else references them.
   Separately, all of `rules.ts`'s exported functions were regrouped under one exported
   `Rules` object (`Rules.computeValidation(...)` etc.) per explicit user decision — plain
   object, not a literal `class`, to match the rest of the codebase's functional style.
   Callers (`lib/blueprint/index.ts`, `lib/db/repository/agents.ts`) updated accordingly.
7. **Dedicated group-management view** — still not started, genuinely new scope, not
   researched.

All six were typechecked (`npx tsc --noEmit`) and test-suite-checked (`npm test`, 132/132 —
down from 133 after removing the name-spec test) after every step, then visually verified
together in a live dev-server + Chrome session before shutdown (standing rule 3).

## ✅ Blueprint catalog refresh — complete (2026-07-28)

Read the real Claude Code subagent docs (`code.claude.com/docs/en/sub-agents`,
`.../tools-reference`) to replace `lib/blueprint/catalog.ts`'s guessed/incomplete
`CONFIG_DEFS` with the authoritative current schema, after a side discussion confirmed
MyAgent should keep targeting Claude Code's local `.claude/agents/*.md` subagent format —
**not** Anthropic's separate, subscription-hosted Managed Agents product
(`platform.claude.com/docs/en/managed-agents/*`), which the user doesn't want (no online
subscription dependency) and which has a structurally different config shape (one `system`
string, no sections, fixed 8-tool bundle) anyway.

- `model.allowedValues` gained the 4 short aliases (`sonnet`/`opus`/`haiku`/`fable`) as the
  primary documented form, alongside the existing full IDs and `'inherit'` — supersedes
  Rules Index #19 (was full-IDs-only).
- `tools.allowedValues` replaced with the real 43-tool list; dropped `'Create'` (never a
  real tool) and renamed `'Task'` → `'Agent'` (renamed in Claude Code v2.1.63).
- `permissionMode.allowedValues` gained `'manual'` (7th value, alias for `'default'`).
- Four new `ConfigDef` entries: `hooks`, `isolation`, `color`, `initialPrompt`.
- `mcpServers`' inline-nested-object gap (gets rejected by A3's `unsupported_frontmatter`
  guard) is now confirmed real against real files, not hypothetical — still deferred to the
  `__raw` escape hatch (Plan 02 Phase D).
- Full detail: `TechDesign.md` Rules Index #37–#40 and the Deferred Decisions table.

`npx tsc --noEmit` and `npm test` (133/133) both clean after the catalog edit — no other
code touched.

**New future item logged, not started:** a **Skill module** — a sibling entity to `Agent`
mirroring its props/config/import/export, for `SKILL.md` files
(`.claude/skills/<name>/SKILL.md`). Genuinely different shape (no Role/Behavior/Guardrails/
Output sections, sometimes a whole directory of supporting files). Added as build-order
item 6 in `design/Concept.md`; field-level detail and revisit trigger in `TechDesign.md`'s
Deferred Decisions table.

## ✅ Documentation — README, user guide, dev-flow docs (2026-07-28)

The README deferral noted in this file's own Notes section ("until there's a first
genuinely testable version") was satisfied once Plan 01 + Plan 03 landed, so this was
picked up: `@scribe` wrote five files in parallel with the UI punch-list work above (fresh
agent, no prior context — briefed with the exact folders/files to read).

- **`README.md`** (root, new) — quick-start, env vars, 4-pane layout summary, links out.
- **`docs/user-guide.md`** (new) — task-oriented end-user guide: import (both modes),
  AI-chat edit, manual raw edit, groups, export. Deliberately not named `CLAUDE.md` — that
  name is reserved for internal folder-map docs per the global convention; this one is
  user-facing.
- **`lib/import/CLAUDE.md`**, **`lib/ai/CLAUDE.md`**, **`lib/serialize/CLAUDE.md`** (new) —
  per-flow developer docs for the import pipeline, the two system agents + build-time
  prompt compilation, and the serialization round-trip contract, respectively. Each folder
  earned its own file per the global "only when it warrants it" rule — none were padded out.

Spot-checked after delivery (env var names against `lib/env.ts`, the import-mode-picker
claim against `ImportDialog.tsx`, the gitignore claim against `.gitignore`) — all held up.
One stale claim was caught and fixed: `lib/serialize/CLAUDE.md` originally said "the
workbench flags but never normalizes names," which was true when scribe wrote it but was
made stale by this same session's item-6 fix above (removed the flag too, not just
normalization) — corrected to "never normalizes names."

## 🟡 Tier 1 Config zone redesign — migrated, one item deferred (2026-07-29)

*(Transient session-handoff note — **remove this whole section once the Library panel item
below is also done**, don't let it linger as permanent documentation.)*

**Committed 2026-07-29.** Verified working (typecheck clean, 132/132 tests, live-browser-
tested including real DB persistence) before commit.

An extended session iterated a full redesign of the editable Config zone (and a matching
pass on Tier 2 sections) entirely in `design/layout/Layout-Workbench.html` — category-hue
pill coloring removed, two-column scalar grid, collapsible `[Config] Keys` / `[Sections]
Body` zone-labels, hover-reveal remove-× with confirm + a `required`-badge alternative,
list-item pills split into select-vs-remove, `tools`/`disallowedTools` validation extended
for `mcp__*`/`Agent(...)` shapes, bool/enum scalars now open a custom popover (not a native
`<select>` — fixed a real stuck-open bug in the process), one unified "+" add-key button
(top of the Keys zone, not bottom), `model`+`effort` merged into one header popover (real
catalog values, not shortened), and a `hint` tooltip per `CONFIG_DEFS` field sourced from
`design/Agent-Full-Reference.md`. The mockup file itself is the authoritative behavior spec
if any detail needs re-checking.

**Migrated into the real app by `@dev` (2026-07-29) — 16 of 17 items done.** Touched
`lib/blueprint/catalog.ts`, `app/globals.css`, `WorkbenchShell.tsx`, and rewrote
`SectionBlock.tsx` + `AgentView.tsx`. `npx tsc --noEmit` clean, `npm test` 132/132 passing.
`hint` was added directly to `CONFIG_DEFS` in-code (no schema/DB change) — resolved as
recommended, matching how `allowedValues` already avoids the DB's laggy seeded copy.

**One item deferred, needs a product decision — not a missing UI piece:** the "+ custom
key…" arbitrary-name creation (part of item 11). If a user-created key with no matching
`ConfigDef` gets written to `AgentConfig`, `Rules.computeValidation` immediately flags it as
`unknownConfigKeys` — a yellow ⚠ warn pill right next to the field the user just
intentionally created. Needs something like a "user-acknowledged custom key" concept (new DB
column, or a separate key-status mechanism) before this can be built without that
self-contradiction. The catalog-key picker (standard keys only) works fine; just this one
option is absent from the "+" menu. **Deviation, not a problem:** `onModelSaved` was dropped
in favor of a more general `onAgentUpdated(newAgent)` callback (receives the full DTO back
from the PATCH) — no other callers referenced the old one.

**Five further items — prototyped in `Layout-Workbench.html` AND migrated into the real app,
same day (2026-07-29).** Library Agents/Grouped toggle + Manage separator (renamed
"Import agent"), config list-item cap ("+N more"), the new red/invalid pill tier (icon
confirmed as ✕) vs. the existing yellow/outdated `.pill.warn`, the folded side-panel gap,
and compact MCP tool pill display. `npx tsc --noEmit` and `npm test` (132/132) both clean;
verified live against the real `dev` agent (47 real MCP tools). **Not committed** — per
standing rule 1. Full detail (files touched, deviations from the original prototype note,
one real-world data-shape caveat found during migration) lives in
**`plans/layout-prototype-todo.md`**, which remains the source of truth for this whole
prototype→real-app workflow; update it (not this section) as future items move through it.

## Folders

- **`design/`** — all design docs (see below).
- **`design/system-agents/`** — the actual AI-facing rule-sets for the two system agents.
- **`design/layout/`** — the layout mockup + its source sketch.
- **`plans/`** — build-sequence plans (distinct from `design/`'s stable architecture docs).
  One file per plan, numbered. `01-core-loop-implementation-plan.md` is the first;
  `02-import-hardening-structural.md` is the second (see the Plan 02 pointer above). Also
  holds two unnumbered, living (not locked-execution-spec) files:
  **`plans/layout-prototype-todo.md`** — running hand-off list of UI/layout changes
  prototyped in `Layout-Workbench.html` but not yet migrated into the real app; and
  **`plans/roadmap.md`** — **start here for "what's next."** Consolidates this file's
  session narrative, `TechDesign.md`'s Deferred Decisions table, and `Concept.md`'s Build
  order into one prioritized, tiered list of open work. Written 2026-07-29 after a
  stability pass (typecheck/tests/build all clean) confirmed the project was at a good
  checkpoint to consolidate.

## Files

- **`design/Concept.md`** — the *what/why*. The problem, the product, who it's for, the
  killer feature, locked decisions, the canonical Claude-agent structure it mirrors, the
  real-library audit, the body schema, and the grouping model. Stable; rarely changes.
- **`design/TechDesign.md`** — the *how*. Design principles, the full data model (incl.
  the append-only `SectionRevision` history table), the **Agent Blueprint**, **system vs.
  user agents**, the serialization contract, the settled **decision drafts** (A/B/C), a
  **Rules Index** (every review-derived rule — type, exact file location, locked/deferred
  status), and a **Deferred decisions (roadmap)** table (items intentionally not built yet,
  each with a trigger for when to revisit). This is the single source of design truth —
  start here for anything implementation-related.
- **`design/DesignReview.md`** — the pre-build adversarial review (Fable 5, 2026-07-24)
  that produced the Rules Index above. **Fully folded into `TechDesign.md` — nothing left
  outstanding from it.** Kept as the historical record of *why* each rule exists.
- **`design/Fable-Audit-Brief.md`** — the reusable prompt that produced the review. Kept
  so future audits (post-build, pre-online) can reuse the same brief.
- **`design/Fable-Review-1.md`** / **`design/Fable-Review-1-Findings.md`** — the audit
  prompt and its results (2026-07-28): a current-state audit of the built Phase 1–3 code
  plus a head-to-head comparison of two Structural Import rule-set drafts. Source of
  Plan 02; kept as the historical record of *why* each Phase A/B fix exists, same role
  `DesignReview.md` plays for Plan 01.
- **`design/system-agents/import-instructions.md`** — the import-converter's actual
  Role/Behavior/Guardrails/Output rule-set (Stage 2: labels-only, never content). Final
  merged text adopted 2026-07-28 (Plan 02 Phase B1).
- **`design/system-agents/import-instructions-structural.md`** — the Structural Import
  (Stage 2b) rule-set: the AI sees full content and returns one restructured document
  body, not a mapping. Final merged text adopted 2026-07-28 (Plan 02 Phase B1); the code
  path that calls it (`lib/ai/structuralConverter.ts`) is built (Plan 02 Phase B2/B3).
- **`design/system-agents/chat-mediator.md`** — the chat-mediator's actual rule-set
  (server-scoped to the whole agent — may rewrite any number of its sections per
  instruction — no tools, split-level heading guard).
- **`design/layout/Layout-Workbench.html`** — the *look*. Interactive, self-contained
  mockup of the settled 4-pane UI. Demos the `dev` agent across the panels.
- **`design/layout/LayoutModel1.png`** — the original hand-annotated layout sketch.
- **`plans/01-core-loop-implementation-plan.md`** — written by `@architect`. Turns the
  settled design into an ordered, file-by-file build: Phase 0 scaffold → Phase 1 the
  golden-file round-trip proof (no DB, no UI) → Phase 2 persistence → Phase 3 import
  pipeline → Phase 4 the core loop (UI + chat). **Reviewed section-by-section and confirmed
  2026-07-26** — see the resume point above for what changed during that review.

## Where things stand

**Design is complete; Plan 01 and Plan 02 are both built, tested, and committed.** Every
review finding is folded into `TechDesign.md`'s Rules Index — locked items are implemented
in the plan; genuinely deferred items (DB dialect choice, catalog versioning, manual-save
frequency) are tracked in the Deferred Decisions table with a trigger for when to revisit,
not forgotten. **Plan 02 (see pointer above) hardened the import pipeline and finished
Structural Import** — done, including the UI mode picker; catalog seed drift and the
`__raw` escape hatch remain the two genuinely open Phase D items.

- **Data model** — `Agent` (incl. `platform`) · `ConfigDef`/`AgentConfig` ·
  `SectionDef`/`AgentSection` · `Group`/`Membership` · `SectionRevision` (append-only edit
  log, `author: import | reimport | scaffold | user | ai`, starts at creation — not just at
  the first AI edit) · `AgentSnapshot` (whole-agent pre/post-import capture).
- **Agent Blueprint** — one module (`lib/blueprint`, per the plan) exporting catalog data
  **and** rule functions, so import/UI/export can never drift into three implementations.
  Catalog data refreshed 2026-07-28 against the real Claude Code subagent schema (see the
  Blueprint catalog refresh pointer above).
- **Import/Export** — two user-chosen import modes (radio picker in `ImportDialog.tsx`)
  sharing deterministic Stage 1. **Strict Import** (built, hardened by Plan 02 Phase A):
  Stage 2 is labels-only, `{blockId → sectionKey}`, content never passes through the model —
  the server reassembles bytes from Stage 1. **Structural Import** (built, Plan 02 Phase B —
  primary/default mode): the AI sees full raw text and returns one restructured document
  body; the server re-parses it deterministically and maps headings → sectionKeys, backed by
  a coverage check (warnings, not a hard block) rather than code-enforced content copying.
  Export is deterministic, semantic-not-byte fidelity. Re-import of an existing agent =
  always update-in-place (never duplicate/error); a section absent from the incoming file is
  simply deleted (its revision history isn't cascade-deleted, so nothing is actually lost) —
  reconciliation matches sections by `(sectionKey, heading)` identity (Plan 02 Phase A1
  fixed a real bug where sectionKey-only matching collapsed distinct `custom` rows).
- **System agents** (import-converter, chat-mediator) — platform-owned, rule-sets live in
  `design/system-agents/*.md`, not buried in `TechDesign.md` prose.
- **Layout** — settled 4-pane IDE layout. See `design/layout/Layout-Workbench.html`.
- **Stack (Draft C)** — single Next.js full-stack app, Drizzle+SQLite behind a repository
  layer (locked now), Tailwind+shadcn/ui, `@anthropic-ai/sdk` (`claude-opus-4-8` default).
  Future DB dialect (Postgres vs. Azure SQL) deliberately deferred — no code impact today.

**MVP shape:** local-first, single-user, single local AI key (server-side, never leaked),
platform-is-master with `.md` as an export target.

## Notes

- `README.md` was deferred until there was a first genuinely testable version (core loop +
  library/groups), to avoid rewrite risk from writing user-facing docs before the UX was
  real. That condition was met once Plan 01 + Plan 03 landed — see the Documentation
  pointer above for what was written.
- Reference: the real agent library that seeded the design lives in `~/.claude/agents/`.
