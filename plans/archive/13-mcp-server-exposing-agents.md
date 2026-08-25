# Plan 13 — MCP Server Exposing MyAgent's Agents

> **Archived 2026-08-24 — one step ahead of this file's own rule.** The line below says
> this plan "moves to `plans/archive/` once live verification is done" — live verification
> (§5.7/§6 steps 5–6) is **not** done yet as of the archive date. Archived early anyway, by
> explicit user decision, to consolidate tracking onto `plans/roadmap.md` alone rather than
> maintaining this file and `plans/review-checklist-temp.md` (deleted the same day) in
> parallel. Nothing is lost: `plans/roadmap.md`'s **"Check: MCP server live verification
> (Plan 13)"** TODO row already carries the full remaining scope (free handshake, then one
> billed `push_agent` call) independent of this file's presence. QA validation against this
> plan's spec was completed 2026-08-24 — **PASS**, one cosmetic-only deviation (this file's
> `myagent://agent/{id}` URI text vs. the built `myagentstudio://agent/{id}`, just the
> project rename landing after this plan was drafted).
>
> **Addendum (2026-08-24) — tool names renamed.** `export_agent` → `pull_agent` and
> `import_agent` → `push_agent`, for the CLI/git mental model MCP clients live in (pull the
> current version down, push your edited version back up). This section and the rest of
> this document below still use the original `import_agent`/`export_agent` names as they
> were decided at the time — this is the historical decision record, not rewritten after
> the fact. The current, as-built names are documented in `lib/mcp/CLAUDE.md` and
> `docs/system-about.md` §13. Internal file/function names (`tools/exportAgent.ts`,
> `handleImportAgent`, `upsertAgentFromImport`, etc.) and the web UI's own "Import"/"Export"
> vocabulary are unchanged — only the two MCP-facing tool names changed.
>
> **Status: 🟡 Built and test-verified 2026-08-15, not yet live-verified.** All four
> implementation phases (§6 steps 2–4: token subsystem, read-only server + fitness
> functions, `import_agent`) are implemented, along with the full test suite (§5.1–§5.6)
> and the docs pass (§6 step 7). **`npm test`: 66/66 files, 841/841 tests pass** (run with
> an explicit go-ahead, standing rule 5) — this run found and fixed a hand-written migration
> missing its journal entry, a latent `listAgents()` bug (`updatedAt` never set), a
> self-defeating fitness-test-matching comment, and a missing `Accept` header in the new
> route tests; none were design flaws, all are now fixed. **`npx tsc --noEmit`** is clean on
> Plan 13's own code; it separately surfaced 8 pre-existing Plan 11 errors (tracked under
> the roadmap's own "Check: full test suite + `tsc` after Plan 11" item, not fixed here —
> out of this plan's scope). **Not yet live-verified** — §6 steps 5–6 (a free real-client
> handshake, then one billed `import_agent` call) still need an explicit ask first (standing
> rule 2). This plan moves to `plans/archive/` once live verification is done.
>
> All seven design decisions below (D1–D7) were resolved 2026-08-15 before implementation
> began. The roadmap's "undecided if wanted" framing was resolved as **wanted**; the tool
> surface was then trimmed and the two open business questions answered by the user in the
> same session. D1/D2/D4/D5 were recommendations with no open sub-questions; all seven are
> now reflected as-built, not just as-planned.
>
> - **D1 (auth):** **Per-user Personal Access Tokens** — opaque bearer, generated in Account,
>   stored SHA-256-hashed, scoped `read`/`write`, revocable. Given D6 (console clients only),
>   this is **complete for the target use case**, not a stepping stone.
> - **D2 (guardrails):** **No propose/review card.** The consent gate is token-issue time (a
>   `write` token is an explicit browser-side act), plus an admin `mcpWrites` kill switch
>   defaulting off. Reversibility comes from the import pipeline's own snapshot trail — see
>   §4.6, which is now a *verification* that the mechanism already exists rather than new code.
> - **D3 (tool surface): ✅ trimmed to four tools — `list_agents`, `get_agent`,
>   `export_agent`, `import_agent`.** `get_blueprint`, `create_agent`, and
>   `apply_agent_changes` are **dropped** (§9). Dropping `apply_agent_changes` removes the
>   plan's single highest-risk section: there is now **no shared write-contract extraction, no
>   config-merge logic, and no change of any kind to
>   `POST /api/agents/[id]/apply-proposal`**.
> - **D4 (transport):** **Stateless Streamable HTTP at `/api/mcp`**, inside the existing
>   Next.js app.
> - **D5 (blast radius):** **Read-only ships first** (Phases 1–3, useful standalone). The one
>   write tool lands in Phase 4 behind three gates: token scope, `mcpWrites`, and the existing
>   per-user hourly LLM cap.
> - **D6 (which clients): ✅ resolved — console/CLI MCP clients only.** Claude Code and
>   similar (e.g. a CLI-style Copilot client). **Claude Desktop's GUI connector is explicitly
>   not a target.** Consequence: the OAuth 2.1 authorization server is **out of scope
>   entirely**, not deferred — bearer tokens are the whole story.
> - **D7 (LLM spend): ✅ resolved — option (a), shared cap.** `import_agent` is metered by the
>   existing `getMaxLlmCallsPerUserPerHour()` (default 15/rolling hour, admin exempt), exactly
>   like a browser-initiated call. **No MCP-specific cap setting.**
>
> **Scale note — revised down to Medium.** The first draft rated this Large, matching the
> roadmap. Three things changed that: the tool surface dropped from seven to four, the dropped
> `apply_agent_changes` took the entire write-path extraction with it (no `applyAgentChanges`
> module, no touching the apply-proposal route, no config-merge risk, no new
> `SectionRevision`/`AgentSnapshot` enum values, no new repository write function), and OAuth
> left scope. What remains is: a token subsystem, a protocol endpoint, three thin repository
> reads, one tool wrapping the *existing* import pipeline, one nullable log column, one bool
> setting, and tests/docs. That is **Medium** — and Phases 1–3 (read-only) are a Small-to-Medium
> slice that ships and is useful on its own. `plans/roadmap.md` is updated to match.
>
> Standing project rules apply in full: **no commit without an explicit ask**, **no real
> billed API call without an explicit ask** (§5.6 marks the only place one would be needed),
> **dev server off after any verification session**, and **ask before running any
> test/build/tsc check** (`CLAUDE.md` standing rules 1, 2, 3, 5).
>
> Addresses `plans/roadmap.md` NEXT item **MCP server exposing MyAgent's agents**.
> Independent of `plans/archive/11-second-llm-provider.md` and
> `plans/archive/12-ui-batch-launch-polish.md` (both archived — shipped) — but see §3
> constraint 9 for one small ordering interaction with Plan 11's fitness-function work.

---

## 1. What this plan is, in one paragraph

MyAgent stores a user's agents as structured data behind a browser session. This plan opens
a **second front door**: an MCP (Model Context Protocol) server, served by the same Next.js
process at `/api/mcp`, that lets a console-based MCP client — Claude Code and its
equivalents — list, read, export, and import *that user's* agents. It is authenticated by a
per-user bearer token the user generates in their Account page, not by the session cookie,
because an MCP client is not a browser. Every tool call resolves to the same repository
functions the web routes already use, with the same `ownerId` scoping and the same
flag-don't-block validation posture; the one tool that invokes an LLM goes through the same
gateway, dry-run toggle, and per-user hourly cap. The external model gets **no new powers over
the data than the user has in the browser** — in fact it gets strictly fewer, since structured
editing is not exposed at all.

**The two decisions that shape everything else:**

1. **The MCP tool layer is a consumer of the repository, not a fourth AI caller.** Three of the
   four tools make zero LLM calls and perform zero writes. The fourth (`import_agent`) calls
   Daedalus (or Hermes, in strict mode) because restructuring messy markdown is what the import
   pipeline *is* — and it goes through `lib/ai/gateway.ts` like everything else, carrying the
   token owner's `userId`, so the dry-run hard stop and the hourly cap apply unchanged. No MCP
   tool wraps Prometheus: an external Claude asking MyAgent's Claude to think would double-spend
   for reasoning the external client can already do itself.
2. **There is exactly one way to write, and it is the existing import pipeline.** No tool
   mutates sections, config, or the agent row directly. `import_agent` hands a markdown document
   to the same Stage-1 parse → Stage-2 caller → `upsertAgentFromImport()` path the browser's
   import dialog uses. That means the MCP surface inherits, for free and with no new code, the
   import pipeline's whole safety story: an owner-scoped name lookup, the pre-import and
   post-import snapshots, `reimport`-tagged revisions, `rawSourceSnapshot` retaining the
   submitted bytes, the coverage check that turns undetected content loss into a warning, the
   hard rejection of a truncated model response, and the byte-identical short-circuit that skips
   the AI call entirely on a no-op re-import.

---

## 2. Current state (verified by reading the code this session, 2026-08-15)

| Fact | Where | Why it matters here |
|---|---|---|
| Auth is a signed JWT (`jose`, HS256) in an `httpOnly` cookie; `getSession()` is the only cookie reader and re-reads `role` from the DB every call | `lib/auth/session.ts`, `lib/auth/jwt.ts` | **None of this extends to an MCP client.** There is no cookie, no browser, no redirect. A new credential type is genuinely required — this is not a case of reusing an existing mechanism with a different header. |
| `authenticate()` / `authenticateAdmin()` return a discriminated union `{ok:true,session}` / `{ok:false,response}`; every route opens with the same two lines | `lib/auth/guard.ts` | The MCP route needs a **third sibling** in the same shape (`authenticateMcpToken(request)`), so the codebase keeps exactly one guard idiom. |
| `middleware.ts` gates every non-public path on the session cookie and returns `401 {error:'unauthorized'}` for any unauthenticated `/api/*` | `middleware.ts:71-80` | **A bearer-token request to `/api/mcp` would be rejected by middleware before the handler ever runs.** `/api/mcp` must be added to the middleware bypass set. That is safe *by the file's own stated design* — its header says it "is NOT the authorization boundary" and every route handler independently establishes its own session — but it must be done deliberately and tested. |
| Fitness test: every `route.ts` outside `app/api/auth/` must contain `authenticate(` or `authenticateAdmin(` | `app/api/__tests__/route-guard.test.ts` (rule 1) | `app/api/mcp/route.ts` will contain **neither** — it will call `authenticateMcpToken(`. This test fails the moment the route is created. §4.8 extends it deliberately rather than loosening the regex. |
| Fitness test: no `'use client'` file may call a bare `fetch('/api/` — all client calls go through `apiFetch` | `route-guard.test.ts` (rule 4) | The Account-page token panel (§4.2) must use `apiFetch`, not raw `fetch`. |
| Every repository read/write of an owned row takes `ownerId` as a **required, never-defaulted** parameter, applied in the same statement | `lib/db/repository/agents.ts`, `groups.ts`; documented in `lib/db/CLAUDE.md` | Multi-tenancy is enforced at the data layer, so **the MCP tool layer inherits it for free** — there is no repository function that could return another user's agent even by mistake. Cross-owner reads return `404`, never `403`, because a `403` would confirm the row exists. |
| `repository/index.ts` is the only DB import surface outside `lib/db/` | `lib/db/repository/index.ts` | The MCP tool layer imports from the barrel exactly like a route does. **No new service layer is needed** — see §3 constraint 3. |
| `getAgentFull(id, ownerId)` returns the complete `AgentDTO`: config (each with its `ConfigDefLite`), sections (key/heading/content/order/version/`SectionDefLite`), and a derived `validation` block | `agents.ts:270`, DTO at `agents.ts:53-79` | This DTO **is** the read tool's payload. No new shape needs designing for `get_agent`. Note it already embeds each entry's catalog def — which is a large part of why a separate `get_blueprint` tool was dropped (§9). |
| `upsertAgentFromImport(ownerId, data)` does an **owner-scoped name lookup** and creates the agent when there's no match, updates in place when there is — never a duplicate, never an error | `agents.ts:602`, lookup at `:611-618` | **Verified: `import_agent` covers agent creation on its own.** This is why dropping the `create_agent` tool costs nothing — importing a document with a new `name` creates that agent, with `source:'imported'`. |
| The same function writes a `pre-import` snapshot of the prior state (on update), a `post-import` snapshot (always), tags changed sections `author:'reimport'`, retains revisions of deleted sections, and wraps the whole update path in one `db.transaction` | `agents.ts:620-660`, `:785-805`; function header at `:583-600` | **Verified: the reversibility mechanism for MCP-driven writes already exists and needs no new code.** The first draft of this plan invented a `writeAgentSnapshot()` export and a `'pre-mcp-write'` snapshot kind to back the now-dropped `apply_agent_changes`; with only `import_agent` writing, none of that is needed. See §4.6. |
| Structural import short-circuits before any AI call when the submitted bytes are byte-identical to the agent's stored `rawSourceSnapshot`, returning `{ skipped: 'unchanged' }` | `app/api/agents/import/route.ts:124-131` | Free and load-bearing for MCP: a client that re-imports the same file in a loop spends nothing after the first call. Worth an explicit test (§5.5). |
| `llm_call_log.kind` is `['import-strict','import-structural','chat']`; the gateway writes every row, applies the dry-run hard stop, then the per-user rolling-hourly cap (default 15, admin exempt, `userId: null` skips the gate) | `schema.ts:213-235`, `lib/ai/gateway.ts`, `lib/ai/CLAUDE.md` | An MCP-initiated import lands in this table automatically, and the cap meters it with no new code — which is exactly what D7 confirms. But nothing distinguishes it from a browser-initiated one: the same fidelity gap Plan 11 found with the never-written `provider` column. §4.7 adds `origin`. |
| The import route already accepts `dryRun: true`, which forces the gateway's dry-run path — it can only *downgrade* a live call, never cause one | `app/api/agents/import/route.ts:69-70`; `LlmCallContext.forceDryRun` in `lib/ai/gateway.ts` | `import_agent` exposes this verbatim. Note this is the *only* remaining meaning of `dryRun` in the plan — the first draft also used the word for "compute the write but don't persist it" on `apply_agent_changes`, and that ambiguity is gone with the tool. |
| `SETTING_DEFS` in `lib/settings.ts` drives storage parsing, the `PATCH /api/settings` allowlist, and the Settings UI from one array; accessors read fresh on every call with an asymmetric fail-safe (row absent → default; unparseable → safest value + `console.warn`) | `lib/settings.ts` | An `mcpWrites` kill switch is **one array entry plus one accessor** — no schema change, no route change. The `liveLlmCalls` precedent (money-spending defaults may only come from *absence* of configuration, never from configuration that failed to parse) is the pattern to copy. |
| The Settings UI can only render `bool` and `int` settings today | `app/components/Settings/SettingsView.tsx`; also documented as a gap in `plans/archive/11-second-llm-provider.md` §1 | `mcpWrites` is a `bool`, so this plan needs no new renderer. Noted only so nobody rediscovers it as a blocker. |
| Invite codes: `XXXX-XXXX-XXXX-XXXX` from a 31-symbol ambiguity-free alphabet via `crypto.randomInt`, stored **plaintext** so the admin can re-read and resend one | `lib/auth/inviteCode.ts`, `schema.ts:33` | The closest existing "generated credential" precedent — but **deliberately not reused** (§4.2): an invite code is human-transcribed and intentionally re-readable; an API token is machine-copied and must never be re-readable. Different requirements, different generator, different storage. |
| Rate limiting is in-process, fixed-window, 10 attempts / 15 min / `(route, client IP)`, guarding only login and signup | `lib/auth/rateLimit.ts` | `/api/mcp` is a **new unauthenticated-reachable endpoint** and would have no limiter at all. §4.3 reuses this module keyed by token id. Its documented limitations (per-process, resets on restart) are accepted here for the same stated reason. |
| Blueprint validation is **derived, never enforced**: `Rules.computeValidation()` produces flags (`descriptionMissing`, `unknownConfigKeys`, `outdatedOrUnknownValues`) that ride along in the DTO; nothing rejects a bad value | `lib/blueprint/rules.ts`, `AgentDTO.validation` | There is **no validation for an MCP tool to bypass.** The design principle "Flag, don't block" means the MCP tool layer must **surface** flags and must not invent enforcement the browser doesn't have. |
| `CONFIG_DEFS` is still code-owned (`lib/blueprint/catalog.ts`); `SectionDef` rows are DB-owned and admin-editable, read live via `getSectionDefs(platform)` | root `CLAUDE.md` "Folders" note; `repository/catalog.ts` | Relevant only as background now that `get_blueprint` is dropped — but it's the reason the import pipeline reads sections via `getSectionDefs()`, and `import_agent` must do the same (it does, by reusing the route's logic). |
| Stack: single Next.js app, Route Handlers, `better-sqlite3` (synchronous, Node-runtime-only), one process, one deploy unit | `docs/system-about.md` §1 | Rules out an Edge-runtime MCP route and rules out a separate MCP service that would need its own DB connection to the same SQLite file — the stray-process/SQLite-lock incident behind standing rule 3 is the cautionary precedent. |
| 8 migrations exist (`0000`–`0007`) | `lib/db/migrations/` | The next one is `0008`. (`docs/system-about.md` and `lib/db/CLAUDE.md` both still say "seven" — a stale count worth fixing in this plan's docs step, standing rule 7's spirit.) |

### 2.1 MCP protocol facts this plan relies on — **verify against the current spec at build time**

The Model Context Protocol moves faster than this repo does. The following are the load-bearing
assumptions; step 1 of §6 is explicitly a spec-read step, and any of these that has changed
changes the design *before* code is written, not after.

- **Two transports:** `stdio` (the server is a local child process of the client) and
  **Streamable HTTP** (a single HTTP endpoint accepting `POST` of JSON-RPC, optionally
  upgrading to SSE for server-initiated messages). The older "HTTP+SSE" two-endpoint
  transport is superseded.
- **Streamable HTTP may be stateless.** A server that never initiates messages and holds no
  per-connection state can answer each `POST` self-contained and omit the `Mcp-Session-Id`
  session mechanism entirely. §4.3 depends on this.
- **Servers must validate the `Origin` header** on HTTP transports to prevent DNS-rebinding
  attacks from browser-based callers, and should bind to localhost when local.
- **The spec's authorization story for remote servers is OAuth 2.1.** This plan does not
  implement it — D6 scopes the server to console clients that accept a custom header, where a
  static bearer token is the normal and sufficient configuration. See §9 for the one-line
  forward-compatibility note.
- **Client capability — the thing D6 turns on:** **Claude Code** can add a remote HTTP MCP
  server with an arbitrary custom header
  (`claude mcp add --transport http <name> <url> --header "Authorization: Bearer …"`), and
  console/CLI clients generally follow the same pattern. That is the target. GUI connectors
  built around the OAuth flow are out of scope.
- **Primitives:** *tools* (model-invoked functions), *resources* (application-supplied
  context, addressed by URI), and *prompts* (user-invoked templates). This plan uses tools and
  resources; it does not use prompts (§9).

---

## 3. Guiding constraints (locked — do not replan during build)

1. **The MCP layer is a consumer of the repository, not a new trust boundary over the data.**
   Every tool resolves to an existing `repository/index.ts` function with the token owner's
   `userId` as `ownerId`. No tool may build its own SQL, and no tool may take an owner id from
   the request — only from the resolved token, exactly as routes take it only from the session
   and never from the body.
2. **No new powers.** If the browser UI cannot do it, an MCP tool must not do it either. The
   MCP surface is a different *client*, never a privileged one. Corollary: an admin's token is
   not an admin API — there are no admin tools (no settings, no invite codes, no other users'
   logs), and `authenticateMcpToken()` never returns a role.
3. **No new service layer.** Routes call the repository directly today; the MCP tool layer does
   the same. Inserting a "domain service" purely because a second caller appeared would add an
   indirection the codebase has consistently declined to add.
4. **There is exactly one write path, and it is the existing import pipeline.** *(Rewritten
   after the D3 trim — the earlier version of this constraint governed a shared merge-write
   contract with the apply-proposal route, which no longer exists in this plan.)* No MCP tool
   calls `updateAgent`, `updateSectionContent`, `addSection`, `deleteSection`, or `deleteAgent`.
   The only mutation any tool can cause is `upsertAgentFromImport()`, reached through the same
   Stage-1 parse → Stage-2 caller → assemble sequence the browser's import uses. **This is
   enforceable by test**, not just by review: no file under `lib/mcp/` may reference any other
   mutating repository function (§4.8).
5. **Flag, don't block — unchanged, for exactly the same reasons.** MCP-supplied content gets
   no validation the browser doesn't apply. `get_agent` returns the derived `validation` block
   so the external model can *see* flags; the server never rejects on them. (Design principle
   "Flag, don't block": a malformed or unrecognized value is stored as-is and surfaced as a
   validation flag for the user to notice and fix, never corrected for them.)
6. **The choke point stays single.** `import_agent` goes `tool → existing import caller →
   gateway → provider`, carrying the token owner's `userId` in `LlmCallContext`. No MCP file
   may import a provider, and no MCP file may bypass `lib/ai/gateway.ts`. The gateway's fixed
   order — dry-run hard stop, then the per-user cap, then the provider call — applies to
   MCP-initiated calls byte-for-byte, and per D7 the cap is the *same* cap, with no
   MCP-specific limit.
7. **A credential is never re-readable and never logged.** A token's full value exists exactly
   once, in the HTTP response that created it. Only a SHA-256 hash and a display prefix are
   stored. No token, or any prefix long enough to be useful, may appear in a log line, an
   error body, an `llm_call_log` payload, or a tool response.
8. **Reversibility is inherited, not invented.** Every MCP-caused write is an import, and the
   import pipeline already leaves a complete trail: a `pre-import` snapshot of the prior state,
   a `post-import` snapshot of the result, `reimport`-tagged revisions on changed sections,
   retained revisions on deleted ones, and `rawSourceSnapshot` holding the submitted bytes.
   **This plan adds no new snapshot or revision mechanism** — it must verify the existing one
   fires on the MCP path (§5.5) rather than build a parallel one. See §4.6 for the one honest
   limitation this leaves.
9. **The one-importer discipline extends to the MCP SDK.** Exactly one file may import
   `@modelcontextprotocol/sdk`. If `plans/archive/11-second-llm-provider.md` has already generalized
   `lib/ai/__tests__/architecture.test.ts` into a package→owner table, this is one new table
   row; if not, this plan adds the table (§4.8). Either way it must be enforced by test, not
   convention.
10. **Default off, everywhere.** A deployment that never configures anything must behave
    exactly as it does today: no tokens exist, so `/api/mcp` answers `401` to everything;
    `mcpWrites` defaults to **off**, so even a `write`-scoped token cannot import until an
    admin turns writes on. Both gates must be crossed deliberately.

---

## 4. Implementation shape

### 4.1 Files

Note how much *isn't* here after the D3 trim: no `lib/mcp/applyChanges.ts`, no modification to
`app/api/agents/[id]/apply-proposal/route.ts`, and **no modification to
`lib/db/repository/agents.ts` at all** — no new snapshot export, no widened `author` parameter,
no new enum values.

| File | New/Mod | Role |
|---|---|---|
| `lib/db/schema.ts` | mod | New `apiToken` table (§4.7). Add nullable `origin` to `llmCallLog`. Nothing else — the `sectionRevision.author` and `agentSnapshot.kind` enums are **untouched** (the values the first draft would have added existed only for the dropped `apply_agent_changes`). |
| `lib/db/migrations/0008_*.sql` | **new** | `CREATE TABLE api_token` + its indexes, and `ALTER TABLE llm_call_log ADD COLUMN origin`. The only migration this plan needs. |
| `lib/db/repository/apiTokens.ts` | **new** | `createApiToken`, `listApiTokensForUser`, `findApiTokenByHash`, `touchApiTokenLastUsed`, `revokeApiToken`. Owns the `api_token` table exclusively. |
| `lib/db/repository/index.ts` | mod | Barrel re-exports for `apiTokens.ts` only. |
| `lib/auth/apiToken.ts` | **new** | Token *generation* + hashing. `generateApiToken()` → `{ plaintext, hash, prefix }`. No `server-only` guard and no secrets, matching `inviteCode.ts` — pure computation, directly testable. |
| `lib/auth/mcpGuard.ts` | **new** | `authenticateMcpToken(request)` → `{ok:true, principal}` / `{ok:false, response}`. The third sibling to `authenticate()`/`authenticateAdmin()`, in the identical discriminated-union shape. Parses `Authorization: Bearer`, hashes, looks up, checks revoked/expired, applies the rate limiter, touches `lastUsedAt`. Returns `McpPrincipal { userId, tokenId, scope }` — deliberately **no role** (constraint 2). |
| `lib/auth/rateLimit.ts` | mod | Generalize the existing fixed-window limiter's key from `(route, IP)` to an arbitrary string key so `('mcp', tokenId)` works. Behavior for login/signup must be unchanged. |
| `app/api/account/tokens/route.ts` | **new** | `GET` (list the caller's own tokens — prefix/name/scope/dates only, never the secret), `POST` (create; the **only** response that ever contains the plaintext). Session-authenticated with `authenticate()`; lives under `account/` because a token belongs to a user, not to the platform. Note the existing fitness rule: files under `app/api/account/**` must contain `authenticate(` and must **not** contain `authenticateAdmin(`. |
| `app/api/account/tokens/[id]/route.ts` | **new** | `DELETE` — revoke. Session-authenticated; only the caller's own token id is ever operated on. |
| `app/components/Account/AccountView.tsx` | mod | An "API tokens (MCP access)" panel: list, create (name + scope), one-time reveal with copy, revoke. Must use `apiFetch`, never bare `fetch` (fitness rule 4). Per standing rule 4, prototype in `architecture/layout/Layout-Workbench.html` first if this becomes more than a plain list + modal. |
| `app/api/mcp/route.ts` | **new** | The MCP endpoint. `POST` only (plus `GET`/`DELETE` returning `405`, per §4.3). Thin: authenticate → `Origin` check → hand the JSON-RPC body to `lib/mcp/server.ts` → return the response. `export const runtime = 'nodejs'` — `better-sqlite3` cannot run on Edge. |
| `lib/mcp/server.ts` | **new** | The **only** `@modelcontextprotocol/sdk` importer. Builds the server, registers the four tools and the resource handlers, wires the transport. Takes an `McpPrincipal` — never reads a session, never reads a header. |
| `lib/mcp/tools/listAgents.ts`, `getAgent.ts`, `exportAgent.ts`, `importAgent.ts` | **new** | One file per tool (§4.4). Each exports a name, a description, an input schema, and a handler `(principal, args) => result`. Pure of transport and of the SDK — directly unit-testable without a protocol round trip. |
| `lib/mcp/resources.ts` | **new** | `myagent://agent/{id}` resource listing + read (§4.5). Backed by the same two repository calls `list_agents` and `export_agent` use — no third data path. |
| `lib/import/…` / `app/api/agents/import/route.ts` | **read, likely refactor** | `import_agent` must not fork the import pipeline. Either extract the route's pipeline body into a shared function both the route and the tool call, or have the tool compose the same public pieces (`parse` → `callDaedalus`/`callHermes` → `assembleStructural`/`assemble` → `checkCoverage` → `upsertAgentFromImport`). **Decide at build time after reading the route**; the requirement is that the byte-identical short-circuit, the coverage check, the truncation rejection, and the snapshot writes all still happen — a second, thinner import path is the one way this tool could become unsafe. |
| `middleware.ts` | mod | Add `/api/mcp` to the bypass set — with a comment restating *why* it is safe (this file is explicitly not the authorization boundary; the route establishes its own principal) rather than citing a section number, per standing rule 6. |
| `lib/settings.ts` | mod | `mcpWrites` bool setting (default **false**) + `getMcpWrites()` accessor with the standard asymmetric fail-safe. |
| `lib/ai/gateway.ts` | mod | Thread an `origin: 'web' \| 'mcp'` field through `LlmCallContext` into both log-write paths (defaults to `'web'` when absent). Same shape as Plan 11's `provider` fix. |
| `app/api/__tests__/route-guard.test.ts` | mod | Extend rule 1 to a path→guard table so `app/api/mcp/route.ts` requires `authenticateMcpToken(` (§4.8). |
| `lib/ai/__tests__/architecture.test.ts` | mod | One-importer entry for `@modelcontextprotocol/sdk` → `lib/mcp/server.ts`, plus the two new `lib/mcp/` containment assertions (§4.8). |
| `lib/mcp/__tests__/*`, `lib/auth/__tests__/apiToken.test.ts`, `lib/auth/__tests__/mcpGuard.test.ts`, `lib/db/repository/__tests__/apiTokens.test.ts`, `app/api/__tests__/mcp*.test.ts` | **new** | §5. |
| `.env.example`, `README.md`, `docs/user-guide.md`, `docs/system-about.md`, `docs/roadmap.md`, `lib/auth/CLAUDE.md`, `lib/db/CLAUDE.md`, `CHANGELOG.md`, `plans/roadmap.md` | mod | §6 step 7. A new `lib/mcp/CLAUDE.md` is warranted — this folder is genuinely worth explaining (global instruction: a subfolder gets its own `CLAUDE.md` when the folder actually warrants it). |

### 4.2 The credential: per-user Personal Access Tokens

**Format.** `mya_` + 43 characters of base64url from 32 cryptographically random bytes
(`crypto.randomBytes(32)`). The prefix is a courtesy to secret scanners and to a human
eyeballing an env file, not a security property.

**Deliberately not reusing `lib/auth/inviteCode.ts`**, despite it being the closest existing
generated-credential precedent. An invite code is typed by a human from an email, so it uses a
31-symbol alphabet that excludes `I`, `L`, `O`, `0`, `1` and is stored **in plaintext on
purpose** so the admin can re-read and resend it. An API token is copied by machine and must
never be re-readable by anyone, including the admin. Same shape of problem, opposite
requirements — sharing the generator would drag one file's constraints onto the other.

**Storage: SHA-256 of the full plaintext, hex, `UNIQUE`-indexed.** Not bcrypt, and this is a
considered break from `lib/auth/password.ts`'s bcrypt-cost-10:

- A password is low-entropy and human-chosen; a slow KDF exists to make offline guessing
  expensive. A 256-bit random token is not guessable, so key stretching buys nothing.
- Bcrypt cannot be looked up — it must be compared against a candidate row, so a bcrypt token
  store means either scanning every token or carrying a second lookup key anyway.
- Bcrypt truncates at 72 bytes, which `password.ts` already guards against with an explicit
  length check; a fixed-length token dodges the issue but the asymmetry is worth naming.
- Cost matters: bearer auth runs on **every** tool call, where password verification runs once
  per login.

Lookup is by the hash as an index key, so there is no string-comparison timing oracle to close.

**Row shape** (`api_token`, §4.7): `id`, `ownerId`, `name` (user's label, e.g. "laptop Claude
Code"), `tokenHash`, `prefix` (first 12 chars of the plaintext — enough to identify, useless to
replay), `scope` (`'read'` | `'write'`), `createdAt`, `lastUsedAt` (nullable), `expiresAt`
(nullable — null means never), `revokedAt` (nullable).

**Lifecycle.** Created in Account → plaintext returned exactly once in the `201` body → the UI
shows it with a copy button and a "you will not see this again" notice → thereafter only the
prefix is ever rendered. Revocation is a soft delete (`revokedAt`), not a row delete, so a
revoked token's `lastUsedAt` remains available as evidence of what happened. A per-user cap
(suggest 10 active tokens) prevents unbounded accumulation.

**`authenticateMcpToken(request)`** — the guard, in the established discriminated-union shape:

1. Read `Authorization`. Missing or not `Bearer` → `401` with a `WWW-Authenticate: Bearer` header.
2. SHA-256 the presented value; `findApiTokenByHash`.
3. No row, `revokedAt` set, or `expiresAt` in the past → `401`. **All three collapse to one
   indistinguishable response** — same non-disclosure posture as the repo's cross-owner `404`.
4. Rate limiter, keyed `('mcp', tokenId)` → `429` with `Retry-After`.
5. `touchApiTokenLastUsed(tokenId)` (best-effort; a failure here never fails the request — same
   reasoning as the gateway swallowing a log-write failure on a live call).
6. Return `{ userId, tokenId, scope }`.

The guard never reads `role`. An admin's token is an ordinary user's token (constraint 2).

### 4.3 Transport and hosting

**Stateless Streamable HTTP at `POST /api/mcp`, inside the existing Next.js app.**

- **Same process, same deploy unit.** The agents live in a SQLite file this process already
  holds open, with WAL mode and a single `better-sqlite3` singleton. A separate MCP service
  would need a second connection to the same file — precisely the multi-process/SQLite-lock
  situation that produced a hung `/export` route and became standing rule 3.
- **Node runtime, mandatory.** `export const runtime = 'nodejs'`. `better-sqlite3` is a native
  module; the Edge runtime cannot open it — the same constraint that keeps `middleware.ts`'s
  import graph free of `node:*` and `lib/db`.
- **Stateless.** No `Mcp-Session-Id`, no long-lived SSE stream, no server-initiated messages.
  Every `POST` carries a JSON-RPC request, is authenticated on its own, and returns a JSON
  response. Three concrete reasons: the tool set is small and each call is self-contained; a
  stateless endpoint survives a future multi-instance deploy with no shared state (a gap
  `docs/system-about.md` §12 already names — "a single deployment runs one process"); and a
  long-lived SSE connection through a serverless/proxy host is the exact failure mode Plan 11
  flags for large non-streaming requests. `GET /api/mcp` and `DELETE /api/mcp` return `405`
  with a clear message rather than 404, so a client probing for the SSE upgrade gets a
  comprehensible answer.
- **`Origin` validation.** Reject any request carrying an `Origin` header that isn't an
  explicitly allowed value. Legitimate console MCP clients are not browsers and send no
  `Origin`; a present-and-unexpected `Origin` is the DNS-rebinding signature the spec warns
  about. **No CORS headers are emitted** — there is no browser client for this endpoint, and
  adding permissive CORS would be the single easiest way to turn a token leak into a drive-by.
- **Middleware bypass.** `/api/mcp` joins the bypass set in `middleware.ts`. Its existing
  header already states the correct rationale — that middleware is a coarse gate, not the
  authorization boundary, and that every route handler independently establishes its own
  session — so this is consistent with the file's design rather than an exception to it. A test
  asserts an unauthenticated `POST /api/mcp` gets `401` **from the route**, not from middleware.
- **Client reach (D6).** Claude Code attaches this with `claude mcp add --transport http … 
  --header "Authorization: Bearer …"`, and console/CLI clients generally follow that pattern.
  GUI connectors that require the OAuth flow are out of scope; there is no bridge, shim, or
  fallback in this plan for them (§9).

### 4.4 The tool surface

**Four tools.** Each name is what the external model sees (Claude Code presents them as
`mcp__myagent__<name>`), so the names are written for a model reading a list, not for internal
consistency with route paths.

| # | Tool | Scope | Input | Returns | Backed by | LLM? |
|---|---|---|---|---|---|---|
| 1 | `list_agents` | read | — | `[{ id, name, description, source, platform, updatedAt }]` | `listAgents(ownerId)` | no |
| 2 | `get_agent` | read | `{ agentId }` | Full structured agent: `description`, `config[]` (each with its catalog def), `sections[]` (`sectionKey`/`heading`/`content`/`order`), and the derived `validation` block | `getAgentFull(id, ownerId)` | no |
| 3 | `export_agent` | read | `{ agentId }` | The deterministic exported `.md` text | `exportAgentMarkdown(id, ownerId)` | no |
| 4 | `import_agent` | **write** | `{ md, mode?: 'structural'\|'strict', dryRun?: boolean }` | The resulting agent + coverage `warnings[]`, or `{ skipped: 'unchanged' }` | the existing import pipeline → `upsertAgentFromImport` | **yes** |

**Why `get_agent` and `export_agent` are both present.** They are different products for
different questions. `get_agent` gives the model addressable structure — it can reason about
`sections.guardrails` because it knows that key exists, and it sees the validation flags.
`export_agent` gives the user a file they can drop into `~/.claude/agents/`, and it is the
deterministic, no-AI, no-judgment path (design principle: "import is AI-assisted; export is
deterministic"). Merging them would force the model to re-parse markdown to find a section key
it could have been handed.

**Why `import_agent` is the whole write surface, and why that's enough.** The natural console
workflow is round-trip through a file: `export_agent` → the external model edits the markdown
in its own context (or the user edits it on disk) → `import_agent` puts it back. That reuses
the pipeline built precisely for "turn a markdown agent file into structured data safely,"
including the AI-assisted restructure, the coverage check that warns on undetected content
loss, and the hard rejection of a truncated model response. `upsertAgentFromImport`'s
owner-scoped name lookup means a *new* name creates a new agent and a *matching* name updates
in place — **verified in the code, and the reason no separate `create_agent` tool is needed**.

**`dryRun` on `import_agent`** is the existing route's flag, passed through verbatim: it forces
the gateway's dry-run path, which can only ever *downgrade* a live call and never cause one. It
means "don't spend money," not "don't write" — and with `apply_agent_changes` gone, that is the
only meaning the word carries anywhere in this plan.

**Tool descriptions are documentation for a model, and are part of the attack surface.** Each
description states what the tool does and what it will refuse; none contains imperative
instructions the model could be steered into treating as policy, and none echoes user content.
Agent content returned by tools 2 and 3 is wrapped in a clearly delimited block labeled as
*data*, with a one-line note that it is user-authored content and not instructions — the
cheapest available mitigation for the real prompt-injection vector here (see D2).

### 4.5 Resources

Beyond tools, expose each agent as an MCP **resource**:

- `resources/list` → one entry per agent: `uri: myagent://agent/{id}`, `name`, `description`,
  `mimeType: 'text/markdown'`. Same `listAgents(ownerId)` call as tool 1.
- `resources/read` → the exported `.md` text. Same `exportAgentMarkdown(id, ownerId)` call as
  tool 3.

This is roughly 30 lines and buys a genuinely different interaction: a user can *attach* an
agent as context in a client that supports resource pickers, with no tool call and no model
decision involved. Read scope only; there is no resource write, and no resource surfaces the
blueprint or anything other than a user's own agents.

### 4.6 Attribution and reversibility for `import_agent` — inherited, with one honest gap

The first draft of this plan invented a pre-write snapshot mechanism (a new
`writeAgentSnapshot()` repository export, a `'pre-mcp-write'` snapshot kind, and an `'mcp'`
value on `SectionRevision.author`) to make the dropped `apply_agent_changes` reversible. With
`import_agent` as the only writer, **none of that is needed** — verified by reading
`upsertAgentFromImport` rather than assumed. Every MCP-caused write already produces:

- a **`pre-import` snapshot** of the agent's complete prior state, when the import updates an
  existing agent;
- a **`post-import` snapshot** of the result, always;
- **`reimport`-tagged `SectionRevision` rows** on every changed or new section;
- **retained revisions** for sections the import removed (revision rows are a soft reference and
  are never cascade-deleted);
- **`rawSourceSnapshot`** holding the submitted bytes verbatim, independent of how they were
  later sliced into sections;
- all of it inside **one `db.transaction`** on the update path.

**The one gap, stated plainly:** a `SectionRevision` written by an MCP-initiated import is
tagged `reimport` — **indistinguishable from a browser-initiated import**. The only place the
MCP origin is recorded is the `llm_call_log` row's new `origin: 'mcp'` column (§4.7), plus the
token's `lastUsedAt`.

**Judgment call: accept this.** Adding an `'mcp-import'` author value would mean threading a
caller-origin parameter through `upsertAgentFromImport` and the section-reconciliation loop —
forking the import pipeline's tagging for a distinction that the call log already records at
the moment of the call. The trade is real but small: correlating a revision to its origin
requires matching timestamps against the log rather than reading one column, and a dry-run
import writes no agent data at all so there is nothing to correlate. If per-revision MCP
attribution later turns out to matter (an audit requirement, or a user asking "which of these
edits came from my terminal?"), it is an additive one-value change then — the same
"stays additive" property that made the first draft's version of this cheap. Recorded in §9 as
a deliberate omission, not an oversight.

### 4.7 Gates, kill switches, and schema

**Three independent gates** stand between an external model and a write. Each can be closed
without touching the others, and all three must be open. The write tool is `import_agent`:

| Gate | Where | Default | Who controls it | Turning it off |
|---|---|---|---|---|
| Token existence | `api_token` rows | none exist | the user | Revoke in Account — instant, one row |
| Token scope | `api_token.scope` | `read` at creation unless the user picks `write` | the user | Revoke and reissue as `read` |
| `mcpWrites` setting | `SETTING_DEFS` | **false** | the admin | One Settings toggle — no deploy, no restart, applies on the next call |

A `write`-scoped token calling `import_agent` while `mcpWrites` is off gets a clear, typed
refusal naming the setting — a hard, visible stop, never a silent no-op, and **before** any LLM
call is made. That mirrors the dry-run posture exactly: the blocked call is structurally
distinct from a successful one, and the user is told why.

`import_agent` additionally passes through the LLM gateway, which applies the **dry-run hard
stop** (when "Live LLM calls" is off, zero network bytes leave the process and the would-be
request is still logged) and then the **per-user rolling-hourly cap** — per D7, the *existing*
`getMaxLlmCallsPerUserPerHour()` (default 15, admin-exempt, no log row written on a cap denial
because the log table itself is the counter), with **no MCP-specific cap setting**. Neither
needs new code. But note the shift in significance: today the cap is belt-and-braces behind a
browser UI a human is driving; with MCP it becomes the primary defense against a loop in an
external client burning the platform's Anthropic budget. It stops being a nice-to-have, and
that is worth restating wherever the cap is documented.

**Schema changes** — one new table and one new column, migration `0008`:

```
api_token
  id           text PK            (uuid)
  owner_id     text NOT NULL      soft ref → user.id  (schema convention: no FK cascade)
  name         text NOT NULL      user's own label
  token_hash   text NOT NULL      sha256 hex — UNIQUE index (the lookup key)
  prefix       text NOT NULL      first 12 chars of the plaintext, display only
  scope        text NOT NULL      'read' | 'write'
  created_at   integer NOT NULL   default unixepoch()
  last_used_at integer            nullable
  expires_at   integer            nullable — null = never
  revoked_at   integer            nullable — soft delete, never a row delete
  indexes: unique(token_hash), index(owner_id)
```

`llm_call_log` gains `origin text` (nullable, or `NOT NULL DEFAULT 'web'`). Same lesson Plan 11
learned the hard way with the never-written `provider` column: the moment a second source of
calls exists, an audit log that can't tell them apart is *actively wrong*, not merely
incomplete. Write it from day one of Phase 4 — before any MCP call can reach the gateway, not
after.

**No other schema change.** No enum values added, no backfill, no existing row affected.

### 4.8 Fitness functions — extend the tables, don't add exceptions

Two existing fitness tests break or go quiet if this is done carelessly:

1. **`app/api/__tests__/route-guard.test.ts` rule 1** asserts every `route.ts` outside
   `app/api/auth/` contains `authenticate(` or `authenticateAdmin(`. `app/api/mcp/route.ts`
   contains `authenticateMcpToken(` instead. **Do not widen the regex** — `authenticate(` is a
   substring of `authenticateMcpToken(` only by accident of naming, and a rule that passes by
   coincidence is a rule that has stopped testing anything. Replace it with an explicit
   path→required-guard table:

   | Path prefix | Required guard |
   |---|---|
   | `app/api/auth/**` | none (public by design) |
   | `app/api/settings/**`, `app/api/llm-call-log/**` | `authenticateAdmin(` |
   | `app/api/account/**` | `authenticate(` **and not** `authenticateAdmin(` |
   | `app/api/mcp/**` | `authenticateMcpToken(` **and not** `authenticate(` |
   | everything else | `authenticate(` or `authenticateAdmin(` |

   The "and not `authenticate(`" clause on the MCP row is the mirror of the existing `account/`
   rule that forbids `authenticateAdmin(` — it stops a copy-paste from a neighboring route from
   silently making the MCP endpoint accept a browser cookie.

2. **One-importer enforcement for `@modelcontextprotocol/sdk`** → `lib/mcp/server.ts` only. If
   Plan 11 already converted `lib/ai/__tests__/architecture.test.ts` to a package→owner table,
   add a row. If not, this plan builds the table (and should, since a hardcoded second
   exception is how that rule stops scaling).

**Three new assertions worth adding in the same pass**, all cheap, each guarding a constraint
this plan depends on and nothing currently checks:

- **No file under `lib/mcp/` references any mutating repository function other than
  `upsertAgentFromImport`** — specifically not `updateAgent`, `updateSectionContent`,
  `addSection`, `deleteSection`, `createAgent`, or `deleteAgent`. This is constraint 4 made
  executable, and it is the assertion that keeps a future session from quietly re-adding the
  structured-write surface this plan deliberately dropped.
- No file under `lib/mcp/` imports `lib/ai/anthropicProvider` or any provider file (constraint
  6 — the gateway is the only route to a model).
- No file under `lib/mcp/` reads `next/headers` or the session cookie — the MCP principal comes
  from a token, never from a browser session, and the two auth models must never
  cross-contaminate.

---

## 5. Testing approach

All of the below is mocked and free. §5.6 is the one place a real call would be needed, and it
is gated on an explicit ask.

### 5.1 Unit — token generation and hashing (`lib/auth/__tests__/apiToken.test.ts`)
- Generated tokens are unique across many iterations and match the expected format/length.
- The same plaintext always hashes to the same value; different plaintexts never collide.
- `prefix` is derived from the plaintext and is short enough to be non-replayable.
- The plaintext appears in the generator's return value and **nowhere else** — assert the
  hashed record contains no substring of the plaintext beyond the prefix.

### 5.2 Repository (`lib/db/repository/__tests__/apiTokens.test.ts`, in-memory DB)
- Create → `findApiTokenByHash` returns it; a wrong hash returns nothing.
- A revoked token is still findable as a row but is flagged revoked (the guard, not the
  repository, decides what that means). Same for an expired one.
- `listApiTokensForUser` returns only that user's tokens and **never** the hash — a cross-owner
  leak test in the same spirit as the existing `llmCallLog-redaction.test.ts`.
- `touchApiTokenLastUsed` updates only the target row.

### 5.3 The guard (`lib/auth/__tests__/mcpGuard.test.ts`)
- No header / wrong scheme / unknown token / revoked / expired → all `401`, and all **the same
  body** (no oracle distinguishing "revoked" from "never existed").
- Valid token → the principal carries the right `userId` and `scope`, and carries **no role
  field at all** (constraint 2, asserted structurally so a future refactor can't quietly add
  one).
- Rate limiter: N+1 calls with one token → `429` + `Retry-After`; a *different* token in the
  same window is unaffected.
- No log line or error body contains the presented token — assert against captured `console.*`
  output.

### 5.4 Read tools (`lib/mcp/__tests__/`, in-memory DB, no protocol round trip)
Each tool handler is called directly with a principal. The cases that matter:
- **Tenancy, per tool.** User A's token can never list, read, or export user B's agent — every
  read returns empty or not-found. This is the single most important suite in the plan and
  should mirror the structure of the existing `app/api/__tests__/tenancy.test.ts`.
- **Scope.** A `read` token calling `import_agent` is refused. A `write` token calling a read
  tool succeeds (write is a superset).
- `get_agent` returns the derived `validation` block, and an invalid `model` value or unknown
  config key is **flagged, not rejected** — the flag-don't-block principle asserted at the new
  surface rather than assumed to carry over.
- `export_agent` and the `myagent://agent/{id}` resource read return byte-identical text for the
  same agent (they must share one code path — a divergence here means someone added a second
  export).
- `list_agents` and `resources/list` cover the same agent set.

### 5.5 The write tool and the import pipeline (`lib/mcp/__tests__/importAgent.test.ts`)
Provider mocked at the module level, running the real gateway and the real assemble/persist path
— the pattern `app/api/agents/__tests__/import-dryrun.test.ts` already uses.
- **`mcpWrites: false`** → refusal with the typed, named error, **no LLM call attempted**, and
  **no agent row created or modified** (assert on the agent count and `updatedAt`, not merely on
  the response text).
- **New name → creates** an agent with `source:'imported'`; **matching name → updates in place**,
  never duplicates. This is the test that stands in for the dropped `create_agent` tool.
- **Snapshot trail (constraint 8, inherited not invented):** after an MCP import that updated an
  existing agent, a `pre-import` snapshot of the prior state and a `post-import` snapshot of the
  result both exist, and changed sections carry `author:'reimport'` revisions. Asserting this on
  the MCP path is the point — the mechanism is the import pipeline's, but nothing else proves the
  tool actually goes through it.
- **Byte-identical re-import short-circuits** to `{ skipped: 'unchanged' }` with **zero** LLM
  calls. Cheap, and it's the property that stops a looping client from spending.
- **Cross-owner safety:** user A importing a document whose frontmatter `name` collides with user
  B's agent creates A's own agent and leaves B's untouched (the lookup is owner-scoped).
- Dry-run: `dryRun: true` produces the gateway's hard stop, one log row with `dryRun: true`, and
  **the provider is never invoked**.
- Truncated model response → the same hard rejection the browser import gives; nothing persisted.
- Coverage warnings are passed through to the tool result rather than swallowed.

### 5.6 Route / protocol (`app/api/__tests__/mcp*.test.ts`)
- Unauthenticated `POST /api/mcp` → `401` **from the route handler**, proving the middleware
  bypass did not create a hole and that the route is not relying on middleware.
- A valid session cookie with **no** bearer token → still `401`. The two auth models are disjoint
  on purpose; a browser session must not authenticate an MCP call.
- `tools/list` returns exactly the four expected names — **all four, regardless of the token's
  scope.** Scope is enforced at call time, not by hiding tools, so a `read` token's model gets a
  comprehensible refusal ("this token is read-only") instead of a mysteriously absent tool it
  then invents a workaround for.
- `tools/call` with an unknown tool name → a proper JSON-RPC error, not a 500.
- Malformed JSON-RPC → a proper protocol-level error.
- A request with an unexpected `Origin` header → rejected.
- `GET /api/mcp` → `405` with a comprehensible message.
- `import_agent` past the per-user cap → the `429`-equivalent tool error carrying
  `retryAfterSeconds`, and no log row (the log table is the counter). Asserts D7's "same cap"
  answer concretely.
- Log rows from MCP-initiated calls carry `origin: 'mcp'`; browser-initiated ones carry `'web'`.
  New regression coverage for a column that would otherwise be uniformly wrong.

### 5.7 Live verification — **requires an explicit user go-ahead for the billed step**
- **Free, and worth doing thoroughly:** connect a real console client, complete the handshake,
  run `tools/list`, all three read tools, the resource list/read, and an `import_agent` call with
  `dryRun: true`. A protocol implementation that passes unit tests and still fails a real client
  handshake is a common outcome, and none of this costs anything.
- **Billed, ask first (standing rule 2):** one real `import_agent` call, confirming the
  end-to-end path and that the resulting `llm_call_log` row carries the right `userId`,
  `origin: 'mcp'`, `provider`, `model`, and usage.
- Per standing rule 3, shut the dev server down afterward.

---

## 6. Implementation sequence

| # | Phase / step | Depends on | Notes / risk |
|---|---|---|---|
| 1 | **Spec + client reconnaissance.** Read the current MCP spec revision; confirm every assumption in §2.1 (stateless Streamable HTTP, `Origin` rule). Confirm what Claude Code and the other target console clients accept for a remote server *today*. Pin the SDK version. | — | Cheap and non-negotiable. Any change here changes the design **before** code exists. Narrower than the first draft's version of this step, since GUI/OAuth clients are no longer in scope. |
| 2 | **Token subsystem, end to end.** `api_token` in the schema + migration `0008`, `repository/apiTokens.ts`, `lib/auth/apiToken.ts`, `lib/auth/mcpGuard.ts`, the rate-limiter key generalization, the two `account/tokens` routes, the Account UI panel. | 1 | **Ships and is testable with zero MCP code** — you can `curl` a bearer-protected stub. Doing this first means the protocol work never has to reason about auth. Risk: the Account UI is the only visual surface; prototype in `Layout-Workbench.html` first if it grows past a list + modal (standing rule 4). |
| 3 | **Read-only MCP server.** `lib/mcp/server.ts`, `app/api/mcp/route.ts`, the middleware bypass, tools 1–3, resources, all fitness-function extensions (§4.8 — including the "no mutating repository function" assertion, which should land *now*, while `lib/mcp/` genuinely has no writer, rather than after step 4 makes it a carve-out). | 2 | **A shippable, genuinely useful product on its own** — "Claude, read my `code-reviewer` agent and tell me what's weak about its guardrails" works, with zero write risk and zero LLM spend. If the project needs to stop somewhere, stop here. |
| 4 | **`import_agent`.** In order: `llm_call_log.origin` column + `LlmCallContext` threading **first**; then `mcpWrites` setting + accessor + Settings row; then the tool itself, reusing the existing import pipeline (see §4.1's note on extracting vs. composing). | 3 | Ordering mirrors Plan 11's step 1: land the audit-log fidelity fix *before* the thing that makes the log ambiguous, or every early MCP-initiated call is misattributed forever. This phase is much smaller than the first draft's Phase 4+5 combined — there is no write-contract extraction and no change to the apply-proposal route. |
| 5 | **Free live verification** — connect a real console client; handshake, `tools/list`, all read tools, resources, `import_agent` with `dryRun: true`. No spend. | 4 | Shut the dev server down after (standing rule 3). |
| 6 | **Billed live verification — ask first.** One real `import_agent` call. | 5 | §5.7. Standing rule 2: state the call and the cost, wait for an explicit go-ahead. |
| 7 | **Docs.** `lib/mcp/CLAUDE.md` (new), `lib/auth/CLAUDE.md`, `lib/db/CLAUDE.md` (also fix its stale "seven migrations" count), `docs/system-about.md` (auth section, data model, known gaps), `docs/user-guide.md` (how to connect a console client), `docs/roadmap.md`, `.env.example`, `README.md`, `CHANGELOG.md`, and close the roadmap item. | 2–6 | Standing rule 6: restate each rule inline at the citation site; never leave a bare section number. |

**Rollback, per gate:** revoke the token (one row, instant, user-controlled); or flip
`mcpWrites` off (one Settings row, no deploy, applies on the next call); or flip "Live LLM
calls" off (blocks `import_agent` at the gateway while leaving all three read tools working).
The whole feature can be neutralized without a deploy — which is why all three gates are
runtime state rather than environment variables.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **A leaked token is a full account compromise for agent data**, with no browser session to expire and no password prompt in the way | Hashed at rest; shown once; revocable instantly; `lastUsedAt` makes an unused-then-suddenly-used token visible; scope defaults to `read`; optional expiry; per-token rate limit. Documented plainly in the user guide — a user who pastes a token into a shared config file needs to *know* what it grants. |
| 2 | **An MCP import replaces an agent wholesale and surprises the user.** `upsertAgentFromImport` deletes and re-inserts all config rows and reconciles sections against the incoming document — a section absent from the submitted file is deleted | This is the *correct, documented* import semantic (a re-import is "this file is now the agent"), not a bug — but it is a much blunter instrument than the structured editing the dropped `apply_agent_changes` would have offered, and the tool description must say so in plain words. Recovery is real and automatic: the `pre-import` snapshot, the retained revisions of deleted sections, and `rawSourceSnapshot`. |
| 3 | **Prompt injection via agent content.** A section body could contain "ignore previous instructions…" and the external client's model will read it as part of a tool result | Not fully solvable from the server side, and this plan should not pretend otherwise. Mitigations: returned content is wrapped and labeled as data, not instructions; tool descriptions carry no imperative policy a model could be steered into overriding. The trimmed surface helps materially — the only write is "import a markdown document," so a successful injection's best case is a *recoverable* bad import of content the user's own client supplied, not silent field-level edits and not exfiltration. Ownership scoping means injected content can never reach another user. |
| 4 | **The middleware bypass becomes a hole** if `/api/mcp` is added with a broad prefix or if a future route lands under it without its own guard | Exact-path bypass, never a wide prefix (the existing `/api/auth/oauth/` entry is deliberately narrow for the same reason). Fitness table entry for `app/api/mcp/**` (§4.8). A route test asserting `401` comes from the handler, not the middleware. |
| 5 | **An external client loops** — retry storm, or an agentic loop calling `import_agent` repeatedly | Three layers: the byte-identical short-circuit makes a repeated identical import free after the first; the shared per-user hourly LLM cap covers spend (D7); the per-token rate limiter covers request volume. Both limiters are in-process, so a multi-instance deploy multiplies the effective limit — the same accepted limitation already documented for the login limiter, and it should be restated where the MCP limiter is defined rather than assumed. |
| 6 | **The MCP spec changes** and the implementation silently falls behind a client's expectations | Step 1 pins a spec revision and an SDK version and writes both into `lib/mcp/CLAUDE.md`. Protocol handling stays in one file so a version bump is one file's problem. |
| 7 | **A future session re-adds structured writes** (a "small" `patch_config` tool), reintroducing the config full-replace hazard this scope deliberately avoided | Constraint 4 plus the executable version of it: the §4.8 assertion that no file under `lib/mcp/` references any mutating repository function except `upsertAgentFromImport`. Landing that assertion in Phase 3, before any writer exists, is the cheap moment to do it. |
| 8 | **The import pipeline gets forked.** `import_agent` reimplements a thinner version of the route's logic and quietly loses the coverage check, the truncation rejection, or the short-circuit | §4.1's explicit instruction to extract or compose, never reimplement, and §5.5's tests that assert each of those behaviors *on the MCP path* specifically. |
| 9 | **Per-revision MCP attribution is absent** — an MCP-initiated import's revisions look exactly like a browser one's | Accepted, with reasoning, in §4.6. `llm_call_log.origin` plus the token's `lastUsedAt` carry the origin; adding an `'mcp-import'` author value later is additive. |
| 10 | **SQLite write contention** once a second client type writes concurrently | Writes are short, synchronous, single-process, and WAL is already on. Stateless HTTP means no long-held connection. Watch it; don't pre-optimize. |
| 11 | **Scope creep into an admin API** — "while we're here, expose settings/invite codes over MCP" | Constraint 2, and §9 names it explicitly as out of scope. |
| 12 | **A new npm dependency** (`@modelcontextprotocol/sdk`) adds supply-chain and bundle surface | Confined to one file behind a fitness function; server-only, so it never reaches a client bundle. The alternative — hand-rolling JSON-RPC, which is genuinely small — is a real option if the dependency is unwelcome; see D3's note. |

---

## 8. Decisions

All seven are resolved. D3, D6, and D7 were settled by the user on 2026-08-15; D1, D2, D4, and
D5 are recommendations with no open sub-questions.

### D1 — How does an MCP client prove it is acting for a specific MyAgent user? ✅ Option A

**Per-user Personal Access Tokens (opaque bearer).** With D6 scoping this to console clients
that accept a custom header, this is not a stepping stone — it is the complete answer for the
target use case.

| Option | Pros | Cons |
|---|---|---|
| **A. Per-user PAT, bearer header** *(chosen)* | Fits the existing multi-tenant model with no new concepts — a token resolves to a `userId`, which is what every repository function already wants; zero new dependencies; the user's mental model ("generate a token, paste it into your client config") is universally understood; instantly revocable; scopeable; **works with Claude Code today** | Not what the MCP spec prescribes for the general remote-server case; a long-lived credential lives in a client config file |
| **B. Full OAuth 2.1 AS** (auth code + PKCE + dynamic client registration + protected-resource metadata) | The standards-correct answer; what GUI connectors expect; short-lived access tokens with refresh; per-client consent | A **large** subsystem on top of a custom JWT stack with no OAuth-server library in the dependency list. **Out of scope entirely per D6** — the clients that require it aren't targets |
| **C. Device-code flow** | Nice UX for a headless client; no secret typed into a config file | Still an OAuth server (device + token endpoints, polling, user-code entry page) — most of B's cost, and D6 removes the payoff |
| **D. Reuse the session cookie** | Zero new code | Does not work. An MCP client is not a browser, has no cookie jar for this origin, cannot complete a login redirect, and the session JWT is short-lived by design. Listed only to record that it was considered and is not viable |

The seam remains clean if OAuth is ever wanted: `authenticateMcpToken()` resolves *a bearer
credential* to an `McpPrincipal{ userId, tokenId, scope }`, and an OAuth access token would be
one more branch inside that one function, with nothing in the tool layer or transport changing.
That is a note, not a plan — see §9.

### D2 — Does an external LLM writing agent configs need the propose/review gate Prometheus has? ✅ No card; gates + inherited reversibility

The in-app chat needs the card because of *where the human is standing*. In the browser, the
user types an instruction, the model answers, and the card is the only moment the user sees
concretely what would change before it changes — MyAgent controls that entire surface.

Over MCP, MyAgent controls **none** of the surface. Reproducing the card would mean a stateful
"pending proposal" the external model must be trusted to fetch and present faithfully — strictly
*worse* than not having one, because it looks like a safeguard while depending entirely on the
untrusted party's cooperation. (Today's in-app proposal lock is already only client-side and
cooperative, a documented and accepted tradeoff; the MCP version would be cooperative with a
client that isn't even ours.)

What genuinely protects the user:

| Mechanism | What it actually guarantees |
|---|---|
| **Token scope** (`read` default, `write` opt-in) | The user made a deliberate, out-of-band, browser-side decision to allow writes at all. This *is* the consent gate — once, up front, instead of per turn |
| **`mcpWrites` admin setting**, default off | Platform-level kill switch, one row, no deploy |
| **The import pipeline's own snapshot trail** | `pre-import` + `post-import` snapshots, `reimport` revisions, retained history on deleted sections, `rawSourceSnapshot`. Inherited, not built (§4.6) |
| **A single, coarse, well-understood write verb** | The only mutation is "import this document." There is no field-level write surface to abuse — a consequence of the D3 trim, and arguably the largest safety gain in this revision |
| **Ownership scoping in the repository** | An injected or confused model still cannot touch another user's data. Structural, not behavioral |

MCP clients generally *do* prompt before invoking a tool, but auto-approve modes exist and are
widely used, so this plan treats client-side confirmation as a welcome bonus and never as part
of the security model.

Flag-don't-block stays exactly as it is: MCP-supplied content gets no validation the browser
doesn't apply. Adding MCP-only validation would make the platform stricter with the user's own
external Claude than with its own import dialog, which is backwards.

### D3 — What exactly does the server expose? ✅ Four tools (trimmed 2026-08-15)

**`list_agents`, `get_agent`, `export_agent`, `import_agent`**, plus agents as read-only
resources at `myagent://agent/{id}`.

| Considered | Verdict | Why |
|---|---|---|
| `apply_agent_changes` (structured description/sections/config edits) | **Dropped** | Was the plan's largest and riskiest component — it required extracting a shared write contract out of `POST /api/agents/[id]/apply-proposal`, replicating the config-merge invariant (`updateAgent` full-replaces config rows, so a partial edit must merge first), and inventing a pre-write snapshot + `author:'mcp'` mechanism. The export→edit→import round trip covers the same user intent through a pipeline that already exists and is already hardened. Dropping it removes an entire module, a refactor of a working route, two schema enum additions, and the plan's top data-loss risk |
| `create_agent` | **Dropped** | Redundant — **verified in the code**: `upsertAgentFromImport` does an owner-scoped name lookup and creates the agent when there's no match, so importing a document with a new `name` already creates it, with `source:'imported'`. A separate tool would have been a second creation path with different defaults |
| `get_blueprint` | **Dropped** | Largely redundant against `get_agent`, whose `AgentDTO` already embeds each config entry's `ConfigDefLite` (label, datatype, `allowedValues`, hint) and each section's `SectionDefLite` (default heading, template, help text), plus the derived `validation` flags. With structured writes gone, the remaining need — "what keys may I use?" — is answered by looking at a real agent, and the import pipeline sends the live catalog to Daedalus on the server side anyway. Also removes the only tool that exposed platform-level data rather than the user's own |
| `delete_agent` | **Out** | The only operation whose blast radius isn't obviously bounded by the revision/snapshot trail, and it's one click in a UI the user already has open |
| `search_agents` | **Out** | No repository search function exists, and a per-user library of tens of agents doesn't need an index. `list_agents` + client-side filtering is sufficient |
| A `chat`/`propose` tool wrapping Prometheus | **Out** | An external model asking MyAgent's model to reason double-spends for judgment the caller already has, and would make MCP a second gateway caller for no product gain |
| Group tools | **Out** | Groups' UI is deliberately flag-disabled pre-launch (`GROUPS_ENABLED`/`DRAG_ENABLED`). Exposing over MCP a capability the web UI currently hides would violate constraint 2 ("no new powers") |
| Activity-log / settings / invite-code tools | **Out** | Admin surface. Constraint 2 |
| MCP *prompts* primitive | **Out** | Nothing to template that a tool doesn't cover better |

**On the SDK dependency:** using `@modelcontextprotocol/sdk` is recommended — it keeps protocol
details (handshake, capability negotiation, error envelopes, transport framing) out of this
codebase and tracks spec revisions. Hand-rolling JSON-RPC is genuinely feasible (the surface is
`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`) and is the right
call if a new dependency is unwelcome — but then the protocol becomes this repo's problem to
keep current. Either way, one file owns it, enforced by test.

### D4 — stdio or HTTP? ✅ Stateless Streamable HTTP at `/api/mcp`, same app

| Option | Pros | Cons |
|---|---|---|
| **Streamable HTTP in the Next.js app** *(chosen)* | One deploy unit; direct repository access with no HTTP hop; one process holding the SQLite file; auth is a header the app already knows how to check; works for any user from any machine with no install | Requires the middleware bypass; needs `Origin` validation |
| Separate MCP microservice | Independent scaling/deploy | A second process on the same SQLite file — the exact scenario behind standing rule 3's lock incident — plus a second auth implementation, a second deploy, and CORS. Contradicts the "single Next.js full-stack app" stack decision for zero benefit at this size |
| stdio server (local npm package) | Trivially compatible with every MCP client; no network auth at all | The agents don't live locally. It would still need a credential and would still call the remote API — so it's a *client*, not an alternative architecture. With D6 scoping to console clients that accept custom headers, there is no longer any use case that needs it |
| HTTP + SSE (the older two-endpoint transport) | — | Superseded by Streamable HTTP; don't build to a deprecated transport |

**Stateless specifically** (no `Mcp-Session-Id`, no long-lived SSE): every call is
self-contained, and a stateless endpoint is the only variant that survives the multi-instance
deploy `docs/system-about.md` §12 lists as a known gap without inventing shared session state.

### D5 — What's the safest default given an external LLM can drive edits? ✅ Read-only first, then one gated write tool

Phases 1–3 ship read-only and are useful on their own; `import_agent` arrives in Phase 4 behind
token scope + `mcpWrites` (default off) + the shared LLM cap.

| Option | Verdict |
|---|---|
| Read-only forever | Too weak. "Update my agent from the terminal" is half the value, and the user is deliberately driving their own client |
| Read-only **first**, the write tool as a distinct later phase *(chosen)* | Ships value early with zero data risk; lets the protocol/auth layer be validated by real clients before anything can mutate; the write phase then changes exactly one thing at a time. Cheaper still after the D3 trim — Phase 4 is now one tool, one column, and one setting |
| Full read/write from day one | Concentrates protocol risk, auth risk, and data risk into one landing. Nothing forces this |
| A server-side pending-proposal queue the user approves in the browser | Rejected — see D2. Bolts a stateful workflow onto a stateless surface and makes MyAgent's UI a required participant in a flow whose entire point is not needing MyAgent's UI |

The precedent this follows is the "Live LLM calls" toggle: a hard, visible, admin-controlled
stop on an automated path, defaulting to the safe side, with the blocked case structurally
distinct from the successful one rather than a silent degradation.

### D6 — Which clients is this for? ✅ Resolved 2026-08-15 — console/CLI clients only

**Target: Claude Code and equivalent console/CLI MCP clients** (e.g. a CLI-style Copilot
client) — clients that can be configured with an arbitrary `Authorization` header.
**Claude Desktop's GUI connector is explicitly not a target.**

Consequences, propagated through this plan:

- **Option A (PAT) is complete**, not interim. There is no known-gap-to-fill-later for the
  supported clients.
- **The OAuth 2.1 authorization server leaves scope entirely** — it is not a deferred phase, not
  a designed-for-later step, and not in the implementation sequence. §9 carries a one-line note
  that the `authenticateMcpToken()` seam would accommodate it if the client scope ever widens;
  that is forward-compatibility, not a commitment.
- **No stdio bridge / `mcp-remote` shim** is needed or planned — that existed only to get a
  bearer header into a GUI connector.
- **Risk retired:** the first draft carried "Claude Desktop can't attach a bearer-header server"
  as risk #7. It is no longer a risk, because Desktop is no longer a target; the risk table
  above reuses that slot for something real (a future session re-adding structured writes).
- **The user guide's connection instructions** are console-shaped (`claude mcp add --transport
  http … --header …`), not a GUI walkthrough.

### D7 — May an MCP client spend the platform's LLM budget? ✅ Resolved 2026-08-15 — option (a), shared cap

**`import_agent` is metered by the existing `getMaxLlmCallsPerUserPerHour()`** — the same
rolling-60-minute, admin-exempt, default-15 cap that meters every browser-initiated call. **No
`maxMcpLlmCallsPerUserPerHour` setting, no MCP-specific limit, no separate accessor.**

This needs **zero new metering code**: the gateway already applies the dry-run hard stop and
then the cap to any call carrying a `userId`, and `import_agent` carries the token owner's id
in `LlmCallContext` like every other caller. What the plan owes this decision is not
implementation but *proof and honesty*:

- A test that an MCP-initiated import past the cap is refused with `retryAfterSeconds` and
  writes no log row (§5.6) — because the shared cap is now load-bearing rather than
  belt-and-braces.
- A plainly-stated note wherever the cap is documented that it is no longer only a guard on a
  human-driven UI: `import_agent` is the first path in this project where an automated client,
  in a loop, on a machine nobody is watching, can cause a billed call. That is the reason
  standing rule 2 exists in spirit, and the reason `mcpWrites` defaults to off.
- Two things the decision explicitly *doesn't* buy, recorded so they aren't rediscovered as
  gaps: an MCP-initiated call consumes the same hourly budget as the user's browser work (a busy
  terminal session can cap out the web UI), and the admin is exempt from the cap over MCP
  exactly as in the browser — an admin's token is the one credential with no hourly ceiling.

---

## 9. Explicitly NOT in this plan

Dropped in the 2026-08-15 rescope (each was in the first draft):

- **`apply_agent_changes`** and, with it, the entire shared write-contract extraction: no
  `lib/mcp/applyChanges.ts`, **no change of any kind to
  `POST /api/agents/[id]/apply-proposal`**, no config-merge replication, no `dryRun`-means-
  don't-persist semantics, and no new `SectionRevision`/`AgentSnapshot` enum values or new
  repository snapshot function. Structured field-level editing over MCP is a future item, not a
  deferred phase of this one.
- **`create_agent`** — covered by `import_agent`, which creates on a new name (verified).
- **`get_blueprint`** — largely covered by `get_agent`'s embedded catalog defs and validation
  flags.
- **The OAuth 2.1 authorization server**, and any GUI-connector support, per D6. Forward
  compatibility note only: `authenticateMcpToken()` resolves a bearer credential to an
  `McpPrincipal`, so an OAuth access token would be a second branch in one function with no
  change to the tool layer or transport. That is an observation about the seam, not a plan.
- **A stdio bridge or `mcp-remote` shim**, which existed only to serve GUI connectors.
- **An MCP-specific LLM cap setting**, per D7 — the existing per-user hourly cap is shared.
- **Per-revision MCP attribution** (an `'mcp-import'` `SectionRevision.author` value). Accepted
  omission with reasoning in §4.6; `llm_call_log.origin` records the origin at call time.

Out of scope for the same reasons as before:

- **`delete_agent`.** Deletion over MCP is excluded on purpose — one click in a UI the user
  already has open, and the operation where an automated client's mistake is least proportionate
  to its convenience. (Even in-app deletion preserves `SectionRevision` and `AgentSnapshot`
  history, so it isn't unrecoverable — but that's an argument for calm review, not for handing
  the trigger to an automated client.)
- **`search_agents`** and any server-side search/index.
- **Any admin capability over MCP** — settings, invite codes, access requests, other users'
  activity logs, user management. An admin's token grants exactly a normal user's powers.
- **Group tools.** Groups are deliberately flag-disabled in the web UI pre-launch; exposing them
  over MCP would grant a capability the browser currently hides. Additive later.
- **A Prometheus/chat tool.**
- **A dedicated `mcp_call_log` table.** v1 records reads via `console.info` + the token's
  `lastUsedAt`, and records writes durably through the import pipeline's snapshot and revision
  trail plus the `llm_call_log` row. A per-tool-call audit table is a reasonable NEXT item.
- **Distributed rate limiting.** The per-token limiter is in-process, like the existing
  login/signup limiter, with the same accepted per-process limitation.
- **Webhooks, subscriptions, or MCP server-initiated notifications.** These are what stateful
  transport exists for; nothing here needs them.
- **The MCP *prompts* primitive.**
- **Multi-platform export over MCP.** `export_agent` returns whatever `exportAgentMarkdown()`
  produces today (Claude format). "Export translation to other platforms" is its own existing
  roadmap item.
- **Exposing MyAgent's own system agents** (Hermes, Daedalus, Prometheus). They are platform
  infrastructure, never user content, and are not agents a user can pick in the Library — that
  boundary doesn't move because a new client appeared.
