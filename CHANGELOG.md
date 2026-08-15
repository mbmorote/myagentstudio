# Changelog

Chronological project history, condensed to what changed and why it mattered — not a
session log. `CLAUDE.md` is current-state instructions only; `plans/roadmap.md` tracks live
status. For full blow-by-blow detail behind any entry below, see the referenced plan file,
`git log`, or `architecture/audits/CHANGELOG-detailed.md` (the prior, much more detailed
version of this file, kept locally as historical record — not tracked in git). Newest first.

---

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
from `lib/db/`. See `plans/11-second-llm-provider.md` for the full design.

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
