# MyAgentStudio — System About

The engineering reference for the workbench: what it's built on, how the pieces fit
together, and why the design is shaped the way it is. Written for a developer or tech
lead evaluating or extending the codebase. For the product story (probleM, Audience,
featuRe flows), see `projeCt-explanation.md`. FOr what's shipped vs. planned, see
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
│   ├── shell/                  Topbar, Panel, Gutter, Rail, RightDockPanel (Raw|Share
│   │                             dock, Plan 15) — the 4-pane frame
│   ├── Library/                agent list, groups, import dialog, RedeemShareDialog (Plan 15)
│   ├── CustomViz/               the structured agent view (AgentView, SectionBlock),
│   │                             AccessZone/SharedAgentView/SharedAgentActions (Plan 15)
│   ├── Chat/                    ChatPanel — the Prometheus chat + proposal card
│   ├── Raw/                     RawAgentView — read-only export preview
│   ├── Auth/                    Login/Signup forms, GoogleButton, ConsentPopup
│   ├── Settings/                PreferencesModal (merged Account+Settings, 2026-08-18) +
│   │                             its panes (LlmSettingsPane, AdminSettingsPane,
│   │                             ActivityLogPane); SettingsView still backs the
│   │                             admin-only full-page /settings route only
│   └── Account/                 AccountView (rendered inside PreferencesModal's
│                                 Account category, and still backs /account directly)
└── api/
    ├── agents/                  CRUD, import, export, sections, apply-proposal, groups,
    │                             shares/share-link/copy/redeem (Plan 15)
    ├── groups/                  group CRUD
    ├── chat/                    Prometheus — proposes, writes nothing
    ├── auth/                    login, signup, logout, oauth/[provider]/{start,callback}
    ├── settings/                 System Settings + invite codes
    ├── account/                  the signed-in user's own settings + tokens/ (MCP
    │                             Personal Access Tokens — Plan 13)
    ├── llm-call-log/             activity log reads
    └── mcp/                      the MCP server endpoint — POST /api/mcp (Plan 13, §13)

lib/
├── db/                          Drizzle schema, migrations, seed, repository/*
│                                 (incl. repository/agentShares.ts — Plan 15)
├── blueprint/                   the Agent Blueprint (catalog + rule functions)
├── serialize/                   deterministic import-parse (Stage 1) + export
├── import/                      Stage-2 assembly (Strict + Structural), coverage check
├── ai/                          the LLM gateway, the three system agents, prompt compiler
├── auth/                        session, JWT, password hashing, OAuth, rate limiting,
│                                 shareCode.ts (Plan 15)
├── mcp/                         MCP tool/resource layer (Plan 13, §13) — see lib/mcp/CLAUDE.md
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
  │                        └──< AgentShare (recipientEmail)     (Plan 15 — read grants, by email)
  │                        └── publicCode, publicCodeCreatedAt  (Plan 15 — read grant, by link)
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

### AgentShare — read-only access grants (Plan 15)

Two grant mechanisms write into the same place, so one query covers both: `agent.publicCode`
(nullable, unique — `null` means link-sharing is off) is a 256-bit bearer credential the owner
can enable/disable/copy; `AgentShare` is a table of `(agentId, recipientEmail)` rows for
direct email grants, with `grantedVia: 'email' | 'code'` recording how a row came to exist.
Neither path stores a `userId` — a share is granted against an email address, which lets an
owner share with someone who hasn't signed up yet; the grant simply starts applying once an
account with that address exists and loads its library. A recipient's access is **read-only
because no mutating repository function accepts anything but a real owner's `ownerId`** — not
because of a permission flag anywhere. The only two functions that read across this boundary,
`getAgentFullForViewer` and `listSharedWithViewer`, are new, separate, viewer-scoped
functions; every existing owner-scoped function (`getAgentFull`, `listAgents`, and every
mutation) is untouched. A recipient's one available mutation is **"Copy to me"**
(`copyAgentForOwner`), which forks an independent agent with no back-reference to the
original in either direction. Deleting an agent deletes its `AgentShare` rows in the same
transaction (a share is a pure access index, not history, unlike `SectionRevision`/
`AgentSnapshot`, which deliberately outlive the rows they describe).

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
  `shareLogsWithAdmin: true` (flipped 2026-08-18 — was `false` before) — sharing is the
  default, and a one-time popup on first login after signup offers to make it private
  instead; only a literal `false` in the signup/OAuth request body opts out, so a
  malformed or absent value still resolves to the shared default rather than silently
  granting or denying anything by accident. The `user` table's own column default stays
  `false` — every write path sets the value explicitly, so it's an inert SQL-level
  fallback, not the real default (see `lib/db/schema.ts`'s comment on the column).
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
- **Drastic-shrink guard** (2026-08-20, found live against a small model via the second
  provider): `parsePrometheusResponse()` warns — never blocks or drops — when a proposed
  section's new content is under 30% of its prior length and the prior content was
  non-trivial. Purely a character-count comparison, deliberately with no text-pattern or
  keyword matching, since this app's own agents are themselves about agents and could
  legitimately contain any phrasing a keyword heuristic might otherwise flag. Surfaces as
  a warning row on the proposal card, same as every other tolerated issue.
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
password account, MyAgentStudio links them automatically, for any email domain — this is a
reviewed and deliberately accepted tradeoff (a Google Workspace admin can, in principle,
mint a verified identity for any address on their own domain), not an oversight; there is
no per-domain restriction or admin kill switch today.

A login/signup rate limiter (in-process, per IP and route) and a per-user rolling-hourly
LLM call cap round out the abuse controls — see §11.

**Per-user isolation, read-widened by an explicit grant (Plan 15).** The tenancy model above
— every `agent`/`group` row scoped to one owner, enforced in the same statement that touches
it — still describes every **write** path without exception. Reads are the one place this is
now deliberately widened: two new, separate, viewer-scoped functions
(`getAgentFullForViewer`, `listSharedWithViewer`) also return an agent to a user holding an
explicit `AgentShare` grant or the agent's public link code. `getAgentFull`/`listAgents`
themselves are unmodified, so every pre-existing caller (MCP tools historically excepted —
see §13) keeps its exact owner-only behavior; the widening exists only in the two new
functions, and only for reads.

## 11. LLM gateway, providers, and cost controls

Every AI call in the app — import or chat, any provider — passes through one function,
`lib/ai/gateway.ts`. The gateway is where three cross-cutting concerns live, in a fixed
order: dry-run check, then the per-user cap, then the actual provider call.

**Provider architecture (Plan 11):** `lib/ai/gateway.ts` is the only file in the app
permitted to import from `lib/db/`. It resolves which provider to use on each call by
calling `resolveActiveProvider()` from `lib/ai/providerRegistry.ts`, which reads the
`'llmProvider'` admin setting fresh on every invocation (same no-cache rule as
`getLiveLlmCalls()` — a cached provider would appear not to change after a settings flip).
`providerRegistry.ts` is the only file that knows both implementations exist; everything
else in `lib/ai/` is provider-blind. Two implementations currently exist:

- `lib/ai/anthropicProvider.ts` — the Anthropic SDK implementation. The sole importer of
  `@anthropic-ai/sdk` in the entire codebase (enforced by a fitness-function test in
  `lib/ai/__tests__/architecture.test.ts` that scans every source file and asserts the
  import appears in exactly one place).
- `lib/ai/openaiCompatibleProvider.ts` — a `fetch`-based implementation of the OpenAI
  chat-completions wire format, with no new npm dependency. Configured by three env vars
  (`OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_MODEL`).
  `OPENAI_COMPATIBLE_BASE_URL` is expected to already carry the vendor's own `/v1` segment
  (matching real vendor convention — NVIDIA NIM, OpenAI, Groq, etc. all document
  `base_url` ending in `/v1`); the provider appends `/chat/completions` only. Works with
  NVIDIA NIM, OpenAI, Groq, Together, Mistral, vLLM, and any other OpenAI-compatible
  endpoint — live-verified 2026-08-20 against a real NVIDIA NIM account, which also
  surfaced that not every model listed in NVIDIA's own `/v1/models` catalog is actually
  callable on a free-tier key (an account-level entitlement gate, separate from the
  catalog listing — see `.env.example` for confirmed working/broken examples). The
  fitness function guards the endpoint path literal so this is also the sole file that
  constructs those requests.

**Provider selection:** the `'llmProvider'` setting is admin-only (like `'liveLlmCalls'`
and `'chatMaxTokens'`). Default `'anthropic'`. Unknown or corrupt stored value → silent
fall-back to `'anthropic'` with a `console.warn` (same asymmetric fail-safe used
throughout — a money-spending default may only come from *absence* of configuration, never
from configuration that failed to parse). A provider with no API key configured cannot be
selected — `PATCH /api/settings` rejects it with `400 provider_not_configured`. Selecting
a different provider takes effect on the very next AI call, no restart required.

- **Dry-run mode** (the admin's "Live LLM calls" toggle) is a hard stop — when it's off,
  zero network bytes leave the process. The would-be request is still logged
  (`dryRun: true`, full request payload, null response, and the provider that *would*
  have been used), so behavior stays inspectable even though nothing was sent.
- **The per-user hourly cap** (default 15 calls/rolling-60-minutes, admin exempt) sits
  after the dry-run check and before the network call, so dry-run mode stays usable even
  once capped, and a capped call never spends money or writes a log row (the log table
  itself is the counter).
- **The gateway writes every log row**, not the callers — it's the only place that sees
  the dry-run branch, the real duration, and every failure mode. Every row now records
  `provider` explicitly (the column existed before Plan 11 but was never written — the fix
  ships alongside the second provider so the audit log is accurate from the moment two
  providers coexist). A log-write failure on a live call is swallowed (the money was
  already spent; discarding the response would be worse); on a dry-run call it still
  blocks the call outright.
- **No automatic failover.** One provider is live at a time. A retry on another vendor
  would double-spend and make the audit log unreliable — explicitly not in scope.

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
  The MCP per-token rate limiter (§13) shares this same limitation.
- **MCP writes carry no per-revision attribution.** An MCP-initiated import's
  `SectionRevision` rows are tagged `reimport`, indistinguishable from a browser-initiated
  reimport — only `llm_call_log.origin` and the token's `lastUsedAt` record the MCP origin
  (§13). Accepted, additive-later if it ever matters.

## 13. MCP server (Plan 13)

A second front door onto a user's own agents, for console/CLI MCP clients (Claude Code and
equivalents) — **not** Claude Desktop's GUI connector, which needs OAuth 2.1 and is
explicitly out of scope. Served by the same Next.js process at `POST /api/mcp`
(`export const runtime = 'nodejs'` — `better-sqlite3` is a native module and cannot run on
the Edge runtime), using **stateless Streamable HTTP**: no `Mcp-Session-Id`, no long-lived
SSE stream, every request self-contained (`enableJsonResponse: true`). A fresh `McpServer` +
transport pair is built and bound to one resolved principal per HTTP request, then closed —
there is no persistent connection or cross-request state, which is also what lets this
survive a future multi-instance deploy with no shared session store.

**Auth is a second credential type, deliberately separate from the session cookie.**
Per-user **Personal Access Tokens** (`mya_` + 43 base64url chars from 32 random bytes),
generated in `/account`, shown once, stored as a SHA-256 hex hash (not bcrypt — a 256-bit
random token needs no key-stretching, and a hash enables an indexed lookup a bcrypt compare
cannot), scoped `read` or `write`, revocable (soft delete), with a per-user cap of 10 active
tokens. `lib/auth/mcpGuard.ts`'s `authenticateMcpToken()` is a third sibling to
`authenticate()`/`authenticateAdmin()` in the same discriminated-union shape, and — deliberate
constraint — never returns a `role`: an admin's token grants exactly a normal user's powers,
there is no admin API over MCP. `middleware.ts` bypasses `/api/mcp` by exact path (never a
wide prefix) with a comment explaining why that's safe: middleware was never the
authorization boundary here either, and the route independently re-authenticates every
request. `Origin` validation rejects any request carrying one at all — legitimate console
clients send none, so a present `Origin` is the DNS-rebinding signature the spec warns about.

**The tool layer is a consumer of the repository, not a new trust boundary.** Four tools,
all resolving to the same repository functions the web routes already use, scoped by the
token's `userId` exactly like a route scopes by session `userId`. The three read tools are
**viewer-scoped** (Plan 15, D8, §6 step 8c) — a token's holder sees the same owned-plus-
shared agent set over MCP that they'd see in the browser, read-only for anything they don't
own; the write tool stays strictly owner-scoped, unchanged:

| Tool | Scope | Backed by | Calls a model? |
|---|---|---|---|
| `list_agents` | read | `listAgents(ownerId)` + `listSharedWithViewer(viewerId)`, merged into one list distinguished by `access` | no |
| `get_agent` | read | `getAgentFullForViewer(id, viewerId)` — same `AgentDTO` the UI uses, owner OR share-holder | no |
| `pull_agent` | read | `exportAgentMarkdownForViewer(id, viewerId)` — deterministic, no AI, owner OR share-holder | no |
| `push_agent` | **write** | the *existing* import pipeline (`parse` → `callDaedalus`/`callHermes` → `assembleStructural`/`assemble` → `checkCoverage` → `upsertAgentFromImport`) — still strictly `getAgentFull(id, ownerId)`-scoped; a share-holder's token gets the same refusal a non-owner always got | yes |

(Named `pull_agent`/`push_agent` for the CLI/git mental model — renamed 2026-08-24 from
`export_agent`/`import_agent`. The underlying repository functions, the web UI's own
"Import"/"Export" buttons, and the import pipeline's internal vocabulary are unchanged —
only the two MCP tool names changed.)

Plus each agent as a read-only resource at `myagentstudio://agent/{id}` (same two repository
calls `list_agents`/`pull_agent` use — a resource read and `pull_agent` are guaranteed
byte-identical for the same agent). `tools/list` always returns all four names regardless of
a token's scope — a `read` token calling `push_agent` gets a clear refusal, not a hidden
tool. Content returned by `get_agent`/`pull_agent` is wrapped in a labeled block noting
it's user-authored data, not instructions — the cheapest available prompt-injection
mitigation, not a claim of full protection.

**`push_agent` is the whole write surface, on purpose.** No tool mutates a section or
config value directly — structured field-level editing was deliberately dropped from this
plan's scope (it would have meant extracting a shared write contract out of the propose/apply
route and replicating its config-merge invariant, the plan's single highest-risk piece). The
natural workflow is round-trip through a file: `pull_agent` → the external client edits the
markdown → `push_agent` puts it back, reusing `upsertAgentFromImport`'s owner-scoped
name-match-or-create semantics and its entire existing safety story for free: a `pre-import`
snapshot before an update, a `post-import` snapshot after, `reimport`-tagged
`SectionRevision` rows, retained history on removed sections, `rawSourceSnapshot` holding the
submitted bytes, and a byte-identical-bytes short-circuit that skips the AI call (and any
spend) entirely on a no-op re-import.

**Three independent gates stand between an external model and a write**, all checked before
any model call: the token must carry `write` scope; the admin's `mcpWrites` setting
(`lib/settings.ts`, default **off**) must be on; and the *same* per-user hourly LLM cap
every browser-initiated call already obeys (§11) — no MCP-specific limit. Each gate can be
closed independently (revoke the token; flip `mcpWrites`; flip "Live LLM calls" off) with no
deploy. `llm_call_log` gained a nullable `origin: 'web' | 'mcp'` column so the audit log can
tell the two calling surfaces apart — the same fidelity fix Plan 11 made for `provider`.

**`@modelcontextprotocol/sdk`** is imported by exactly one file, `lib/mcp/server.ts`,
enforced by a fitness test (`lib/mcp/__tests__/architecture.test.ts`) alongside two more
constraints from the same suite: no file under `lib/mcp/` may reference a mutating
repository function other than `upsertAgentFromImport`, and none may import a provider file
or read the session cookie — the two auth models (browser session, MCP bearer token) must
never cross-contaminate.

See `lib/mcp/CLAUDE.md` for the file-by-file layout.
