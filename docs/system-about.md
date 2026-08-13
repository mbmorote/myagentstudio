# MyAgent — System About

The engineering reference for the workbench: what it's built on, how the pieces fit
together, and why the design is shaped the way it is. Written for a developer or tech
lead evaluating or extending the codebase. For the product story (problem, audience,
feature flows), see `project-explanation.md`. For what's shipped vs. planned, see
`roadmap.md`.

---

## 1. Stack

A single Next.js full-stack app — local-first, one process, one deploy unit.

| Layer | Choice | Why |
|---|---|---|
| Shell | Next.js (App Router) | One codebase serves both the UI and the API; goes online later with no rewrite. |
| Frontend | React (via Next) + Tailwind CSS | The 4-pane workbench UI. |
| Backend | The same Next app — Route Handlers (`app/api/**`) | Runs server-side, so it's the only place that ever holds the Anthropic API key. No second service, no CORS. |
| Storage | Drizzle ORM + SQLite (`better-sqlite3`), behind a repository layer | Strong TypeScript types over the EAV tables; the repository boundary means a future storage-engine change is a schema-file rewrite, not an app-wide one. |
| AI | `@anthropic-ai/sdk`, imported from exactly one file (`lib/ai/anthropicProvider.ts`) | Single choke point — every AI call in the app funnels through `lib/ai/gateway.ts`, which is the only caller of the provider. |
| Auth | Custom JWT (`jose`, HS256) in an `httpOnly` cookie, `bcryptjs` password hashing, optional Google OAuth (`arctic`, imported from exactly one file) | No third-party auth service; a session is a signed token plus a DB row re-read on every request. |

The Anthropic key lives in `.env.local` (git-ignored), read only inside Route Handlers.
The browser never sees it and never calls Anthropic directly — every AI-touching request
goes through the app's own `/api/*` endpoints.

## 2. Repository structure

```
app/
├── page.tsx, layout.tsx        the 4-pane workbench shell
├── login/, signup/, account/, settings/   auth + settings pages
├── components/
│   ├── shell/                  Topbar, Panel, Gutter, Rail — the 4-pane frame
│   ├── Library/                agent list, groups, import dialog
│   ├── CustomViz/               the structured agent view (AgentView, SectionBlock)
│   ├── Chat/                    ChatPanel — the Prometheus chat + proposal card
│   ├── Raw/                     RawAgentView — read-only export preview
│   ├── Auth/                    Login/Signup forms, GoogleButton, ConsentPopup
│   ├── Settings/                SettingsView, SettingsModal
│   └── Account/                 AccountView, AccountModal
└── api/
    ├── agents/                  CRUD, import, export, sections, apply-proposal, groups
    ├── groups/                  group CRUD
    ├── chat/                    Prometheus — proposes, writes nothing
    ├── auth/                    login, signup, logout, oauth/[provider]/{start,callback}
    ├── settings/                 System Settings + invite codes
    ├── account/                  the signed-in user's own settings
    └── llm-call-log/             activity log reads

lib/
├── db/                          Drizzle schema, migrations, seed, repository/*
├── blueprint/                   the Agent Blueprint (catalog + rule functions)
├── serialize/                   deterministic import-parse (Stage 1) + export
├── import/                      Stage-2 assembly (Strict + Structural), coverage check
├── ai/                          the LLM gateway, the three system agents, prompt compiler
├── auth/                        session, JWT, password hashing, OAuth, rate limiting
├── apiFetch.ts, proposalStore.ts, settings.ts, env.ts, utils.ts

lib/ai/prompts/system-agents/    source .md for Hermes / Daedalus / Prometheus
lib/ai/prompts/generated/        build-time compiled output (gitignored)
scripts/build-prompts.ts         compiles the above at predev/prebuild
```

`app/api/*` is the server tier — the only place that holds the Anthropic key or talks
to the database with elevated trust. `app/components/*` is the client tier and never
touches either directly; it calls the app's own API.

## 3. Design principles

These hold across the whole codebase, not just one feature:

- **The platform is master.** Structured data in the database is the source of truth;
  `.md` files are an export target, not the storage format. Importing a file parses it
  back into structure — nothing is ever read from disk at request time.
- **Structured-first, serialize on demand.** An agent is stored as typed frontmatter
  rows plus ordered body-section rows, and rendered to a `.md` string only when exported
  or previewed.
- **Lossless round-trip.** Import → edit → export never silently drops content. An
  unrecognized frontmatter key or an unmapped body section is preserved verbatim rather
  than discarded.
- **Spec-clean export.** An exported `.md` file contains only real Claude Code
  frontmatter fields — platform-only concepts (internal ids, group membership) never
  leak into it.
- **Two zones, one pattern.** Config (frontmatter) and Sections (body) are modeled
  identically: a predefined catalog (`ConfigDef` / `SectionDef`) plus per-agent values,
  with an unrecognized key or heading always accepted rather than rejected. There is no
  foreign key on either — the catalog *enriches* a known entry (label, validation,
  template) but never gates an unknown one.
- **Flag, don't block.** Nothing about an agent's content is ever silently rewritten or
  refused on the way in. A malformed or unrecognized value is stored as-is and surfaced
  as a validation flag for the user to notice and fix, never corrected for them.
- **Import is AI-assisted; export is deterministic.** Turning messy real-world markdown
  into structured data needs judgment, so an LLM is in the loop for import. Turning
  structured data back into markdown needs no judgment — export is pure, deterministic
  code with no AI call.
- **Safe conversion by construction.** Import never deletes or rewords content — it only
  ever *maps* content onto the Blueprint. Anything that can't be mapped becomes a
  `custom` entry, verbatim. This is what keeps the lossless-round-trip principle true
  even with an AI in the import path.
- **The AI key never leaves the server.** Never in client code, never in a log, never
  committed. This is checked before every commit and deploy as a standing habit, not a
  one-time audit.
- **Every fact lives in exactly one document.** Applies to the docs you're reading now as
  much as to the code: status lives in `plans/roadmap.md`, history in `CHANGELOG.md`,
  and each of these three `docs/` files owns a distinct audience rather than repeating
  the others.

## 4. Domain model

### Overview

```
Group ──< Membership >── Agent ──< AgentConfig >·· ConfigDef    (·· = soft lookup by key, no FK)
  │                        │
  │                        └──< AgentSection >·· SectionDef  (·· = soft lookup by key, no FK)
  │                        └──< AgentSnapshot            (whole-agent import/export capture)
  │                        └── AgentSection ──< SectionRevision   (append-only edit history)
  └─ parentId (self, nullable — flat today, nestable later)

User ──< Agent, Group (ownerId)
User ──< OAuthAccount (provider, providerAccountId)
User ──< InviteCode (createdBy / redeemedBy)
User ──< llm_call_log (userId)
```

Every `Agent` and `Group` row is scoped to an owning `User` (`ownerId`), enforced in the
same repository statement that reads or writes the row — there is no code path that can
return another user's agent even by omission, because no repository function exists that
would return it. Cross-owner access attempts return `404`, never `403`: a `403` would
confirm the resource exists, which is exactly the information a cross-owner request
shouldn't get.

### Agent

The only two spec-required fields — `name` and `description` — are real columns; every
other config/section value lives in the EAV (Entity-Attribute-Value) tables below. `name`
is stored exactly as imported (any casing, any format) and is never validated or
rewritten — the workbench's own naming-convention check was deliberately removed rather
than enforced. `platform` is an open string keyed to a small `PlatformDefs` catalog
(today, only `'claude'` exists) rather than a closed enum, so a second target platform is
a catalog entry and an export serializer, not a migration. `rawSourceSnapshot` retains
the entire original `.md` byte-for-byte at import time, independent of how it was later
sliced into sections — the ground truth for "what did I actually import," always
available even if a structural-import decision turns out wrong.

### Config zone — frontmatter

`ConfigDef` is the seeded catalog of known frontmatter fields (`model`, `tools`,
`permissionMode`, `maxTurns`, `skills`, `hooks`, `mcpServers`, `color`, `isolation`,
`initialPrompt`, …) — each with a `datatype` (`string` / `enum` / `int` / `bool` / `list`
/ `json` / `any`), `allowedValues` where relevant, and whether it's core or advanced.
`AgentConfig` holds the actual per-agent value against a free-text `propKey` with no
foreign key to the catalog — an invented key stores and exports fine, rendered generically
once it isn't recognized. A genuinely nested value (an inline `mcpServers` server config,
a `hooks` object) is preserved verbatim via `datatype: 'json'` rather than flattened or
rejected. This is also where the review/validation feature comes from for free: a `model`
value outside `allowedValues`, or a `tools` entry that isn't a real tool name, is flagged
as outdated/unknown without blocking anything.

### Section zone — body

`SectionDef` is the seeded catalog of body sections. Four are core (seeded into every new
agent): **Role, Behavior, Guardrails, Output**. Five are optional, opted in per agent:
**Sources, Lifecycle, Handoffs, Tone, Modes** and **Boundaries** (a later addition,
distinct from Guardrails — Guardrails covers actions the agent must not take; Boundaries
covers assumptions/inferences it must not make when context is incomplete). Each catalog
entry carries a `template` (pre-filled scaffold) and `helpText`, so a new section is never
a blank box.

`AgentSection` holds the actual content, keyed the same open way as config
(`sectionKey`, no foreign key — an unrecognized heading becomes `custom` and still
renders, exports, and edits normally). `heading` is nullable: `null` represents a
headingless block (most often the pre-heading preamble a raw file sometimes has), and
export renders it as bare content rather than inventing a heading, which would falsely
turn back into a real section on the next import. A section's on-screen label prefers the
catalog label, then falls back to its own stored heading text, and only falls back to the
raw `sectionKey` if neither exists — a `custom` section is shown by what it's actually
called, not the generic word "custom."

### SectionRevision — append-only edit history

Every section's history starts the moment it's created — imported, scaffolded fresh, or
added via chat — and every later edit appends a new row rather than overwriting one.
`AgentSection.content` always holds the current state (the latest revision, denormalized
for fast reads); `SectionRevision` is the log, and it is never updated or deleted. A
revision's `author` is one of `import` / `reimport` / `scaffold` / `user` / `ai`, so the
log visually distinguishes "this is what the file said on day one" from "this arrived via
a later re-import" from "the user typed this" from "chat wrote this." A revision row is a
soft reference to its section, not a cascading foreign key — deleting a section (e.g. one
dropped on re-import, or removed via chat) does not delete its history.

### AgentSnapshot — whole-agent capture

Where `SectionRevision` answers "what did this one section look like before," a snapshot
answers "what did the whole agent look like at this moment" without reconstructing it from
an interleaved per-section log. A snapshot is the full exported `.md` text at one point in
time, tagged `pre-import` / `post-import` / `export`. Every import writes a `pre-import`
snapshot of the agent's prior state (if any existed) and a `post-import` snapshot of the
result; the `export` kind is reserved for a capture point that isn't wired up yet (no diff
view exists over these pairs today — see `roadmap.md`).

### Group / Membership

Groups are **labels, not folders** — an agent can belong to any number of groups at once,
which a one-to-many folder structure on a filesystem literally cannot express. Adding an
agent to a group creates a `Membership` row; removing it deletes only that row, never the
agent. `parentId` on `Group` exists and is always `null` today — groups are flat — so
nesting later is additive with no data migration. Group membership is platform metadata
and is never written into an exported `.md` file.

The data model, repository layer, and API routes for groups are fully built. The UI entry
points that let a user actually create a group, switch the Library to grouped view, or
drag an agent into one are currently disabled by a set of local flags (`GROUPS_ENABLED` in
`WorkbenchShell.tsx` and `LibraryPanel.tsx`, `DRAG_ENABLED` in `AgentListItem.tsx`) — a
deliberate pre-launch scope cut, not a removal. The Library is flat-only until these are
flipped back on. See `roadmap.md`'s "Coming next."

### User, InviteCode, OAuthAccount

- **User** — `email` (unique, normalized lowercase), a bcrypt `passwordHash`, a `role`
  (`admin` / `user`, read fresh from the database on every request rather than trusted
  from the JWT), and `shareLogsWithAdmin` — the user's standing consent for the admin to
  read their prompt/response content in the activity log. New accounts are created with
  `shareLogsWithAdmin: false`; consent is always an explicit action, never inferred from
  silence or a default.
- **InviteCode** — single-use, stored in plaintext (so the admin can re-read and resend
  one), redeemed inside the same transaction that checks the `maxUsers` cap, so two people
  racing to redeem the same code can't both get in.
- **OAuthAccount** — links a `User` to a `(provider, providerAccountId)` identity (Google
  today). Identity is the provider's stable subject id, never the email — a later sign-in
  never rewrites `user.email` from a provider claim. No provider token of any kind
  (access, refresh, id) is ever stored.

### llm_call_log

One row per AI call attempt (import or chat), live or dry-run — the audit trail behind
the activity log. Append-only: there is no `UPDATE` or `DELETE` exported from its
repository module. `sharedWithAdmin` is copied onto each row at write time from the
user's consent setting at that moment and never changed afterward, so changing your
consent preference later only affects future rows — past rows keep the consent they were
written with. A non-consented row's `requestPayload`/`responsePayload` are nulled out in
the repository layer itself (never merely hidden in the view) before a non-owning viewer
ever receives them.

## 5. The Agent Blueprint

The **Blueprint** is the platform's canonical definition of a valid agent: every config
field, every section type, their allowed values and templates. It's derived from the
`ConfigDef`/`SectionDef` catalogs, not hand-maintained separately, so there's exactly one
definition driving three consumers — the UI (dropdowns, templates), AI import (the
conversion target), and validation. Updating the catalog updates all three at once.

("Blueprint" is deliberately a different word from *data model* — the tables — and *AI
model* — the LLM. Three distinct things in this codebase; only one of them is ever called
"the model.")

## 6. System agents vs. user agents

Three AI behaviors are platform infrastructure, not user content — seeded into the
codebase, never editable by an end user, and never exposed as agents a user could pick in
the Library:

| Agent | Role |
|---|---|
| **Hermes** | Strict Import — classifies each Stage-1 block by heading only; content never touches the model. |
| **Daedalus** | Structural Import — sees the full raw text and returns one restructured document. |
| **Prometheus** | Chat — reads an agent's current description/sections/config and proposes changes to any of them (never `name`). No tools. |

Each is authored as a real agent itself, in the same Role/Behavior/Guardrails/Output
shape a user agent would use (`lib/ai/prompts/system-agents/*.md`), compiled into a plain
string constant at build time by `scripts/build-prompts.ts` — the running server never
reads these source files; only the compiled output in `lib/ai/prompts/generated/` (build
artifacts, gitignored) is used at runtime.

## 7. Import pipeline

Every import runs a shared, deterministic **Stage 1**: the raw `.md` is split into
frontmatter plus body blocks with no AI involvement. The split level (normally `#`,
occasionally `##` for a file that never uses a bare `#`) is chosen per file by scanning
for the shallowest heading level actually present; a fenced code block is heading-blind,
so a `#` inside one is never treated as a boundary. A block that precedes the first
heading becomes a headingless block at order 0; a body with no headings at all becomes one
block. Every block gets a stable `blockId` in document order — this deterministic capture
is the safety net every later stage builds on.

From there, the user picks one of two Stage-2 modes:

- **Strict Import** (verbatim) — Hermes receives only each block's heading text and
  classifies it against the Blueprint; the server, not the model, copies `content`
  byte-for-byte from Stage 1 into the row Hermes labeled. Content structurally cannot
  reach the model's output, which makes "verbatim" a property of the code path rather
  than a prompt promise. Best for a file that's already well-structured.
- **Structural Import** (default, recommended) — Daedalus receives the full blueprint
  catalog and the complete raw text, and returns the entire restructured body as one
  document — not a mapping. Its safety model is necessarily different: prompt-enforced
  (verbatim movement, no meaning rewrite, no hallucination, custom naming only as a last
  resort) rather than code-enforced, backed by a deterministic coverage check
  (`lib/import/coverage.ts`) that turns undetected content loss into a non-blocking
  warning rather than a silent drop. A truncated model response (hit the token ceiling
  mid-document) is a hard rejection, never stored — content loss by definition. Once
  returned, the document is re-parsed and its headings mapped to `sectionKey`s
  deterministically; ordering (canonical core, then optional sections used, then named
  custom blocks last) is re-sorted server-side rather than trusted to the model's own
  document order, since three identical test runs produced three different orderings.

**Re-importing** an agent whose `name` matches one already in the platform is always an
update-in-place — never a duplicate, never an error, never a prompt asking what to do.
A section present in the incoming file but changed gets a new revision tagged
`author: "reimport"`; one present in the platform but missing from the incoming file is
simply deleted (its `SectionRevision` history survives independently, so nothing is
actually lost). A re-import whose raw bytes are byte-identical to the last import of that
agent short-circuits before any AI call and returns `{ skipped: 'unchanged' }`.

Frontmatter parsing is entirely separate from both Stage-2 modes and always deterministic
— string-preserving YAML (no scalar type coercion), with genuinely unparseable YAML
throwing a loud, typed error rather than silently discarding the whole frontmatter block.

## 8. Chat — the propose/apply flow

Sending a chat instruction never writes to the agent by itself. `POST /api/chat` reads
the agent's current state, calls Prometheus, and returns a **proposal** — a natural
language `message` plus a `modifications` object describing exactly what changed. The
only database row this call can ever produce is the gateway's own `llm_call_log` entry.

The proposal renders as a card in the Chat panel with per-row "show current" comparisons,
and nothing lands until the user clicks **Apply**. A separate route,
`POST /api/agents/[id]/apply-proposal`, performs the actual write:

- A config write always **merges** onto the agent's current full config set before the
  underlying full-replace update — a partial proposal can never wipe untouched keys.
- `name` is dropped from the payload server-side if present, regardless of what the
  prompt was told — enforced at the write boundary, not only by instruction.
- A section value of `null` deletes that section (mirroring the same convention config
  already used for key removal); an unrecognized `sectionKey` no-ops rather than erroring.
- No datatype/`allowedValues` validation is applied to AI-proposed values beyond what a
  manual edit would already get — the same flag-don't-block posture, applied consistently
  regardless of who (or what) produced the value.
- A `SectionRevision` written this way is tagged `author: "ai"`, which records "applied
  through the chat proposal flow" — not a cryptographically verified claim of model
  authorship, since the apply payload is client-supplied by design.

While a request is in flight, or a proposal is pending review, manual editing (section
raw-edit, name, every config control) is locked — a third `'proposal'` state alongside the
existing `'chat'`/`'edit'` interaction lock. The lock is client-side and
`localStorage`-scoped per user and agent, not server-enforced, and does not sync across
devices — a reviewed, accepted tradeoff for a small trusted user base. Sending a new
message discards any not-yet-applied proposal; only the latest turn is ever actionable.
Each call also carries recent prior turns (dialogue only — never a past proposal's raw
content, which always comes fresh from the agent's current state) so a follow-up like
"make that shorter" resolves correctly; how many turns are kept is an admin setting.

## 9. Serialization contract

Export and import are inverses, but round-trip fidelity is **semantic, not byte-exact** —
export regenerates the file from structured data in the tool's own clean formatting
(normalized quoting, normalized headings), it does not replay the original bytes.
Preserved losslessly: every frontmatter key and value including unrecognized ones, every
section in order, heading and content. Normalized: YAML/list/heading formatting. Never
touched: section body content, which is written back byte-for-byte regardless of what the
frontmatter around it looked like. The one accepted exception is YAML comments — they
aren't keys, so there's no slot to hold them, and their loss is a stated, deliberate
exception rather than a silent gap.

The testable invariant is structural idempotency: `parse(export(parse(md)))` yields the
same structured data as `parse(md)`. This is checked against a set of golden fixture
agents covering the split-level rule, the headingless-preamble case, and non-lowercase
names.

## 10. Auth & multi-tenancy

Every user gets their own account (email + password, or Google sign-in), gated by a
single-use invite code the admin generates. There is exactly one JWT verification
implementation in the codebase (`lib/auth/jwt.ts`); `middleware.ts` calls it directly
rather than carrying its own copy, and nothing in `middleware.ts`'s import graph can reach
the database or `node:*` — the Edge runtime can't open a SQLite connection, and this is
enforced by a fitness-function test, not just convention. Middleware is deliberately never
treated as the sole authorization boundary; every route handler independently establishes
its own session.

**Google sign-in** is an additional login mechanism, never an additional admission
mechanism — creating an account from an OAuth callback redeems an invite code through the
exact same transaction password signup uses. A profile is only trusted once its
`id_token`'s signature, issuer, audience, expiry, and nonce all validate and the provider
asserts the email is verified. If a Google sign-in's verified email matches an existing
password account, MyAgent links them automatically, for any email domain — this is a
reviewed and deliberately accepted tradeoff (a Google Workspace admin can, in principle,
mint a verified identity for any address on their own domain), not an oversight; there is
no per-domain restriction or admin kill switch today.

A login/signup rate limiter (in-process, per IP and route) and a per-user rolling-hourly
LLM call cap round out the abuse controls — see §11.

## 11. LLM gateway & cost controls

Every AI call in the app — import or chat, any provider — passes through one function,
`lib/ai/gateway.ts`. This is enforced by a fitness-function test asserting
`@anthropic-ai/sdk` is imported nowhere else. The gateway is where three cross-cutting
concerns live, in a fixed order: dry-run check, then the per-user cap, then the actual
provider call.

- **Dry-run mode** (the admin's "Live LLM calls" toggle) is a hard stop — when it's off,
  zero network bytes leave the process. The would-be request is still logged
  (`dryRun: true`, full request payload, null response), so behavior stays inspectable
  even though nothing was sent.
- **The per-user hourly cap** (default 15 calls/rolling-60-minutes, admin exempt) sits
  after the dry-run check and before the network call, so dry-run mode stays usable even
  once capped, and a capped call never spends money or writes a log row (the log table
  itself is the counter).
- **The gateway writes every log row**, not the callers — it's the only place that sees
  the dry-run branch, the real duration, and every failure mode. A log-write failure on a
  live call is swallowed (the money was already spent; discarding the response would be
  worse); on a dry-run call it still blocks the call outright.
- Settings default open, fail closed on garbage: a missing "Live LLM calls" row means
  "never configured," which defaults to on; an unparseable stored value defaults to off
  with a warning — a money-spending default may only come from *absence* of
  configuration, never from configuration that failed to parse.

## 12. Known gaps

Kept short — the live, prioritized version of this list is `plans/roadmap.md`; the
curated public-facing version is `roadmap.md` in this folder.

- **No automated coverage on the React component tree.** `lib/` and `app/api/` business
  logic (import, serialize, blueprint rules, chat, auth) has thorough test coverage; the
  component layer (`AgentView`, `ChatPanel`, `ImportDialog`, etc.) is verified by manual
  browser passes only.
- **The interaction lock and the pending-proposal store are client-side only** — cooperative,
  not server-enforced, and don't sync across devices/browsers for the same user.
- **`ownerId` means "one user."** There's no concept of an organization or shared
  ownership yet — ownership transfer exists only as a documented manual SQL operation.
- **Chat has no persistence.** Conversation history lives in browser memory for the
  current tab only; a reload or an agent switch clears it.
- **A single deployment runs one process.** The login rate limiter and the LLM cap's
  in-memory pieces are per-process; there's no distributed/shared state across instances.
