# MyAgentStudio — Agent Workbench (folder map)

A workbench for building and managing AI agents: an **agent-aware AI chat** next to an
**always-visible structured view** of the agent it's editing. This file is the map only —
folder-by-folder pointers and the standing rules every session follows. It carries no
status and no dated narrative: **`plans/roadmap.md`** is where "what's built and what's
next" lives, **`CHANGELOG.md`** is where "what happened and when" lives, and
**`docs/system-about.md`** is where the system's actual current behavior is described in
full. If you're looking for any of those three things, go there — this file just tells you
where.

## Standing project rules

These apply to **every** session and every subagent (`@dev`, `@architect`, etc.) working in
this repo — not just the session that set them. If you're a subagent picking up work here,
follow these even though you have no memory of when they were agreed:

1. **Never commit without explicit ask.** Don't run `git commit` (or delegate one) just
   because a phase/gate/milestone completed — report status and wait for the user to say
   "commit this."
2. **Never make a real Anthropic API call without explicit ask, first.** This project's
   import pipeline (Hermes — Strict, Daedalus — Structural) and Prometheus (chat) all call the real Anthropic API
   and spend the user's money. During implementation, testing, or verification work in this
   repo: keep all automated tests mocked (already the existing pattern — see
   `vi.mock('.../ai/*.js', ...)` in the test suites), and if a task would require an actual
   API call — seeding the real local DB via `/api/agents/import`, running
   `scripts/test-structural-import.ts`, manually exercising `/api/chat` against the running
   dev server, etc. — **stop and ask the user before making that call**, even if the task
   description seems to imply it should happen automatically. Say what call you'd make and
   roughly what it costs; don't just do it. The app itself has a "Live LLM calls" toggle
   (`/settings`) that blocks real calls at the gateway level — prefer turning that off over
   trying to avoid triggering code paths by hand, but the ask-first rule still applies to
   whether you flip it back on or otherwise cause a real call.
3. **Shut down the dev server (`npm run dev`) after a testing/verification session ends —
   default is off.** Only leave it running if the user explicitly says to keep it up. Reason
   this rule exists: multiple stray `next dev` processes once accumulated across sessions
   that never got shut down, all pointing at the same SQLite file — one of them hung
   indefinitely on the `/export` route (SQLite lock contention), which looked like a real
   app bug until traced back to the stray processes. Before starting a fresh one, check
   `netstat -ano | grep LISTENING` (or equivalent) for leftover Node processes on 3000+ and
   kill them first.
4. **Prototype layout/UI changes in `reference/layout/Layout-Workbench.html` before
   touching live code.** Reason: it's a self-contained static file — no dev server, no DB, no
   build step — so iterating on a visual change there is faster to test and safer to throw
   away than iterating directly in the real React components. Once a change is settled in the
   mockup, migrate it into the real app. This rule is about efficiency of iteration, not
   process for its own sake — a trivial one-line style tweak doesn't need a mockup detour.
   Open layout items are tracked in `plans/roadmap.md`, tagged Layout — there is no separate
   hand-off file for this. **When dispatching this prototyping step to `@dev` or any
   subagent:** scope each dispatch to one visual concept, not several bundled together, and
   explicitly waive Mode A's build-equivalent sanity check in the prompt — there is no
   compiler for this file, so requiring one invites the agent to invent substitute
   verification (counting balanced tags, etc.) that spends real time proving something a
   human confirms by eye in seconds. The gate for this file is always a human looking at it in
   a browser, never an automated check.
5. **🔶 PROVISIONAL — ask before running any sanity/build/test check, in any task.** This
   covers `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run dev` started only to
   smoke-test something, or any equivalent verification command — whether about to be run
   directly, or as part of `@dev`'s Mode A step 3 ("Run a Sanity Check") or `@qa`'s testing
   pass. Do not run one automatically just because a plan step or an agent's own process
   calls for it — **stop first and ask the user** whether to run it now, or whether
   verification will happen outside this session/environment instead. Reason: the user wants
   to evaluate, case by case, whether running these checks here is worth it vs. doing so
   elsewhere, and this is a deliberate tightening while that's being worked out — **not a
   permanent process change**, revisit/relax when the user says so. Rule 2 (no real Anthropic
   API call without ask) and rule 3 (dev server off by default) already covered the two
   costliest/riskiest categories; this widens the same ask-first posture to ordinary
   test/build runs too.
6. **Comments and citations must be self-contained — state the rule, don't just point at
   one.** A code comment or doc cross-reference that only says `(Rules Index #41)` or
   `(§3.7)`, with no restatement of what that rule actually *is*, has zero value the moment
   its target moves — which is exactly what happened 2026-08-12 when `TechDesign.md` retired
   out of the live tree and dozens of comments citing its numbered rules across `lib/`
   and `app/api/` went dark, needing a dedicated cleanup pass. Going forward: if a fact is
   worth citing, restate it in one clause inline at the citation site; a bare number or
   section symbol is never sufficient by itself. Applies equally to doc files — it's the
   same one-fact-one-home principle behind the `docs/` split (`system-about.md` /
   `project-explanation.md` / `roadmap.md`, each owning one audience): a fact lives in
   exactly one place, but anywhere else it's *mentioned in passing*, say what it says, not
   just where to go look it up.
7. **Retiring, renaming, or moving any file means finding every reference to it in the same
   pass — not as a deferred follow-up.** Before considering a move done, grep the whole
   repo — docs and code comments both — for the old filename/path and fix or drop what turns
   up. Concrete example: `plans/01`–`09` moving to `plans/archive/` and `Concept.md`/
   `TechDesign.md` retiring out of the live tree (2026-08-12, Plan 10) were each quick
   moves, but references to the old paths were scattered across dozens of files and took a
   separate, dedicated pass to actually find — do the grep as part of the move itself, not
   after. Same pattern repeated 2026-08-24: `architecture/` renamed to `reference/` once its
   last non-`layout/` content (`audits/`) moved out of the repo entirely.
8. **The GitHub repo is public — nothing in it can be selectively hidden.** GitHub gives no
   partial-visibility control on a public repo: every commit, every PR (open, closed, or
   merged), every PR comment, and the full history are visible to any visitor. Closing a PR
   only changes its state label — it does not hide it. Before any commit or PR (docs-only
   included), check the actual diff for anything that shouldn't be public — secrets,
   credentials, internal-only notes, or WIP not meant for a portfolio audience — since once
   pushed, removing it cleanly means deleting/rewriting history, not just closing something.
   Reason this rule exists: on a public repo, review has to happen before the push — there
   is no later step that can undo or hide what's already visible.

## Folders

- **`docs/`** — the audience-facing documentation set. `user-guide.md` (end users),
  `system-about.md` (engineering reference — stack, architecture, data model, design
  principles), `project-explanation.md` (product story/portfolio narrative), `roadmap.md`
  (friendly capability matrix). Each owns one audience; a fact lives in exactly one of them.
- **`reference/`** — supporting technical reference material, not itself audience
  documentation. (Renamed from `architecture/` 2026-08-24 once its only local-only,
  gitignored content — `audits/`, the historical archive of retired design docs and
  past point-in-time reviews — moved out of the repo entirely.)
  - **`reference/layout/`** — the layout mockup (`Layout-Workbench.html`) + its original
    source sketch (`LayoutModel1.png`). See standing rule 4.
  - **`reference/Agent-Full-Reference.md`** — field-by-field annotated reference for the
    full Claude Code subagent frontmatter schema. Source for the Tier 1 Config zone's `hint`
    text in the app.
- **`plans/`** — build-sequence plans. **`plans/roadmap.md`** is the living file and the
  single source of truth for status — **start here for "what's next."** TODO (before v1
  goes online) / NEXT (soon after launch) / FUTURE (eventual, unprioritized) / IDEA (not
  yet even design-decided). **`plans/archive/`** holds completed numbered plans, kept for
  history but no longer maintained — their status lives in the roadmap now, not in them.
  Any numbered plan still at the top level of `plans/` (not yet archived) is still active.
- **`lib/ai/prompts/system-agents/`** — the AI-facing rule-sets for the three platform
  agents (Hermes — Strict Import, Daedalus — Structural Import, Prometheus — chat), as
  source `.md` files in real-agent shape (YAML frontmatter + `#`-level sections). **This is
  source code, not documentation** — `scripts/build-prompts.ts` compiles it into
  `lib/ai/prompts/generated/*.ts` at build time; it lives next to that generated output
  rather than in a folder meant for passive reference material. See `lib/ai/CLAUDE.md`.
- **`lib/ai/`, `lib/import/`, `lib/serialize/`, `lib/auth/`, `lib/db/`, `lib/mcp/`** — each has
  its own `CLAUDE.md`; see Files below.
- **`lib/blueprint/`** — the Agent Blueprint (`ConfigDef`/`SectionDef` catalogs + rule
  functions), derived data driving the UI, AI import, and validation from one definition.
  Small enough (4 files) to fold in here rather than carry its own `CLAUDE.md`. One gotcha
  worth knowing: `CONFIG_DEFS` in `lib/blueprint/catalog.ts` is still the live, code-owned
  source for the config catalog, while the section catalog has already migrated to being
  DB-owned (seeded once, then edited live) — the two catalogs are not at the same stage of
  that migration, so don't assume editing `catalog.ts` affects sections the same way it
  affects config.

## Files

- **`README.md`** (root) — quick-start, env vars, layout summary. User-facing entry point.
- **`CHANGELOG.md`** (root) — chronological project history. Start here for "what happened
  and when"; this file (`CLAUDE.md`) never carries dated narrative.
- **`docs/user-guide.md`** — task-oriented end-user guide: import (both modes), AI-chat
  edit, manual raw edit, groups, export, Settings/dry-run mode.
- **`docs/system-about.md`** — the engineering reference: stack, repo structure, design
  principles, full data model, the Blueprint, system agents, import pipeline, the
  propose/apply chat flow, serialization contract, auth/multi-tenancy, the LLM gateway,
  known gaps. Start here for anything implementation-related.
- **`docs/project-explanation.md`** — the product story: the problem, what the product is,
  who it's for, the killer feature, the feature flows, how it was developed.
- **`docs/roadmap.md`** — a curated, plain-language projection of `plans/roadmap.md`:
  Available today / Coming next / Planned, big items only.
- **`reference/Agent-Full-Reference.md`** — field-by-field annotated reference for the
  full Claude Code subagent frontmatter schema.
- **`reference/layout/Layout-Workbench.html`** — the *look*. Interactive, self-contained
  mockup of the 4-pane UI. Authoritative behavior spec for any UI detail that needs
  re-checking, per standing rule 4.
- **`reference/layout/LayoutModel1.png`** — the original hand-annotated layout sketch.
- **`plans/roadmap.md`** — the living technical backlog and status tracker.
- **`plans/archive/`** — completed numbered plans (01–09), kept for history.
- **`lib/ai/CLAUDE.md`** — the gateway architecture (single choke point, one-SDK-importer
  rule), the three AI callers, and build-time prompt compilation.
- **`lib/import/CLAUDE.md`** — the import pipeline (Stage 1 deterministic split, Strict vs.
  Structural Stage 2, re-import reconciliation).
- **`lib/serialize/CLAUDE.md`** — the serialization round-trip contract (parse ↔ export).
- **`lib/auth/CLAUDE.md`** — session/JWT, password hashing, invite codes, rate limiting,
  Google OAuth.
- **`lib/db/CLAUDE.md`** — schema, migrations, seed scripts, and the repository layer.
- **`lib/mcp/CLAUDE.md`** — the MCP server exposing a user's agents to console/CLI clients
  (Plan 13): tool/resource layer, the SDK-isolation and write-surface-containment fitness
  functions, and the `push_agent` write path (renamed from `import_agent` 2026-08-24).

## Notes

- Reference: the real agent library that seeded the design lives in `~/.claude/agents/`.
