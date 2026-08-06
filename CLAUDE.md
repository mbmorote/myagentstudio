# MyAgent — Agent Workbench (folder map)

A workbench for building and managing AI agents: an **agent-aware AI chat** next to an
**always-visible structured view** of the agent it's editing. This file is the map — current
state, standing rules, and pointers to where detail actually lives. It does not carry
session narrative; **see `CHANGELOG.md` for what happened and when**, and **`plans/roadmap.md`
for what's built and what's next**.

**Chat proposes, it doesn't apply directly** (as of Plans 07–08, 2026-08-06): sending a chat
instruction never writes to the agent. It returns a proposal (`message` + whatever changed),
shown as a card in the ChatPanel with **Apply**/**Discard** — nothing lands until Apply is
clicked. While a proposal is pending, manual editing is locked (a third `'proposal'` state on
the existing interaction lock). See `plans/08-prometheus-apply.md`.

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
   roughly what it costs; don't just do it. As of Plan 04, the app itself has a "Live LLM
   calls" toggle (`/settings`) that blocks real calls at the gateway level — prefer turning
   that off over trying to avoid triggering code paths by hand, but the ask-first rule still
   applies to whether you flip it back on or otherwise cause a real call.
3. **Shut down the dev server (`npm run dev`) after a testing/verification session ends —
   default is off.** Only leave it running if the user explicitly says to keep it up. Reason
   this rule exists: on 2026-07-28, four separate `next dev` processes accumulated across
   sessions that never got shut down, all pointing at the same SQLite file — one of them
   hung indefinitely on the `/export` route (SQLite lock contention), which looked like a
   real app bug until traced back to the stray processes. Before starting a fresh one, check
   `netstat -ano | grep LISTENING` (or equivalent) for leftover Node processes on 3000+ and
   kill them first.
4. **Prototype layout/UI changes in `architecture/layout/Layout-Workbench.html` before
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
   a browser, never an automated check. (Reason this was added: 2026-08-06, Plan 08 Phase 0 —
   a 330-line static-HTML mockup dispatch took 21.5 minutes, longer wall-clock than the same
   session's Phase 1, which shipped two new files, a full test suite, and real `npm
   test`/`tsc` cycles in 12.9 minutes — see `plans/08-prometheus-apply.md`'s Progress Log.)
5. **🔶 PROVISIONAL, added 2026-08-06 — ask before running any sanity/build/test check, in any
   task.** This covers `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run dev` started
   only to smoke-test something, or any equivalent verification command — whether about to be
   run directly, or as part of `@dev`'s Mode A step 3 ("Run a Sanity Check") or `@qa`'s
   testing pass. Do not run one automatically just because a plan step or an agent's own
   process calls for it — **stop first and ask the user** whether to run it now, or whether
   verification will happen outside this session/environment instead. Reason: the user wants
   to evaluate, case by case, whether running these checks here is worth it vs. doing so
   elsewhere, and this is a deliberate tightening while that's being worked out — **not a
   permanent process change**, revisit/relax when the user says so. Rule 2 (no real Anthropic
   API call without ask) and rule 3 (dev server off by default) already covered the two
   costliest/riskiest categories; this widens the same ask-first posture to ordinary
   test/build runs too.

## Folders

- **`architecture/`** — stable technical/conceptual reference docs (see Files below).
  Named deliberately *not* "design" (that read as visual-design-only, colliding with the
  `layout/` subfolder) — this covers product-why, technical-how, and UI layout together as
  one "how the system is built" story.
- **`architecture/layout/`** — the layout mockup (`Layout-Workbench.html`) + its original
  source sketch (`LayoutModel1.png`). Nested here (not a separate top-level folder) because
  UI layout is one facet of the system's architecture, not a wholly separate concern.
- **`architecture/audits/`** — historical adversarial-review records and reusable audit-prompt
  templates (`DesignReview.md`, `Fable-Audit-Brief.md`, `Fable-Review-1.md`). Kept separate
  from the actively-maintained docs; their findings are folded into `TechDesign.md`'s Rules
  Index, so nothing here is load-bearing on its own — it's the *why* behind rules that
  already exist elsewhere.
- **`docs/`** — user-facing documentation (`user-guide.md`). Not named `CLAUDE.md` —
  that name is reserved for internal folder-map docs; this one is for end users.
- **`plans/`** — build-sequence plans, distinct from `architecture/`'s stable docs. One file
  per plan, numbered (`01`–`06`, see Files below). Also holds one unnumbered, living
  file: **`plans/roadmap.md`** — **start here for "what's next."** TODO (core work + small
  layout adjustments needed before going online) vs. FUTURE (flexible priority, includes big
  layout redesigns and deployment-process maturity).
- **`lib/ai/prompts/system-agents/`** — the AI-facing rule-sets for the three platform
  agents (Hermes — Strict Import, Daedalus — Structural Import, Prometheus — chat), as
  source `.md` files in real-agent shape (YAML frontmatter + `#`-level sections, mirroring
  `architecture/Agent-Full-Reference.md`). **This is source code, not documentation** —
  moved out of `architecture/` (2026-07-29) because `scripts/build-prompts.ts` compiles it
  into `lib/ai/prompts/generated/*.ts` at build time; it lives next to that generated output
  rather than in a folder meant for passive reference material. See `lib/ai/CLAUDE.md`.
- **`lib/ai/`, `lib/import/`, `lib/serialize/`** — each has its own `CLAUDE.md`; see Files
  below.

## Files

- **`README.md`** (root) — quick-start, env vars, layout summary. User-facing entry point.
- **`CHANGELOG.md`** (root) — chronological project history. Start here for "what happened
  and when"; this file (`CLAUDE.md`) never carries dated narrative.
- **`architecture/Concept.md`** — the *what/why*. The problem, the product, who it's for,
  the killer feature, locked decisions, the canonical Claude-agent structure it mirrors, the
  real-library audit, the body schema, and the grouping model. Stable; rarely changes.
- **`architecture/TechDesign.md`** — the *how*. Design principles, the full data model, the
  **Agent Blueprint**, **system vs. user agents**, the serialization contract, the settled
  **decision drafts** (A/B/C), a **Rules Index** (every review-derived rule — type, exact
  file location, locked/deferred status), and a **Deferred decisions (roadmap)** table
  (items intentionally not built yet, each with a trigger for when to revisit). The single
  source of design truth — start here for anything implementation-related.
- **`architecture/Agent-Full-Reference.md`** — field-by-field annotated reference for the
  full Claude Code subagent frontmatter schema. Source for the Tier 1 Config zone's `hint`
  text.
- **`architecture/audits/DesignReview.md`** — the pre-build adversarial review (Fable 5,
  2026-07-24) that produced `TechDesign.md`'s Rules Index. Fully folded into `TechDesign.md`;
  kept as the historical record of *why* each rule exists.
- **`architecture/audits/Fable-Audit-Brief.md`** — the reusable prompt that produced that
  review. Kept so future audits can reuse the same brief.
- **`architecture/audits/Fable-Review-1.md`** — the audit prompt used for the Plan 02
  hardening pass (2026-07-28): a current-state audit of the built import pipeline plus a
  head-to-head comparison of two Structural Import rule-set drafts. Same historical role as
  `DesignReview.md`, for Plan 02 instead of Plan 01.
- **`lib/ai/prompts/system-agents/hermes.md`** — Hermes, the Strict Import agent (Stage 2:
  labels-only, never content). Real-agent shape: YAML frontmatter + `#`-level sections.
- **`lib/ai/prompts/system-agents/daedalus.md`** — Daedalus, the Structural Import agent
  (Stage 2b): sees full content and returns one restructured document body, not a mapping.
  Real-agent shape, same as Hermes.
- **`lib/ai/prompts/system-agents/prometheus.md`** — Prometheus, the chat agent (server-scoped
  to one agent per conversation, proposes changes to description/sections/config — never
  `name` — no tools, split-level heading guard). Real-agent shape, same as the other two.
- **`architecture/layout/Layout-Workbench.html`** — the *look*. Interactive, self-contained
  mockup of the settled 4-pane UI. Demos the `dev` agent across the panels. Authoritative
  behavior spec for any UI detail that needs re-checking, per standing rule 4.
- **`architecture/layout/LayoutModel1.png`** — the original hand-annotated layout sketch.
- **`docs/user-guide.md`** — task-oriented end-user guide: import (both modes), AI-chat
  edit, manual raw edit, groups, export, Settings/dry-run mode.
- **`plans/01-core-loop-implementation-plan.md`** — the structured view + agent-aware chat
  core loop, persistence, and the import pipeline's first build. Reviewed section-by-section
  before any code was written.
- **`plans/02-import-hardening-structural.md`** — hardened the Strict import pipeline and
  finished Structural Import (made it the primary/default mode).
- **`plans/03-library-groups-import-ui.md`** — visual-shell alignment, the Library panel,
  groups, and the import UI (mode picker, dialog).
- **`plans/04-llm-gateway-settings.md`** — the LLM provider gateway, dry-run mode, and the
  Settings page (activity log, the "Live LLM calls" toggle).
- **`plans/05-multi-tenant-auth.md`** — multi-tenant schema (`user` table, `ownerId`
  scoping), JWT auth, invite-code signup. **Reviewed 2026-07-30, built 2026-07-30** —
  all 11 §16 confirmation points resolved; implementation complete (Phases 0–6); real DB
  migrated. See `CHANGELOG.md` 2026-07-30 entry for full detail.
- **`plans/06-auth-review-google-oauth.md`** — the auth-framework review (roadmap TODO 2):
  fixes `middleware.ts`'s duplicated JWT verification, makes `SESSION_TTL_SECONDS` an env var,
  and adds Google OAuth 2.0 / OpenID Connect sign-in alongside password auth (invite-code gate
  still applies). Deliberately overrides Plan 05 §0's "no OAuth / social login" exclusion; also
  closes Plan 05's two 🔶 OPEN rate-limiter questions. **Reviewed 2026-07-31 (all six §16
  decision points resolved). Phases 0–4 built and committed 2026-07-31** (middleware fix +
  configurable TTL; OAuth foundations; `oauth_account` schema; the start/callback routes; the
  login/signup UI split + `GoogleButton`) — see `CHANGELOG.md` 2026-07-31 entry. **Phase 5**
  (live verification against real Google endpoints — needs a user-created Google Cloud OAuth
  client and explicit go-ahead per the standing no-real-external-call rule) **and Phase 6**
  (remaining doc sync) are not started.
- **`plans/07-prometheus-propose-apply.md`** — renamed the chat mediator to **Prometheus** and
  gave it a new output contract (`{ message, modifications, warnings }`) covering description
  and config, not just sections. Phases 0–2 built and gated 2026-08-05. Trimmed to what it
  actually built when the apply mechanism was split out; see `plans/08-*` for the rest.
- **`plans/08-prometheus-apply.md`** — the propose/apply split (`POST /api/chat` now writes
  nothing; `POST /api/agents/[id]/apply-proposal` does, including the config-merge fix), the
  client `'proposal'` interaction-lock + `localStorage` proposal store, and the ChatPanel UI.
  **Phases 0–3 and 5 built and verified 2026-08-06.** Phase 4 (live LLM verification of the
  propose/apply flow against the real Anthropic API) is **deferred, folded into**
  `plans/roadmap.md` TODO's pre-deploy "big flow test" item rather than run as its own step.
- **`plans/Evaluation-260730.md`** — a point-in-time outside opinion on the idea and
  project (requested by the user, 2026-07-30), not a build plan. Verdict: strong idea,
  good architecture, but infrastructure (multi-tenant auth) has outpaced dogfooding the
  core loop, and "deploy online" sits too late in the TODO ordering.
- **`lib/ai/CLAUDE.md`** — the gateway architecture (single choke point, one-SDK-importer
  rule), the three AI callers, and build-time prompt compilation.
- **`lib/import/CLAUDE.md`** — the import pipeline (Stage 1 deterministic split, Strict vs.
  Structural Stage 2, re-import reconciliation).
- **`lib/serialize/CLAUDE.md`** — the serialization round-trip contract (parse ↔ export).

## Notes

- Reference: the real agent library that seeded the design lives in `~/.claude/agents/`.
