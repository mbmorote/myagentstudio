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

**Last updated:** 2026-08-12 — real personal content scrubbed out of
`lib/serialize/__tests__/fixtures/*.md`, the 15 golden-file test fixtures, which were
verbatim copies of the user's real `~/.claude/agents/` library (93 occurrences of the real
name across 3 files alone). Replaced with fully synthetic agent definitions preserving the
exact structural properties `golden.test.ts` and `lib/import`'s structural/import tests
depend on (round-trip, `orchestrator.md`'s fenced-code-block heading, `scribe.md`/`ux.md`'s
headingless body, `zara.md`'s verbatim name, `dev.md`'s exact 4-heading structure — the last
one found and fixed only after initially missing that cross-folder test dependency). Because
the repo may go public later, this wasn't a plain content swap: the real-content versions of
these 15 files were removed entirely from git history via `git-filter-repo` (full backup
bundle taken first), then the anonymized versions committed fresh and force-pushed. Scope was
explicitly limited to just these 15 files, at the user's request — two incidental "the user"
mentions found in `CLAUDE.md`/`plans/Evaluation-260730.md` during the same search were left
alone and folded into the existing Plan 09 docs-audit TODO item instead (see below) rather
than fixed standalone.

**Last updated (prior):** 2026-08-12 — closing out the same-day Prometheus reliability session
(prior note below) with a deliberate debate rather than a fourth reactive patch. Considered
"wrapping" Prometheus more structurally: **(a)** moving the Agent Blueprint out of the
per-turn user message into a cacheable system-prompt position — **rejected**, the user wants
it staying visible per-turn to help the model understand the structure; **(b)** applying the
governance-agent restructuring template found in `architecture/audits/instructions maybe
.txt` (grouped frontmatter, ROLE/MISSION/OPERATING PRINCIPLES/WORKFLOW/Guardrail Matrix) to
`prometheus.md` — **deferred, not applied**, noted as a reusable reference pattern only;
**(c)** replacing prompt-instructed JSON with Anthropic's structured outputs
(`output_config.format`) — the architecturally real fix, but real scoped complication found
(the `sections`/`config` open-ended-map contract doesn't fit a strict JSON Schema without a
wire-format change touching 4+ files) — **deferred to FUTURE**, logged there in full. Instead:
one more precision pass on `prometheus.md` itself, targeted at bug (3) below's actual
mechanism — BEHAVIOR #4 previously told the model to "summarize" on every turn, which is
correct for a proposed change (visible in the diff) but was the wrong instruction for a
pure-review turn where `message` is the only place that content ever reaches the user;
reworded to distinguish the two cases explicitly, plus a worked example showing the review
living entirely inside `message`. Not yet re-verified against a real reply (standing rule 2).

**Last updated (prior):** 2026-08-12 — three chained live-usage bugs found and fixed in one chat
session, each surfaced by re-testing after the previous fix. **(1)** An advisory/opinion
instruction made Prometheus reply in plain prose with no JSON envelope, surfaced as an opaque
`Error: ai_upstream`; fixed by making the parser fall back to showing raw text instead of
hard-failing, plus prompt hardening. **(2)** Found immediately after via `llm_call_log`: the
*next* real turn (an actual edit instruction) was genuinely truncated (`stopReason:
'max_tokens'`, cut off mid-JSON) — which fix (1)'s fallback then silently swallowed as a no-op
instead of erroring, matching the user's report of a proposed change "not coming like a change
anymore." `prometheus.ts` was missing the truncation guard `daedalus.ts` already has; added
`PrometheusTruncatedError` → `422 chat_truncated`. Also raised `chatMaxTokens` from a
hardcoded `8192` to an admin-configurable setting (`lib/settings.ts`, default unchanged,
live value raised to 30000), and switched `callPrometheus()` from `getGateway().complete()` to
`.stream()` since the Anthropic TypeScript SDK refuses non-streaming requests above ~21,333
max_tokens (confirmed against the real SDK source, `calculateNonstreamingTimeout()` in
`client.ts`) — `daedalus.ts` already used `.stream()` for the same reason at its own higher
ceiling. **(3)** Found on the very next real test, via the same `llm_call_log` inspection
technique: on a long "review + one small edit" turn, the model wrote its entire real review as
plain prose *before* the JSON block (violating OUTPUT FORMAT's "no commentary outside it"),
then left `message` inside the JSON as a bare pointer ("See review above.") to that discarded
prose — the parser correctly extracted the JSON (not a parsing bug this time), but the only
text the user ever sees is the parsed `message` field, so the real content never reached the
chat. Fixed with further prompt hardening in `prometheus.md`'s OUTPUT FORMAT: explicit
prohibition on any text outside the JSON regardless of answer length, and on `message` values
that merely reference content instead of containing it. None of the three are new TODO/NEXT
items — found and closed inline in the session they surfaced, per the roadmap's own
convention. See "What's built" for full detail on (1) and (2); (3) is prompt-only, not yet
re-verified against a real reply (per standing rule 2).

**Last updated (prior):** 2026-08-12 — TODO item 1 (manual-edit save frequency) closed, no code
change: confirmed via a live code read that `SectionBlock.tsx` already implements the
decided behavior (explicit Save/Cancel, nothing committed until clicked) exactly as the item
asked. The config zone (model/effort/individual config keys) commits immediately per discrete
action instead — a different pattern, but per-action (a dropdown pick, a key add/remove), not
per-keystroke, and confirmed acceptable as-is. Moved into "What's built," remaining TODO items
renumbered 1–9 (was 1–10). See "What's built" for full detail.

**Last updated (prior):** 2026-08-12 — TODO item 1 (section delete via chat) fully closed — a
`sectionKey` mapped to `null` now deletes the section, mirroring `config`'s existing
null-to-delete convention; moved into "What's built," remaining TODO items renumbered 1–10
(was 1–11). The big flow test (now item 5) no longer caveats its chat-edit stage to
edit-only. See "What's built" for full detail.

**Last updated (prior):** 2026-08-11 — TODO item 1 narrowed: chat-driven section *add* is built (found
broken live, fixed same session — see the item's own entry for detail); chat-driven section
*delete* stays open, item renamed accordingly. New NEXT item 19 added for a real UX gap found
along the way (apply-proposal's `skipped[]` isn't surfaced anywhere in the UI).

**Last updated (prior):** 2026-08-06 — TODO items 2, 3, and 6 (the chat-mediator/Prometheus rework)
closed out into "What's built" now that Plans 07–08 are built and doc-synced (Plan 08 Phases
0–3 and 5; Phase 4's live-LLM verification is deferred, folded into a new item rather than run
separately — see below). One new TODO item added at the user's request: a **"big flow test"**
(import → manual edit → chat edit, add/edit/remove at each stage) as the explicit last
functional validation gate before "Deploy online," positioned right before it. Remaining TODO
items renumbered 1–12 with no other reordering — this was a removal-and-append pass, not a
re-prioritization of what stayed.

**Last updated (prior):** 2026-07-31 — full retriage at the user's request. Every open TODO/FUTURE/IDEA
item (40 total, at the time) was flattened into a temporary triage file, classified by launch
timing (**1 = before v1 online, 2 = soon after v1 launches, 3 = long-tail/low urgency**), and
re-sorted into the buckets below on that basis — introducing the new **NEXT** bucket (tier 2),
since "soon after launch" work was previously conflated with unprioritized FUTURE work. Each
item promoted or moved during the retriage carries an inline `*(Promoted/Moved ...)*` tag in
its own bullet — that's the source of truth for what moved and why, not this note. Two open
implementation/product threads flagged during triage, still unresolved: **AI chat persistence**
(NEXT) — cookie/localStorage vs. a real `Conversation`/`Message` DB table; **compliance-grade
logging** (NEXT) — still deciding if it's worth building at all, pending real-user impact.
Same day, two follow-ups: **company signature on the platform** added as new TODO item 12 (as
numbered then; renumbered since — see the TODO section's own current numbering), branding
somewhere on the live site (placement/content TBD), sequenced right before deploy;
**display-label lookup for `model`** un-promoted back out of TODO after confirming the current
raw display (`claude-sonnet-5`, etc.) is already legible and correctly aligned with real
Anthropic naming — relocated next to **Export translation to other platforms** in NEXT, since
both are the same underlying problem (mapping a platform-specific representation to something
else) and worth scoping together.

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
  `SESSION_TTL_SECONDS` check) now sits in NEXT; the remaining Phase 6 doc sync is folded into
  `plans/09-pre-launch-org-review.md`'s Track A (TODO item 6) as of 2026-08-06.
- **Chat editing rework: propose/apply flow, Prometheus rename, section-scoped citation** —
  Plans 07 & 08, closed 2026-08-06 (was TODO items 2, 3, and 6). Chat editing widened from
  sections-only to sections + config + description (never `name`, enforced server-side), given
  a real output contract (`{ message, modifications, warnings }`), and switched from auto-apply
  to **propose-then-apply, unconditionally**: `POST /api/chat` performs zero writes; a separate
  `POST /api/agents/[id]/apply-proposal` does the actual write, including the config-merge fix
  (a partial config edit no longer wipes untouched keys — the single highest-risk item in the
  feature, regression-tested by watching it fail before the fix). A third `'proposal'`
  interaction-lock state blocks manual editing (now including config, which had no lock check
  at all before this) while a proposal is pending, persisted across reloads and synced across
  tabs via `localStorage`. Section/config click-to-cite narrows what's sent to the model. The
  chat system agent was renamed **Prometheus** and rewritten in MyAgent's own real-agent shape
  (frontmatter + Role/Behavior/Guardrails/Output), the same pass that renamed the import
  converters **Hermes** (Strict) and **Daedalus** (Structural). Full history:
  `plans/07-prometheus-propose-apply.md`, `plans/08-prometheus-apply.md`. `tsc` clean, 551/551
  tests, and live manual passes (including DB-level checks) for everything except actually
  sending a chat message, which needs real spend. **Not closed by this item — folded into the
  new pre-deploy "big flow test" TODO item instead of run as a separate step:** Plan 08's own
  Phase 4 (live verification that a real Prometheus reply produces a correct proposal end to
  end). **Also still explicitly open, out of scope for this rework:** adding or deleting a
  section via chat — see TODO item 1 below.
- **"+custom key…" arbitrary config-key creation, incl. removing one** — 2026-08-06, was TODO
  item 1. Was blocked on a design decision (a user-created key immediately got flagged as
  `unknownConfigKeys`, contradicting the intent of letting the user create it). **Resolved: no
  schema change** — `agent_config` has no concept of key provenance (import already stores any
  unrecognized frontmatter key verbatim, identical to a manually-created one — see
  `lib/import/CLAUDE.md`), and a persisted flag couldn't survive an export→re-import round-trip
  anyway. Instead, retired the separate "⚠ unknown key" warning-pill tier entirely: every
  config key not in the standard catalog now renders through the same raw-JSON custom-block UI
  already used for `hooks`/`mcpServers` (`AgentView.tsx`'s `renderCustomBlock`, `getCatalogDef()`
  falls back to a synthesized def), with the same neutral "· custom · saved as-is" label, Edit,
  and Remove affordances. No backend change — `PATCH /api/agents/[id]` already accepted
  arbitrary `propKey`s. The add-key menu's "+ custom key…" option prompts for a name and saves
  an empty-object value.
- **Settings modal instead of full-page navigation** — 2026-08-06, was TODO item 6. Avoids
  losing `ChatPanel`'s local message history when a user opens Settings. Prototyped in
  `Layout-Workbench.html`, then built for real: `Topbar.tsx`'s "⚙ System Settings" is now a
  button opening a new `SettingsModal.tsx` (a Radix `Dialog`, same pattern `RawAgentView.tsx`'s
  zoom modal already used) instead of `<Link href="/settings">`. No new backend work — `GET
  /api/settings` and `GET /api/llm-call-log` already existed and were already admin-gated, so
  the modal just fetches both client-side on open and feeds the same `SettingsView` component
  the full-page route always used. `SettingsView.tsx` gained an optional `onClose` prop and
  dropped its two `router.refresh()` calls (replaced with applying the PATCH response's
  `updatedAt` directly to local state). `/settings/page.tsx` itself is untouched and still
  works standalone, including the `?log=<id>` permalink deep-link, which intentionally still
  goes through the full page. **Deliberately left alone:** `ChatPanel.tsx`'s dry-run notice
  links and `ImportDialog.tsx`'s settings link still full-page-navigate — converting the former
  would need session/role plumbed into `ChatPanel`, out of scope for this item; revisit if it
  becomes a real papercut.
- **ESLint config** — 2026-08-06, was TODO item 1. `next lint` was wired into `package.json`
  since early in the project but never configured (dropped into an interactive setup wizard).
  Added `eslint`, `eslint-config-next`, `@eslint/eslintrc` as devDependencies and
  `eslint.config.mjs` (Next 15's flat-config format, `next/core-web-vitals` + `next/typescript`,
  generated/build directories excluded to mirror `.gitignore`). First-ever run against the
  whole codebase found 18 issues (17 `no-unused-vars`, 1 `react-hooks/exhaustive-deps`) — all
  fixed the same session: dead imports/variables removed outright (per the "delete, don't
  rename to `_var`" instruction), and `AgentView.tsx`'s catalog-helpers destructure wrapped in
  `useMemo` so `getCatalogDef` has a stable identity and can safely be added to an effect's
  dependency array without causing spurious re-attachment. `npm run lint` now reports zero
  warnings/errors; the full suite (551/551 tests) still passes after the cleanup.
  **Incidental finding, fixed the same session at the user's request:** `npx tsc --noEmit`
  (run to verify the cleanup) surfaced 2 pre-existing type errors in `lib/import/assemble.ts`
  and `assembleStructural.ts` — each file's own `CONFIG_DATATYPE` map was inferred as
  `Map<literal-key-union, literal-datatype-union>` (from `CONFIG_DEFS`' `as const` fields),
  which rejected the plain `key: string` parameter `coerceConfigValue()` actually queries it
  with. Confirmed via `git status` to predate this session, unrelated to the ESLint work.
  Fixed by explicitly typing both as `Map<string, string>` (matching the precedent already set
  by `assembleStructural.ts`'s own `HEADING_TO_KEY` map two lines above it) — a type-only
  change, no runtime behavior difference. `npx tsc --noEmit` now reports zero errors; full
  suite re-verified at 551/551 after this fix too.
- **Section delete via chat** — 2026-08-12, was TODO item 1 (add half closed 2026-08-11,
  delete half closes it out). A `sectionKey` mapped to `null` in `modifications.sections` now
  deletes the matching section — the same convention `config` already used for key deletion
  (§4.1), extended to `sections` for the first time. Changed across the whole propose/apply
  chain: `PrometheusModifications.sections` (`lib/ai/prometheus.ts`) is now `Record<string,
  string | null>`, and `parsePrometheusResponse()`'s sections branch passes a `null` value
  through untouched (previously indistinguishable from any other non-string value, dropped
  with a warning) — mirroring the config branch two blocks below it, which already allowed
  `null`. `apply-proposal/route.ts`'s body validation now accepts `string | null` per section
  key (still rejects any other type, e.g. a number); its per-key loop deletes via the existing
  `deleteSection()` repository primitive (the same one the manual DELETE route already used)
  when it finds a matching section, or no-ops into `skipped[]` with reason `no_such_section`
  when the proposed key doesn't exist — never an error either way, matching the add path's
  and update path's existing tolerance for a stale proposal. The response's `applied` gained
  a `removedSectionKeys` array, separate from `sectionKeys` (which still means "added or
  updated"), so a future UI surfacing `applied`/`skipped` (NEXT item 19) can tell the three
  apart. `lib/proposalStore.ts`'s `PendingProposal.modifications.sections` type updated to
  match, so the type change propagates through `ChatPanel.tsx` without a separate cast.
  `prometheus.md` gained a GUARDRAILS #2 sentence (removal is allowed, only when the user
  actually asked for it, only for a section they were shown) and an OUTPUT FORMAT sentence
  documenting the `null` convention for sections, mirroring config's existing one.
  **ChatPanel UI**: both the live proposal card and the reopenable past-turn "View proposed
  changes" detail now detect a `null` section value and render it the same way a `null`
  config value already does — `renderContentRow()` gained an optional `removalLabel` param
  (default `'Remove this key'`) so the section rows can say "Remove this section" instead of
  reusing the config wording verbatim. Test coverage added the same session (scoped `vitest
  run`, no LLM calls): a `prometheus.test.ts` case mirroring the existing "null config value
  passes through" test but for sections; two new `apply-proposal.test.ts` cases (delete an
  existing section + confirm config/other-sections untouched; delete a nonexistent sectionKey
  → skipped, zero writes). No schema change, no new repository primitive — `deleteSection()`
  and its ownership/not-found handling already existed for the manual delete path (built
  2026-08-11 alongside the add half); this closure only wired the chat contract to it.
- **Manual-edit save frequency — confirmed already decided-correctly, no code change** —
  2026-08-12, was TODO item 1 (Deferred Decisions #14). The decision (from the 2026-07-31
  triage): the user wants an explicit Save action for manual editing, not
  autosave-on-every-keystroke or a debounced background save. Checked `SectionBlock.tsx`
  directly rather than assuming: it already matches — typing only updates local
  `editContent` state; nothing PATCHes to `/api/agents/[id]/sections/[sectionId]` until
  Save is clicked (or confirmed via the outside-click/switch-editor dialog). The config zone
  (`AgentView.tsx` — `saveModel`, `saveEffort`, `saveConfigKey`, `removeConfigKey`, custom-JSON
  blocks) instead commits immediately on each discrete action, no separate Save step — a real
  inconsistency with the section editor, but not the autosave-on-keystroke pattern the original
  decision was rejecting (an action is a whole dropdown pick or key add/remove, not a
  per-character save). Chat-applied edits already match the explicit-commit shape too — `POST
  /api/chat` performs zero writes, `POST /api/agents/[id]/apply-proposal` only fires on Apply.
  **User confirmed the current section behavior is good enough as-is** after reviewing what
  the rejected alternative (autosave/debounce) would have looked like — no UI or backend
  change made. The config zone's immediate-commit pattern was surfaced but not re-opened as a
  separate question this session.
- **Chat crashed on advisory/opinion instructions — non-JSON model replies now degrade
  gracefully instead of erroring** — 2026-08-12, found live (user hit `Error: ai_upstream` on
  "which section do you recommend I change first?", then again on a retry — confirmed
  reproducible, not flaky, by inspecting the stored `llm_call_log` response payload: the model
  answered in plain conversational prose, no `{`/`}` anywhere in the text). Root cause:
  `parsePrometheusResponse()` (`lib/ai/prometheus.ts`) threw `PrometheusInvalidResponseError`
  whenever its three JSON-extraction attempts (direct parse → strip code fence → greedy
  `{...}` slice) all failed, which `app/api/chat/route.ts` maps to a 502 `ai_upstream` —
  discarding an already-paid-for, on-topic answer with no way for the user to see it. **Fix,
  both sides:** (1) the parser no longer throws when no JSON object can be extracted at all
  (whether no `{...}` substring exists, or one exists but doesn't parse) — it now returns a
  fallback `PrometheusProposal` with the raw response text as `message`, `modifications: {}`,
  and a warning ("did not return the expected format... showing its raw response as-is"),
  rendered through ChatPanel's existing generic warnings display, no UI change needed. Only a
  response that parses to the wrong root shape (an array, a bare string, `null`) still throws
  — that's a structurally confused response, a different and rarer failure mode, left as a
  hard error. (2) `prometheus.md` hardened: BEHAVIOR #2 now explicitly says an answer-only
  turn (a recommendation, an opinion, pure discussion) is still a normal turn using the exact
  same JSON envelope, `modifications: {}`, never plain text; OUTPUT FORMAT gained a matching
  sentence ruling out plain-prose replies "no matter how conversational or open-ended the
  instruction reads." Two `prometheus.test.ts` cases updated from `expect(...).toThrow(...)`
  to assert the new fallback shape instead (`lib/ai/__tests__/prometheus.test.ts`); no other
  test changes. **Not yet re-verified against a real model reply** (would need a real,
  billed Anthropic call per standing rule 2) — the prompt hardening's actual effect on model
  behavior is unconfirmed; the parser fallback is verified by the updated unit tests
  regardless of whether the prompt fix reduces how often it's needed.
- **Follow-up to the item above, same session — the real live failure was truncation, not
  missing JSON, and the non-JSON fallback fix had silently made it worse.** Diagnosed by
  reading the actual `response_payload` in `llm_call_log` for the user's next real chat turn
  (a genuine edit instruction, not a question): the model's reply had `stopReason: 'max_tokens'`
  — it hit the 8192-token cap mid-response, cutting the JSON `sections` string off
  mid-sentence. Confirmed structurally: `JSON.parse` on the greedy `{...}` slice failed with
  "Unterminated string in JSON." Before the fallback fix (above), this hit the same
  `ai_upstream` 502 as the no-JSON case — annoying but visible. **After** the fallback fix, it
  went straight into the new "no parseable JSON → show raw text, `modifications: {}`" path,
  which means a real proposed edit was silently discarded with no error and no visible sign
  anything was wrong beyond a huge wall of half-prose-half-broken-JSON text in the chat
  bubble — exactly what the user flagged as "we just load the block, it's not coming like a
  change anymore." **Root cause:** `daedalus.ts` (Structural Import) has always checked
  `stopReason === 'max_tokens'` and hard-rejected before parsing (`DaedalusTruncatedError` →
  422 `structural_truncated`, `lib/import/CLAUDE.md`) — `prometheus.ts`'s `callPrometheus()`
  never had the equivalent check, so a truncated chat response fell straight into the parser.
  **Fix:** added `PrometheusTruncatedError` (mirrors `DaedalusTruncatedError`), checked in
  `callPrometheus()` immediately after the gateway call succeeds, before `responseText` is
  ever handed to `parsePrometheusResponse()` — so a truncated response can no longer reach the
  non-JSON fallback path at all. `app/api/chat/route.ts` maps it to `422 { error:
  'chat_truncated' }`, distinct from both `ai_upstream` (502) and the generic internal error,
  mirroring the import route's `structural_truncated` precedent exactly. Test coverage: the
  mocked `prometheus.js` module in `chat.test.ts` gained the new error class, plus one new
  case (`truncated response (max_tokens) → 422 chat_truncated`).
- **`chatMaxTokens` — chat's max-output-tokens ceiling is now an admin setting, not a hardcoded
  literal** — 2026-08-12, same session, closing the "real underlying tension" the truncation
  fix above left open (a fixed `maxTokens: 8192` doesn't get less likely to truncate just
  because truncation now fails loudly instead of invisibly). Added `chatMaxTokens` to
  `SETTING_DEFS` (`lib/settings.ts` — datatype `int`, default **8192** unchanged, `min: 1024`,
  `max: 64000` as a typo-guard, not a confirmed model ceiling) plus a `getChatMaxTokens()`
  accessor following the file's existing fail-safe pattern (row absent → default, invalid/below
  min → the min + `console.warn`). `prometheus.ts`'s `callPrometheus()` now calls
  `getChatMaxTokens()` instead of the literal `8192`. No schema/migration/route change needed —
  `GET`/`PATCH /api/settings` and the Settings UI are both fully generic over `SETTING_DEFS`,
  confirmed by reading `app/api/settings/route.ts` before relying on it. **Live value raised to
  30000 immediately, at the user's explicit request**, via a direct upsert into the real
  `setting` table (`key='chatMaxTokens'`) — not through the Settings UI/PATCH route, since the
  request was "set this right now." The `SETTING_DEFS` default stays 8192 (a fresh/reset
  install starts conservative); the running app's *current* effective value is 30000 until an
  admin changes it via Settings. `hermes.ts` (4096) and `daedalus.ts` (32000) still hardcode
  their own values, untouched — this session only covered chat's number, per what was asked.
- **`callPrometheus()` switched from `getGateway().complete()` to `.stream()`** — 2026-08-12,
  same session, found immediately after raising `chatMaxTokens` to 30000: the next live chat
  call failed client-side (before any request even reached Anthropic) with `Error: Streaming
  is required for operations that may take longer than 10 minutes`. Root-caused against the
  real `@anthropic-ai/sdk` TypeScript source (`client.ts`'s `calculateNonstreamingTimeout()`),
  not guessed: the SDK refuses a non-streaming request once `(60min × maxTokens) / 128000 >
  10min`, i.e. `maxTokens > ~21,333` — 30000 exceeds it. `daedalus.ts` already solves this the
  same way at its own higher `maxTokens: 32000`. `stream()` returns the identical
  fully-accumulated `LlmResponse` shape as `complete()` (confirmed via `gateway.ts`'s shared
  `run(req, ctx, method)` — both methods get identical dry-run/cap/logging behavior), so this
  was a one-line swap in `prometheus.ts` with no other code change. Confirmed no test fakes a
  gateway/provider implementing only `.complete()` that this could break.
- **Prompt hardened again — `message` can no longer be a pointer to prose written outside the
  JSON envelope** — 2026-08-12, same session, found on the very next live test (a "review and
  improve my agent" turn) via the same `llm_call_log` raw-payload-inspection technique used for
  the two bugs above. This time the parser worked correctly — the bug was in what the model put
  *inside* the JSON. On a long review-plus-one-edit turn, the model wrote its entire ~2,255-char
  real review as plain prose *before* the JSON block (violating the already-existing "no
  commentary outside it" rule), then set `message` to a bare pointer — `"See review above."` —
  referencing that prose. Since only the parsed `message` field is ever shown to the user, the
  actual review was silently discarded and the chat showed nothing but a content-free pointer.
  `prometheus.md`'s OUTPUT FORMAT hardened further: explicit prohibition on any text outside the
  JSON regardless of answer length ("a long review is not an exception — a long `message` value
  is still just a JSON string"), and an explicit ban on `message` values that reference content
  instead of containing it ("there is no 'above' or 'below' for the user to see"). Prompt-only
  change — **not yet re-verified against a real reply** (would need another real, billed
  Anthropic call per standing rule 2); the earlier OUTPUT FORMAT hardening for pure advisory
  turns (see the non-JSON-fallback entry above) evidently wasn't strong enough to cover this
  mixed review-and-partial-edit shape, so this may need another pass if it recurs.

## TODO — before v1 goes online

Ordered. **"Deploy online" is always last** — anything else added here goes before it.
Retriaged 2026-07-31 (`plans/roadmap-priority-260731.md`, tier 1) — this bucket now means
strictly "must happen before v1 launches," not a general importance ranking; several items
here were promoted from FUTURE on that basis, tagged below.

**Kind tags added 2026-08-06**, at the user's request, so items can be picked up by what
they actually require, not just launch necessity — **[UX]** = a visible UI/layout change
(prototype in `Layout-Workbench.html` first, standing rule 4); **[Behavior]** = a product/logic
decision or backend change with no direct UI; **[Infra]** = tooling/process/docs, not user-
facing at all. The big flow test and "Deploy online" (items 4 and 9) are deliberately
untagged — they're end-of-list gate tasks (final validation, then deploy), not day-to-day
pick-off work; everything between them (company signature, the guided tour, DB backup, the
disclaimer) sits there by deliberate user choice, not because they're the same kind of task.

**Same-day update (2026-08-06):** the original "UX working queue" batch (items 1, 5's
rendering half, 6, and 10, in the numbering that day started with) is mostly resolved. The
former items 1 (custom-key creation), 6 (Settings modal), **and ESLint config** are all fully
built — closed out into "What's built" above, which is why the list below no longer starts
with ESLint. **The former item 5 (incremental streaming) was deferred to FUTURE at the user's
explicit request** — see that bucket.

**Reordered same day, at the user's explicit request** (a deliberate priority call, not a
re-triage — done when ESLint was still item 1): ESLint first (quick, no coupling to anything
else — **built the same session, see "What's built"**); then the two "how the platform is
actually used day-to-day" items (chat section add/delete, manual-edit save frequency) —
grouped together since both are behavior/UX calls about editing an agent, each may or may not
need a layout change; then the build-prompts readability fix (confirmed with the user: this is
a **developer-tooling fix, not an admin-facing or logging feature** — it only changes the
human-readability of the generated `lib/ai/prompts/generated/*.ts` files that
`scripts/build-prompts.ts` writes at build time; nothing about the runtime admin-facing
Activity Log/`llm_call_log` — which already exists and is unaffected — the confusion was
plausible since both are "system prompt visibility," but the API touched is `predev`/
`prebuild`'s generated file output, not any runtime logging); then second LLM provider,
wanted landed **before** going online while the vendor is still swappable at low cost; then
**Plan 09** (`plans/09-pre-launch-org-review.md`, added the same day) — a docs/code/tests
organization review, not a correctness check, so the pre-deploy big flow test runs against
docs/code/tests already known to be honest about their own state; then the big flow test
itself; then company signature (deliberately placed **after** the test, not before it, so an
asset that still doesn't exist doesn't gate functional validation) right before deploy.

1. **[Infra]** **`scripts/build-prompts.ts` readable output.** TechDesign #26, tagged **[HIGH
   PRIORITY]** there — currently emits one giant escaped-string line. A generator-script fix,
   not user-facing (double-checked at the user's request — this is developer/build tooling,
   unrelated to the admin-facing Activity Log). Sequenced deliberately before item 4 (the
   pre-deploy big flow test): the user wants to be able to read the real compiled system
   prompt to sanity-check what's actually being sent to the LLM, which is most useful
   precisely when debugging a live chat-edit failure during that test, not after it.
2. **[Infra]** **Second LLM provider.** *(Promoted from FUTURE 2026-07-31 — was P04a.)* A
   non-Anthropic, OpenAI-compatible or NVIDIA provider behind the existing `LLMProvider`
   interface — no user-visible change, same chat/import behavior through a different vendor.
   **The user wants this landed before going online**, while switching vendors is still cheap.
3. **[Infra]** **Plan 09 — Pre-launch organization review (docs, code, tests).** *(Added
   2026-08-06, at the user's request — replaces what was previously here, a narrower doc-sync
   task, now absorbed as this plan's Track A finding A1.)* `plans/09-pre-launch-org-review.md`
   has the full charter. Three tracks, each asking "does this reflect/organize what it should,"
   **not** "does it work" (that's the big flow test's job, item 4 below): **Track A (docs)** —
   audit `CLAUDE.md`/`TechDesign.md`/`README.md`/`docs/user-guide.md` against actual current
   behavior, including the absorbed Plan 06 Phase 6 doc-sync gap (Rules Index #63–71, the
   consent-popup supersession) and a newly-surfaced finding (`AgentDTO.validation` is
   server-computed but read by zero UI components — dead code or an unfinished feature the
   mockup's ⚠/✕ legend already promised; needs a decision either way) and a specific
   "what's on the log is on the log" pass verifying the Activity Log's actual behavior against
   its documentation. **Newly-surfaced finding (2026-08-12):** `CLAUDE.md` and
   `plans/Evaluation-260730.md` each have one stray mention of the user's real name
   ("requested by the user, 2026-07-30") — violates the existing no-real-name-in-files project
   rule; both are simple find-replace fixes, roll into this pass rather than done standalone.
   **Track B (code)** — structural fit against each folder's own stated
   `CLAUDE.md` map: dead code, duplicated logic, scope creep past a component's own docblock.
   **Track C (tests)** — coverage/organization shape, not pass/fail: gaps, stale tests for
   superseded designs, naming/location conventions. **Output is a findings list, triaged after
   — not a fix-everything mandate** (confirmed with the user): trivial fixes land inline,
   anything bigger spins into its own new TODO/FUTURE item. Sequenced right before the big flow
   test so that test runs against docs/code/tests already known to be honest about their own
   state.
4. **Big flow test — import → manual edit → chat edit.** *(Added 2026-08-06, at the user's
   request.)* **The last functional validation before "Deploy online,"** run once every other
   TODO item above is done. One end-to-end pass through the whole real app, not a scripted
   unit-style check: **(a)** import a real agent file; **(b)** manually edit it in the
   structured view — add a section, edit a section, remove a section; add a tool, edit a
   config value, remove a tool/config key; **(c)** edit the same agent via chat — Prometheus
   proposal review and Apply/Discard for a section edit and a config edit (add/edit/remove a
   tool via chat), confirming the proposal card, the lock, and the applied result all match.
   **(d)** export the now-edited agent and reimport it, confirming the round trip holds — not
   new coverage (the golden-file tests already assert this at the unit level), just making
   sure it's actually eyeballed once on a real, hand-edited agent as part of this pass.
   *(Added 2026-08-07, from a cross-check against `architecture/audits/0708 Copilot
   Roadmap.md`.)*
   This is also where Plan 08's own deferred Phase 4 (live verification that a real Prometheus
   reply produces a correct proposal end-to-end) actually gets exercised — not run as a
   separate step, since this test's chat-edit stage already needs the same real, billed
   Anthropic API calls (standing rule 2 — ask before running this test for that reason).
   **No longer a known gap as of 2026-08-12:** chat-driven section add/edit/remove are all
   implemented now (see "What's built" — the delete half closed roadmap TODO item 1, which
   this test's coverage description used to caveat around); this test's chat stage can
   exercise all three. **Anything else the test turns up:** small issues get fixed
   inline as part of the same pass; anything bigger becomes its own new TODO/FUTURE item
   rather than blocking the test itself — the point is to find gaps before real users do, not
   to gate the test on being bug-free beforehand.
5. **[UX]** **Company signature on the platform.** Added 2026-07-31 — the user's real
   branding needs to appear somewhere on the live site before v1 goes online (footer,
   login/signup pages, Topbar — placement and exact content, e.g. name/logo/tagline/copyright
   line, not yet decided). Placement-in-layout work — prototype first once an asset/copy
   exists. Scope details (what asset, where it renders) to be worked out when this is picked
   up. **Design review done 2026-08-06** (`plans/Branding-Design-Review-260806.md`, against
   the user's own reviewer rubric — typography, color, layout/structure, branding
   integration, overall feel): recommends a footer placement (folded into the existing
   `.foot` legend row, not a new strip — zero extra vertical cost) as primary, a quiet line
   under the login/signup card as secondary; explicitly against tinting the mark with
   `--accent` or giving it Topbar real estate. **Footer placement prototyped the same day**
   in `Layout-Workbench.html` (`.foot-brand` chip, demo-only "ACME Corp" content, same
   fake-but-labeled convention as the mockup's demo agent) — **still blocked on the actual
   asset/company name/copy** before this (or the login/signup line, not yet prototyped
   anywhere) moves into real code; placeholder text was deliberately kept out of
   `Topbar.tsx`/`LoginForm.tsx`/`SignupForm.tsx` since a real viewer seeing literal demo
   branding would read worse than seeing nothing. **Sequenced right before deploy, after the
   big flow test** (2026-08-06 reorder, at the user's request) — a still-missing asset
   shouldn't gate functional validation; branding lands as the final step before going live.
6. **[UX]** **First-login guided tour (mini-tour).** *(Added 2026-08-07, from the same
   cross-check — supersedes the original plan to build a separate pre-login landing page for
   this launch; see NEXT items 14/15 below for what that split into instead.)* The user isn't
   confident every invited friend can be walked through the product live, and a written guide
   alone won't get read — so this replaces "explain it live" with a self-serve, in-app
   walkthrough triggered on first login. **Mechanism — spotlight, dim-the-other-panels, not a
   true anchored coach-mark:** no new dependency needed (the app currently has only
   `@radix-ui/react-dialog`, no Popover) — `WorkbenchShell`'s four panels already occupy known,
   fixed screen regions, so dimming the three panels not currently being explained plus a
   caption near the active one is enough; real coach-mark positioning logic (e.g.
   `@radix-ui/react-popover`) is deliberately not needed for a fixed 4-pane grid. **Six steps:**
   (1) welcome/why — this step folds in the "why does this exist" explanation, so the separate
   pre-login landing page isn't needed for this launch (this step's own numbering is internal
   to the tour, unrelated to this list's item numbers); (2) Library panel; (3) Structured view;
   (4) Chat panel; (5) cite-a-section (click a section/config value to narrow what's sent to
   chat); (6) Raw panel + download. **Skippable per-step and to finish** (Next/Skip/Finish on
   each step), **re-runnable anytime via a "?" affordance** — not one-shot, needs a persisted
   "seen" flag (`localStorage` is enough, same pattern already used for the pending-proposal
   lock). Estimated at a session or two, not a multi-day build. **Prototype in
   `Layout-Workbench.html` first per standing rule 4** before touching real code.
7. **[Infra]** **Production DB backup/restore.** *(Added 2026-08-07, from a cross-check
   against `architecture/audits/0708 Copilot Roadmap.md`, an outside 30-day-launch review.)*
   Every existing "backup" reference in the repo (Plan 05 §4.5 step 0, Plan 06 Phase 5) is a
   one-time safety copy taken before running a risky migration — nothing covers `myagent.db`
   on an ongoing basis once real users are creating real data in it, confirmed by grep, not
   assumed. Minimum bar: know how to snapshot the live SQLite file and how to restore it,
   documented somewhere findable (`README.md` or here). No code required unless the chosen
   hosting target makes this non-trivial.
8. **[UX]** **"Experimental — don't paste sensitive data" disclaimer.** *(Added 2026-08-07,
    same source.)* No disclaimer text exists anywhere in the signup/login flow
    (`app/components/Auth/`) — confirmed by grep. One sentence, cheap, real risk-reduction
    given compliance-grade logging is explicitly not built (NEXT item 12). Placement TBD when
    picked up (signup form, a banner, or folded into the existing `ConsentPopup.tsx`).
9. **Deploy online.** Get a version reachable outside the local network. Manual/simple for
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
   is picked up. **Distinct from, though related to, the 2026-08-07 chat-history change**
   (Rules Index #87): that gave Prometheus model-side memory of prior turns *within* a live
   session (still `useState`, still lost on reload) — this item is about the UI/session
   *surviving* a reload or device switch at all, a different problem the history change
   doesn't touch.
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
   translation, not a file copy. Each target platform would naturally become its own
   import/export system agent under the reframed Agent pattern (see FUTURE bucket, "System
   agents become real, platform-managed agents") — same specialty
   ("convert/import/export between formats"), different platform-specific technical detail
   per agent, one shared authoring pattern making each one easy to add.
7. **Display-label lookup for `model`.** *(Moved back out of TODO 2026-07-31, linked here.)*
   Short label in the UI (e.g. "Opus" instead of the full model ID); storage stays the full
   ID. Confirmed the current raw display (`claude-sonnet-5`, etc.) is already legible and
   correctly aligned with real Anthropic naming, so it's no longer a pre-launch blocker.
   Grouped next to item 6 above deliberately — both are the same underlying problem (mapping a
   platform-specific representation to something else, whether that's Anthropic's model IDs to
   a friendly label, or this app's config schema to Copilot's), worth scoping together.
8. **`AgentSnapshot(kind:'export')` capture + import/export diff-view UI** — Deferred
   Decisions #16. The export route this was waiting on is now built; ready to scope.
9. **AI-assisted config-key mapping** — Deferred Decisions #30. Label a messy frontmatter key
   to its canonical `propKey`, same content-never-touched pattern as section classification.
10. **Log retention / pruning / pagination** — P04c. Revisit past 5,000 `llm_call_log` rows or
    `myagent.db` exceeding ~200MB — worth scoping once real usage gives a sense of actual
    growth rate.
11. **Cost estimation in currency on log rows** — P04d. Once token counts stop being
    sufficient to answer "what did that cost."
12. **Compliance-grade (non-droppable) logging** — P04h. Today a failed log write on a live
    call is deliberately swallowed (diagnostics, not an evidence ledger). **Still an open
    "if" as of 2026-07-31** — the user wants to see the actual impact/need with real users
    before deciding whether this is worth building at all.
13. **Refactor this roadmap's format** — added 2026-07-31, revisit once v1 has actually
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
14. **Pre-login landing page for prospective (non-signed-up) users.** *(Reworded 2026-08-07 —
    was "Presentation for prospective users," still decided-but-not-how, see IDEA note below.)*
    A real public-facing explainer page shown **before login**, for visitors who don't have an
    account yet — a different audience than TODO item 6's first-login tour, which only
    signed-up users ever see. Format/production still undecided (video, screenshots, static
    copy); the "we want this" part is settled, timing-wise the user wants this soon after
    launch, not before — TODO item 6's welcome step covers the "why" well enough for this
    launch's small, invited audience.
15. **Improve the guided tour.** *(Reworded 2026-08-07 — was "Interactive tour for signed-up
    users." The MVP tour itself is now TODO item 6, built before launch — this item is what's
    left after that ships.)* Candidates once the dim-panel MVP is live: true anchored
    coach-marks (`@radix-ui/react-popover` or similar, precise positioning instead of dimming
    fixed regions); more/different trigger conditions (first import, not just first login);
    additional steps; usage signal on where people skip or drop off.
16. **Optional call-log persistence toggle** *(still not decided-if — see IDEA note below)* —
    a flag controlling whether `llm_call_log` entries get written to the database at all, vs.
    shown only transiently. Not settled that this is worth the complexity; timing-wise the
    user wants to revisit this soon after launch rather than let it drift indefinitely.
17. **MCP server exposing MyAgent's agents** *(still not decided-if — see IDEA note below)* —
    an MCP server so Claude (Claude Code, Claude Desktop, etc.) could access and update a
    user's agents directly from outside the web UI, instead of only through the app's own chat
    panel. Would need its own auth story (an MCP client isn't a browser session — API keys?
    OAuth?), and raises the same guardrail questions the chat mediator already answers (scope,
    tools, no-fabricated-headings) but for a client the platform doesn't control the prompt of.
18. **Re-enable group behavior.** *(Added 2026-08-07 — group creation, the Library's
    Agents/Grouped toggle, and drag-to-group were deferred pre-launch, not removed.)* Three
    local flags, one flip each to restore: `GROUPS_ENABLED` in `WorkbenchShell.tsx` (makes the
    "Agents"/"Grouped" header toggle clickable again), `GROUPS_ENABLED` in
    `Library/LibraryPanel.tsx` (brings back "+ New group"), and `DRAG_ENABLED` in
    `Library/AgentListItem.tsx` (restores the drag handle + `useDraggable`). `GroupSection.tsx`
    and the group repository/API routes were never touched — nothing to rebuild, just
    re-expose. Worth a quick real-usage check when re-enabled (does drag-and-drop still feel
    right against whatever else changed in the interim) rather than assuming it's exactly as
    it was.
19. **Surface `applied`/`skipped` from apply-proposal in the UI.** *(Added 2026-08-11, found
    live while diagnosing the section-add gap above.)* `apply-proposal/route.ts`'s response
    has always carried `applied: { description, sectionKeys, configKeys }` and `skipped[]`
    (each with a `reason`), but `WorkbenchShell.tsx`'s `applyProposal` only reads `data.agent`
    — any part of a proposal that gets skipped (unknown config datatype, a write that
    silently no-ops, etc.) currently looks identical to Apply succeeding in full. Needs a
    UI decision (a toast, a note appended to the proposal card, something in the chat
    transcript) more than new backend work — the data is already there.

## FUTURE — decided to build eventually, not prioritized

Flat list, no sub-headers. Lower urgency than NEXT — genuinely free to reorder. Full "why" for
the TechDesign-numbered ones lives in `TechDesign.md`'s Deferred Decisions table / Rules Index.

- **Structured outputs for Prometheus (`output_config.format` / a JSON Schema contract) instead
  of prompt-instructed JSON.** *(Added 2026-08-12, debated and explicitly deferred — "too big
  for now and could touch some places we don't wanna right now.")* Would replace the current
  ask-nicely-and-regex-extract approach (`parsePrometheusResponse()`'s 3-attempt extraction)
  with an API-enforced schema — the model becomes structurally incapable of the exact failure
  modes patched today (plain-prose replies, commentary written outside the JSON object,
  malformed/fenced JSON). Real, scoped complication found during the debate, not a one-liner:
  Anthropic's structured outputs requires `additionalProperties: false` on every schema object,
  which means every property name must be known ahead of time — but `PrometheusModifications`'s
  `sections`/`config` are open-ended maps (`{ [sectionKey: string]: string | null }`, keys
  chosen by the model), which don't fit a strict schema. Adopting this means reshaping the wire
  contract to arrays of fixed-shape pairs (`{ sectionKey, content }[]` / `{ propKey, value }[]`)
  — a cascading change touching `PrometheusModifications`'s type, `parsePrometheusResponse()`
  (simplifies, since extraction goes away, but is rewritten around the new shape),
  `apply-proposal/route.ts`'s per-key merge loop, `ChatPanel.tsx`'s proposal rendering, and the
  gateway/provider layer (`LlmRequest` has no field today to carry `output_config.format`
  through to the SDK call). Does not fix truncation (`PrometheusTruncatedError` stays needed
  regardless) and doesn't guarantee `message`'s *content* is good, only that it exists in the
  right place — content-quality still needs prompt wording. Revisit if the 2026-08-12 prompt
  hardening (`prometheus.md` OUTPUT FORMAT + BEHAVIOR #4, plus a worked example) turns out not
  to hold up under continued real usage.
- **Incremental streaming.** *(Moved back here from TODO 2026-08-06, at the user's explicit
  request — was TODO item 5, itself promoted from FUTURE 2026-07-31, originally P04b.)*
  Token-by-token chat responses (`streamChunks()`) instead of waiting for the full reply.
  Splits cleanly if picked up: the streaming transport itself is **[Behavior]** (`LLMProvider`/
  gateway plumbing, purely additive per TechDesign P04b); rendering tokens as they arrive is
  **[UX]** (`ChatPanel`'s message bubble goes from "swap in the final text" to "grow in
  place") — small enough it likely doesn't need a full mockup pass, but confirm against
  standing rule 4 when picked up.
- **Server-enforced editing lock during a pending chat proposal (revisit).** *(Added
  2026-08-05.)* Today's `interactionLock` (and its `localStorage`-persisted pending-proposal
  extension, built as part of the Prometheus rework — see What's built above) is purely
  client-side/cooperative — no route rejects a manual
  edit because a proposal is pending. Not a problem at current scale; revisit if this app ever
  needs to defend against a client that doesn't cooperate (a second official client, a public
  API, adversarial use).
- **Session management — view/log-out other active sessions (bucket TBD).** *(Added
  2026-08-05, from the Plan 07 review — user flagged this as future?/todo?, not settled which.)*
  A section (likely `/account`) listing a user's other active logged-in sessions, with a
  remote log-out control. Surfaced by discussing the cross-device pending-proposal gap below —
  related but a distinct feature (session/device management, not proposal awareness). Needs
  its own scoping (how sessions are identified/listed — today's JWT is stateless, so this may
  need a sessions table) before it can move to TODO or a firmer FUTURE slot.
- **Cross-device/cross-browser awareness of a pending chat proposal (revisit).** *(Added
  2026-08-05.)* A pending proposal + lock lives in one browser's `localStorage` only — a
  second device or browser for the same account has no idea it exists and could manually edit
  underneath it. Accepted at current scale (a handful of users, effectively one device at a
  time); revisit if real usage shows this causing actual overwrites.
- **Instant auto-apply mode (revisit).** *(Added 2026-08-05.)* Propose-then-apply became the
  unconditional default behavior of the Prometheus rework (What's built above), superseding an
  earlier per-user-toggle framing. Restoring an instant/auto-apply option was deliberately
  dropped for the initial build, not forgotten — revisit if the confirm-click proves to be
  friction in practice.
- **Apply-by-section/per-field granularity.** *(Added 2026-08-05.)* The Prometheus rework's
  propose/apply flow ships apply-all only first; applying a subset of a turn's proposed changes
  (one section, one config key) is a deferred refinement.
- **System agents (Prometheus, Hermes, Daedalus) become real, platform-managed agents.**
  *(Added 2026-08-05.)* All three system-agent prompt files (`lib/ai/prompts/system-agents/`)
  were restructured, same day, to follow MyAgent's own Agent pattern — real-agent shape (YAML
  frontmatter + `#`-level Role/Behavior/Guardrails/Output sections) — instead of an ad-hoc
  rule-set shape; see `plans/07-prometheus-propose-apply.md`'s Progress Log for the full detail
  on both passes
  (Prometheus first, then Hermes/Daedalus the same day). Deliberate scope limit still holds:
  they stay build-time-compiled static prompts (`scripts/build-prompts.ts`), edited by hand, by
  using the platform on itself, or outside it, then recompiled and checked — **not** stored as
  real DB `agent` rows or editable live through the workbench UI. Making them fully
  configurable, in-platform-editable agents (the app managing its own agent-builder-agent
  through itself) is confirmed wanted eventually but explicitly deferred — "far far away,"
  introduces too much complexity for now. Directly motivates the multi-platform import/export
  item below: a consistent per-agent pattern is what makes adding a new platform-specific
  import/export agent easy later, even while execution stays static/compiled today.
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
  (TODO item 9): a host with a persistent disk (Fly.io, a VM, Azure App Service with a
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
- **CI/CD** — test → build → deploy automation. The automated counterpart to TODO item 9;
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

Nine TODO items are done — zero-agents empty state Topbar, the `__raw` frontmatter escape
hatch (built as a real `datatype: 'json'` instead), the auth framework review (OAuth verified
live), the chat-mediator/Prometheus rework (propose/apply, the lock, the ChatPanel UI),
(2026-08-06) custom-key creation/removal, the Settings modal, and ESLint config,
(2026-08-12) section delete via chat, and (2026-08-12) manual-edit save frequency (confirmed
already built as decided, no code change) — see "What's built" for all nine. Current TODO is
1–9, **explicitly ordered by the user 2026-08-06** (not a free pick-off list like the prior
numbering; ESLint itself was item 1 in that ordering and has since closed out, then chat
section delete was item 1, then manual-edit save frequency, hence the list below now starts
at build-prompts readable output): **1** build-prompts readable output (confirmed
developer-tooling, not admin/logging) → **2** second LLM provider (wanted landed before launch
while switching vendors is still cheap) → **3** Plan 09 (`plans/09-pre-launch-org-review.md` —
docs/code/tests organization review, findings-list output, not a fix-everything pass) → **4**
the big flow test (final functional validation, now including an explicit export→reimport
round-trip check, and — since chat section add/edit/delete are all built — no longer caveated
to edit-only on the chat side) → **5** company signature (deliberately after the test, so a
still-missing asset doesn't gate it) → **6** the first-login guided tour → **7** production DB
backup/restore → **8** the experimental-use disclaimer → **9** deploy online. Items 6–8
**added 2026-08-07**, from a cross-check against `architecture/audits/0708 Copilot Roadmap.md`
(an outside 30-day-launch review) — everything else in that review either was already built,
was already correctly placed in NEXT, or was scoped for a public beta this launch isn't
running. Item 6 (the guided tour) replaces what would otherwise have been a separate
pre-login landing-page build for this launch — see NEXT items 14/15 for how that split
changed. Item 3 (Plan 09's docs track) is worth doing close to whenever NEXT item 3 (Settings
layout) lands if that happens before launch, so the docs reflect both in one pass —
otherwise that becomes a NEXT-bucket follow-up.

Once v1 is live: NEXT item 1 (component/UI test coverage) first, per the user's explicit call.
The rest of NEXT is free to reorder.

Not recommended yet: anything under FUTURE or IDEA — FUTURE is either a second real effort
(export translation, sharing, Skill module) or explicitly paced to a trigger that hasn't
fired; IDEA needs a design decision before it's even buildable, independent of timing.
