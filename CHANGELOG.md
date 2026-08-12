# Changelog

Chronological project history. `CLAUDE.md` is current-state instructions only (rules, folder
map, file pointers) — this file is where "what happened, when, and why" lives instead.
Newest first. Each entry names the commit where relevant; work described here may predate
its actual commit if it was verified live before being committed.

---

## 2026-08-11 — Chat-driven section add (found broken live, fixed same session)

Found via real usage, not a planned task: the user asked Prometheus to review the real agent
**Ada**, applied the resulting proposal, and nothing visually changed. Diagnosed directly
against the real `myagent.db` (read-only query, no code run) rather than guessing — confirmed
`agent.updated_at` for Ada *was* bumped by the Apply (the proposal's tool-list trim, removing
`WebSearch`/`WebFetch`, really did persist), but no new section row existed anywhere in
`agent_section` for the "OUTPUT FORMAT" section the proposal's message described adding.

**Root cause: chat-driven section add was never implemented** (this is exactly
`plans/roadmap.md` TODO item 1, previously scoped as "add/delete via chat"). Prometheus
proposed a genuinely new `sectionKey` ("output-format"); `apply-proposal/route.ts`'s section
loop only knew how to update a `sectionKey` matching an existing section — anything else was
logged as a server warning and pushed into a `skipped[]` array in the response that the client
never reads. Not a regression from anything touched this session or recently — the very first
real attempt to propose a new section via chat, which nobody had tried until now.

**Fix — real primitive, no shortcut.** `apply-proposal/route.ts`'s section loop now calls
`addSection()` (`lib/db/repository/agents.ts` — the same repository function the manual "+"
add path already used, built 2026-08-07 but never wired to chat) when a proposed `sectionKey`
doesn't match an existing section, instead of skipping it. The one real design gap: the
`sections` output contract carries content only (Prometheus never writes a heading — GUARDRAILS
#9), so a brand-new section has no heading anywhere in the model's JSON. New
`deriveHeadingForNewSection()` (`lib/ai/prometheus.ts`) resolves it server-side: prefers a
match in the section catalog (`getSectionDefs(agent.platform)`) so a chat-added standard
section is indistinguishable from one added via the blueprint picker, falling back to
formatting the key itself (`known-limits` → `# KNOWN LIMITS`) at the agent's split level when
there's no catalog match. Same content processing as an update (echoed-heading strip,
split-level demotion, trailing blank line) runs against the derived heading before the write.

**Prompt updated too**, not just the route — the live miss traced partly to `prometheus.md`
itself: the Agent Blueprint block sent every turn already includes each catalog section's real
`key` (confirmed by reading `lib/blueprint/prompt.ts`), but nothing told Prometheus to *use*
that key when proposing a new section, so it invented `output-format` from the heading text
instead of using the real key, `output`. `prometheus.md` GUARDRAILS #2 now explicitly says
new-section proposals are allowed and to prefer a blueprint section's own `key` when the
addition matches one. **Needs a dev-server restart to take effect** — prompts are compiled at
build time (`scripts/build-prompts.ts`); restarted the same session (killed the stale PID
listening on :3000, confirmed clean via `netstat`, `npm run dev` recompiled and came back up
clean).

**Not done, deliberately out of scope for this fix, spun into new roadmap items:**
chat-driven section **delete** (roadmap TODO item 1, narrowed — the add half is what closed
here) and surfacing `applied`/`skipped` in the UI at all (new NEXT item 19) — the response
has always carried this data; `WorkbenchShell.tsx`'s `applyProposal` just never read it, so any
future partial skip for any reason will look the same as this one did until that's built.

**Two more gaps found live, same session, re-testing the fix above:**

1. **Ordering.** The chat-added "OUTPUT FORMAT" section (core, catalog order 4) landed after
   several non-core sections instead of near the top — `addSection()` had always appended
   blindly at `max(order) + 1`, with no concept of the blueprint's canonical order. This
   equally affected the pre-existing manual "+" add-from-catalog path, not just chat — nobody
   had added a catalog section out of order before. Rewrote `addSection()`
   (`lib/db/repository/agents.ts`): a `sectionKey` matching the platform's section catalog is
   now inserted at its canonical position relative to the agent's other catalog-matched
   sections (reindexing every section's `order`, not just the new row's — inserting in the
   middle shifts what comes after it); a `sectionKey` with no catalog match (genuinely custom
   sections) keeps the old append-at-the-end behavior, unchanged. Also gave `addSection()` an
   `author` parameter (`'user' | 'ai'`, default `'user'`) it never had — the chat-add call site
   in `apply-proposal/route.ts` now passes `'ai'` explicitly, matching the convention
   `updateSectionContent`'s chat-driven calls already use; before this the section-add
   revision was always attributed to `'user'` even when Prometheus wrote it.
2. **Raw panel didn't show the new section.** `RawAgentView.tsx`'s re-fetch effect only
   depended on `agentId` — switching agents re-fetched, but no dependency fired on an edit to
   the *same* agent (manual save, chat apply, add/remove — this bug predates today, not
   specific to section-add). Fixed by adding `updatedAt: string` to `AgentDTO`
   (`lib/db/repository/agents.ts`, additive — `buildAgentDTO()` now returns
   `agentRow.updatedAt.toISOString()`) and threading it into `RawAgentView` as a new
   `agentUpdatedAt` prop, added to the re-fetch effect's dependency array
   (`WorkbenchShell.tsx` passes `agent.updatedAt` at the one call site).

**Ada's real DB row was manually backfilled** (direct `addSection`-equivalent write, no API
call) to the correct order/author after the ordering fix landed — confirmed directly against
`myagent.db`: `output` now sits at its canonical position (right after `guardrails`), its
revision reads `author: 'ai'`. The user had already exercised the chat path once, live, before
the ordering/author fix existed (that run is what surfaced both gaps); a second live chat
re-test of the corrected ordering specifically has not happened yet.

**Test coverage — added same session, at the user's request** (scoped run, no LLM calls, per
the standing ask-first rule — the user explicitly authorized this specific run): `repo.test.ts`
gained three new `addSection` cases (canonical-position insertion with reindexing, custom-key
still-appends-at-end, `author` param defaults to `'user'`/chat passes `'ai'`); two pre-existing
`addSection` cases had their `maxExistingOrder + 1` expectation corrected — `createAgent()`
seeds sections with `order: def.defaultOrder` (1-based), but the rewritten `addSection()`
reindexes every section to a contiguous 0-based sequence on each call, so the right prediction
is `existingCount`, not the old max-order-based math (both still describe the exact same
observed behavior; only the *assertion*, not the function, needed the fix — confirmed by the
one-line diff between old/new expected values). `apply-proposal.test.ts`'s test 7 (previously
"unknown sectionKey → skipped[]") was rewritten for the new add-on-unknown-key behavior, plus a
new 7b for the non-catalog-key heading-derivation fallback. A new file,
`app/api/agents/[id]/__tests__/sections.test.ts`, was added from scratch — the manual "+"
add / "Remove" routes (`sections/route.ts`, `sections/[sectionId]/route.ts`) had zero test
coverage of any kind before this, at any layer. **48/48 passing** across all three files
(`lib/db/repository/__tests__/repo.test.ts`, `app/api/agents/[id]/__tests__/apply-proposal.test.ts`,
`app/api/agents/[id]/__tests__/sections.test.ts`) — a scoped `vitest run` naming just those
files, not the full suite. No `tsc`/build pass run this session.

---

## 2026-08-07 — Chat history: Prometheus now sees prior turns, not just the current instruction

Ad hoc improvement (no formal plan doc — user explicitly opted to skip one and go straight to
implementation after a design discussion) closing a real gap: every `/api/chat` call was
previously a single, stateless turn — a follow-up like "make that shorter" had nothing to
attach "that" to, since neither the prior instruction nor Prometheus's prior reply was ever
sent back to the model.

**What changed.** `callPrometheus` (`lib/ai/prometheus.ts`) now prepends prior turns to the
Anthropic `messages` array before the current turn's existing full self-contained payload
(§5.1–§5.3 unchanged — current agent content is still always sent fresh, never derived from
history). History carries only each turn's natural-language text (`{role, message}`) — never
the raw `modifications` JSON. This was a deliberate simplification, not an oversight: when a
proposal was applied, its content reaches the next turn automatically via the fresh per-call
agent load, so resending it in history would be pure duplication; when a proposal was left
unapplied or discarded, the model only has its own prior `message` to go on, which is judged
good enough for now.

**New admin setting: `chatHistoryTurns`** (`lib/settings.ts`, default 10, min 0, max 50) —
caps how many prior messages are actually used, enforced server-side regardless of how much
the client sends (same "never trust client-supplied content" posture as the rest of the chat
route). Fully catalog-driven like the other settings — no route or Settings-UI code needed for
it to appear and be editable.

**Client side** (`app/components/Chat/ChatPanel.tsx`): `ChatMessage` gained a `synthetic` flag
so client-only notices (dry-run/error/network-error/cancelled bubbles) are excluded from what's
sent as history — those were never real Prometheus output. `doSend` builds `history` from the
session's real messages and includes it in the request body when non-empty.

**Docs updated:** `lib/ai/CLAUDE.md`, `architecture/TechDesign.md` (Rules Index #87),
`docs/user-guide.md` (new "Follow-ups remember the conversation" note under AI chat, new
"Chat history turns" subsection under System Settings).

**Not done:** no tests added for the new behavior (none existed for `callPrometheus`'s message
construction before this either — only `parsePrometheusResponse` has unit coverage), and no
`tsc`/build verification run this session, per the repo's standing provisional rule 5 (ask
before running any sanity check) — left for the user to run or defer.

---

## 2026-08-06 — Plans 07–08 built: Prometheus rename, propose/apply chat editing, ChatPanel UI

Combined entry for both plans' full scope (nothing shipped to real users until this session's
manual passes verified it, so one dated entry covers both, per Plan 08 §4.2/§12.1). Chat
editing was rebuilt end to end: the chat agent (formerly "the chat mediator") was renamed
**Prometheus** and rewritten in MyAgent's own real-agent shape; the editable surface widened
from sections-only to description + sections + config (never `name`); and the write model
switched from auto-apply to **propose-then-apply**, unconditionally, with a client-side lock
while a proposal is pending.

**Plan 07 (`plans/07-prometheus-propose-apply.md`), Phases 0–2, built 2026-08-05.** The rename
through the `.ts` layer (`chatMediator.ts` → `prometheus.ts`) and the new output contract
(`{ message, modifications, warnings }`, replacing the old `{ sections }`-only shape). Same
session, the two import converters were renamed the same way — **Hermes** (Strict Import) and
**Daedalus** (Structural Import) — for consistency, not because Plan 07 required it.

**Plan 08 (`plans/08-prometheus-apply.md`), Phases 0–3 and 5, built 2026-08-06.**
- **Phase 1 — the propose/apply split.** `POST /api/chat` now performs zero writes on any
  path; a new `POST /api/agents/[id]/apply-proposal` is the only writer, implementing the
  config-merge fix (a partial config edit no longer wipes untouched keys — the single
  highest-risk item in the plan, regression-tested by watching it fail before the fix) and
  server-side split-level-heading demotion at write time, not only propose time.
- **Phase 0 — the mockup**, in `Layout-Workbench.html`: the full proposal card, all five
  states (Pending/Applying/Applied/Failed/Restored), Apply/Discard, the lock banner. Signed off
  live by the user.
- **Phase 2 — the client store and lock.** `lib/proposalStore.ts` (a `localStorage`-backed,
  `useSyncExternalStore`-compatible store, referentially stable, corruption- and
  quota-tolerant); a third `'proposal'` state on the existing `interactionLock`; **closed a
  real pre-existing gap** where config editing had no lock check of any kind before this.
- **Phase 3 — the ChatPanel UI**, migrating the signed-off mockup into `ChatPanel.tsx`: the
  real five-state card, before/after disclosure read from client state (never the model),
  long-value collapse, `config: null` rendering as "Remove this key," and the discard-then-send
  fix (sending a new message now discards a pending proposal first, rather than blocking send
  entirely as an interim Phase 2 simplification did).
- **Phase 5 — documentation sync**, re-scoped to exclude Phase 4's live-verification claims
  (see below): `CLAUDE.md`, `lib/ai/CLAUDE.md`, `architecture/TechDesign.md` (Rules Index
  supersessions #3/#7/#22/#23/#24/#25, new rules #73–81, six new Deferred Decisions rows),
  `docs/user-guide.md`, `plans/roadmap.md`, and `README.md` (its layout description still
  named "the mediator" and described the old auto-apply behavior).

**Phase 4 — deferred, not built, not abandoned.** Live verification against the real
Anthropic API needs an explicit go-ahead (standing rule 2) and was set aside at the user's
request rather than decided immediately. Consolidated into a new `plans/roadmap.md` TODO item,
"Big flow test — import → manual edit → chat edit," so the same real API calls aren't made
twice under two different names.

**Verification.** `tsc --noEmit` clean and 551/551 tests passing after every phase. Manual
browser passes for Phases 2 and 3, authenticated via a locally-minted session JWT (this repo's
own signing code, run standalone — no password read, stored, or entered anywhere), confirmed
end to end at the DB level: lock restore with no flash, every editor gated, Discard, Apply
(including the config-merge holding under a harder case than the unit tests — one key deleted
and another changed in the same call, ten others untouched), corrupted-`localStorage` recovery,
and cross-tab sync in both directions. **Not verified live: actually sending a chat message** —
`liveLlmCalls` is `true` on this real instance, so a real send spends real money; that check is
exactly what the deferred Phase 4 / new TODO item covers.

---

## 2026-07-31 — Plan 06 Phases 0–4 built: middleware fix, configurable TTL, Google OAuth

`@dev` implemented `plans/06-auth-review-google-oauth.md` Phases 0–4, each phase gated on `tsc`/`npm test`/`npm run build`, verified independently, and committed separately. Phase 5 (live verification against real Google endpoints) and the remainder of Phase 6 (doc sync) are not started — Phase 5 needs a user-created Google Cloud OAuth client and explicit go-ahead before any real call is made, per the standing no-real-external-call rule.

**Phase 0 — `middleware.ts` JWT dedup + configurable session TTL** (commit `1d77019`). `middleware.ts` no longer carries its own inline JWT verifier (which had drifted: no algorithm restriction, a silent-`false` secret check instead of `lib/env.ts`'s length-validated one) — it now calls `verifySessionToken()` from `lib/auth/jwt.ts`, the same function every route handler uses. `SESSION_TTL_SECONDS` becomes an optional env var (default 7 days, bounds 60s–90d, throws at boot on an invalid value) via `getSessionTtlSeconds()`; the JWT `exp` and the cookie `maxAge` always derive from the same call in the same request.

**Phase 1 — OAuth foundations, unwired** (commit `ea2867f`). `lib/auth/oauth/`: `types.ts` (the `OAuthProvider`/`OAuthProfile` seam vocabulary), `tx.ts` (the `myagent_oauth_tx` transaction cookie — httpOnly, `sameSite=lax`, path-scoped, 10-minute, unsigned by design since every field is re-validated downstream), `google.ts` (the only file importing `arctic`; verifies Google's `id_token` against its JWKS via `jose`, checking issuer/audience/`email_verified`/nonce), `providers.ts` (the registry — the seam tests mock). `lib/env.ts` gains `getOAuthConfig()`/`isOAuthConfigured()` with all-or-nothing validation of the three OAuth env vars. Nothing outside `lib/auth/oauth/` imports any of it yet.

**Phase 2 — `oauth_account` schema + repository** (commit `a937297`). New table: composite PK on `(provider, providerAccountId)`, indexed on `userId`, unique on `(userId, provider)`. Machine-generated migration `0004_first_falcon.sql` (Plan 05's hand-authoring exception does not apply — no backfill, no populated-table NOT-NULL issue). `lib/db/repository/oauthAccounts.ts` adds `getOAuthAccount`/`listOAuthAccountsForUser`/`linkOAuthAccount` (the last a standalone insert, no transaction — races resolved via the composite PK). `createUserWithInvite()` gains a required-but-nullable `oauth` field and the `oauth_account_exists` failure reason, inserting the `oauth_account` row inside the same invite-redeeming transaction Plan 05 already used. No setting added — auto-linking stays a hardcoded, unconditional `true` per the review's decision (§16.4); `lib/settings.ts` and `lib/db/seed.ts` are untouched.

**Phase 3 — the OAuth routes** (commit `9aee4bf`). `POST /api/auth/oauth/[provider]/start` (issues the tx cookie, no DB write) and `GET /api/auth/oauth/[provider]/callback` (the full flow: tx validation, code exchange + `id_token` verification, resolution to login/auto-link/create, session issuance). Every callback exit routes through one helper that unconditionally clears the tx cookie; session issuance happens in exactly one place, reached by all three outcomes. Auto-linking on an email match is unconditional — no policy read, no toggle — the accepted residual risk from the review (Google Workspace domain-takeover, §3.7). `/api/account` gains `linkedProviders`. The password-login sentinel-hash log line is reworded since a Google-only account hitting it is now routine, not suspicious. This phase's own test suite (`oauth-callback.test.ts`) is table-driven over every path in the plan's §10.4, plus two parametrized invariants asserted across every scenario: the tx cookie is cleared on every exit, and no session cookie is ever set on a failure path.

**Phase 4 — UI** (commit `d1a29cc`). `/login` and `/signup` split into a server `page.tsx` (reads `isOAuthConfigured()` server-side, no client-side fetch or render flash) + client `LoginForm`/`SignupForm`. Fixed the pre-existing `useSearchParams()`-without-`<Suspense>` build failure as part of the split (`npm run build` was failing before this phase; it passes cleanly now, and both pages are now statically rendered). New shared `GoogleButton` component, using the existing `apiFetch` wrapper. The signup page's Google button stays disabled until both the invite code is filled and the consent question is answered — the same precondition as the password path, since both lead to the same account-creation transaction. `AccountView` gains a read-only "Signed in with" line.

**Docs.** `architecture/TechDesign.md` — Rules Index #63–72, the `OAuthAccount` entity, Deferred Decisions rows updated (P06a reflects the built phases, P06b marked resolved) plus new rows for what's still genuinely deferred (a second provider, manual link/unlink, an auto-link admin toggle, provider-token storage, domain-restricted sign-in). `README.md` — the four new env vars, Google Cloud console setup steps, the session-TTL-is-not-revocation note. `docs/user-guide.md` — a "Signing in with Google" section (still needs an invite code, what each side is told, that revoking access at Google doesn't end a MyAgent session, that a Google-only account has no password) and an `/account` update. `plans/roadmap.md` intentionally not touched yet — the plan itself says to leave it until the user has reviewed the completed build.

**Verification.** All five commits independently checked (not just trusted from the implementing agent's own report): `tsc --noEmit` clean and `npm test` green after every phase (502/502 tests as of Phase 4, up from the 368-test baseline), `npm run build` passing after Phase 4, and the code read directly for the callback route's cookie-clearing/session-issuance invariants and the signup page's button-gating logic.

---

## 2026-07-30 — Plan 05 built: multi-tenant schema, JWT auth, invite-code signup

`@dev` implemented `plans/05-multi-tenant-auth.md` in six phases. All gates passed. Commit: *[pending user review]*.

**What shipped:**
- **Schema** — `user` table (email, bcrypt hash, role `admin`/`user`, `shareLogsWithAdmin`), `invite_code` table, `ownerId` on `agent` + `group` (composite unique index per owner), two new columns on `llm_call_log` (`user_id` nullable, `shared_with_admin` snapshotted at write), migration `0003_fancy_may_parker.sql` (hand-authored per §4.5).
- **Auth subsystem** (`lib/auth/`) — `jose` HS256 JWT with `httpOnly`/`sameSite=lax` cookie; `bcryptjs` password hashing (cost 10, 72-byte cap enforced); session read hits the DB fresh on every request (no role claim in the token); `authenticate()` / `authenticateAdmin()` guard; `middleware.ts` as defense-in-depth UX layer (not the auth boundary per constraint 4); `lib/auth/rateLimit.ts` (10 attempts/15 min on public auth routes).
- **New routes** — `POST /api/auth/login`, `POST /api/auth/signup` (with consent field), `POST /api/auth/logout`, `GET|PATCH /api/account`, `GET|POST /api/settings/invite-codes`, `DELETE /api/settings/invite-codes/[code]`.
- **Existing routes retrofitted** — all 10 `app/api/**` route files now open with `authenticate()` or `authenticateAdmin()`. Ownership enforced in the repository layer (14 re-signed functions) — not at the route — so a forgotten check is impossible by construction. Section route bug fixed completely (§6.4 — `[id]` segment was never read; now all three of `section.id`, `section.agentId`, and `agent.ownerId` must agree).
- **Per-user LLM call cap** (§3.9) — `maxLlmCallsPerUserPerHour` setting (default 15, admin exempt), rolling 60-minute window counted from `llm_call_log`, enforced in `lib/ai/gateway.ts` before the provider call. Cap-blocked calls write no log row. `429 llm_cap_reached` + `canDryRun: true` → client offers "Preview without sending" or "Wait."
- **Activity-log consent model** (§5.6) — opt-in, default private, chosen at signup in a cookie-banner-style block. Consent snapshotted onto each `llm_call_log.shared_with_admin` row at write time; never updated. Admin always sees metadata; sees prompt/response content only for rows where the user consented at write time. `getCallLog(id, viewerUserId)` does the redaction in the repository layer.
- **System Settings vs. User Settings** (§5.7) — `/settings` (admin-only, relabelled "System Settings") vs. `/account` (any session, "Account"). Topbar updated to show both links distinctly; `⚙ System Settings` visible only to admin.
- **Bootstrap CLI** — `npm run auth:bootstrap` (idempotent, separate from `seed.ts`, never runs automatically). `instrumentation.ts` validates `JWT_SECRET` length at boot.
- **UI** — `app/login/page.tsx`, `app/signup/page.tsx` (with consent block), `app/account/page.tsx` + `AccountView.tsx`. `lib/apiFetch.ts` wraps all 14 client-side API call sites (was 9 files, 14 sites) — redirects to `/login?next=…` on 401.
- **Tests** — 186 existing tests remain unmodified or updated for owner semantics (total grew to ~280). New files: `migration.test.ts`, `jwt.test.ts`, `password.test.ts`, `session.test.ts`, `guard.test.ts`, `inviteCode.test.ts`, `users.test.ts`, `auth.test.ts`, `invite-codes.test.ts`, `account.test.ts`, `gateway-cap.test.ts`, `llmCallLog-redaction.test.ts`, `tenancy.test.ts` (crown jewel — covers every id-taking endpoint with both status and row-unchanged assertions), `route-guard.test.ts` (fitness function).

**Real DB migration** (Phase 5) run successfully against `myagent.db`; existing agents and groups migrated to the bootstrap admin's `ownerId`. `npm run auth:bootstrap` executed; admin can log in.

**Phase 5.5/5.5b manual checklist** verified with "Live LLM calls" off (no real API calls made). See plan §11 Phase 5 for the full checklist.

**Phase 6 documentation** — `TechDesign.md` (Rules Index #48–#62, new entities, deferred items), `README.md` (auth setup, new settings), `docs/user-guide.md` (sign-in, invite, privacy disclosure, LLM cap), `lib/ai/CLAUDE.md` (gateway addendum). `plans/roadmap.md` to be updated after user confirms the build.

---

## 2026-07-29 — Plan B (multi-tenant + auth) drafted, not yet reviewed

`@analyst` validated and split the original bundled request (LLM-gateway feature became
Plan A, shipped same day, see below); `@impact` scanned the codebase and flagged 14+ risks
and 6 open unknowns; `@architect` was deliberately held until Plan A's real `setting` table
existed in the codebase rather than being architected against a hypothetical shape. Once
Plan A shipped, `@architect` ran and produced **`plans/05-multi-tenant-auth.md`** (16
sections, matching Plan 04's shape). **Not reviewed with the user yet — no code written.**

**Found during the architect pass, not by either earlier pass:** `upsertAgentFromImport`'s
existing-agent lookup (`lib/db/repository/agents.ts:398`) matches by `name` alone, globally
— under multi-tenancy, one user importing a file named `dev` would silently overwrite
another user's `dev` agent and write into their snapshot history. Same issue in
`getAgentSnapshotInfo`. Recorded as a hole with a dedicated tenancy test planned.

**Corrected three `@impact` findings** against the current code: the "6 existing test
suites break" claim is actually 19 suites / 186 tests, and the actual break mode is a
`tsc` compile error at every call site (a better failure mode — the compiler enumerates the
fix list) rather than a runtime failure; the client-side 401-handling gap is 9 files / 14
call sites, not 6 components; the section-route ownership bug is worse than described (a
naive fix checking only the parent agent's owner still permits a mismatched agent/section
pair within one owner).

**One deliberate deviation from the approved task description**, flagged as the plan's
biggest structural fork: ownership is enforced in the repository layer (14 changed function
signatures) rather than at the route layer, to close a real check-then-act race window and
avoid 13 separate route-level implementations of the same check.

**Next step:** a section-by-section walk through §16's 11 confirmation points with the
user (same process Plan 04 got) before `@dev` starts — see `plans/roadmap.md` TODO item 1.

---

## 2026-07-29 — `design/` renamed to `architecture/`; system-agent prompts moved into `lib/ai/`

Follow-up to the documentation reorganization below, same day. Debated before applying: the
`design/` name collided with the `layout/` subfolder (read as "visual design only"), and
`system-agents/*.md` was mixed in with passive reference docs even though it's compiled into
the running app at build time — functionally source code, not documentation.

**Changed:**
- `design/` → `architecture/`. Holds `Concept.md`, `TechDesign.md`, `Agent-Full-Reference.md`,
  `audits/`, and `layout/` (kept nested — UI layout is one facet of the system's architecture,
  not a separate concern). Chosen over keeping "design" specifically because it covers
  product-why and technical-how without implying "visual only."
- `design/system-agents/*.md` → `lib/ai/prompts/system-agents/*.md` — moved out of the
  documentation folder entirely, next to `lib/ai/prompts/generated/`, the compiled output it
  produces. `scripts/build-prompts.ts`'s hardcoded source path updated to match; validated
  immediately (per explicit instruction) before any other reference was fixed — ran
  `build-prompts.ts` directly, confirmed real non-empty output attributed to the new path,
  then `npx tsc --noEmit`, `npm test` (186/186), and a full `npm run build` (exercising the
  real `prebuild` pipeline) all clean.
- Every cross-reference in actively-maintained docs (`CLAUDE.md`, `README.md`,
  `lib/ai/CLAUDE.md`, `architecture/TechDesign.md`, `scripts/test-structural-import.ts`)
  updated to the new paths. Closed historical files (`plans/01-04`, `CHANGELOG.md`'s past
  entries, `architecture/audits/Fable-Review-1.md`'s verbatim-kept prompt template) were
  deliberately left describing the `design/` path that was accurate *at the time* — not
  rewritten, consistent with how this project treats historical record elsewhere.

## 2026-07-29 — Documentation reorganization

Full audit of `CLAUDE.md`, `README.md`, `design/`, `docs/`, and the per-flow `lib/*/CLAUDE.md`
files (via `@scribe`), followed by execution.

**Removed:**
- `plans/layout-prototype-todo.md` — the dedicated layout-prototype hand-off file. Its one
  open slot was empty; open layout items now live directly in `plans/roadmap.md`, tagged
  Layout. The underlying workflow rule (prototype UI changes in `Layout-Workbench.html`
  before touching live code) survives as `CLAUDE.md` standing rule 4.
- `design/Fable-Review-1-Findings.md` — verified byte-for-byte identical to
  `plans/02-import-hardening-structural.md` (280 lines, zero diff). The `plans/` copy is
  canonical; the `design/` copy was a duplicate with no unique content.
- The `🟡 Tier 1 Config zone redesign` transient session-handoff section from `CLAUDE.md` —
  its own stated removal condition (Library panel item also done) was already met.

**Changed:**
- `design/DesignReview.md`, `design/Fable-Audit-Brief.md`, and `design/Fable-Review-1.md`
  moved into a new `design/audits/` subfolder — separates historical-record/reusable-prompt
  files from the actively-maintained design docs (`Concept.md`, `TechDesign.md`,
  `Agent-Full-Reference.md`). All path references to the three moved files updated across
  `TechDesign.md`, `plans/01-*.md`, and `plans/02-*.md`.
- `design/Concept.md`'s layout section updated from an early 3-pane sketch (Agents · sections
  · AI Chat as three side-by-side columns, Raw as an inline toggle) to the settled 4-pane IDE
  layout (Library · Custom Visualization · AI Chat *below* it · Raw agent as its own foldable
  right pane) — the 3-pane version was a genuine original design, superseded once Raw became
  its own dedicated pane rather than a toggle inside the center view.
- `design/TechDesign.md` Rules Index #27, #31, #32, #33, #34, #35, #36 status fields updated
  from "not yet built" / "bug confirmed, not yet fixed" to their actual shipped state (all
  landed in Plan 02, 2026-07-28) — the statuses had never been updated after the work landed.
- `design/TechDesign.md`'s `name` field description updated — the lowercase-hyphen name-spec
  validation and its `nameSpecViolation` flag were removed from the app entirely (2026-07-28,
  see below); the design doc still described the flag as if it existed.
- `docs/user-guide.md`'s export instructions updated to lead with the "⇩ Download" button
  (shipped 2026-07-29) instead of a manual select-all-and-copy workaround that predated it.
- `lib/import/CLAUDE.md`'s re-import semantics description corrected: sections are matched by
  `(sectionKey, heading)` identity in document order, not by `sectionKey` alone (the
  `sectionKey`-only description was the pre-fix behavior from before Plan 02 Phase A1).
- `plans/roadmap.md`: removed a dangling reference to a non-existent "`CLAUDE.md` Plan B
  pointer" section; replaced with an accurate note that Plan B's `@analyst`/`@impact`
  findings exist only in session history, not yet written to a file.
- `CLAUDE.md` trimmed from ~490 lines to a lean current-state map — all dated narrative
  content (the entries this changelog file now holds) removed; standing rules, folder map,
  and file pointers kept in full.

---

## 2026-07-29 — LLM provider gateway, dry-run mode, Settings page (Plan 04)

`plans/04-llm-gateway-settings.md` reviewed section by section with the user (all 5
confirmation points in §16 resolved) before any code was written, then built by `@dev` in one
session. All six implementation phases complete. `npx tsc --noEmit` clean, `npm test`
186/186 (20 new tests). Independently re-verified (typecheck, tests, build, and a direct read
of the gateway's dry-run branch) before being reported done.

**Added:**
- **Provider abstraction** — `lib/ai/provider.ts` (the `LLMProvider` interface + provider-
  agnostic request/response types) and `lib/ai/anthropicProvider.ts` (the one and only
  `@anthropic-ai/sdk` importer in the codebase; lazy singleton; `complete()` and `stream()`).
- **Gateway** — `lib/ai/gateway.ts`: the single choke point every AI call routes through.
  Reads the `liveLlmCalls` setting fresh on every call (no caching — a cached toggle would
  make the Settings UI look broken until a process restart). On dry-run: writes an audit-log
  row and returns a typed "blocked" result — the provider is never invoked, no network call,
  no synthetic response. On live: forwards to the provider, writes a log row, returns the
  real response or re-throws the original error unchanged (so `AbortError` identity is
  preserved for the existing cancellation feature).
- **Data model** — `setting` table (EAV `key`/`value`, seeded via `onConflictDoNothing` —
  deliberately the opposite of the catalog tables' `onConflictDoUpdate`, since `db:seed` runs
  on every `predev`/`prebuild` and a `DoUpdate` here would silently re-enable live calls on
  every `npm run dev`) and `llm_call_log` (append-only audit log; no UPDATE/DELETE exported).
  Migration `0002_unknown_thunderbolt_ross.sql`.
- **Routes** — `GET`/`PATCH /api/settings`, `GET /api/llm-call-log`, `GET
  /api/llm-call-log/[id]`. The import and chat routes catch a dry-run block first and return
  `409 { error: 'llm_dry_run', ... }` before their generic error handling — 409 was chosen
  over `200` + a discriminant field specifically because an unhandled `200` would let a
  dry-run render as silent success, the one failure mode this feature exists to prevent.
- **Settings page** (`/settings`) — the toggle, plus a filterable (Dry-run / Live / All)
  activity log with row-expand for full request/response payloads and a `?log=<id>` deep
  link. Reachable via a new `⚙ Settings` link in the Topbar.
- **Dry-run UI handling** — `ImportDialog` and `ChatPanel` both check the dry-run signal
  before their normal response handling and show an inline notice with a link to the log
  entry, rather than failing silently.
- **Architecture fitness-function test** (`lib/ai/__tests__/architecture.test.ts`) — scans
  every source file and asserts `@anthropic-ai/sdk`, `getClient(`, `.messages.create(`, and
  `.messages.stream(` appear nowhere outside `anthropicProvider.ts`. This project has no
  ESLint config, so this test is the durable defense against a future session quietly
  reopening a second direct-SDK path.

**Removed:**
- `lib/ai/client.ts` — its lazy-singleton logic was absorbed verbatim into
  `anthropicProvider.ts` rather than kept as a second entry point to the SDK.

**Deferred** (no product decision needed, explicit triggers in `TechDesign.md` Deferred
Decisions P04a–P04h): a second LLM provider, incremental/delta streaming, log
retention/pruning, cost estimation in real currency, replay-from-log, a settings modal
(vs. full page), component tests for `ImportDialog`/`ChatPanel`, compliance-grade logging.

---

## 2026-07-29 — Frictionless export download + catalog seed drift fixed at the root

**Added:**
- `RawAgentView.tsx` gained a "⇩ Download" button — client-side Blob + `<a download>` of the
  already-fetched markdown, no new API route. Download-only was the explicit choice over
  copy-to-clipboard or direct write-to-disk (no filesystem-path assumptions, no new UI
  surface for choosing a target location).

**Fixed:**
- Catalog seed drift, at the root rather than worked around: `AgentView.tsx` no longer
  statically imports `CONFIG_DEFS` from `lib/blueprint/catalog.ts`. It now reads the full
  config catalog from a `configCatalog` prop, fetched fresh from the database on every page
  request (`app/agents/[id]/page.tsx` → `WorkbenchShell` → `AgentView`). `config_def` gained
  a `hint` column (migration `0001_curved_sandman.sql`) so nothing was lost in the move.
  `npm run db:seed` is now wired into `predev`/`prebuild`. Net effect, per an explicit user
  requirement: editing `catalog.ts`, running `npm run db:seed`, and reloading the page is
  enough to update the UI — no rebuild or redeploy needed. Verified live by patching a
  `config_def.hint` row directly in the database and confirming a plain page reload picked
  it up without the dev server being restarted.

---

## 2026-07-29 — Library panel Agents/Grouped toggle + Tier 1 Config zone polish

Six items prototyped in `design/layout/Layout-Workbench.html` first (per standing rule 4),
then migrated into the real app. `npx tsc --noEmit` and `npm test` (132/132) both clean;
verified live against the real `dev` agent (47 real MCP tools). Committed `74f8c86`.

**Added:**
- Library panel: the word next to "Library" in the panel header (default "Agents") is
  itself an Agents/Grouped toggle — click to flip between a flat list and real groups +
  a synthetic "Ungrouped" bucket. Independent of selection (confirmed with the user:
  selecting an agent never force-switches the view). Replaces the old always-on stack of
  named groups + a redundant flat "All agents" + "Ungrouped".
- A "Manage" separator (matching the `.zone-label` pattern already used for Config/Sections)
  above the action rows, reordered to New agent → New group → Import agent (renamed from
  "Import .md").
- Config Tier 1 list rows (`tools`/`disallowedTools`/`skills`) cap at 14 visible pills with
  a "+N more" / "show less" expand toggle — confirmed real gap via the `dev` agent's actual
  47-tool list rendering as an unbroken wrap with no cap.
- A red "invalid" pill tier (✕, distinct from the existing yellow "outdated" `⚠` tier) for
  structurally malformed scalar values (e.g. non-numeric `maxTurns`), confirmed via a
  temporary database-level seed, then reverted.
- MCP-qualified tool pills (`mcp__server__tool`) render as `mcp:<tool>` with the full
  qualified name moved into the tooltip, cutting a real MCP-heavy tools list down to size.

**Fixed:**
- Folded Library/Raw panels now keep a visual gap from the center panel instead of sitting
  flush against it (folding hides the resize gutter, which had silently been providing that
  gap too).

**Deferred, needs a product decision — not a missing UI piece:** the "+ custom key…"
arbitrary-name config-key creation. A user-created key with no matching `ConfigDef`
immediately gets flagged as `unknownConfigKeys` (a yellow ⚠ warn pill right next to the field
the user just intentionally created) — needs a "user-acknowledged custom key" concept
(new DB column, or a separate key-status mechanism) before this can be built without that
self-contradiction.

**Deviation:** `onModelSaved` was replaced with a more general `onAgentUpdated(newAgent)`
callback (receives the full DTO back from the PATCH) — no other callers referenced the old one.

---

## 2026-07-29 — Editable Tier 1 Config zone redesign migrated

16 of 17 items from a full redesign of the editable Config zone (iterated entirely in
`Layout-Workbench.html` first) migrated into the real app: category-hue pill coloring
removed, two-column scalar grid, collapsible `[Config] Keys` / `[Sections] Body` zone-labels,
hover-reveal remove-× with confirm plus a `required`-badge alternative, list-item pills split
into select-vs-remove, `tools`/`disallowedTools` validation extended for `mcp__*`/`Agent(...)`
shapes, bool/enum scalars open a custom popover instead of a native `<select>` (fixed a real
stuck-open bug in the process), one unified "+" add-key button, `model`+`effort` merged into
one header popover, and a `hint` tooltip per `CONFIG_DEFS` field. `hint` was added directly to
`CONFIG_DEFS` in-code rather than through the database, matching how `allowedValues` already
avoided the database's laggy seeded copy. `npx tsc --noEmit` clean, `npm test` 132/132.
Committed 2026-07-29.

---

## 2026-07-28 — Blueprint catalog refresh

`lib/blueprint/catalog.ts`'s `CONFIG_DEFS` replaced with the schema read directly from the
real Claude Code subagent docs, after confirming MyAgent should keep targeting Claude Code's
local `.claude/agents/*.md` subagent format — not Anthropic's separate, subscription-hosted
Managed Agents product, which has a structurally different config shape and an online
dependency the user doesn't want.

**Changed:**
- `model.allowedValues` gained the 4 short aliases (`sonnet`/`opus`/`haiku`/`fable`) as the
  primary documented form, alongside the existing full IDs and `'inherit'`.
- `tools.allowedValues` replaced with the real 43-tool list; dropped `'Create'` (never a real
  tool) and renamed `'Task'` → `'Agent'` (renamed in Claude Code v2.1.63).
- `permissionMode.allowedValues` gained `'manual'` (alias for `'default'`).

**Added:** four new `ConfigDef` entries — `hooks`, `isolation`, `color`, `initialPrompt`.

`npx tsc --noEmit` and `npm test` (133/133) both clean; no other code touched.

**Logged, not started:** a Skill module — a sibling entity to `Agent` mirroring its
props/config/import/export, for `SKILL.md` files. Genuinely different shape (no
Role/Behavior/Guardrails/Output sections, sometimes a whole directory of supporting files).

---

## 2026-07-28 — UI punch-list (6 of 7 fixed)

Hands-on testing after Plan 03 flagged a punch-list of small bugs/polish items. Two real bugs
(a stray dev-server SQLite lock, an "imported from imported" label) were fixed and verified
live earlier the same day; the remaining six were implemented and visually verified live
(dev server + Chrome), no pipeline agents — done directly, plus one `@ux` consult (color
scheme) and one `@scribe` dispatch (docs, run in parallel). `npx tsc --noEmit` and `npm test`
(132/132, down from 133 after removing the name-spec test) clean after every step.

**Fixed:**
1. Tools/skills/mcpServers rendered as one pill per item (`AgentView.tsx`), including a new
   `listItemsOf()` helper for list values stored as a plain comma-separated string rather
   than a real JSON array — some imported agents have this shape, and the original
   `Array.isArray` check silently missed them. Per-item badness checked against the live
   in-code `CONFIG_DEFS` catalog, not the database's seeded `ConfigDefLite` — the database's
   seeded catalog can lag after a refresh (the catalog-seed-drift issue, fixed at the root
   2026-07-29, see above).
2. Pill color + hint system — four semantic color groups (capability/control/resources/
   presentation), status (warn) always fully overriding category color rather than layering.
3. Model moved to its own dropdown, top-right of `AgentView`'s header row (not the global
   Topbar — model is per-agent).
4. Groups gained collapse/expand for "All agents"/"Ungrouped", matching the pattern already
   used for real groups.
5. Agent name made editable in place (click the `<h1>`), same interaction-lock pattern
   `SectionBlock.tsx` already used for sections.
6. Lowercase-hyphen name validation removed entirely, per explicit user decision —
   `validateName`/`nameSpecViolation` deleted from `lib/blueprint/rules.ts`,
   `ValidationResult`, `AgentDTO.validation`, and the one test that asserted it. Separately,
   all of `rules.ts`'s exported functions were regrouped under one exported `Rules` object
   per explicit user decision — a plain object, not a `class`, matching the rest of the
   codebase's functional style.

**Logged, not started:** item 7, a dedicated group-management view.

---

## 2026-07-28 — Documentation: README, user guide, dev-flow docs

`README.md` had been deliberately deferred until there was a first genuinely testable version
(core loop + library/groups) — that condition was met once Plan 01 + Plan 03 landed.
`@scribe` wrote five files in one pass (fresh agent, briefed with the exact folders/files to
read), run in parallel with the UI punch-list work above.

**Added:**
- `README.md` — quick-start, env vars, 4-pane layout summary.
- `docs/user-guide.md` — task-oriented end-user guide: import (both modes), AI-chat edit,
  manual raw edit, groups, export. Deliberately not named `CLAUDE.md` — that name is reserved
  for internal folder-map docs; this one is user-facing.
- `lib/import/CLAUDE.md`, `lib/ai/CLAUDE.md`, `lib/serialize/CLAUDE.md` — per-flow developer
  docs, each folder earning its own file rather than being padded into a shared doc.

Spot-checked after delivery (env var names, the import-mode-picker claim, the gitignore
claim) — all held up. One stale claim was caught and fixed: `lib/serialize/CLAUDE.md`
originally said "the workbench flags but never normalizes names," true when written but made
stale by the same session's name-validation removal (item 6 above) — corrected to "never
normalizes names."

---

## 2026-07-28 — Import hardening + Structural Import (Plan 02)

`plans/02-import-hardening-structural.md`, produced from a Fable 5 audit
(`design/audits/Fable-Review-1.md`) of the built Phase 1–3 code plus a head-to-head
comparison of two competing Structural Import rule-set drafts, followed by a strategy
discussion. Bundled hardening real bugs in the already-built Strict import pipeline (Phase A)
with finishing Structural Import (Phase B, previously rule-set-only). Structural Import
became the primary/default import mode; Strict remained the secondary verbatim option, both
selectable via `ImportDialog.tsx`'s mode radio. All landed in commit `b5da391`.

**Added:**
- `lib/ai/structuralConverter.ts` (streaming Stage-2b caller), `POST /api/agents/import`'s
  `mode` field (default `'structural'`), `lib/import/coverage.ts` (deterministic line-
  coverage check producing warnings, never a hard block — a truncated/`max_tokens` response
  is a hard 422 reject instead).
- The unchanged-`rawSourceSnapshot` short-circuit — a re-import with byte-identical raw
  markdown skips the AI call entirely and returns `{ skipped: 'unchanged' }`.

**Fixed (Phase A, shared correctness fixes):**
- Re-import reconciliation now matches by `(sectionKey, heading)` identity in document order,
  not a `sectionKey`-only map — this had been silently collapsing distinct `custom` rows onto
  each other on re-import (the most severe finding in the audit).
- Malformed YAML frontmatter throws `FrontmatterParseError` instead of silently returning
  `[]`; empty/whitespace names now rejected with 400.
- `FrontmatterEntry.rawValue` became `string | string[]` so flat YAML lists survive
  parse→export→parse; nested maps/non-scalar arrays now fail loudly (400) instead of being
  destroyed into the literal string `"[object Object]"`.
- The full re-import update now runs in one transaction; overlapping `blockId` mappings are
  rejected; Strict Stage-2 `max_tokens` raised from 1024 to 4096.
- A real bug found during the review, fixed in the same commit: the structural prompt wrapped
  raw agent text in a triple-backtick fence, which broke on fixtures containing their own
  fenced code blocks — switched to XML-style delimiters.

**Changed:** the best-of-both rule-set drafts adopted as the final `import-instructions.md`
and `import-instructions-structural.md` text; the `-copilot`/`-merged` drafts deleted (git
history keeps them).

**Status corrected 2026-07-29** (this section originally said "ready for `@dev`" after the
work had actually already landed — caught during a later MVP-readiness review, verified
against `git log`): the UI mode picker was already built the whole time and should never
have been listed as deferred. Catalog seed drift and the strict-mode merged-heading
re-audit genuinely were open at the time; catalog seed drift was fixed 2026-07-29 (see
above). The `__raw` frontmatter escape hatch for genuinely nested values (e.g. inline
`mcpServers` server configs) remains open — see `plans/roadmap.md`.

---

## 2026-07-26 — Plan 01 (core loop) review complete

`plans/01-core-loop-implementation-plan.md` walked section by section with the user before
any code was written; all six §9 decisions (D1–D6) resolved. Real design changes that came
out of review, beyond confirming the original draft:

- **`AgentSnapshot`** — a new whole-agent (not per-section) table capturing full exported
  markdown at `pre-import`/`post-import`, for a future diff-view feature.
- **`Agent.platform`** — an open catalog (`PLATFORM_DEFS`), not a database enum; only
  `'claude'` exists. Platform is tracked on the agent itself, not just translated at export
  time.
- `model.allowedValues` settled on full model IDs only, `'inherit'` kept but flagged for
  later reconsideration. `SectionRevision.author` gained a fifth value, `'scaffold'`, for
  platform-created (not imported) sections.
- The import route moved from `POST /api/import` to `POST /api/agents/import`; `AgentDTO`
  gained the `platform` field.
- **The chat mediator's scope widened**, reopening a previously-locked design rule: it is no
  longer scoped to one `sectionId` — it is scoped to the whole agent, and may rewrite any
  number of sections a single instruction genuinely requires. `SectionRevision` became a
  per-section audit *log*, not the edit *boundary*. Per-section optimistic concurrency was
  preserved (baseline version per section, conflicts reported per-section with fresh
  content, one conflicting section never blocks the others).
- An interaction lock — chat and manual raw-edit are mutually exclusive per agent,
  client-enforced, with the per-section version check as the real backstop.
- Chat cancellation — `ChatPanel`'s `AbortController` and `request.signal` propagate to the
  Anthropic SDK call. Safe by construction: because changes are applied only after the
  mediator fully responds (apply-then-history), a cancelled request leaves the agent
  unchanged.
- **Prompt compilation resolved as compile-time, not runtime:** `scripts/build-prompts.ts`
  compiles both `design/system-agents/*.md` files into string constants at build time; the
  running server never touches `design/` at all. Originally placed later in the build
  sequence, then moved earlier after a real sequencing bug surfaced during review — an
  earlier build step needed the compiled prompts to already exist.
- New business rule: every `/api/agents/import` call writes exactly one
  `AgentSnapshot(post-import)`, plus a `pre-import` snapshot if the agent already existed.

---

## Earlier (2026-07-24 through 2026-07-26)

Design phase — `design/Concept.md` (the what/why), `design/TechDesign.md` (the how, data
model, Rules Index), and `design/audits/DesignReview.md` (the pre-build adversarial review
that produced the Rules Index) were written and reviewed before Plan 01 existed. The layout
(`design/layout/Layout-Workbench.html`) and stack (single Next.js app, Drizzle+SQLite,
`@anthropic-ai/sdk`) were locked during this phase.
