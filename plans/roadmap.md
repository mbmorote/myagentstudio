# MyAgent — Roadmap

Living index of open work, consolidated from `CHANGELOG.md`'s project history,
`architecture/TechDesign.md`'s Deferred Decisions table + Rules Index, and
`architecture/Concept.md`'s Build order. Unnumbered (not an `@architect`-written execution
spec). Deliberately zoomed-out — short bullets with pointers, not re-explained detail; the
*why* for each item lives at its original source, linked below. Update this file as items
move.

**Three buckets:** **TODO** = core work needed *before going online* (a deployed version
reachable outside the local network — not just localhost). It is ordered, and **"Deploy
online" is always the last item** — anything newly added to TODO gets sequenced before it,
never after. **FUTURE** = we've decided this should happen eventually and roughly understand
the scope, just not prioritized — free to reorder. **IDEA** = either **(a)** not yet decided
whether it should be built at all, or **(b)** decided we want it, but not sure yet *how* it
would actually work — the mechanism/design is still open. Either way it needs a product/design
debate before it can become a FUTURE item with an understood scope, let alone TODO. Each IDEA
entry below is tagged with which of the two applies.

**Layout work still prototypes first** — `architecture/layout/Layout-Workbench.html` before
live code, for iteration speed (see `CLAUDE.md` standing rule 4).

**Last reviewed:** 2026-07-30 — reorganized. Every item from `architecture/TechDesign.md`'s
Deferred Decisions table + Rules Index (previously compressed into one summary paragraph
here) is now its own line, sorted into TODO/FUTURE/IDEA. Duplicates between that table and
this file's pre-existing TODO items were merged (e.g. the `__raw` hatch, `build-prompts.ts`
output, and component-test-coverage items each existed in two places under different
framing). Several items moved bucket — see each entry for the reasoning; these are my
first-pass calls, not settled, flag anything that looks wrong. **Plan 05 (multi-tenant auth)
is done and verified** — all 6 phases built, retrofitted, tested (367/367, `tsc` clean), the
real `myagent.db` migrated and the real admin account bootstrapped, and the Phase 5.5/5.5b
checklist run twice (functionally via `curl`/SQL for everything request/response-shaped, and
via an actual browser pass for the five purely-visual items — consent-block prominence,
submit-blocking, the redacted-row "content hidden" marker, Topbar role-gating, and the
`?next=` redirect round-trip — all five passed). Moved into "What's built" below. Test data
was cleaned from the real DB afterward; only the admin account and the original agent
remain. `liveLlmCalls` is deliberately left `false` post-testing, not restored to `true`.
**One real bug surfaced during the browser pass, not by Plan 05 itself:** `app/page.tsx`'s
zero-agents empty state (pre-existing since Plan 03) renders with no Topbar at all — no way
to log out or reach Account — which was practically unreachable before real multi-tenant
signups existed. Added as a new TODO item below.

## Stability snapshot (as of last review)

Confirmed clean after Plan 04:
- `npx tsc --noEmit` — clean
- `npm test` — 186/186 passing before Plan 05 work started (up from 166 before Plan 04)
- `npm run build` — not re-run this session (no build-time behavior changed)
- No `TODO`/`FIXME`/`XXX` markers left in `app/`, `lib/`, or `scripts/`
- `myagent.db*` correctly gitignored, never touched by git
- **Verified 2026-07-30: no test in the suite can make a real Anthropic API call.** Every
  AI-touching test either mocks `anthropicProvider.js` directly, mocks the caller above the
  gateway (`chatMediator`/`importConverter`/`structuralConverter`), or uses
  `createGateway(fakeProvider)` — a DI seam that never instantiates the real provider at
  all. `getGateway()` (the real production singleton) is never called anywhere under
  `__tests__/`. `@anthropic-ai/sdk` is imported by exactly one file in the whole repo,
  enforced by `lib/ai/__tests__/architecture.test.ts`. This resolves the "audit: do any
  tests call the real LLM?" item that used to sit in Draft ideas below.

Known gaps in the stability net itself (not app bugs — gaps in how we'd *catch* one):
- **No ESLint config exists.** `npm run lint` (`next lint`) has never been configured —
  running it drops into an interactive "how would you like to configure ESLint?" prompt.
  The script is wired in `package.json` but is currently dead.
- **No component/UI tests.** All tests are `lib/`/`app/api/` — real business logic (import,
  serialize, blueprint rules, chat mediator, auth) is well covered; the React component tree
  (`AgentView.tsx`, `LibraryPanel.tsx`, `ImportDialog.tsx`, `ChatPanel.tsx`, etc.) has zero
  automated coverage, only manual live-browser verification per session.

## What's built

Condensed — full detail lives at each pointer, not repeated here.
- **Core loop** (structured view + agent-aware AI chat) — Concept build-order #1. `plans/01-*`.
- **Library + groups** (left panel, drag-and-drop, real `Group`/`Membership`) — build-order
  #2. `plans/03-*`, extended with the Agents/Grouped toggle.
- **Import**, both modes (Strict verbatim, Structural — default) — `plans/01-*` + `plans/02-*`.
- **Export, incl. the user-facing download** — `GET /api/agents/[id]/export` backs both the
  Raw pane's read-only preview and a "⇩ Download" button (`RawAgentView.tsx`, client-side
  Blob + `<a download>`, no new route). Download-only was the explicit choice over
  copy-to-clipboard or direct write-to-disk. Build-order #3 done.
- **Catalog seed drift, fixed at the root** — `AgentView.tsx` reads the full catalog from a
  `configCatalog` prop (`getConfigCatalog()`, `lib/db/repository/catalog.ts`) fetched fresh
  from the DB on every page request. `configDef` gained a `hint` column. `npm run db:seed`
  is wired into `predev`/`prebuild`. Net effect: edit `catalog.ts`, run `npm run db:seed`,
  reload the page — no rebuild/redeploy needed.
- **Blueprint catalog** refreshed against real Claude Code docs — `CHANGELOG.md`, 2026-07-28.
- **UI punch-list** (6/7), **Tier 1 Config zone redesign** (16/17), and the Library
  toggle/pill-cap/red-tier/panel-gap/MCP-pill batch — all in `CHANGELOG.md`.
- **Docs**: `README.md`, `docs/user-guide.md`, per-flow `lib/*/CLAUDE.md` files.
- **LLM Gateway + dry-run mode + Settings page** — Plan 04. Single choke point
  (`lib/ai/gateway.ts`), `LLMProvider` interface + `AnthropicProvider`,
  `setting`/`llm_call_log` tables, `GET|PATCH /api/settings`, `GET /api/llm-call-log` +
  `GET /api/llm-call-log/[id]`, `/settings` page with activity log and toggle, dry-run UI
  handling in `ImportDialog` + `ChatPanel`, fitness-function architecture test.
- **Multi-tenant schema + JWT auth** — Plan 05, done 2026-07-30. `user`/`invite_code`
  tables, owner-scoped repository layer (Rules Index #48–#50), JWT session (`lib/auth/`),
  invite-code signup, admin/user roles, opt-in per-row-snapshotted activity-log consent
  (§5.6), per-user rolling-hourly LLM cap (§3.9), System Settings vs. `/account` User
  Settings, `npm run auth:bootstrap` CLI (written from scratch this session — it was
  referenced in `package.json` but never actually implemented; builds its own DB connection
  since `lib/db/client.ts`/`lib/auth/password.ts` are `server-only`-guarded, same reason
  `lib/db/seed.ts` does the same). Real `myagent.db` migrated; real admin account live.
  `plans/05-multi-tenant-auth.md` has full detail; `plans/roadmap.md`'s own prior entry (this
  section) tracked it while in flight.

## TODO — before going online

Ordered. **"Deploy online" is always last** — anything else added here goes before it.
Flat list, no sub-headers — one section, one list, per the 2026-07-30 simplification pass.

1. **Zero-agents empty state has no Topbar.** `app/page.tsx`'s "No agents yet" branch
   (pre-existing since Plan 03) renders bare — no Topbar, no way to log out or reach
   Account, no UI path to import a first agent (only a bare mention of the API endpoint in
   text). Harmless in the single-tenant era (there was always at least one agent already);
   now a real dead-end every fresh signup hits first. Found during Plan 05's browser
   verification pass, 2026-07-30. Likely a small fix — wrap this branch in the same
   shell/Topbar the rest of the app uses.
2. **`__raw` frontmatter escape hatch.** Confirmed real, not hypothetical: a real
   `mcpServers` file with an inline nested server-config object hard-fails import with `400
   unsupported_frontmatter`. A beta user importing a real Claude Code agent that uses this
   pattern hits it on day one. TechDesign Rules Index #35/#40.
3. **Component/UI test coverage.** Zero automated coverage on the React component tree —
   only manual live-browser verification per session. Worth closing before more people touch
   this app. Folds in TechDesign P04g (component tests for `ImportDialog`/`ChatPanel`
   specifically — same gap, not a separate item — the dry-run branches added in Plan 04 have
   no unit tests).
4. **Auth framework review — JWT session config + OAuth 2.0 + OpenID Connect.** Added
   2026-07-30. Plan 05 shipped a fixed 7-day JWT session (no refresh, no revocation, §3.3) —
   check the whole auth structure end to end while it's fresh: whether session length should
   be configurable, and whether OAuth 2.0 / OpenID Connect (social login, an identity
   provider) belongs alongside email+password+invite-code. Not expected to be a big lift —
   this is a structured review of what's already built, not a redesign from zero.
5. **"+custom key…" arbitrary config-key creation, incl. removing one.** Was blocked on a
   product decision (a user-created key immediately gets flagged as `unknownConfigKeys`,
   contradicting the intent of letting the user create it). Scope broadened 2026-07-30: also
   cover *removing* a custom/JSON key, not just adding — half the feature without the other
   is awkward. `CHANGELOG.md`'s 2026-07-29 Tier 1 redesign entry has the original detail.
6. **`scripts/build-prompts.ts` readable output.** TechDesign #26, tagged **[HIGH
   PRIORITY]** there — currently emits one giant escaped-string line, unreadable if anyone
   opens the generated file to sanity-check a compiled prompt.
7. **AI chat persistence — verify current status before scoping.** Believed by the user to
   possibly already be done; **checked 2026-07-30, it is not** — `ChatPanel.tsx`'s `messages`
   is plain in-memory `useState`, no `localStorage`/DB persistence, chat still fully resets
   on reload or agent switch. If it should survive a reload, this needs an actual
   `Conversation`/`Message` table per agent (a real schema addition), not a small fix.
8. **Section-scoped chat selection.** Moved from IDEA 2026-07-30 — clicking a specific
   section (Role, Tools, etc.) in the structured view would scope/show that section's
   context in the chat panel, instead of chat always being agent-wide. Directly reopens a
   locked decision: `TechDesign.md` Rules Index #7's supersession note deliberately widened
   the chat mediator from per-section to agent-wide scope (Plan 01 review, D2). Building this
   means consciously reversing or qualifying that call, not just adding a UI toggle on top of
   it — read the supersession note's own reasoning before starting.
9. **Review the chat-mediator system agent.** `lib/ai/prompts/system-agents/chat-mediator.md`
   — its rule-set hasn't had a dedicated review pass since it was widened to agent-wide scope
   (Plan 01 review, 2026-07-26). Natural to do together with item 8 above, since re-scoping
   to per-section touches exactly this file's Guardrails, but worth reviewing as its own
   pass even independent of that decision.
10. **Deploy online.** Get a version reachable outside the local network. Manual/simple for
    now (whatever the smallest real hosting step is); the *automated* version of this is
    CI/CD, tracked under FUTURE, not blocking this first deploy.

## FUTURE — decided to build eventually, not prioritized

Flat list, no sub-headers. Everything here either has a clear-enough scope to build when
picked up, or an explicit trigger to revisit at. Full "why" for the TechDesign-numbered ones
lives in `TechDesign.md`'s Deferred Decisions table / Rules Index.

- **Strict-mode merged-heading instability re-audit** — flagged unverified during Plan 02,
  never re-checked since. Lower risk than when first flagged: only affects the secondary
  Strict import path, Structural has been default since Plan 02.
- **ESLint config** — script wired (`next lint`) but never configured; typecheck + tests are
  the real gate today.
- **Export translation to other platforms** (Copilot, etc.) — build-order #4. Real format
  translation, not a file copy.
- **Sharing / forking** — build-order #5. `ownerId` was the prerequisite this was waiting
  for — now satisfied by Plan 05.
- **Skill module** — build-order #6. Sibling entity to `Agent` for `SKILL.md` files; full
  real-schema field list already researched in `TechDesign.md`. Trigger (Agent-side
  Library/groups + Blueprint refresh both landing) already happened — ready to scope.
- **#8b Storage target dialect** (Postgres vs. Azure SQL) — revisit at the Azure step of the
  learning-goals roadmap, when a migration is actually happening. **Not close yet**: this
  app is single-file SQLite (`better-sqlite3`), single-process, and the first deploy target
  is a handful of friends (`maxUsers` currently 5) — that's comfortably within SQLite's
  range. The real trigger isn't user count, it's the *hosting choice* for "deploy online"
  (TODO item 8): a host with a persistent disk (Fly.io, a VM, Azure App Service with a
  mounted volume) keeps SQLite working fine; a stateless/serverless host (e.g. Vercel's
  default) would force this decision immediately rather than later. Worth deciding the
  hosting target with this in mind, not migrating pre-emptively.
- **#13 Catalog evolution** — distinguish "never known" vs. "was known, catalog changed";
  revisit once catalog-versioning infrastructure exists.
- **#14 Manual-edit save frequency** — every save appends a `SectionRevision`, or debounced
  to meaningful edit boundaries; worth a quick check whether this was already effectively
  decided when manual editing shipped (unclear from a quick pass over `SectionBlock.tsx`).
- **#16 `AgentSnapshot(kind:'export')` capture + import/export diff-view UI** — the export
  route this was waiting on is now built; ready to scope.
- **#18 `ConfigDef` platform-scoping** (per-platform `model`/`tools`/etc. catalogs) — revisit
  when a second platform's import/create is actually being built.
- **#20 Display-label lookup for `model`** (short label in UI, e.g. "Opus" instead of the
  full ID; storage stays the full ID) — cosmetic, revisit next time the Tier 1 Config zone is
  touched.
- **#24 Propose-preview before applying a mediator rewrite** (show the proposed change,
  require explicit "Apply") — revisit if apply-then-history ever feels too abrupt in real
  dogfooding use. **Refined 2026-07-30:** make this a per-user setting, not a single global
  toggle — a "confirm before applying" preference. If off: the mediator applies directly to
  the agent being edited, exactly as it does today. If on: the proposed response is shown in
  a modal first, and nothing is written until the user explicitly applies it. Same underlying
  mechanism either way (apply-then-history), just gated behind a per-user choice instead of
  an all-or-nothing behavior change.
- **#30 AI-assisted config-key mapping** (label a messy frontmatter key to its canonical
  `propKey`, same content-never-touched pattern as section classification) — revisit only if
  messy/nonstandard frontmatter keys turn out to be a real recurring papercut.
- **P04a Second LLM provider** (NVIDIA/OpenAI-compatible) — revisit once a real second
  provider is chosen, with a key and a model to test against.
- **P04b Incremental streaming** (`streamChunks()`, token-by-token chat) — revisit once
  streaming responses become a real UX requirement.
- **P04c Log retention / pruning / pagination** — revisit past 5,000 `llm_call_log` rows or
  `myagent.db` exceeding ~200MB.
- **P04d Cost estimation in currency on log rows** — revisit once token counts stop being
  sufficient to answer "what did that cost."
- **P04e "Replay this request" from a dry-run log row** — the stored `requestPayload` has
  everything needed; revisit if manual re-running becomes a papercut.
- **P04f Settings modal instead of full-page navigation** (avoids losing `ChatPanel`'s local
  message history on nav) — revisit if that loss becomes an actual annoyance in real use.
- **P04h Compliance-grade (non-droppable) logging** — today a failed log write on a live call
  is deliberately swallowed (diagnostics, not an evidence ledger). Revisit only if the log is
  ever needed as evidence rather than a debugging aid.
- **Dedicated group-management view** — punch-list item 7. New panel, not started, not
  researched. Prototype in `Layout-Workbench.html` first per standing rule 4 whenever it's
  picked up.
- **CI/CD** — test → build → deploy automation. The automated counterpart to TODO item 8; that
  item is "get something online," this is "stop doing it by hand."
- **Docker** — containerize once the app runs end-to-end online.
- **Azure / hosting infra maturity** — App Service first, K8s only if that ever becomes the
  actual goal; folds together with the storage-dialect item above.

## IDEA — either not decided-if, or decided-but-not-how

Flat list, no sub-headers. Needs a product/design debate (the way the LLM-gateway question
got one before it became Plan 04) before any of these can move into FUTURE with an
understood scope, let alone TODO. Each entry tagged with which case applies.

- **Organizations / teams** *(decided-but-not-how)* — `ownerId` currently means "a user."
  Making it "a principal" (org-owned agents, shared across a team) is a real remodel, and
  there's no concrete design yet for what that remodel looks like.
- **Presentation for prospective (non-signed-up) users** *(decided-but-not-how)* — a
  video/demo-style presentation showing how to import and edit an agent, for visitors
  without an account yet. The "we want this" part is settled, the format/production isn't.
- **Interactive tour for signed-up users** *(decided-but-not-how)* — step-by-step, in-app,
  dismissible, likely after first signup/login. Wanted, but the step sequence and trigger
  conditions aren't designed yet.
- **Optional call-log persistence toggle** *(not decided-if)* — a flag controlling whether
  `llm_call_log` entries get written to the database at all, vs. shown only transiently. Not
  settled that this is worth the complexity yet.
- **MCP server exposing MyAgent's agents** *(not decided-if)* — added 2026-07-30. An MCP
  server so Claude (Claude Code, Claude Desktop, etc.) could access and update a user's
  agents directly from outside the web UI, instead of only through the app's own chat panel.
  Brand new idea, not yet debated: would need its own auth story (an MCP client isn't a
  browser session — API keys? OAuth?), and raises the same guardrail questions the chat
  mediator already has to answer (scope, tools, no-fabricated-headings) but for a client the
  platform doesn't control the prompt of. Needs real design thought before it's even a
  FUTURE item.

## Recommended next stage

Plan 05 is done. TODO items 1–9 are independent enough to pick off in any order, or in
parallel — item 10 (deploy online) is next per this file's own ordering rule once those are
clear, or sooner if you'd rather deploy first and treat 1–9 as immediate post-launch fixes.
Items 8 and 9 are naturally paired (both touch the chat mediator's scope/rule-set) but
neither blocks the other.

Not recommended yet: anything under FUTURE or IDEA — FUTURE is either a second real effort
(export translation, sharing, Skill module) or explicitly paced to a trigger that hasn't
fired; IDEA needs a decision before it's even buildable.
