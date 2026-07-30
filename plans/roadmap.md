# MyAgent — Roadmap

Living index of open work, consolidated from `CHANGELOG.md`'s project history,
`design/TechDesign.md`'s Deferred Decisions table, and `design/Concept.md`'s Build order.
Unnumbered (not an `@architect`-written execution spec). Deliberately zoomed-out — short
bullets with pointers, not re-explained detail; the *why* for each item lives at its
original source, linked below. Update this file as items move.

**Two buckets, not tiers:** **TODO** = core work and small layout adjustments needed
*before going online* (a deployed version reachable outside the local network — not just
localhost). **FUTURE** = everything else — flexible priority, can be reordered freely,
includes big layout redesigns and deployment-process maturity (CI/CD, Docker). An item can
move between the two buckets as priorities shift; nothing here is a locked sequence.

**Layout work still prototypes first** — `design/layout/Layout-Workbench.html` before live
code, for iteration speed (see `CLAUDE.md` standing rule 4). That workflow rule persists;
the dedicated hand-off file it used to route through (`plans/layout-prototype-todo.md`) was
retired 2026-07-29 — its one open slot was empty and its migrated-item history is already in
`CHANGELOG.md` and git history. Layout items just live directly below now, tagged.

**Last reviewed:** 2026-07-29, after Plan 04 (LLM Gateway, dry-run mode, Settings page)
landed. Plan 04 added the gateway, provider abstraction, `setting`/`llm_call_log` tables,
Settings page + activity log, and dry-run UI handling — see `CHANGELOG.md` for full detail.

## Stability snapshot (as of last review)

Confirmed clean after Plan 04:
- `npx tsc --noEmit` — clean
- `npm test` — 186/186 passing (up from 166 before Plan 04; 20 new tests)
- `npm run build` — not re-run this session (no build-time behavior changed)
- No `TODO`/`FIXME`/`XXX` markers left in `app/`, `lib/`, or `scripts/`
- `myagent.db*` correctly gitignored, never touched by git

Known gaps in the stability net itself (not app bugs — gaps in how we'd *catch* one):
- **No ESLint config exists.** `npm run lint` (`next lint`) has never been configured —
  running it drops into an interactive "how would you like to configure ESLint?" prompt.
  The script is wired in `package.json` but is currently dead. Low urgency (typecheck +
  tests are the real gate today) but worth fixing before the codebase gets much bigger.
- **No component/UI tests.** All 132 tests are `lib/`/`app/api/` — real business logic
  (import, serialize, blueprint rules, chat mediator) is well covered; the React component
  tree (`AgentView.tsx`, `LibraryPanel.tsx`, etc.) has zero automated coverage, only manual
  live-browser verification per session. Has held up fine so far given the size of the UI,
  but is worth naming honestly rather than assuming "132 passing" means full coverage.

## What's built

Condensed — full detail lives at each pointer, not repeated here.
- **Core loop** (structured view + agent-aware AI chat) — Concept build-order #1. `plans/01-*`.
- **Library + groups** (left panel, drag-and-drop, real `Group`/`Membership`) — build-order
  #2. `plans/03-*`, extended this session with the Agents/Grouped toggle.
- **Import**, both modes (Strict verbatim, Structural — default) — `plans/01-*` + `plans/02-*`.
- **Export, incl. the user-facing download** — `GET /api/agents/[id]/export` backs both the
  Raw pane's read-only preview and a new "⇩ Download" button (`RawAgentView.tsx`, client-side
  Blob + `<a download>`, no new route). Download-only was the explicit choice over
  copy-to-clipboard or direct write-to-disk. Build-order #3 done.
- **Catalog seed drift, fixed at the root** — `AgentView.tsx` no longer statically imports
  `CONFIG_DEFS`; it reads the full catalog from a `configCatalog` prop
  (`getConfigCatalog()`, `lib/db/repository/catalog.ts`) fetched fresh from the DB on every
  page request (`app/agents/[id]/page.tsx` → `WorkbenchShell` → `AgentView`). `configDef`
  gained a `hint` column (migration `0001_curved_sandman.sql`) so nothing was lost in the
  move. `npm run db:seed` is now also wired into `predev`/`prebuild`. Net effect: edit
  `catalog.ts`, run `npm run db:seed`, reload the page — no rebuild/redeploy needed.
  Verified live by patching a `config_def.hint` row directly in the DB and confirming a
  plain page reload picked it up with the dev server never restarted.
- **Blueprint catalog** refreshed against real Claude Code docs — `CHANGELOG.md`, 2026-07-28.
- **UI punch-list** (6/7), **Tier 1 Config zone redesign** (16/17), and the Library
  toggle/pill-cap/red-tier/panel-gap/MCP-pill batch — all in `CHANGELOG.md`.
- **Docs**: `README.md`, `docs/user-guide.md`, per-flow `lib/*/CLAUDE.md` files.
- **LLM Gateway + dry-run mode + Settings page** — Plan 04. Single choke point (`lib/ai/gateway.ts`), `LLMProvider` interface + `AnthropicProvider`, `setting`/`llm_call_log` tables, `GET|PATCH /api/settings`, `GET /api/llm-call-log` + `GET /api/llm-call-log/[id]`, `/settings` page with activity log and toggle, dry-run UI handling in `ImportDialog` + `ChatPanel`, fitness-function architecture test. 186/186 tests, `tsc` clean. Deferred items: second provider, incremental streaming, log retention/pruning, cost estimation, replay-from-log, settings modal, component tests, compliance-grade logging — all in `TechDesign.md` Deferred Decisions (P04a–P04h).

## TODO — before going online

### Core

1. **Plan B — multi-tenant schema + JWT auth.** `@analyst`, `@impact`, and `@architect` are
   all done. **The plan is written: `plans/05-multi-tenant-auth.md`** (16 sections, matches
   Plan 04's shape) — verified real, not yet reviewed with the user. **Next step: a
   section-by-section walk through §16's 11 confirmation points**, same process Plan 04 got,
   before `@dev` starts. The single biggest one is §16.6 — the plan enforces ownership in
   the repository layer (14 changed function signatures) rather than at the route layer as
   the approved `@analyst` task description specified; flagged as the one deviation most
   worth pushing back on if the reasoning doesn't land. This is the prerequisite for a safe
   public deploy (friends' data isolated from each other).
2. **Deploy online** — get a version reachable outside the local network. Manual/simple for
   now (whatever the smallest real hosting step is); the *automated* version of this is
   CI/CD, tracked under Future below, not blocking this first deploy.
3. **`__raw` frontmatter escape hatch** — a real `mcpServers` file with an inline nested
   server-config object still hits a hard `unsupported_frontmatter` 400 on import, confirmed
   real via the Blueprint catalog refresh session. `TechDesign.md` Deferred Decisions #40.
4. **"+ custom key…" arbitrary config-key creation** — blocked on one product decision (a
   user-created key immediately gets flagged as `unknownConfigKeys`, contradicting the intent
   of letting the user create it). `CHANGELOG.md`'s 2026-07-29 Tier 1 redesign entry has
   the detail.
5. **Strict-mode merged-heading instability / adversarial-file re-audit** — flagged during
   Plan 02 as unverified, never re-checked since.
6. **ESLint config** — see Stability snapshot above; script exists, never configured.
7. **`scripts/build-prompts.ts` readable output** — `TechDesign.md` Deferred Decisions #26,
   marked **[HIGH PRIORITY]** there — currently an escaped single-line string, hard to debug.
8. **Component/UI test coverage** — see Stability snapshot above. Real gap, not urgent on
   its own, but worth closing before more people touch this app.

### Layout (small adjustments)

*(none open right now)*

## FUTURE — flexible priority, not blocking going online

### Core features

- **Export translation to other platforms** (Copilot, etc.) — build-order #4. Real format
  translation, not a file copy.
- **Sharing / forking** — build-order #5.
- **Skill module** — build-order #6. Sibling entity to `Agent` for `SKILL.md` files;
  `TechDesign.md` Deferred Decisions table has the field list already researched.
- Everything in `TechDesign.md`'s Deferred Decisions table with its own explicit trigger:
  storage dialect (#8b), catalog versioning (#13), manual-edit save frequency (#14),
  export-kind `AgentSnapshot` + diff view (#16), per-platform `ConfigDef` scoping (#18),
  `model` display-label lookup (#20), propose-preview before mediator rewrites (#24),
  AI-assisted config-key mapping (#30), and Plan 04's own deferred list (second provider,
  incremental streaming, log retention/pruning, cost estimation, replay-from-log, settings
  modal, component tests for `ImportDialog`/`ChatPanel`, compliance-grade logging — P04a–P04h).

### Layout (big changes)

- **Dedicated group-management view** — punch-list item 7. New panel, not started, not
  researched. Genuinely new scope, not a tweak — prototype it in `Layout-Workbench.html`
  first per standing rule 4 whenever it's picked up.

### Deployment maturity (the process, not the first deploy)

- **CI/CD** — test → build → deploy automation. The automated counterpart to TODO item 2
  above; that item is "get something online," this is "stop doing it by hand."
- **Docker** — containerize once the app runs end-to-end online.
- **Azure / hosting infra maturity** — App Service first, K8s only if that ever becomes the
  actual goal; folds together with the storage-dialect decision (#8b) above.

## Draft ideas — captured, not yet debated or triaged

Raised 2026-07-29 while reviewing `plans/05-multi-tenant-auth.md`'s scope — explicitly
**not** designed or decided yet, just saved so they aren't lost before "going full mode" on
the next plan. Needs its own debate pass (like the LLM-gateway one that produced Plan 04)
before any of these move into TODO or FUTURE.

**Product/UX:**
- **Section-scoped chat selection** — clicking a specific section (Role, Tools, etc.) in the
  structured view would scope/show that section's context in the chat panel, rather than
  chat always being agent-wide. Worth flagging early: this is in tension with a locked
  design decision — `TechDesign.md` Rules Index #7's supersession note explicitly widened
  the chat mediator from per-section to agent-wide scope (Plan 01 review, D2) on purpose.
  Revisiting this needs to engage with *why* that call was made, not just add a UI toggle.
- **JWT configuration** — exact scope still unclear; likely overlaps
  `plans/05-multi-tenant-auth.md` §16.9 (currently proposes a fixed 7-day session, no
  refresh, no server-side revocation) — may be about making that configurable rather than
  fixed. Needs clarifying next time.
- **Presentation for prospective (non-signed-up) users** — a video/demo-style presentation
  showing how to import and edit an agent, for visitors without an account yet. Marketing/
  demo material, not interactive product UI.
- **Interactive tour for signed-up users** — step-by-step, in-app, with explanations at each
  step, dismissible ("close on"). Likely shown after first signup/login. The interactive
  counterpart to the presentation above — confirmed as two genuinely separate ideas, not a
  rephrasing of one.

**Ops / cost control / testing:**
- **Per-user usage caps** — a setting for max tokens and/or max LLM calls per user. Cost
  control once multi-tenant; pairs with `plans/05-multi-tenant-auth.md`'s `maxUsers` cap
  (total registered users) as a different axis (per-user spend, not headcount) and with
  Plan A's `setting`/`SETTING_DEFS` mechanism as the likely storage.
- **Audit: do any existing tests call the real LLM?** A verification pass over every test
  file to confirm the standing rule 2 mocking pattern (`vi.mock('.../ai/*.js', ...)`) is
  actually applied everywhere, not assumed. Cheap, no design decision needed — could be done
  standalone, not blocked on anything else here.
- **Optional call-log persistence** — a flag controlling whether `llm_call_log` entries
  actually get written to the database, or are shown only transiently/visually without being
  saved. Revisits Plan 04 §16.5's decision (unbounded storage, no size cap) on a different
  axis — not *how much* to store, but *whether* to persist at all.

## Recommended next stage

**Plan B (TODO item 1)** is the natural next step — `plans/05-multi-tenant-auth.md` is
written and waiting on the user's section-by-section review (§16, 11 points) before `@dev`
starts. TODO items 3–8 are cheap, independently-diagnosed papercuts worth picking off in
parallel or as a break from Plan B's size, not sequenced before it.

Not recommended yet: anything under Future — each is either a second real effort (export
translation, sharing, Skill module) or explicitly paced to arrive later (deployment-process
maturity, once something is actually deployed to make CI/CD and Docker worth building for).
