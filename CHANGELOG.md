# Changelog

Chronological project history, condensed to what changed and why it mattered — not a
session log. `CLAUDE.md` is current-state instructions only; `plans/roadmap.md` tracks live
status. For full blow-by-blow detail behind any entry below, see the referenced plan file or
`git log`. Newest first.

---

## 2026-08-31 — Share agent: live read-only access by link or email, plus copy-to-me (Plan 15)

An owner can now grant another user live, read-only access to an agent — via a reusable
256-bit public link code (`shr_…`), or by adding the recipient's email directly, even before
that person has an account. The recipient always sees the owner's current version, never a
stale snapshot; their only available mutation is **Copy to me**, which forks an independent
agent into their own library with no back-reference to the source. Read-only is structural,
not a permission flag: every mutating repository function keeps its required `ownerId`
parameter unchanged, so a share-holder has no code path that could edit, chat about, or
delete the owner's agent — it 404s exactly like a stranger's request would. Two new,
separate, viewer-scoped repository functions (`getAgentFullForViewer`,
`listSharedWithViewer`) are the only read paths that cross the ownership boundary;
`getAgentFull`/`listAgents` and every mutating function are untouched.

Shipped read-only over MCP too (`list_agents`/`get_agent`/`pull_agent` now viewer-scoped;
`push_agent` still strictly owner-scoped) — a scope originally deferred as "a plan-sized
change of its own," folded in after all.

UI: the right-hand panel became a two-tab dock (`Raw` | `Share`) instead of a single-purpose
Raw panel; the Library gained a "Shared with me" section and a redeem-code action; a
recipient's `/agents/[id]` renders a dedicated read-only view (name, description, config,
sections, Copy-to-me) instead of the owner's editable one, decided server-side, never by a
client toggle.

See `plans/archive/15-share-agent.md` for the full design record.

## 2026-08-27 — CI/CD: skip deploy on docs-only pushes; auto-merge item removed

Merging to `master` no longer redeploys identical app code when only documentation changed. A
new `changes` job (`dorny/paths-filter@v3`) diffs the push against `**/*.md`, `docs/**`,
`plans/**`, `reference/**`; `deploy` now additionally requires
`needs.changes.outputs.non_docs == 'true'`, so `test-and-build` still runs on every push but
the SSH deploy and AWS security-group open/close only run when something outside those doc
paths actually changed.

Two follow-up hotfixes were needed: the `changes` job initially had no `actions/checkout`
step, and `dorny/paths-filter` needs local git history to diff against `github.event.before`
on push events (unlike `pull_request` events, which use the GitHub API and don't need one) —
every push was failing the `changes` job outright, which meant `deploy` was skipped
unconditionally regardless of content. Second, the exclude patterns had no effect because
`predicate-quantifier` defaults to `'some'` (OR logic) — the leading `'**'` pattern alone
always matched, so a real docs-only PR (#21) still deployed. Setting
`predicate-quantifier: every` (AND logic) fixed it, confirmed by a second docs-only PR (#22)
correctly showing `deploy: skipped`.

The roadmap's paired "auto-merge tradeoffs" item was removed rather than carried forward — not
an engineering task, just a repo-settings decision.

## 2026-08-26 — CI/CD pipeline: push to master now auto-tests, builds, and deploys (Plan 03)

A push to `master` now automatically tests, builds, and deploys to the live server — no
manual SSH round-trip needed for routine updates. `.github/workflows/ci.yml` runs two
jobs: `test-and-build` (checkout, Node 22, `npm ci`, `npm test`, `npm run build`) on every
push and PR, then `deploy` (gated on `test-and-build` passing, only on a real push to
`master`) opens a temporary hole in the EC2 security group for the GitHub runner's own IP,
SSHes in with a dedicated, forced-command-restricted deploy key (can only ever run
`~/deploy.sh` on the server, nothing else), runs the same update sequence Plan 02's manual
procedure used (`git pull && npm ci && npm run build && pm2 restart` + a live health
check), then closes the security-group hole again — even if the deploy failed. A
`master` branch-protection rule now requires that check to pass before any commit can
reach `master` at all, whether via PR or direct push.

Proven end-to-end on its first real run (PR #2): CI green → SG opened → deploy executed
live (`Deploy over SSH` step: 1m 31s) → health check against `https://myagentstudio.dev`
passed → SG closed again. Two real bugs surfaced and fixed along the way, both process
issues rather than app bugs: a missing `pretest` npm hook meant CI's `npm test` had no
generated system-prompt files to import on a clean checkout (fixed by adding
`"pretest": "tsx scripts/build-prompts.ts"`, matching the existing `predev`/`prebuild`
pattern); and the scoped IAM user's policy was initially written against the wrong AWS
account ID (an org management-account ID pulled from an unrelated screen, not the actual
working account), causing the first live deploy run to fail with `UnauthorizedOperation`
until corrected.

**Gate-semantics shift, in effect from this point on:** pushing to `master` now literally
*is* deploying. The existing "no push without explicit go" standing gate absorbs the
deploy gate — there's no such thing as an innocent push to `master` anymore; work in
progress belongs on branches.

Plan 03's original scope also included an app version-number footer display and GitHub
Issues/labels/Project-board tracking conventions — both extracted out to
`plans/roadmap.md` as independent items (not part of the CI/CD flow itself). Full detail:
`03-CICD.md` in the Plans folder.

## 2026-08-24 — Added AGPL-3.0 LICENSE + README license/contributing sections (Plan 01 step 3)

Added `LICENSE`: the full AGPL-3.0 text pulled verbatim from `gnu.org/licenses/agpl-3.0.txt`
rather than reproduced from memory, to guarantee an exact legal document — left completely
unmodified, FSF copyright notice and all. README gained two new sections: **License** (one
sentence naming AGPL-3.0 with a link, one sentence noting commercial licensing is available
on request, plus the `Copyright (C) 2026 ProcessMind Solutions` line) and **Contributing**
(issues/small PRs welcome, larger contributions need prior discussion — the why is inline:
that discretion is what keeps the commercial-licensing option meaningful for a sole
copyright holder).

## 2026-08-24 — Full-history leak scan (Plan 01 step 2): scrubbed personal data from all 93 commits

The pre-publish plan's one irreversible-publish check (public-repo Plan 01, step 2) — scan
every commit, not just HEAD, since history is being published as-is. `gitleaks` found no
secrets/credentials anywhere in history. A manual sweep for personal data found real
findings starting in the very first commit, so surgical removal (`git filter-repo`, not a
squash — commit count/dates/messages/order all preserved, only hashes changed) was run
against the whole history in one pass, after a full backup bundle taken first (same
convention as the 2026-08-12 scrub):

- **Whole files removed from every commit they ever appeared in** (none exist in the
  current tree — this only affects recoverability from old commits): a personal
  career-evaluation document, three internal design-review files, and one test-fixture
  file that quoted the operator's name in an AI reply.
- **Text redacted everywhere it appeared, files otherwise left intact**: the operator's
  real first name (replaced with "the user"), full legal name, business tax ID, and
  personal Gmail address (the last one only fully covered on a second pass — the first
  pass's rule list missed it, caught and fixed by re-running the same verification sweep
  after).

Verified clean after: `gitleaks` re-scan (0 findings), and a full-history grep for every
flagged string across all 93 commits (0 hits). `origin` was detached by `filter-repo` as
its standard safety behavior — expected and fine, since the actual publish target is a
fresh public repo, not the old private dev remote that pointed there.

## 2026-08-24 — Pre-publish exclusion audit: moved the operator's personal identifiers out of tracked source

First pass of the pre-publish repo audit (public-repo Plan 01, step 1) surfaced three real
findings in the current tree — none in git history, all fixed rather than just flagged:

- `scripts/cleanup-test-users.ts` hardcoded the operator's real Gmail address as
  `KEEP_EMAIL`. Moved to a required `CLEANUP_KEEP_EMAIL` env var, read at invocation time
  and never stored — same pattern `scripts/bootstrap-user.ts` already uses for
  `BOOTSTRAP_USER_EMAIL`/`BOOTSTRAP_USER_PASSWORD`. The script now refuses to run at all
  if it's unset, rather than silently doing nothing.
- `app/privacy/page.tsx` and `app/terms/page.tsx`'s "Who We Are" section hardcoded the
  operator's full real legal name and real CNPJ inline. Both moved to
  `NEXT_PUBLIC_LEGAL_ENTITY_NAME`/`NEXT_PUBLIC_LEGAL_ENTITY_CNPJ` — same
  optional-env-var-with-a-graceful-fallback pattern the same files already used for
  `CONTACT_EMAIL`. Unset renders a generic-but-still-accurate statement naming only
  ProcessMind Solutions, not a broken or empty section — real values only need to exist in
  production's untracked `.env.local`.
- The same real CNPJ, in `CHANGELOG.md`'s own 2026-08-18 entry describing that page
  rewrite, was generalized (see that entry) since this file is real published history too,
  not exempt from the audit just because it's prose rather than code.

No git-history leak scan yet (Plan 01 step 2 — the actual irreversible-publish check);
this was only the current-tree pass.

---

## 2026-08-24 — Repo reorg: `architecture/` → `reference/`; roadmap reconciled around deferred launch checks

Moved `architecture/audits/` (gitignored historical archive — retired design docs, financial
evaluations, point-in-time reviews) out of the repo tree entirely onto local disk, alongside
other non-published planning material. With `audits/` gone, `architecture/`'s only remaining
content (`layout/` mockup + `Agent-Full-Reference.md`) no longer matched the old name, so the
folder was renamed to `reference/` — every live reference across `CLAUDE.md`,
`lib/ai/CLAUDE.md`, `plans/roadmap.md`, `scripts/build-prompts.ts`, `.gitignore`, and 7
component header comments updated in the same pass. Historical narrative in `CHANGELOG.md`
and `plans/archive/*` left as accurate-at-the-time record, per the project's own
frozen-archive convention — only the one dead functional pointer (to a detail file kept
outside the repo) was reworded.

`plans/roadmap.md` reconciled: **Deploy online** no longer folds the formal Big Flow Test,
the MCP write-path check, and the tokens-panel visual QA into its own gating scope — a
manual smoke test of the core flow already covers this launch, so all three move to a new
NEXT item, **Post-launch verification pass**, run against the real deployment instead of
blocking it. The MCP item's own card updated to reflect that its read-only surface is
already live-verified (2026-08-24) and only the write half remains open. The top-level
Overview table (which had drifted out of sync with the detailed TODO section below it) was
resynced in the same pass.

---

## 2026-08-24 — Closed Plan 13's remaining checklist; MCP tools renamed push/pull; live-verified reads against a real client

Closed out the last of Plan 13's pre-launch checklist. **QA validation against the plan
spec — PASS**: every constraint, all seven D-decisions, and the full fitness-function table
verified against the actual implementation, with one cosmetic-only deviation noted (the
plan's `myagent://` URI text vs. the built `myagentstudio://`, just the project rename
landing after the plan was drafted). **Docs review (Plan 13's slice, closing the roadmap's
three-plan docs-review item)** found a stale repo-structure diagram in
`docs/system-about.md` §2 (never mentioned `app/api/mcp/`, `app/api/account/tokens/`, or
`lib/mcp/`) and a real bucket-drift bug in the public `docs/roadmap.md`: four items
(Console MCP access, Group organization, AI chat history persistence, Export to other
platforms) sat under "Planned" ("timing not yet committed") when they're all internally
scoped as NEXT — Console MCP access's own row text even said "Built; pending final
verification," directly contradicting its own bucket. All four moved to "Coming Next."

**MCP tools renamed:** `export_agent` → `pull_agent`, `import_agent` → `push_agent` — the
CLI/git mental model MCP clients live in (pull the current version down, push your edited
version back up), rather than the web UI's own "import"/"export" vocabulary, which is
unchanged. Touched ~20 files (tool implementations, `server.ts`, tests, and every doc that
named the old tools); `tsc`/`npm test` clean after.

**MCP server live-verified for reads, against a real client — not simulated.** Connected a
genuine Claude Code session to `/api/mcp` (`claude mcp add`), confirmed the handshake, and
successfully called `list_agents` and `pull_agent`/`get_agent` — real agent list back, real
content pulled down and used to update a local file. This surfaced a real local-dev bug: the
per-token rate limiter's pre-lookup IP check collapses every no-reverse-proxy client into one
shared `'unknown'`-IP bucket, and the original 10-attempts/15-minute ceiling was tight enough
that a handful of legitimate test calls could trip it. **Fixed:** raised to 20/15min
(`lib/auth/rateLimit.ts`) — a shared constant with the login/signup limiter, so all four
call sites' hardcoded test boundaries (`lib/auth/__tests__/rateLimit.test.ts`,
`app/api/auth/__tests__/{auth,request-access,oauth-start}.test.ts`) were updated too, not
just the constant. `tsc`/`npm test` clean after. The billed write-path half (`push_agent`)
and the tokens-panel visual QA are still open — folded into the "Deploy online" TODO item's
own acceptance criteria, to run against the real deployment instead of local dev.

Also: `app/layout.tsx` never had favicon metadata configured — every browser was falling
back to a generic default icon. Wired up the existing `processmind-mark.png` brand asset via
Next.js's standard `metadata.icons`.

`plans/13-mcp-server-exposing-agents.md` moved to `plans/archive/` (one step ahead of its own
"once live-verified" rule, by explicit decision to consolidate tracking onto
`plans/roadmap.md` alone); `plans/review-checklist-temp.md` deleted, its purpose served.

## 2026-08-20 — Closed Plan 12's docs-review slice; fixed a dead link for non-admin users

Docs-review pass for Plan 12's topics (the second and third of the roadmap's
"docs review for Plan 11/12/13" TODO item, following Plan 11's slice earlier the
same day) surfaced a real functional gap, not just stale wording: `ChatPanel.tsx`
and `ImportDialog.tsx`'s dry-run notices both showed a "View log entry →" link
unconditionally, pointing at `/settings?log=<id>` — but that route
(`app/settings/page.tsx`) is admin-only and redirects any non-admin session to `/`.
For a regular user, the link silently failed. The Preferences modal's own
`ActivityLogPane.tsx` had already handled this correctly (its Permalink button is
admin-only-shown, by design, for exactly this reason) — the fix just hadn't been
applied to these two older call sites.

Fixed: both links are now gated to `isAdmin`, threaded down from `WorkbenchShell.tsx`'s
existing `session` prop (`ChatPanel` directly; `ImportDialog` via
`LibraryPanel` → `ImportButton`). A non-admin now sees a plain note pointing at their
own Activity log category instead of a dead link. `docs/user-guide.md`'s "Deep links"
paragraph updated to describe the admin-only behavior accurately.
`docs/project-explanation.md` checked — no Plan 12 mentions, nothing stale.
`npx tsc --noEmit` clean; `npm test`: 68/68 files, 880/880 pass.

## 2026-08-20 — Closed NVIDIA live-call verification TODO; found and fixed a real provider bug along the way

Live-verified the second LLM provider (Plan 11) against a real NVIDIA NIM account —
the one step Plan 11 had deliberately left undone. Along the way, found and fixed a
real bug rather than just confirming the happy path:

- **Double-`/v1` path bug:** `openaiCompatibleProvider.ts`'s `COMPLETIONS_PATH`
  (`/v1/chat/completions`) was being appended to a base URL that — per every real
  vendor's own documented convention (NVIDIA, OpenAI, Groq all ship `base_url` already
  ending in `/v1`) — already carried that segment, doubling into
  `/v1/v1/chat/completions` and 404ing on every live call. Fixed the code to append
  `/chat/completions` only; updated the architecture fitness test's guarded token to
  match.
- **Not every catalog-listed model is callable:** confirmed live that
  `nvidia/llama-3.1-nemotron-70b-instruct` (the model Plan 11's docs previously
  recommended) 404s with "Function not found for account" on a free-tier key despite
  being listed in NVIDIA's `/v1/models` catalog — an account-entitlement gate, a
  documented pattern on NVIDIA's own developer forums. Replaced the recommended/default
  model with `meta/llama-3.1-8b-instruct` (confirmed working) in `.env.example`,
  `README.md`, and the code-level fallback in `lib/env.ts`; documented other
  confirmed working/broken models for future reference.
- **Guardrail added:** the same live testing surfaced a real content-corruption case —
  a small model (`meta/llama-3.1-8b-instruct`) returned structurally valid JSON that
  truncated a section's content down to a placeholder stub, which the app applied with
  no warning. Added a purely quantitative "drastic shrink" check to
  `parsePrometheusResponse()` (warns, never blocks, no text-pattern/keyword matching —
  this app's own agents are themselves about agents, so keyword heuristics risk false
  positives) plus an explicit anti-truncation example in Prometheus's own system prompt.
  The one real agent this happened to (`analyst`) was restored from
  `section_revision`/`agent_snapshot` history.

Confirmed via `llm_call_log`: a real chat call now completes successfully with
`provider: 'openaiCompatible'`, the right model, and real usage numbers. `npx tsc
--noEmit` clean throughout; `npm test`: 68/68 files, 880/880 pass.

## 2026-08-18 — Closed two Plan 12 TODO checks

**Workbench branding + disclaimer render check:** already covered by the same-day live
review — the `ConsentPopup.tsx` sensitive-data disclaimer and the Workbench footer
(ProcessMind Solutions mark) were both confirmed rendering correctly during that pass. The
roadmap line just hadn't been updated to reflect it; closed with no further action needed.

**Landing walkthrough UX — annotation finding:** the `ux` agent's 2026-08-17 review flagged
that the walkthrough's real-UI screenshots had no callout/arrow tying specific copy claims
(e.g. "every proposed change shows as a diff") to the exact region of a dense screenshot
that demonstrates them. Decided not to build: the screenshots are already tightly cropped
per-step to match their copy, which does the same job well enough — drawing overlay
annotations on top isn't worth the time right now. Closes the item; the other 9 of 10
findings from that review were already fixed 2026-08-17.

## 2026-08-18 — Synced public docs with Plan 12's shipped changes

`docs/user-guide.md` and `docs/system-about.md` still described the pre-Plan-12 world in
several places: the activity-log-sharing default as private/opt-in (flipped to
shared/opt-out earlier today), the activity log as admin-only (it's been per-user since
the Preferences-modal merge), the separate "⚙ System Settings"/"Account" Topbar buttons
(merged into one "⚙ Settings" button days ago), and "a single shared API key" (there can
be two providers now). Also added a mention of "Request access" as an alternative to
an admin generating a code unprompted, and noted the request payload's now-admin-only
visibility in a regular user's own activity log. `docs/roadmap.md`'s capability matrix
moved the guided tour and the beta/sensitive-data notice from "Coming Next" to "Available
Today" — both shipped and were live-verified this session.

## 2026-08-18 — Fixed login modal's account-creation link; added Request-access test coverage

Live review of Plan 12's "Request access" flow found a real bug: the login modal's one
"Sign up with an invite code" link actually opened the *Request access* sub-form instead,
because the shared signup modal hardcoded its opening sub-form regardless of which of the
page's three triggers opened it. Fixed by tracking which sub-form each trigger wants
(`WelcomePage.tsx`'s `signupMode` state, `LoginForm.tsx`'s `onSwitchToSignup(mode)`) and
showing two explicit links — "Have an invite code? Sign up" / "Don't have one? Request
access" — instead of one. `SignupForm.tsx` also now honors a `?mode=request` query param
so the standalone `/signup` page's equivalent link works the same way.

This flow (`POST /api/auth/request-access` and the admin-side Settings → Access requests
grid) had zero automated test coverage before today, unlike login/signup which were both
already covered. Added `app/api/auth/__tests__/request-access.test.ts` (16 tests) and
`app/api/settings/__tests__/access-requests.test.ts` (13 tests), including an end-to-end
case proving a generated code is genuinely bound to the requester's email. `npm test`:
68/68 files, 873/873 pass; `tsc`: clean.

Also extended `scripts/cleanup-test-users.ts` with an opt-in `--full` flag (wipes all
invite codes and access requests, not just ones tied to deleted users) — used to reset the
dev DB to a clean slate for this live test.

Closes Plan 12's "Request access" review item; live end-to-end verified by hand (request →
admin generates code → signup) and confirmed working.

## 2026-08-18 — `/welcome`, `/terms`, `/privacy` browser-verified

Closes the roadmap's "Check: `/welcome`, `/terms`, `/privacy` render correctly in
browser" NEXT item. Verified live and incrementally throughout the session as each
page's content changed: the landing page's hero/walkthrough/feature grid/roadmap wave in
both themes, the footer author identity resolving to real values (not the placeholder
fallback), and the fully-rewritten Terms/Privacy pages after their content overhaul. No
code changes from this pass — pure verification.

## 2026-08-18 — Renamed MyAgent to MyAgentStudio

Cosmetic/branding rename only, no functional change. Updated everywhere a human sees the
product's name: page titles and metadata, the topbar/landing/terms/privacy brand text,
every live doc (`README.md`, `CLAUDE.md` and its nested folder copies, `docs/*.md`,
`plans/roadmap.md`), the `package.json` name field, and the MCP server's own registered
name and resource URI scheme (`myagent://agent/{id}` → `myagentstudio://agent/{id}` in
`lib/mcp/resources.ts`/`server.ts`, since that's genuinely visible to real MCP clients).

Left three things as internal/technical identifiers, deliberately not touched: the SQLite
database filename `myagent.db` (renaming it would orphan the real local dev database file
on disk with no benefit), the guided tour's `myagent_tour_seen` localStorage key (renaming
it would just reset that flag for existing users), and the project's own folder path on
disk. Past-dated `CHANGELOG.md` entries below are left exactly as originally written —
the product really was called MyAgent when those things happened, rewriting history to
match the new name would be inaccurate, not helpful.

## 2026-08-18 — Terms of Service and Privacy Policy rewritten, grounded in real practice

Both `/terms` and `/privacy` shipped 2026-08-15 as generic SaaS boilerplate. Rewrote both
to actually describe what the system does — verified against `lib/db/schema.ts` and
`docs/system-about.md`, not assumed. Privacy Policy gained sections on who can see chat
content (the admin, only if the user has opted in via the Activity Log Sharing consent
toggle — a real, distinctive control worth naming explicitly rather than folding into
generic "data sharing" language), which AI providers process content, and data retention
(honest: the activity log has no purge policy yet, stated as such rather than implied
otherwise). "Your Rights" names GDPR and CCPA explicitly rather than staying vague — CCPA's
revenue/volume thresholds aren't met at this beta's scale, but GDPR applies per
data-subject location regardless of company size, and the intended audience (~10-15
invited IT/professional users, not personal friends) is realistic enough about privacy
rights to ask.

Both pages gained a new "Who We Are" section naming the real legal entity behind
ProcessMind Solutions (a Brazilian Empresário Individual under Simples Nacional, with its
real CNPJ) at the operator's explicit request — deliberately excludes CPF, home address,
and phone number even though those exist in the underlying registration record, since a
public legal page has no legitimate need for that level of detail. Closes the roadmap's
"`/terms` jurisdiction placeholder" TODO item — Governing Law now names Brazil, matching
where the entity is actually registered, instead of the literal `[jurisdiction]`
placeholder that had been sitting there since Plan 12. (Name/CNPJ themselves moved out of
tracked source entirely on 2026-08-24 — see that date's entry.)

## 2026-08-18 — Preferences modal: Account + Settings merged, per-user activity log, gateway bug fix

Retired the two separate topbar entry points ("⚙ System Settings", admin-only, and
"Account", everyone) and their modals (`SettingsModal.tsx`, `AccountModal.tsx`) in favor of
one `PreferencesModal.tsx` opened from a single "⚙ Settings" button — a left sidebar of
categories: **Account** (everyone, reuses `AccountView.tsx` unchanged), **LLM** and
**Admin** (admin only — `LlmSettingsPane.tsx`/`AdminSettingsPane.tsx`, platform settings,
Access requests, Invite codes, and a new Users grid that didn't exist before), and
**Activity log** (everyone — `ActivityLogPane.tsx`). Prototyped first in
`architecture/layout/Layout-Workbench.html` per standing rule 4. `SettingsView.tsx`/
`app/settings/page.tsx` deliberately untouched — still the admin-only full page the
Activity log's "Permalink" link deep-links to.

The Activity log split closes the roadmap's "Per-user view of the activity log" item for
real: `GET /api/llm-call-log` and `GET /api/llm-call-log/[id]` are no longer admin-gated
(`authenticateAdmin` → `authenticate`) — a non-admin is forced server-side to their own
`userId`, and fetching someone else's row now 404s (existence hidden) instead of 403ing.
Needed a `userId → email` resolution that didn't exist yet — added via a `LEFT JOIN` in
`listCallLogs()`/`getCallLog()` (`lib/db/repository/llmCallLog.ts`, new
`CallLogListItem.userEmail`). Pagination (10/page, shared `Pager` component) added to
Access requests, Users, and Activity log.

**Real bug found and fixed along the way, not present before this pass:** running the full
test suite after this work failed 17 tests with `502`/`ai_upstream` instead of expected
dry-run responses — `providerRegistry.ts`'s `getProviderById()` (Plan 11) eagerly checked
`isProviderConfigured()` and threw whenever `ANTHROPIC_API_KEY` was unset, and since
`gateway.ts` resolves the provider before its dry-run gate (to log the model that would
have been used), this fired on *every* call including dry-run — breaking the Plan
04-documented no-API-key dry-run deployment mode. Fixed: `getProviderById()` no longer
checks configuration at all — constructing a provider needs no credential, only an actual
network call does, and each provider's own `complete()`/`stream()` already throws clearly
when that happens, now properly caught and logged by `gateway.ts`'s existing live-path
try/catch instead of firing unhandled before any log row exists. Also fixed the 8
pre-existing `tsc` errors flagged after Plan 11 (`NODE_ENV` read-only in `@types/node`,
missing `provider` field in three log-repository test fixtures). `npm test`: 66/66 files,
842/842 pass. `npx tsc --noEmit`: clean.

## 2026-08-18 — Guided tour copy signed off

User read all seven steps of `GuidedTour.tsx` and signed off on the wording as-is — no
changes needed. Closes the roadmap's "Check: guided tour copy sign-off" TODO item, the
last open piece of Plan 12's guided-tour work.

## 2026-08-18 — Guided tour polish: icon-only trigger, bigger popover, smarter positioning

Found and fixed live while reviewing the tour, not from a written checklist. The topbar
trigger was "ⓘ Guided tour" (icon + visible text label); now icon-only — a small "?"
badge, with the label moved to `title`/`aria-label` as a hover hint instead. The step
popover was hard to read at `300px` wide with `12px` body text — widened to `380px`,
title `14px → 17px`, body `12px → 14px` with looser line-height, padding scaled to
match. Found a real positioning bug along the way: the popover only ever stacked
below/above its target, so a tall narrow sidebar panel (step 2, Library) got covered
almost entirely once the popover itself grew wider than the panel. Fixed generally — a
tall/narrow target now prefers placing the popover *beside* it, top-aligned, before
falling back to the original below → above → vertically-centered chain — which should
also help the later Chat/Raw-panel steps that likely hit the same narrow-panel case.

## 2026-08-15 — MCP server exposing MyAgent's agents (Plan 13)

Built (not yet run or live-verified) an MCP server at `POST /api/mcp` so a console/CLI MCP
client (Claude Code and equivalents — Claude Desktop's GUI connector is explicitly not a
target) can list, read, export, and import a user's own agents outside the browser. A new
credential type, per-user Personal Access Tokens (`mya_` + 43 random chars, SHA-256-hashed
at rest, scoped `read`/`write`, revocable, generated in a new Account panel), authenticates
requests via `lib/auth/mcpGuard.ts`'s `authenticateMcpToken()` — a third sibling to
`authenticate()`/`authenticateAdmin()` that deliberately never returns a role, since an
admin's MCP token grants exactly a normal user's powers.

Four tools: `list_agents`, `get_agent`, `export_agent` (all read-only, zero LLM calls) and
`import_agent` (the only write, gated by token scope + a new `mcpWrites` admin setting,
default off + the existing per-user hourly LLM cap — no MCP-specific limit). Deliberately
**no** structured field-level write tool — `import_agent` composes the same pipeline the web
UI's import route uses (`parse` → `callDaedalus`/`callHermes` → `assembleStructural`/
`assemble` → `checkCoverage` → `upsertAgentFromImport`), inheriting its whole safety story
(pre/post-import snapshots, `reimport`-tagged revisions, the byte-identical short-circuit,
truncation rejection) for free instead of forking a second, thinner write path.
`llm_call_log` gained a nullable `origin: 'web' | 'mcp'` column so the audit trail can tell
the two calling surfaces apart — the same fidelity fix Plan 11 made for `provider`.

Stateless Streamable HTTP transport (`@modelcontextprotocol/sdk`, confined to exactly one
file — `lib/mcp/server.ts` — enforced by a fitness test alongside three more constraints:
no mutating repository function besides `upsertAgentFromImport`, no direct provider/SDK
import, no session-cookie read anywhere under `lib/mcp/`). `middleware.ts` bypasses
`/api/mcp` by exact path — the route re-authenticates independently, same as every other
route. See `plans/archive/13-mcp-server-exposing-agents.md` for the full design and the seven
resolved decisions, and `lib/mcp/CLAUDE.md` for the folder map.

## 2026-08-15 — Second LLM provider (Plan 11)

Added an OpenAI-compatible provider (`lib/ai/openaiCompatibleProvider.ts`) behind the
existing `LLMProvider` interface, with no new npm dependency. The implementation uses plain
`fetch` against any `/v1/chat/completions` endpoint — NVIDIA NIM, OpenAI, Groq, Together,
Mistral, vLLM, Ollama, and others all speak the same wire format. A new admin-only `'llmProvider'`
setting (default `'anthropic'`) selects which vendor answers every AI call; switching takes
effect on the next call with no restart. A provider with no key configured cannot be
selected (`400 provider_not_configured`).

Two latent bugs fixed in the same pass: the `llm_call_log.provider` column existed since
Plan 04 but was never written (every row silently claimed `'anthropic'` regardless) — now
written explicitly on every path including dry-run. The Settings UI's branch on
`datatype === 'bool'` or `'int'` left a `'string'` setting with no control at all — a new
`'enum'` datatype and `<select>` renderer complete the pattern for the provider selector.

A new `providerRegistry.ts` is the only file that knows both providers exist; a table-driven
architecture fitness function (`lib/ai/__tests__/architecture.test.ts`) now enforces the
transport isolation rule for both providers (not just a hardcoded single-SDK check) and
additionally test-enforces the rule that no `lib/ai/` file except `gateway.ts` may import
from `lib/db/`. See `plans/archive/11-second-llm-provider.md` for the full design.

## 2026-08-12 — Pre-launch review & docs restructure (Plan 10)

Reviewed docs/code/test organization project-wide and fixed what it found: dead code
removed, several test-quality rewrites, ~15 new test files covering previously-untested
modules, plus a general code-quality pass (8 correctness fixes, including a real race
condition in the per-user LLM call cap). Replaced `architecture/Concept.md`/`TechDesign.md`
with an audience-oriented `docs/` set (`system-about.md`, `project-explanation.md`,
`roadmap.md`); archived plans 01–09; rewrote root `CLAUDE.md` as a pure folder map; added
`lib/auth/CLAUDE.md` and `lib/db/CLAUDE.md`; rewrote this file. See
`plans/archive/10-pre-launch-review-docs-restructure.md`.

## 2026-08-12 — Chat reliability fixes; groups deferred pre-launch

Fixed three live chat bugs found through real usage: a non-JSON model reply no longer
crashes the chat (graceful fallback instead of an opaque error), a truncated response is
now caught before it can silently corrupt a proposal, and the model's reply can no longer
point at content it wrote outside the JSON envelope. Chat's max-output-tokens ceiling
became an admin setting instead of a hardcoded literal. Section delete via chat closed out
(add had landed the day before). Library group management (create/assign/drag) was
deliberately flag-disabled ahead of launch — the data model and API are untouched, only the
UI entry points are off; see `plans/roadmap.md` NEXT item 18 to re-enable.

## 2026-08-11 — Chat-driven section add

Prometheus could propose a brand-new section via chat, but nothing actually created it —
found live, fixed the same session. New sections now get a server-derived heading and
insert at their canonical catalog position instead of always appending last.

## 2026-08-07 — Chat carries conversation history

Prometheus now sees recent prior turns, not just the current instruction, so a follow-up
like "make that shorter" resolves correctly. How many turns are kept is an admin setting.

## 2026-08-06 — Prometheus rename, propose/apply chat editing (Plans 07–08)

The chat mediator was renamed Prometheus and rewritten in the project's own real-agent
shape. Chat editing widened from sections-only to sections + config + description (never
`name`), and switched from auto-apply to an unconditional propose-then-apply flow: the chat
endpoint writes nothing; a separate apply endpoint performs the write, with a client-side
interaction lock while a proposal is pending. The import converters were renamed Hermes
(Strict) and Daedalus (Structural) in the same pass.

## 2026-07-31 — Google OAuth sign-in (Plan 06)

Fixed `middleware.ts` duplicating JWT verification, made the session TTL configurable via
an env var, and added Google OAuth 2.0/OpenID Connect sign-in alongside password auth —
the invite-code gate still applies to OAuth signups, verified live against real Google
infrastructure.

## 2026-07-30 — Multi-tenant accounts (Plan 05)

Real user accounts: JWT sessions, bcrypt password hashing, invite-code signup, admin/user
roles, owner-scoped data access, opt-in activity-log sharing consent, and a per-user hourly
LLM call cap.

## 2026-07-29 — LLM gateway, dry-run mode, Settings page (Plan 04)

Every AI call now funnels through one gateway function. Added a dry-run mode that blocks
real API calls at the gateway level, an activity log of every call attempt, and a Settings
page to control both.

## 2026-07-29 — Groups, export download, docs reorganization

Real group/membership data with drag-and-drop in the Library panel; one-click `.md`
download from the Raw panel; a Library Agents/Grouped view toggle and a Tier 1 config-zone
redesign; `design/` renamed to `architecture/`, system-agent prompts moved into `lib/ai/`.

## 2026-07-28 — Structural Import, Blueprint refresh, first docs pass (Plan 02)

Added Structural Import (the AI restructures the whole document) alongside Strict Import
and made it the default mode. Refreshed the config/tools/model catalogs against real Claude
Code docs, fixed most of a UI punch-list from early dogfooding, and wrote the first
`README.md`/user-guide/dev-flow documentation.

## 2026-07-26 — Core loop reviewed and built (Plan 01)

The structured view + agent-aware AI chat core loop, the import pipeline's first build, and
persistence — reviewed section-by-section before any code was written.

## 2026-07-24 – 2026-07-26 — Design phase

`Concept.md` (the what/why), `TechDesign.md` (the how — data model, design rules), and a
pre-build adversarial design review were written and reviewed before any code existed. The
4-pane layout and the stack (single Next.js app, Drizzle + SQLite, `@anthropic-ai/sdk`)
were locked during this phase.
