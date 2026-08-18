# Changelog

Chronological project history, condensed to what changed and why it mattered — not a
session log. `CLAUDE.md` is current-state instructions only; `plans/roadmap.md` tracks live
status. For full blow-by-blow detail behind any entry below, see the referenced plan file,
`git log`, or `architecture/audits/CHANGELOG-detailed.md` (the prior, much more detailed
version of this file, kept locally as historical record — not tracked in git). Newest first.

---

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
ProcessMind Solutions (a Brazilian Empresário Individual under Simples Nacional, CNPJ
[REDACTED]) at the operator's explicit request — deliberately excludes CPF, home
address, and phone number even though those exist in the underlying registration record,
since a public legal page has no legitimate need for that level of detail. Closes the
roadmap's "`/terms` jurisdiction placeholder" TODO item — Governing Law now names Brazil,
matching where the entity is actually registered, instead of the literal `[jurisdiction]`
placeholder that had been sitting there since Plan 12.

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
route. See `plans/13-mcp-server-exposing-agents.md` for the full design and the seven
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
