# Plan 15 — Share Agent

> **Status: 🟢 Shipped 2026-08-31 — all §6 steps (0–11) done and merged (PR #28).**
> `npx tsc --noEmit` and the full test suite (74 files / 1002 tests) both passed clean.
> Steps 9's canvas-redesign iteration, all of step 10's React work, and step 11's docs pass
> are committed (`b8c0acf`) and merged to `master`. What's still open: no real browser QA
> pass beyond the user's own live manual testing during the build session (which caught and
> fixed several real issues — see the step 9/10 rows below) — see `plans/roadmap.md` if a
> dedicated QA pass gets scoped separately. **Archived 2026-08-31** — moved to
> `plans/archive/`; every code comment across `lib/` and `app/` citing it by path (there were
> 16 files) was updated in the same pass to `plans/archive/15-share-agent.md`, per `CLAUDE.md`
> standing rule 7. Concretely: `b07e914` shipped
> the full backend (steps 1–8c: schema, `agentShares.ts`, `shareCode.ts`, the viewer-scoped
> reads, all six API routes, `copyAgentForOwner`, the §5.5 tenancy regression suite, the §4.10
> fitness functions, `exportAgentMarkdownForViewer`, and the MCP share-visibility change) and
> `04f10d7` shipped the D1-required `AgentView.tsx` structural refactor (step 8.5, producing
> `ConfigZone`/`SectionsZone`/`ModelEffortControl` — **not** an `AccessZone`, see below). §6
> step 9's mockup-first UI pass is done in `reference/layout/Layout-Workbench.html`: dispatch 2
> (Owner Access) grew, via a 2026-08-31 layout debate and a Claude Design canvas review, from
> "a third zone in `AgentView`" into a wholly different placement — **the `Share` tab of a new
> two-tab right-panel dock (`Raw` \| `Share`)**, replacing the single-purpose Raw panel, with
> real editor-tab styling and inline SVG icons throughout. That redesign was ported
> into real code, now committed: `RightDockPanel.tsx` (the dock + tab strip) and `AccessZone.tsx`
> (the `Share` tab, wired live to all four owner-facing routes) now replace the old Raw `Panel`
> in `WorkbenchShell.tsx`, and `RawAgentView.tsx`'s toolbar icons were restyled to match — this
> was the first slice of step 10; the rest followed in the same session, also committed:
> `LibraryPanel`'s "Shared with me" section + redeem action row, `AgentListItem`'s read-only
> variant, `RedeemShareDialog`, `SharedAgentView` (the recipient's read-only card — Copy-to-me
> + Export), and the `app/agents/[id]/page.tsx` / `app/page.tsx` viewer-scoped wiring —
> `WorkbenchShell` now branches its whole layout on `access`, dropping Chat and the right dock
> entirely for a shared viewer. `npx tsc --noEmit` and the full test suite passed clean
> before commit; the still-open gap is a real browser QA pass beyond the user's own manual
> testing during the build session. Step 11 (docs) is done: `system-about.md`,
> `user-guide.md`, both roadmaps, `lib/db` and `lib/mcp` `CLAUDE.md`, and the privacy policy
> were all updated in the same commit.
> Four resolutions diverge from
> this document's own baked-in recommendations and add real scope beyond the original draft —
> each is called out inline at its D-item in §8, in the affected §4/§6 sections, and in §4.11's
> files table:
> - **D1 (read-only view):** a full structural refactor of `AgentView.tsx` (1899 lines → per-zone
>   sub-components) was a prerequisite step (§6 step 8.5) before `SharedAgentView` is built, not
>   just "build it as a separate component." The Access zone ended up **not** being one of
>   `AgentView`'s post-refactor pieces at all — a later layout debate (2026-08-31) relocated it
>   to the right-panel dock's `Share` tab instead; see §8 D1's "Refactor sequence" note.
> - **D3 (copy source):** a new `'copied'` value is added to the `agent.source` enum (and
>   `section_revision.author`), not left as `'imported'`.
> - **D7 (share cap):** no per-agent cap — the `409 too_many_shares` error path is removed
>   entirely from §4.5/§4.8.
> - **D8 (MCP visibility):** shared agents ARE exposed read-only over MCP in this plan (§6 step
>   8c) — the original draft explicitly recommended against this as "a plan-sized change of its
>   own"; that recommendation was overridden deliberately.
>
> D2 (export: yes), D4 (no rate limit), D6 (keep both columns), and D9 (idempotent enable) match
> the document's original recommendations with no scope change.
>
> Unlike Plan 14, the **core design here is
> already settled** — it was worked out with the user in conversation before this document was
> written, and §1–§7 record it rather than propose it. §8's items (D1–D9) are **judgment calls
> this document already made**, each with a recommendation and reasoning, that want a yes/no
> before the phase they touch — **none of them blocks starting Phase 1**, and none of them
> requires the user to do out-of-band account/DNS work the way Plan 14's D1/D2 do.
>
> **The scoping question the roadmap item raised is answered: this plan builds *both*.**
> `plans/roadmap.md`'s **Share agent** entry says "sharing-with-edit-access (both people work
> on the same underlying agent) and copying (each person gets an independent fork) are
> genuinely different things — decide explicitly which one(s) this actually builds." The
> decision is: **live read-only shared access** (the recipient always sees the owner's current
> agent, never a stale copy) **plus a "Copy to me" button** that produces an independent fork.
> **Shared-with-edit-access is explicitly NOT built** (§9) — a recipient can never mutate the
> owner's agent, and that is enforced structurally, not by a UI flag (§3 constraint 1).
>
> **Scale note — Medium, and mostly plumbing.** One new table, two new nullable columns, one
> new credential generator, six new routes, one new deterministic copy function, and a new UI
> surface on three screens. **Zero third-party dependencies, zero new env vars, zero AI calls,
> zero cost to run or verify** — every phase is fully testable offline with the existing
> in-memory-DB test harness. There is no equivalent of Plan 14's §5.6 "live verification, ask
> first" step, because nothing in this plan touches a network.
>
> Standing project rules apply in full: **no commit without an explicit ask**, **no real billed
> API call without an explicit ask**, **dev server off after any verification session**, and
> **ask before running any test/build/tsc check** (`CLAUDE.md` standing rules 1, 2, 3, 5). UI
> work prototypes in `reference/layout/Layout-Workbench.html` first (standing rule 4) — §4.9
> marks exactly which parts that applies to and how to dispatch them.
>
> Addresses `plans/roadmap.md` NEXT item **Share agent**. Touches, but does not build, two
> other roadmap items — **Delete or disconnect user (admin)** and **Review group behavior**
> (§10).

---

## 1. What this plan is, in one paragraph

Today an agent is reachable by exactly one person: `agent.ownerId`, applied in the same SQL
statement as every read and every write, with no second path anywhere in the codebase. This
plan adds **one** second path — a read-only one — so an owner can hand an agent to someone
else. Access is granted two ways that produce an identical outcome: the owner generates a
**public code** (a bearer credential stored on the agent row, reusable and indefinite until
the owner disables it) which the recipient pastes into the app, or the owner types a
**recipient's email address** directly. Both write the same row into one new join table keyed
by `(agentId, recipientEmail)`, so a single query — "every agent where a share row's email
equals my account's email" — covers both mechanisms with no branching. The recipient sees a
**live reference**, not a snapshot: the shared view always reflects the owner's current state,
and updates for the recipient from whenever an account with that email exists and loads its
library. The only mutation a recipient can perform is **"Copy to me"**, which forks an
independent agent into their own library.

**The one rule that shapes every other decision in this document:** the recipient's access is
read-only because *no code path exists that could make it otherwise*. Every mutating repository
function keeps its required, never-defaulted `ownerId` parameter, unchanged, and this plan adds
zero share-awareness to any of them. A shared agent therefore cannot be edited, chatted about,
re-imported over, deleted, or grouped by its recipient — not because a flag says so, but
because `updateSectionContent(agentId, sectionId, ownerId, …)` will not find the row. Read-only
is an architectural property here, not a permission check that a future refactor can forget.

---

## 2. Current state (verified by reading the code this session, 2026-08-27)

| Fact | Where | Note |
|---|---|---|
| **The tenant *is* the user. There is no organization, workspace, or tenant entity anywhere in the schema.** | `lib/db/schema.ts` (whole file) | `agent.ownerId`, `group.ownerId`, `apiToken.ownerId` are all soft refs to `user.id`. No table groups users. §4.1 explains what this means for the share table. |
| The session carries no tenant claim | `lib/auth/session.ts` | `Session = { userId, email, role }`. `email` is documented "for display only, not authoritative"; `role` is re-read from the DB every call. |
| "Multi-tenancy" in this codebase means **per-user isolation** | `docs/system-about.md` §10, `app/api/__tests__/tenancy.test.ts` header ("Two regular users (A and B)") | The crown-jewel isolation test is user-vs-user. There is no intra-tenant/cross-tenant distinction to design around — **every share is user-to-user by definition**. |
| Every owned-row repository function takes a required, never-defaulted `ownerId` applied in the same statement | `lib/db/CLAUDE.md`, `lib/db/repository/agents.ts` (all of `getAgentFull`, `updateAgent`, `updateSectionContent`, `addSection`, `deleteSection`, `deleteAgent`, `exportAgentMarkdown`, `upsertAgentFromImport`, `getAgentSnapshotInfo`) | "There's no function that could accidentally return another user's data." This plan **adds a sibling read function rather than widening any of these** (§4.4). |
| **No agent-duplication / fork / copy mechanism exists.** | `lib/db/repository/agents.ts` — read in full; no copy/duplicate/fork function | The finding that shapes §4.6. Nothing to reuse; something has to be built. |
| **Both import modes require a real Anthropic call.** | `lib/import/CLAUDE.md` | Stage 2 Strict = `callHermes`, Stage 2b Structural = `callDaedalus`. Routing a copy through the import pipeline would spend the user's money reconstructing data the database already holds in exact structured form — and would trip `CLAUDE.md` standing rule 2 on every click. |
| The nearest deterministic pair (`exportAgentMarkdown()` → `parse()`) is **lossy** | `lib/serialize/importParse.ts`, `lib/import/assembleStructural.ts` | Stage 1 `parse()` splits headings; it does **not** assign `sectionKey`. Recovering keys needs `assembleStructural`'s exact-heading-match against the catalog, which fails for any section whose heading was edited away from its `defaultHeading` — a routine live state (`lib/db/schema.ts` notes "Guardrails"/"# RULES" coexisting on the same row). A markdown round trip would silently downgrade sections to `'custom'`. |
| `upsertAgentFromImport()` already owns three write invariants worth reusing | `lib/db/repository/agents.ts` | Every section gets a `section_revision`; config rows are written in one transaction; a `post-import` `agent_snapshot` is always written. §4.6 delegates to it rather than hand-writing a second writer that could drift. |
| **`upsertAgentFromImport()` does update-in-place on a name collision** — "never a duplicate, never an error" | same file, function doc comment | Correct for import; **actively dangerous for a copy** — it would silently overwrite the recipient's own unrelated agent that happens to share a name. §4.6 pre-checks and refuses instead. |
| Agent names are unique **per owner**, not globally | `agent_owner_name_unique` on `(ownerId, name)` | So a copy can collide with something the recipient already owns. Handled in §4.6. |
| `NameExistsError` → `409 name_exists` is the established collision contract | `createAgent`, `updateAgent`, `app/api/agents/route.ts` | Reused verbatim by the copy route — no new error vocabulary. |
| `deleteAgent()` already deletes `membership` rows, on the stated grounds that they are "a pure index, not historical" | `lib/db/repository/agents.ts` | The same reasoning applies to a share row. §4.2 adds it to the same transaction. |
| Two established credential generators, with opposite storage rules and documented reasoning | `lib/auth/inviteCode.ts` (plaintext, human alphabet, re-readable so the admin can resend), `lib/auth/apiToken.ts` (SHA-256 hashed, machine alphabet, never re-readable) | The share code is a **third point on that spectrum** and §4.3 places it explicitly. |
| Email normalization is `email.trim().toLowerCase()` and validation is `includes('@')` — deliberately minimal | `app/api/auth/signup/route.ts:62`, `app/api/auth/request-access/route.ts:66-67` | Already duplicated across two routes. `user.email` is stored "lowercased + trimmed" per `schema.ts`. Matched exactly in §4.5. |
| **There is no email-change path.** | `app/api/account/route.ts` — PATCH accepts only `shareLogsWithAdmin` | So an email is a stable join key today. The consequences if that ever changes are in §7 risk 4. |
| The app **deliberately never discloses whether an email has an account** | `app/api/auth/request-access/route.ts` (identical body on every branch), `lib/auth/mcpGuard.ts` (unknown/revoked/expired all collapse to one `401`) | §3 constraint 6 keeps this true — it is the reason the owner's share list must **not** show a "has an account" indicator. |
| Rate limiting has an arbitrary-key primitive, already used for non-IP identities | `lib/auth/rateLimit.ts` `checkRateLimitByKey(key)`, used by `mcpGuard.ts` as `('mcp', tokenId)` | Available in one line for the redeem endpoint (D4). |
| Guard fitness already covers new routes for free | `app/api/__tests__/route-guard.test.ts` | Any new `route.ts` under `app/api/agents/**` must contain `authenticate(` or the suite fails. No new guard rule needed. |
| Per-subsystem "sole owner of a table" is an existing, stated convention | `lib/db/CLAUDE.md` on `apiTokens.ts` ("The only file that touches this table") | §4.9 turns it into an assertion for `agent_share`. |
| A per-user cap with a typed error is the established bounding pattern | `createApiToken()` — cap of 10 active tokens, `TooManyTokensError` | Reused shape for the per-agent share cap (D7). |
| MCP reads exclusively through the owner-scoped functions | `lib/mcp/CLAUDE.md` — `list_agents`→`listAgents(ownerId)`, `get_agent`→`getAgentFull(id, ownerId)`, `pull_agent`→`exportAgentMarkdown(id, ownerId)` | Because this plan leaves all three untouched, **shared agents are invisible over MCP by construction** (D8). |
| The agent detail page is one Server Component doing an owner-scoped read then `notFound()` | `app/agents/[id]/page.tsx` | The single place that has to learn about shared access (§4.7). |
| `AgentView.tsx` is 1899 lines with two zone blocks (`[Config] Keys`, `[Sections] Body`) ending at the component's close | `app/components/CustomViz/AgentView.tsx:1792-1897` | A third `[Share] Access` zone slots in after Zone 2 with the identical label pattern. Its size is also why D1 recommends **not** threading a `readOnly` prop through it. |
| `LibraryPanel` renders the owned list, then a `Manage` zone-label separator, then action rows (`+ New agent`, `+ New group` (flag-off), `⇪ Import agent`) | `app/components/Library/LibraryPanel.tsx:217-325` | Both new library surfaces (a "Shared with me" section and a redeem action row) have an exact existing pattern to follow. |
| `AgentListItem` hard-codes a delete button and a group-remove `×` | `app/components/Library/AgentListItem.tsx` | Needs a read-only variant for shared rows (§4.9). |
| Migrations run `0000`–`0008`; `drizzle-kit` generates the filenames | `lib/db/migrations/` | This plan added the next one, shipped as `0009_share_agent.sql` — **Plan 14 also claimed `0009`; that claim is now stale, since this plan landed first**; see §7 risk 5. |
| A hand-written migration missing its journal entry was a real bug found during Plan 13 | `plans/archive/13-mcp-server-exposing-agents.md`, restated in `plans/14-email-sending-provider.md` §4.1 | Verify `lib/db/migrations/meta/` is updated with the new migration. |
| `plans/roadmap.md`'s own summary of this item will be **wrong** on ship | roadmap Overview row: *"Hand an agent to another user to fork their own copy"* | That describes only half of what gets built. §10 lists the doc edits. |

---

## 3. Guiding constraints (locked — do not replan during build)

1. **Read-only is structural, never a flag.** Not one existing mutating repository function
   gains share awareness. `updateAgent`, `updateSectionContent`, `addSection`, `deleteSection`,
   `deleteAgent`, `upsertAgentFromImport`, and `exportAgentMarkdown` keep their required
   `ownerId` parameter and their current bodies. A recipient's inability to edit is therefore a
   property of the call graph, and §5.5's regression suite is what keeps it one.
2. **`getAgentFull(agentId, ownerId)` and `listAgents(ownerId)` are not modified.** The shared
   read is a **separate, differently named function** (§4.4). Widening either of the existing
   two would silently change what MCP returns, what `/api/chat` accepts, what the group logic
   iterates, and what every existing test asserts — all at once, invisibly.
3. **Email is the join key, everywhere, for both mechanisms.** A share row never stores a
   `userId`, not even when the recipient demonstrably has an account at redeem time. Storing
   one would create a second identity path to reconcile and would break the "share before they
   sign up" case that the email flow exists for.
4. **The viewer's email is resolved inside the query, never passed in by the caller.** Every
   share-aware repository function takes a `viewerId` (a `user.id`) and joins `user` to obtain
   the email in SQL. No authorization decision anywhere reads `session.email` — which keeps
   `lib/auth/session.ts`'s stated rule ("`email` — for display only, not authoritative") true
   rather than quietly obsolete.
5. **Disabling the link and removing a person are two separate actions that never imply each
   other.** Nulling `agent.publicCode` stops *new* redemptions and touches no share row.
   Deleting one share row revokes one person and touches no code. This is the Google Docs
   model, and it is the design as agreed — do not "simplify" it into one Make Private button.
6. **Nothing in this feature may disclose whether an email address has an account.** The
   owner's share list shows addresses and grant dates, never an account-exists indicator; the
   redeem endpoint returns a byte-identical body for an unknown code and a disabled code. The
   app already holds this posture in `request-access` and `mcpGuard` and this plan does not
   break it to add a convenience.
7. **The public code is a bearer credential with 256 bits of entropy and nothing else backing
   it** — no expiry, no email binding, no single use. Entropy is therefore the *only* defense
   against guessing, and the format is non-negotiable: it must be generated from
   `crypto.randomBytes`, never from a short or human-readable alphabet. It is stored plaintext
   because the owner must be able to re-read it forever (§4.3).
8. **Zero AI calls on every path in this plan.** Copying reads structured rows and writes
   structured rows; it never round-trips through markdown and never reaches `lib/ai/` or
   `lib/import/`. Asserted by a fitness function (§4.9), not just intended.
9. **A copy is an independent agent with no back-reference in either direction.** No
   `copiedFrom` column, no provenance link, no update-my-copy action. The owner cannot see who
   copied; the recipient's copy does not track the original.
10. **Sharing is deployment-wide and admission-gated by what already exists.** Because the
    tenant is the user (§2), there is no boundary this feature has to respect other than
    "holds, or will hold, an account on this deployment" — which is already controlled by
    invite codes and `maxUsers`. No tenant column, no cross-tenant policy setting, no new
    admission concept.

---

## 4. Implementation shape

### 4.1 Tenancy scope — the answer, with evidence

**Finding: this app has no tenant above the user.** `lib/db/schema.ts` contains `user`,
`invite_code`, `access_request`, `agent`, `config_def`, `agent_config`, `section_def`,
`agent_section`, `section_revision`, `group`, `membership`, `setting`, `llm_call_log`,
`api_token`, `oauth_account`, `agent_snapshot` — and not one of them groups users together.
Every ownership column (`agent.ownerId`, `group.ownerId`, `apiToken.ownerId`) is a soft
reference to `user.id`. `Session` (`lib/auth/session.ts`) carries `{ userId, email, role }` and
no tenant claim. `docs/system-about.md` §10 describes admission as "every user gets their own
account… gated by a single-use invite code." `app/api/__tests__/tenancy.test.ts` — the file the
codebase itself calls "the crown jewel of the multi-tenant auth plan" — tests user A against
user B.

**Therefore:** the phrase "multi-tenant" in this codebase means *per-user isolation*, and
**every share is cross-tenant by definition**. There is no intra-tenant case to design
separately, no policy question of whether sharing may cross a boundary, and nothing for
`agent_share` to carry a `tenantId` for. The only boundary that exists is the deployment
itself — one SQLite file, one `user` table — and the only admission control is the one already
in place (invite codes + the `maxUsers` cap).

**What this materially changes in the design, versus a design that had assumed org tenants:**
no tenant column on `agent_share`; no tenant predicate in the redemption or library queries; no
"external sharing" setting; and — the consequence that actually matters — **an email row is a
standing claim on whoever eventually holds that address on this deployment**, since a row may
legitimately pre-date the account. That is exactly the agreed design's intent, and it is also
§7 risk 3 and risk 4.

### 4.2 Data model

Two nullable columns on `agent`, one new table. Both follow the schema file's stated
conventions: conservative column types, and **soft references with no Drizzle `references()`
cascade** — deletion cascades are handled explicitly in the repository so the pattern stays
uniform and visible in one place.

**`agent` — two new nullable columns (migration: two `ALTER TABLE ADD COLUMN`, no table
rebuild):**

| Column | Type | Notes |
|---|---|---|
| `public_code` | text, **nullable**, unique index | `NULL` = link sharing off. Format and storage rationale in §4.3. SQLite treats each `NULL` as distinct in a unique index, so "off" is not a collision — a plain `uniqueIndex` is correct and no partial index is needed. |
| `public_code_created_at` | integer timestamp, nullable | Set when the code is generated, cleared with it. Exists only so the owner's Access panel can say when the link was turned on — a fact that is otherwise unrecoverable. **D6** asks whether to keep it. |

Index: `agent_public_code_unique (public_code)` — both the uniqueness constraint and the
redemption lookup index.

**`agent_share` — new table.** Name is **singular**, matching every table in `schema.ts`
(`user`, `agent`, `membership`, `api_token`, `oauth_account`, …); the Drizzle export is
`agentShare`.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `crypto.randomUUID()`. A surrogate key rather than a composite `(agent_id, recipient_email)` PK — the uniqueness is enforced by the index below either way, and a surrogate id gives the revoke route a clean `DELETE /api/agents/[id]/shares/[shareId]` path **that keeps an email address out of a URL and therefore out of access logs**. Same shape as `api_token` (surrogate id + a unique index on the real key). |
| `agent_id` | text, not null | Soft ref → `agent.id`. No `references()`; the cascade is in `deleteAgent()` (below). |
| `recipient_email` | text, not null | Stored **lowercased + trimmed**, identical to `user.email`'s stated normalization. Never resolved to a `user.id` (constraint 3). |
| `granted_via` | text, not null | `'email'` \| `'code'` — how this row came to exist. Plain `text`, not a Drizzle enum, matching `agent.platform`'s open-catalog convention. Display-only: the owner's panel says "you added them" vs. "redeemed the link". **D6** asks whether to keep it. |
| `created_at` | integer timestamp | Default `unixepoch()`. |

Indexes:

- `agent_share_agent_email_unique (agent_id, recipient_email)` — **the idempotency
  constraint.** Redeeming the same code twice, or redeeming a code for an agent the redeemer
  already has direct-email access to, hits this and is turned into a no-op that returns the
  existing row (§4.5). Its leading column also serves every `WHERE agent_id = ?` lookup, so no
  separate agent index is needed.
- `agent_share_email_idx (recipient_email)` — the library query, run on **every** page load for
  every user. The hottest query this plan adds.

**Deliberately not columns**, each for a stated reason:

- `recipient_user_id` — constraint 3. It would break the share-before-signup case that the
  email flow exists for.
- `granted_by` — derivable from `agent.ownerId`; a second copy of one fact that can drift.
- `expires_at`, `accepted_at`, `status` — the agreed design has no expiry and no accept/hold
  step. Adding an unused lifecycle column invites a future session to invent semantics for it.
- `role` / `permission` — there is exactly one access level (read), by design (§9).

**Cascade — a required change, not a nicety.** `deleteAgent()` must delete the agent's
`agent_share` rows inside its existing transaction, alongside the `membership` delete it
already does and for the identical stated reason: a share row is a pure access index, not
history, so it must not outlive its agent the way `section_revision` and `agent_snapshot`
deliberately do. Clearing `public_code` is implicit — the row is gone.

**Existing data:** nothing is affected and nothing is backfilled. Every existing agent gets
`public_code = NULL` and has no `agent_share` rows, which is exactly today's behavior: no
agent is shared, no library gains an entry, no existing query returns anything different.

### 4.3 The public code (`lib/auth/shareCode.ts`)

**Format:** `'shr_'` + 43 base64url characters from 32 `crypto.randomBytes` — 47 characters
total, byte-for-byte the shape `generateApiToken()` produces, minus the hashing. The `shr_`
prefix is a courtesy to secret scanners and to a human eyeballing a pasted string, not a
security property (the same thing `apiToken.ts` says about `mya_`).

**Storage: plaintext, deliberately.** This is the third point on a spectrum the codebase has
already reasoned about twice, and the file must say so in its own words rather than cite a
neighbor:

- `inviteCode.ts` stores plaintext with a human-readable, ambiguity-free alphabet **because a
  human types it out of an email and the admin must be able to re-read and resend it.**
- `apiToken.ts` stores a SHA-256 hash **because the plaintext must never be re-readable by
  anyone, including the admin.**
- A share code takes the **storage** rule from the first (the owner must be able to re-open the
  Access panel next week and copy the link again — that *is* the feature) and the **entropy**
  rule from the second (it is machine-copied and pasted, never hand-typed, so there is no
  reason to sacrifice a single bit for legibility). Nothing else backs it — no expiry, no
  single-use, no email binding, and per D4 possibly no rate limit — so 256 bits of entropy is
  the entire defense, and a shorter human-friendly code would be a real vulnerability rather
  than a convenience.

**Module placement:** `lib/auth/shareCode.ts`, next to its two siblings, with no `server-only`
guard and no secrets — pure computation, directly testable, matching both of them. `lib/auth/`
is described as "everything that establishes and checks who's making a request", and a bearer
capability is a defensible fit (an invite code is admission, not authentication, and lives
there already). The alternative — a new `lib/share/` folder for one 20-line file — is noted in
D-land but not recommended.

**Collision handling:** a `UNIQUE` failure on insert regenerates, up to 3 attempts, then
throws — the exact retry shape `inviteCode.ts` uses. At 256 bits this branch will never fire in
practice; it exists so that if it somehow does, the result is a retry rather than a `500`.

### 4.4 The share-aware read path — two new functions, zero modified ones

New repository file **`lib/db/repository/agentShares.ts`** owns the `agent_share` table
outright (the "only file that touches this table" convention `apiTokens.ts` already holds).
The two **read** functions below are the exception: they read `agent` rows and therefore belong
in `agents.ts` next to `getAgentFull`/`listAgents`, so that all agent reads stay in one file and
the contrast between owner-scoped and viewer-scoped is visible side by side.

```ts
// lib/db/repository/agents.ts — NEW, sits directly below getAgentFull()

/** Owner OR share-holder. Returns which one, so callers can branch on it explicitly. */
getAgentFullForViewer(agentId: string, viewerId: string):
  { agent: AgentDTO; access: 'owner' | 'shared' } | null

/** Agents shared WITH this viewer. Never includes agents they own. */
listSharedWithViewer(viewerId: string): SharedAgentLiteDTO[]
```

`SharedAgentLiteDTO` = `AgentLiteDTO` minus `groupIds` (groups are owner-scoped; a shared agent
is in none of the viewer's groups and never can be), plus `ownerEmail: string` so the library
row can say who shared it. Showing the owner's address to the recipient is safe and intended —
the owner deliberately granted them access; this is not the account-existence oracle constraint
6 forbids, which is about *probing* addresses.

The access predicate, in both functions, is one SQL expression:

```
agent.owner_id = :viewerId
OR EXISTS (
  SELECT 1 FROM agent_share s
  JOIN user u ON u.email = s.recipient_email
  WHERE s.agent_id = agent.id AND u.id = :viewerId
)
```

The `JOIN user … ON u.id = :viewerId` is constraint 4 made concrete: the caller supplies a user
id, and the email that grants access is resolved by the database from the authoritative `user`
row. No route, component, or repository function ever passes an email in for an authorization
decision.

**Why a separate function instead of an optional flag on `getAgentFull`.** An
`includeShared = false` parameter would put every existing caller one wrong default away from
leaking, and the wrong default is the one that reads most naturally at a call site. A distinct
name means the owner-scoped function's ~30 call sites keep their exact current behavior with no
review, and every new share-aware call site is greppable.

**What this leaves untouched, and therefore correct for free — worth stating so nobody "fixes"
it later:**

- ~~**MCP.** `list_agents`, `get_agent`, and `pull_agent` call `listAgents(ownerId)` /
  `getAgentFull(id, ownerId)` / `exportAgentMarkdown(id, ownerId)`. Shared agents are invisible
  over MCP with no MCP code changed.~~ **Stale — D8 resolved 2026-08-29 to fold MCP visibility
  into this plan.** These three tools now DO need to change, to the viewer-scoped functions —
  see §6 step 8c and §8's D8 resolution. Struck rather than deleted so the reversal is visible.
- **Chat.** `/api/chat` resolves its agent owner-scoped, so a recipient asking Prometheus to
  edit a shared agent gets the existing `404`. No new gate needed.
- **Apply-proposal, sections, groups, delete, import.** Same — all already `404` for a
  non-owner, and §5.5 asserts a share-holder is still a non-owner to every one of them.
- **Export.** Also owner-scoped today, which means a recipient cannot download the `.md`. That
  may or may not be wanted — **D2**.

### 4.5 API surface

All six routes live under `app/api/agents/**`, so `app/api/__tests__/route-guard.test.ts`'s
generic rule ("every non-auth, non-mcp `route.ts` contains `authenticate(`") covers them
automatically — no new guard rule and no new bucket in that fitness table.

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET` | `/api/agents/[id]/shares` | owner only | — | `{ publicCode: string \| null, publicCodeCreatedAt: string \| null, shares: [{ id, recipientEmail, grantedVia, createdAt }] }` | `401`, `404` (not found **or** not owned — indistinguishable, matching every other agent route) |
| `POST` | `/api/agents/[id]/share-link` | owner only | — | `200 { publicCode, publicCodeCreatedAt }` | `401`, `404` |
| `DELETE` | `/api/agents/[id]/share-link` | owner only | — | `200 { publicCode: null }` | `401`, `404` |
| `POST` | `/api/agents/[id]/shares` | owner only | `{ recipientEmail: string }` | `200 { id, recipientEmail, grantedVia:'email', createdAt }` | `401`, `404`, `400 invalid_email`, `400 cannot_share_with_self` (no cap error — **D7 resolved: no cap**) |
| `DELETE` | `/api/agents/[id]/shares/[shareId]` | owner only | — | `204` | `401`, `404` |
| `POST` | `/api/agents/redeem` | any session | `{ code: string }` | `200 { agentId, agentName, access: 'shared' \| 'owner', alreadyHadAccess: boolean }` | `401`, `400 invalid_body`, `404 invalid_code` (no `429` — **D4 resolved: no rate limit**) |
| `POST` | `/api/agents/[id]/copy` | share-holder in practice — owner gets `400` (see §4.6) | `{ name?: string }` | `201 AgentDTO` (the new copy, `source:'copied'` — **D3 resolved**) | `401`, `404`, `400 cannot_copy_own_agent` (added during implementation, §4.6), `409 name_exists` |
| `GET` | `/api/agents/[id]/export` | owner **or** share-holder (**D2 resolved: yes**) | — | `.md` text via `exportAgentMarkdownForViewer` | `401`, `404` |

Route-level rules, each of which is a real requirement:

- **`POST /api/agents/[id]/share-link` is idempotent-enable, not rotate.** If a code already
  exists it is returned unchanged; only a `DELETE` then a fresh `POST` produces a new one.
  **D9.** Note the security property this gives: because disable nulls the column, a
  re-enable **never resurrects the old code** — a leaked link is dead the moment it is
  disabled, permanently.
- **`POST /api/agents/[id]/shares` is idempotent-grant.** Re-adding an address that already has
  a row returns `200` with the existing row, not `409`. The unique index is the enforcement;
  the route reads the constraint failure and turns it into the existing row. Same posture the
  design requires for redemption, applied to the other grant path so the two behave alike.
- **Email handling copies the two existing routes verbatim:** `recipientEmail.trim()
  .toLowerCase()`, then `!normalizedEmail || !normalizedEmail.includes('@')` → `400`. Not
  stricter. This codebase's stated flag-don't-block posture means a valid-looking-but-wrong
  address is the user's problem to notice in the visible list, not the server's to guess at —
  and a stricter regex would reject real addresses. (The two-line snippet is now triplicated;
  extracting a helper is an optional trivial cleanup, explicitly not required by this plan.)
- **Self-share is a `400`, not a silent no-op.** Typing your own address is a user mistake with
  a confusing outcome (a row that grants you what you already have); say so.
- **`POST /api/agents/redeem` returns one identical body for every failure** — unknown code,
  well-formed-but-nonexistent code, and a code whose agent has since disabled its link all
  produce the same `404 { error: 'invalid_code' }`. Constraint 6. This is the same collapse
  `mcpGuard.ts` performs on unknown/revoked/expired tokens, and it is what stops the endpoint
  from being an oracle for which codes were ever valid.
- **Redeeming your own agent's code** writes no row (you already own it) and returns
  `{ access: 'owner', alreadyHadAccess: true }` so the UI just navigates. Redeeming a code you
  already hold a share for returns the same shape with `access: 'shared'`.
- **The redeem route never accepts an `agentId`** — only the code, which the server resolves.
  Accepting both would be an obvious confused-deputy hole.

### 4.6 "Copy to me" — what is reused, what is built, and why

> **Added during implementation, not in the original draft (2026-08-29):** the route's auth
> ("owner OR share-holder") means an owner CAN reach `copyAgentForOwner` on their own agent —
> but this plan never designs an owner-facing "Duplicate" feature (§4.9's Copy-to-me action
> lives only in the recipient's read-only `SharedAgentView`), so that was an accidental
> capability of reusing one access check for both viewer kinds. Left alone, omitting `newName`
> would always 409 `name_exists` (the default target name is the source's own name, which the
> owner already holds — the source itself), with no indication of *why*. **Now explicitly
> blocked:** `copyAgentForOwner` throws `CannotCopyOwnAgentError` → the route returns `400
> cannot_copy_own_agent` whenever `getAgentFullForViewer` resolves `access === 'owner'`, checked
> before the name pre-check so it fires even with an explicit, non-colliding name. This is robust
> across both grant mechanisms by construction, not just by the other guards happening to hold:
> `getAgentFullForViewer` checks true ownership (`agent.ownerId === viewerId`) **before** ever
> looking at `agent_share` rows, so it reports `'owner'` regardless of whether the owner also
> holds a redeemed code or an email grant for their own agent — and neither grant path can create
> such a row to begin with (constraint 6 on the shares route refuses `cannot_share_with_self`;
> the redeem route never writes a row when redeeming your own agent's code, see §4.5). Verified
> directly: a repository test throws via a plain `owner.id` call, and two route tests confirm the
> block still holds after redeeming the owner's own share-link code, and after a self-share row
> is (hypothetically, written directly to bypass the other guard) present.

**Investigated first, per the brief.** §2 records the finding: `lib/db/repository/agents.ts`
has no copy/duplicate/fork function; both import modes require a billed Anthropic call; and the
only deterministic round trip available (`exportAgentMarkdown()` → `parse()`) loses every
`sectionKey` that cannot be recovered by exact-heading match against the catalog. **There is no
existing mechanism to reuse for the read half. There is one to reuse for the write half, and
this plan uses it.**

New function, in `lib/db/repository/agents.ts` (already the only file allowed to touch
`agent`/`agent_config`/`agent_section`/`section_revision`/`agent_snapshot`):

```ts
copyAgentForOwner(
  sourceAgentId: string,
  viewerId: string,          // must be the source's owner OR a share-holder
  newName?: string,          // defaults to the source's name
): AgentDTO
```

Steps:

1. Resolve the source through **`getAgentFullForViewer(sourceAgentId, viewerId)`** — never a
   bare id lookup. No access, no copy; returns `null` → the route `404`s.
2. Pre-check the target name against **`getAgentSnapshotInfo(name, viewerId)`** (exists
   already, owner-scoped). A hit throws the existing `NameExistsError`.
3. Read the source's `agent` row, `agent_config` rows, and `agent_section` rows directly.
4. Build an **`ImportedAgentData`** (the already-exported type) with full fidelity: `name`,
   `description`, `platform`, `splitLevel`, `config` verbatim, and `sections` carrying
   `sectionKey`, `heading`, `content`, `order` **exactly as stored** — no reclassification, no
   heading matching, no AI. `rawSourceSnapshot` = `serializeAgentSnapshot(sourceRow,
   sourceSections)`, i.e. the exact export bytes at copy time.
5. Call **`upsertAgentFromImport(viewerId, data)`**.

**Why delegate to `upsertAgentFromImport` rather than insert rows directly.** It already owns
three invariants a second writer would have to re-implement and could drift from: every section
gets a `section_revision`, config rows are replaced inside one transaction, and a `post-import`
`agent_snapshot` is always written. This is the same call the MCP `push_agent` tool made and for
the same stated reason — `lib/mcp/CLAUDE.md` says it "composes the same building blocks…
rather than forking a thinner second import path," and that is why the snapshot trail applies
on the MCP path for free.

**Step 2 is not optional and is the whole reason this isn't a one-liner.**
`upsertAgentFromImport`'s documented contract is "a name collision with an existing agent is
always an update-in-place — never a duplicate, never an error." That is right for re-importing
your own file and catastrophic for copying someone else's: it would overwrite the recipient's
own unrelated agent that happens to share a name, destroying their sections. Copy therefore
pre-checks and **refuses** with `409 name_exists`, and the UI prompts for a different name and
re-POSTs with `{ name }`.

**No auto-suffixing** (`"analyst (copy)"`, `"analyst (copy 2)"`). `name` is the agent's own
identity field, written to frontmatter on export; silently rewriting it on the way in is exactly
what this codebase's flag-don't-block principle forbids (`docs/system-about.md` §3: nothing is
silently rewritten or refused on the way in). A visible prompt is both more honest and one click.

Accepted consequences, each flagged rather than hidden:

- The copy's `source` is `'imported'` (that is what `upsertAgentFromImport` writes) and its
  revisions carry `author: 'import'`, even though nothing was uploaded. **D3.**
- The copy is a point-in-time snapshot with no link to the original in either direction
  (constraint 9).
- Zero provider calls. §5.6 asserts this with a call-count of 0 on the fake provider — the
  cheapest possible proof, and the one that catches a future refactor routing copy through the
  import route "for consistency."

### 4.7 The page and the read-only view

`app/agents/[id]/page.tsx` swaps `getAgentFull(id, session.userId)` for
`getAgentFullForViewer(id, session.userId)` and branches:

- `null` → `notFound()` (unchanged).
- `access === 'owner'` → renders `WorkbenchShell` exactly as today, plus the new Access zone
  (§4.9).
- `access === 'shared'` → renders the **read-only shared view** (D1).

**The URL stays `/agents/[id]`** rather than a separate `/shared/[id]`. One canonical address
per agent means the link an owner pastes into chat is the same one they see themselves, and
nothing has to redirect based on who is looking.

`listSharedWithViewer(session.userId)` is called in the same server component (and in
`app/page.tsx`) and threaded to `LibraryPanel` as a new `sharedAgents` prop. Note the knock-on
in `app/page.tsx`: its zero-agents branch currently tests `agents.length === 0`; a user with no
agents of their own but one shared with them must not land in the empty state. The condition
becomes `agents.length === 0 && sharedAgents.length === 0`, and the "redirect to the first
agent" line should prefer an owned agent, falling back to a shared one.

### 4.8 Business rules, stated once

**Invariants (always true):**

1. A share-holder cannot mutate the shared agent by any route, tool, or repository function.
2. `(agentId, recipientEmail)` is unique; granting twice by any mechanism is a no-op.
3. `agent.publicCode` is unique across all agents when non-null; `NULL` means link sharing off.
4. `recipientEmail` is stored lowercased and trimmed, and is never resolved to a `userId`.
5. Deleting an agent deletes its share rows.
6. A copy is independent of its source in both directions, forever.
7. No response in this feature reveals whether an address has an account.
8. No path in this feature calls a model.

**Policies (tunable, but set here):**

9. ~~Max share rows per agent~~ — **D7 resolved: no cap.** Bounded only by owner effort.
10. ~~Shared agents are not exposed over MCP~~ — **D8 resolved: they ARE exposed over MCP**,
    read-only, via the same viewer-scoped functions the web routes use (§8 D8). `push_agent`
    still refuses to write a non-owned agent.
11. ~~Redeem is rate-limited per user~~ — **D4 resolved: no rate limit.** Entropy alone is the
    defense (constraint 7).

**State transitions:**

12. **Link:** `null` → `code` (enable) → `null` (disable) → `code` (re-enable). **D9 resolved:
    enable is idempotent** — re-enabling while a code already exists returns that same code
    unchanged; a *fresh* code is produced only by `DELETE` (disable) followed by a new `POST`
    (enable). There is no rotate-in-place step and no code history. (Corrects an internal
    inconsistency in the original draft, which said re-enabling generates a fresh code — §4.5's
    route rule and D9 always said idempotent; this line is now aligned with both.)
13. **Access:** none → granted (`'email'` or `'code'`) → revoked (row deleted). There is no
    pending, invited, or accepted state — by design, an email grant is live the instant it is
    written, and simply has no one to apply to until an account with that address exists.
14. **A share row outlives the recipient's session, their logout, and their non-existence.** It
    is granted against an address, not a person.

### 4.9 UI — three surfaces, all mockup-first

Per `CLAUDE.md` standing rule 4, each new visual concept is prototyped in
`reference/layout/Layout-Workbench.html` before any React work. Per that rule's dispatch
guidance: **one concept per dispatch**, and **explicitly waive the build-equivalent sanity
check** in the prompt — there is no compiler for that file, and the gate is a human looking at
it in a browser.

| Surface | Where | Mockup first? |
|---|---|---|
| **A. "Shared with me" library section** — its own zone-label separator below the owned list and above `Manage`, with a read-only row variant (no delete, no drag handle, no group `×`) showing a `shared` tag and the owner's email in place of the `imported`/`created` source tag. | `LibraryPanel.tsx`, `AgentListItem.tsx` | **Yes** — dispatch 1. |
| **B. Owner Access zone** — ~~a third zone in `AgentView`, after `[Sections] Body`, with the identical label pattern (`[Share] Access ▾`)~~ **superseded 2026-08-31**: the `Share` tab of a new two-tab right-panel dock (`RightDockPanel.tsx`, alongside `Raw`), not an `AgentView` zone. Contains: link state (the code, a copy button, Enable/Disable), the people list with a per-row remove icon, and an add-by-email input. Owner-only. | `RightDockPanel.tsx` + `AccessZone.tsx` (was `AgentView.tsx`) | **Done** — the mockup pass (dispatch 2) grew into a full canvas-reviewed redesign of this surface; the React version (`AccessZone.tsx`) is built and wired to the live API. |
| **C. Read-only shared agent view** — what a recipient sees at `/agents/[id]`: name, description, config, sections, and exactly two actions (**Copy to me**, and Export if D2 says yes). No edit affordances at all. | new component | **Yes** — dispatch 3. |
| **D. Redeem dialog** — a `⇱ Redeem share code` action row in the Library's `Manage` zone alongside `+ New agent` / `⇪ Import agent`, opening a one-field dialog modelled on `ImportDialog`. | `LibraryPanel.tsx`, new dialog | **Yes** — dispatch 4, though it is small enough to fold into dispatch 1 if the user prefers. |
| Copy-collision prompt (reuse the existing `409 name_exists` inline-error pattern) | wherever **Copy to me** lives | **No** — an existing error pattern, no new visual concept. |

**On the recipient's entry point (D5):** the design says "recipient pastes the code somewhere in
the UI", so an action row + dialog is what gets built. The obvious follow-up — a
`/agents/redeem?code=…` URL so the owner shares a clickable *link* and a logged-in click is
one step — is deliberately out of scope, and is additionally blocked on there being no absolute
base URL in the codebase today: `APP_BASE_URL` is introduced by **Plan 14** (§4.6 of that plan),
not this one. Until then the owner copies a code, not a URL.

**On read-only enforcement in the UI:** the UI hides affordances; it does not enforce anything.
Every one of those actions would `404` at the API anyway (constraint 1). That ordering matters —
a bug in the UI gate is a cosmetic bug here, not a security bug, and §5.5 is what makes that
sentence true.

### 4.10 Fitness functions

Two assertions, added to the existing suites rather than a new file (this plan does not create a
new `lib/` subsystem folder, so it does not warrant its own `architecture.test.ts` the way
`lib/ai`, `lib/mcp`, and Plan 14's `lib/email` do):

| Rule | Assertion | Where |
|---|---|---|
| **No AI on the copy path** | Neither `app/api/agents/[id]/copy/route.ts` nor the `copyAgentForOwner` region of `agents.ts` imports from `lib/ai/` or `lib/import/`. | `app/api/__tests__/route-guard.test.ts` (it is already the home of path-based source assertions) |
| **Sole owner of `agent_share`** | The identifier `agentShare` appears only in `lib/db/schema.ts`, `lib/db/repository/agentShares.ts`, `lib/db/repository/agents.ts` (the two viewer-scoped reads), and test files. | same |

The existing route-guard assertion ("every non-auth, non-mcp `route.ts` contains
`authenticate(`") already covers all six new routes with no change.

### 4.11 Files

| File | New/Mod | Role |
|---|---|---|
| `lib/db/schema.ts` | mod | `agent.publicCode`, `agent.publicCodeCreatedAt`, the `agentShare` table + 2 indexes, plus **`'copied'` added to the `agent.source` enum and `section_revision.author` enum (D3 resolved, new scope)**. |
| `lib/db/migrations/0009_share_agent.sql` | **new — done** | 2 `ALTER TABLE ADD COLUMN`, `CREATE TABLE agent_share`, 3 indexes. `drizzle-kit`-generated; journal entry verified present. Landed as `0009`, ahead of Plan 14's own `0009` claim — §7 risk 5. |
| `lib/db/repository/agentShares.ts` | **new** | Sole owner of `agent_share`: `createShare`, `listSharesForAgent`, `deleteShare`, `deleteSharesForAgent`, `findShare`. Plus the `agent.publicCode` accessors (`setPublicCode`, `clearPublicCode`, `findAgentIdByPublicCode`) — they live here rather than in `agents.ts` because they are share-feature state, and keeping them together means one file to read to understand access granting. |
| `lib/db/repository/agents.ts` | mod | `getAgentFullForViewer`, `listSharedWithViewer`, `copyAgentForOwner`, **`exportAgentMarkdownForViewer` (D2 resolved, new scope — sits next to `exportAgentMarkdown`)**; `deleteAgent` gains the share cascade. **No existing function's signature or body changes otherwise.** |
| `lib/db/repository/index.ts` | mod | Barrel re-exports — the only import surface outside `lib/db/`. |
| `lib/auth/shareCode.ts` | **new** | `generateShareCode()`. ~20 lines, pure, no `server-only`. |
| `app/api/agents/[id]/shares/route.ts` | **new** | `GET` (list) + `POST` (grant by email). |
| `app/api/agents/[id]/shares/[shareId]/route.ts` | **new** | `DELETE` — revoke one person. |
| `app/api/agents/[id]/share-link/route.ts` | **new** | `POST` (enable) + `DELETE` (disable). |
| `app/api/agents/[id]/copy/route.ts` | **new** | `POST` — the fork. |
| `app/api/agents/redeem/route.ts` | **new** | `POST` — redeem a code. Note the path is `agents/redeem`, deliberately not `agents/[id]/…` — the caller has no id to supply. |
| `app/agents/[id]/page.tsx` | mod | Viewer-scoped read + branch on `access`; pass `sharedAgents`. |
| `app/page.tsx` | mod | Empty-state condition and first-agent redirect must account for shared-only users (§4.7). |
| `app/components/Library/LibraryPanel.tsx` | mod | "Shared with me" section + the redeem action row. |
| `app/components/Library/AgentListItem.tsx` | mod | Read-only variant. |
| `app/components/Library/RedeemShareDialog.tsx` | **new** | Modelled on `ImportDialog.tsx`. |
| `app/components/CustomViz/AgentView.tsx` | mod (**structural refactor**, D1 resolved, new scope) — **done** | Split into per-zone sub-components (`ConfigZone`, `SectionsZone`) with shared render logic pulled into hooks/helpers. **No `AccessZone` here** — superseded 2026-08-31 (see §8 D1's "Refactor sequence" note): Access shipped as a right-panel dock tab instead, not a fourth `AgentView` zone. |
| `app/components/CustomViz/AccessZone.tsx` | **new** — **done, 2026-08-31** | The `Share` tab's content: link enable/disable, copy, the people list, add-by-email, wired live to the six §4.5 routes. Owner-only; safe as unconditional today because `WorkbenchShell`/`AgentView` have no shared/read-only branch yet (page.tsx's viewer-scoped read is still step 10, below). |
| `app/components/shell/RightDockPanel.tsx` | **new** — **done, 2026-08-31** | Replaces the old single-purpose Raw `Panel` in `WorkbenchShell.tsx`'s right slot with a two-tab dock (`Raw` \| `Share`); owns tab state, always mounts on `Raw` (remounts fresh every fold/unfold, so no explicit reset logic is needed). |
| `app/components/CustomViz/SharedAgentView.tsx` | **new** (D1) — **done, 2026-08-31** | The read-only presentation, built on the refactored shared pieces. |
| `lib/mcp/*` (whichever files own `list_agents`, `get_agent`, `pull_agent`) | mod (D8 resolved, new scope) | Switch to `getAgentFullForViewer` / `listSharedWithViewer` / `exportAgentMarkdownForViewer`, resolving the MCP token's own user as viewer. |
| `lib/mcp/resources.ts` | mod (D8 resolved, new scope) | Equivalent viewer-scoped change wherever it enumerates/resolves agents. |
| `lib/mcp/*` (`push_agent`'s handler) | mod (D8 resolved, new scope) | Re-verify write-surface containment still refuses a share-holder's write; add the MCP-token equivalent of §5.5's 404-on-non-owner assertion. |
| `lib/mcp/__tests__/architecture.test.ts` | mod (D8 resolved, new scope) | Re-verify the four existing fitness assertions hold once the read tools are share-aware. |
| `reference/layout/Layout-Workbench.html` | mod | Four mockup dispatches (§4.9) — **before** any of the four React files above, and **after** the `AgentView` structural refactor (D1) for dispatches 2 and 3. |
| tests | **new/mod** | §5. |
| `docs/system-about.md`, `docs/user-guide.md`, `docs/roadmap.md`, `lib/db/CLAUDE.md`, `lib/auth/CLAUDE.md`, `lib/mcp/CLAUDE.md` (its "MCP reads exclusively through owner-scoped functions" claim is now false — D8), `README.md`, `CHANGELOG.md`, `plans/roadmap.md`, `app/privacy/page.tsx` | mod | §10. |

---

## 5. Testing approach

Everything is mocked and free. There is no live pass in this plan.

### 5.1 Share code (`lib/auth/__tests__/shareCode.test.ts`) — pure
- Format: `shr_` prefix, total length 47, base64url character set only.
- 1000 generated codes are all distinct (a smoke check on the RNG wiring, not a statistical claim).
- **No keyword or wording assertions anywhere** — structural facts only, per this repo's rule
  that content validation is quantitative, never phrase-matching.

### 5.2 Repository — shares (`lib/db/repository/__tests__/agentShares.test.ts`, in-memory DB)
- Grant by email → row exists with `grantedVia:'email'`, email lowercased + trimmed.
- **Granting the same `(agentId, email)` twice creates exactly one row** and returns the
  original — the idempotency assertion the whole design rests on.
- **Granting by code for an agent already granted by email is likewise one row** — the
  cross-mechanism half of the same rule, and the one a naive implementation gets wrong.
- `MixedCase@Example.COM` and `  mixedcase@example.com  ` collapse to the same row.
- Set → find-by-code → clear → find-by-code returns `null`.
- Two agents cannot hold the same code (unique index).
- **Two agents with `publicCode = NULL` coexist** — the regression test for anyone who
  "fixes" the unique index into a `NOT NULL` or a partial index.
- `deleteSharesForAgent` removes only that agent's rows.

### 5.3 Repository — viewer-scoped reads (`agents.test.ts` additions, in-memory DB)
- Owner reads own agent → `access:'owner'`.
- Share-holder reads → `access:'shared'`, and the DTO is **field-identical** to what the owner
  gets (it is a live reference, not a reduced projection).
- Stranger reads → `null`.
- A share row for an email with **no user account** grants nothing and breaks nothing; creating
  a user with that email afterwards makes the same call start returning the agent — **the
  share-before-signup case, tested directly.**
- `listSharedWithViewer` excludes agents the viewer owns, and includes `ownerEmail`.
- **`listAgents(ownerId)` returns byte-identical results before and after a share row exists** —
  the assertion that keeps constraint 2 true.
- Owner edits a section → the share-holder's next read reflects it (live, not snapshot).
- `deleteAgent` removes the share rows in the same transaction.

### 5.4 Repository — copy (`agents.test.ts` additions)
- **Fidelity:** every `sectionKey`, `heading` (including a `null` preamble heading), `content`,
  and `order` survives verbatim, as do `splitLevel`, `platform`, `description`, and every config
  row including a nested `datatype:'json'` value. This is the test that would have caught a
  markdown round trip.
- A `section_revision` exists for every section of the copy.
- A `post-import` `agent_snapshot` exists for the copy.
- **Independence, both directions:** edit the copy → the source is byte-identical; edit the
  source → the copy is byte-identical.
- Name collision with the copier's **own** existing agent → throws `NameExistsError` and
  **writes nothing** (assert the existing agent's row and sections are untouched — a status-only
  assertion would pass even if the overwrite had happened).
- Copying a *shared* agent works; copying a *stranger's* agent returns `null`/`404`.
- Explicit `newName` is used and must itself be collision-checked.

### 5.5 The tenancy regression suite — the most valuable tests in this plan
New file `app/api/__tests__/share-tenancy.test.ts`, built on the existing `tenancy.test.ts`
harness (in-memory DB, mocked `getSession`, mocked provider). Add a user **C** who holds a share
on A's agent, then assert:

- **C can read**: `GET /api/agents/[A-agent]` → `200`; the agent appears in C's shared list.
- **C cannot write — every mutating endpoint still `404`s, and the target row is byte-identical
  afterwards** (both assertions, as the existing suite insists): `PATCH /api/agents/[A]`,
  `DELETE /api/agents/[A]`, `PATCH /api/agents/[A]/sections/[s]`, `POST /api/agents/[A]/groups`,
  `DELETE /api/agents/[A]/groups/[g]`, `POST /api/chat`, `POST /api/agents/[A]/apply-proposal`,
  `POST /api/agents/import` with A's name (must create C's own agent, never touch A's).
- **C cannot administer the share**: `GET/POST /api/agents/[A]/shares`, `DELETE .../shares/[id]`,
  `POST/DELETE /api/agents/[A]/share-link` all → `404` for C. A share-holder is not a co-owner.
- **B (no share) is unchanged** — every existing `tenancy.test.ts` expectation, including
  `GET → 404`, still holds. The existing suite must keep passing untouched; do not edit it to
  accommodate this feature.
- ~~**MCP:** with C's MCP token, `list_agents` / `get_agent` / `pull_agent` do not return A's
  agent (D8).~~ **Superseded — D8 resolved 2026-08-29 to fold MCP visibility into this plan
  (§6 step 8c, landed).** With C's MCP token, `list_agents` / `get_agent` / `pull_agent` now DO
  return A's agent (`access:'shared'`); `push_agent` still cannot write to it — verified
  specifically in `lib/mcp/__tests__/tools.test.ts`'s "shared-agent visibility over MCP" block,
  reusing the exact reasoning `app/api/agents/import/route.ts` already relies on (writes are
  always scoped to the caller's own `userId`, never the shared agent's actual owner).

### 5.6 Routes (`app/api/agents/__tests__/shares.test.ts`)
- Full matrix from §4.5's table: each status code, each error body.
- **Unknown code and disabled code produce byte-identical `404` bodies** — constraint 6's
  regression test.
- Redeeming twice → one row, `alreadyHadAccess:true` the second time.
- Redeeming your own agent's code → no row written, `access:'owner'`.
- Disabling the link leaves every existing share row intact (**and** the reverse: removing a
  person leaves the code intact) — constraint 5's regression test, and the one most likely to be
  broken by a later "simplify this into one button."
- Grant → revoke → the recipient's `listSharedWithViewer` is empty and their `GET /api/agents/[id]`
  is back to `404`.
- Copy: `201`, `409` on collision, and — asserted explicitly — **the fake AI provider's call
  count is 0** across the whole copy suite.
- Cap: the 51st share → `409 too_many_shares` (D7).

### 5.7 Migration
- Add to `lib/db/__tests__/migration.test.ts`'s existing "applies cleanly to a fresh database"
  coverage; confirm the `meta/` journal entry exists.

---

## 6. Implementation sequence

| # | Step | Depends on | Notes / risk |
|---|---|---|---|
| 0 | ✅ **DONE** (`2198aea`). Confirm D1–D9 (§8). | — | **Does not block step 1 or step 2.** D1/D2/D5 shape UI only; D3/D6/D7/D9 are one-line calls; D4/D8 are yes/no. |
| 1 | ✅ **DONE** (`b07e914`). Schema + migration + `agentShares.ts` + barrel + `deleteAgent` cascade + §5.2/§5.7 tests | — | Behaviour-preserving: a new table nothing reads yet, two nullable columns nothing writes. Verify the journal entry. |
| 2 | ✅ **DONE** (`b07e914`). `lib/auth/shareCode.ts` + §5.1 tests | — | **Parallel with 1** — pure, no dependencies. |
| 3 | ✅ **DONE** (`b07e914`). `getAgentFullForViewer` + `listSharedWithViewer` + §5.3 tests | 1 | The access predicate. Still no route reads it. |
| 4 | ✅ **DONE** (`b07e914`). Owner-side routes: `shares` GET/POST, `shares/[shareId]` DELETE, `share-link` POST/DELETE + their §5.6 tests | 1, 2 | First user-visible behaviour, but only via the API. |
| 5 | ✅ **DONE** (`b07e914`). `POST /api/agents/redeem` + §5.6 tests | 1, 2, 3 | |
| 6 | ✅ **DONE** (`b07e914`). `copyAgentForOwner` + `POST /api/agents/[id]/copy` + §5.4 tests | 3 | **Parallel with 4–5.** The name pre-check is the part to get right first. |
| 7 | ✅ **DONE** (`b07e914`). **§5.5 tenancy regression suite** | 3, 4, 5, 6 | **Must land in the same batch as 3–6, not after.** Plan 11 found exactly this gap for `lib/ai`'s DB rule: a boundary documented but unenforced is a boundary already broken. |
| 8 | ✅ **DONE** (`b07e914`). §4.10 fitness functions | 6 | Same batch as 7. |
| 8b | ✅ **DONE** (`b07e914`). **`exportAgentMarkdownForViewer(agentId, viewerId)`** (D2) + route wiring + tests | 3 | Viewer-scoped sibling to `exportAgentMarkdown`. Reused directly by D8's MCP `pull_agent` change (8c), so this must land first. |
| 8c | ✅ **DONE** (`b07e914`). **MCP share-visibility** (D8, folded-in scope): `list_agents`/`get_agent`/`pull_agent` switch to the viewer-scoped read functions; `resources.ts` equivalent change; `push_agent` write-surface containment re-checked against a share-holder's token (still refuses non-owner writes); `lib/mcp/__tests__/architecture.test.ts` fitness assertions re-verified; new MCP-token assertion added alongside §5.5. | 3, 8b | New scope, not in the original plan — see D8 resolution in §8. Correct §4.4's "MCP" bullet, which is now stale. |
| 8.5 | ✅ **DONE** (`04f10d7`). **`AgentView.tsx` structural refactor** (D1, folded-in scope): split into per-zone sub-components (`ConfigZone`, `SectionsZone`, `ModelEffortControl`) with shared render logic extracted to hooks/helpers. Confirmed working in the browser before proceeding. **No `AccessZone` produced here** — that placement was superseded before it was built (see §8 D1's "Refactor sequence" note and step 10 below). | — | New scope, not in the original plan — see D1 resolution in §8. Independent of 1–8c; ran in parallel with them. |
| 9 | ✅ **DONE (committed, `b8c0acf`).** **Mockup pass** — originally four dispatches (§4.9); dispatch 2 (Owner Access) grew into a full redesign via a Claude Design canvas review (2026-08-31): the Access zone was pulled out of the main panel entirely and rebuilt as a `Share` tab on a two-tab right-panel dock (`Raw` \| `Share`), with real editor-tab styling, inline SVG icons replacing text glyphs, and one generic access-footer instead of a link-specific hint. `Layout-Workbench.html` reflects the finished design. | — | **Parallel with 1–8c** — it is a static HTML file with no dependency on any code here. Starting it early is the single biggest schedule win in this plan. |
| 10 | ✅ **DONE (committed, `b8c0acf`).** React migration. The right-panel dock (`RightDockPanel.tsx`) and its `Share` tab (`AccessZone.tsx`, wired live to all four owner-facing share/link routes) replaced `WorkbenchShell.tsx`'s old single-purpose Raw `Panel`; `RawAgentView.tsx`'s toolbar icons restyled to match. `LibraryPanel` gained a "Shared with me" zone-label section (read-only `AgentListItem` rows via a new `sharedOwnerEmail` prop) and a "⇱ Redeem share code" action row opening `RedeemShareDialog.tsx` (new). `SharedAgentView.tsx` (new) is the recipient's read-only card — header, read-only Config/Sections, Copy-to-me + Export — rendered by `WorkbenchShell` in place of `AgentView` when `access === 'shared'`. `app/agents/[id]/page.tsx` now calls `getAgentFullForViewer` and passes `access`/`ownerEmail` through; `app/page.tsx`'s empty-state condition and redirect now account for a shared-only user. One small backend addition needed along the way: `getAgentFullForViewer` now also returns an optional `ownerEmail` (populated only when `access === 'shared'`) — additive, no existing `{ agent, access }` call site broke. **Revised same day, live-testing feedback:** the first pass also dropped the Chat panel and the whole right dock for a shared viewer — rejected ("should be same view... shared and owner should show after custom visualization panel title"). Reverted: `WorkbenchShell` now renders Chat and the right dock identically for both access types; the only visible difference is the Custom Visualization panel's `role` label (`owner` vs `shared`), and `RightDockPanel` takes a new `access` prop that hides just its `Share` tab (still owner-only) while `Raw` stays present for both. | 4, 5, 6, 8.5, 9 | `npx tsc --noEmit` and the full test suite passed clean before commit; the user live-tested the dev server themselves before that. |
| 11 | ✅ **DONE (committed, `b8c0acf`).** Docs (§10): `plans/roadmap.md`'s Share agent description rewritten (was "hand an agent... to fork a copy," now names live read-only access as the primary mechanism); `docs/system-about.md` §2/§4/§10/§13 (domain model gains `AgentShare`, the per-user-isolation sentence gets its read-widening qualifier, the MCP tool table corrected to viewer-scoped reads); `docs/user-guide.md` gains a full "Sharing an agent" section (also fixed two now-stale details in "Exporting an agent" — the dock is two tabs now, not one, and the Download icon is no longer a text glyph); `docs/roadmap.md` moved Share agent from "Coming Next" to "Available Today" with an accurate description; `lib/db/CLAUDE.md` qualified its "no function could return another user's data" claim (true for writes, not quite for the two new viewer-scoped reads), added `agentShares.ts`, corrected the migration count (0000–0009, ten not nine); `lib/auth/CLAUDE.md` added a `shareCode.ts` section; `lib/mcp/CLAUDE.md` corrected its architecture diagram and file table (the three read tools are viewer-scoped now, not owner-scoped as originally documented — the exact stale claim §4.4 warned about); `CHANGELOG.md` and `README.md`'s layout summary both updated; `app/privacy/page.tsx` — checked, not a no-op: §2/§6 gained a real disclosure that sharing exposes agent content and an email address to another user, dated 2026-08-31. | 1–10, 8b, 8c | Citations restate the rule inline rather than a bare section number, per standing rule 6. |

**Rollback.** There is no kill switch and none is proposed: with no code generated and no share
row written, the feature is inert, so a bad deploy degrades to "nobody has shared anything."
Reverting the code leaves the table and columns orphaned but harmless — no existing query reads
them. That is a deliberate difference from Plan 14, whose `liveEmailSends` toggle exists because
*its* failure mode spends money and burns a domain's reputation. Nothing here does either.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **The `ownerId` invariant erodes.** A future session "helpfully" adds share-awareness to `getAgentFull` or `listAgents`, and every write path silently opens at once. | Constraint 2 + a separate function name + §5.5, which asserts every mutating endpoint still `404`s for a share-holder. Write the reason into `getAgentFullForViewer`'s doc comment in words, not as a cross-reference. |
| 2 | **A leaked code grants indefinite access to everyone who sees it.** It is a reusable bearer credential with no expiry — pasted into the wrong channel, it is public. | 256 bits makes guessing irrelevant; leaking is the real vector, and the only answer is fast revocation. **The Disable-link control must sit next to the code in the same panel**, not behind a menu. Accepted residual: no audit of who redeemed a code (§9). |
| 3 | **An email typo grants a stranger standing access.** `alice@gmial.com` silently waits for whoever eventually registers that address on this deployment. | The address is echoed back verbatim in the owner's list and removable in one click. Deliberately **not** mitigated with a "this address has no account yet" marker — that is precisely the account-existence oracle constraint 6 forbids, and the tension is resolved in favour of non-disclosure. Accepted residual. |
| 4 | **A deleted-then-re-registered email inherits the old holder's shares.** | Directly interacts with the roadmap item **Delete or disconnect user (admin)**, which does not exist yet. §10 hands that plan one rule: deleting a user must delete `agent_share` rows matching their email. Until it exists, no user can be deleted, so the risk is latent, not live. |
| 5 | **Migration number collision with Plan 14 — resolved.** This plan landed first, shipping as `0009_share_agent.sql`; Plan 14's `0009` claim is now stale and needs updating to whatever's next when it's implemented. | `drizzle-kit` generates the number from the existing folder, so this resolved itself **because the migration was generated, not hand-numbered** — and a hand-written migration missing its journal entry was already a real Plan 13 bug. |
| 6 | **An orphaned share row survives its agent** and joins to nothing forever. | The `deleteAgent` cascade (§4.2), asserted in §5.3. |
| 7 | **A visible-but-dead edit affordance** in the read-only view — the recipient clicks and gets an unexplained failure. | D1's recommendation (a separate presentation component, not a `readOnly` prop threaded through 1899 lines of `AgentView`) makes the failure mode "the control does not exist" rather than "the control exists and 404s". |
| 8 | **Shared agents leak into MCP, chat, or export** via a later change to a shared helper. | They are excluded by construction today (§4.4). §5.5 asserts it for MCP specifically rather than trusting it carried over — the same posture `lib/mcp/__tests__/importAgent.test.ts` took for the import pipeline's behaviours. |
| 9 | **`agent_share` grows unbounded**, or one agent is spammed with thousands of rows. | The per-agent cap (D7) plus the fact that only an authenticated owner can write rows for their own agent. |
| 10 | **The copy silently corrupts an existing agent** via `upsertAgentFromImport`'s update-in-place. | §4.6 step 2's pre-check, and §5.4's assertion that a collision writes *nothing* — not merely that it returns `409`. |
| 11 | **The privacy policy may need an edit.** `app/privacy/page.tsx` describes how a user's data is handled; user-to-user sharing of agent content is a new disclosure path, even though it stays inside the deployment and no new third party is involved. | Read the page during step 11 and judge. Unlike Plan 14's mandatory edit (which added a real third-party processor), this one may be a no-op — but it must be *checked*, not assumed. |

---

## 8. Decisions — judgment calls made here, awaiting confirmation

Each already has a call baked into §4 so implementation is unblocked; changing one is a small,
localized edit.

**D1 — How is the read-only view built?**
**Resolved 2026-08-29: a separate `SharedAgentView.tsx`, AND a full structural refactor of
`AgentView.tsx` first, as its own preliminary step before any share-feature UI code.** The
1899-line file (§2) gets split into sub-components per zone (`ConfigZone`, `SectionsZone`, and
the new `AccessZone`) with shared render logic extracted into hooks/helpers, so `AgentView` and
the new `SharedAgentView` both consume the same underlying pieces instead of duplicating layout.
This is **new work not in the original scope** — see the added sequence step in §6 and the new
row in §4.11. It must land, and be confirmed working by inspection in the browser, before
dispatch 2 (Owner Access zone mockup) and dispatch 3 (read-only view) are built in React,
since both depend on the post-refactor shape.

**Refactor analysis (2026-08-29) — the file is lopsided, not evenly bloated.** Read in full
before any code moved. Breakdown: module-level constants/helpers (lines 1–238, already
decoupled) — component state/effects/business-logic closures (239–897, ~35 `useState` + 8
`useEffect` + ~15 closures) — **render-helper closures (898–1727, ~830 lines, 44% of the whole
file: `renderScalarRow`, `renderItemPill`, `renderToolPicker`, `renderListRow`,
`renderInitialPromptBlock`, `renderCustomBlock`, `renderModelEffort`, `renderAddKeyButton`,
`renderAddSectionButton`)** — the actual JSX return (1728–1899, ~170 lines, deceptively small
since it just calls the closures above. Of the ~35 state vars and ~830 render-closure lines,
roughly 25 state vars and ~730 render lines belong to Zone 1 (Config) alone; Zone 2 (Sections)
is already nearly self-contained (3 state vars, ~50 render lines, delegates real work to the
already-separate `SectionBlock`). The Model+Effort control is a further wrinkle worth naming:
it's Config-zone *data* (`model`/`effort` config keys) rendered in the *header*, not inside
Zone 1's body — pre-existing, not introduced by this refactor. Also found: 7 of the 8
`useEffect`s are the identical "close this popover on outside click" pattern hand-rolled 7
times (~90 lines of near-duplicate code).

**Refactor sequence, agreed:**
1. Extract a `useOutsideClick(active, selector, onOutside)` hook — pure, zero behavior change,
   collapses the 7 duplicated effects, de-risks everything after. Do this first.
2. Extract `SectionsZone` — small, nearly self-contained already; proves the extraction pattern
   at low risk before the real work.
3. Extract `ConfigZone`, itself decomposed into focused pieces (`ModelEffortControl`,
   `ScalarRow`, `ListRow` + `ToolPicker` + `ItemPill`, `InitialPromptBlock`, `CustomJsonBlock`)
   rather than one second monolith — this is 80%+ of the file's actual complexity.
4. `AgentView` becomes a thin shell: header + `<ConfigZone/>` + `<SectionsZone/>`. ~~(later)
   `<AccessZone/>`~~ — struck, see below: Access never became a third zone here.
5. ~~Build `AccessZone` as a new Zone 3 component, matching the existing zone-label/collapse
   convention.~~ **Superseded 2026-08-31**, before this step was ever executed: a layout
   debate concluded Access belongs neither in `AgentView`'s scrolling stack nor merged into
   Raw's identity. It shipped instead as the **`Share` tab of a new two-tab right-panel dock**
   (`RightDockPanel.tsx`, replacing the old single-purpose Raw `Panel` in
   `WorkbenchShell.tsx`) — `AccessZone.tsx` is that tab's content, a sibling of `RawAgentView`,
   not a fourth `AgentView` sub-component. `AgentView.tsx` therefore stays exactly the thin
   shell step 4 produced: header + `ConfigZone` + `SectionsZone`, nothing more. This also
   means D1's original constraint ("Access zone… never rendered in the shared/read-only
   view") is enforced by `RightDockPanel` simply not existing on whatever future
   `SharedAgentView` route renders, rather than by a branch inside `AgentView`.

**Reuse decision (2026-08-29, confirmed with the user):** once `ConfigZone`/`SectionsZone` are
small, focused components — not the 1899-line monolith the original D1 reasoning was about —
`SharedAgentView` **reuses them via a `readOnly` prop** rather than duplicating their JSX from
scratch. At this smaller grain, a missed branch means one control fails to hide, not a
1899-line surface to audit — the risk D1 originally flagged is specific to component *size*,
not to the read-only/editable split existing at all. A test asserting no editable element
renders when `readOnly` is required wherever this lands (§5, when `SharedAgentView` is built).

**Original recommendation (superseded): a separate `SharedAgentView.tsx` presentation component**, rather than
threading a `readOnly` prop through `AgentView.tsx` (1899 lines, with edit affordances woven
into a dozen render helpers and into `SectionBlock`). Reasons: a missed branch in the prop
approach is a live edit control that 404s, whereas a missed feature in a separate component is
merely something the recipient cannot see; and the two views genuinely want different
information density (a recipient evaluating whether to copy does not need the add-key `+`
button, the cite toggles, or the version-conflict machinery). Cost: some duplicated layout, and
a second place to update if the agent's visual structure changes. Alternative if the user
prefers one component: thread `readOnly` and add a test asserting no `<button>`/editable
element renders in that mode.

**D2 — May a recipient export the shared agent's `.md`?**
**Recommendation: yes**, via a viewer-scoped `exportAgentMarkdownForViewer(agentId, viewerId)`
sibling. **Copy to me** already gives them the entire content in a form they fully control, so
withholding a download is an arbitrary hole rather than a protection. **If no:** change nothing —
`GET /api/agents/[id]/export` is owner-scoped today and stays that way.

**D3 — What `source` does a copy get?**
**Resolved 2026-08-29: add a distinct `'copied'` value** to the `agent.source` enum in
`lib/db/schema.ts`, and a matching `'copied'` value on `section_revision.author`. Applied in
`copyAgentForOwner()` (§4.6): after `upsertAgentFromImport()` writes `source:'imported'` /
`author:'import'` (its own fixed contract), the copy function does one follow-up update setting
`agent.source = 'copied'` and rewriting `author` on the just-created `section_revision` rows for
that agent to `'copied'`. Library source-tag rendering (wherever `imported`/`created` is shown
today, per §2's `AgentListItem.tsx` note) gains a third tag for this value. This is schema scope
beyond the original recommendation — reflected in §4.11's files table.

*(Original recommendation, superseded: leave it `'imported'` — a copy is an import of someone
else's agent, and adding a new enum value costs a schema change for a cosmetic gain.)*

**D4 — Rate-limit `POST /api/agents/redeem`?**
**Resolved 2026-08-29: no.** Matches the design as originally agreed — 256 bits of entropy is
the sole defense (constraint 7), and no rate limit is added on top. No code change needed for
this decision; it is the absence of one.

**D5 — Where does the recipient paste a code, and what does the owner copy?**
**Recommendation: a `⇱ Redeem share code` action row in the Library's `Manage` zone**, opening
an `ImportDialog`-style one-field dialog — this is the design as agreed. The owner's copy button
copies the **bare code**, not a URL, because no absolute base URL exists in the codebase yet
(**Plan 14** introduces `APP_BASE_URL`). A one-click `/agents/redeem?code=…` link is the natural
follow-up and belongs to whichever plan lands second.

**D6 — Keep `granted_via` and `public_code_created_at`?**
**Resolved 2026-08-29: keep both**, as recommended. Each is one nullable/small column backing
one real line of UI ("added by you" vs. "redeemed the link"; "link active since …"), and both
facts are unrecoverable if not stored. Neither creates a second source of truth. No change from
§4.2.

**D7 — Per-agent share cap: how, and how many?**
**Resolved 2026-08-29: no cap.** The table is bounded only by owner effort — acceptable for a
closed beta. This removes the cap check from the write path entirely: `POST
/api/agents/[id]/shares` never returns `409 too_many_shares`, invariant 9 in §4.8 is dropped, and
§5.6's "51st share → 409" test is not written. **Scope reduction vs. the original plan** — flag
this in §4.5's route table and §4.8 when implementing (remove the `409 too_many_shares` row from
`POST /api/agents/[id]/shares`).

**D8 — Should shared agents be visible over MCP?**
**Resolved 2026-08-29: yes, folded into this plan.** Overrides the plan's own recommendation
(which called this "a plan-sized change of its own" and suggested a separate roadmap item) —
confirmed as a deliberate scope expansion, not an oversight. This adds real implementation
weight: `lib/mcp/`'s three read tools (`list_agents`, `get_agent`, `pull_agent`) must switch from
`listAgents(ownerId)` / `getAgentFull(id, ownerId)` / `exportAgentMarkdown(id, ownerId)` to the
viewer-scoped siblings (`listSharedWithViewer` composed alongside the owner list;
`getAgentFullForViewer`; a new `exportAgentMarkdownForViewer`, which D2 already requires for the
web export path, so this reuses that function rather than adding a second one) — resolving the
MCP caller's own user id as the viewer. `resources.ts` needs the equivalent change wherever it
enumerates or resolves agents. `push_agent`'s write-surface containment must be re-examined
against a share-holder's MCP token: it must still refuse to write a shared (non-owned) agent, the
same 404-on-non-owner behavior §5.5 already asserts on the web routes — add the MCP-token
equivalent of that assertion. The four existing fitness assertions in
`lib/mcp/__tests__/architecture.test.ts` need re-verification that they still hold once these
functions are share-aware. **This turns D8 from a documented exclusion (§4.4's "what this leaves
untouched, and therefore correct for free") into active new-code scope** — §4.4's "MCP" bullet
point is now inaccurate and must be corrected when this is implemented, and new rows are needed
in §4.11's files table for `lib/mcp/resources.ts`, `lib/mcp/tools/*.ts` (whichever files own
`list_agents`/`get_agent`/`pull_agent`/`push_agent`), and
`lib/mcp/__tests__/architecture.test.ts`. Invariant 10 in §4.8 ("Shared agents are not exposed
over MCP") is dropped/inverted.

**D9 — Does re-`POST`ing `share-link` return the existing code or rotate it?**
**Resolved 2026-08-29: return the existing code** (idempotent enable), as recommended. Rotation
is a distinct intent — "I think this leaked" — and conflating it with enable means a
double-clicked button silently invalidates a link the owner already distributed. An explicit
**Regenerate** action stays out of scope (§9); disable-then-enable already achieves it in two
clicks. No change from §4.5.

---

## 9. Explicitly NOT in this plan

- **Sharing with edit access.** The roadmap item asked for this to be decided explicitly; it is
  decided: **not built.** Two people editing one agent needs a concurrency and attribution story
  (`section_revision.author` has no notion of *which* user, and `AgentSection.version`'s
  optimistic check assumes one writer) that is a plan of its own.
- **Ownership transfer.** The roadmap already rules this out on its own terms — re-pointing
  access control, API tokens, and MCP references is hidden complexity that a copy covers without.
- **Any second permission level** (comment, suggest, edit). One level: read.
- **Notifications of any kind.** No email, no in-app badge, no "someone shared an agent with
  you." The design says the agent simply appears. (When Plan 14's transport lands, a share
  notification becomes one template plus one `kind` string — noted in §10, not built here.)
- **An accept/decline step.** A recipient cannot refuse or hide a shared agent. If that turns
  out to matter, it is a `dismissedAt` column on `agent_share` and a filter — deliberately not
  pre-built.
- **Public/anonymous sharing.** Redeeming requires a session. There is no read-only page for a
  logged-out visitor, and the code alone grants nothing without an account.
- **Sharing a group**, or sharing more than one agent per code.
- **A redemption audit trail** — who redeemed which code, when. `agent_share.createdAt` +
  `grantedVia` is as close as this plan gets; a real trail is a log table.
- **Code rotation in place** (D9), and **code expiry**.
- **Provenance on a copy** — no `copiedFrom`, no "the original has changed, re-copy?" prompt,
  no diff against the source (constraint 9).
- ~~Shared agents over MCP~~ — **D8 resolved 2026-08-29: this IS now in scope** (§6 step 8c).
  Struck rather than removed so the reversal is visible against the original draft.
- **Any change to `getAgentFull`, `listAgents`, or any mutating repository function**
  (constraints 1–2). If the build finds itself editing one of those, the design has been
  misread — stop.
- **A settings toggle to disable sharing deployment-wide.** Nothing here spends money or reaches
  a third party, so the kill-switch precedent (`liveLlmCalls`, Plan 14's `liveEmailSends`) does
  not apply.

---

## 10. Documentation this plan must update, and what it hands to other roadmap items

**Docs that become factually wrong on ship** (step 11 — these are correctness fixes, not polish):

- **`plans/roadmap.md`** — the **Share agent** row's Obs column says *"Hand an agent to another
  user to fork their own copy,"* which describes only half of what ships. The full description
  below the table carries the "decide explicitly which one(s)" scoping note, which is now
  answered. *(This plan does not edit that file — the coordinating session does.)*
- **`docs/system-about.md`** — §4's data model gains `agent_share` and the two `agent` columns;
  §10 (Auth & multi-tenancy) gains the one sentence that matters: **per-user isolation is now
  read-widened by an explicit share table, and every write path remains owner-scoped.**
- **`docs/user-guide.md`** — a new task section: sharing by link, sharing by email, what a
  recipient sees, copying to your own library, and the two separate ways to revoke.
- **`docs/roadmap.md`** — Share agent moves from "Planned"/"Coming next" to "Available today".
- **`lib/db/CLAUDE.md`** — the repository section's standing claim, *"Every repository function
  that reads or writes an owned row takes an `ownerId` as a required, never-defaulted parameter…
  there's no function that could accidentally return another user's data,"* needs one honest
  qualifier: every **write** still does; there are now exactly two named **read** functions that
  additionally resolve share grants, and they take a `viewerId` and resolve the email in SQL.
  Leaving that sentence unqualified would make the file quietly false. Add `agentShares.ts` to
  the file table.
- **`lib/auth/CLAUDE.md`** — add `shareCode.ts` to the file table and one line placing it
  against `inviteCode.ts` (plaintext, re-readable) and `apiToken.ts` (hashed, never re-readable).
- **`CHANGELOG.md`**, **`README.md`** (layout summary if the library gains a visible section).
- **`app/privacy/page.tsx`** — check, per §7 risk 11. Possibly a no-op; not assumable.

**What this hands to other roadmap items** (none of them built here):

- **Delete or disconnect user (admin)** — inherits exactly one new rule: **deleting a user must
  also delete `agent_share` rows whose `recipientEmail` matches that user's email**, otherwise a
  later signup on the freed address silently inherits their access (§7 risk 4). It should also
  decide what happens to agents *owned* by the deleted user that others hold shares on — the
  existing `deleteAgent` cascade handles it if agents are deleted, but not if they are
  reassigned.
- **Email-sending provider (Plan 14)** — once its gateway exists, "you've been given access to
  an agent" is one new template file plus one new `kind` string (that plan made `email_log.kind`
  a plain text column precisely so a new kind needs no schema change) plus one `sendEmail()` call
  placed **after** the share row commits. Its constraint that a send can never fail the action
  that triggered it is exactly what a share notification needs. Also relevant: Plan 14 introduces
  `APP_BASE_URL`, which is what a clickable redeem link (D5) is waiting on.
- **Review group behavior** — groups are owner-scoped and flag-disabled today, so this plan
  ignores them. Whoever re-enables groups must decide whether a shared agent can be filed into a
  recipient's group; `SharedAgentLiteDTO` deliberately omits `groupIds` so the answer today is a
  clear "no" rather than an ambiguous empty array.
- **GDPR-style export/deletion workflow** — `agent_share.recipientEmail` is a new place an email
  address is stored, including for people who have never had an account. Any future data-subject
  export or erasure has to include it.

**Scope boundary, stated once:** this plan ships when an owner can grant access both ways, a
recipient sees a live read-only agent in their library, "Copy to me" produces a working
independent fork, both revocation paths work independently, and §5.5's regression suite is green.
