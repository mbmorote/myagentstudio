# MyAgent — Agent Workbench (folder map)

A workbench for building and managing AI agents: an **agent-aware AI chat** next to an
**always-visible structured view** of the agent it's editing. Design is complete; the
first implementation plan exists and is under review. This file is the map.

## ⏸️ Resume point (next session starts here)

We are walking `plans/01-core-loop-implementation-plan.md` **section by section** with
the user before any code is written — explaining each part, flagging decisions that need his
input rather than guessing. Pace is deliberately one-at-a-time, not a batch dump.

**Reviewed and accepted:** §0 (Ambiguities resolved, R1–R8) · §1 (Guiding constraints) ·
§2 (File creation order / the 4 build phases).

**§3 (Exact Drizzle schema) was presented and explained, but the user had not yet confirmed
it before pausing — do NOT treat it as accepted. Next session: re-present §3, get an
actual reaction, then continue.**

**After §3 is actually confirmed, next up: §4 — Seed data shape.** This section touches
two of the six open decisions (§9 of the plan): **D4** (the authoritative `model`
allowed-values list) and **D5** (which `SectionRevision.author` a platform-created — not
imported — section gets).

**Remaining sections after §4, in order:** §5 API route contracts (touches **D1**/**D2**,
the mediator UX depth + multi-section-edit questions) · §6 Business rules · §7 Draft D
(mediator↔UI contract — also D1/D2) · §8 Testing approach · **§9 Decisions needed — all
six (D1–D6) confirmed together here** · §10 Risks per phase · §11 Parallelization ·
Appendix (Rules Index traceability).

**Do not start writing code until this review finishes and D1–D6 are answered** — that's
the whole point of reviewing the plan before `@dev` executes it.

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
  (server-scoped to one section, no tools, split-level heading guard).
- **`design/layout/Layout-Workbench.html`** — the *look*. Interactive, self-contained
  mockup of the settled 4-pane UI. Demos the `dev` agent across the panels.
- **`design/layout/LayoutModel1.png`** — the original hand-annotated layout sketch.
- **`plans/01-core-loop-implementation-plan.md`** — written by `@architect`. Turns the
  settled design into an ordered, file-by-file build: Phase 0 scaffold → Phase 1 the
  golden-file round-trip proof (no DB, no UI) → Phase 2 persistence → Phase 3 import
  pipeline → Phase 4 the core loop (UI + chat). Currently **under section-by-section
  review with the user** — see Resume point above.

## Where things stand

**Design is complete.** Every review finding is folded into `TechDesign.md`'s Rules
Index — locked items are implemented in the plan; genuinely deferred items (DB dialect
choice, catalog versioning, manual-save frequency) are tracked in the Deferred Decisions
table with a trigger for when to revisit, not forgotten.

- **Data model** — `Agent` · `ConfigDef`/`AgentConfig` · `SectionDef`/`AgentSection` ·
  `Group`/`Membership` · `SectionRevision` (append-only edit log, `author: import |
  reimport | user | ai`, starts at import — not just at the first AI edit).
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
