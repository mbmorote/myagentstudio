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
   this app (this was the original reasoning for keeping it in TODO, and it still holds).
   Folds in TechDesign P04g (component tests for `ImportDialog`/`ChatPanel` specifically —
   same gap, not a separate item — the dry-run branches added in Plan 04 have no unit tests).
4. **Deploy online.** Get a version reachable outside the local network. Manual/simple for
   now (whatever the smallest real hosting step is); the *automated* version of this is
   CI/CD, tracked under FUTURE, not blocking this first deploy.

### Layout (small adjustments)

*(none open right now)*

## FUTURE — decided to build eventually, not prioritized

### Near-term product polish (moved out of TODO this pass)

- **"+custom key…" arbitrary config-key creation** — blocked on a product decision (a
  user-created key immediately gets flagged as `unknownConfigKeys`, contradicting the intent
  of letting the user create it). Not needed to safely go online. `CHANGELOG.md`'s
  2026-07-29 Tier 1 redesign entry has the detail.
- **Strict-mode merged-heading instability re-audit** — flagged unverified during Plan 02,
  never re-checked since. Lower risk than when first flagged: it only affects the secondary
  Strict import path, and Structural has been the default since Plan 02's hardening pass.
- **`scripts/build-prompts.ts` readable output** — TechDesign #26, tagged **[HIGH
  PRIORITY]** there (`scripts/build-prompts.ts` currently emits one giant escaped-string
  line, unreadable if anyone opens the generated file to sanity-check a compiled prompt).
  Moved here because it only affects internal debugging, not end users — but the HIGH
  PRIORITY tag was a deliberate signal from whoever flagged it, so don't let this quietly
  sink to the bottom of the list.
- **ESLint config** — script wired (`next lint`) but never configured; typecheck + tests are
  the real gate today. See also "Deployment maturity" below, where it fits thematically.

### Core features

- **Export translation to other platforms** (Copilot, etc.) — build-order #4. Real format
  translation, not a file copy.
- **Sharing / forking** — build-order #5. `ownerId` was the prerequisite this was waiting
  for — **now satisfied by Plan 05**.
- **Skill module** — build-order #6. Sibling entity to `Agent` for `SKILL.md` files;
  `TechDesign.md`'s Deferred Decisions table has the full real-schema field list already
  researched. Its own stated trigger (Agent-side Library/groups + this Blueprint refresh
  both landing) has already happened — ready to scope whenever it's picked up.
- **Organizations / teams** — `ownerId` currently means "a user." Making it "a principal"
  (org-owned agents, shared across a team) is a real remodel, not a tweak.
- **AI chat persistence** — a `Conversation`/`Message` table per agent, if chat should
  survive a page reload instead of staying ephemeral in-memory per session (current,
  deliberate MVP choice).

### TechDesign deferred decisions — each has its own explicit trigger, see `TechDesign.md` for the "why"

- **#8b** Storage target dialect (Postgres vs. Azure SQL) — revisit at the Azure step of the
  learning-goals roadmap, when a migration is actually happening.
- **#13** Catalog evolution: distinguish "never known" vs. "was known, catalog changed" —
  revisit once catalog-versioning infrastructure exists.
- **#14** Manual-edit save frequency: every save appends a `SectionRevision`, or debounced
  to meaningful edit boundaries — worth a quick check whether this was already effectively
  decided when the structured-view manual-edit save flow shipped (unclear from a quick pass
  over `SectionBlock.tsx`; needs someone to actually trace the save path).
- **#16** `AgentSnapshot(kind:'export')` capture point + an import/export diff-view UI — the
  export route this was waiting on is now built; ready to scope.
- **#18** `ConfigDef` platform-scoping (per-platform `model`/`tools`/etc. catalogs) — revisit
  when a second platform's import/create is actually being built.
- **#20** Display-label lookup for `model` (short label in UI, e.g. "Opus" instead of the
  full model ID; storage stays the full ID) — cosmetic, revisit next time the Tier 1 Config
  zone is touched.
- **#24** Propose-preview before applying a mediator rewrite (show the proposed change,
  require explicit "Apply") — revisit if apply-then-history ever feels too abrupt in real
  dogfooding use.
- **#30** AI-assisted config-key mapping (label a messy frontmatter key to its canonical
  `propKey`, same content-never-touched pattern as section classification) — revisit only if
  messy/nonstandard frontmatter keys turn out to be a real recurring papercut, not
  speculative.

### Plan 04's own deferred list

- **P04a** Second LLM provider (NVIDIA/OpenAI-compatible) — revisit once a real second
  provider is chosen, with a key and a model to test against.
- **P04b** Incremental streaming (`streamChunks()`, token-by-token chat) — revisit once
  streaming responses become a real UX requirement. Purely additive to `LLMProvider`.
- **P04c** Log retention / pruning / pagination — revisit past 5,000 `llm_call_log` rows or
  `myagent.db` exceeding ~200MB.
- **P04d** Cost estimation in currency on log rows — revisit once token counts stop being
  sufficient to answer "what did that cost."
- **P04e** "Replay this request" from a dry-run log row — the stored `requestPayload`
  already has everything needed; revisit if manual re-running becomes a papercut.
- **P04f** Settings modal instead of full-page navigation (avoids losing `ChatPanel`'s local
  message history on nav, same as an agent-switch remount) — revisit if that loss becomes an
  actual annoyance in real use.
- **P04h** Compliance-grade (non-droppable) logging — today a failed log write on a live
  call is deliberately swallowed (diagnostics, not an evidence ledger). Revisit only if the
  log is ever needed as evidence rather than a debugging aid.

### Layout (big changes)

- **Dedicated group-management view** — punch-list item 7. New panel, not started, not
  researched. Prototype in `Layout-Workbench.html` first per standing rule 4 whenever it's
  picked up.

### Deployment maturity (the process, not the first deploy)

- **CI/CD** — test → build → deploy automation. The automated counterpart to TODO item 4
  above; that item is "get something online," this is "stop doing it by hand."
- **Docker** — containerize once the app runs end-to-end online.
- **Azure / hosting infra maturity** — App Service first, K8s only if that ever becomes the
  actual goal; folds together with the storage-dialect decision (#8b) above.
- **ESLint config** — cross-referenced from "Near-term product polish" above, fits here
  thematically; not a separate item.

## IDEA — either not decided-if, or decided-but-not-how

Needs a product/design debate (the way the LLM-gateway question got one before it became
Plan 04) before any of these can move into FUTURE with an understood scope, let alone TODO.

- **Section-scoped chat selection** *(not decided-if)* — clicking a specific section (Role,
  Tools, etc.) in the structured view would scope/show that section's context in the chat
  panel, rather than chat always being agent-wide. In tension with a locked design decision:
  `TechDesign.md` Rules Index #7's supersession note explicitly widened the chat mediator
  from per-section to agent-wide scope (Plan 01 review, D2) on purpose. Revisiting this needs
  to engage with *why* that call was made, not just add a UI toggle — genuinely undecided
  whether this should happen at all.
- **JWT session configuration** *(decided-but-not-how)* — we want session length to not be
  permanently hardcoded, but Plan 05 §3.3 deliberately shipped a fixed 7-day, no-refresh,
  no-revocation default and confirmed it as drafted at review. What "configurable" means in
  practice — an env var, a System Settings field, per-user override — is undecided, and the
  scope is clearer once Plan 05 is fully live and any real friction from the fixed value
  shows up.
- **Presentation for prospective (non-signed-up) users** *(decided-but-not-how)* — a
  video/demo-style presentation showing how to import and edit an agent, for visitors
  without an account yet. Marketing/demo material, not interactive product UI — the "we want
  this" part is settled, the format/production isn't.
- **Interactive tour for signed-up users** *(decided-but-not-how)* — step-by-step, in-app,
  with explanations at each step, dismissible. Likely shown after first signup/login.
  Distinct from the presentation above, not a rephrasing of it — wanted, but the actual step
  sequence and trigger conditions aren't designed yet.
- **Optional call-log persistence toggle** *(not decided-if)* — a flag controlling whether
  `llm_call_log` entries actually get written to the database, or are shown only
  transiently/visually without being saved. A different axis from Plan 05's per-user hourly
  cap (§3.9) — not *how much* to store, but *whether* to persist at all — and it isn't
  settled that this is even worth the complexity yet.

## Recommended next stage

Plan 05 is done. TODO items 1–3 (the zero-agents Topbar gap, the `__raw` escape hatch,
component/UI test coverage) are small and independent — pick off in any order, or in
parallel. Item 4 (deploy online) is next per this file's own ordering rule once those are
clear, or sooner if you'd rather deploy first and treat 1–3 as immediate post-launch fixes.

Not recommended yet: anything under FUTURE or IDEA — FUTURE is either a second real effort
(export translation, sharing, Skill module) or explicitly paced to a trigger that hasn't
fired; IDEA needs a decision before it's even buildable.
