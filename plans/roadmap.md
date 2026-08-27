# MyAgentStudio — Roadmap

Living index of open work. Four buckets, in priority order: **TODO** (must ship before the
next release), **NEXT** (decided and scoped, but
deliberately deferred to right after launch — "ship now, harden fast": real user feedback on
a live beta matters more than finishing this before anyone sees it), **FUTURE** (decided
eventually, not yet prioritized — free to reorder), **IDEA** (either not yet decided whether
to build at all, or decided we want it but not sure yet *how* — needs a product/design debate
before it can become a FUTURE/NEXT item, let alone TODO).

Items use stable names, not sequence numbers, so a cross-reference never breaks when an item
closes or a bucket reorders. **This file only ever tracks what's still open** — once
something ships, it drops out of here entirely rather than accumulating as a closure log.
The history of *how* something got built lives in `CHANGELOG.md`; the current-state facts
about how the system works live in `docs/system-about.md`. One fact, one home.

**Layout work still prototypes first** — `reference/layout/Layout-Workbench.html` before
live code (see `CLAUDE.md` standing rule 4).

**Convention changed 2026-08-26:** this file no longer takes new intake — it only drains
as existing items ship. New work items (bugs, small features) go on the repo's GitHub
Project board instead. Existing items already listed below stay here until closed.

---

## Overview — everything at a glance

Every open item, one row each, in the same order as the detailed sections below. **Kind** —
**[UX]** a visible UI/layout change, **[Behavior]** a product/logic or backend change with no
direct UI, **[Infra]** tooling/process/ops, not user-facing at all; a few items genuinely
don't fit any of the three and are left blank. This table is for scanning; each TODO/NEXT
row's real detail (scope, blockers, effort) lives in its own card further down — FUTURE items
aren't detailed further, the description here is all there is.

| Item | Kind | Bucket | Status / description |
|---|---|---|---|
| **Component/UI test coverage** | Infra | NEXT | Not started — first thing once v1 is live |
| **Post-launch verification pass** | Infra | NEXT | Deliberately deferred past this launch — manual smoke test done 2026-08-24 instead |
| **AI chat persistence** | Behavior | NEXT | Not started — approach undecided |
| **Validate `SESSION_TTL_SECONDS` live behavior** | Infra | NEXT | Not started |
| **Strict-mode merged-heading re-audit** | Infra | NEXT | Not started |
| **Export translation to other platforms** | Behavior | NEXT | Not started |
| **Display-label lookup for `model`** | UX | NEXT | Not started, low priority |
| **`AgentSnapshot(kind:'export')` diff-view UI** | UX | NEXT | Ready to scope |
| **AI-assisted config-key mapping** | Behavior | NEXT | Not started |
| **Log retention / pruning / pagination** | Infra | NEXT | Not started |
| **Cost estimation in currency on log rows** | Behavior | NEXT | Not started |
| **Compliance-grade (non-droppable) logging** | Infra | NEXT | Undecided if wanted |
| **Landing page mobile/responsive support** | UX | NEXT | Not started — flagged as a real conversion-risk gap, not cosmetic |
| **Automated invite-code email delivery** | Infra | NEXT | Not started — provider undecided |
| **Improve the guided tour** | UX | NEXT | Not started |
| **Optional call-log persistence toggle** | Infra | NEXT | Undecided if wanted |
| **MCP server exposing MyAgentStudio's agents** | Infra | NEXT | Built + test suite green (Phases 1–4, 2026-08-15), read-only live-verified 2026-08-24 — write path pending, see card below |
| **Re-enable group behavior** | UX | NEXT | Ready — three flag flips |
| **Surface `applied`/`skipped` from apply-proposal in the UI** | UX | NEXT | Not started |
| **`AgentView.tsx` save-name bypasses `apiFetch`** | Behavior | NEXT | Ready — trivial fix |
| **Validation flag for malformed `name`/`description` on import** | Behavior | NEXT | Not started |
| **Wire `AgentDTO.validation` into the UI** | UX | NEXT | Not started |
| **Wiring a declared model for Prometheus** | Behavior | NEXT | Not started |
| **App version number in footer** | UX | NEXT | Ready to build — fully designed, implemented once then reverted for scope reasons (Plan 03) |
| **Task/bug tracking conventions (GitHub Issues + Project board)** | Infra | NEXT | Not started |
| **Skip CI/CD deploy for docs-only pushes** | Infra | NEXT | Not started — revisit once the pipeline's real usage patterns are clearer |
| **Auto-merge PRs once CI passes** | Infra | NEXT | Not started — weigh against losing the manual pre-merge checkpoint |
| **`scripts/build-prompts.ts` readable output** | Infra | FUTURE | The compiled system prompt currently emits as one giant escaped-string line — make it human-readable |
| **Structured outputs for Prometheus** | Behavior | FUTURE | Replace prompt-instructed JSON with Anthropic's API-enforced structured outputs, so malformed replies become structurally impossible |
| **Incremental streaming** | Behavior | FUTURE | Token-by-token chat responses instead of waiting for the full reply |
| **Server-enforced editing lock during a pending proposal** | Behavior | FUTURE | Today's proposal lock is client-side only — no route actually rejects a manual edit while one's pending |
| **Session management (view/log out other sessions)** | UX | FUTURE | A page listing a user's other active sessions with a remote log-out control |
| **Cross-device pending-proposal awareness** | Behavior | FUTURE | A pending proposal only exists in one browser's `localStorage` — a second device has no idea it's there |
| **Instant auto-apply mode** | Behavior | FUTURE | An optional skip-the-confirm-click mode, on top of today's unconditional propose-then-apply |
| **Apply-by-section/per-field granularity** | UX | FUTURE | Apply a subset of a turn's proposed changes instead of only all-or-nothing |
| **System agents become real, platform-managed agents** | Infra | FUTURE | Prometheus/Hermes/Daedalus stop being static compiled prompts and become real, in-platform-editable agents |
| **Sharing / forking** | UX | FUTURE | Let one user hand an agent to another to fork their own copy |
| **Skill module** | UX | FUTURE | A second library entity alongside Agent, for Claude's `SKILL.md` files |
| **Storage target dialect (Postgres vs. Azure SQL)** | Infra | FUTURE | Move off SQLite once the hosting choice demands it |
| **Production DB restore documentation** | Infra | FUTURE | Backup cron already ships (daily, 14-day retention, since 2026-08-26) — this is just writing down the restore runbook, not building anything |
| **Catalog evolution** | Infra | FUTURE | Distinguish "never known" from "was known, catalog since changed" for config/section keys |
| **`ConfigDef` platform-scoping** | Infra | FUTURE | Per-platform config catalogs, once a second platform (beyond Claude) exists |
| **"Replay this request" from a dry-run log row** | UX | FUTURE | Re-run a stored dry-run request for real, straight from the Activity Log |
| **Dedicated group-management view** | UX | FUTURE | A standalone panel for managing groups, beyond the Library's inline controls |
| **Docker** | Infra | FUTURE | Containerize the app |
| **Azure / hosting infra maturity** | Infra | FUTURE | App Service first, Kubernetes only if that ever becomes the real goal |
| **Organizations / teams** | Behavior | FUTURE | Agents owned jointly by a group of people, not just one account |
| **In-place re-login modal** | UX | FUTURE (auth hardening) | A `401` today hard-navigates to `/login`, discarding a half-typed instruction — replace with an in-place re-auth |
| **Per-individual LLM quotas** | Infra | FUTURE (auth hardening) | A per-user override of the global hourly call cap |
| **Per-user LLM spend/cost caps** | Infra | FUTURE (auth hardening) | Cap by actual token spend, not just call count |
| **Server-side session revocation** | Infra | FUTURE (auth hardening) | A real kill switch for one session, beyond rotating `JWT_SECRET` for everyone |
| **Sliding session refresh / "remember me"** | Infra | FUTURE (auth hardening) | A rolling session window instead of today's fixed TTL |
| **Password reset / forgot-password** | Infra | FUTURE (auth hardening) | Self-service password reset — needs an email transport first, not built yet |
| **User self-service** (email/password/delete) | UX | FUTURE (auth hardening) | Change email, change password, delete account — at `/account` |
| **Retention / purge policy for `llm_call_log`** | Infra | FUTURE (auth hardening) | The table is append-only and unbounded today |
| **Constant-time login** | Infra | FUTURE (auth hardening) | A dummy bcrypt compare for unknown emails, to prevent timing-based user enumeration |
| **Distributed / persistent rate limiting** | Infra | FUTURE (auth hardening) | Today's login limiter is in-process and resets on restart |
| **Hashing invite codes at rest** | Infra | FUTURE (auth hardening) | Codes are stored plaintext today, by choice |
| **Invite-code expiry** | Infra | FUTURE (auth hardening) | Codes don't expire today — `maxUsers` plus single-use already bounds the damage |
| **CSRF tokens** | Infra | FUTURE (auth hardening) | Not built — `sameSite=lax` plus JSON-only mutations covers the realistic surface today |
| **Agent ownership-transfer UI** | UX | FUTURE (auth hardening) | Today it's a manual SQL operation |
| **GDPR-style export/deletion workflow** | Behavior | FUTURE (auth hardening) | No legal obligation today for a private closed beta among friends |
| **Argon2id instead of bcrypt** | Infra | FUTURE (auth hardening) | bcrypt is adequate today; argon2 needs a native build |
| **A second OAuth provider** (GitHub, Microsoft, Apple) | Infra | FUTURE (OAuth hardening) | The provider seam already exists — one file, one registry line, two env vars, one button |
| **Manual link/unlink of an OAuth provider** | UX | FUTURE (OAuth hardening) | Auto-linking already covers the realistic case today |
| **An admin toggle for auto-linking** | Infra | FUTURE (OAuth hardening) | A pre-scoped contingency for the Google Workspace domain-takeover risk |
| **Storing OAuth provider tokens** | Infra | FUTURE (OAuth hardening) | To call the provider's API later, e.g. for a profile picture — no feature needs this yet |
| **Restricting sign-in to an email domain / rate-limiting the callback** | Infra | FUTURE (OAuth hardening) | `maxUsers` plus invite codes are already the admission control today |
| **Building the Prometheus system prompt dynamically per request** | Infra | FUTURE (Prometheus hardening) | Today it's static and compiled at build time |
| **Atomic (single-transaction) apply** | Behavior | FUTURE (Prometheus hardening) | Today's apply is non-atomic, ordered sections-first |
| **An audit trail for config changes** | Infra | FUTURE (Prometheus hardening) | Sections already have `section_revision`; config doesn't have the equivalent |
| **Live cross-tab proposal sync beyond the existing listener** | Behavior | FUTURE (Prometheus hardening) | Today's `storage`-event listener already covers the common case |

---

## TODO — before v1 goes online

Empty as of 2026-08-26 — v1 shipped (Plans 01/02). Anything that must block a future
release lands here when it exists; nothing currently does.

## NEXT — first priorities once v1 is online

Decided and scoped, deliberately deferred to right after launch. **Component/UI test
coverage** is what gets picked up first once v1 is live, per your explicit call; the rest of
this bucket is free to reorder.

### Overview

| Item | Status |
|---|---|
| **Component/UI test coverage** | Not started — first thing once v1 is live |
| **Post-launch verification pass** | Not started — deliberately deferred past this launch |
| **AI chat persistence** | Not started — needs an approach decision |
| **Validate `SESSION_TTL_SECONDS` live behavior** | Not started — just needs to be run |
| **Strict-mode merged-heading re-audit** | Not started — low risk |
| **Export translation to other platforms** | Not started |
| **Display-label lookup for `model`** | Not started — low priority |
| **Show `provider` column in Activity Log** | Not started — low priority |
| **Replace `window.alert()` with a proper UI component** | Not started — low priority |
| **Better starter content for "+ New agent"** | Not started |
| **`AgentSnapshot(kind:'export')` diff-view UI** | Not started — ready to scope |
| **AI-assisted config-key mapping** | Not started |
| **Log retention / pruning / pagination** | Not started |
| **Cost estimation in currency on log rows** | Not started |
| **Compliance-grade (non-droppable) logging** | Undecided if wanted |
| **Landing page mobile/responsive support** | Not started — real conversion-risk gap, not cosmetic |
| **Automated invite-code email delivery** | Not started — provider undecided |
| **Improve the guided tour** | Not started — depends on the MVP tour shipping first |
| **Optional call-log persistence toggle** | Undecided if wanted |
| **MCP server exposing MyAgentStudio's agents** | Built + test suite green (Phases 1–4) 2026-08-15, read-only live-verified 2026-08-24 — write path pending |
| **Re-enable group behavior** | Ready — three flag flips |
| **Surface `applied`/`skipped` from apply-proposal in the UI** | Not started |
| **`AgentView.tsx` save-name bypasses `apiFetch`** | Ready — trivial fix |
| **Validation flag for malformed `name`/`description` on import** | Not started |
| **Wire `AgentDTO.validation` into the UI** | Not started |
| **Wiring a declared model for Prometheus** | Not started |
| **App version number in footer** | Ready to build |
| **Task/bug tracking conventions (GitHub Issues + Project board)** | Not started |
| **Skip CI/CD deploy for docs-only pushes** | Not started |
| **Auto-merge PRs once CI passes** | Not started |

---

### **Component/UI test coverage**

**Current state:** Zero automated coverage on the React component tree — only manual
live-browser verification per session.

**Scope:** `AgentView.tsx`, `LibraryPanel.tsx`, `ImportDialog.tsx`, `ChatPanel.tsx`, etc.,
including the dry-run branches added in Plan 04, which have no unit tests today.

**Why first:** a beta audience can survive a couple of early bugs; more valuable to harden
against real usage than delay launch chasing coverage up front.

**Effort:** Large
**Status:** Not started

---

### **Post-launch verification pass**

**Current state:** Deliberately not run before this launch. The user manually smoke-tested
the core import → chat-edit → proposal → apply → export flow on 2026-08-24, which stood in
for the formal checks below to keep the launch date. MCP's read-only surface is separately
already live-verified against a real client (see the MCP item's card below) — only its
write half is still open.

**Scope — three checks, the two billed ones each needing a fresh explicit go-ahead per
standing rule 2:**
- **Big Flow Test** (billed): one real end-to-end pass — import a real agent file, edit it
  manually and via chat, export and reimport, confirming the round trip holds. Also the
  first real exercise of Prometheus's own verification logic against a genuine reply.
- **MCP write path** (billed): turn on `mcpWrites`, use a `write`-scoped token, try
  `push_agent` with `dryRun:true` first, then one real call — confirm the resulting
  `llm_call_log` row carries `origin: 'mcp'` correctly.
- **Account "API tokens (MCP access)" panel** — visual QA (one-time reveal + copy, list
  render, revoke). Never opened in a running browser yet. Free.

**Effort:** Small
**Depends on:** none — the app is live in production, ready to run against the real domain
**Status:** Not started — deliberately deferred past this launch

---

### **AI chat persistence**

**Current state:** `ChatPanel.tsx`'s `messages` is plain in-memory `useState` — chat fully
resets on reload or agent switch. (Distinct from the existing model-side chat-history memory
Prometheus already has *within* a live session — that doesn't survive a reload either; this
item is about the session surviving a reload/device switch at all.)

**Scope — needs a decision when picked up:**
- Lightweight cookie/localStorage approach — no schema change, single-browser only
- vs. a real `Conversation`/`Message` DB table — genuine schema addition, persists properly, works across devices

**Effort:** Medium
**Status:** Not started, approach undecided

---

### **Validate `SESSION_TTL_SECONDS` live behavior**

**Current state:** Setting exists (7-day default via env var), never live-verified.

**Scope:** Set `SESSION_TTL_SECONDS=120`, restart, log in, wait, confirm the session actually
expires and the `?next=` redirect round trip still works; unset it, confirm the 7-day default
returns; confirm an invalid value refuses to boot. Nothing to build, just to run.

**Effort:** Trivial
**Status:** Not started

---

### **Strict-mode merged-heading instability re-audit**

**Current state:** Flagged unverified during Plan 02, never re-checked. Lower risk now —
only affects the secondary Strict import path; Structural has been default since Plan 02.

**Effort:** Small
**Status:** Not started

---

### **Export translation to other platforms**

**Current state:** Export only produces Claude's own `.md` format.

**Scope:** Real format translation (starting with Copilot), not a file copy. Each target
platform would naturally become its own import/export system agent under the existing Agent
pattern (see FUTURE's "System agents become real, platform-managed agents") — one shared
authoring pattern, easy to extend.

**Effort:** Medium
**Status:** Not started

---

### **Display-label lookup for `model`**

**Current state:** UI shows the raw model ID (e.g. `claude-sonnet-5`) — already legible and
correctly aligned with real Anthropic naming, so no longer a launch concern.

**Scope:** A short label (e.g. "Opus" instead of the full ID) while storage stays the full
ID. Grouped with **Export translation to other platforms** — same underlying problem (mapping
a platform-specific representation to something else).

**Effort:** Small
**Status:** Not started, low priority

---

### **Show `provider` column in Activity Log**

**Current state:** `llm_call_log.provider` (`'anthropic'` vs. the OpenAI-compatible
provider) is stored in the database and returned by `GET /api/llm-call-log`, but
`ActivityLogPane.tsx`'s `LogListItem` type doesn't declare it and the table has no
"Provider" column — only `model` is shown. Found 2026-08-26 while reviewing the log
during Plan 02's AWS deploy. In practice the provider is usually inferable from the model
name itself (e.g. `meta/llama-3.1-8b-instruct` obviously isn't Anthropic), so this is
cosmetic, not a missing-data gap.

**Scope:** Add `provider` to `LogListItem`, add a "Provider" column/cell to the table.

**Effort:** Small
**Status:** Not started, low priority

---

### **Replace `window.alert()` with a proper UI component**

**Current state:** `AgentView.tsx` (lines ~748, ~752 — the custom-config-key validation
messages) uses raw browser `window.alert()`. Found 2026-08-26. This is the only place in
the app using it — everywhere else (e.g. `CreateAgentButton.tsx`) already uses an inline
error message pattern (`<p className="text-[11px] text-[var(--err)]">`).

**Why it's worth fixing:** a native OS alert box breaks visual consistency with the rest
of the app, can't be themed for light/dark mode, and blocks the JS thread until dismissed
— out of step with the rest of the UI's inline-message pattern.

**Scope:** Replace both call sites with the same inline error-message pattern already
established elsewhere in the codebase (or a small shared toast/banner component if a
third call site shows up later — not worth building an abstraction for two call sites
today).

**Effort:** Small
**Status:** Not started, low priority

---

### **Better starter content for "+ New agent"**

**Current state:** `createAgent()` (`lib/db/repository/agents.ts`) seeds a brand-new agent
with only empty core sections (from `sectionDef` where `isCore: true`) — no example
content, no config defaults, no guidance. A first-time user clicking "+ New agent" lands
on a blank slate with just section headings and nothing else. Found 2026-08-26.

**Scope:** Needs a design decision first — what "better" means here (placeholder/hint text
per section vs. a filled-out example agent vs. a small set of starter templates to pick
from). Not scoped in detail yet.

**Effort:** Medium — depends on the design decision above.
**Status:** Not started

---

### **`AgentSnapshot(kind:'export')` capture + import/export diff-view UI**

**Current state:** The export route this was waiting on is now built.

**Effort:** Medium
**Status:** Ready to scope

---

### **AI-assisted config-key mapping**

**Current state:** Not started.

**Scope:** Label a messy frontmatter key to its canonical `propKey` — same content-never-touched pattern as section classification already uses.

**Effort:** Medium
**Status:** Not started

---

### **Log retention / pruning / pagination**

**Current state:** `llm_call_log` is append-only and unbounded.

**Scope:** Worth scoping once real usage gives a sense of actual growth rate — revisit past
~5,000 rows or `myagent.db` exceeding ~200MB.

**Effort:** Medium
**Status:** Not started

---

### **Cost estimation in currency on log rows**

**Current state:** Token counts only.

**Scope:** Once token counts stop being sufficient to answer "what did that cost."

**Effort:** Small
**Status:** Not started

---

### **Compliance-grade (non-droppable) logging**

**Current state:** A failed log write on a live call is deliberately swallowed today
(diagnostics, not an evidence ledger).

**Scope:** Still an open "if" — want to see actual impact/need with real users before
deciding whether this is worth building at all.

**Effort:** Medium–Large, if built
**Status:** Undecided if wanted

---

### **Landing page mobile/responsive support**

**Current state:** Split out from the "Check: landing page walkthrough UX (ux agent
review)" TODO item (2026-08-17) — the `ux` agent's review of the "How it works"
walkthrough flagged that neither `app/components/Welcome/WelcomePage.tsx` nor the mock
`reference/layout/Layout-Landing.html` have any responsive/mobile handling at all
(only `prefers-color-scheme` exists as a media query anywhere in either file). The
walkthrough's two-column inline grid and the "Full view" modal's fixed
`min(1200–1320px, 92vw)` width have no narrower-viewport fallback — on a phone this
would render as two cramped, largely illegible columns squeezed side by side. Given this
is the single best piece of proof-of-product on the whole `/welcome` page, the review
called this a real conversion-risk gap for an invite-request landing page, not a
cosmetic one — which is why it's tracked separately from the smaller same-day fixes
rather than folded into "eventually get to responsive design" generally.

**Scope:** Needs its own design pass before implementation — at minimum: how the
walkthrough's text/screenshot pair stacks on narrow viewports, whether the "Full view"
modal makes sense on mobile at all (vs. e.g. just showing the inline card's own image
larger), and whether this should be scoped to just this one section or triggers a wider
"does the whole landing page need a mobile pass" question (hero, trust strip, feature
grid, roadmap teaser wave line all share the same no-breakpoints gap, just less
severely). Mock-first per standing rule 4.

**Effort:** Medium — the real work is a design decision, not the CSS itself
**Depends on:** None
**Status:** Not started

---

### **Automated invite-code email delivery**

**Current state:** "Request access" on the signup form (Plan 12, 2026-08-14) lets a
visitor without an invite code submit their name/email; an admin sees the request in
Settings and can generate a code for them (bound to that email, expires per the
"Access-request code expiry" setting — default 5h) — but nothing emails that code to the
requester automatically. The admin has to copy it and send it themselves, for now.

**Scope:** Pick an email provider (e.g. Resend — modern API, generous free tier) and wire
it in: an API key, a small send-email module, and a call from the "Generate code" action
(and optionally the plain "+ Generate code" admin flow too). No schema change needed — the
invite code and the requester's email already exist together in `invite_code`.

**Effort:** Small–Medium (mostly provider setup + one API call), once a provider is chosen
**Depends on:** None
**Status:** Not started — provider undecided

---

### **Improve the guided tour**

**Current state:** Depends on the MVP tour (TODO) shipping first.

**Scope — candidates once the dim-panel MVP is live:**
- True anchored coach-marks (`@radix-ui/react-popover` or similar) instead of dimming fixed regions
- More/different trigger conditions (first import, not just first login)
- Additional steps; usage signal on where people skip or drop off

**Effort:** Medium
**Status:** Not started

---

### **Optional call-log persistence toggle**

**Current state:** Not decided if wanted (see IDEA).

**Scope:** A flag controlling whether `llm_call_log` entries get written to the DB at all, vs.
shown only transiently. Timing-wise: revisit soon after launch rather than let it drift.

**Effort:** Small, if built
**Status:** Undecided if wanted

---

### **MCP server exposing MyAgentStudio's agents**

**Current state:** **Built and test-verified 2026-08-15** — all four phases (token subsystem,
read-only server, fitness functions, `import_agent`) implemented per
`plans/archive/13-mcp-server-exposing-agents.md`, plus the full test suite (`lib/mcp/__tests__/`,
`lib/auth/__tests__/apiToken.test.ts` + `mcpGuard.test.ts`,
`lib/db/repository/__tests__/apiTokens.test.ts`, `app/api/__tests__/account-tokens.test.ts` +
`mcp.test.ts`) and docs (`lib/mcp/CLAUDE.md`, `docs/system-about.md` §13, `lib/auth/CLAUDE.md`,
`lib/db/CLAUDE.md`, `docs/user-guide.md`, `docs/project-explanation.md`, `README.md`).
`npm test` run with your go-ahead: **66/66 files, 841/841 tests pass** — this surfaced and
fixed three real bugs along the way (below). `npx tsc --noEmit` on Plan 13's own code is
clean; it separately surfaced 8 pre-existing Plan 11 errors (3× `NODE_ENV` read-only in
`lib/__tests__/env.test.ts`, 5× a missing `provider` field in `llmCallLog`/
`llmCallLog-redaction` test fixtures) — fixed 2026-08-18 during the Preferences-modal work,
`tsc --noEmit` and `npm test` (66/66, 842/842) both clean as of that session.

**Bugs found and fixed during verification, not present before this pass:**
- `lib/db/migrations/0008_mcp_tokens.sql` had been hand-written without a matching
  `meta/_journal.json` entry, so the in-memory test DB's migrator silently never applied
  it — every test touching `api_token` or `llm_call_log.origin` failed. Fixed by
  regenerating properly via `npx drizzle-kit generate --name=mcp_tokens` (identical SQL,
  now with a real journal entry + snapshot).
- `listAgents()` in `lib/db/repository/agents.ts` declared `updatedAt` on its
  `AgentLiteDTO` return type but never actually set it on the returned object — a
  pre-existing latent bug, surfaced because `list_agents`'s documented shape depends on it.
  Fixed.
- `app/components/Account/AccountView.tsx`'s file-header comment literally quoted the
  string `fetch('/api/` inside a sentence explaining the apiFetch rule — tripping the very
  fitness test it was describing (a false positive, not a real bare-fetch call). Reworded.
- The MCP route/protocol tests didn't send `Accept: application/json, text/event-stream`,
  which the SDK's transport requires on every POST (a real client sends this
  automatically) — test-only fix, now documented in `lib/mcp/CLAUDE.md`.

**Read-only surface live-verified 2026-08-24** — a real Claude Code session completed the
handshake and successfully called `list_agents` and `pull_agent`/`get_agent`. Only the
billed `push_agent` call remains, tracked under NEXT's **Post-launch verification pass**.

**Tool names renamed 2026-08-24:** `export_agent` → `pull_agent`, `import_agent` →
`push_agent` (CLI/git mental model). `plans/archive/13-mcp-server-exposing-agents.md` still uses
the original names as the historical decision record; `lib/mcp/CLAUDE.md` and
`docs/system-about.md` §13 have the current names.

**Scope:** An MCP server so a **console MCP client** (Claude Code and equivalents) can
read/import a user's agents outside the web UI. **Clients:** console/CLI only — Claude
Desktop's GUI connector is explicitly not a target, which is what keeps an OAuth 2.1
authorization server out of scope entirely. **Auth:** per-user Personal Access Tokens (opaque
bearer, generated in Account, stored SHA-256-hashed, scoped read/write, revocable) — the
session cookie genuinely does not extend to a non-browser client. **Surface:** four tools —
`list_agents`, `get_agent`, `pull_agent` (read) and `push_agent` (write) — plus agents as
read-only resources. **Structured field-level editing is deliberately not exposed**: the only
mutation is "import this markdown document," which reuses the existing import pipeline and
inherits its whole safety story (owner-scoped name lookup that creates-or-updates,
pre-import/post-import snapshots, `reimport`-tagged revisions, coverage warnings, truncation
rejection, byte-identical short-circuit). **Guardrails:** no propose/review card — reproducing
it would depend on a client the platform doesn't control cooperating; instead the consent gate
is token-issue time, plus an admin `mcpWrites` kill switch defaulting to off, plus the existing
per-user hourly LLM cap (shared, no MCP-specific limit). **Transport:** stateless Streamable
HTTP at `/api/mcp` inside the existing Next.js app. Read-only ships first and is useful alone.

**Effort:** **Medium** (revised down from Large on 2026-08-15). The original Large rating
assumed a seven-tool surface including structured writes; trimming to four tools removed the
shared write-contract extraction, any change to the apply-proposal route, the config-merge
risk, and two schema enum additions, and resolving the client question removed OAuth. What
remains: a token subsystem, a protocol endpoint, three thin repository reads, one tool wrapping
the existing import pipeline, one nullable log column, one bool setting, tests and docs. The
read-only slice alone is Small–Medium.
**Status:** Built + test suite green 2026-08-15, read-only surface live-verified 2026-08-24 —
`plans/archive/13-mcp-server-exposing-agents.md`. Write-path verification tracked under
**Post-launch verification pass**; this item closes once that runs

---

### **Re-enable group behavior**

**Current state:** Data model, repository, and API routes fully built and untouched. UI entry
points are flag-disabled pre-launch (`GROUPS_ENABLED` in `WorkbenchShell.tsx`/`LibraryPanel.tsx`,
`DRAG_ENABLED` in `AgentListItem.tsx`).

**Scope:** Three flag flips restore the "Agents"/"Grouped" toggle, "+ New group," and the drag
handle. `GroupSection.tsx` and the group API were never touched — nothing to rebuild, just
re-expose. Worth a quick real-usage check once re-enabled.

**Effort:** Trivial
**Status:** Ready

---

### **Surface `applied`/`skipped` from apply-proposal in the UI**

**Current state:** `apply-proposal/route.ts`'s response has always carried
`applied: { description, sectionKeys, configKeys }` and `skipped[]` (each with a reason), but
`WorkbenchShell.tsx`'s `applyProposal` only reads `data.agent` — a partially-skipped proposal
currently looks identical to a fully-applied one.

**Scope:** A UI decision (a toast, a note on the proposal card, something in the chat
transcript) — the data already exists, this is UI-only.

**Effort:** Small
**Status:** Not started

---

### **`AgentView.tsx` save-name call site bypasses `apiFetch`**

**Current state:** `saveNameEdit()` calls raw `fetch()` instead of the shared `apiFetch()`
every other call site in the file uses — a session expiring mid-rename shows a generic
"Save failed" instead of the app's normal redirect-to-login.

**Effort:** Trivial — one-line swap
**Status:** Ready

---

### **Validation flag for malformed `name`/`description` on import**

**Current state:** `lib/import/assemble.ts`'s `toScalar()` silently collapses a malformed
`name`/`description` (e.g. a nested YAML mapping) to `''`/a placeholder with no warning —
arguably contradicts the project's own flag-don't-block principle.

**Scope:** Needs a scope decision first (new validation flag, or accept as an edge case).
Bundle with **Wire `AgentDTO.validation` into the UI** below — both extend the same surface.

**Effort:** Small–Medium
**Status:** Not started

---

### **Wire `AgentDTO.validation` into the UI**

**Current state:** `descriptionMissing` / `unknownConfigKeys` / `outdatedOrUnknownValues` are
computed on every agent load and already delivered on `AgentDTO`, but nothing in
`AgentView.tsx` reads them — this is the original "review feature" pitch, built but invisible.

**Scope:** A UI design pass (badge placement, click behavior) before coding. Natural pairing
with the item above.

**Effort:** Medium
**Status:** Not started

---

### **Wiring a declared model for Prometheus**

**Current state:** `LlmRequest.model` is a real, already-supported field; Prometheus's own
frontmatter `model` is simply left **unset** today (not hardcoded to any specific model).

**Scope:** Revisit once a specific model is actually chosen for chat, or the next time
`scripts/build-prompts.ts` is touched.

**Effort:** Trivial
**Status:** Not started

---

### **App version number in footer**

**Current state:** Extracted 2026-08-26 from Plan 03 (CI/CD)'s original Step 5 — not part
of the CI/CD flow itself, moved here to stand on its own with independent priority.
Design already fully worked out and implemented once during Plan 03 (then reverted, only
for scope-organization reasons, not because anything was wrong with it):

- `next.config.ts` gains an `env` block reading `package.json`'s `version` into
  `NEXT_PUBLIC_APP_VERSION` at build time (the running build IS the version, no API
  route needed).
- `app/components/WorkbenchShell.tsx`'s existing branding footer (currently "Produced by
  ProcessMind Solutions") gets one more `<span>` showing `· v{APP_VERSION}`, reusing the
  container's existing muted/small styling — no new styling needed.
- Bump process: `npm version patch|minor|major` (creates commit + tag) → matching
  `CHANGELOG.md` entry → push. Stays behind the no-commit-without-ask standing rule like
  any other commit.
- Deliberately not bumped yet — first real bump happens when work on the next version
  actually starts, not just to exercise the mechanism.
- A separate, second footer exists on the pre-login `/welcome` landing page
  (`WelcomePage.tsx`) — out of scope for this item unless explicitly requested.

**Effort:** Trivial — two small file edits, already proven to work
**Status:** Ready to build

---

### **Task/bug tracking conventions (GitHub Issues + Project board)**

**Current state:** Extracted 2026-08-26 from Plan 03 (CI/CD)'s original Step 6 — not part
of the CI/CD flow itself, moved here to stand on its own with independent priority. This
file's own header already carries the convention this item would actually build: *"this
file no longer takes new intake — it only drains as existing items ship. New work items
... go on the repo's GitHub Project board instead."* That board doesn't exist yet — this
item is what builds it.

**Scope:**
- No bulk migration of this file's existing items — they stay here until closed.
- Create 2–3 real starter Issues from the current NEXT list, so the Issues tab isn't
  empty when Plans 06/07 send visitors (an empty Issues tab on a "live product" repo
  reads as abandoned).
- Label set: `bug`, `enhancement`, `good first issue` (the README's AGPL/contribution
  note already invites small PRs — gives newcomers somewhere to land).
- Create a repo-level GitHub Project (free, built-in) as a kanban board over Issues —
  columns `Backlog` / `In Progress` / `Done`. Every new Issue gets added to the board;
  `Done` items stay visible there (public evidence) instead of disappearing the way
  closed items in this file do.
- PRs stay optional (per Plan 03's D1) — used for non-trivial changes and as portfolio
  evidence; direct-to-`master` allowed for trivial fixes (though in practice, branch
  protection now requires any commit reach `master` with a passing check attached first —
  see `03-CICD.md`).

**Effort:** Small
**Status:** Not started

---

### **Skip CI/CD deploy for docs-only pushes**

**Current state:** Surfaced 2026-08-26 during Plan 03 close-out — every push to `master`
currently triggers both the `test-and-build` and `deploy` jobs, including pushes that
only touch docs (`*.md`, `plans/**`). Functionally harmless (the app doesn't change) but
not free: a full `npm ci` + `npm run build` + `pm2 restart` (brief service blip) plus
opening/closing the AWS security-group hole, just to redeploy identical app code.
Deliberately not fixed proactively — the plan is to watch the pipeline's real usage for a
while first and adjust for actual cases seen, not guess upfront.

**Scope, once picked up:** keep `test-and-build` running on every push (cheap, worth
always verifying) but gate the `deploy` job specifically on whether the diff touches
app-relevant paths — e.g. the `dorny/paths-filter` action, or GitHub's native
`paths-ignore` on the trigger if an all-or-nothing skip turns out to be good enough.

**Effort:** Small
**Status:** Not started — revisit once real pipeline usage shows this is worth it

---

### **Auto-merge PRs once CI passes**

**Current state:** Surfaced 2026-08-26 alongside the item above, while discussing the
CI/CD pipeline's day-to-day feel. GitHub has a built-in "Enable auto-merge" toggle on a
PR — once turned on, it merges automatically the instant required status checks pass, no
manual click needed. Needs one repo-level setting first (**Settings → General → Pull
Requests → "Allow auto-merge"**), then it's a per-PR toggle.

**The real tradeoff, not yet resolved:** today's "explicit go" checkpoint is *clicking
merge after seeing CI is actually green*. With auto-merge, that checkpoint moves earlier —
to the moment "Enable auto-merge" is clicked, potentially before CI has even started.
Since a push to `master` now literally means deploying (Plan 03's gate-semantics shift),
auto-merge means pre-authorizing the deploy before it's been seen to pass, not after.
Grouped here with the item above so both can be weighed together once there's a better
feel for how the pipeline actually gets used day to day.

**Effort:** Trivial to turn on; the open question is whether it's wanted, not how to build it
**Status:** Not started — weigh against losing the manual pre-merge checkpoint

---

## FUTURE — decided to build eventually, not prioritized

Genuinely free to reorder, lower urgency than NEXT. Lighter-weight entries than TODO/NEXT —
these are "yes, eventually" items with a revisit trigger, not actively scoped work.

### Overview — general

| Item | Revisit trigger |
|---|---|
| **`scripts/build-prompts.ts` readable output** | Pick up when debugging a live chat-edit failure |
| **Structured outputs for Prometheus** | If prompt hardening doesn't hold up under continued use |
| **Incremental streaming** | No trigger — free to pick up anytime |
| **Server-enforced editing lock during a pending proposal** | If a client stops cooperating |
| **Session management (view/log out other sessions)** | Needs its own scoping first |
| **Cross-device pending-proposal awareness** | If real usage shows overwrites |
| **Instant auto-apply mode** | If the confirm-click proves to be friction |
| **Apply-by-section/per-field granularity** | No trigger yet |
| **System agents become real, platform-managed agents** | Confirmed wanted, explicitly "far away" |
| **Sharing / forking** | Ready to scope — prerequisite (`ownerId`) satisfied |
| **Skill module** | Ready to scope |
| **Storage target dialect (Postgres vs. Azure SQL)** | Passed 2026-08-26 without firing — SQLite chosen for the AWS EC2 deploy and working fine; revisit only if it stops being adequate |
| **Production DB restore documentation** | Before opening the beta more widely, or the first time a restore is actually needed |
| **Catalog evolution** | Once catalog-versioning infrastructure exists |
| **`ConfigDef` platform-scoping** | When a second platform's import/create is built |
| **"Replay this request" from a dry-run log row** | If manual re-running becomes a papercut |
| **Dedicated group-management view** | Not researched |
| **Docker** | Once the app runs end-to-end online |
| **Azure / hosting infra maturity** | Folds with the storage-dialect item |
| **Organizations / teams** | Needs a product/design debate before buildable |

### Overview — internal hardening backlog (migrated from the old TechDesign deferred-decisions table)

*From the multi-tenant auth review:*

| Item | Revisit trigger |
|---|---|
| **In-place re-login modal** | If a beta user loses work to an expired session |
| **Per-individual LLM quotas** | If someone needs a different ceiling than the global cap |
| **Per-user LLM spend/cost caps** | If the call-count proxy misbehaves |
| **Server-side session revocation** | Once password reset exists or the beta opens wider |
| **Sliding session refresh / "remember me"** | If users complain about re-logging-in |
| **Password reset / forgot-password** | Needs an email transport, not built yet |
| **User self-service** (email/password/delete) | Deferred on content, not placement |
| **Retention / purge policy for `llm_call_log`** | Once size/consent makes it a real question |
| **Constant-time login** | Only if self-service signup opens without invite codes |
| **Distributed / persistent rate limiting** | If the deploy ever runs more than one instance |
| **Hashing invite codes at rest** | If codes become long-lived or numerous |
| **Invite-code expiry** | If codes get handed out well ahead of use |
| **CSRF tokens** | If a mutating `GET` appears, or the app embeds cross-origin |
| **Agent ownership-transfer UI** | If users start handing off agents regularly |
| **GDPR-style export/deletion workflow** | Once users aren't just friends |
| **Argon2id instead of bcrypt** | If the native-dependency constraint disappears |

*From the Google OAuth review:*

| Item | Revisit trigger |
|---|---|
| **A second OAuth provider** (GitHub, Microsoft, Apple) | If anyone wants something other than Google |
| **Manual link/unlink of an OAuth provider** | Needs a re-auth step + a still-deferred set-a-password flow |
| **An admin toggle for auto-linking** | If the Google Workspace domain-takeover risk needs a faster answer |
| **Storing OAuth provider tokens** | When a real feature needs it |
| **Restricting sign-in to an email domain / rate-limiting the callback** | If the beta opens beyond invite codes |

*From the Prometheus/chat rework:*

| Item | Revisit trigger |
|---|---|
| **Building the Prometheus system prompt dynamically per request** | If prompt-cache economics justify it |
| **Atomic (single-transaction) apply** | If a partial apply is ever actually observed |
| **An audit trail for config changes** | No trigger yet |
| **Live cross-tab proposal sync beyond the existing listener** | Only if multi-tab use causes real confusion |

## IDEA — either not decided-if, or decided-but-not-how

Needs a product/design debate before an item can move to FUTURE/NEXT with an understood
scope, let alone TODO — a timing tier (like "NEXT") is not the same as a design decision.
One NEXT item (**Optional call-log persistence toggle**) is timed but still genuinely
undecided-if — that's why it says "(see IDEA)": this paragraph is the note, not a separate
per-item entry. **MCP server exposing MyAgentStudio's agents** used to sit here too; it was decided
**wanted** on 2026-08-15 and now has a full design in
`plans/archive/13-mcp-server-exposing-agents.md`, so it's an ordinary NEXT item.

### **Mobile access to the workbench**

**Current state:** Not decided-if, and not decided-how. Surfaced 2026-08-18 while drafting
`/welcome`'s roadmap-teaser content — distinct from the already-tracked "Landing page
mobile/responsive support" NEXT item, which is only about the marketing page's own CSS
rendering on a phone browser, not about reaching the actual product (Library, structured
view, chat, export) from a mobile device at all.

**Open questions, not yet debated:** A responsive web version of the workbench itself (the
existing 4-pane layout doesn't obviously collapse to a phone screen)? A native/PWA app? Full
parity with the desktop feature set, or a deliberately reduced mobile surface (e.g.
read/review only, no editing)? None of this has a real answer yet — this entry exists so the
idea has a home before it's referenced anywhere public, not because a direction has been
chosen.

**Effort:** Unknown until scoped
**Status:** Idea only — needs its own product/design debate before it can become a real
FUTURE/NEXT item

---

## Reference

- **`plans/archive/`** — completed plans 01–10, kept for history.
- **`CLAUDE.md`** — standing project rules and folder map.
- **`docs/roadmap.md`** — the friendly, capability-only public roadmap.
- **`CHANGELOG.md`** — project history by date.
- **`docs/system-about.md`** — current-state engineering reference.
