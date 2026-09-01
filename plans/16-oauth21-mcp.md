# Plan 16 — Claude Desktop MCP Support (OAuth 2.1)

> **Status: 🔴 Drafted 2026-08-28, not started.** Unlike Plan 15 (whose core design was
> settled in conversation before drafting), this plan is **closer to Plan 14 in character**:
> it stands up a **brand-new subsystem playing a protocol role nothing in this codebase plays
> today**. Nothing here extends an existing mechanism — the app is currently an OAuth
> *client* (it consumes Google's authorization server via `arctic`); this plan makes it an
> OAuth *server*. `arctic` contributes exactly zero to that, and no
> authorization-server library is present in `package.json` today.
>
> **Ten decisions (D1–D10) are open**, every one of them with a recommendation and reasoning
> below in §8. **D1 is the only one that genuinely blocks completion** — it asks what Claude
> Desktop's connector actually requires on the wire, which cannot be determined from this
> codebase and needs either external documentation research or a live capture against a real
> Desktop install. **D2–D10 shape code and are answerable now**; every one of them has a
> baked-in call in §4 so Phases 1–4 are unblocked regardless.
>
> **Scale note — High, and honestly so.** Five new tables, four new repository files, a new
> top-level `lib/oauth-server/` subsystem, six new API routes across **three different auth
> models**, one new browser page with a from-scratch consent screen, a new guard function
> (fourth sibling to `authenticate()`/`authenticateAdmin()`/`authenticateMcpToken()`), a
> second branch inside `authenticateMcpToken()`, two new `middleware.ts` entries, a new
> route-guard fitness bucket, and two `next.config.ts` rewrites. The roadmap calls this "the
> single largest build in the whole roadmap"; that is structurally accurate, not rhetoric.
>
> **Cost and network posture.** Phases 1–4 (schema, repositories, protocol library, all six
> routes, all tests) touch **no network and cost nothing** — the same fully-offline posture
> Plan 15 took, using the existing in-memory-DB test harness. Exactly two things are not
> offline, and both are **explicit asks, never automatic steps**: (a) the live interop pass
> against a real Claude Desktop install (§5.8), and (b) the one `push_agent`-over-OAuth smoke
> test, which spends real Anthropic money because `push_agent` reaches
> `callDaedalus`/`callHermes` through `lib/ai/gateway.ts`.
>
> Standing project rules apply in full, restated rather than cited by number:
> **never `git commit` without the user explicitly saying to** — not on phase completion, not
> on a green suite; **never make a real billed Anthropic API call without asking first**, and
> say what the call is and roughly what it costs before asking; **shut the dev server down
> after any verification session** (default off — stray `next dev` processes on the same
> SQLite file have caused a real, hours-long false bug hunt in this repo before); and
> **ask before running any test, build, or `tsc --noEmit` check**, including the ones this
> plan's own phases call for. UI work prototypes in `reference/layout/Layout-Workbench.html`
> before any React code — §4.10 marks exactly which parts that applies to and which are
> exempt.
>
> Addresses `plans/roadmap.md` NEXT item **Claude Desktop MCP support (OAuth 2.1)**. Touches,
> but does not build, two other roadmap items — **Delete or disconnect user (admin)** and
> **Review/improve CI/CD process** (§10).

---

## 1. What this plan is, in one paragraph

`POST /api/mcp` today accepts exactly one credential type: a Personal Access Token the user
generated in `/account`, pasted by hand into `claude mcp add`. That works for a console/CLI
client and is useless to Claude Desktop's GUI connector, which is handed a **server URL only**
and expects to discover an authorization server, register itself, walk a user through an
authorization-code exchange in the system browser, and come back with a bearer token it
obtained itself. This plan builds that authorization server: five tables recording clients,
grants, authorization codes, access tokens and refresh tokens; a `lib/oauth-server/` library
owning PKCE verification, opaque-token minting, discovery-document construction and request
validation; two public discovery documents; a registration endpoint, a browser-rendered
consent screen, a consent-decision endpoint and a token endpoint; and **one new branch inside
`authenticateMcpToken()`** that resolves an OAuth access token to the exact same
`McpPrincipal` shape a PAT already resolves to. Nothing in `lib/mcp/` changes — not the four
tools, not the resource layer, not `server.ts`, not one of the four architecture fitness
assertions — because the tool layer's only inputs are `principal.userId` and `principal.scope`,
and both branches produce both.

**The one rule that shapes every other decision in this document:** *the two credential
branches converge before the tool layer, and diverge nowhere after it.*
`authenticateMcpToken()` may grow a second way to *find* a principal; it may not grow a second
*kind* of principal. That is what keeps this plan from becoming a rewrite of `lib/mcp/`, and
it is asserted by a fitness function (§4.11), not merely intended. The corollary, inherited
verbatim from Plan 13 and non-negotiable here: **an admin's credential grants exactly a normal
user's powers over MCP** — `McpPrincipal` carries no `role` field, there is no admin API over
MCP, and an OAuth access token must not become the loophole that introduces one.

---

## 2. Current state (verified by reading the code this session, 2026-08-28)

| Fact | Where | Note |
|---|---|---|
| **Plan 13 ruled this out of scope in four separate places, in strong language.** | `plans/archive/13-mcp-server-exposing-agents.md` D6 (lines 790–811): *"Claude Desktop's GUI connector is explicitly not a target. The OAuth 2.1 authorization server leaves scope entirely — it is not a deferred phase, not a designed-for-later step, and not in the implementation sequence."*; same file §9; `lib/mcp/CLAUDE.md:121`; `docs/system-about.md` §13 | All four become **factually wrong on ship**. §10 lists them as correctness fixes, not documentation polish. This plan deliberately reverses a stated non-goal — that is a legitimate thing for a later plan to do, but it must be recorded as a reversal, not quietly overwritten. |
| Plan 13's forward-compat note **understates the work** | Same file §9: *"an OAuth access token would be a second branch in one function with no change to the tool layer or transport"* | The *conclusion* is right (§1's convergence rule proves it), the *cost estimate* is not. The PAT branch is `hashApiToken()` → `findApiTokenByHash()` → three boolean checks (`lib/auth/mcpGuard.ts:100-110`). The OAuth branch needs expiry, scope, grant-status and client-status validation, plus everything upstream that *issues* the token — which is this entire plan. |
| **The app is an OAuth client, never a server.** | `lib/auth/oauth/google.ts` (the only `arctic` importer), `lib/auth/oauth/providers.ts`, `lib/auth/oauth/tx.ts` | `arctic ^3.7.0` is a **client** library. It contributes **zero** server-side primitives. Stated plainly here so nobody spends an afternoon looking for the reuse (§7 risk 12). |
| No authorization-server library is present | `package.json` — no `oauth4webapi`, no `@node-oauth/oauth2-server`, no `openid-client` | D6 decides whether one gets added. Everything needed is otherwise in the box: `jose ^6.2.5`, `zod ^4.4.3`, `better-sqlite3 ^13.0.1`, Node's built-in `crypto`. |
| `McpPrincipal` is `{ userId, tokenId, scope }` and **deliberately carries no `role`** | `lib/auth/mcpGuard.ts:44-53`, and the file header at lines 28–31: *"an admin's token is an ordinary user's token; an admin API over MCP is explicitly out of scope"* | This ceiling carries over to OAuth access tokens **identically**. §3 constraint 3. |
| The tool layer reads only `principal.userId` and `principal.scope` | `lib/mcp/CLAUDE.md` "The one write tool": gate 1 is `principal.scope !== 'write'`; every read tool is `listAgents(ownerId)` / `getAgentFull(id, ownerId)` / `exportAgentMarkdown(id, ownerId)` | **This is why the convergence rule works.** Keep both branches producing the same shape and `lib/mcp/` needs zero authorization changes. |
| `app/api/mcp/route.ts` **rejects any request carrying an `Origin` header, outright, with 403** | `app/api/mcp/route.ts:39-45`, reasoning in its header: *"legitimate console MCP clients are not browsers and send no Origin header at all. A present Origin is the DNS-rebinding signature the MCP spec warns servers to guard against"* | **The single most likely thing to silently break a Desktop connector**, and it is invisible to every offline test. Explicit item on §5.8's live checklist and §7 risk 3. |
| The 401 from the MCP guard carries a bare `WWW-Authenticate: Bearer` | `lib/auth/mcpGuard.ts:73, 81, 108` | RFC 9728-aware clients discover the authorization server from a `resource_metadata="…"` parameter on exactly this header. Adding it is a required change (§4.5) — and it is **not** a disclosure regression: the value is a static, public URL, and all three failure causes (unknown / revoked / expired) still collapse to one byte-identical body. |
| `middleware.ts`'s `ALTERNATE_AUTH_PATHS` is a hardcoded **exact-match** `Set` containing only `/api/mcp` | `middleware.ts:66-68` | A route that authenticates by something other than the session cookie and is **not** listed here gets a `401` from middleware **before its own handler ever runs** — a runtime-only failure invisible to `tsc`, to the route-guard fitness test, and to any route-handler unit test that calls the exported `POST` directly. §7 risk 8; §5.6 adds the first middleware-level test in the repo to cover it. |
| `PUBLIC_PATH_PREFIXES` is `['/api/auth/oauth/', '/welcome/']` | `middleware.ts:84` | Where the `/.well-known/` prefix has to go. Note the comment at lines 70–73 warning that this list is *deliberately narrow* — widen it by the minimum. |
| **The session cookie is `SameSite=Lax`, `httpOnly`, `path=/`** | `app/api/auth/login/route.ts:80-85`, `signup/route.ts:129-134`, `oauth/[provider]/callback/route.ts:101-105` | Two consequences this plan depends on, both load-bearing: (a) `Lax` **is** sent on a top-level cross-site GET navigation — which is exactly what Desktop opening the system browser at `/oauth/authorize` is, so the user's existing session is recognised; (b) `Lax` is **not** sent on a cross-site POST, which is what CSRF-protects the consent-decision endpoint without a per-page token. `lib/auth/oauth/tx.ts:48` already documents `sameSite: 'lax'` as "LOAD-BEARING" for the same reason on the Google path. |
| Middleware already builds `/login?next=<pathname><search>` and the value is validated on consumption against `^/(?!/)` | `middleware.ts:111-117`, and its header note pointing at `app/login/page.tsx` | **This solves the "not logged in when Desktop opens the browser" case with zero new code**, provided `/oauth/authorize` is a normal protected page and is *not* added to any public/alternate list. The impact analysis called this "new ground"; it is not — it is the strongest single argument for D4's page-route recommendation. |
| Route-guard fitness runs **five path-prefix buckets** over every `route.ts` under `app/api/` | `app/api/__tests__/route-guard.test.ts:87-145` — `auth/**` (no guard), `settings/**` (`authenticateAdmin(`), `account/**` (`authenticate(` and NOT `authenticateAdmin(`), `mcp/**` (`authenticateMcpToken(` and NOT `authenticate(`), everything else (`authenticate(` or `authenticateAdmin(`) | The new routes fit **none** of these, and they do not even share one guard among themselves — three of them want three different answers. §4.9 replaces the prefix rule with a per-file named table for this one directory. |
| `SignJWT` is asserted to appear in **exactly one file**, `lib/auth/jwt.ts` | `route-guard.test.ts:196-206` — a stricter, separate assertion from the two-file `ALLOWED_JOSE_IMPORTERS` set at lines 180–183 | Worth being precise: the *verify* allowlist is a two-entry `Set` you could widen; the *sign* assertion is single-file and would have to be **converted into a set** to accommodate a JWT access token. That is a real cost on D2's JWT side, and it is not the same edit as widening `ALLOWED_JOSE_IMPORTERS`. |
| `arctic` is likewise asserted to have exactly one importer, including in tests | `route-guard.test.ts:349-388` | The established pattern for any third-party dependency here: **one file isolates it, a fitness function proves it**. D6's option B inherits this obligation. |
| The opaque-credential precedent is complete and directly reusable in shape | `lib/auth/apiToken.ts` — `'mya_'` + 43 base64url chars from 32 `randomBytes`, stored as SHA-256 hex, **not bcrypt**, with four stated reasons (no key-stretching value at 256 bits; hash enables an indexed lookup bcrypt cannot; bcrypt's 72-byte truncation; per-request cost) | §4.3 reuses the *shape* and `hashApiToken()` itself, with distinct prefixes per token type. |
| **Single-use consumption has one existing primitive, and it is the right one** | `lib/db/repository/apiTokens.ts:189-202` — `revokeApiToken()` does a conditional `UPDATE … WHERE id = ? AND ownerId = ? AND revokedAt IS NULL` and returns `result.changes > 0` | A single SQLite `UPDATE` statement is atomic, so this idiom **is** a compare-and-swap. §4.4 uses it verbatim for authorization-code consumption — the race that would otherwise let two concurrent token exchanges both redeem one code. |
| **No existing table rotates a credential.** | `apiTokens.ts` (long-lived, soft-deleted via `revokedAt`, never rotated), `oauthAccounts.ts` (insert-only), `llmCallLog.ts` (append-only with one sanctioned single-row update), `invite_code` (single-use but human-typed, plaintext, different shape) | Refresh-token rotation — issue-new + revoke-old atomically, with reuse detection — has **no precedent here**. §4.2's `grantId` family column is how it is made tractable. |
| Schema conventions are uniform and must be matched | `lib/db/CLAUDE.md`: text UUID PKs, integer timestamps, integer booleans, JSON as text; soft references with **no** Drizzle `references()` cascade — *"deletion cascades are handled explicitly in the repository layer instead, so every soft-reference behaves the same visible way in one place"* | Five new tables, all following this. |
| `repository/index.ts` is the sole DB import surface outside `lib/db/` | `lib/db/CLAUDE.md` | Four new repository files, all re-exported through the barrel; nothing imports `lib/db/schema.ts` or an individual repository file directly. |
| Migrations run `0000`–`0009` (verified by listing `lib/db/migrations/`) | `0009_share_agent.sql` (Plan 15, shipped 2026-08-31) is the newest | **Plan 14 still claims `0009` — now stale, since Plan 15 landed first and took it; Plan 14 needs updating to `0010` or whatever's next when it's implemented.** This plan takes whatever `drizzle-kit` generates next — see §7 risk 5. A hand-written migration missing its `meta/` journal entry was a real bug found during Plan 13; verify the journal entry lands. |
| Rate limiting has an arbitrary-key primitive, already used for a non-IP identity | `lib/auth/rateLimit.ts` `checkRateLimitByKey(key)`; `mcpGuard.ts:88, 114` uses `mcp-auth:<ip>` and `mcp:<tokenId>` | Reusable in one line for `/token` (keyed by `client_id`) and `/register` (keyed by IP). Its documented limits — **in-process, resets on restart, multiplies across instances, spoofable IP absent TLS-terminator rewriting** (`lib/auth/CLAUDE.md`) — apply here with **higher stakes**, since a token endpoint is a higher-value brute-force target than login. Stated, not overlooked (§7 risk 7). |
| `lib/auth/constants.ts` is the auth subsystem's dependency root (no imports of its own) and already holds TTLs | `OAUTH_TX_TTL_SECONDS = 600`, `DEFAULT_SESSION_TTL_SECONDS` | Natural home for nothing in this plan, actually — see §4.1 on why the OAuth-server TTLs live in `lib/oauth-server/constants.ts` instead. |
| `lib/auth/oauth/tx.ts` owns cookie set/read/clear in one file *because a mismatched path between set and clear leaves a replayable cookie behind* | `lib/auth/oauth/tx.ts:107-121` and its header | Pattern reusable; implementation **not** — that cookie carries an *external* provider round trip. This plan's round trip is internal and its authoritative state is a DB row, not a cookie. §4.6. |
| `LlmCallContext.origin` is `'web' \| 'mcp' \| undefined`, defaulting to `'web'`, written to an **unconstrained `text`** column | `lib/ai/gateway.ts:50-59, 227, 296`; `llm_call_log.origin` per `lib/db/CLAUDE.md` | The gateway's own comment states the principle: *"an audit log that can't tell them apart is actively wrong once two sources exist."* D8. **No migration either way** — the column is plain text. |
| The per-user hourly LLM cap keys on `userId`, with no MCP-specific dimension, deliberately | `lib/mcp/CLAUDE.md` gate 3 (Plan 13 D7: *"no MCP-specific cap setting — the existing per-user hourly cap is shared"*) | D9 recommends not inventing a per-client dimension either. |
| A default-off feature switch has an exact precedent | `lib/settings.ts` `mcpWrites` (bool, default **off**) — one `SETTING_DEFS` entry gets storage parsing, the PATCH allowlist, and the `SettingsView.tsx` renderer for free | D10's kill switch is one array entry, no new UI. |
| **There is no organization, workspace, or tenant above the user** | `lib/db/schema.ts` — `agent.ownerId`, `group.ownerId`, `apiToken.ownerId` are all soft refs to `user.id`; `docs/system-about.md` §12 | Decides the `oauth_client` shape: a client is **cross-user by nature** (one Desktop registration can be granted access by many users), so it carries **no `ownerId`**. §4.2. |
| The app never discloses whether a credential ever existed | `lib/auth/mcpGuard.ts:104-110` (unknown/revoked/expired → one identical 401); `app/api/auth/request-access/route.ts` (identical body on every branch) | §3 constraint 8 keeps this posture across every new endpoint. |
| The account surface that an "authorized apps" list would sit beside | `app/account/page.tsx`, `app/components/Account/AccountView.tsx`, `app/api/account/tokens/route.ts` + `tokens/[id]/route.ts` | D10's revoke surface is its peer — a **new** route pair, not a modification of these. |
| `next.config.ts` has **no** `rewrites()` today | `next.config.ts` — only `env` and a webpack `extensionAlias` | D5 adds the first two. |
| The deployment is a single EC2 instance behind `https://myagentstudio.dev`, deployed by merging to `master` | `CHANGELOG.md` 2026-08-26, `.github/workflows/ci.yml` | Single instance → the in-process rate limiter is viable; one origin → one issuer URL. Also: **merging to `master` is the deploy trigger** — there is no separate manual deploy step, so a merge here puts an authorization server into production. |
| `lib/env.ts` validates `OAUTH_REDIRECT_BASE_URL` strictly — absolute URL, http/https, scheme+host+optional-port only, no trailing slash, https in production | `lib/env.ts:200-256` | The issuer URL needs the identical validation. **Plan 14 introduces `APP_BASE_URL` with exactly this shape** and explicitly refuses to overload `OAUTH_REDIRECT_BASE_URL`; this plan should reuse `APP_BASE_URL` if Plan 14 has landed, and introduce it with the same semantics if not. §7 risk 6. |

---

## 3. Guiding constraints (locked — do not replan during build)

1. **Both credential branches converge on one `McpPrincipal`, before the tool layer.**
   `authenticateMcpToken()` gains a second way to *resolve* a principal, never a second *kind*
   of principal. `McpPrincipal` may gain **at most** optional, non-authorizing metadata
   (D8's `clientId`); no code under `lib/mcp/` may branch on it for an authorization decision.
   Asserted in §4.11, not merely intended.
2. **Nothing under `lib/mcp/` changes its authorization logic.** All four of that folder's
   existing fitness assertions (one SDK importer; write-surface containment; gateway is the
   only route to a model; no `next/headers` and no session cookie) must pass **unmodified**.
   If a build finds itself editing `lib/mcp/__tests__/architecture.test.ts`, the design has
   been misread — stop.
3. **The admin ceiling carries over identically.** An admin who authorizes Claude Desktop
   grants it exactly a normal user's powers. `McpPrincipal` still carries no `role`; no OAuth
   scope maps to anything administrative; there is no admin API over MCP by any credential.
4. **The credential branch is selected by the presented value's own prefix, never by a
   fallback chain.** A `mya_…` value goes to the PAT lookup; a `mya_at_…` value goes to the
   OAuth access-token lookup; anything else gets the same 401 with **no** database read at
   all. A try-PAT-then-try-OAuth chain would double the DB work on every failed auth and make
   the two branches distinguishable by timing.
5. **Every credential this plan mints is opaque, random, and stored hashed** (D2). No token
   this plan issues is self-describing, and none is re-readable from the database after
   issuance. The `SignJWT`-is-in-exactly-one-file assertion (`route-guard.test.ts:196-206`)
   stays untouched.
6. **`redirect_uri` matching is exact string equality against a stored registered value, and
   it happens in the repository layer.** No prefix matching, no wildcard, no host-only
   comparison, no normalization applied at a call site. This is an open-redirect boundary, and
   the one place normalization is allowed to happen is at *registration* time, once, before
   storage — never at comparison time.
7. **An authorization code is single-use, and its consumption is a compare-and-swap.**
   `UPDATE … SET consumedAt = ? WHERE codeHash = ? AND consumedAt IS NULL` returning
   `changes > 0` — the same atomic-single-statement idiom `revokeApiToken()`
   (`lib/db/repository/apiTokens.ts:189-202`) already relies on. A read-then-write across two
   statements is a race, and OAuth 2.1 requires that replaying a code revokes the tokens
   already issued from it.
8. **No response in this subsystem discloses whether a credential, client, or code ever
   existed.** Unknown / expired / consumed / revoked all collapse to one identical error, in
   the same posture `lib/auth/mcpGuard.ts:104-110` already holds. The **one deliberate
   exception** is the `/authorize` endpoint's unknown-`client_id` and unregistered-
   `redirect_uri` cases, which must render a *visible* error page rather than redirect —
   because redirecting to an unvalidated URI is precisely the vulnerability being guarded
   against, and a user staring at a stuck browser tab needs to be told why.
9. **"Flag, don't block" does not apply here, and nobody may cite it to argue otherwise.**
   `docs/system-about.md` §3's principle — *nothing is silently rewritten or refused on the
   way in; a problem is surfaced for the user to notice and act on* — is about **agent
   content** validation. Credential validation appropriately **blocks**, exactly as
   `authenticateMcpToken()` already does. State this in words in the new files; a future
   session miscitings the principle at a token endpoint is a foreseeable failure.
10. **No live network call, no real Anthropic call, and no test/build run happens without an
    explicit ask.** Phases 1–4 are fully offline. The Desktop interop pass (§5.8) and the one
    `push_agent`-over-OAuth smoke test are asks, not steps — and the latter spends the user's
    money, because `push_agent` reaches `callDaedalus`/`callHermes` through
    `lib/ai/gateway.ts` like every other import.
11. **The whole feature ships behind a default-off setting** (D10). A deployment that never
    turns it on behaves byte-identically to today: discovery documents return `404`, the
    authorize page refuses, `/register` and `/token` refuse, and `authenticateMcpToken()`'s
    OAuth branch is unreachable. This is the rollback story, and it is one DB row, no deploy.
12. **The existing PAT path is not touched and not deprecated.** Console/CLI clients keep
    working exactly as they do today, with the same token format, the same `/account` UI, and
    the same guard behavior. Every existing MCP test must pass unmodified.

---

## 4. Implementation shape

### 4.1 The protocol role, and where the code lives

**Finding, stated plainly:** this codebase has a well-developed OAuth *client* — `lib/auth/oauth/`
with a provider registry, a single-importer `google.ts`, a transaction cookie, and its own
tests. It has **nothing** that plays the server role, and the client code contributes nothing
to it. `arctic` is a client library; there is no server-side function in it to call.

**Placement decision:** a new top-level **`lib/oauth-server/`**, a sibling to `lib/mcp/` and to
Plan 14's proposed `lib/email/` — not `lib/auth/oauthServer/`. Reasons: it is a distinct
subsystem with its own protocol surface, it earns its own `CLAUDE.md` and its own
`__tests__/architecture.test.ts` under this repo's per-subsystem precedent (`lib/ai/`,
`lib/mcp/` both carry one), and nesting it under `lib/auth/oauth/` — the folder that means
"we are the client" — would put two opposite protocol roles behind one path segment.

**The naming rule this creates must be restated inline in both folder docs, not
cross-referenced:** `lib/auth/oauth/` is **this app acting as an OAuth client, consuming
Google's authorization server**. `lib/oauth-server/` is **this app acting as an OAuth
authorization server, issuing credentials to Claude Desktop**. One sentence in each
`CLAUDE.md`; a bare pointer to the other file is not sufficient, because the moment either
moves the reader is left guessing.

**The guards stay in `lib/auth/`.** This mirrors the existing split exactly:
`lib/auth/mcpGuard.ts` guards `lib/mcp/`, and `lib/mcp/` contains no auth code. So
`lib/auth/oauthClientGuard.ts` holds `authenticateOAuthClient()` — a **fourth sibling** to
`authenticate()` / `authenticateAdmin()` / `authenticateMcpToken()` in the identical
discriminated-union shape (`{ ok: true, client }` / `{ ok: false, response }`), and
`lib/oauth-server/` contains no guard.

**TTLs live in `lib/oauth-server/constants.ts`, not `lib/auth/constants.ts`.** The latter is
described in its own header as the dependency root of the auth subsystem *with no imports of
its own*; adding protocol constants that only one subsystem reads would grow the shared root
for no shared benefit.

```
Claude Desktop
     │  1. GET /.well-known/oauth-protected-resource   (or a 401's WWW-Authenticate hint)
     │  2. GET /.well-known/oauth-authorization-server
     │  3. POST /api/oauth-server/register             (D3)
     │  4. opens system browser →
     ▼
  /oauth/authorize?…              ← app/oauth/authorize/page.tsx  (Server Component)
     │   no session → middleware 307 → /login?next=… → back here (existing mechanism)
     │   session → validate params → render consent screen
     ▼
  POST /api/oauth-server/authorize/decide   ← authenticate() (session), SameSite=Lax CSRF
     │   issues an authorization code bound to (client, user, scope, redirect_uri, challenge)
     ▼
  302 → the client's registered redirect_uri?code=…&state=…
     │
     │  5. POST /api/oauth-server/token    ← authenticateOAuthClient(), PKCE verify
     ▼
  { access_token, refresh_token, expires_in, token_type: 'Bearer', scope }
     │
     │  6. POST /api/mcp   Authorization: Bearer mya_at_…
     ▼
  lib/auth/mcpGuard.ts  → prefix dispatch → OAuth branch → McpPrincipal
     │                                                        (identical shape to the PAT branch)
     ▼
  lib/mcp/server.ts + the four tools  ← UNCHANGED
```

### 4.2 Data model — five tables

All five follow `lib/db/schema.ts`'s stated conventions: text UUID primary keys, integer
timestamps, booleans as integers, JSON as text, and **soft references with no Drizzle
`references()` cascade** — cascades are written explicitly in the repository layer so every
soft reference behaves the same visible way in one place.

**This is one table more than the impact analysis anticipated.** The extra one is
`oauth_grant`, and it is worth its cost for two concrete reasons stated up front: (a) it is
the *only* thing that makes "revoke this app's access to my account" a **single write**
instead of a fan-out update across two token tables, which is what D10's user-facing revoke
button needs; and (b) OAuth 2.1's refresh-token reuse detection requires a **family key** —
when a rotated refresh token is presented a second time, the correct response is to revoke the
entire chain, and without a grant id there is nothing to key that chain on.

**`oauth_client`** — the registered application. **Cross-user by nature**: one Claude Desktop
registration can be granted access by many different users, so it carries **no `ownerId`** and
is not modelable as an owned row. This is a genuinely new entity category for this schema, and
the reason is that there is no organization or tenant concept anywhere (`agent.ownerId`,
`group.ownerId`, `apiToken.ownerId` are all soft refs to `user.id`).

| Column | Type | Notes |
|---|---|---|
| `client_id` | text PK | The OAuth `client_id` itself, `crypto.randomUUID()`. Public by protocol — not a secret. |
| `client_name` | text, not null | Client-supplied at registration. **Untrusted, attacker-controllable, and rendered on the consent screen** — see §4.10 and §7 risk 10. |
| `redirect_uris` | text, not null | JSON array of exact strings, normalized once at registration. Constraint 6. |
| `token_endpoint_auth_method` | text, not null | `'none'` (public client) or `'client_secret_basic'`. Desktop is a public client; the confidential branch exists because the spec has it and refusing it at the endpoint is one branch. |
| `client_secret_hash` | text, nullable | SHA-256 hex. `NULL` ⇔ public client. Never re-readable, same rule as a PAT. |
| `scope` | text, nullable | Space-delimited registered scopes. |
| `software_id`, `software_version` | text, nullable | RFC 7591 optional metadata; stored for support/debug, never trusted. |
| `registered_via` | text, not null | `'dynamic'` \| `'admin'` — how the row came to exist. Display + audit. |
| `created_at` | integer timestamp | Default `unixepoch()`. |
| `disabled_at` | integer timestamp, nullable | Soft delete, matching `apiToken.revokedAt`. A disabled client's tokens stop validating; the row and its audit trail survive. |

**`oauth_grant`** — one user's standing consent for one client.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | UUID. The **family key** for every token issued under this consent. |
| `client_id` | text, not null | Soft ref → `oauth_client.client_id`. |
| `user_id` | text, not null | Soft ref → `user.id`. **The tenancy anchor — every token under this grant resolves to this one user, unchanged from today's model.** |
| `scope` | text, not null | The consented scope. Re-consenting with a *wider* scope updates this row; re-consenting with the same scope is a no-op. |
| `created_at` / `revoked_at` | integer timestamps | `revoked_at` non-null = the user pressed Revoke (D10) or the account was cleaned up. |

Index: `oauth_grant_client_user_unique (client_id, user_id)` — **the idempotency constraint**;
a user who re-authorizes the same client gets the same grant row, not a second one. Plus
`oauth_grant_user_idx (user_id)` for the Connected-apps list.

**`oauth_authorization_code`** — short-lived, single-use.

| Column | Type | Notes |
|---|---|---|
| `code_hash` | text PK | SHA-256 hex of the plaintext code. **The plaintext is never stored**, same rule as a PAT. PK, so lookup is the index. |
| `client_id`, `user_id`, `grant_id` | text, not null | Soft refs. |
| `redirect_uri` | text, not null | The exact value presented at `/authorize`; the token exchange must present the identical string. |
| `scope` | text, not null | |
| `code_challenge` | text, not null | Base64url S256 challenge. **Not nullable** — PKCE is mandatory (§3 is silent only because the spec is not: OAuth 2.1 requires PKCE for *all* clients, public and confidential). |
| `code_challenge_method` | text, not null | `'S256'` only. `'plain'` is rejected at `/authorize`, not stored and refused later. |
| `expires_at` | integer timestamp, not null | 60 seconds (D7). |
| `consumed_at` | integer timestamp, nullable | The compare-and-swap target (constraint 7). |
| `created_at` | integer timestamp | |

Index: `oauth_auth_code_expires_idx (expires_at)` — the sweeper (§4.4).

**`oauth_access_token`** and **`oauth_refresh_token`** — same shape, different lifetimes and
one extra column on the refresh side.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | UUID. Surrogate, so a revoke route never puts a credential in a URL. |
| `token_hash` | text, unique index | SHA-256 hex. The lookup key, exactly like `api_token.tokenHash`. |
| `grant_id`, `client_id`, `user_id` | text, not null | Soft refs. `grant_id` is the family key. |
| `scope` | text, not null | Copied from the grant at issuance, so narrowing a grant later cannot silently widen a live token. |
| `expires_at` | integer timestamp, not null | |
| `revoked_at` | integer timestamp, nullable | Soft delete — the row survives, matching `apiToken`'s stated reason (`lastUsedAt` survives revocation as an audit trail). |
| `created_at` | integer timestamp | |
| `last_used_at` | integer timestamp, nullable | **Access token only.** Written best-effort and throttled to once per 5 minutes per token, byte-for-byte the `TOUCH_THROTTLE_MS` pattern at `lib/auth/mcpGuard.ts:40, 126-137` — a failure here never fails the request. |
| `replaced_by` | text, nullable | **Refresh token only.** Soft ref → the successor's `id`. Non-null ⇔ this token has been rotated out; presenting it again is **reuse**, which revokes the whole `grant_id` family (§4.4). |

Indexes: unique on each `token_hash`; `(grant_id)` on both for family revocation;
`oauth_access_token_expires_idx (expires_at)` for the sweeper.

**Deliberately not columns**, each for a stated reason:

- `oauth_client.owner_id` — a client is cross-user; see above. At most `registered_via`
  records provenance.
- Any plaintext credential, anywhere. Codes, access tokens, refresh tokens and client secrets
  are all stored as SHA-256 hex only.
- `nonce` / `id_token` / anything OpenID Connect — this is an OAuth 2.1 authorization server,
  not an OIDC provider. §9.
- `device_code`, `jti`, `dpop_jkt` — device flow and DPoP are out of scope (§9); an unused
  column invites a future session to invent semantics for it.

**Existing data:** nothing is affected, nothing is backfilled, no existing row's meaning
changes, and no existing table gains a column. Five new tables that nothing reads until the
kill switch is turned on.

**Cascades, written explicitly in the repository layer:** revoking an `oauth_grant` sets
`revoked_at` on every `oauth_access_token` and `oauth_refresh_token` in that family, inside one
transaction. Disabling an `oauth_client` does the same across all of that client's grants.
Nothing is physically deleted, matching `apiTokens.ts`'s stated soft-delete rationale.

### 4.3 Credential formats (`lib/oauth-server/tokens.ts`)

Three token types, one shape, distinct prefixes — and the prefixes are **functional**, not
decorative (constraint 4):

| Type | Format | Lifetime (D7) | Stored |
|---|---|---|---|
| Authorization code | `mya_ac_` + 43 base64url chars from 32 `randomBytes` | 60 s, single use | SHA-256 hex |
| Access token | `mya_at_` + 43 base64url chars from 32 `randomBytes` | 1 hour | SHA-256 hex |
| Refresh token | `mya_rt_` + 43 base64url chars from 32 `randomBytes` | 30 days, rotated on every use | SHA-256 hex |
| *(existing PAT)* | `mya_` + 43 base64url chars | indefinite / optional expiry | SHA-256 hex |

`hashApiToken()` from `lib/auth/apiToken.ts` is imported and reused directly — it is a pure
`createHash('sha256').update(…).digest('hex')` with no PAT-specific behavior, and duplicating
it would create two hash functions that could drift. The *generator* is a parallel function in
`lib/oauth-server/tokens.ts` rather than a widened `generateApiToken()`, because a PAT
additionally computes and stores a 12-character display prefix that no OAuth token needs.

**Why opaque and not JWT (D2, with the reasoning here rather than only in §8):** the four
reasons `lib/auth/apiToken.ts` gives for SHA-256-over-bcrypt all apply again, and two more
apply specifically. First, an opaque token is **revocable in one write** — a JWT access token
is valid until it expires unless a revocation list is added, which is a second lookup that
re-introduces exactly the DB hit the JWT was supposed to avoid. Second, `route-guard.test.ts`
asserts `SignJWT` appears in **exactly one file** (`lib/auth/jwt.ts`, lines 196–206); a JWT
access token would require converting that single-file assertion into a set, which is a real
weakening of a real guardrail in exchange for saving one indexed lookup on a self-hosted
single-instance SQLite deployment. The trade is not close.

**Note the prefix collision hazard:** `'mya_at_…'.startsWith('mya_')` is **true**. Dispatch
must therefore test the *most specific* prefixes first, or use exact prefix extraction — never
a naive `startsWith('mya_')` first branch, which would send every OAuth token to the PAT
lookup and fail every one of them with a 401 that looks like a credential problem rather than a
routing bug. This is a one-line mistake with a very confusing symptom; §5.4 tests it directly.

### 4.4 The protocol operations

**PKCE (`lib/oauth-server/pkce.ts`)** — about ten lines of pure `crypto`, no library:
`base64url(sha256(code_verifier)) === code_challenge`, compared with `timingSafeEqual` over
equal-length buffers. Only `S256` is accepted; `plain` is rejected at `/authorize` with
`unsupported_code_challenge_method` rather than accepted-then-refused later. The verifier is
also length-validated (43–128 characters, the RFC 7636 range) before hashing.

**Authorization-code issuance** (`/authorize/decide`) — one transaction: upsert the
`oauth_grant` row (the `(client_id, user_id)` unique index makes re-consent idempotent), then
insert the `oauth_authorization_code` row bound to `(client_id, user_id, grant_id, scope,
redirect_uri, code_challenge)`.

**Authorization-code consumption** (`/token`, `grant_type=authorization_code`) — this is the
race that has no second chance, so the order is fixed:

1. Look up by `code_hash`. Not found, expired, or wrong client → one identical
   `invalid_grant` error.
2. **Compare-and-swap the consumption**: `UPDATE oauth_authorization_code SET consumed_at = ?
   WHERE code_hash = ? AND consumed_at IS NULL`, and proceed **only if `changes > 0`**. This is
   the `revokeApiToken()` idiom (`lib/db/repository/apiTokens.ts:189-202`) — a single SQLite
   `UPDATE` is atomic, so this is a genuine CAS and two concurrent exchanges cannot both win.
3. If `changes === 0`, the code was already consumed. Per OAuth 2.1 this is a **replay**, and
   the correct response is not merely to refuse: **revoke every token in the `grant_id`
   family** and return `invalid_grant`. Refusing without revoking leaves a possibly-stolen code
   having already produced live tokens.
4. Only *then* verify `redirect_uri` (exact match against the stored value) and PKCE. Doing the
   CAS first means a failed PKCE check still burns the code, which is correct — a code is
   one-shot regardless of why the exchange failed.
5. Issue an access token and a refresh token under the same `grant_id`.

**Refresh rotation** (`/token`, `grant_type=refresh_token`) — one transaction: verify the
presented token is live and unrotated; mint a successor; set the old row's `revoked_at` **and**
`replaced_by`. If the presented token has a non-null `replaced_by`, that is **reuse detection**
— revoke the entire `grant_id` family (both token tables) and return `invalid_grant`. This is
the only credential-rotation logic in the codebase and it has no precedent to copy; §5.3 tests
each branch directly.

**Expiry sweeping.** Expired rows are *not* required for correctness — every read path checks
`expires_at` and `revoked_at` explicitly, exactly as `mcpGuard.ts:161-168` does today. A
best-effort sweeper (`deleteExpiredAuthCodes()`, called opportunistically from `/token` with a
probability gate or a simple age threshold) keeps the code table from accumulating; the token
tables are **not** swept, because their `revoked_at` rows are the audit trail, matching
`apiTokens.ts`'s stated reason for never deleting a token row. **No cron, no scheduler, no
background job** — a single-process Next.js app on one EC2 instance has none, and inventing
one is a separate piece of infrastructure (§9).

### 4.5 The MCP guard's second branch (`lib/auth/mcpGuard.ts`)

The **only** changed file in the existing auth/MCP path, and the change is additive:

```
Step 1  extract bearer                                            (unchanged)
Step 2  IP-keyed rate limit 'mcp-auth:<ip>'                       (unchanged — runs before
                                                                   any credential lookup, so
                                                                   guessing is throttled for
                                                                   both branches equally)
Step 2b DISPATCH ON PREFIX  (new, constraint 4)
          'mya_at_' → OAuth branch
          'mya_'    → PAT branch   (existing, byte-for-byte)
          anything else → the same 401, with NO database read
Step 3–7 PAT branch                                               (unchanged)
Step 3'–7' OAuth branch (new):
          hashApiToken(presented) → findOAuthAccessTokenByHash
          reject if: no row | revoked | expired
                   | grant revoked | client disabled
                   | the kill switch (D10) is off
            → all six collapse to ONE identical 401 (constraint 8)
          per-token rate limit 'mcp:<tokenId>'                    (same primitive, same shape)
          touch lastUsedAt, best-effort, 5-minute throttle        (same pattern)
          → McpPrincipal { userId, tokenId, scope, clientId? }
```

Two details that are requirements, not polish:

- **The `scope` values are the literal strings `'read'` and `'write'`** — the same union
  `McpPrincipal.scope` already carries and the same values `api_token.scope` already stores
  (D3's sub-question). No translation table, no `mcp:read`-style namespacing that then needs
  mapping. The tool layer's `principal.scope !== 'write'` gate keeps working with zero
  changes.
- **The 401 gains a `resource_metadata` hint.** All three existing `WWW-Authenticate: Bearer`
  headers (`mcpGuard.ts:73, 81, 108`) become
  `Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource"` — this is how an
  RFC 9728-aware client discovers where to authenticate after an unauthenticated probe. It is
  **not** a disclosure regression: the value is a static public URL, identical on every failure,
  and all failure causes still produce a byte-identical body.

### 4.6 The `/authorize` round trip, including the not-logged-in case

**The not-logged-in case needs no new mechanism, and this is the single strongest reason for
D4's page-route recommendation.** Because `/oauth/authorize` is an ordinary protected page —
deliberately *not* added to `PUBLIC_PATHS`, `PUBLIC_PATH_PREFIXES`, or `ALTERNATE_AUTH_PATHS` —
`middleware.ts:111-117` already redirects a session-less visitor to
`/login?next=<pathname><search>`, and `app/login/page.tsx` already validates that value
against `^/(?!/)` before honouring it. The OAuth parameters ride along inside `search`; the
authoritative state is the URL itself plus, after consent, a DB row. **No transaction cookie
is needed and none should be built** — `lib/auth/oauth/tx.ts` exists because a *provider's*
round trip carries state the app cannot otherwise recover, which is not this situation.

The one thing to verify rather than assume: that the `next` value's own query string
(`?client_id=…&state=…&code_challenge=…`) survives `encodeURIComponent` on the way in and the
login page's decode + validation on the way out, intact and in order. §5.6 tests exactly this
round trip, and §7 risk 9 names it.

The page's own flow:

1. `authenticate()`-equivalent page-session check (the page uses this repo's existing
   `requirePageSession()` pattern; the middleware redirect above has already handled the
   common case).
2. **Validate in two tiers, and the split is a security requirement (constraint 8's
   exception):**
   - `client_id` unknown/disabled, **or** `redirect_uri` not an exact match against a stored
     registered value → **render a visible error page. Do not redirect.** Redirecting to an
     unvalidated URI is the open-redirect vulnerability this check exists to prevent.
   - Every other error — `response_type` not `code`, missing/short `code_challenge`,
     `code_challenge_method` not `S256`, unknown scope — → redirect **to the now-validated
     `redirect_uri`** with `error=` and the client's `state=` echoed back.
3. Render the consent screen (§4.10) with the client's name, the requested scope in plain
   English, the account it will be granted against, and Allow / Deny.
4. **Allow** → `POST /api/oauth-server/authorize/decide` with the parameters. CSRF is covered
   by the session cookie's `SameSite=Lax` attribute (verified in
   `app/api/auth/login/route.ts:82`), which browsers withhold from cross-site POSTs — the same
   property `lib/auth/oauth/tx.ts:48` already calls "LOAD-BEARING" on the Google path. The
   endpoint re-validates **every** parameter server-side from scratch; it trusts nothing the
   page passed it, because the page's output is client-controllable.
5. **Deny** → redirect to the validated `redirect_uri` with `error=access_denied` and the
   `state`. Denying writes no grant and no code.

### 4.7 Discovery documents

Two static-shaped JSON documents, built by `lib/oauth-server/metadata.ts` from **one** issuer
URL so the two can never disagree:

- **`GET /.well-known/oauth-authorization-server`** (RFC 8414) — `issuer`,
  `authorization_endpoint`, `token_endpoint`, `registration_endpoint` (D3),
  `scopes_supported: ['read','write']`, `response_types_supported: ['code']`,
  `grant_types_supported: ['authorization_code','refresh_token']`,
  `code_challenge_methods_supported: ['S256']`,
  `token_endpoint_auth_methods_supported: ['none','client_secret_basic']`.
- **`GET /.well-known/oauth-protected-resource`** (RFC 9728) — `resource` (the `/api/mcp` URL),
  `authorization_servers: [issuer]`, `scopes_supported`, `bearer_methods_supported: ['header']`.

Both are **fully public** — no session, no token, no rate limit beyond the platform's. Both
return `404` when the kill switch (D10) is off, so a deployment that has not enabled the
feature advertises nothing.

**Serving them at the spec-required path (D5).** RFC 8414 requires these at the *origin root*,
not under `/api`. The implementation is two ordinary route handlers at
`app/api/well-known/oauth-authorization-server/route.ts` and
`app/api/well-known/oauth-protected-resource/route.ts`, plus two `next.config.ts` rewrites
mapping `/.well-known/…` → `/api/well-known/…`. Reasons: a literal `app/.well-known/` directory
(a dot-prefixed folder under `app/`) has been fragile across Next.js versions, whereas rewrites
are stable; and keeping the files under `app/api/**` keeps them **inside** the route-guard
fitness scan rather than outside it, where a future unguarded route could be added beside them
unnoticed. `next.config.ts` has no `rewrites()` today — these are the first two.

**Middleware sees the pre-rewrite path.** `next.config.ts` rewrites are applied after
middleware runs, so the entry that must be added to `PUBLIC_PATH_PREFIXES` is `'/.well-known/'`
— *not* `'/api/well-known/'`. Getting this backwards produces a `307` to `/login` instead of
JSON, which to a connector looks exactly like "this server does not support OAuth." §5.6 tests
it at the middleware level, and this is the concrete instance of §7 risk 8.

### 4.8 API surface

Six new routes, **three different auth models among them** — which is precisely why the
route-guard fitness test needs restructuring for this directory (§4.9), and why quietly filing
these under `app/api/auth/**` to inherit its no-guard-required bucket would be a mistake:
that bucket means "public by design," and two of these six are not.

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET` | `/.well-known/oauth-authorization-server` | **none — public** | — | RFC 8414 metadata JSON | `404` when disabled |
| `GET` | `/.well-known/oauth-protected-resource` | **none — public** | — | RFC 9728 metadata JSON | `404` when disabled |
| `POST` | `/api/oauth-server/register` | **none — public by spec** (D3); IP rate-limited + capped + kill-switched | RFC 7591 client metadata: `client_name`, `redirect_uris[]`, `grant_types`, `response_types`, `token_endpoint_auth_method` | `201` `{ client_id, client_id_issued_at, client_name, redirect_uris, … }` | `400 invalid_client_metadata` (bad/missing `redirect_uris`, non-loopback non-https URI), `403` when disabled, `429` |
| `GET` (page) | `/oauth/authorize` | **session** (via middleware + page guard) | query: `response_type`, `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method` | HTML consent screen | error **page** for unknown client / unregistered `redirect_uri`; `302` back to the validated `redirect_uri` with `error=` for everything else |
| `POST` | `/api/oauth-server/authorize/decide` | **session** — `authenticate(` | `{ clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, decision: 'allow' \| 'deny' }` | `200 { redirectTo }` | `401`, `400 invalid_request`, `403` when disabled, `429` |
| `POST` | `/api/oauth-server/token` | **client credentials** — `authenticateOAuthClient(`, never a session cookie | form-encoded: `grant_type` + (`code`, `redirect_uri`, `client_id`, `code_verifier`) or (`refresh_token`, `client_id`) | `200 { access_token, token_type:'Bearer', expires_in, refresh_token, scope }` | `400 invalid_request` / `invalid_grant` / `unsupported_grant_type`, `401 invalid_client`, `403` when disabled, `429` |
| `GET`/`DELETE` | `/api/account/connections` , `/api/account/connections/[grantId]` | **session** — `authenticate(` (D10) | — | list of `{ id, clientName, scope, createdAt, lastUsedAt }` / `204` | `401`, `404` |

Route-level rules, each a real requirement:

- **`/token` never reads the session cookie**, and must not contain the literal
  `authenticate(`. It authenticates a *client*, not a user, and a copy-pasted session guard
  there would accept a browser as a client.
- **`/token` returns `Cache-Control: no-store` and `Pragma: no-cache`** on every response —
  required by the spec and genuinely load-bearing, since the body contains live credentials.
- **Every `/token` error body is the RFC 6749 shape** — `{ error, error_description? }` — and
  `error_description` never distinguishes unknown-code from expired-code from consumed-code
  (constraint 8).
- **`/register` issues public clients (`token_endpoint_auth_method: 'none'`) unless the
  request explicitly asks otherwise.** Desktop is a public client; a client secret it cannot
  keep is worse than no secret, and OAuth 2.1's answer to that is mandatory PKCE, which is
  already enforced.
- **`/register` validates `redirect_uris` before storing**: each must be an absolute URL, and
  must be either `https:` **or** an `http://127.0.0.1[:port]/…` / `http://localhost[:port]/…`
  loopback address. A native app's callback is a loopback listener on an arbitrary port; any
  other `http:` URI is rejected. Normalization (case-folded scheme and host, no default port,
  no fragment) happens **here, once**, before storage — never at comparison time (constraint 6).
- **`/register` is capped and rate-limited.** It is a public write endpoint; without both, it
  is an unbounded row generator. Recommended: `checkRateLimitByKey('oauth-register:<ip>')`
  plus a hard cap of `MAX_OAUTH_CLIENTS` rows (constant, not a setting — nothing operational
  needs to tune it), returning `403` once reached. D3.
- **`/authorize/decide` re-validates everything from scratch.** The page rendered the
  parameters; the browser can change them. The only value the endpoint takes on trust is the
  session.

### 4.9 Middleware and route-guard changes

**`middleware.ts` — two additions, both mandatory:**

| Change | Value | Why |
|---|---|---|
| `ALTERNATE_AUTH_PATHS` | add `'/api/oauth-server/token'` and `'/api/oauth-server/register'` | Both authenticate by something other than the session cookie (client credentials; nothing at all). Without an entry, middleware returns `401` **before either handler runs**, and the failure is invisible to every route-handler unit test. Keep them out of `PUBLIC_PATHS`, whose comment states that set means "no auth required" — `/token` very much has auth, just not cookie auth. |
| `PUBLIC_PATH_PREFIXES` | add `'/.well-known/'` | The **pre-rewrite** path (§4.7). Narrow by one segment, matching the existing comment's insistence that this list stay narrow. |

**Deliberately not added:** `/oauth/authorize` and `/api/oauth-server/authorize/decide`. Both
are session-protected and must keep middleware's normal behavior — the redirect-to-login one
*is* the login-mid-flow bridge (§4.6).

**`app/api/__tests__/route-guard.test.ts` — a new bucket, structured differently.** The
existing five buckets are path-prefix rules, and that shape does not fit here: three of the new
routes under one prefix want three different answers. Replace a prefix rule with a **per-file
named table** for this directory only:

| Route file | Required | Forbidden |
|---|---|---|
| `oauth-server/token/route.ts` | `authenticateOAuthClient(` | `authenticate(`, `authenticateAdmin(` |
| `oauth-server/register/route.ts` | *(none — public by spec)* | `authenticate(`, `authenticateAdmin(`, `authenticateMcpToken(` |
| `oauth-server/authorize/decide/route.ts` | `authenticate(` | `authenticateAdmin(` |
| `well-known/oauth-authorization-server/route.ts` | *(none — public metadata)* | all guards |
| `well-known/oauth-protected-resource/route.ts` | *(none — public metadata)* | all guards |

Plus the assertion that makes the table safe: **every `route.ts` under `app/api/oauth-server/`
and `app/api/well-known/` must appear in this table**, and every table entry must correspond to
a file that exists. Without that, adding a sixth unguarded route beside these five would pass
silently — and the table's whole purpose is that the *unguarded* entries are deliberate
exemptions, listed by name, not an accident.

`/api/account/connections/**` needs no new rule — it inherits the existing `account/**` bucket
(`authenticate(` and not `authenticateAdmin(`) for free.

### 4.10 UI — the consent screen

Per this repo's standing rule that layout/UI changes prototype in
`reference/layout/Layout-Workbench.html` before touching live React — because that file is
self-contained (no dev server, no DB, no build step), so iterating there is faster to test and
safer to throw away — and per its dispatch guidance: **one visual concept per dispatch**, and
**explicitly waive the build-equivalent sanity check** in the prompt, since there is no
compiler for that file and the gate is a human looking at it in a browser.

| Surface | Where | Mockup first? |
|---|---|---|
| **A. Consent screen** — client name, requested permission in plain English ("read your agents" / "read and modify your agents"), the account being granted, Allow / Deny, and a "you can revoke this any time in Account" line. Full-page, unauthenticated-chrome-free — Desktop opened this in a bare browser tab and the user may never have seen the app's shell. | `app/oauth/authorize/page.tsx`, `app/components/OAuth/ConsentScreen.tsx` | **Yes** — dispatch 1. This is a from-scratch visual with no existing pattern to extend. |
| **B. Authorize error page** — unknown client / unregistered redirect URI. Says what went wrong, offers no link back to the client, does not echo the `redirect_uri`. | same page's error branch | **Yes** — dispatch 2, small; foldable into dispatch 1 if the user prefers. |
| **C. Connected apps list** (D10) — a section in `AccountView.tsx` beside the existing API-tokens list: client name, scope, granted date, last used, Revoke. | `app/components/Account/AccountView.tsx` | **No** — this is a second list in an existing pane using the existing row/Revoke visual that the tokens list already ships. Standing rule 4 exists for iteration efficiency; re-prototyping an already-shipped visual is the detour it warns against, not the discipline it asks for. |
| Kill-switch setting row (D10) | `SettingsView.tsx` | **No** — one `SETTING_DEFS` entry through the existing `bool` renderer, exactly like `mcpWrites`. |

**`ConsentPopup.tsx` is not reusable here and should not be conflated with it** — that is the
one-time post-signup activity-log-sharing popup, a different purpose, a different data shape,
and a modal rather than a full page. It is a *visual reference* for tone and button treatment;
it is not code to extend.

**The client-name rendering rule, stated because it is a real injection surface:**
`oauth_client.client_name` is attacker-controlled — anyone can call `/register` with any name.
It is rendered on a screen whose entire job is to be trusted. It must be escaped (React does
this by default — the requirement is therefore *never* to route it through
`dangerouslySetInnerHTML`), length-clamped for display, and it must never be presented in a
position that could be read as the *app's own* copy. §7 risk 10.

### 4.11 Fitness functions (`lib/oauth-server/__tests__/architecture.test.ts`)

A new per-subsystem suite, following the precedent that `lib/ai/` and `lib/mcp/` each carry
their own, table-driven so a future addition is a row rather than an exception:

| Rule | Assertion |
|---|---|
| **The convergence rule (constraint 1) — the most valuable assertion in this plan** | `McpPrincipal` is constructed in exactly one file (`lib/auth/mcpGuard.ts`), and no file under `lib/mcp/` references `clientId`. The tool layer must remain unable to branch on credential type. |
| **`lib/mcp/` is untouched** | The four assertions in `lib/mcp/__tests__/architecture.test.ts` are unmodified — verified by that file's own content, not by re-running it: no file under `lib/mcp/` imports anything from `lib/oauth-server/`. |
| **DB boundary** | No file under `lib/oauth-server/` imports from `lib/db/` **except** through `lib/db/repository/index.js`, the same barrel rule the rest of the codebase follows. (Pure modules — `pkce.ts`, `tokens.ts`, `metadata.ts`, `constants.ts` — import no DB at all.) |
| **No JWT signing here** | No file under `lib/oauth-server/` contains `SignJWT`. This is the D2 decision made structural: if someone later switches to JWT access tokens, they trip this and the single-file `SignJWT` assertion at `route-guard.test.ts:196-206` simultaneously, which is exactly the review moment that change deserves. |
| **No plaintext credential storage** | No repository insert under `lib/db/repository/oauth*.ts` writes a column named `token`, `code`, or `secret` — only `*_hash` columns. Enforced by the *types* first (the insert input types have no plaintext field), with the test as a second line. |
| **Single hash function** | `createHash('sha256')` appears under `lib/oauth-server/` in exactly zero files — every hash goes through `hashApiToken()` from `lib/auth/apiToken.ts`, so there is one hashing implementation for every opaque credential in the codebase. |
| **`redirect_uri` comparison lives in one place** | The literal `redirectUri` comparison appears only in `lib/db/repository/oauthClients.ts` — no route compares it inline (constraint 6). |

### 4.12 Files

| File | New/Mod | Role |
|---|---|---|
| `lib/db/schema.ts` | mod | Five new tables + their indexes. |
| `lib/db/migrations/00NN_*.sql` | **new** | `drizzle-kit`-generated. **Verify the `meta/` journal entry lands** — a hand-written migration missing one was a real Plan 13 bug. Number contested with Plans 14/15 — §7 risk 5. |
| `lib/db/repository/oauthClients.ts` | **new** | Sole owner of `oauth_client`. Registration, lookup, **the exact `redirect_uri` match**, disable. |
| `lib/db/repository/oauthGrants.ts` | **new** | Sole owner of `oauth_grant`. Upsert-on-consent, list-for-user, **revoke-grant-and-family** (the one transaction that spans into the token tables). |
| `lib/db/repository/oauthAuthCodes.ts` | **new** | Sole owner of `oauth_authorization_code`. Issue, **compare-and-swap consume**, sweep expired. |
| `lib/db/repository/oauthTokens.ts` | **new** | Sole owner of **both** `oauth_access_token` and `oauth_refresh_token` — deliberately one file for two tables, because rotation writes both inside one transaction and splitting them would put a two-table transaction across two files, which no other repository does. |
| `lib/db/repository/index.ts` | mod | Barrel re-exports — the only import surface outside `lib/db/`. |
| `lib/oauth-server/constants.ts` | **new** | TTLs, scope vocabulary, `MAX_OAUTH_CLIENTS`, token prefixes. No imports (dependency root of this subsystem). |
| `lib/oauth-server/tokens.ts` | **new** | Opaque generation for the three token types; reuses `hashApiToken()`. |
| `lib/oauth-server/pkce.ts` | **new** | S256 verification, `timingSafeEqual`. ~10 lines, pure. |
| `lib/oauth-server/metadata.ts` | **new** | Both discovery documents from one issuer URL. Pure. |
| `lib/oauth-server/validation.ts` | **new** | `zod` schemas for `/register`, `/authorize`, `/token`; `redirect_uri` normalization (registration-time only). |
| `lib/oauth-server/CLAUDE.md` | **new** | Folder explainer. **Must state in its own words** that this folder is the app acting as an authorization *server*, distinct from `lib/auth/oauth/` which is the app acting as a *client* — restated, not cross-referenced. |
| `lib/oauth-server/__tests__/architecture.test.ts` | **new** | §4.11. |
| `lib/auth/oauthClientGuard.ts` | **new** | `authenticateOAuthClient()` — the fourth sibling to `authenticate()`/`authenticateAdmin()`/`authenticateMcpToken()`, same discriminated-union shape. |
| `lib/auth/mcpGuard.ts` | **mod** | Prefix dispatch + the OAuth branch + the `resource_metadata` hint on the 401. **The only modified file in the existing MCP path.** |
| `lib/settings.ts` | mod | One `SETTING_DEFS` entry + typed accessor (D10). |
| `lib/env.ts` | mod | Issuer URL getter — reuse Plan 14's `APP_BASE_URL` if it has landed, otherwise introduce it with the identical validation `OAUTH_REDIRECT_BASE_URL` already has (`lib/env.ts:200-256`). §7 risk 6. |
| `lib/ai/gateway.ts` | mod (D8) | Widen `LlmCallContext.origin` to include `'mcp-oauth'`. No migration — `llm_call_log.origin` is unconstrained text. |
| `lib/mcp/tools/importAgent.ts` | mod (D8) | **One line**: `origin: principal.clientId ? 'mcp-oauth' : 'mcp'`. Audit attribution only — no authorization logic changes, per constraint 1. |
| `middleware.ts` | mod | Two `ALTERNATE_AUTH_PATHS` entries + one `PUBLIC_PATH_PREFIXES` entry (§4.9). |
| `next.config.ts` | mod | The first two `rewrites()` in this file (§4.7). |
| `app/api/well-known/oauth-authorization-server/route.ts` | **new** | RFC 8414 document. |
| `app/api/well-known/oauth-protected-resource/route.ts` | **new** | RFC 9728 document. |
| `app/api/oauth-server/register/route.ts` | **new** | RFC 7591 dynamic registration (D3). |
| `app/api/oauth-server/authorize/decide/route.ts` | **new** | The consent decision — issues the code. |
| `app/api/oauth-server/token/route.ts` | **new** | Both grant types. |
| `app/oauth/authorize/page.tsx` | **new** | The consent screen, Server Component (D4). |
| `app/components/OAuth/ConsentScreen.tsx` | **new** | The presentation. |
| `app/api/account/connections/route.ts` | **new** (D10) | `GET` — the user's grants. |
| `app/api/account/connections/[grantId]/route.ts` | **new** (D10) | `DELETE` — revoke a grant and its whole token family. |
| `app/components/Account/AccountView.tsx` | mod (D10) | Connected-apps section beside the API-tokens list. |
| `app/api/__tests__/route-guard.test.ts` | mod | The per-file named table (§4.9). |
| `reference/layout/Layout-Workbench.html` | mod | Two mockup dispatches (§4.10) — **before** any React work. |
| tests | **new/mod** | §5. |
| `docs/system-about.md`, `docs/user-guide.md`, `docs/roadmap.md`, `lib/mcp/CLAUDE.md`, `lib/auth/CLAUDE.md`, `lib/db/CLAUDE.md`, root `CLAUDE.md`, `README.md`, `.env.example`, `CHANGELOG.md`, `plans/roadmap.md`, `app/privacy/page.tsx` | mod | §10. |

---

## 5. Testing approach

Everything in §5.1–§5.7 is offline, mocked, and free — the existing in-memory-DB harness
(`lib/db/__tests__/test-db.ts`, `test-users.ts`) plus mocked providers, exactly the pattern
every existing suite uses. §5.8 is the only live pass and it is an **ask**, not a step.
Per this repo's standing rule that no test/build/`tsc` run happens automatically: **stop and
ask before running any of these**, including at the end of a phase whose definition of done
mentions them.

### 5.1 Pure modules — no DB, no mocks
`lib/oauth-server/__tests__/pkce.test.ts`, `tokens.test.ts`, `metadata.test.ts`,
`validation.test.ts`:

- **PKCE:** a known RFC 7636 verifier/challenge vector passes; a one-character-different
  verifier fails; a `plain` method is rejected; a verifier shorter than 43 or longer than 128
  characters is rejected before hashing.
- **Tokens:** each of the three prefixes is correct and distinct; total length is as specified;
  base64url character set only; 1000 generated values are all distinct (a smoke check on the
  RNG wiring, not a statistical claim). **And the prefix-dispatch trap explicitly:**
  `'mya_at_…'.startsWith('mya_')` is `true`, so a test asserts the dispatch function routes a
  `mya_at_` value to the OAuth branch and never to the PAT branch (§4.3).
- **Metadata:** both documents are built from one issuer with no double slashes; every URL in
  them is absolute; the two documents' `issuer`/`authorization_servers` agree.
- **Validation:** `redirect_uri` normalization is idempotent; an `https:` URI passes; a
  loopback `http://127.0.0.1:PORT/cb` passes; a non-loopback `http:` URI is rejected; a URI
  with a fragment is rejected.
- **No keyword or phrase assertions on any human-readable copy** — structural facts only, per
  this repo's rule that content validation is quantitative, never phrase-matching.

### 5.2 Repositories (in-memory DB)
`lib/db/repository/__tests__/oauthClients.test.ts`, `oauthGrants.test.ts`,
`oauthAuthCodes.test.ts`, `oauthTokens.test.ts`:

- **Exact `redirect_uri` match:** a stored `https://x/cb` does **not** match `https://x/cb/`,
  `https://x/CB`, `https://x/cb?a=1`, `https://x/cb#f`, or `https://x/cb2`. This is the
  open-redirect regression test and it is the highest-value repository test here.
- **Single-use CAS:** two sequential `consumeAuthCode` calls on one code — the first returns the
  row, the second returns `null` (`changes === 0`). Then the concurrency shape: consume, assert
  a second consume fails **and** that the grant family gets revoked (§4.4 step 3).
- **Expiry:** a code past `expires_at` is not consumable; an access token past `expires_at`
  resolves to `null`; a boundary row exactly at the edge and one just outside.
- **Grant idempotency:** consenting twice for the same `(client_id, user_id)` yields exactly
  one `oauth_grant` row.
- **Family revocation:** revoking a grant sets `revoked_at` on every access **and** refresh
  token under it, in one transaction, and touches no other grant's tokens.
- **Client disable:** a disabled client's live access tokens stop resolving.
- **Cross-user isolation:** every list/read function scoped by `user_id` returns nothing for
  another user — the same posture `app/api/__tests__/tenancy.test.ts` holds for agents.

### 5.3 Refresh rotation — its own file, because it has no precedent
`lib/db/repository/__tests__/oauthRotation.test.ts`:

- Rotate → the old row has `revoked_at` **and** `replaced_by` set; the new row is live; both
  share a `grant_id`.
- **Reuse detection:** presenting an already-rotated refresh token revokes the **entire
  family** — assert every access and refresh token under that `grant_id` is revoked, not just
  the presented one.
- A rotation chain three deep leaves exactly one live token.
- Revoking the grant mid-chain makes the newest refresh token unusable.

### 5.4 The guard (`lib/auth/__tests__/mcpGuard-oauth.test.ts`)
The convergence rule's regression suite:

- A valid OAuth access token and a valid PAT produce **field-identical `McpPrincipal` shapes**
  apart from the optional `clientId` — asserted by comparing object key sets, not by eyeballing.
- Unknown token / revoked token / expired token / revoked grant / disabled client / kill switch
  off → **six byte-identical 401 bodies** (constraint 8). This is the non-disclosure regression
  test.
- A `mya_at_` value never reaches `findApiTokenByHash` (assert the PAT lookup is not called),
  and a `mya_` value never reaches the OAuth lookup.
- An unrecognised prefix produces the 401 with **zero** database reads (assert both lookups'
  call counts are 0) — constraint 4.
- **An admin's OAuth access token yields a principal with no `role` field**, identical to an
  admin's PAT — constraint 3, and the one assertion that stops an admin API over MCP from
  appearing by accident.
- The 401's `WWW-Authenticate` header contains `resource_metadata=` and is identical across all
  failure causes.
- Every existing `lib/auth/__tests__/` MCP-guard test still passes **unmodified** — the PAT path
  is untouched (constraint 12).

### 5.5 Routes (`app/api/oauth-server/__tests__/*.test.ts`)
The full matrix from §4.8, plus the flows:

- **Happy path end to end, offline:** register → authorize/decide → token → use the access
  token against `/api/mcp` (with a mocked provider) → `list_agents` returns exactly that user's
  agents. **This entire flow needs no network and no Desktop** — it is the proof the protocol
  implementation is correct, independent of whether Desktop likes it.
- **Refresh:** exchange the refresh token → new pair; the old access token still works until
  its expiry (an access token is not revoked by a refresh — assert this deliberately, it is a
  spec behavior people get wrong in both directions).
- **PKCE:** the correct verifier succeeds; a wrong verifier fails **and the code is still
  consumed** (§4.4 step 4).
- **`redirect_uri` mismatch at `/token`** → `invalid_grant`, code consumed.
- **Code replay** → `invalid_grant` **and** the family revoked; a previously-issued access
  token from that code stops working.
- **`/authorize` with an unknown `client_id`** → an error page, **no `Location` header at all**.
  Same for an unregistered `redirect_uri`. This is the open-redirect regression test at the
  route level.
- **`/authorize` with a bad `response_type`** → `302` to the registered URI with `error=` and
  the `state` echoed exactly.
- **Deny** → `302` with `error=access_denied`, and **no grant row and no code row written**.
- **Kill switch off** → both discovery documents `404`; `/register`, `/token`,
  `/authorize/decide` all `403`; an OAuth access token stops authenticating; **a PAT still
  works** (constraint 11 + 12 together).
- **`/token` never accepts a session cookie:** a request with a valid session cookie and no
  client credentials → `401 invalid_client`.
- **Tenancy:** user A authorizes a client; that client's access token cannot read user B's
  agents. Built on the existing `tenancy.test.ts` harness — this is the crown-jewel isolation
  property re-asserted against a second credential type.
- **Rate limits:** `/register` and `/token` return `429` with `Retry-After` past their windows.

### 5.6 Middleware — the first middleware-level test in this repo
`app/__tests__/middleware.test.ts` (new file, and the only reason it exists is §7 risk 8 — a
missing `ALTERNATE_AUTH_PATHS` entry is a runtime-only failure that nothing else here catches):

- `POST /api/oauth-server/token` with no cookie passes **through** middleware (does not get a
  `401` from it).
- `GET /.well-known/oauth-authorization-server` with no cookie passes through — asserted at the
  **pre-rewrite** path, which is what middleware actually sees (§4.7).
- `GET /oauth/authorize?client_id=…&state=…&code_challenge=…` with no cookie → `307` to
  `/login?next=…`, **and the decoded `next` value reproduces the original path and the full,
  unmangled query string in order**. This is §7 risk 9's regression test and the thing the
  whole login-mid-flow bridge rests on.
- `POST /api/oauth-server/authorize/decide` with no cookie → `401` from middleware (it is
  deliberately *not* in the alternate-auth set).

### 5.7 Fitness + migration
- §4.11's suite.
- The route-guard per-file table (§4.9), including its own meta-assertion: a route file added
  under `app/api/oauth-server/` that is absent from the table **fails the suite**. Verify by
  temporarily adding a fixture path to the table's expected-files list and confirming it fails,
  rather than trusting the table is exhaustive.
- `lib/db/__tests__/migration.test.ts` — the new migration applies cleanly to a fresh database,
  and its `meta/` journal entry exists.

### 5.8 Live verification — **requires an explicit user go-ahead; never run automatically**

Everything above touches no network and spends nothing. Exactly one live pass exists, and it is
where the D1 unknown is finally resolved. **This is an ask, not a step in the sequence** —
present it, say what it involves, and wait.

What it needs: a real Claude Desktop install, the app running (dev server started for this
purpose only, **and shut down immediately after** — stray `next dev` processes on the same
SQLite file have previously caused an hours-long false bug hunt in this repo), and the kill
switch turned on.

Checklist, in order, capturing the actual requests at each step:

1. Add the MCP server by URL in Desktop's connector UI. **Record whether Desktop fetches
   `/.well-known/oauth-protected-resource` first, or probes `/api/mcp` and reads the
   `WWW-Authenticate` hint, or fetches `/.well-known/oauth-authorization-server` directly.**
2. **Record whether it calls `/register` (dynamic registration) or expects a pre-configured
   `client_id`.** This is D1's core question and it decides whether D3's recommendation stands.
3. **Record the exact `redirect_uri` it registers** — scheme, host, port behavior (fixed or
   ephemeral), path. If the port is ephemeral, §7 risk 2's loopback-port rule becomes load-bearing.
4. Walk the browser flow signed out, so the `/login?next=…` bridge is exercised for real.
5. Complete consent; confirm the token exchange succeeds and `list_agents` returns the right
   agents in Desktop.
6. **Confirm whether Desktop's `/api/mcp` requests carry an `Origin` header.** Today
   `app/api/mcp/route.ts:39-45` rejects any present `Origin` with `403`, and that guard exists
   for a stated reason (DNS-rebinding defense). If Desktop sends one, §7 risk 3 fires and the
   guard needs a narrowed rule — **do not pre-emptively loosen it before this capture says so.**
7. Wait out the access-token expiry (or shorten the TTL in a scratch config) and confirm the
   refresh exchange happens and succeeds.
8. Revoke from Connected apps and confirm Desktop loses access.

**One further ask, separate and billed:** a single `push_agent` call over the OAuth credential,
to confirm the write path and the audit attribution (`origin: 'mcp-oauth'`, D8). This **spends
the user's Anthropic money** — `push_agent` reaches `callDaedalus`/`callHermes` through
`lib/ai/gateway.ts` exactly like a web import. Ask separately, say roughly what it costs, and
prefer verifying the non-billed parts first. The app's own "Live LLM calls" toggle in
`/settings` blocks real calls at the gateway level; flipping it back on is itself part of what
needs asking.

**Not part of this plan's gate:** compatibility with any MCP client other than Claude Desktop
and the existing console clients; behavior across a Desktop version upgrade.

---

## 6. Implementation sequence

| # | Step | Depends on | Notes / risk |
|---|---|---|---|
| 0 | **Answer D2–D10.** D1 is *not* a blocker for steps 1–6 — it is resolved by step 9's capture. | — | D2/D3/D6 shape the most code; D4/D5 are structural; D7–D10 are one-line-to-one-file calls. |
| 1 | Schema + migration + the four repository files + barrel + §5.2/§5.3/§5.7-migration tests | — | **Fully offline, zero network, zero cost.** Behavior-preserving on its own: five tables nothing reads yet. Verify the `meta/` journal entry. This is the largest single chunk and it is also the safest. |
| 2 | `lib/oauth-server/` pure modules — `constants.ts`, `tokens.ts`, `pkce.ts`, `metadata.ts`, `validation.ts` + §5.1 tests | — | **Parallel with 1** — no DB, no imports from step 1. Pure functions, testable with no mocks at all. |
| 3 | `lib/auth/oauthClientGuard.ts` + the two discovery routes + `next.config.ts` rewrites + `middleware.ts` entries + §5.6 tests | 1, 2 | First externally visible surface, and the step where the middleware trap (§7 risk 8) is closed. §5.6 must land **with** this step, not after. |
| 4 | `/register` + `/authorize/decide` + `/token` + §5.5 route tests | 1, 2, 3 | The protocol core. **Fully verifiable offline** — §5.5's end-to-end flow proves correctness without Desktop. |
| 5 | `mcpGuard.ts`'s second branch + §5.4 tests | 1, 2, 4 | The convergence rule. **Re-run the existing MCP suites unmodified** (ask first) — if any of them needed editing, constraint 12 has been broken. |
| 6 | §4.11 fitness suite + the route-guard per-file table | 4, 5 | **Same batch as 4–5, not after.** Plan 11 found exactly this gap for `lib/ai`'s DB rule: a boundary documented but unenforced is a boundary already broken. |
| 7 | **Mockup pass** — two dispatches (§4.10 A and B), one concept each, build-equivalent sanity check waived | — | **Parallel with 1–6** — a static HTML file with no dependency on any code here. Starting it early is the single biggest schedule win in this plan. |
| 8 | React: `app/oauth/authorize/page.tsx`, `ConsentScreen.tsx`, the Connected-apps section + `/api/account/connections` routes (D10) | 4, 7 | The Connected-apps surface is not optional decoration — without it a user has **no way to revoke**, which is the difference between a grant and a permanent handover. |
| 9 | **Live Desktop interop capture — ask first** | 3, 4, 5, 8 | §5.8. Resolves D1. **Expect at least one correction here** and budget for it: the most likely findings are a `redirect_uri` shape D3 did not anticipate, or an `Origin` header the MCP route rejects. |
| 10 | **`push_agent`-over-OAuth smoke test — ask separately, spends money** | 9 | §5.8's second ask. |
| 11 | Docs (§10) | 1–10 | Includes retracting four separate places that currently state this is out of scope. Restate rules inline at every citation site; a bare section number is never sufficient. |

**Rollback.** Flip the kill switch off (D10) — one DB row, no deploy, no restart. Discovery
returns `404`, all three endpoints `403`, live OAuth access tokens stop authenticating, and
**PATs keep working**, so console/CLI clients are unaffected. Reverting the code leaves five
orphaned tables that no query reads. This is deliberately a stronger rollback than Plan 15's
(which has none and needs none) because this feature's failure mode is an
**authentication** failure mode, and the deployment pipeline offers no separate manual gate:
merging to `master` is itself the deploy to production.

**What can be built and tested with zero live access, stated explicitly:** steps 1–8 in their
entirety. The database schema, all four repositories, every pure protocol module, all six
routes, the guard's second branch, every fitness function, and the complete
register→authorize→token→`/api/mcp` flow are all exercisable against the in-memory DB with a
mocked provider. **Only step 9 requires a real Claude Desktop**, and only step 10 costs money.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **The MCP authorization spec has moved since drafting.** This plan is written against the OAuth 2.1 draft and the MCP authorization spec as understood at drafting time; that spec added protected-resource metadata and tightened PKCE requirements between its Nov 2024 and March 2025 revisions and has kept moving. | Re-verify against `https://spec.modelcontextprotocol.io/specification/` at build time and **name the exact spec revision and Desktop version targeted in `lib/oauth-server/CLAUDE.md`**, the way `lib/mcp/CLAUDE.md` already pins the SDK version and transport with a "revisit at build time if this drifts" heading. Step 9's capture is the real check. |
| 2 | **Desktop's actual `redirect_uri` shape breaks an assumption** — most plausibly an ephemeral loopback port, which cannot be pre-registered as an exact string. | RFC 8252 says a loopback redirect's **port must be treated as variable**. §4.8's registration rule stores the URI as given; if step 9 shows an ephemeral port, the comparison for loopback URIs specifically becomes host+path exact with port ignored — **implemented inside `oauthClients.ts` as a named, documented exception, never as a general loosening of constraint 6**, and covered by its own §5.2 test. Do not build this carve-out speculatively. |
| 3 | **`/api/mcp` rejects Desktop outright over the `Origin` header.** `app/api/mcp/route.ts:39-45` returns `403` for *any* present `Origin`, and that guard exists for a real reason (DNS-rebinding defense the MCP spec warns about). | Step 9 item 6 captures it. If Desktop sends one, the fix is a narrowed rule — reject a present `Origin` **unless** it exactly matches the issuer origin — not deleting the guard. **Invisible to every offline test**, which is exactly why it is on the live checklist rather than assumed. |
| 4 | **`authenticateMcpToken()` becomes the complexity concentration point.** The PAT branch is three lines; the OAuth branch is a dozen checks. A future edit to one silently changes the other. | Constraint 1 + §5.4's key-set equality assertion. Keep the OAuth branch's *lookup* in `oauthTokens.ts` and the guard's job at "call it, check the flags, build the principal" — the guard must not grow protocol logic. |
| 5 | **Migration number collision, now half-resolved: Plan 15 shipped first and took `0009`.** Plan 14 still claims `0009` (stale) and needs updating once it's picked up. | Whoever lands last takes the next free number. `drizzle-kit` derives it from the existing folder, so this resolves itself **provided the migration is generated, not hand-numbered** — and a hand-written migration missing its `meta/` journal entry was a real Plan 13 bug. Check `lib/db/migrations/` immediately before generating. |
| 6 | **Issuer URL duplication.** Plan 14 introduces `APP_BASE_URL`; this plan needs the same value. Introducing a second variable would let the discovery documents and the email links disagree about what this deployment is called. | Reuse `APP_BASE_URL` if Plan 14 has landed; introduce it with Plan 14's exact semantics and validation if not. **Do not overload `OAUTH_REDIRECT_BASE_URL`** — Plan 14 already reasoned that one out: it is optional and OAuth-*client*-scoped, so disabling Google sign-in would silently break the authorization server's own identity. |
| 7 | **The in-process rate limiter is a weaker defense here than anywhere it is used today.** It resets on restart, multiplies across instances, and keys on a spoofable IP header absent TLS-terminator rewriting (`lib/auth/CLAUDE.md` states all three). A token endpoint is a higher-value brute-force target than login. | Accepted for the current single-instance deployment, **stated rather than overlooked** — the same posture `lib/auth/CLAUDE.md` already takes. The real defense is 256-bit opaque credentials with a 60-second code lifetime and single-use consumption; the rate limit bounds noise, not guessing. The distributed limiter is already a `plans/roadmap.md` FUTURE item. |
| 8 | **A missing `ALTERNATE_AUTH_PATHS` entry produces a `401` from middleware before the route runs** — invisible to `tsc`, to the route-guard fitness test, and to any handler unit test that calls the exported `POST` directly. The set is a hardcoded, deploy-time exact-match `Set` (`middleware.ts:66-68`). | §5.6 — the first middleware-level test in this repo, added specifically for this. It is why that file exists. |
| 9 | **The `next=` round trip mangles the OAuth query string**, so a signed-out user completes login and lands on a `/oauth/authorize` that has lost its parameters — a dead tab with no error. | §5.6's decoded-`next` assertion, checking the full query string reproduces in order. The mechanism itself is existing and already load-bearing for other protected pages (`middleware.ts:111-117` + `app/login/page.tsx`'s `^/(?!/)` validation) — this test is about the *OAuth-shaped* value specifically, which is longer and has more `&`s than anything that path carries today. |
| 10 | **`client_name` is attacker-controlled text rendered on a trust screen.** Anyone can `POST /register` with any name — including one crafted to read as the app's own copy ("MyAgentStudio — routine security check"). | React escapes by default, so the requirement is **never** to route it through `dangerouslySetInnerHTML`; plus a display length clamp and a layout that visually separates client-supplied text from app copy (§4.10, mockup dispatch 1's job). Additionally: `/register` is capped and rate-limited, so mass registration of lookalike clients is bounded. **Residual, and worth the user knowing:** with open dynamic registration, this app cannot verify that a client claiming to be "Claude Desktop" is Claude Desktop. That is inherent to RFC 7591, not a defect introduced here — the user's protection is the consent screen showing exactly what is being granted, to which account. |
| 11 | **Zero existing test coverage for this entire class of flow.** Redirect-URI validation, PKCE, single-use enforcement, refresh rotation and the login-mid-flow bridge each need net-new test files with nothing to extend. | §5.1–§5.6 are budgeted as real work, not as a trailing tax. Step 6's rule — fitness lands in the same batch as the code — applies to these too. |
| 12 | **`arctic` is a false-reuse trap.** It is the closest-looking existing dependency and it contributes nothing: it is a client library. | Stated here, in `lib/oauth-server/CLAUDE.md`, and in the D6 discussion, so nobody spends an afternoon on it. |
| 13 | **An orphaned grant survives a deleted user.** No user-deletion path exists yet, so this is latent rather than live. | §10 hands the **Delete or disconnect user (admin)** roadmap item one rule: deleting a user must revoke every `oauth_grant` for that `user_id` and the whole token family under each. Until that plan exists, no user can be deleted. |
| 14 | **Merging to `master` deploys an authorization server to production with no separate gate.** The CI pipeline's `deploy` job runs on any push to `master`, docs-only included. | Constraint 11's kill switch is default-**off**, so the deploy is inert until someone turns it on — which is the entire reason the switch defaults off rather than on. |
| 15 | **The privacy policy may need an edit.** `app/privacy/page.tsx` describes how a user's data is handled; granting a third-party desktop application read/write access to agent content is a new disclosure path, even though no new server-side processor is involved. | Read the page during step 11 and judge. It may be a genuine no-op — unlike Plan 14's mandatory edit, which added a real third-party processor — but it must be **checked, not assumed**. |

---

## 8. Decisions — judgment calls made here, awaiting confirmation

Each already has a call baked into §4 so implementation is unblocked; changing one is a
localized edit. **D1 is the only one that cannot be settled from inside this repository.**

### D1 — What does Claude Desktop's connector actually require on the wire? **(the blocking unknown)**

**Cannot be determined from this codebase, and this plan does not guess.** The open
sub-questions: does it require RFC 7591 dynamic registration or accept a pre-configured
`client_id`? Does it require RFC 9728 protected-resource metadata before attempting anything,
or does it probe `/api/mcp` and read the `WWW-Authenticate` hint? What exactly does it register
as `redirect_uri` — fixed loopback port or ephemeral? Does it send an `Origin` header on
`/api/mcp`?

**Recommendation: build to the spec's superset now, and resolve D1 by capture, not by
research.** Serve *both* discovery documents, support dynamic registration *and* an
admin-seeded static client row, and add the `resource_metadata` hint to the 401 — this is at
most a few hundred lines more than the narrowest guess and it removes the guess entirely.
Then confirm against a real install at step 9 (§5.8), which is an **explicit ask** because it
means running the dev server and driving a real client, not something to do silently mid-build.

**What the user must decide:** whether external documentation research (reading Anthropic's
current connector docs) should happen *before* step 1, or whether the superset approach plus a
step-9 capture is enough. The recommendation is the latter — the superset is cheap, and
published docs about a moving client are less authoritative than a packet capture.

### D2 — JWT or opaque access tokens?

**Recommendation: opaque, SHA-256-hashed, reusing `hashApiToken()`.** Reasons, restated rather
than cross-referenced: an opaque token is revocable in a single write, whereas a JWT is valid
until expiry unless a revocation list is added — and that list is a database lookup, which is
exactly the cost the JWT was meant to avoid. And `app/api/__tests__/route-guard.test.ts`
(lines 196–206) asserts `SignJWT` appears in **exactly one file**; a JWT access token would
force that single-file assertion into a set, weakening a real guardrail to save one indexed
lookup on a single-instance SQLite deployment. `ALLOWED_JOSE_IMPORTERS` stays a two-entry set
and the `SignJWT` assertion stays single-file. **If the user prefers JWT:** the cost is those
two test changes plus a revocation-check lookup that puts the DB hit back anyway.

### D3 — Dynamic client registration, static pre-registration, or both?

**Recommendation: both — dynamic as the primary path, plus an admin-seedable static row.**
Dynamic (RFC 7591) is what the MCP spec recommends and is very likely what Desktop requires,
because Desktop's connector UI accepts a **server URL only** — there is no field for a
`client_id` a deployment operator could hand it. Static-only would therefore be a hard blocker
if D1 comes back "dynamic required," which is the likely answer. But the static path costs
almost nothing once the table exists (a row, not an endpoint) and is genuinely useful for tests
and for any future client that *does* accept configuration.

**The open endpoint's guardrails are not optional:** IP rate limiting, a hard
`MAX_OAUTH_CLIENTS` cap (a constant, not a `SETTING_DEFS` entry — nothing operational needs to
tune it, and every setting is permanent admin UI), the kill switch, and `redirect_uri`
validation restricted to https-or-loopback. **If the user wants zero unauthenticated write
endpoints in v1:** ship static-only and accept that Desktop may simply not connect until D1
is captured — a defensible, if slower, order.

### D4 — Is `/authorize` a page route or an API route returning HTML?

**Recommendation: a page route at `app/oauth/authorize/page.tsx`** (Server Component), with the
*decision* split out to `POST /api/oauth-server/authorize/decide`. Three reasons: it is the
idiomatic Next.js shape for a browser-rendered screen; the security-relevant action (minting an
authorization code) lands in an API route that the route-guard fitness table **does** cover; and
— the decisive one — a normal protected page gets the entire not-logged-in-mid-flow bridge from
`middleware.ts`'s existing `/login?next=…` redirect for **zero new code** (§4.6).

**What covers the page instead of the route-guard fitness test**, since that test only scans
`app/api/**`: the page is a protected route by middleware's default (it is deliberately absent
from all three exemption lists), plus §5.6's explicit middleware assertion that a session-less
`GET /oauth/authorize` redirects rather than renders, plus the page's own
`requirePageSession()` call. That is **three** independent layers, which is more than the
fitness test alone would give it. Stated here so this is a documented choice rather than an
unnoticed coverage gap.

### D5 — How are the `.well-known` documents served?

**Recommendation: route handlers under `app/api/well-known/` plus two `next.config.ts`
rewrites** from `/.well-known/…`. Reasons: a literal dot-prefixed `app/.well-known/` directory
has been fragile across Next.js versions, while rewrites are stable; and keeping the files
inside `app/api/**` keeps them inside the route-guard fitness scan, where their
deliberately-unguarded status is listed by name in §4.9's table rather than being invisible.
**The trap that comes with this choice:** middleware runs before rewrites, so the
`PUBLIC_PATH_PREFIXES` entry must be `'/.well-known/'`, the pre-rewrite path. §5.6 tests it.
**Alternative:** a literal `app/.well-known/` directory — fewer moving parts if it works on the
pinned Next version; verify before choosing it.

### D6 — Hand-roll on existing primitives, or add an OAuth-server library?

**Recommendation: hand-roll on `jose` (not needed for tokens, but present), `crypto`, `zod`
and `better-sqlite3`.** This matches the precedent Plan 11 set for the second LLM provider —
implement the transport over `fetch` rather than vendoring an SDK, with one file isolating it —
and Plan 14's proposed shape for email. The protocol surface actually needed here is small:
PKCE S256 is ten lines of `crypto`; opaque tokens are `randomBytes` plus a SHA-256 the codebase
already has; the two discovery documents are static JSON; and the two grant types are a
few dozen lines each. Adding a dependency to avoid that means adding a dependency-management
surface, a version-drift surface, and the same one-importer-isolation obligation with a
fitness function that every third-party dependency in this codebase already carries
(`anthropicProvider.ts` for the Anthropic SDK, `oauth/google.ts` for `arctic`).

**One honesty caveat to verify at build time before treating this as settled:** the commonly
cited candidates — `oauth4webapi`, `openid-client` — are primarily **client** libraries.
If none of the maintained options genuinely provides authorization-*server* primitives, option
B collapses on inspection and hand-rolling is not a preference but the only path. Check this
first; it may make the decision for you.

### D7 — Token lifetimes and rotation policy

**Recommendation:** authorization code **60 seconds**, single use; access token **1 hour**;
refresh token **30 days**, **rotated on every use with reuse detection** (present a rotated
token → revoke the whole `grant_id` family). Reasoning: the code lifetime only has to cover one
HTTP round trip on the client's own machine, so short is free; a one-hour access token bounds
the damage from a leaked token without making refresh traffic notable; and OAuth 2.1 requires a
public client's refresh token to be either sender-constrained or rotated, and rotation is the
option available here. All four constants live in `lib/oauth-server/constants.ts`, **not** in
`SETTING_DEFS` — nothing operational needs to tune them, and every setting is a permanent piece
of admin UI. **If the user wants them tunable:** they are four `int` settings, one array entry
each, at the cost of four permanent rows in the Settings pane.

### D8 — What `LlmCallContext.origin` value does an OAuth-authenticated MCP call carry?

**Recommendation: a new `'mcp-oauth'` value.** `lib/ai/gateway.ts:50-57` states the principle
itself — *"an audit log that can't tell them apart is actively wrong once two sources exist"* —
and a Desktop connector call and a hand-pasted-PAT call are two sources with different security
stories. **No migration either way**, since `llm_call_log.origin` is an unconstrained `text`
column. The cost is one type-union widening in `lib/ai/gateway.ts` and **one line** in
`lib/mcp/tools/importAgent.ts` (`principal.clientId ? 'mcp-oauth' : 'mcp'`). That line is
audit attribution only — no authorization logic in `lib/mcp/` branches on it, which is what
keeps constraint 1 intact. **If the user prefers lumping both under `'mcp'`:** `McpPrincipal`
then needs no `clientId` field at all and `lib/mcp/` is touched literally zero times, at the
cost of an audit log that cannot answer "did that write come from Desktop?"

### D9 — Does the per-user LLM cap need a per-client dimension?

**Recommendation: no.** The cap already keys on `LlmCallContext.userId`, which is identical
whether the credential was a PAT or an OAuth token, so a user cannot exceed their own ceiling
by authorizing an app. Plan 13 already decided the same shape of question the same way (D7:
no MCP-specific cap setting, the existing per-user hourly cap is shared). There is no precedent
anywhere in this codebase for a per-client cap, and inventing one without a real observed
problem adds a setting, a counter dimension, and a second thing to explain when a call is
refused.

### D10 — Kill switch, and where does a user revoke?

**Recommendation: both, and neither is optional.**

**The kill switch** is one `SETTING_DEFS` entry — `oauthConnector` (bool, **default off**),
matching `mcpWrites`'s default-off precedent exactly and inheriting the existing `bool`
renderer with no UI work. It is the rollback story (§6), and default-off is what makes the
deploy-on-merge pipeline safe (§7 risk 14). Read fresh on every call, never cached — the same
rule `getLiveLlmCalls()` follows, for the same reason: a toggle that lags looks broken.

**The revoke surface** is `GET`/`DELETE /api/account/connections`, rendered as a Connected apps
section beside the existing API-tokens list in `AccountView.tsx`. **This is not optional
polish**: without it, a user who authorizes Claude Desktop has no way to un-authorize it short
of asking an admin to touch the database, which turns a grant into a permanent handover. The
`oauth_grant` table exists precisely so this is one write. **If the user wants v1 smaller:**
the honest minimum is still this — cut the mockup polish, not the button.

---

## 9. Explicitly NOT in this plan

- **OpenID Connect.** No `id_token`, no `userinfo` endpoint, no `nonce`. This is an
  authorization server for API access, not an identity provider. Google sign-in
  (`lib/auth/oauth/`) remains the app's only identity-provider relationship, in the opposite
  direction.
- **Any grant type other than `authorization_code` and `refresh_token`.** No device
  authorization flow, no client credentials grant, no implicit grant (removed in OAuth 2.1
  anyway), no token exchange.
- **DPoP or any sender-constrained token.** Rotation is OAuth 2.1's other sanctioned answer for
  a public client and it is what D7 chooses.
- **Token introspection (RFC 7662) and token revocation (RFC 7009) endpoints.** The app is both
  authorization server and resource server, so introspection has no consumer; revocation is
  covered by the user-facing Connected apps action. Adding either later is one route each on
  tables that already exist.
- **Scopes beyond `read` and `write`.** The vocabulary matches `api_token.scope` exactly so the
  tool layer needs no translation. Per-tool or per-agent scoping is a plan of its own.
- **Admin powers over MCP by any credential.** Constraint 3, carried over from Plan 13
  unchanged.
- **Shared agents over MCP — already handled, not this plan's concern.** Plan 15 shipped with
  shared agents visible read-only over MCP (its D8 was overridden from the original
  recommendation) via `listSharedWithViewer`/`getAgentFullForViewer`; this plan changes
  nothing about that, so an OAuth-authenticated Desktop sees exactly what a PAT sees today —
  the user's own agents plus anything shared with them, read-only.
- **A background scheduler, cron, or job runner** for expiry sweeping. §4.4 uses opportunistic
  sweeping plus explicit expiry checks on every read path; a durable scheduler in a
  single-process Next.js app on one EC2 instance is separate infrastructure.
- **Consent-screen customization, branding, or per-client logos.** A `logo_uri` from an
  unverified dynamic registration is a phishing surface, not a feature.
- **Multi-instance-safe rate limiting.** Already a `plans/roadmap.md` FUTURE item; this plan
  inherits the current limiter's stated limitations rather than solving them.
- **Support for any MCP client other than Claude Desktop and the existing console clients.**
  A standards-compliant server should serve others; verifying that is not this plan's gate.
- **Deprecating or changing the PAT path.** Constraint 12.

---

## 10. Documentation this plan must update, and what it hands to other roadmap items

**Docs that become factually wrong on ship** (step 11 — correctness fixes, not polish). This
plan **reverses a stated non-goal**, and that reversal has to be recorded in each of the four
places that state it, not silently overwritten:

- **`plans/archive/13-mcp-server-exposing-agents.md`** — its D6 block (lines 790–811) says the
  OAuth 2.1 authorization server *"leaves scope entirely — it is not a deferred phase, not a
  designed-for-later step,"* and §9 repeats it. Archived plans are kept for history and are not
  maintained, so **do not rewrite them** — instead add one dated line at the top of that D6
  block noting that Plan 16 revisited and reversed the decision, with the new plan's path. The
  history of *why* it was out of scope stays intact and readable.
- **`lib/mcp/CLAUDE.md`** — line 121's *"no OAuth 2.1 authorization server (out of scope per D6
  — console/CLI clients only, never Claude Desktop's GUI connector)"* is now false. Replace with
  a statement of what is actually true: `lib/mcp/` still contains no auth code at all; a second
  credential type is resolved upstream in `lib/auth/mcpGuard.ts` and converges on the identical
  `McpPrincipal`; nothing in this folder branches on credential type. That is the fact worth
  carrying, and it must be stated, not pointed at.
- **`docs/system-about.md`** — §13's *"not Claude Desktop's GUI connector, which needs OAuth
  2.1 and is explicitly out of scope"* is now false. §4's data model gains five tables. §10
  (auth & multi-tenancy) gains one sentence that matters: **a second credential type now
  resolves to a `userId`, and per-user isolation is unchanged — every read and write is still
  scoped by `ownerId` in the same SQL statement.**
- **`lib/auth/CLAUDE.md`** — add `oauthClientGuard.ts` to the file table as the **fourth**
  sibling guard, and extend the `mcpGuard.ts` entry to say it now dispatches on credential
  prefix. Also add one sentence distinguishing `lib/auth/oauth/` (this app as an OAuth
  **client**, consuming Google) from `lib/oauth-server/` (this app as an OAuth **server**) — the
  single most confusable pair of paths this plan creates.
- **`lib/db/CLAUDE.md`** — five tables and four repository files in the file table and the
  repository section, including the note that `oauthTokens.ts` deliberately owns two tables.
- **Root `CLAUDE.md`** — the Folders section gains `lib/oauth-server/` with its own
  `CLAUDE.md`, alongside `lib/ai/`, `lib/mcp/` and the rest.
- **`docs/user-guide.md`** — a new task section: connecting Claude Desktop, what the consent
  screen is asking, and how to revoke from Account.
- **`docs/roadmap.md`** — the item moves from "Planned" toward "Available today."
- **`plans/roadmap.md`** — the item's Status cell. *(Updated to "On-going — plan drafted at
  `plans/16-oauth21-mcp.md`" when this plan was written.)*
- **`README.md`**, **`.env.example`** (the issuer URL variable), **`CHANGELOG.md`**.
- **`app/privacy/page.tsx`** — check, per §7 risk 15. Possibly a no-op; not assumable.

**What this hands to other roadmap items** (none of them built here):

- **Delete or disconnect user (admin)** — inherits exactly one new rule: **deleting or
  disconnecting a user must revoke every `oauth_grant` for that `user_id`, and every access and
  refresh token in each family**, in the same transaction as the deletion. The "disconnect"
  variant is especially relevant: that item exists because the only way to kill a session today
  is rotating the global `JWT_SECRET`, which logs out everyone — an OAuth access token is a
  *third* thing a disconnect has to cover (session cookie, PAT, OAuth grant), and
  `revokeGrantAndFamily()` is the single call that covers the third.
- **Email-sending provider (Plan 14)** — a "a new application was authorized on your account"
  notice is one template file plus one `kind` string plus one `sendEmail()` call placed after
  the grant commits. Plan 14's rule that a send can never fail the action that triggered it is
  exactly right for this. Also relevant: Plan 14 introduces `APP_BASE_URL`, which is the issuer
  URL this plan needs (§7 risk 6).
- **Review/improve CI/CD process** — this plan sharpens that item's stated inefficiency into a
  real concern: merging to `master` deploys to production with no separate gate, and what gets
  deployed here is an authorization server. The default-off kill switch mitigates it; a
  deploy gate would address it properly.
- **Distributed rate limiting** (FUTURE) — the token endpoint is the strongest argument yet for
  it; §7 risk 7 states the accepted limitation rather than solving it.
- **GDPR-style export/deletion workflow** — `oauth_grant` and both token tables are new places a
  user's activity is recorded. Any data-subject export or erasure has to include them.

**Scope boundary, stated once:** this plan ships when a real Claude Desktop install can add
this server by URL, complete an authorization-code + PKCE flow through a consent screen
(including from a signed-out browser), call `list_agents` and see exactly that user's agents,
refresh its access token when it expires, and be revoked from the Account page — with every
existing PAT-based console client working unchanged throughout, and every existing test in
`lib/mcp/` and `lib/auth/` passing unmodified.
