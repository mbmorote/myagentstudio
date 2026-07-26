# MyAgent — Agent Workbench (folder map)

A workbench for building and managing AI agents: an **agent-aware AI chat** next to an
**always-visible structured view** of the agent it's editing. Design is complete; the
first implementation plan has been reviewed section-by-section and confirmed (2026-07-26) —
ready for `@dev` to execute. This file is the map.

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

## Folders

- **`design/`** — all design docs (see below).
- **`design/system-agents/`** — the actual AI-facing rule-sets for the two system agents.
- **`design/layout/`** — the layout mockup + its source sketch.
- **`plans/`** — build-sequence plans (distinct from `design/`'s stable architecture docs).
  One file per plan, numbered. `01-core-loop-implementation-plan.md` is the first.

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
- **`design/system-agents/import-converter.md`** — the import-converter's actual
  Role/Behavior/Guardrails/Output rule-set (Stage 2: labels-only, never content).
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

**Design is complete.** Every review finding is folded into `TechDesign.md`'s Rules
Index — locked items are implemented in the plan; genuinely deferred items (DB dialect
choice, catalog versioning, manual-save frequency) are tracked in the Deferred Decisions
table with a trigger for when to revisit, not forgotten.

- **Data model** — `Agent` (incl. `platform`) · `ConfigDef`/`AgentConfig` ·
  `SectionDef`/`AgentSection` · `Group`/`Membership` · `SectionRevision` (append-only edit
  log, `author: import | reimport | scaffold | user | ai`, starts at creation — not just at
  the first AI edit) · `AgentSnapshot` (whole-agent pre/post-import capture).
- **Agent Blueprint** — one module (`lib/blueprint`, per the plan) exporting catalog data
  **and** rule functions, so import/UI/export can never drift into three implementations.
- **Import/Export** — two-stage AI-assisted import (Stage 2 is labels-only, `{blockId →
  key}`, content never passes through the model — the server reassembles bytes from
  Stage 1). Export is deterministic, semantic-not-byte fidelity. Re-import of an existing
  agent = always update-in-place (never duplicate/error); a section absent from the
  incoming file is simply deleted (its revision history isn't cascade-deleted, so nothing
  is actually lost).
- **System agents** (import-converter, chat-mediator) — platform-owned, rule-sets live in
  `design/system-agents/*.md`, not buried in `TechDesign.md` prose.
- **Layout** — settled 4-pane IDE layout. See `design/layout/Layout-Workbench.html`.
- **Stack (Draft C)** — single Next.js full-stack app, Drizzle+SQLite behind a repository
  layer (locked now), Tailwind+shadcn/ui, `@anthropic-ai/sdk` (`claude-opus-4-8` default).
  Future DB dialect (Postgres vs. Azure SQL) deliberately deferred — no code impact today.

**MVP shape:** local-first, single-user, single local AI key (server-side, never leaked),
platform-is-master with `.md` as an export target.

## Notes

- `README.md` is deferred until there's a first genuinely testable version (core loop +
  library/groups) — writing user-facing docs before the UX is real would be pure rewrite
  risk. Internal docs (via `@scribe`) fire per-slice, right after each feature passes QA —
  not batched to the end. See conversation history for the reasoning if this needs
  revisiting.
- Reference: the real agent library that seeded the design lives in `~/.claude/agents/`.
