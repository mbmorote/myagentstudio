# MyAgent — Roadmap

Living index of open work, consolidated from `CHANGELOG.md`'s project history,
`architecture/TechDesign.md`'s Deferred Decisions table + Rules Index, and
`architecture/Concept.md`'s Build order. Unnumbered (not an `@architect`-written execution
spec). Deliberately zoomed-out — short bullets with pointers, not re-explained detail; the
*why* for each item lives at its original source, linked below. Update this file as items
move.

**Four buckets, in priority order:** **TODO** = must be done *before* v1 goes online (a
deployed version reachable outside the local network — not just localhost). Ordered, and
**"Deploy online" is always the last item** — anything newly added to TODO gets sequenced
before it, never after. **NEXT** = decided and scoped, but deliberately deferred to right
after v1 launches — a "ship now, harden fast" set: real user feedback on a live "beta" matters
more than finishing this before anyone sees it. **FUTURE** = decided this should happen
eventually and roughly understood, just not prioritized — free to reorder. **IDEA** = either
**(a)** not yet decided whether it should be built at all, or **(b)** decided we want it, but
not sure yet *how* it would actually work — needs a product/design debate before it can become
a FUTURE/NEXT item with an understood scope, let alone TODO. Items originally logged as IDEA
that have since been given a timing tier still carry their original (a)/(b) tag inline — a
timing decision is not the same as a design decision.

**Layout work still prototypes first** — `architecture/layout/Layout-Workbench.html` before
live code, for iteration speed (see `CLAUDE.md` standing rule 4).

**Last updated:** 2026-07-31 — full retriage at the user's request. Every open TODO/FUTURE/IDEA
item (40 total) was flattened into `plans/roadmap-priority-260731.md` (a temporary triage
file — id/topic/explanation columns filled by the assistant, a classification number filled
by the user: **1 = before v1 online, 2 = soon after v1 launches, 3 = long-tail/low urgency**)
and re-sorted here on that basis. This introduces the new **NEXT** bucket (tier 2) — timing
work "soon after launch" was previously conflated with unprioritized FUTURE work, which lost
the distinction. Net effect on the previous 2026-07-31 TODO list: **Component/UI test
coverage** flips from "just before deploy" to **first thing done after deploy** — the user's
call, on the reasoning that a "beta" audience can tolerate a couple of early bugs, so it's
better to ship and harden against real usage than delay for pre-launch test coverage; **Doc
sync** and **readable `build-prompts.ts` output** stay as the last two steps *before* deploy
(the latter promoted from FUTURE — the user wants to be able to audit the real compiled system
prompt once live users are on it); five items promoted from FUTURE straight into TODO tier 1
(ESLint config, manual-edit save frequency, display-label lookup for `model`, propose-preview
before applying a mediator rewrite, second LLM provider, incremental streaming, Settings modal
— see each item below for why); four former-IDEA items (demo for prospective users, interactive
tour, optional log-persistence toggle, MCP server) and one former-IDEA item (organizations/
teams) were given timing tiers (NEXT and FUTURE respectively) while keeping their unresolved
design-decision caveat. Two open threads flagged during triage, not yet resolved: **AI chat
persistence** (tier 2) — cookie/localStorage vs. a real `Conversation`/`Message` DB table is
still an open implementation choice, deliberately deferred; **compliance-grade logging**
(tier 2) — the user wants to gauge real-user impact before deciding if this is worth building
at all. Also carried forward from the same-day auth-framework-review closure: Phase 5.4
(`SESSION_TTL_SECONDS` live check) sits in NEXT now, not FUTURE, per the same tier-2 logic.

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
- **Zero-agents empty state now has a Topbar** — 2026-07-31, was TODO item 1. `app/page.tsx`'s
  "No agents yet" branch now renders `WorkbenchShell` with `initialAgent={null}` instead of a
  bare div. `WorkbenchShell`'s Viz/Chat/Raw panels already had null-agent fallbacks built in
  (including "Import an agent via ⇪ Import agent to get started" text) — they were simply
  unreachable dead code until now. The one real gap: `WorkbenchShell` only rendered
  `LibraryPanel` (which owns the actual Import/New-agent/New-group buttons) when an agent was
  loaded; fixed by making `LibraryPanel`/`GroupSection`'s `currentAgentId` prop optional and
  always rendering it. `tsc --noEmit` clean, 367/367 tests passing. **Not yet verified live in
  a browser** — the only accounts in the real DB are the admin (with the one real agent), and
  checking this would require a second zero-agent signup that writes to the real DB; skipped
  pending the user's OK rather than mutating real data unasked.
- **`__raw` frontmatter escape hatch — built as a real `datatype: 'json'`, not a raw-blob
  hatch** — 2026-07-31, was TODO item 2. Original scope was importing an `mcpServers` file
  with an inline nested server-config object (`400 unsupported_frontmatter`); scope grew
  during review into a proper general mechanism. `parseFrontmatter.ts` no longer hard-rejects
  a nested mapping/list — `FrontmatterEntry.rawValue` now allows `Record<string, unknown> |
  unknown[]` alongside the original `string | string[]`; only genuinely unparseable YAML
  (A2) still throws. `hooks` (`datatype: 'any'`) and `mcpServers` (`datatype: 'list'`, with a
  hardcoded `key === 'mcpServers'` UI special-case) both moved to a new, real `datatype:
  'json'` — a general mechanism any catalog key can use, not hardcoded to these two.
  `AgentView.tsx`'s old `CUSTOM_BLOCK_KEYS = new Set(['hooks', 'mcpServers'])` hardcoded set
  is gone, replaced by deriving the set from the catalog's `datatype === 'json'` keys.
  **Bonus fix, found during review, not part of the original scope:** `serializeAgentSnapshot`
  (`lib/db/repository/agents.ts`) was `JSON.stringify`-ing any non-string/non-string-array
  config value on export — meaning an agent's `hooks`/`mcpServers` block, even one created
  entirely inside MyAgent with no import involved, exported as a quoted JSON-string scalar
  (`hooks: '{"PreToolUse":...}'`), not valid nested YAML. Real bug, now fixed — nested values
  export as real YAML via `yaml.dump`. `skills` deliberately stayed `datatype: 'list'` (no
  evidence of a nested/inline skills schema in the real docs) after explicit review with the
  user. `datatype: 'json'` added to the DB schema's `configDef.datatype` enum (TS-only
  constraint on a SQLite text column — no migration needed) and synced to the real DB via
  `npm run db:seed` (catalog metadata only, no agent data touched). TechDesign Rules Index
  #35/#39/#40 and the Deferred Decisions table's `__raw` row updated to reflect the
  supersession. `tsc --noEmit` clean, 368/368 tests passing (2 new/rewritten covering the
  nested-value parse and round-trip cases, replacing the old throw-on-nested-map test).
- **Auth framework review — JWT session config + OAuth 2.0 + OpenID Connect** — Plan 06,
  `plans/06-auth-review-google-oauth.md`, was TODO item 2. Three workstreams: **(A)** fixed
  `middleware.ts` duplicating JWT verification instead of reusing `lib/auth/jwt.ts` (commit
  `1d77019`); **(B)** promoted `SESSION_TTL_SECONDS` to an env var, 7-day default unchanged
  (commit `1d77019`); **(C)** real **Google OAuth 2.0 / OpenID Connect sign-in** alongside
  password auth — `arctic` behind this repo's own provider seam, `id_token` verified with
  `jose`, a new `oauth_account` table, invite-code gate still applying to OAuth signups
  (commits `ea2867f`/`a937297`/`9aee4bf`/`d1a29cc`). **Phase 5.3, the live pass against real
  Google endpoints, done 2026-07-31**: real Google Cloud OAuth client, login/auto-link/
  new-account-signup/login-mode-refusal paths all confirmed against real Google
  infrastructure. Auto-linking a Google sign-in to an existing account on a verified email is
  accepted for all domains, including Google Workspace — the domain-takeover residual risk is
  knowingly accepted, with a revisit trigger recorded (Plan 06 §3.7/§16.5, Rules Index #72).
  **Two follow-ups spun out, not part of this item's closure:** Phase 5.4 (live
  `SESSION_TTL_SECONDS` check) now sits in NEXT; the remaining Phase 6 doc sync is TODO.

## TODO — before v1 goes online

Ordered. **"Deploy online" is always last** — anything else added here goes before it.
Retriaged 2026-07-31 (`plans/roadmap-priority-260731.md`, tier 1) — this bucket now means
strictly "must happen before v1 launches," not a general importance ranking; several items
here were promoted from FUTURE on that basis, tagged below.

1. **"+custom key…" arbitrary config-key creation, incl. removing one.** Was blocked on a
   product decision (a user-created key immediately gets flagged as `unknownConfigKeys`,
   contradicting the intent of letting the user create it). Scope broadened 2026-07-30: also
   cover *removing* a custom/JSON key, not just adding — half the feature without the other
   is awkward. `CHANGELOG.md`'s 2026-07-29 Tier 1 redesign entry has the original detail.
2. **Section-scoped chat selection.** Moved from IDEA 2026-07-30 — clicking a specific
   section (Role, Tools, etc.) in the structured view would scope/show that section's
   context in the chat panel, instead of chat always being agent-wide. Directly reopens a
   locked decision: `TechDesign.md` Rules Index #7's supersession note deliberately widened
   the chat mediator from per-section to agent-wide scope (Plan 01 review, D2). Building this
   means consciously reversing or qualifying that call, not just adding a UI toggle on top of
   it — read the supersession note's own reasoning before starting.
3. **Review the chat-mediator system agent.** `lib/ai/prompts/system-agents/chat-mediator.md`
   — its rule-set hasn't had a dedicated review pass since it was widened to agent-wide scope
   (Plan 01 review, 2026-07-26). Natural to do together with item 2 above, since re-scoping
   to per-section touches exactly this file's Guardrails, but worth reviewing as its own
   pass even independent of that decision.
4. **ESLint config.** *(Promoted from FUTURE 2026-07-31.)* Script wired (`next lint`) but
   never configured — running it drops into an interactive setup prompt. Typecheck + tests
   are the real gate today; this closes that gap before real users touch the app.
5. **Manual-edit save frequency.** *(Promoted from FUTURE 2026-07-31 — was Deferred
   Decisions #14.)* Resolved during triage: **the user wants an explicit Save action**, not
   autosave-on-every-keystroke or a debounced background save. Worth a quick check whether
   this was already effectively decided when manual editing shipped (unclear from a quick
   pass over `SectionBlock.tsx`) before implementing.
6. **Display-label lookup for `model`.** *(Promoted from FUTURE 2026-07-31 — was Deferred
   Decisions #20.)* Short label in the UI (e.g. "Opus" instead of the full model ID); storage
   stays the full ID. Cosmetic but decided worth doing before launch rather than after.
7. **Propose-preview before applying a mediator rewrite.** *(Promoted from FUTURE 2026-07-31
   — was Deferred Decisions #24.)* Per-user setting, not a global toggle: off = the mediator
   applies directly to the agent being edited, exactly as today; on = the proposed response is
   shown in a modal first, nothing written until the user explicitly applies it. Same
   underlying mechanism either way (apply-then-history), gated behind the per-user choice.
8. **Second LLM provider.** *(Promoted from FUTURE 2026-07-31 — was P04a.)* A non-Anthropic,
   OpenAI-compatible or NVIDIA provider behind the existing `LLMProvider` interface.
9. **Incremental streaming.** *(Promoted from FUTURE 2026-07-31 — was P04b.)* Token-by-token
   chat responses (`streamChunks()`) instead of waiting for the full reply.
10. **Settings modal instead of full-page navigation.** *(Promoted from FUTURE 2026-07-31 —
    was P04f.)* Avoids losing `ChatPanel`'s local message history when a user opens Settings.
11. **`scripts/build-prompts.ts` readable output.** TechDesign #26, tagged **[HIGH
    PRIORITY]** there — currently emits one giant escaped-string line. Sequenced as the
    second-to-last step before deploy: the user wants to be able to read the real compiled
    system prompt to sanity-check what's actually being sent to the LLM once live users are on
    it, so this needs to be fixed before that audit, not after.
12. **Doc sync — Plan 06 Phase 6 remainder + the consent-popup supersession.** Two pieces:
    **(a)** the 2026-07-31 partial doc-sync commit covered Phase 6 for Phases 0–4 only (its
    own commit message says so) — `TechDesign.md`'s Rules Index #63–71 and Deferred Decisions
    table, `README.md`, and `docs/user-guide.md` should be checked against what Phase 5.3's
    live pass actually confirmed, not just the pre-verification build state. **(b)** this
    session's activity-log-sharing consent flow changed from a blocking inline `/signup` form
    field (Plan 06 §5.6/§7.2's original design) to a dismissible post-login popup that
    defaults every new account to private — a real supersession of an already-locked rule, not
    yet reflected anywhere in `TechDesign.md`'s Rules Index (needs a supersession note,
    matching how Rules Index #7 documents the chat-mediator scope reversal) or in
    `docs/user-guide.md`'s signup walkthrough. Deliberately the last step before deploy.
13. **Deploy online.** Get a version reachable outside the local network. Manual/simple for
    now (whatever the smallest real hosting step is); the *automated* version of this is
    CI/CD, tracked under FUTURE, not blocking this first deploy.

## NEXT — first priorities once v1 is online

New bucket, added 2026-07-31. Decided and scoped, deliberately deferred to right after launch
— the "ship now, harden fast" set. Ordered by what the user wants tackled first; the rest is
free to reorder within this bucket.

1. **Component/UI test coverage.** Zero automated coverage on the React component tree — only
   manual live-browser verification per session. **The first thing done once v1 is live** — a
   deliberate 2026-07-31 call: a "beta" audience can survive a couple of early bugs, and it's
   more valuable to harden against real usage than to delay launch chasing test coverage
   up front. Folds in TechDesign P04g (component tests for `ImportDialog`/`ChatPanel`
   specifically — same gap, not a separate item — the dry-run branches added in Plan 04 have
   no unit tests).
2. **AI chat persistence.** `ChatPanel.tsx`'s `messages` is plain in-memory `useState`, no
   persistence, chat still fully resets on reload or agent switch. **Open implementation
   question, deliberately deferred 2026-07-31:** a lightweight cookie/localStorage approach
   (no schema change, but single-browser only — a fresh device or a cleared cookie loses
   everything) vs. a real `Conversation`/`Message` DB table per agent (a genuine schema
   addition, but persists properly and works across devices). Decide the approach when this
   is picked up.
3. **Settings page — sidebar-navigated layout + Activity log "User" column.** Two related
   changes to `app/components/Settings/SettingsView.tsx` (currently one 705-line page, three
   stacked `<section>` blocks — Settings/General, Invite codes, Activity log — no navigation
   chrome): **(A)** the Activity log table needs a **User** column. `CallLogListItem`
   (`lib/db/repository/llmCallLog.ts`) already carries the raw `userId` per row (used today
   only for the §5.6 redaction check) — it's never resolved to an email or rendered. Needs
   resolving `userId` → email (join or lookup map) in `listCallLogs` / `GET
   /api/llm-call-log`, plus a new column in the table (~line 509). Deliberately minimum-scope
   for now — just the column; additional filters (by user, date range, etc.) are explicitly
   deferred further. **(B)** restructure `/settings` into a sidebar-navigated layout — a
   left-side section list (General / Invite codes / Activity, the same three sections that
   already exist today, not new ones) with each becoming its own full-height content pane,
   replacing the current single stacked-page layout. Claude.ai's own Settings modal (sidebar
   list + content pane) was shown as the visual reference. **Real layout restructure —
   prototype in `architecture/layout/Layout-Workbench.html` first per standing rule 4**, not a
   one-line style tweak.
4. **Validate `SESSION_TTL_SECONDS` live behavior (Plan 06 Phase 5.4).** Spun out of the auth
   framework review once Phase 5.3 (Google OAuth) was verified live. Set
   `SESSION_TTL_SECONDS=120`, restart, log in, wait, confirm the session actually expires and
   the `?next=` redirect round trip still returns to the right page; unset it and confirm the
   7-day default returns; confirm an invalid value refuses to boot. Nothing to build, just to
   run.
5. **Strict-mode merged-heading instability re-audit** — flagged unverified during Plan 02,
   never re-checked since. Lower risk than when first flagged: only affects the secondary
   Strict import path, Structural has been default since Plan 02.
6. **Export translation to other platforms** (Copilot, etc.) — build-order #4. Real format
   translation, not a file copy.
7. **`AgentSnapshot(kind:'export')` capture + import/export diff-view UI** — Deferred
   Decisions #16. The export route this was waiting on is now built; ready to scope.
8. **AI-assisted config-key mapping** — Deferred Decisions #30. Label a messy frontmatter key
   to its canonical `propKey`, same content-never-touched pattern as section classification.
9. **Log retention / pruning / pagination** — P04c. Revisit past 5,000 `llm_call_log` rows or
   `myagent.db` exceeding ~200MB — worth scoping once real usage gives a sense of actual
   growth rate.
10. **Cost estimation in currency on log rows** — P04d. Once token counts stop being
    sufficient to answer "what did that cost."
11. **Compliance-grade (non-droppable) logging** — P04h. Today a failed log write on a live
    call is deliberately swallowed (diagnostics, not an evidence ledger). **Still an open
    "if" as of 2026-07-31** — the user wants to see the actual impact/need with real users
    before deciding whether this is worth building at all.
12. **Refactor this roadmap's format** — added 2026-07-31, revisit once v1 has actually
    shipped. Reference: `github.com/mbmorote/PMFlow`'s `refactor/ROADMAP.md` — a phase table
    (`#` / Name / Status badge / Depends-on / link to a per-phase detail `.md`), one short
    description per phase, an Execution Rules section, and a "Known Technical Debt" table.
    Deliberately not adopted now: that format is built for a strictly sequential,
    dependency-chained set of phases, and this roadmap's TODO list is explicitly the opposite
    (items are independent, pick off in any order) — a dependency column would mostly read
    "—" today. The natural trigger is v1 shipping: once work starts splitting into real
    sequenced hardening/infra/security phases (which `plans/01`–`06`'s one-file-per-plan
    numbering already half-resembles), the dependency graph becomes real and the table format
    starts paying for itself. When this is picked up, the "Known gaps in the stability net"
    section (currently prose, in "Stability snapshot" above) is a good first candidate to
    convert to a "Known Technical Debt"-style table, independent of whether the rest of the
    file migrates.
13. **Presentation for prospective (non-signed-up) users** *(still decided-but-not-how — see
    IDEA note below)* — a video/demo-style presentation showing how to import and edit an
    agent, for visitors without an account yet. The "we want this" part is settled, the
    format/production isn't; timing-wise the user wants this soon after launch.
14. **Interactive tour for signed-up users** *(still decided-but-not-how — see IDEA note
    below)* — step-by-step, in-app, dismissible, likely after first signup/login. Wanted, but
    the step sequence and trigger conditions aren't designed yet.
15. **Optional call-log persistence toggle** *(still not decided-if — see IDEA note below)* —
    a flag controlling whether `llm_call_log` entries get written to the database at all, vs.
    shown only transiently. Not settled that this is worth the complexity; timing-wise the
    user wants to revisit this soon after launch rather than let it drift indefinitely.
16. **MCP server exposing MyAgent's agents** *(still not decided-if — see IDEA note below)* —
    an MCP server so Claude (Claude Code, Claude Desktop, etc.) could access and update a
    user's agents directly from outside the web UI, instead of only through the app's own chat
    panel. Would need its own auth story (an MCP client isn't a browser session — API keys?
    OAuth?), and raises the same guardrail questions the chat mediator already answers (scope,
    tools, no-fabricated-headings) but for a client the platform doesn't control the prompt of.

## FUTURE — decided to build eventually, not prioritized

Flat list, no sub-headers. Lower urgency than NEXT — genuinely free to reorder. Full "why" for
the TechDesign-numbered ones lives in `TechDesign.md`'s Deferred Decisions table / Rules Index.

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
  (TODO item 13): a host with a persistent disk (Fly.io, a VM, Azure App Service with a
  mounted volume) keeps SQLite working fine; a stateless/serverless host (e.g. Vercel's
  default) would force this decision immediately rather than later. Worth deciding the
  hosting target with this in mind, not migrating pre-emptively.
- **#13 Catalog evolution** — distinguish "never known" vs. "was known, catalog changed";
  revisit once catalog-versioning infrastructure exists.
- **#18 `ConfigDef` platform-scoping** (per-platform `model`/`tools`/etc. catalogs) — revisit
  when a second platform's import/create is actually being built.
- **P04e "Replay this request" from a dry-run log row** — the stored `requestPayload` has
  everything needed; revisit if manual re-running becomes a papercut.
- **Dedicated group-management view** — punch-list item 7. New panel, not started, not
  researched. Prototype in `Layout-Workbench.html` first per standing rule 4 whenever it's
  picked up.
- **CI/CD** — test → build → deploy automation. The automated counterpart to TODO item 13;
  that item is "get something online," this is "stop doing it by hand."
- **Docker** — containerize once the app runs end-to-end online.
- **Azure / hosting infra maturity** — App Service first, K8s only if that ever becomes the
  actual goal; folds together with the storage-dialect item above.
- **Organizations / teams** *(decided-but-not-how)* — `ownerId` currently means "a user."
  Making it "a principal" (org-owned agents, shared across a team) is a real remodel, and
  there's no concrete design yet for what that remodel looks like. Given a timing tier
  2026-07-31 (lower urgency than the four NEXT-bucket former-IDEA items) but still genuinely
  undesigned — needs the product/design debate before it's buildable regardless of timing.

## IDEA — either not decided-if, or decided-but-not-how

As of 2026-07-31, every previously-logged IDEA item has been given a timing tier (four moved
to NEXT, one to FUTURE — see each entry there) during the roadmap retriage, but **a timing
tier is not a design decision** — none of the five are any more "ready to build" than before;
they still need the product/design debate described below before real scope exists. This
bucket is currently empty of *new*, untriaged ideas; log fresh ones here as they come up.

Needs a product/design debate (the way the LLM-gateway question got one before it became
Plan 04) before an item can move to FUTURE/NEXT with an understood scope, let alone TODO.

## Recommended next stage

Plan 05 is done. Three TODO items are done — zero-agents empty state Topbar, the `__raw`
frontmatter escape hatch (built as a real `datatype: 'json'` instead), and the auth framework
review (OAuth verified live) — see "What's built". TODO items 1–12 are independent enough to
pick off in any order, or in parallel; item 13 (deploy online) is always last. Items 2 and 3
are naturally paired (both touch the chat mediator's scope/rule-set) but neither blocks the
other. Items 4–10 were promoted from FUTURE during the 2026-07-31 retriage specifically
because the user decided they're needed before v1, not after — treat them with the same
weight as the rest of TODO, not as optional extras. Item 12 (doc sync) is worth doing close to
whenever item 3 (Settings layout, now in NEXT) lands if that happens before launch, so the
docs reflect both in one pass — otherwise doc sync for the Settings work becomes a NEXT-bucket
follow-up.

Once v1 is live: NEXT item 1 (component/UI test coverage) first, per the user's explicit call.
The rest of NEXT is free to reorder.

Not recommended yet: anything under FUTURE or IDEA — FUTURE is either a second real effort
(export translation, sharing, Skill module) or explicitly paced to a trigger that hasn't
fired; IDEA needs a design decision before it's even buildable, independent of timing.
