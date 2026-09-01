# MyAgentStudio — Roadmap

Living index of open work — one flat table, every item, sorted by bucket then priority. A
full description sits below the table for each item, in the same order the table lists them.

**Bucket** — **TODO** (must ship before the next release), **NEXT** (decided and scoped,
deliberately deferred to right after launch — "ship now, harden fast": real user feedback on
a live beta matters more than finishing this before anyone sees it), **FUTURE** (decided
wanted eventually — Priority/Effort still apply for sequencing once picked up, but nothing
here is scheduled), **IDEA** (either not yet decided whether to build at all, or decided
wanted but not sure yet *how* — needs a product/design debate before it can become a
FUTURE/NEXT item; Priority and Effort are left blank until that debate happens).

**Kind** — **UX** a visible UI/layout change, **Behavior** a product/logic or backend change
with no direct UI, **Infra** tooling/process/ops, not user-facing at all.

**Priority** / **Effort** — High / Medium / Low, reviewed 2026-08-27 in a full pass over every
open item.

Items use stable names, not sequence numbers, so a cross-reference never breaks when an item
closes or reorders. **This file only ever tracks what's still open** — once something ships,
it drops out of here entirely rather than accumulating as a closure log. The history of *how*
something got built lives in `CHANGELOG.md`; the current-state facts about how the system
works live in `docs/system-about.md`. One fact, one home.

**Layout work still prototypes first** — `reference/layout/Layout-Workbench.html` before
live code (see `CLAUDE.md` standing rule 4).

**This file no longer takes new intake** — it only drains as existing items ship. New work
items (bugs, small features) go on the repo's GitHub Issues instead — 18 were filed during
the 2026-08-27 review pass that produced this version of the file. Existing items already
listed here stay until closed.

---

## Stats

**44 open items** — TODO: 0 · NEXT: 13 · FUTURE: 28 · IDEA: 3

---

## Overview

| Item | Bucket | Priority | Effort | Kind | Status | Obs |
|---|---|---|---|---|---|---|
| **Claude Desktop MCP support (OAuth 2.1)** | NEXT | High | High | Infra | On-going — plan drafted at `plans/16-oauth21-mcp.md` | Needs a real OAuth 2.1 authorization server in front of the existing MCP endpoint |
| **Delete or disconnect user (admin)** | NEXT | High | Medium | Behavior | Not started | Admin-initiated deletion, plus a lighter session-disconnect option |
| **Email-sending provider** | NEXT | High | Medium | Infra | On-going — plan drafted at `plans/14-email-sending-provider.md` | Covers invite-code delivery and general account notifications |
| **Landing page mobile/responsive support** | NEXT | High | Medium | UX | Not started | Real conversion-risk gap on `/welcome`, not cosmetic |
| **User-configured LLM key (BYOK)** | NEXT | High | High | Behavior | On-going — plan drafted at `plans/17-byok-llm-key.md` | Bring-your-own-key; absorbs per-user quota/spend-cap questions |
| **Improve the guided tour** | NEXT | Medium | Medium | UX | Not started | True anchored coach-marks, more trigger conditions |
| **Surface `applied`/`skipped` from apply-proposal in the UI** | NEXT | Medium | Low | UX | Not started | Data already exists server-side; UI-only work |
| **"Replay this request" from a dry-run log row** | NEXT | Low | Low | UX | Not scoped | Re-run a stored dry-run request for real, from the log |
| **Display-label lookup for `model`** | NEXT | Low | Low | UX | Not started | Short label instead of the raw model ID |
| **Export translation to other platforms** | NEXT | Low | Medium | Behavior | Not started | Starting with Copilot; format compatibility unconfirmed |
| **Log retention / pruning / pagination** | NEXT | Low | Medium | Infra | Not started | `llm_call_log` is append-only and unbounded |
| **Wire `AgentDTO.validation` into the UI** | NEXT | Low | Medium | UX | Not started | Built server-side, invisible in the UI |
| **Wiring a declared model for Prometheus** | NEXT | Low | Medium | Behavior | Not started | Model is coupled to the active provider, not just frontmatter |
| **An audit trail for config changes** | FUTURE | High | Medium | Infra | Not scoped | Sections have `section_revision`; config doesn't |
| **Compliance-grade (non-droppable) logging** | FUTURE | High | High | Infra | Not scoped | Log writes are silently swallowed on failure today |
| **Docker** | FUTURE | High | Medium | Infra | Not scoped | Containerize the app — its "once online" trigger already fired |
| **Review group behavior** | FUTURE | High | Medium | UX | Needs review before re-enabling | Create/delete already built, gated behind flags; no group-count limit |
| **Skill module** | FUTURE | High | High | UX | Ready to scope | A second library entity, for Claude's `SKILL.md` files |
| **Structured outputs for Prometheus** | FUTURE | High | Medium | Behavior | Not scoped | API-enforced structured output — the long-term fix behind Issue #12 |
| **A second OAuth provider** (GitHub, Microsoft, Apple) | FUTURE | Medium | Medium | Infra | Not scoped | Provider seam already exists — small addition |
| **Apply-by-section/per-field granularity** | FUTURE | Medium | Medium | UX | Not scoped | Cherry-pick which proposed changes to apply |
| **GDPR-style export/deletion workflow** | FUTURE | Medium | High | Behavior | Not scoped | No legal obligation today, but "get real users" is a near-term goal |
| **Instant auto-apply mode** | FUTURE | Medium | Low | Behavior | Not scoped | Skip the confirm-click for proposals |
| **Review user account management** | FUTURE | Medium | Medium | UX | Not scoped | Password reset, self-service email/password/delete, own-session management |
| **`AgentSnapshot(kind:'export')` diff-view UI** | FUTURE | Low | Medium | UX | Not scoped | Compare two snapshots side-by-side |
| **AI-assisted config-key mapping** | FUTURE | Low | Medium | Behavior | Not scoped | Auto-label a messy frontmatter key to its canonical `propKey` |
| **An admin toggle for auto-linking** | FUTURE | Low | Low | Infra | Not scoped | Contingency for a Google Workspace domain-takeover risk |
| **Argon2id instead of bcrypt** | FUTURE | Low | Medium | Infra | Not scoped | bcrypt works; native-build dependency is the blocker |
| **Atomic (single-transaction) apply** | FUTURE | Low | Medium | Behavior | Not scoped | Today's apply is non-atomic, ordered sections-first |
| **Catalog evolution** | FUTURE | Low | Medium | Infra | Not scoped | Distinguish "never known" from "was known, catalog changed" |
| **`ConfigDef` platform-scoping** | FUTURE | Low | Medium | Infra | Not scoped | Per-platform config catalogs, once a second platform exists |
| **Constant-time login** | FUTURE | Low | Low | Infra | Not scoped | Timing-based email-enumeration hardening |
| **CSRF tokens** | FUTURE | Low | Low | Infra | Not scoped | `sameSite=lax` + JSON-only already covers the realistic surface |
| **Database server migration** | FUTURE | Low | High | Infra | Open decision | SQLite is fine on AWS today; target engine genuinely undecided |
| **Distributed / persistent rate limiting** | FUTURE | Low | Medium | Infra | Not scoped | In-process limiter, resets on restart |
| **Incremental streaming** | FUTURE | Low | Medium | Behavior | Not scoped | Token-by-token chat responses |
| **Manual link/unlink of an OAuth provider** | FUTURE | Low | Medium | UX | Not scoped | Auto-linking already covers the realistic case |
| **Restricting sign-in to an email domain / rate-limiting the callback** | FUTURE | Low | Low | Infra | Not scoped | Invite codes + `maxUsers` already gate admission |
| **Sliding session refresh** | FUTURE | Low | Medium | Infra | Not scoped | Matches Google/Facebook/Claude.ai's session pattern |
| **Storing OAuth provider tokens** | FUTURE | Low | Low | Infra | Not scoped | No feature needs a stored Google token yet |
| **System agents become real, platform-managed agents** | FUTURE | Low | High | Infra | Not scoped | Prometheus/Hermes/Daedalus become editable agents, confirmed "far away" |
| **MCP session-improvement idea** (chat-driven write use) | IDEA | Low | — | Infra | Idea only | Use MCP write access for chat-driven session help — scope not decided |
| **Mobile access to the workbench** | IDEA | — | — | UX | Idea only | Not decided-if, not decided-how; absorbs cross-device proposal awareness |
| **Organizations / teams** | IDEA | — | — | Behavior | Idea only | Joint agent ownership — needs a product debate before it's buildable |

---

## Item descriptions

In the same order as the table above.

### Claude Desktop MCP support (OAuth 2.1)

The existing MCP server deliberately scoped Claude Desktop's GUI connector *out* — its
design note says clients are console/CLI only, which is what keeps an OAuth 2.1
authorization server out of scope entirely. Today's auth model is per-user Personal Access
Tokens (opaque bearer, generated in Account, hashed, scoped read/write), which works for a
human pasting a token into `claude mcp add` but not for Desktop's connector flow, which
expects a real authorization-code exchange. Picking this up means standing up a genuine OAuth
2.1 authorization server in front of the existing `/api/mcp` endpoint — authorization + token
endpoints, client registration, a consent screen, short-lived access + refresh tokens —
without breaking the existing token path for console/CLI clients. This is the single largest
build in the whole roadmap; revisit only if real Desktop-client demand shows up, since
CLI/console already covers the portfolio use case.

### Delete or disconnect user (admin)

Admin-initiated account deletion with a confirmation step, plus a notification email to the
affected user (depends on Email-sending provider for that email). Also covers a lighter
"disconnect" option — force-revoking just one user's active session without deleting the
account, filling a real gap where today the only way to kill any session is rotating the
global `JWT_SECRET`, which logs out *everyone* at once. Distinct from the self-service
GDPR-style export/deletion workflow (that one is user-initiated on their own account) — both
stay, this isn't a merge.

### Email-sending provider

Covers two purposes: sending invite-code emails, and general account/notification messages
to a user. Provider itself undecided (e.g. Resend). Unblocks two other items at once —
Delete/disconnect user's confirmation email, and Review user account management's password
reset — same missing piece of infrastructure, worth solving once.

### Landing page mobile/responsive support

Neither `WelcomePage.tsx` nor its mock have any responsive/mobile handling — the "How it
works" walkthrough's two-column grid and the "Full view" modal's fixed width have no
narrower-viewport fallback, rendering as cramped, illegible columns on a phone. Since this is
the single best piece of proof-of-product on the whole page, a `ux` agent review called this
a real conversion-risk gap for an invite-request landing page, not cosmetic polish. Needs its
own design pass before implementation — mock-first per standing rule 4.

### User-configured LLM key (BYOK)

Lets a user supply their own Anthropic key instead of sharing the platform's, via the
existing gateway. Absorbs two related questions that were previously separate items:
per-individual LLM quotas (an admin override of the global hourly cap for one user) and
per-user spend/cost caps (capping by actual token spend, not just call count — this also
folds in the idea of showing a currency estimate on Activity Log rows, which show token
counts only today). A BYOK user isn't drawing from the platform's shared spend at all, so all
three need one holistic strategy pass together, not three separate builds.

### Improve the guided tour

The MVP tour has already shipped. Candidates once picked up: true anchored coach-marks
(e.g. `@radix-ui/react-popover`) instead of dimming fixed regions, more/different trigger
conditions (first import, not just first login), additional steps, and usage signal on where
people skip or drop off. Related to Issue #5 (tour overlaps the post-signup consent popup) —
kept as a separate item, not bundled, but likely worth doing in the same pass.

### Surface `applied`/`skipped` from apply-proposal in the UI

`apply-proposal/route.ts`'s response has always carried `applied: { description, sectionKeys,
removedSectionKeys, configKeys }` and `skipped[]` (each with a reason), but
`WorkbenchShell.tsx`'s `applyProposal` only reads `data.agent` — a partially-skipped proposal
currently looks identical to a fully-applied one. Needs a UI decision (a toast, a note on the
proposal card, something in the chat transcript) — the data already exists, this is UI-only
work.

### "Replay this request" from a dry-run log row

The Activity Log stores dry-run requests (when Live LLM calls is off). This would let you
take a stored dry-run row and re-run it for real with one click, straight from the log,
instead of manually reconstructing the same action. Revisit if manual re-running ever becomes
a real papercut.

### Display-label lookup for `model`

The UI shows the raw model ID (e.g. `claude-sonnet-5`) — already legible and correctly
aligned with real Anthropic naming, so this is cosmetic, not a gap. Scope: a short label
(e.g. "Opus") while storage keeps the full ID. Grouped conceptually with Export translation
to other platforms — same underlying problem of mapping a platform-specific representation
to something else.

### Export translation to other platforms

Export only produces Claude's own `.md` format today. Real per-platform translation
(starting with Copilot), not a file copy — each target platform would naturally become its
own import/export system agent under the existing Agent pattern. Needs confirmation before
scoping further: check whether the same `.md` export format actually works as-is for other
platforms, or whether real translation is required — that answer changes how big this item
actually is.

### Log retention / pruning / pagination

`llm_call_log` is append-only and unbounded. Worth scoping once real usage gives a sense of
actual growth rate — revisit past ~5,000 rows or the DB file exceeding ~200MB. Also covers a
privacy/consent angle (purging for reasons other than pure size) — same underlying table and
mechanism either way, solved once.

### Wire `AgentDTO.validation` into the UI

`descriptionMissing` / `unknownConfigKeys` / `outdatedOrUnknownValues` are computed on every
agent load and already delivered on the DTO, but nothing in `AgentView.tsx` reads them — the
original "review feature" pitch, built but invisible. Also absorbs a related gap: a malformed
`name`/`description` on import (`assemble.ts`'s `toScalar()` silently blanks it today, with no
flag at all) becomes a fourth field on the same `validation` object, rendered through the same
mechanism once it's built. Needs a design pass first — badge vs. inline markers vs. a summary
banner, and click behavior.

### Wiring a declared model for Prometheus

Not just a frontmatter edit: the model is coupled to whichever provider is active
(`gateway.ts` falls back to `provider.defaultModel()` when a request doesn't specify one).
Prometheus's own frontmatter `model` is deliberately left unset today, so a value hardcoded
there could break silently if the active provider ever gets switched in Settings. Likely
belongs alongside the LLM/provider configuration itself rather than (or in addition to) the
agent's own frontmatter — revisit once a specific chat model is actually chosen.

### An audit trail for config changes

Agent sections already have a `section_revision` field tracking their history; agent config
(the frontmatter key-value pairs like `model`, `tools`) has no equivalent — no record of what
a value used to be before it changed. No specific trigger yet, just a known asymmetry in
what's tracked.

### Compliance-grade (non-droppable) logging

Every `llm_call_log` write in `lib/ai/gateway.ts` — the pre-call reservation and both the
success and error finalize steps — is wrapped in its own try/catch and silently swallowed on
failure. The real LLM call still goes through and the user still gets their answer, but the
log row can be left incomplete or missing entirely, with no retry and no alert to anyone.
Today that's diagnostics, not an audit trail; making it compliance-grade means either
blocking the request or queuing the write for retry — a real change to the request path, not
a logging tweak. Real-world consequence: across a month of real spend, a handful of calls
lost to transient DB contention (e.g. SQLite lock contention from a stray process) would leave
the Activity Log unable to prove exactly what was called and billed.

### Docker

Containerize the app. Its own "once the app runs online" trigger already fired when Plan 02
shipped to AWS — still fine to leave unscheduled, but the condition that used to make this
premature no longer applies.

### Review group behavior

Create/delete are already fully wired in code — `handleCreateGroup` + "+ New group" in
`LibraryPanel.tsx`; `handleDeleteGroup` with a confirm dialog and `DELETE /api/groups/[id]` in
`GroupSection.tsx` — gated behind `GROUPS_ENABLED`/`DRAG_ENABLED` flags. No group-count limit
exists anywhere. This needs a fuller look at real behavior before trusting that read and
flipping the flags back on, rather than assuming it's a pure three-flag-flip quick win. Also
covers a possible bigger step once re-enabled: a dedicated, standalone group-management panel
beyond the Library's inline controls — not committed to, just the natural next step of the
same review if inline controls prove not to be enough.

### Skill module

A second library entity, alongside Agent, for Claude's `SKILL.md` files — its own
import/export/editing story, parallel to how Agent works today.

### Structured outputs for Prometheus

Replace today's prompt-instructed JSON with Anthropic's API-enforced structured outputs, so
a malformed reply becomes structurally impossible instead of something to detect and repair
after the fact. This is the long-term real fix; GitHub Issue #12 (repair near-miss JSON in
Prometheus responses) is the near-term stopgap for the exact same root problem. Revisit if
prompt hardening alone doesn't hold up under continued use.

### A second OAuth provider (GitHub, Microsoft, Apple)

Google is the only login option today, but the integration was built with a pluggable
provider design — one new provider-config file, two new env vars, one new button, no deeper
architecture change. Revisit if anyone actually asks for a non-Google option.

### Apply-by-section/per-field granularity

Applying a proposal is all-or-nothing today — every section/config change in a turn gets
applied together. This would let you cherry-pick which specific changes from a turn's
proposal to keep vs. discard. No trigger yet.

### GDPR-style export/deletion workflow

A formal export-all-my-data / delete-all-my-data self-service flow, the kind legally required
for EU users. No legal obligation today — closed beta among friends — but "get real users" is
an explicit near-term goal in the publish/promote plan, not something indefinitely deferred,
so this stops being hypothetical fairly quickly once the beta opens wider.

### Instant auto-apply mode

An optional mode that skips the confirm-click entirely for people who trust the AI enough not
to want the extra step, on top of today's unconditional propose-then-apply. Revisit if the
confirm-click ever proves to be real friction.

### Review user account management

Merges three pieces of the same `/account` self-service surface, same actor (a user managing
their own account — distinct from an admin acting on someone else's via Delete/disconnect
user): password reset / forgot-password (needs an email transport — same blocker as
Email-sending provider), user self-service (change your own email/password, delete your own
account — none of it exists today), and session management (viewing/logging out your own
other active sessions).

### `AgentSnapshot(kind:'export')` diff-view UI

Compare two snapshots side-by-side — e.g. the original import vs. the current export.
Different from the existing 🔍 "Open a larger view" zoom in `RawAgentView.tsx`, which only
shows the current raw markdown at a larger size, not a comparison between two points in time.
The export route this depends on is already built.

### AI-assisted config-key mapping

When importing an agent, a messy or non-standard frontmatter key (a typo'd or renamed config
field) doesn't get matched to its canonical `propKey` and falls through unmapped. Idea: have
the AI import pipeline label it automatically, using the same content-is-never-touched
pattern already used for classifying sections — it maps/labels structure, it never rewrites
the agent's actual words.

### An admin toggle for auto-linking

If someone with a password account logs in via Google using the same email, the system
auto-links the accounts today with no manual step. The real edge case: if a company's email
domain is ever lost or reassigned, whoever now controls it could recreate an old address and
auto-link straight into someone else's existing account. This item is a pre-scoped
contingency — an admin switch to disable auto-linking entirely if that risk ever becomes
real. Low real exposure today while the beta stays closed/invite-only.

### Argon2id instead of bcrypt

bcrypt is adequate for today's needs; Argon2id is the more modern choice but needs a native
(non-pure-JS) build dependency, which adds deployment complexity. Revisit if that constraint
ever disappears.

### Atomic (single-transaction) apply

Today's apply-proposal flow writes sections and config as separate operations, not one
all-or-nothing transaction — a failure partway through could theoretically leave an agent
half-applied. Revisit only if a partial apply is ever actually observed in practice.

### Catalog evolution

Today, if a config or section key was once valid and the catalog later changes, there's no
way to distinguish "this key was never valid" from "this key used to be valid, the catalog
just moved on." Revisit once catalog-versioning infrastructure exists.

### `ConfigDef` platform-scoping

`CONFIG_DEFS` is one single catalog today, implicitly Claude-specific. Once a second platform
(e.g. Copilot, from the export-translation work) actually gets built, each platform would
need its own scoped config catalog instead of one shared one.

### Constant-time login

A login attempt for a real vs. an unknown email can take measurably different time (a real
bcrypt compare vs. instant rejection), letting someone probe which emails are registered by
timing responses. This adds a dummy compare so both cases take the same time. Only relevant
if self-service signup ever opens without invite codes.

### CSRF tokens

Not built. Today's protection is `sameSite=lax` cookies plus JSON-only mutations, which
already covers this app's realistic attack surface. Revisit if a mutating `GET` ever appears,
or the app embeds cross-origin.

### Database server migration

Renamed from "Storage target dialect (Postgres vs. Azure SQL)" — that naming, and a separate
"Azure hosting infra maturity" idea it absorbed, both predated Plan 02's actual hosting choice
(AWS EC2, not Azure). SQLite is working fine on the current AWS deploy; if it ever stops
being adequate, migrate to a real DB server — which engine is genuinely still an open
question, not narrowed to any specific target.

### Distributed / persistent rate limiting

Today's login rate-limiter lives in the Node process's memory — it resets on restart and
wouldn't work correctly across more than one server instance. Revisit if the deploy ever runs
more than one instance.

### Incremental streaming

Today, a chat reply waits for the full response before showing anything. This would stream it
token-by-token as it's generated, like most modern chat UIs. No trigger needed — a pure UX
upgrade, free to pick up anytime.

### Manual link/unlink of an OAuth provider

Today, auto-linking connects a Google login to an existing password account with the same
email automatically. This would let a user manually connect Google to a *different*-email
account, or disconnect it later — needs a re-auth step (proving ownership of the target
account) plus a still-deferred set-a-password flow for anyone who only ever signed up via
Google. Not needed today — auto-linking already covers the realistic case.

### Restricting sign-in to an email domain / rate-limiting the callback

Invite codes plus a hard `maxUsers` cap are the only admission control today. This would add a
second layer: only allowing sign-in from specific email domains, and/or rate-limiting the
OAuth callback route itself. Only relevant if the beta ever opens beyond invite codes.

### Sliding session refresh

Today, `SESSION_TTL_SECONDS` (7-day default) is set once at login and just counts down,
regardless of activity in between. This matches the industry pattern instead (Google,
Facebook, Claude.ai): every active request extends the session, so an actively-used session
effectively never expires — no separate "remember me" checkbox needed, that's the older
pattern most big sites have moved away from. Worth bumping `SESSION_TTL_SECONDS` to ~30 days
once this ships — sliding alone with the old 7-day number would still log out anyone inactive
for a week-long trip, undercutting the point of the change.

### Storing OAuth provider tokens

When a user logs in with Google, the access token Google issues is used once to verify
identity and then discarded. This would store it so a future feature (e.g. pulling a real
Google profile picture) could reuse it without a re-login. No feature needs this yet.

### System agents become real, platform-managed agents

Prometheus, Hermes, and Daedalus are static, build-time-compiled prompts today, not "agents"
in the same sense as ones users create. This would make them real, in-platform-editable
agents using the same Agent data model as everything else. Confirmed wanted, but explicitly
"far away."

### MCP session-improvement idea (chat-driven write use)

Idea: use MCP's write access (`push_agent`, already built) so a chat-based client
(Claude Code/Desktop) could help improve or manage a user's agent sessions directly, not just
import a markdown file. Distinct from verifying the already-built write path itself, which is
a separate, already-tracked verification task outside this file. Genuinely fuzzy scope — the
actual use case isn't decided yet.

### Mobile access to the workbench

Not decided-if, not decided-how. Distinct from Landing page mobile/responsive support (that
one is only about the marketing page's own CSS on a phone browser) — this is about reaching
the real product (Library, structured Config view, chat, export) from a phone at all. Open
questions, not yet debated: a responsive web version of the 4-pane layout (which doesn't
obviously collapse to a phone screen), a native/PWA app, full feature parity vs. a
deliberately reduced read/review-only surface. Also absorbs cross-device pending-proposal
awareness (a pending chat proposal only exists in one browser's `localStorage` today — a
second device has no idea it's there) since that question genuinely depends on how this gets
resolved: if mobile access ends up read-only, proposals wouldn't exist on that side at all,
making the sync question moot.

### Organizations / teams

Agents are owned by exactly one user account today. This would let a group of people jointly
own agents together. Needs a real product/design debate before it's even buildable —
genuinely undecided territory, not just unscheduled.

---

## Reference

- **`plans/archive/`** — completed plans, kept for history.
- **`CLAUDE.md`** — standing project rules and folder map.
- **`docs/roadmap.md`** — the friendly, capability-only public roadmap.
- **`CHANGELOG.md`** — project history by date.
- **`docs/system-about.md`** — current-state engineering reference.
