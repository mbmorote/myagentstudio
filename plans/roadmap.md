# MyAgent — Roadmap

Living index of open work. Four buckets, in priority order: **TODO** (must ship before v1
goes online — "Deploy online" is always the last item), **NEXT** (decided and scoped, but
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

**Layout work still prototypes first** — `architecture/layout/Layout-Workbench.html` before
live code (see `CLAUDE.md` standing rule 4).

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
| **Second LLM provider** | Infra | TODO | Not started |
| **Big flow test** |  | TODO | Ready to run — needs your OK to spend real Anthropic money |
| **Company branding on the platform** | UX | TODO | Blocked on your assets/copy |
| **First-login guided tour (mini-tour)** | UX | TODO | Prototyped, copy drafted not signed off |
| **"Don't paste sensitive data" disclaimer** | UX | TODO | Not started |
| **Production DB backup/restore** | Infra | TODO | Not started |
| **Deploy online** |  | TODO | Not started — always last |
| **Component/UI test coverage** | Infra | NEXT | Not started — first thing once v1 is live |
| **AI chat persistence** | Behavior | NEXT | Not started — approach undecided |
| **Settings page — sidebar layout + Activity log User column** | UX | NEXT | Not started |
| **Validate `SESSION_TTL_SECONDS` live behavior** | Infra | NEXT | Not started |
| **Strict-mode merged-heading re-audit** | Infra | NEXT | Not started |
| **Export translation to other platforms** | Behavior | NEXT | Not started |
| **Display-label lookup for `model`** | UX | NEXT | Not started, low priority |
| **`AgentSnapshot(kind:'export')` diff-view UI** | UX | NEXT | Ready to scope |
| **AI-assisted config-key mapping** | Behavior | NEXT | Not started |
| **Log retention / pruning / pagination** | Infra | NEXT | Not started |
| **Cost estimation in currency on log rows** | Behavior | NEXT | Not started |
| **Compliance-grade (non-droppable) logging** | Infra | NEXT | Undecided if wanted |
| **Pre-login landing page for prospective users** | UX | NEXT | Mockup done, Terms/Privacy pages + browser check left |
| **Improve the guided tour** | UX | NEXT | Not started |
| **Optional call-log persistence toggle** | Infra | NEXT | Undecided if wanted |
| **MCP server exposing MyAgent's agents** | Infra | NEXT | Undecided if wanted |
| **Re-enable group behavior** | UX | NEXT | Ready — three flag flips |
| **Surface `applied`/`skipped` from apply-proposal in the UI** | UX | NEXT | Not started |
| **`AgentView.tsx` save-name bypasses `apiFetch`** | Behavior | NEXT | Ready — trivial fix |
| **Validation flag for malformed `name`/`description` on import** | Behavior | NEXT | Not started |
| **Wire `AgentDTO.validation` into the UI** | UX | NEXT | Not started |
| **Wiring a declared model for Prometheus** | Behavior | NEXT | Not started |
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
| **Catalog evolution** | Infra | FUTURE | Distinguish "never known" from "was known, catalog since changed" for config/section keys |
| **`ConfigDef` platform-scoping** | Infra | FUTURE | Per-platform config catalogs, once a second platform (beyond Claude) exists |
| **"Replay this request" from a dry-run log row** | UX | FUTURE | Re-run a stored dry-run request for real, straight from the Activity Log |
| **Dedicated group-management view** | UX | FUTURE | A standalone panel for managing groups, beyond the Library's inline controls |
| **CI/CD** | Infra | FUTURE | Automated test → build → deploy, instead of the manual first deploy |
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
| **Per-user view of the activity log** | UX | FUTURE (auth hardening) | A user's own calls, filtered to just them |
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

Must happen before v1 launches. **Deploy online is always last** — anything newly added here
goes before it.

### Overview

| Item | Kind | Status |
|---|---|---|
| **Second LLM provider** | Infra | Not started |
| **Big flow test** | — | Ready to run — needs your OK to spend real Anthropic money |
| **Company branding on the platform** | UX | Blocked on your assets/copy |
| **First-login guided tour (mini-tour)** | UX | Prototyped, copy drafted not signed off |
| **"Don't paste sensitive data" disclaimer** | UX | Not started |
| **Production DB backup/restore** | Infra | Not started |
| **Deploy online** | — | Not started — always last |

---

### **Second LLM provider**

**Current state:** `LLMProvider` interface exists; only `AnthropicProvider` implemented.

**Scope:**
- A non-Anthropic provider behind the existing interface — no user-visible change, same chat/import behavior through a different vendor
- Specific vendor (OpenAI-compatible API, NVIDIA, etc.) and whether it's admin-only or user-selectable are **not locked in this file** — say the word if you want a specific choice confirmed here

**Why:** wanted landed before going online, while switching vendors is still cheap.

**Effort:** Medium
**Depends on:** None
**Blocker:** None
**Status:** Not started

---

### **Big flow test**

**Current state:** Not run. Scope fully designed.

**Scope — one real end-to-end pass, not a scripted check:**
- Import a real agent file
- Manually edit it in the structured view: add/edit/remove a section; add/edit/remove a tool or config value
- Edit the same agent via chat: a section edit and a config edit, reviewing the proposal card, the lock, and the applied result
- Export the edited agent and reimport it, confirming the round trip holds

Also exercises Prometheus's end-to-end verification against a real reply, which has never
actually been run — the chat stage here needs the same real, billed Anthropic calls anyway.
Anything the test finds gets fixed inline or spun into its own item — the point is to find
gaps before real users do, not to gate the test on being bug-free beforehand.

**Effort:** Small (1–2 hours, manual)
**Depends on:** Every other TODO item above
**Blocker:** Needs your OK to spend real Anthropic money first (standing rule 2)
**Status:** Ready to run

---

### **Company branding on the platform**

**Current state:** Design reviewed against your own rubric — footer placement (primary) plus
a quiet login/signup line (secondary) recommended. Footer already prototyped in
`Layout-Workbench.html` with demo-only "ACME Corp" content.

**Scope:**
- Real company name/logo/copyright line/tagline
- Login/signup line placement isn't prototyped yet
- No placeholder branding goes into real code — a real viewer seeing demo branding reads worse than seeing nothing

**Effort:** Small, once assets exist
**Depends on:** None
**Blocker:** Your actual brand assets/copy — nothing else here can start without them
**Status:** Blocked on you

---

### **First-login guided tour (mini-tour)**

**Current state:** Prototyped in `Layout-Workbench.html`, verified in-browser (Chrome, both
themes, all steps position correctly, no console errors). Replaces a separate pre-login
landing page for this launch (see NEXT).

**Scope:**
- Spotlight/dim-panel mechanism — no new dependency, `WorkbenchShell`'s 4 panels are fixed regions
- Seven steps: welcome, then the core loop — Library (import), Custom Visualization (edit
  direct), Chat (edit via AI), the proposal's before/after comparison, Apply, Export (Raw
  panel's Download)
- Skippable per-step (Exit) and to finish (Next → "Finish ✓" on the last step); re-runnable
  via the topbar's "ⓘ Guided tour" button; a persisted "seen" flag (`localStorage`,
  `myagent_tour_seen`)
- Prototyped in `Layout-Workbench.html` first (standing rule 4)

**Effort:** Medium (a session or two)
**Depends on:** None
**Status:** Prototyped — copy drafted but not signed off; port into the real app next

---

### **"Experimental — don't paste sensitive data" disclaimer**

**Current state:** No disclaimer exists anywhere in the signup/login flow.

**Scope:**
- One sentence — placement TBD (signup form, a banner, or folded into the existing `ConsentPopup.tsx`)

**Why:** real risk-reduction given compliance-grade logging isn't built (see NEXT).

**Effort:** Trivial
**Depends on:** None
**Status:** Not started

---

### **Production DB backup/restore**

**Current state:** No ongoing backup exists — every "backup" reference in the repo today is a
one-time safety copy taken before a risky migration, not a repeatable procedure.

**Scope:**
- Document how to snapshot the live SQLite file and restore it, somewhere findable
- No code required unless the eventual hosting target makes this non-trivial

**Effort:** Small, mostly documentation
**Depends on:** None
**Status:** Not started

---

### **Deploy online**

**Current state:** App runs locally only.

**Scope:**
- Whatever the smallest real hosting step is — get a version reachable outside the local network
- The *automated* version of this (CI/CD) is a separate FUTURE item, not required for this first deploy

**Effort:** Depends on the hosting choice
**Depends on:** All other TODO items
**Status:** Not started — always last

---

## NEXT — first priorities once v1 is online

Decided and scoped, deliberately deferred to right after launch. **Component/UI test
coverage** is what gets picked up first once v1 is live, per your explicit call; the rest of
this bucket is free to reorder.

### Overview

| Item | Status |
|---|---|
| **Component/UI test coverage** | Not started — first thing once v1 is live |
| **AI chat persistence** | Not started — needs an approach decision |
| **Settings page — sidebar layout + Activity log User column** | Not started |
| **Validate `SESSION_TTL_SECONDS` live behavior** | Not started — just needs to be run |
| **Strict-mode merged-heading re-audit** | Not started — low risk |
| **Export translation to other platforms** | Not started |
| **Display-label lookup for `model`** | Not started — low priority |
| **`AgentSnapshot(kind:'export')` diff-view UI** | Not started — ready to scope |
| **AI-assisted config-key mapping** | Not started |
| **Log retention / pruning / pagination** | Not started |
| **Cost estimation in currency on log rows** | Not started |
| **Compliance-grade (non-droppable) logging** | Undecided if wanted |
| **Pre-login landing page for prospective users** | Mockup done, Terms/Privacy pages + browser check left |
| **Improve the guided tour** | Not started — depends on the MVP tour shipping first |
| **Optional call-log persistence toggle** | Undecided if wanted |
| **MCP server exposing MyAgent's agents** | Undecided if wanted |
| **Re-enable group behavior** | Ready — three flag flips |
| **Surface `applied`/`skipped` from apply-proposal in the UI** | Not started |
| **`AgentView.tsx` save-name bypasses `apiFetch`** | Ready — trivial fix |
| **Validation flag for malformed `name`/`description` on import** | Not started |
| **Wire `AgentDTO.validation` into the UI** | Not started |
| **Wiring a declared model for Prometheus** | Not started |

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

### **Settings page — sidebar layout + Activity log User column**

**Current state:** `/settings` is one long stacked page (Settings/General, Invite codes,
Activity log), no navigation chrome.

**Scope — two parts:**
- Activity log table needs a **User** column — resolve `userId` → email in `listCallLogs` / `GET /api/llm-call-log`, render it. Minimum scope: just the column, no filters yet.
- Restructure `/settings` into a sidebar-navigated layout (same three sections, each its own pane) — Claude.ai's own Settings modal is the visual reference

**Effort:** Medium — the layout half needs a `Layout-Workbench.html` prototype first (standing rule 4)
**Status:** Not started

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

### **Pre-login landing page for prospective (non-signed-up) users**

**Current state:** A real public-facing explainer page shown before login, for visitors who
don't have an account yet — a different audience than the first-login guided tour (TODO),
which only signed-up users ever see.

**Scope:** Format/production undecided (video, screenshots, static copy) — the "we want
this" part is settled; timing-wise wanted soon after launch, not before. The tour's welcome
step covers the "why" well enough for this launch's small, invited audience.

**Mockup:** Done — `architecture/layout/Layout-Landing.html` (hero, walkthrough card, feats
grid, wave roadmap timeline, footer). Still needed before it ships: Terms/Privacy pages
(footer already links to `#terms`/`#privacy` placeholders) and a real-browser check that the
walkthrough card's "⤢ Full view" button label renders and never wraps/clips (light/dark, at
110% zoom).

**Effort:** Medium
**Status:** Mockup done, real-build items open (see `plans/12-ui-batch-launch-polish.md`)

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

### **MCP server exposing MyAgent's agents**

**Current state:** Not decided if wanted (see IDEA).

**Scope:** An MCP server so Claude (Claude Code, Claude Desktop, etc.) could access/update a
user's agents outside the web UI. Needs its own auth story (an MCP client isn't a browser
session) and raises the same guardrail questions the chat mediator already answers, for a
client the platform doesn't control the prompt of.

**Effort:** Large, if built
**Status:** Undecided if wanted

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
| **Storage target dialect (Postgres vs. Azure SQL)** | At the hosting-choice trigger (Deploy online) |
| **Catalog evolution** | Once catalog-versioning infrastructure exists |
| **`ConfigDef` platform-scoping** | When a second platform's import/create is built |
| **"Replay this request" from a dry-run log row** | If manual re-running becomes a papercut |
| **Dedicated group-management view** | Not researched |
| **CI/CD** | After the first manual deploy |
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
| **Per-user view of the activity log** | When a user asks about their own costs |
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
Two NEXT items (**Optional call-log persistence toggle**, **MCP server exposing MyAgent's
agents**) are timed but still genuinely undecided-if — that's why they say "(see IDEA)": this
paragraph is the note, not a separate per-item entry. This bucket is otherwise currently
empty of *new*, untriaged ideas — log fresh ones here as they come up.

---

## Reference

- **`plans/archive/`** — completed plans 01–10, kept for history.
- **`CLAUDE.md`** — standing project rules and folder map.
- **`docs/roadmap.md`** — the friendly, capability-only public roadmap.
- **`CHANGELOG.md`** — project history by date.
- **`docs/system-about.md`** — current-state engineering reference.
