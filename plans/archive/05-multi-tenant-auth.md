# Plan 05 — Multi-Tenant Schema, JWT Auth, Invite-Code Beta Signup

> **Status: 🟢 Reviewed 2026-07-30 — all 11 §16 confirmation points resolved; ready for
> `@dev`.** Written by `@architect` 2026-07-29, walked section-by-section with the user on
> 2026-07-30 (same process as Plan 01 and Plan 04 — see `CHANGELOG.md`'s 2026-07-29 Plan 04
> entry). §16 now records each decision rather than asking for it.
>
> **What the review changed.** Nine of the eleven points were confirmed as written. The other
> two, plus three items raised during the walk, are new design work folded in here:
>
> | Change | Where |
> |---|---|
> | Role values renamed `operator`/`member` → **`admin`/`user`** (the column stays `role`) | whole document; §5.2 |
> | Activity-log visibility becomes **opt-in consent, snapshotted per log row** | §5.6, §4.1, §4.3, §8 policy 22 |
> | `/settings` becomes **System Settings** (admin-only); a new **User Settings** surface at `/account` | §5.7, §7.1, §7.2 |
> | New **per-user LLM call cap** (15/hour, admin exempt, enforced at the gateway, dry-run fallback) | §3.9, §7.1, §8 policy 24, §11 Phase 3.7 |
> | The login/signup rate limiter (§3.8) is **no longer decided** — it stays as the fallback default and moves to §14 | §14, §16.7 |
> | Layout-mockup detour **waived once** for the login/signup/invite-code surfaces | §11 Phase 4, §16.11 |
>
> **Origin:** `@analyst` validated + split this task out of a larger bundled request (the
> other half, "Plan A", shipped as `plans/04-llm-gateway-settings.md`); `@impact` scanned the
> codebase and flagged 4 numbered unknowns plus a risk list. This plan resolves all 4
> explicitly (§5) and re-verified every claim in the impact report against the current
> code — three of its statements were **found to be inaccurate** and are corrected in §5.5.
>
> **Numbering:** `05` is correct. `01` (core loop), `02` (import hardening + structural),
> `03` (library/groups/import UI), `04` (LLM gateway + settings) are the existing numbered
> execution specs. `roadmap.md` is a deliberately unnumbered living doc.
>
> **Folder naming:** docs live under `architecture/` (renamed from `design/` on 2026-07-29).
> Anything in an older plan that says `design/…` means `architecture/…`.
>
> Standing project rules apply in full: **no commits without an explicit ask**, **no real
> Anthropic API call without an explicit ask**, **dev server off after any verification
> session**, **layout prototyped in `architecture/layout/Layout-Workbench.html` first** —
> with one **explicit, one-time waiver** of the last rule for this plan's five new form
> surfaces (§16.11). The standing rule itself is unchanged.

---

## 0. What this plan is, in one paragraph

Every route handler and every repository function in this codebase operates on "all agents"
and "all groups" — there is no concept of *whose* they are. Deploying that outside the local
network would put every beta user's agents in one shared pool. This plan introduces a
`user` table, an `ownerId` column on the two root entities (`agent`, `group`), **ownership
enforcement pushed down into the repository layer** (not scattered across 13 route handlers),
JWT cookie sessions with `jose`, password hashing with `bcryptjs`, a login page, an
invite-code-gated signup page, a `maxUsers` cap reusing Plan 04's `setting` table, and an
admin/user role split that makes `/settings` — renamed **System Settings** — (the live-LLM
toggle, the activity log, invite-code generation) admin-only. Alongside it, a new
always-available **User Settings** page (`/account`) holds the one thing that is genuinely
per-person: whether the admin may read that user's prompt and response content in the
activity log, which is **opt-in** and captured on each log row at write time. A **per-user
LLM call cap** (15 calls/hour, admin exempt) is enforced at the gateway so one shared API key
cannot be drained by one user, and offers dry-run/preview mode instead of a hard block.
Existing local dev data is migrated onto a bootstrap admin account so the current
single-tenant workflow keeps working unchanged.

**The one behavior that matters most:** after this plan, it must be **impossible to reach
another user's agent or group through any code path** — not merely "every route remembers to
check." That is why the check lives in the repository, where the data lives, rather than in
the layer that maps HTTP (§6).

### Explicitly NOT in this plan

Carried verbatim from the approved `@analyst` scope, plus two additions found during design:

- **Per-tenant / per-user API keys.** One shared server-side Anthropic key stays
  (Design Principle #7). Every user's calls spend the admin's money — this is a closed
  beta for friends, and the `liveLlmCalls` switch, the `maxUsers` cap, and (added at review)
  the **per-user hourly LLM call cap** (§3.9) are the controls.
- **Email verification, password reset / forgot-password, OAuth / social login.**
- **A full admin dashboard.** Invite-code generation + the bootstrap CLI are the entire
  user-management surface. Deleting a user, changing a role, or transferring agent ownership
  are manual SQL operations, documented in §8.
- **RBAC beyond `admin` vs. `user`.** Two roles, one privileged decision point
  (`/settings` and its routes).
- *(added at review)* **User Settings beyond the one consent toggle.** `/account` is built as
  a real, extensible surface (§5.7) but ships with exactly one control. Change-email,
  change-password, and delete-account remain deferred (§14) — they are what `/account` grows
  into, not what it launches with.
- *(added at review)* **Per-individual LLM quotas.** The hourly cap is one global number
  applying to every non-admin user (§3.9). Per-user overrides are a `setting`-shaped problem
  the `setting` table deliberately cannot express (constraint 8); deferred in §14.
- *(added during design)* **Sharing agents between users, and organizations/teams.** The
  `ownerId` model deliberately does not preclude these — see §14.
- *(added during design)* **Server-side session revocation / a session store.** A signed JWT
  is valid until it expires. §9 states the accepted risk and its mitigation trigger.

---

## 1. Guiding constraints (locked — do not replan during build)

1. **Ownership is enforced in the repository, never only at the route.** Every exported
   repository function that reads or writes an `agent` or `group` (or anything reachable
   *through* one) takes an `ownerId` and applies it in the `WHERE` clause. A route cannot
   fetch someone else's agent even if the author forgets to check, because there is no
   function that will return it. (§6)
2. **`ownerId` is never optional and never defaulted in any function signature.** An
   optional parameter is an opt-out, and an opt-out will eventually be taken by accident.
3. **Denial of an owned resource returns `404`, never `403`.** A `403` confirms the resource
   exists. The only `403` in this plan is the admin-only gate on `/settings`, where the
   resource's existence is not a secret. (§7.3)
4. **`middleware.ts` is a UX and defense-in-depth layer, never the authorization boundary.**
   Every route handler and every server component independently establishes its own session.
   Middleware runs on the Edge runtime and therefore cannot read the SQLite DB at all.
   (§3.6 — and see the CVE note there for why this is not merely stylistic.)
5. **Password hashing happens strictly outside any `db.transaction()` block.**
   `better-sqlite3` transaction callbacks must be synchronous (the rule is already written at
   the top of `lib/db/repository/agents.ts`); `bcryptjs`'s async API inside one would either
   throw or silently commit outside the transaction. This is enforced *structurally*, not by
   comment: `createUserWithInvite()` accepts a **`passwordHash`, never a password** (§4.4).
6. **The repository layer never sees a plaintext password and never issues a token.**
   `lib/auth/*` owns hashing and JWTs; `lib/db/repository/users.ts` owns rows.
7. **No credential, hash, token, or invite code ever appears in a log line, an error
   message, a response body it wasn't explicitly designed for, or an `llm_call_log` payload.**
   Extends Design Principle #8 from the API key to all secrets.
8. **The catalog tables (`config_def`, `section_def`) and `setting` stay global.** They are
   the same for every tenant, forever. A per-user setting, if ever needed, is a different
   table — not a column added to `setting` (Plan 04 §13 already committed to this).
9. **`llm_call_log` stays append-only.** It gains two columns — nullable `user_id` and
   `shared_with_admin` — and one composite index, and nothing else. **No row is ever
   updated after it is written.** Pre-auth rows keep `user_id: null`, meaning "before
   multi-tenancy" — they are never backfilled (same rule as `agentId`, Rules Index #45).
10. **The migration is destructive-by-necessity (`DROP TABLE` during rebuild) and therefore
    gets a mandatory file backup gate.** See §4.5 step 0.
11. *(added at review)* **A user's log-sharing consent is snapshotted onto each log row at
    write time and never rewritten.** Changing the preference later changes what future rows
    say, never what past rows say. This is what keeps constraint 9 true while still giving the
    user a preference they can change: consent is a property of *the call that was made*, not
    a property of the account read at display time. (§5.6)
12. *(added at review)* **The per-user LLM call cap is enforced inside `lib/ai/gateway.ts`,
    never in a route handler.** Same structural argument as constraint 1: the gateway is
    already the single choke point every AI call must pass (Plan 04 constraint 2), so a future
    caller cannot route around the cap by forgetting to check it. A route may *translate* the
    refusal into HTTP; it may not *decide* it. (§3.9)

---

## 2. Architecture

### 2.1 Layering

```
middleware.ts (Edge)         ← cookie present + JWT signature/exp valid? No DB. Redirect or 401.
  │                            NOT the authorization boundary (constraint 4).
  ├─ server component (app/**/page.tsx)
  │     └─ requirePageSession()  → redirect('/login?next=…')
  └─ route handler (app/api/**)
        └─ authenticate() / authenticateAdmin()  → 401 / 403
              └─ lib/auth/session.ts   ← cookies() → verify JWT → load user row (fresh)
              └─ repository (lib/db/repository/*)
                    ← THE ownership boundary. Every query is owner-scoped.
                    └─ lib/db/client.ts
```

Three independent facts about a request are established in three different places,
deliberately:

| Question | Answered by | Mechanism |
|---|---|---|
| *Who is calling?* | `lib/auth/session.ts` | Signed cookie → `sub` claim → fresh `user` row read |
| *May they touch this row?* | `lib/db/repository/*` | `WHERE owner_id = ?` in the same query that fetches it |
| *May they spend an LLM call?* | `lib/ai/gateway.ts` | Count of that user's non-dry-run `llm_call_log` rows in the trailing hour, read at the choke point (§3.9) |

None can be satisfied by another, and none is optional. The second and third are what make
this plan safe to build in the presence of future routes written by someone who has not read
it: each lives in the layer the thing being protected already has to pass through.

**Why the session read hits the DB on every request.** `getSession()` does one indexed
primary-key lookup on `user` after verifying the token. It does *not* trust role or existence
claims baked into the JWT. This costs sub-millisecond on synchronous `better-sqlite3` and buys
two things a claims-only design cannot have: deleting a user kills their live sessions
immediately, and demoting an admin takes effect on their next request rather than on their
next login. This is the same reasoning Plan 04 §6 used to refuse caching the `liveLlmCalls`
setting — a security control that lags reality reads as unreliable.

### 2.2 Files

| File | New/Modified | Role |
|---|---|---|
| `package.json` | modified | `+jose`, `+bcryptjs`, `+@types/bcryptjs`; `+"auth:bootstrap"` script |
| `.env.example` | modified | `JWT_SECRET`, `BOOTSTRAP_USER_EMAIL`, `BOOTSTRAP_USER_PASSWORD` |
| `lib/env.ts` | modified | `getJwtSecret()` (+ length validation), `assertServerEnv()` |
| `instrumentation.ts` | **new** (root) | Next's startup hook — calls `assertServerEnv()` so a missing/short `JWT_SECRET` fails at boot, not on first login (§3.2) |
| `lib/db/schema.ts` | modified | `user` (incl. `shareLogsWithAdmin`), `inviteCode` tables; `agent.ownerId`, `group.ownerId`, composite unique indexes; `llmCallLog.userId` + `llmCallLog.sharedWithAdmin` + `llm_call_log_user_created_idx` |
| `lib/db/migrations/0003_*.sql` + `meta/` | **new** | Generated for the snapshot/journal, **body hand-authored** (§4.5) — the one deliberate exception to Plan 04's "never hand-edit" rule, justified there |
| `lib/auth/constants.ts` | **new** | `BOOTSTRAP_USER_ID`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS`, `BCRYPT_COST`, `NO_PASSWORD_SENTINEL` |
| `lib/auth/jwt.ts` | **new** | `signSessionToken()`, `verifySessionToken()` — `jose`, HS256. Edge-safe: no Node-only imports, no `server-only` |
| `lib/auth/password.ts` | **new** | `hashPassword()`, `verifyPassword()`, `validatePasswordPolicy()`. Node-only, `server-only` |
| `lib/auth/session.ts` | **new** | `getSession()`, `requirePageSession()`. Reads `next/headers` cookies, loads the user row |
| `lib/auth/guard.ts` | **new** | `authenticate()`, `authenticateAdmin()` → `{ok:true,session} \| {ok:false,response}` |
| `lib/auth/inviteCode.ts` | **new** | `generateInviteCode()`, `normalizeInviteCode()` |
| `lib/auth/rateLimit.ts` | **new** | In-process fixed-window limiter for the two public auth routes (§3.8) |
| `middleware.ts` | **new** (root) | Coarse gate; public-path allowlist; `/api/*` → 401 JSON, pages → redirect |
| `lib/db/repository/users.ts` | **new** | Users + invite codes. `createUserWithInvite()` is the one transactional signup primitive; `getUserPolicy()` is the narrow read the gateway uses (role + consent, never the hash) |
| `lib/db/repository/agents.ts` | modified | 9 functions owner-scoped (§6.2) |
| `lib/db/repository/groups.ts` | modified | 5 functions owner-scoped (§6.2) |
| `lib/db/repository/llmCallLog.ts` | modified | `userId` + `sharedWithAdmin` on write input, list DTO, and as an optional filter; `getCallLog(id, viewerUserId)` redacts payloads (§5.6); new `countLlmCallsInWindow()` for the cap (§3.9) |
| `lib/db/repository/index.ts` | modified | Barrel |
| `lib/db/seed.ts` | modified | Seeds `maxUsers` with `onConflictDoNothing` (Rules Index #47's rule applies). **Does not create users.** |
| `scripts/bootstrap-user.ts` | **new** | `npm run auth:bootstrap` — sets the bootstrap admin's email + password (§5.1) |
| `lib/settings.ts` | modified | `maxUsers` and `maxLlmCallsPerUserPerHour` entries; `SettingDef` gains optional `min`/`max`; typed accessors for both |
| `app/api/settings/route.ts` | modified | `authenticateAdmin()` on GET and PATCH; `min`/`max` validation |
| `app/api/llm-call-log/route.ts`, `[id]/route.ts` | modified | `authenticateAdmin()` |
| `app/api/settings/invite-codes/route.ts` | **new** | `GET` list, `POST` generate — admin-only |
| `app/api/settings/invite-codes/[code]/route.ts` | **new** | `DELETE` revoke an unredeemed code — admin-only |
| `app/api/auth/login/route.ts` | **new** | `POST` — email+password → cookie |
| `app/api/auth/signup/route.ts` | **new** | `POST` — invite code + email + password → user + cookie |
| `app/api/auth/logout/route.ts` | **new** | `POST` — clears the cookie |
| `app/api/account/route.ts` | **new** | `GET`/`PATCH` the caller's own preferences — any session, never another user's row (§5.7) |
| `app/api/agents/route.ts` | modified | `authenticate()`; `listAgents(ownerId)` / `createAgent(ownerId, …)` |
| `app/api/agents/[id]/route.ts` | modified | `authenticate()`; owner-scoped GET/PATCH/DELETE |
| `app/api/agents/[id]/sections/[sectionId]/route.ts` | modified | `authenticate()`; **the confirmed `[id]`-ignored bug is fixed here** (§6.4) |
| `app/api/agents/[id]/export/route.ts` | modified | `authenticate()`; owner-scoped |
| `app/api/agents/[id]/groups/route.ts`, `[groupId]/route.ts` | modified | `authenticate()`; owner-scoped membership |
| `app/api/agents/import/route.ts` | modified | `authenticate()`; `upsertAgentFromImport(ownerId, …)`; `ctx.userId` |
| `app/api/groups/route.ts`, `[id]/route.ts` | modified | `authenticate()`; owner-scoped |
| `app/api/chat/route.ts` | modified | `authenticate()`; owner-scoped agent load; `ctx.userId`; optional `dryRun` in the body; maps `LlmUserCapReachedError` → `429` (§3.9) |
| `lib/ai/gateway.ts` | modified | `LlmCallContext` gains `userId` and `forceDryRun`; writes `userId` + the consent snapshot onto the log row (§5.6); enforces the per-user cap before the live path (§3.9) |
| `lib/ai/importConverter.ts`, `structuralConverter.ts`, `chatMediator.ts` | modified — **one block each** | They still pass `ctx` straight through. The only edit is their single post-call `if (!res.ok) throw new LlmDryRunBlockedError(…)` line, which becomes a two-way branch on `res.reason` (§3.9). No change to their `try`/`catch` blocks, their signatures, or their prompt handling |
| `scripts/test-structural-import.ts` | modified | One line: `userId: null` in its `ctx` literal |
| `app/page.tsx` | modified | `requirePageSession()`; `listAgents(session.userId)` |
| `app/agents/[id]/page.tsx` | modified | `requirePageSession()`; owner-scoped loads; passes `session` down |
| `app/settings/page.tsx` | modified | `requirePageSession()` + admin check → `redirect('/')`; passes `session.userId` into `getCallLog()` as the viewer (§5.6) |
| `app/account/page.tsx` | **new** | User Settings — any session; reads the caller's own row (§5.7) |
| `app/login/page.tsx`, `app/signup/page.tsx` | **new** | Client forms. Signup carries the consent choice (§5.6) |
| `app/components/Account/AccountView.tsx` | **new** | Client component for `/account`: the log-sharing toggle, `PATCH /api/account` |
| `app/components/shell/Topbar.tsx` | modified | Takes a `session` prop; shows email + Logout; **always-visible `Account`** link; **admin-only `⚙ System Settings`** link (§5.7) |
| `app/components/WorkbenchShell.tsx` | modified | Threads `session` to `Topbar` |
| `app/components/Settings/SettingsView.tsx` | modified | `maxUsers` + `maxLlmCallsPerUserPerHour` fields, the invite-code panel, and the redacted-entry treatment in the log list (§5.6) |
| `app/components/Chat/ChatPanel.tsx` | modified | Beyond the `apiFetch` swap: presents the cap-reached choice (preview vs. wait) and re-sends with `dryRun: true` (§3.9) |
| `app/components/Library/ImportDialog.tsx` | modified | Same cap-reached choice on the import path |
| `lib/apiFetch.ts` | **new** | Client-side `fetch` wrapper: on `401`, hard-navigate to `/login?next=…` (§5.4) |
| 9 client components (14 call sites) | modified | Swap bare `fetch` → `apiFetch` (§5.4) |
| `lib/db/__tests__/test-users.ts` | **new** | `createTestUser(role?)` — used by every existing suite |
| tests | many modified, 8 new | §10 |

---

## 3. The auth subsystem, and the two rate limits

§3.1–3.7 are the auth subsystem proper. **§3.8 and §3.9 are this plan's two rate limits** —
one protecting credentials (login/signup attempts, in process) and one protecting money
(LLM calls per user, in the database). They sit next to each other deliberately: they are the
same *kind* of rule with deliberately different mechanisms, and §3.9's design is easiest to
justify by comparison with §3.8's.

### 3.1 Library choices

| Concern | Choice | Why this one |
|---|---|---|
| JWT | **`jose`** | Pure ESM/WebCrypto — the only mainstream JWT library that runs unmodified in **both** the Next.js Edge runtime (`middleware.ts`) and Node (route handlers, server components). `jsonwebtoken` uses Node `crypto` and cannot run at the edge, which would force either a Node-runtime middleware (`experimental.nodeMiddleware`) or two different verification code paths — two implementations of "is this token valid" is exactly the drift this codebase's fitness tests exist to prevent. `jose` is dependency-free. |
| Password hashing | **`bcryptjs`** | Pure JS, **no native compilation**. `bcrypt` and `argon2` are node-gyp builds; this project's primary dev environment is Windows and its only current native dep (`better-sqlite3`) ships prebuilds. Adding a source-built native dep would make `npm install` fragile on both the dev box and whatever host is chosen for the first deploy. Argon2id is cryptographically the better algorithm; bcrypt at cost 10 is entirely adequate for a ≤ 10-user closed beta, and the hash format is portable if this is ever revisited (§14). |

Both are added at Phase 0.1 and are the **only** two new runtime dependencies in this plan.

**`bcryptjs` is async, this codebase's repository layer is synchronous.** `hashPassword()` /
`verifyPassword()` are `async`; every `db.transaction()` callback in this repo is and must
remain synchronous. Guiding constraint 5 makes this structural rather than a comment:
`createUserWithInvite()` takes `passwordHash: string`. There is no way to pass a plaintext
password into the transactional path, so no future edit can "helpfully" move the hashing
inside it.

### 3.2 Secret and env handling

```
JWT_SECRET=<≥32 chars, random>       # required, no default, never logged
BOOTSTRAP_USER_EMAIL=you@example.com  # only read by scripts/bootstrap-user.ts
BOOTSTRAP_USER_PASSWORD=…             # only read by scripts/bootstrap-user.ts
```

- `getJwtSecret(): Uint8Array` — throws if unset **or shorter than 32 characters**. A short
  HMAC secret is the single most common way a JWT deployment is broken, and it fails silently
  (everything works; the tokens are just forgeable).
- **`instrumentation.ts`** at the repo root exports `register()`, which Next runs once at
  server startup (stable since Next 15). It calls `assertServerEnv()`, which resolves
  `JWT_SECRET` eagerly. This is the mechanism that satisfies `@impact`'s "must throw at
  startup, not lazily on first auth call" — a lazy throw would let a misconfigured deploy
  serve the login page and fail only when someone tries to use it.
- `assertServerEnv()` deliberately does **not** check `ANTHROPIC_API_KEY`: that one is
  legitimately optional at boot (dry-run mode is a supported state, Plan 04).
- The secret is read into memory once per process and never rendered, logged, or returned.

### 3.3 Token and cookie

| Property | Value | Rationale |
|---|---|---|
| Algorithm | HS256 | Symmetric; one process signs and verifies. No key distribution problem. |
| Claims | `sub` (user id), `email`, `iat`, `exp` | **No `role` claim** — role comes from the fresh DB read (§2.1). `email` is carried only as a debugging convenience and is never trusted for authorization. |
| Lifetime | 7 days, fixed | Long enough that friends testing an agent workbench are not re-authenticating mid-session; short enough that a leaked token expires. **No sliding refresh** (§14). |
| Cookie name | `myagent_session` | |
| `httpOnly` | `true` | Not readable by any script — the point of not using `localStorage`. |
| `sameSite` | `lax` | Blocks cross-site POSTs (the CSRF surface) while keeping normal top-level navigation to `/agents/…` working. This app has no cross-site flows. |
| `secure` | `process.env.NODE_ENV === 'production'` | Must be off for `http://localhost` dev, on for the deploy. |
| `path` | `/` | |
| `maxAge` | `SESSION_TTL_SECONDS` (7 d), matching `exp` | Cookie and token expire together — no "cookie present but token dead" state beyond clock skew. |

**CSRF:** `sameSite=lax` plus the fact that every mutating endpoint is `POST`/`PATCH`/`DELETE`
with a JSON body (which a cross-origin HTML form cannot produce without triggering a CORS
preflight) is the accepted defense. No CSRF token is issued. Recorded as an explicit decision
in §14, with the trigger for revisiting it (any future `GET` that mutates, or any embedded /
third-party integration).

### 3.4 `lib/auth/session.ts` (Node runtime, `server-only`)

```
export type Session = { userId: string; email: string; role: 'admin' | 'user' };

getSession(): Promise<Session | null>
  cookies() → token → verifySessionToken() → getUserById(sub) → Session
  returns null on: no cookie · bad signature · expired · user row gone

requirePageSession(nextPath: string): Promise<Session>
  getSession() ?? redirect(`/login?next=${encodeURIComponent(nextPath)}`)
```

`getSession()` is the **single seam** the route tests mock (§10.2) — nothing else in the
codebase reads `next/headers`.

**`Session` deliberately does not carry `shareLogsWithAdmin`.** It carries only what
*authorization* needs. The consent flag is read fresh where it is used — by `/account`'s
server component for display, and by the gateway at write time (§5.6) — for the same reason
§2.1 refuses a `role` claim in the token: a preference cached in a session object is a
preference that can lag the user's last click, and here the lag would be visible as "I turned
sharing off and it still recorded me as shared."

### 3.5 `lib/auth/guard.ts` — the route-handler shape

Deliberately a plain function returning a discriminated union rather than a higher-order
`withAuth(handler)` wrapper. Reasons: it matches this codebase's uniformly explicit,
non-HOF route style; it keeps the handler's own signature intact (the tests import and call
handlers directly, `agents.test.ts` line 35); and the `if (!auth.ok) return auth.response;`
line is visible in a diff, whereas a missing decorator is invisible.

```
const auth = await authenticate();            // or authenticateAdmin()
if (!auth.ok) return auth.response;           // 401 {error:'unauthorized'} / 403 {error:'forbidden'}
const { session } = auth;
```

Every non-`/api/auth/*` route handler opens with exactly these three lines. §10.4's fitness
test asserts that mechanically.

### 3.6 `middleware.ts`

```
matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)']

PUBLIC = ['/login', '/signup', '/api/auth/login', '/api/auth/signup', '/api/auth/logout']

token invalid/absent:
  path starts with '/api/' → 401 JSON { error: 'unauthorized' }
  otherwise               → 307 redirect '/login?next=<pathname><search>'
token valid and path is '/login' or '/signup' → 307 redirect '/'
```

- Verifies **signature and expiry only**, via `jose`. It cannot check that the user still
  exists — the Edge runtime cannot open `better-sqlite3`. That check happens in
  `getSession()`.
- **This is why constraint 4 exists, and it is not merely stylistic.** Next.js
  CVE-2025-29927 allowed skipping middleware entirely with a crafted `x-middleware-subrequest`
  header on versions below 15.2.3. This repo is on **15.5.22** (verified 2026-07-29), so that
  specific hole is patched — but a design in which middleware is the only gate is one
  framework CVE away from full data exposure. Here, bypassing middleware buys an attacker
  exactly nothing: the route handler's own `authenticate()` and the repository's `owner_id`
  filter are both still in the path.
- The `next` query parameter is **validated on consumption**, not on production: the login
  page only honours a value matching `^/(?!/)` (a single leading slash, no protocol, no
  `//host`). Otherwise it redirects to `/`. Without this, `/login?next=https://evil.example`
  is an open redirect.

### 3.7 Password policy

| Rule | Value | Note |
|---|---|---|
| Minimum length | 12 characters | Single control; no composition rules (they push users to `Password1!`). |
| **Maximum length** | **72 bytes UTF-8** | **Not cosmetic.** bcrypt silently truncates input at 72 bytes — a 100-character password would authenticate against its own first 72 bytes, and two different long passwords could collide. Rejecting with `400 password_too_long` is honest; silently truncating is not. |
| Storage | `bcryptjs.hash(password, 10)` | Cost 10 ≈ 100–300 ms in pure JS (`bcryptjs` is several times slower than native bcrypt — cost 12 would push a login past a second). |
| Sentinel | `passwordHash === ''` means "no password set" | The bootstrap row is created by SQL, which cannot hash. Login **explicitly rejects** an empty hash before ever calling `verifyPassword` (§8 invariant 9). |

### 3.8 Rate limiting (`lib/auth/rateLimit.ts`)

`POST /api/auth/login` and `POST /api/auth/signup` are the only endpoints reachable without a
session on the public internet. A fixed-window in-process counter: **10 attempts per 15
minutes per (route, client IP)**, IP taken from the first entry of `x-forwarded-for` falling
back to `'unknown'`. Over the limit → `429 { error: 'rate_limited', retryAfterSeconds }`.

Stated limitations, deliberately accepted rather than engineered around: it is per-process
(a multi-instance deploy would multiply the effective limit), it resets on restart, and
`x-forwarded-for` is spoofable unless the host terminates TLS and rewrites it. It costs ~30
lines and no dependency, and it turns "unlimited offline-speed guessing" into "10 tries per
window" — which, combined with bcrypt's own ~200 ms floor, is the right amount of effort for
a ≤ 10-user beta.

**Status after review (§16.7): this stays as written, but it is not a settled decision.**
Whether to keep it at all, and whether to disclose it at the login form ("too many attempts —
try again in N minutes" is already the 429 body; the question is whether the *existence* of a
limit is stated up front), were both moved to §14 as open items. Nothing overrides this
design, so `@dev` builds it exactly as specified here; if the §14 item later resolves to
"drop it", removing it is deleting one file, one import, and two call sites.

### 3.9 Per-user LLM call cap (added at review)

The second of this plan's two rate limits, and the one that protects money rather than
credentials. One Anthropic key is shared by every user (§0), so a single user looping imports
can spend the admin's budget with no ceiling between `liveLlmCalls` (all-or-nothing, global)
and `maxUsers` (bounds *how many* people, not *how much* each does).

| Parameter | Value | Rationale |
|---|---|---|
| Limit | **15 LLM calls per user per hour** | Confirmed at review. Comfortably above a real editing session (a chat instruction and a couple of imports), low enough that a runaway loop is capped at a known hourly cost |
| Scope | **One global number for every non-admin user** | Not per-individual. Same shape as `maxUsers`: a `SETTING_DEFS` entry, so changing it is a Settings edit, not a migration or a deploy |
| Setting key | `maxLlmCallsPerUserPerHour`, `datatype: 'int'`, default `15`, `min: 1` | Uses the `min` bound §15.5 adds for `maxUsers`; `0` would be indistinguishable from "the feature is broken" |
| Exemption | **The admin is exempt entirely** | The admin owns the key and the bill. A cap on the person who pays protects nobody and would block exactly the account that needs to debug an outage |
| Enforcement point | `lib/ai/gateway.ts`, before the live path | Constraint 12. The gateway is already the single choke point (Plan 04 constraint 2) |
| Storage | **No new table** | The count is derived from `llm_call_log`, which already records every call with a timestamp and (as of this plan) a `user_id`. A counter table would be a second source of truth about a fact the log already states, and it would have to be kept correct under the log's append-only rule. Contrast §3.8's limiter, which *is* in-process precisely because failed logins are deliberately **not** persisted |
| Index | `llm_call_log_user_created_idx` on `(user_id, created_at)` | Makes the count an index range scan rather than a table scan. Added in the same migration (§4.5) |

#### Window: rolling 60 minutes, not a fixed clock hour

**Chosen: rolling.** The count is `WHERE user_id = ? AND dry_run = 0 AND created_at >= (now − 3600)`.

This is a deliberate divergence from §3.8's fixed-window limiter, and the reason is that the
underlying mechanism is different, not that the policy should be:

- §3.8 counts in a `Map` in process memory. Fixed windows are what make that cheap — one
  integer per key, reset by comparing a window stamp. A rolling window there would mean
  storing a timestamp array per IP.
- §3.9 counts rows in a table that **already stores every timestamp**. Rolling costs one
  comparison in an indexed `WHERE`; fixed would cost *more* code (computing the bucket start).
- A fixed clock hour permits a 2× burst across the boundary — 15 calls at 10:59 and 15 more at
  11:01. For a limit that exists to bound spend, that is the failure mode that matters.
- Rolling gives an honest `retryAfterSeconds`: the oldest in-window call's timestamp + 3600 −
  now, i.e. "when a slot actually frees up." A fixed window can only say "when the bucket
  resets", which is wrong whenever the user did not spend the whole budget at the start.

So the repository function returns both numbers in one query:

```
countLlmCallsInWindow(userId: string, sinceEpochSeconds: number):
  { count: number; oldestAt: Date | null }     // COUNT(*) + MIN(created_at), one statement
```

**Dry-run rows do not count** (`dry_run = 0` in the filter). This is load-bearing, not a
detail: the offered fallback when the cap is hit *is* dry-run mode, so if dry-run rows
counted, taking the fallback would keep pushing the window forward and the user would never
get back under the cap. **Failed live calls do count** — a provider error still consumed a
request against a real API, and the alternative invites "retry until something 500s" as a way
around the cap.

#### What happens when the cap is reached — a choice, not a wall

The gateway gains a third result variant rather than throwing, keeping its existing "policy
refusals are returned, provider failures are thrown" shape:

```ts
export type LlmGatewayResult =
  | { ok: true;  response: LlmResponse; logId: string | null }
  | { ok: false; reason: 'dry_run_blocked';  model: string; logId: string | null }
  | { ok: false; reason: 'llm_cap_reached';  model: string; logId: null;
      limit: number; windowSeconds: number; retryAfterSeconds: number };
```

Execution order inside `run()`, extending Plan 04's normative list:

```
1. Resolve model                                     (unchanged)
2. Read liveLlmCalls (fresh)                         (unchanged)
3. If !live OR ctx.forceDryRun → dry-run log row → { ok:false, 'dry_run_blocked' }
4. NEW — cap gate, only on the path that would spend money:
     ctx.userId == null                      → skip (pre-auth rows, scripts, tests)
     getUserPolicy(userId)?.role === 'admin'  → skip (exempt)
     countLlmCallsInWindow(...) >= limit      → { ok:false, 'llm_cap_reached', … }
5. Live path → provider → log row             (unchanged, plus the two new columns)
```

- **A cap-blocked attempt writes no log row.** Deliberate, and the one place this diverges
  from the dry-run path (which does write one). The log table *is* the counter; letting
  denials append to it would inflate the count that produced them and make
  `retryAfterSeconds` drift forward on every retry. It is `console.info`'d instead:
  `[llm-gateway] cap reached — user=<id> count=<n> limit=<n>`.
- **The gate sits after the dry-run branch, not before.** If the whole deployment is in
  dry-run mode nothing is being spent, so there is nothing to cap; and a user who has already
  hit the cap must still be able to take the dry-run fallback.
- **`ctx.forceDryRun` may only ever downgrade a live call to a dry run, never the reverse.**
  It is set from a request body (`{ dryRun: true }`), so this direction matters: the field can
  only cause *less* spending, which is why accepting it from a client is safe. There is no
  body field that can turn dry-run mode off. Stated as invariant §8.16.

The three AI callers each translate the new variant into a typed error, exactly as they
already do for dry-run — one block each, no other change:

```ts
if (!res.ok) {
  if (res.reason === 'llm_cap_reached') throw new LlmUserCapReachedError(res);
  throw new LlmDryRunBlockedError(res.logId, ctx.kind, res.model);
}
```

`LlmUserCapReachedError` lives beside `LlmDryRunBlockedError` in `lib/ai/gateway.ts` and
carries `limit`, `windowSeconds`, and `retryAfterSeconds`. `/api/chat` and
`/api/agents/import` catch it **first**, in the same position their existing catch chains
already give `LlmDryRunBlockedError` (§7.1), and return:

```
429 { error: 'llm_cap_reached', limit, windowSeconds, retryAfterSeconds, canDryRun: true }
   + Retry-After: <retryAfterSeconds>
```

`canDryRun: true` is what makes this a choice rather than an error: `ChatPanel` and
`ImportDialog` read it and render two actions — **"Preview without sending"** (re-issues the
identical request with `dryRun: true` in the body, which returns the familiar
`409 llm_dry_run` shape those components *already* handle from Plan 04) and **"Wait"**
(dismisses, showing the humanised `retryAfterSeconds`). The flag is present so that a future
state where the fallback is unavailable — say, dry-run globally disabled — can say
`canDryRun: false` without a new error code.

---

## 4. Data model

### 4.1 New entity: `user`

```ts
export const user = sqliteTable('user', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),          // stored lowercased + trimmed
  passwordHash: text('password_hash').notNull(),    // '' = sentinel, see §3.7
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  shareLogsWithAdmin: integer('share_logs_with_admin', { mode: 'boolean' })
    .notNull().default(false),                      // opt-in consent, §5.6
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});
```

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text uuid | PK | Referenced by `agent.ownerId`, `group.ownerId`, `invite_code.createdBy`/`redeemedBy`, `llm_call_log.userId` — all **soft references**, matching every other cross-table link in this schema (`schema.ts` header comment). |
| `email` | text | not null, unique index | The login identifier. **Normalized to lowercase + trimmed before both storage and lookup** — otherwise `Bob@x.com` and `bob@x.com` are two accounts and the unique index does not stop it (SQLite's default collation is case-sensitive). |
| `passwordHash` | text | not null | bcrypt hash, or `''` for the un-activated bootstrap row. |
| `role` | text | not null, default `'user'` | Values `'admin' \| 'user'` (renamed from `'operator' \| 'member'` at review — **the column name `role` is unchanged**, only its values). Drizzle's `enum` on a SQLite `text` column is **TypeScript-only — no `CHECK` constraint is generated** (Plan 04 §4.2 established this for `kind`). Adding a third role later needs no migration. |
| `shareLogsWithAdmin` | int boolean | not null, **default `false`** | The user's standing consent for the admin to read their prompt/response content in the activity log (§5.6). **Default-false is the whole point**: consent must be an action, never an omission. Set at signup from an explicit choice, changed later at `/account`. Read at LLM-call time and *copied onto the log row*; the row's copy, not this column, governs what the admin sees (constraint 11). |
| `createdAt` | int timestamp | not null, default now | |

- **Lifecycle:** created by the migration (bootstrap only) or by signup. Never deleted by the
  application — there is no delete-user endpoint in scope. Manual deletion is documented in
  §8 including its consequence (orphaned agents).
- **No `updatedAt`.** Two fields are mutable after creation — `passwordHash` via the bootstrap
  CLI (which prints what it did) and `shareLogsWithAdmin` via `/account` — and neither needs a
  timestamp, because neither is ever the source of truth about a past event: the bootstrap CLI
  reports at the console, and every log row carries its own frozen copy of the consent value
  that applied when it was written. An `updatedAt` here would be a field nothing reads.
- **Why the consent flag lives on `user` and not in `setting`.** Constraint 8 forbids
  per-user rows in `setting`, and says a per-user preference is "a different table". A column
  on the row that *is* the user is the smallest form of that: one field, no new table, no
  join, and it is loaded by the same query that already loads the user.

### 4.2 New entity: `invite_code`

```ts
export const inviteCode = sqliteTable('invite_code', {
  code: text('code').primaryKey(),                  // canonical 'XXXX-XXXX-XXXX-XXXX'
  note: text('note'),                               // optional admin label ("for Alice")
  createdBy: text('created_by').notNull(),          // soft ref → user.id
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  redeemedBy: text('redeemed_by'),                  // soft ref → user.id; NULL = unused
  redeemedAt: integer('redeemed_at', { mode: 'timestamp' }),
}, (t) => ({
  byRedeemed: index('invite_code_redeemed_idx').on(t.redeemedBy),
}));
```

| Field | Notes |
|---|---|
| `code` | **The natural primary key**, so single-use is enforced by the PK plus the `redeemedBy IS NULL` check, with no surrogate id to keep in sync. Canonical form: 16 characters in four dash-separated groups, drawn from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 symbols; `I`, `L`, `O`, `0`, `1` excluded so a code can be read aloud or copied off a screen). ≈ 79 bits of entropy — guessing is not a threat model, and `maxUsers` is the backstop if it somehow were. Generated with `crypto.randomInt` per character (uniform; no modulo bias). PK collision → regenerate, up to 3 attempts, then `500`. |
| `note` | Optional free text the admin sets when generating, so a list of codes is legible. Rendered as a React text node, never HTML. |
| `redeemedBy` / `redeemedAt` | Both null or both set. Set atomically inside the signup transaction (§4.4). |

**Codes are stored in plaintext, not hashed.** This is a deliberate, stated tradeoff: the
admin must be able to *re-read* a code in Settings to send it to a friend a second time,
which hashing makes impossible. The mitigating facts: a code is single-use, worthless once
redeemed, worthless once `maxUsers` is reached, only grants "may create an account", and is
only readable by someone who already has admin DB or session access. Revisit trigger in §14.

### 4.3 Modified entities

**`agent`** — `name`'s standalone `.unique()` is **removed** and replaced by a composite:

```ts
  ownerId: text('owner_id').notNull(),               // soft ref → user.id
  name: text('name').notNull(),                      // ← .unique() removed
  …
}, (t) => ({
  ownerName: uniqueIndex('agent_owner_name_unique').on(t.ownerId, t.name),
  byOwner:   index('agent_owner_idx').on(t.ownerId),
}));
```

**`group`** — identical treatment (`group_owner_name_unique`, `group_owner_idx`).

**`llm_call_log`** — the nullable column Plan 04 §13 promised, plus the consent snapshot and
one index added at review:

```ts
  userId: text('user_id'),        // soft ref → user.id; NULL = pre-auth row
  sharedWithAdmin: integer('shared_with_admin', { mode: 'boolean' })
    .notNull().default(false),    // the writer's consent AT WRITE TIME — never updated (§5.6)
  …
}, (t) => ({
  byCreated:    index('llm_call_log_created_idx').on(t.createdAt),      // existing
  byKind:       index('llm_call_log_kind_idx').on(t.kind),              // existing
  byUserCreated: index('llm_call_log_user_created_idx')
                   .on(t.userId, t.createdAt),                          // NEW — the §3.9 count
}));
```

| Field | Notes |
|---|---|
| `sharedWithAdmin` | Written once, by the gateway, from `getUserPolicy(userId).shareLogsWithAdmin`. **Never updated** — that is constraint 9 and constraint 11 in one column. A user who turns sharing on today does not retroactively expose last week's prompts; a user who turns it off does not retroactively hide them. Both directions are stated to the user at `/account` in exactly those words (§5.7). |
| `byUserCreated` | Serves one query — the §3.9 cap count — and it is on the hot path of every LLM call, so it is not speculative indexing. |

**Pre-auth rows (`user_id IS NULL`) are never redacted**, despite carrying
`shared_with_admin = 0` from the column default. They predate multi-tenancy; they were written
in a single-tenant DB that belonged to the admin. The redaction rule (§5.6) keys off
`user_id`, not off the flag alone, precisely so that the column's default does not accidentally
hide the admin's own history from them.

**Nothing else gains an owner.** `agent_config`, `agent_section`, `section_revision`,
`agent_snapshot`, and `membership` are all reachable **only** through an `agent` or a `group`,
and ownership is established once at that parent. Duplicating `owner_id` onto children would
create a second source of truth that can disagree with the first — the classic way a
multi-tenant bug appears years later. `config_def` / `section_def` / `setting` are global
(constraint 8).

**Fortunate structural fact, verified in `migrations/0000_*.sql`:** Drizzle emits column
`.unique()` as a **separate `CREATE UNIQUE INDEX`** (`agent_name_unique`,
`group_name_unique`), not as an inline table constraint. Swapping a single-column unique index
for a composite one is therefore index-level work, not a schema constraint change — one less
reason the tables need rebuilding.

### 4.4 The one transactional primitive: `createUserWithInvite()`

```
createUserWithInvite(input: {
  email: string;                 // already normalized
  passwordHash: string;          // already hashed — constraint 5
  code: string;                  // already normalized
  maxUsers: number;              // read from settings by the caller
  shareLogsWithAdmin: boolean;   // the signup consent choice — never inferred (§5.6)
}): { ok: true; user: UserRow }
 | { ok: false; reason: 'invalid_code' | 'email_exists' | 'cap_reached' }
```

Everything below happens inside **one** synchronous `db.transaction()`:

1. `SELECT` the invite code. Absent, or `redeemedBy IS NOT NULL` → `invalid_code`.
2. `SELECT COUNT(*) FROM user`. `>= maxUsers` → `cap_reached`.
3. `SELECT` user by email → exists → `email_exists`.
4. `INSERT` the user (`role: 'user'`, always — signup can never mint an admin;
   `shareLogsWithAdmin` from the input, which the route has already coerced to a strict
   boolean — anything that is not literally `true` is `false`, §8 invariant 15).
5. `UPDATE invite_code SET redeemed_by = <new id>, redeemed_at = now WHERE code = ? AND redeemed_by IS NULL`.

Re-checking all three preconditions *inside* the transaction is the point: the route also
validates them up front for good error messages, but only the in-transaction check is
authoritative. Two friends redeeming the same code in the same second must produce exactly one
account. SQLite serializes write transactions, so this holds; the `user.email` unique index is
the independent backstop for the email race, and step 5's `AND redeemed_by IS NULL` is the
backstop for the code race. The `maxUsers` count is the weakest of the three (a deferred
transaction could in principle read a stale count under concurrent multi-process writes) —
worst case is overshooting the cap by one, which is not a security property. Stated, not hidden.

### 4.5 Migration sequencing (the highest-risk item in this plan)

**Target: one migration file, `0003_*.sql`, hand-authored, applied in this order.**

**Why hand-authored, when Plan 04 §4.3 says "never hand-edit the SQL."** Two reasons that do
not apply to Plan 04's pure `CREATE TABLE` migration:

1. **drizzle-kit generates DDL, never DML.** The backfill (`UPDATE agent SET owner_id = …`)
   cannot be generated. There is no version of this migration that is fully machine-written.
2. **drizzle-kit cannot correctly add a `NOT NULL` column to a populated SQLite table.**
   SQLite rejects `ALTER TABLE … ADD COLUMN … NOT NULL` without a default outright, and
   drizzle-kit's fallback table-recreate would emit an `INSERT INTO __new_agent … SELECT …,
   owner_id FROM agent` against a table that does not yet have `owner_id` — a "no such column"
   failure. The nullable→backfill→enforce sequence has to be authored by hand.

The generated **snapshot and journal are still machine-written and never touched**: run
`npx drizzle-kit generate` against the finished `schema.ts` to produce `0003_*.sql` +
`meta/0003_snapshot.json` + the journal entry, then **replace only the body of the `.sql`
file**. The snapshot describes the end state, and the hand-authored SQL reaches the same end
state, so the next `drizzle-kit generate` must report no changes — that is gate 0's check.

```
Step 0 — MANDATORY, before anything runs against the real DB:
         stop the dev server (standing rule 3), then
         cp myagent.db myagent.db.bak-2026-07-DD
         This migration contains DROP TABLE. Without the backup, a mistake is unrecoverable.
```

```sql
-- 1 ── new tables (no dependencies, no data)
CREATE TABLE `user` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `password_hash` text NOT NULL,
  `role` text DEFAULT 'user' NOT NULL,
  `share_logs_with_admin` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
--> statement-breakpoint
CREATE TABLE `invite_code` (
  `code` text PRIMARY KEY NOT NULL,
  `note` text,
  `created_by` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `redeemed_by` text,
  `redeemed_at` integer
);
--> statement-breakpoint
CREATE INDEX `invite_code_redeemed_idx` ON `invite_code` (`redeemed_by`);
--> statement-breakpoint

-- 2 ── additive NULLABLE columns (always legal on a populated SQLite table)
ALTER TABLE `agent` ADD `owner_id` text;
--> statement-breakpoint
ALTER TABLE `group` ADD `owner_id` text;
--> statement-breakpoint
ALTER TABLE `llm_call_log` ADD `user_id` text;
--> statement-breakpoint
-- NOT NULL *with* a default IS legal on a populated table — it is NOT NULL *without*
-- one that SQLite rejects. Existing rows get 0, and are exempted from redaction by the
-- user_id IS NULL rule, not by this flag (§4.3).
ALTER TABLE `llm_call_log` ADD `shared_with_admin` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `llm_call_log_user_created_idx` ON `llm_call_log` (`user_id`,`created_at`);
--> statement-breakpoint

-- 3 ── bootstrap owner, created ONLY if there is legacy data needing an owner.
--      password_hash '' is the "no password set" sentinel (§3.7); SQL cannot hash.
--      share_logs_with_admin is written explicitly (0) rather than left to the default:
--      it is moot for the admin — who always sees their own rows — and an explicit 0
--      keeps "consent is never implied" true even in hand-authored SQL.
INSERT INTO `user` (`id`,`email`,`password_hash`,`role`,`share_logs_with_admin`,`created_at`)
SELECT '00000000-0000-4000-8000-00000000b007','bootstrap@localhost','','admin',0,unixepoch()
WHERE (SELECT COUNT(*) FROM `agent`) + (SELECT COUNT(*) FROM `group`) > 0;
--> statement-breakpoint

-- 4 ── backfill
UPDATE `agent` SET `owner_id` = '00000000-0000-4000-8000-00000000b007' WHERE `owner_id` IS NULL;
--> statement-breakpoint
UPDATE `group` SET `owner_id` = '00000000-0000-4000-8000-00000000b007' WHERE `owner_id` IS NULL;
--> statement-breakpoint

-- 5 ── rebuild to enforce NOT NULL + the composite unique index.
--      Columns are listed EXPLICITLY on both sides — never `INSERT … SELECT *`.
--      DROP TABLE also drops `agent_name_unique`, so no explicit DROP INDEX is needed.
CREATE TABLE `__new_agent` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `source` text NOT NULL,
  `platform` text DEFAULT 'claude' NOT NULL,
  `split_level` integer DEFAULT 1 NOT NULL,
  `raw_source_snapshot` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_agent`
  (`id`,`owner_id`,`name`,`description`,`source`,`platform`,`split_level`,`raw_source_snapshot`,`created_at`,`updated_at`)
SELECT
   `id`,`owner_id`,`name`,`description`,`source`,`platform`,`split_level`,`raw_source_snapshot`,`created_at`,`updated_at`
FROM `agent`;
--> statement-breakpoint
DROP TABLE `agent`;
--> statement-breakpoint
ALTER TABLE `__new_agent` RENAME TO `agent`;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_owner_name_unique` ON `agent` (`owner_id`,`name`);
--> statement-breakpoint
CREATE INDEX `agent_owner_idx` ON `agent` (`owner_id`);
--> statement-breakpoint
-- …identical five-statement sequence for `group`
--   (`id`,`owner_id`,`name`,`parent_id`,`created_at`) →
--   `group_owner_name_unique` (owner_id,name) + `group_owner_idx` (owner_id)
```

**Notes that a future implementer will otherwise re-derive the hard way:**

- **No `PRAGMA foreign_keys=OFF/ON` wrapper.** drizzle-kit emits those around its own
  recreates, but (a) this schema declares **zero** `references()` FKs — every cross-table link
  is a soft reference by design (`schema.ts` header) — so nothing can cascade, and (b) the
  migrator runs inside a transaction, where SQLite ignores that pragma anyway. Including them
  would be cargo-cult and could give false confidence.
- **Column order changes** (`owner_id` is placed second). Harmless — every query in the
  codebase is Drizzle-generated with named columns; there is no `SELECT *` positional read.
- **`agent_config` / `agent_section` etc. are untouched** by the rebuild. Their `agent_id`
  values still point at the same `agent.id` strings after the rename, because ids are copied
  verbatim and there are no FKs to re-point.
- **`llm_call_log` needs no rebuild** — two `ADD COLUMN`s (one nullable, one `NOT NULL` *with*
  a default) and one `CREATE INDEX`. All three are legal against a populated table.
- **Verification, all three required at gate 0:**
  1. `npm test` — `lib/db/__tests__/test-db.ts` runs every migration from scratch on a fresh
     in-memory DB at module load, so malformed SQL fails **every** suite loudly and immediately.
     This is the same tripwire Plan 04 §4.3 relied on.
  2. `npx drizzle-kit generate` a second time → must report no schema changes (proves the
     hand-authored SQL and the machine-written snapshot agree about the end state).
  3. Against a **copy** of the real `myagent.db`: row counts for `agent`/`group` identical
     before and after; `SELECT COUNT(*) FROM agent WHERE owner_id IS NULL` = 0; `.schema agent`
     shows `owner_id text NOT NULL` and `agent_owner_name_unique`.

### 4.6 Existing data

The only real database is the local dev `myagent.db`. After migration every existing agent and
group belongs to the bootstrap admin, whose password is unset until
`npm run auth:bootstrap` runs. Between those two steps the app is **unusable by anyone** —
nobody can log in, and every page redirects to `/login`. That is the correct fail-closed
state, and it is why the bootstrap CLI is part of the same phase (§11 Phase 5), not a later
chore.

---

## 5. Resolutions of the open unknowns

### 5.1 Bootstrap credentials → **an idempotent CLI, `npm run auth:bootstrap`**

`scripts/bootstrap-user.ts`:

- Reads `BOOTSTRAP_USER_EMAIL` and `BOOTSTRAP_USER_PASSWORD` from the environment.
- Validates the password against the §3.7 policy; hashes with `bcryptjs` (cost 10).
- If the `BOOTSTRAP_USER_ID` row exists → `UPDATE` its email and hash, **but only when the
  stored hash is still the `''` sentinel**, unless `--force` is passed. Otherwise it exits 1
  with `bootstrap user already has a password; pass --force to overwrite`.
- If no row exists (a genuinely fresh DB with no legacy data — the migration's step 3 is
  conditional) → `INSERT` it with `role: 'admin'`.
- Prints the resulting email and role. **Never** prints the password or the hash.

| Option | Verdict |
|---|---|
| Env vars read by `lib/db/seed.ts` (which already runs on `predev`/`prebuild`) | **Rejected.** `seed.ts` runs on *every* `npm run dev`. The password would have to live permanently in `.env.local`, and any edit to it would silently reset the admin's password on the next dev start — precisely the class of bug Rules Index #47 exists to prevent for `setting`. |
| Interactive CLI prompt | **Rejected as the primary mechanism.** It cannot run unattended on a host's build/release step, which is exactly where this needs to work for the "going online" goal. |
| One-time HTTP setup endpoint (`POST /api/setup`, disables itself after first use) | **Rejected.** It is a publicly reachable, unauthenticated account-creation endpoint whose safety depends entirely on a self-disable flag being correct. If the flag is ever wrong — a restored backup, a fresh DB on a redeploy, an ordering bug — anyone who finds the URL becomes the admin. Not worth it to avoid one CLI command. |
| **Dedicated idempotent CLI reading env vars** | **Chosen.** Works headless; runs exactly when invoked; refuses to clobber an existing password by default; the plaintext only needs to exist for the duration of one shell command (`BOOTSTRAP_USER_PASSWORD='…' npm run auth:bootstrap`); adds zero public attack surface. |

**Confirmed at review (§16.1), with the reasoning made explicit:** the bootstrap command stays
**structurally separate from `seed.ts`**, not merely invoked separately. `seed.ts` holds
catalog definitions (`config_def`, `section_def`, and now the `maxUsers` /
`maxLlmCallsPerUserPerHour` setting rows) that are safe to re-run on every `npm run dev`
because every write is `onConflictDoNothing`. The bootstrap command touches a **real
password**. Those two things have opposite safety properties — one is idempotent by
construction and runs constantly, the other is deliberate and should run on special occasions
only — and putting them in the same file is what would eventually cause someone to make the
password path run on `predev` too. They stay in different files for that reason, not for
tidiness.

### 5.2 Admin distinction → **a `role` column on `user`**

| Option | Verdict |
|---|---|
| `ADMIN_EMAIL` env var, compared per request | **Rejected.** The user row must be loaded anyway, so it saves nothing; it breaks the moment the admin changes their email; and it puts an authorization fact in a place no query can join against (e.g. "list all admins"). |
| `isAdmin` boolean | **Rejected.** A boolean is a role enum that cannot grow. A third role (a read-only auditor, a per-user log view) would need a migration. |
| **`role text not null default 'user'`, values `'admin' \| 'user'`** | **Chosen.** One source of truth, in the same row as identity, read on the same query. Drizzle's `enum` is TS-only for SQLite text, so adding a value later is a code change with no migration (Plan 04 §4.2's precedent). |

Rules: the bootstrap user is `'admin'`. **Signup always writes `'user'`, unconditionally,
with no code path that accepts a role from a request body** (§8 invariant 6).

**Confirmed at review (§16.2):** both halves — the column *and* the deliberate absence of a
promotion endpoint or UI. Promoting a second admin is
`UPDATE user SET role='admin' WHERE email=?`, run by hand, documented in §8 policy 23. An
endpoint that grants administrative privilege is the highest-value target in an app this size,
and it would exist to serve an action expected to happen approximately zero times.

#### Terminology (decided at review)

The two role values are **`'admin'` and `'user'`**, renamed from the originally-drafted
`'operator'` / `'member'`. **The column keeps its name, `role`** — this was explicit: rename
the values, not the field. Consequences applied throughout this document:

| Was | Is |
|---|---|
| `role: 'operator' \| 'member'` | `role: 'admin' \| 'user'` |
| `authenticateOperator()` | `authenticateAdmin()` |
| "operator-only" (prose, tables, `§7.1` auth column) | "admin-only" |
| "a member" (a non-privileged account) | "a user" |
| `OPERATOR_EMAIL` (the rejected option in the table above) | `ADMIN_EMAIL` |

Deliberately **not** renamed: `BOOTSTRAP_USER_ID`, `BOOTSTRAP_USER_EMAIL`,
`BOOTSTRAP_USER_PASSWORD` — those name the bootstrap *account*, not the role.

One cross-document note for `@dev`: `architecture/TechDesign.md` and Plan 04 use "operator" in
prose to mean *the person running this deployment*. That is the same person as this plan's
`admin` role; no rewrite of those documents is required beyond Phase 6.1's Rules Index work,
and Plan 04's Rules Index #47 ("operator-owned seed rows") should be read as "admin-owned".

### 5.3 `ImportedAgentData.ownerId` seam → **neither; `ownerId` becomes a separate parameter**

`upsertAgentFromImport(ownerId: string, data: ImportedAgentData)`.

`@impact` framed this as a binary: either the assemblers (`lib/import/assemble.ts`,
`assembleStructural.ts`) emit `ownerId`, or the route patches it onto their output afterwards.
Both are worse than the third option, and for the same reason Plan 04 §2.1 split `LlmRequest`
from `LlmCallContext`:

- `ImportedAgentData` describes **what was in the file**. Every field on it —
  `name`, `description`, `platform`, `splitLevel`, `rawSourceSnapshot`, `config`, `sections` —
  was parsed out of the markdown. `ownerId` was not; it is **request context**.
- Putting it on the type would force both assemblers (pure, deterministic, fully unit-tested
  functions with no notion of a request) to take a parameter they do nothing with but copy.
- Patching it on afterwards (`{ ...importData, ownerId }`) makes the assembler's return type a
  lie: it claims to produce a complete `ImportedAgentData` that is in fact incomplete.

A separate parameter keeps the assemblers and their tests **completely untouched by this plan**
— worth noting, since they are the most heavily fixture-tested code in the repo.

**Confirmed at review (§16.3):** `ownerId` is a separate parameter, sourced from the
authenticated session **at the route layer** and passed down; it is never a field on
`ImportedAgentData`. `lib/import/assemble.ts` and `lib/import/assembleStructural.ts` are
**not edited by this plan at all** — if a diff to either appears during the build, that is the
signal §10.6 describes, not a task.

### 5.4 Client-side `401` handling → **one shared `apiFetch()` wrapper**

`lib/apiFetch.ts` (client-safe, no `server-only`):

```
export async function apiFetch(input, init?): Promise<Response>
  const res = await fetch(input, init);
  if (res.status === 401 && typeof window !== 'undefined') {
    const next = window.location.pathname + window.location.search;
    window.location.href = '/login?next=' + encodeURIComponent(next);
    // then hang: never resolve, so no caller renders an error flash mid-navigation
    await new Promise(() => {});
  }
  return res;
```

| Option | Verdict |
|---|---|
| Monkey-patch global `fetch` | **Rejected.** Invisible action-at-a-distance; also affects any third-party or Next-internal fetch; breaks test isolation. |
| Per-component `if (res.status === 401)` in all 14 call sites | **Rejected.** Nine files, fourteen sites — the drift is guaranteed, and the one site that gets missed shows a confusing generic error at exactly the worst moment. |
| React error boundary | **Rejected.** A `401` is a plain response, not a thrown render error; each component would still have to detect and throw it first. |
| **One explicit `apiFetch()` used by all 14 sites** | **Chosen.** ~15 lines, zero magic, greppable, and a fitness test (§10.4) can assert that no `'use client'` file calls bare `fetch('/api/…')` again. |

`@impact` said six client components; the actual count, verified 2026-07-29, is **nine files
and fourteen call sites**: `ChatPanel`, `AgentView` (×2), `SectionBlock`, `AgentListItem` (×2),
`CreateAgentButton`, `GroupSection`, `ImportDialog`, `LibraryPanel` (×2), `RawAgentView`,
`SettingsView` (×2).

The hard navigation discards unsaved client state (a half-typed chat instruction).
**Confirmed at review (§16.4)** as the behavior for this plan: it only happens when the
session is already dead, and the alternative — an in-place re-login modal that preserves what
the user was typing — is a materially larger feature. That alternative was explicitly wanted
as a **future** item and is now recorded in §14 ("In-place re-login modal preserving unsaved
client state") rather than left as a discarded option. `apiFetch()` is where it will be
implemented when the time comes, which is one more reason all fourteen call sites go through
it now.

### 5.5 Three corrections to the impact report

Re-verified against the current code on 2026-07-29. These matter because each one changes what
the build actually has to do:

1. **"All 6 existing test suites will fail to even set up."** — **Not accurate, and the real
   failure mode is different (and better).** There are **19** test files / 186 tests, not 6.
   Their `beforeAll` blocks seed only `config_def` / `section_def` (verified in `repo.test.ts`
   lines 49–72 and `agents.test.ts` lines 42–73) — no `agent` or `group` rows — so migration
   alone does not break setup. What breaks is every **call site**: `createAgent(name, desc)`
   becomes a TypeScript arity error and, if forced past that, a runtime `NOT NULL` violation.
   That is a *compile-time* break, which is far easier to chase exhaustively than a runtime
   one. The remedy is the same (fix it in the same change as the schema — §11 Phase 0.8), but
   `tsc --noEmit` is the tool that enumerates the work, not the test runner.
2. **"`app/api/settings/route.ts` currently has zero access control."** — Confirmed accurate,
   and this plan fixes it. Also confirmed: **`GET /api/llm-call-log/[id]` returns full system
   prompts and full agent bodies** for *any* agent, which is the single most sensitive endpoint
   in the codebase. Plan 04 §13 explicitly recorded the obligation to gate it "on day one of
   Plan B" — discharged here (§7.1).
3. **The confirmed section-route bug is real and is slightly worse than described.**
   `app/api/agents/[id]/sections/[sectionId]/route.ts` line 29 destructures **only**
   `sectionId`; the `[id]` segment is never read. So even after ownership is added, a naive
   fix that only checks "does this section's parent agent belong to me" would still let
   `/api/agents/<any-agent-of-mine>/sections/<any-section-of-mine>` succeed with a mismatched
   pair. §6.4 closes both halves.

### 5.6 Activity-log visibility → **opt-in consent, snapshotted per row** *(new at review)*

This is the one §16 point that was not a yes/no confirmation: the answer chosen — the user
decides, up front, and can change their mind — is a different design from either option the
plan originally offered ("admin sees everything" vs. "users see only their own rows"). It is
specified here in full.

**The position.** The admin pays for one shared API key and needs the activity log to audit
it. That justifies seeing *what was spent*. It does not, by itself, justify reading what
someone typed. So the two are separated: **metadata is always visible to the admin; content is
visible only with that user's active consent.**

#### The consent choice, at signup

Presented on the signup form in the **UX treatment of a cookie banner** — a bordered,
visually distinct block with its own heading and two explicit actions, not a checkbox tucked
under the password field. It is **opt-in**: the account is created private unless the person
actively agrees.

| Requirement | Detail |
|---|---|
| Placement | Its own block on `/signup`, above the submit button, visually separated from the credential fields |
| Wording | States plainly *who* sees it (the admin — one named person, the one who runs this deployment), *what* they'd see (the text of your instructions and the AI's replies), and *why it exists* (one shared API key, paid for by them, that has to be auditable) |
| Actions | Two explicit choices. No pre-ticked control, and no way to submit the form having answered neither |
| Default if absent | `false` (private). The route coerces: anything that is not literally the boolean `true` is `false` (§8 invariant 15). A malformed body cannot produce consent |
| Changeable later | Yes — `/account` (§5.7). Stated in the signup block itself, so the choice does not feel permanent |

#### The snapshot rule

`llm_call_log.sharedWithAdmin` is written **by the gateway, at the moment the row is written**,
from `getUserPolicy(userId).shareLogsWithAdmin`. It is never updated afterwards. Changing the
preference at `/account` changes what *future* rows say and nothing else.

Why not read the user's current preference at display time, which needs no column at all?

| | Live join on `user.shareLogsWithAdmin` | **Snapshot on the row (chosen)** |
|---|---|---|
| Existing guarantee | Breaks nothing structurally, but makes the log's meaning mutable — a row means something different tomorrow | Preserves Rules Index #45/#46 exactly: a written row never changes, and neither does its meaning |
| "I shared this while I was doing it" | Retroactively hides work the user *did* consent to share when they did it — the admin's audit trail of a past incident can vanish | The record of what was consented to at the time survives |
| "I turned sharing on today" | Retroactively exposes months of prompts the user never agreed to share | Past private calls stay private, which is the direction that actually matters |
| Deleted user | The join finds nothing; behavior undefined without an extra rule | The row still carries its own answer |
| Cost | One join per read | One boolean per row |

The second and third rows are the decisive pair: a live join gets **both** directions wrong,
and gets the privacy-relevant one wrong in the more damaging direction. This extends
constraint 9 rather than bending it, and is stated as constraint 11.

#### What the admin actually sees

The redaction rule, applied in `lib/db/repository/llmCallLog.ts` (repository layer, for the
same reason ownership is there — §6.1):

```
redacted = row.userId !== null
        && row.userId !== viewerUserId
        && row.sharedWithAdmin === false
```

| Field | Redacted row | Shared row |
|---|---|---|
| `id`, `kind`, `provider`, `model`, `createdAt`, `durationMs`, `dryRun` | visible | visible |
| `agentId`, `agentLabel` (which agent) | visible | visible |
| `usage` (input/output tokens → cost) | visible | visible |
| `error` (`'<ErrorName>: <message>'`) | visible — it is a provider status string, not user content | visible |
| `userId` / the user's email (who) | visible | visible |
| **`requestPayload`** (system prompt + messages) | **`null`** | full |
| **`responsePayload`** (the model's text) | **`null`** | full |
| `redacted: boolean` (new DTO field) | `true` | `false` |

- **`listCallLogs()` is unaffected in substance** — it already selects only metadata columns,
  so the list view needs nothing removed. It gains the `redacted` flag so the UI can mark the
  row (a small lock/"content hidden" affordance) rather than the admin discovering it only on
  click.
- **`getCallLog(id, viewerUserId)` gains the viewer parameter** and does the nulling. Note the
  shape: the viewer is a *required* parameter with no default, exactly like `ownerId` in §6.2
  and for the same reason — a future caller cannot forget it and get the unredacted row.
- **Two rows are never redacted:** the viewer's own (`userId === viewerUserId`) and pre-auth
  rows (`userId === null`, §4.3).
- The admin sees a redacted row's *existence, cost, and agent* — everything needed to answer
  "who is spending what" — and no prompt text. That is the whole point of the split.

#### Disclosure obligation (unchanged in force, changed in content)

Phase 6.3's documentation deliverable stands and is now **larger**: `docs/user-guide.md` must
describe the opt-in consent, what each choice means, that the choice is not retroactive in
either direction, and where to change it. The original obligation was to disclose blanket
admin visibility; the obligation is now to disclose a consent model, which is a better stance
and a longer paragraph. **Beta users must be told this in words, not just offered a toggle.**

### 5.7 System Settings vs. User Settings *(new at review)*

`/settings` today mixes two audiences that this plan makes distinct: things that configure
**the deployment** (live-LLM toggle, activity log, invite codes, `maxUsers`, and now
`maxLlmCallsPerUserPerHour`) and things that belong to **a person**. Once there is more than
one person, one page cannot be both.

| Surface | Route | Access | Contents |
|---|---|---|---|
| **System Settings** | `/settings` *(unchanged route)* | **admin only** — non-admin session → `redirect('/')` | Exactly what Plan 04 built plus this plan's additions: `liveLlmCalls`, the activity log, invite-code generate/list/revoke, `maxUsers`, `maxLlmCallsPerUserPerHour`. No content change from what was already planned; only the **label** changes, to disambiguate it from the new page |
| **User Settings** | **`/account`** | **any authenticated session**, including the admin's | For this plan: the log-sharing consent toggle (§5.6) and a read-only display of the signed-in email and role. Built as a real page so it can grow (§14's change-email / change-password / delete-account items are what it grows into) |

**Route naming — why `/account` and not `/settings/me`:**

| Option | Verdict |
|---|---|
| `/settings/me` | **Rejected.** It nests a page every user may reach *underneath* a path that is admin-only. The first time someone adds an `app/settings/layout.tsx` with an admin check — the natural way to gate a section — every user is silently locked out of their own privacy control, and nothing about the file tree makes that mistake visible. Access boundaries should be visible in the URL tree, not crossed by it. |
| `/settings/account` | **Rejected**, same reason. |
| `/profile` | Reasonable, but "profile" suggests a public-facing identity (avatar, display name) that does not exist here. |
| **`/account`** | **Chosen.** Top-level and flat, matching this app's existing routing shape (`/`, `/agents/[id]`, `/settings` — no nesting anywhere except the one dynamic segment). Its guard is independent of `/settings`'s. "Account" is the conventional label for *the settings that are mine*, which is precisely this page's scope. |

**Topbar (`app/components/shell/Topbar.tsx`).** It already gains a `session` prop in this plan
(Phase 4.4). It now shows, right to left: the theme toggle, `⚙ System Settings` **(admin
only)**, `Account` **(always)**, the signed-in email, and Logout. Both settings entry points
are labelled so that neither reads as "the settings page" — the ambiguity this split exists to
remove would come straight back if one of them were labelled plain "Settings".

`/account` renders `<Topbar />` itself, following the pattern `/settings` established (Plan 04
§5.4): it is a standalone top-level page, not a workbench pane, so `WorkbenchShell` and
`app/layout.tsx` stay untouched.

---

## 6. The ownership model

### 6.1 Where the check lives, and why not at the route

`@analyst`'s task description says the route layer should verify ownership before calling the
by-id repository functions. **This plan deliberately does the opposite** (recorded as
deviation §15.1). `@impact` reached the same conclusion from the other direction when it
warned that "implementing it six different ways across six files would produce drift."

| | Route-layer check | **Repository-layer scoping (chosen)** |
|---|---|---|
| A new route added next year | Must remember the two-step dance | Cannot compile without an `ownerId` |
| Number of implementations | 13+, one per handler | 1 per function, next to the query |
| Where it's proven by tests | Route tests (need a mocked session) | Repository tests (no HTTP, no mocking) |
| TOCTOU window between "check" and "use" | Theoretically real; **in this app, near-zero** — see below | **None** — the check *is* the query |
| Cost | 13 route diffs | 14 signature changes + 13 route diffs |

**Confirmed at review (§16.6): the repository layer, as originally written.** This was
reconsidered against the route-layer approach the `@analyst` task description specified, and
reaffirmed. The reasoning is worth stating precisely rather than overstated, because a
generic version of the TOCTOU argument does not fully apply here:

- **The TOCTOU argument is weaker in this app than it sounds.** `better-sqlite3` is
  synchronous and this is a single Node process. Between a route-layer
  `if (agent.ownerId !== me) return 404` and the `deleteAgent(id)` that follows, there is no
  `await` — so no other request can interleave, and the window a generic statement of this
  argument would describe does not actually open. Claiming otherwise would be arguing for the
  right design with the wrong evidence, and the next person to read it would find the hole.
- **The decisive benefit is structural, not temporal.** A future route handler *cannot call a
  by-id function without supplying `ownerId`* — there is no such overload. A forgotten
  ownership check is impossible **by construction**, not caught by code review, and not
  dependent on a test suite remembering to cover a route that did not exist when the suite was
  written. That property survives changes to the runtime, the driver, and the process model;
  the TOCTOU one is contingent on all three.
- The secondary benefits are unchanged and still real: one implementation instead of 13+, and
  provable in repository tests with no HTTP or session mocking.

`deleteAgent(id, ownerId)` with `WHERE id = ? AND owner_id = ?` is a single atomic statement
that cannot be wrong — and, more importantly, is a signature that cannot be called wrongly.

Routes still change — they must obtain the session and pass `ownerId` — but they are reduced
to *mapping*: `null`/`false` from the repository becomes `404`.

### 6.2 Repository signature changes (exhaustive)

**Convention (locked): `ownerId` always precedes the payload and follows the identifier(s).
It is never last, never optional, never defaulted.**

`lib/db/repository/agents.ts`:

| Function | Before | After | On owner mismatch |
|---|---|---|---|
| `listAgents` | `()` | `(ownerId)` | — (filters) |
| `createAgent` | `(name, description)` | `(ownerId, name, description)` | — |
| `getAgentFull` | `(agentId)` | `(agentId, ownerId)` | `null` |
| `getAgentSnapshotInfo` | `(name)` | `(name, ownerId)` | `null` |
| `updateAgent` | `(agentId, updates)` | `(agentId, ownerId, updates)` | `null` |
| `deleteAgent` | `(agentId): void` | `(agentId, ownerId): boolean` | `false` |
| `exportAgentMarkdown` | `(agentId)` | `(agentId, ownerId)` | `null` |
| `updateSectionContent` | `(sectionId, content, author, expectedVersion)` | `(agentId, sectionId, ownerId, content, author, expectedVersion)` | throws `SectionNotFoundError` |
| `upsertAgentFromImport` | `(data)` | `(ownerId, data)` | — (§6.3) |

`deleteAgent` changing from `void` to `boolean` lets the route drop its current
"`getAgentFull` first, then delete" two-query pattern (`[id]/route.ts` lines 86–92) in favour
of one atomic call.

`lib/db/repository/groups.ts`:

| Function | Before | After | On owner mismatch |
|---|---|---|---|
| `listGroups` | `()` | `(ownerId)` | — (filters) |
| `createGroup` | `(name)` | `(ownerId, name)` | — |
| `deleteGroup` | `(groupId): boolean` | `(groupId, ownerId): boolean` | `false` |
| `addMembership` | `(agentId, groupId)` | `(agentId, groupId, ownerId)` | `null` |
| `removeMembership` | `(agentId, groupId)` | `(agentId, groupId, ownerId)` | `false` |

`lib/db/repository/llmCallLog.ts`: `WriteCallLogInput` gains `userId?: string | null` and
`sharedWithAdmin: boolean`;
`CallLogListItem` and `CallLogFull` gain `userId: string | null` and `redacted: boolean`;
`ListCallLogsOptions` gains an optional `userId` filter (unused by the admin view today —
present so a per-user view is a filter argument, not a rewrite). Two further changes from the
review:

| Function | Before | After | Note |
|---|---|---|---|
| `getCallLog` | `(id)` | `(id, viewerUserId)` | Applies the §5.6 redaction rule. `viewerUserId` is required and non-defaulted, for the same reason `ownerId` is (§6.1) |
| `countLlmCallsInWindow` | — | `(userId, sinceEpochSeconds) → { count, oldestAt }` | **New.** One statement: `COUNT(*)` + `MIN(created_at)` over `user_id = ? AND dry_run = 0 AND created_at >= ?`. Backs the §3.9 cap; served by `llm_call_log_user_created_idx` |

`lib/db/repository/users.ts` (new): `getUserById`, `getUserByEmail`, `getUserCount`,
`setUserPassword`, `createUserWithInvite` (§4.4), `createInviteCode`, `listInviteCodes`,
`revokeInviteCode`, plus two added at review:

| Function | Signature | Note |
|---|---|---|
| `getUserPolicy` | `(userId) → { role, shareLogsWithAdmin } \| null` | The gateway's read (§3.9 step 4, §5.6). Deliberately **narrow**: it returns two fields and never `passwordHash`, so the LLM path never holds a credential hash in memory at all (constraint 7's spirit, made structural). One indexed PK lookup |
| `setUserLogSharing` | `(userId, shareLogsWithAdmin: boolean) → boolean` | Backs `PATCH /api/account`. Takes the caller's own id only; there is no admin-facing variant that sets someone else's consent |

`lib/db/repository/catalog.ts`: **unchanged.** Global catalog (constraint 8).

### 6.3 Two owner-scoping changes that are security fixes, not mechanics

1. **`upsertAgentFromImport`'s existing-agent lookup** (`agents.ts` line 398:
   `WHERE agent.name = data.name`). Without an owner clause, **user B importing a file whose
   frontmatter says `name: dev` would silently overwrite user A's `dev` agent**, including
   writing pre/post-import snapshots into A's history. This is the single most severe
   cross-tenant hole the retrofit must close. It becomes
   `WHERE name = ? AND owner_id = ?`. Same for `getAgentSnapshotInfo` (line 262), which feeds
   the unchanged-bytes short-circuit — otherwise B's import could be short-circuited by A's
   identical file and return **A's `AgentDTO`**.
2. **`updateAgent`'s name-collision check** (line 642). Owner-scoped, or a user gets a
   `409 name_exists` for a name that is free *for them* and merely taken by a stranger — both
   a bug and an existence oracle over other users' agent names.

And one cross-entity invariant that has no pre-auth equivalent:

3. **`addMembership` must require that the agent and the group have the same owner** — and
   that it equals the caller's. `@impact` flagged the hole; it belongs in the repository
   because it is a statement about two rows, which no single route-level check owns naturally.

### 6.4 The section route, fixed completely

`updateSectionContent(agentId, sectionId, ownerId, …)` resolves the section, then requires
**all three** to agree:

```
section.id      === sectionId
section.agentId === agentId          ← the currently-ignored URL segment (§5.5 #3)
agent.ownerId   === ownerId
```

Any mismatch throws `SectionNotFoundError` → `404`. One indistinguishable outcome for "no such
section", "wrong agent in the URL", and "someone else's section" — no oracle.

`VersionConflictError` handling is unchanged, and the ownership check runs **before** the
version check, so a stranger's request can never learn a section's version number.

### 6.5 The gateway

`LlmCallContext` gains two fields, both set from the request by the three routes that build it
(`/api/chat`, and both pipelines in `/api/agents/import`):

```ts
export type LlmCallContext = {
  kind: LlmCallKind;
  agentId?: string | null;
  agentLabel?: string | null;
  userId?: string | null;      // from the session — never from the body
  forceDryRun?: boolean;       // from the body — may only DOWNGRADE a live call (§3.9)
};
```

The gateway uses `userId` for three things: writing it onto the log row, resolving
`getUserPolicy()` for the consent snapshot (§5.6), and the cap count (§3.9). `null` means
"outside any request" — pre-auth rows, `scripts/test-structural-import.ts`, and the existing
gateway tests — and disables both the cap and the snapshot (`sharedWithAdmin: false`, which
§4.3's redaction rule then ignores because `userId` is null).

The three callers still pass `ctx` straight through and are **otherwise untouched** — no
signature change, no prompt change, no change to their `try`/`catch` blocks. Their only edit
is the single post-call `if (!res.ok)` line becoming a two-way branch on `res.reason` (§3.9).
`scripts/test-structural-import.ts` gets `userId: null` — it runs outside any request.

---

## 7. API surface

### 7.1 Endpoints

**New:**

| Method | Path | Auth | Request | Response | Errors | Side effects |
|---|---|---|---|---|---|---|
| `POST` | `/api/auth/login` | public | `{ email, password }` | `200 { user: { id, email, role } }` + `Set-Cookie` | `400 invalid_body`; `401 invalid_credentials`; `429 rate_limited` | none |
| `POST` | `/api/auth/signup` | public | `{ inviteCode, email, password, shareLogsWithAdmin: boolean }` | `201 { user }` + `Set-Cookie` | `400 invalid_body \| invalid_email \| weak_password \| password_too_long \| invalid_invite_code`; `409 email_exists`; `403 signups_closed`; `429 rate_limited` | Creates a `user` with the consent choice (§5.6); marks the code redeemed |
| `POST` | `/api/auth/logout` | any session (also succeeds with none) | – | `204` + cookie cleared | – | none |
| `GET` | `/api/account` | **any session** | – | `200 { email, role, shareLogsWithAdmin }` | `401` | none |
| `PATCH` | `/api/account` | **any session** | `{ shareLogsWithAdmin: boolean }` | `200 { shareLogsWithAdmin }` | `400 invalid_body`; `401` | Updates **only `session.userId`'s** row (§8 invariant 17). No id is read from the body or the URL |
| `GET` | `/api/settings/invite-codes` | **admin** | – | `200 { codes: [{ code, note, createdAt, redeemedByEmail \| null, redeemedAt }] }` | `401`, `403` | none |
| `POST` | `/api/settings/invite-codes` | **admin** | `{ note?: string }` | `201 { code, note, createdAt }` | `400 invalid_body`; `401`; `403`; `500 code_generation_failed` | Inserts one `invite_code` |
| `DELETE` | `/api/settings/invite-codes/[code]` | **admin** | – | `204` | `401`; `403`; `404 not_found`; `409 already_redeemed` | Deletes one unredeemed row |

**Modified — every existing route gains authentication; nothing else about their contracts
changes:**

| Path | Handlers | New auth | New error outcomes |
|---|---|---|---|
| `/api/agents` | GET, POST | `authenticate()` | `401` |
| `/api/agents/[id]` | GET, PATCH, DELETE | `authenticate()` | `401`; `404` now also means "not yours" |
| `/api/agents/[id]/sections/[sectionId]` | PATCH | `authenticate()` | `401`; `404` also for a mismatched `[id]` (§6.4) |
| `/api/agents/[id]/export` | GET | `authenticate()` | `401`; `404` also means "not yours" |
| `/api/agents/[id]/groups` | POST | `authenticate()` | `401`; `404` if either side isn't yours |
| `/api/agents/[id]/groups/[groupId]` | DELETE | `authenticate()` | same |
| `/api/agents/import` | POST | `authenticate()` | `401`; **`429 llm_cap_reached`** (§3.9). Body accepts an optional `dryRun: true` |
| `/api/groups` | GET, POST | `authenticate()` | `401`; `409 name_exists` is now **per-owner** |
| `/api/groups/[id]` | DELETE | `authenticate()` | `401`; `404` also means "not yours" |
| `/api/chat` | POST | `authenticate()` | `401`; `404` also means "not yours"; **`429 llm_cap_reached`** (§3.9). Body accepts an optional `dryRun: true` |
| `/api/settings` | GET, PATCH | **`authenticateAdmin()`** | `401`, `403` |
| `/api/llm-call-log` | GET | **`authenticateAdmin()`** | `401`, `403`. List rows gain `redacted: boolean` (§5.6) |
| `/api/llm-call-log/[id]` | GET | **`authenticateAdmin()`** | `401`, `403`. **Payloads are `null` and `redacted: true` for another user's non-consented row** (§5.6) |

**Backward compatibility.** Every success shape and every existing error code is unchanged.
The new outcomes on existing endpoints are `401`, `403` (three routes), a *wider meaning* for
the existing `404`, and `429 llm_cap_reached` on the two LLM endpoints. Two success shapes are
**additively** extended — the call-log DTOs gain `userId` and `redacted`, and existing fields
keep their names and types; a redacted `GET /api/llm-call-log/[id]` returns the same shape with
two fields set to `null`, not a different shape. The sole consumers are this app's own
components, all of which are updated in the same plan — no versioning is warranted.
**`GET /api/agents` returning only your own agents is not a compatibility break; it is the
entire feature.**

**The `429` is deliberately not a `403`.** A cap is a temporal condition, not a permission
one: the same request from the same user succeeds later, unchanged. `429` plus `Retry-After`
is the only status that says that, and it is what lets the client offer "wait" as a real
option rather than an apology.

### 7.2 Pages

| Path | Access |
|---|---|
| `/login`, `/signup` | Public. Middleware bounces an already-authenticated visitor to `/`. |
| `/`, `/agents/[id]` | Any session. `requirePageSession()` → redirect to `/login?next=…`. |
| `/settings` — **System Settings** | Admin only. Non-admin session → `redirect('/')`. Not a 404: the route's existence is not a secret, and a silent redirect is friendlier than a lie. |
| `/account` — **User Settings** *(new, §5.7)* | Any session, including the admin's. `requirePageSession()` → redirect to `/login?next=…`. Renders only the signed-in user's own row; there is no id in the URL to tamper with. |

### 7.3 Error handling

| Scenario | HTTP | Response shape | Logged? |
|---|---|---|---|
| No cookie / bad signature / expired, on `/api/*` | **401** | `{ error: 'unauthorized' }` | no — routine |
| Same, on a page | **307** | redirect `/login?next=…` | no |
| Valid session, non-admin, admin-only route | **403** | `{ error: 'forbidden' }` | **yes**, `[auth] forbidden <userId> <path>` — a user hitting an admin route is either a bug or probing |
| **Authenticated, resource belongs to someone else** | **404** | `{ error: 'not_found' }` | **yes**, `[auth] cross-owner access attempt <userId> <resource>` — indistinguishable to the client, fully visible to the admin |
| Resource genuinely absent | **404** | `{ error: 'not_found' }` | no |
| Bad login credentials | **401** | `{ error: 'invalid_credentials' }` | **yes**, `[auth] failed login <email>` — needed to notice a brute-force attempt |
| Login against the `''` sentinel hash | **401** | `{ error: 'invalid_credentials' }` (identical) | **yes**, `[auth] login attempted on user with no password set` |
| Unknown / already-redeemed / malformed invite code | **400** | `{ error: 'invalid_invite_code' }` — **one code for all three** | **yes** |
| Email already registered (signup) | **409** | `{ error: 'email_exists' }` | no |
| `maxUsers` reached | **403** | `{ error: 'signups_closed' }` | **yes** |
| Password < 12 chars | **400** | `{ error: 'weak_password', minLength: 12 }` | no |
| Password > 72 bytes | **400** | `{ error: 'password_too_long', maxBytes: 72 }` | no |
| Rate limit exceeded (login/signup, §3.8) | **429** | `{ error: 'rate_limited', retryAfterSeconds }` + `Retry-After` header | **yes** |
| **Per-user LLM cap reached (§3.9)** | **429** | `{ error: 'llm_cap_reached', limit, windowSeconds, retryAfterSeconds, canDryRun: true }` + `Retry-After` header | **yes**, `[llm-gateway] cap reached — user=<id> count=<n> limit=<n>`. **No `llm_call_log` row is written** (§3.9) |
| **Cap-reached request re-sent with `dryRun: true`** | **409** | `{ error: 'llm_dry_run', dryRun: true, kind, model, logId, message }` — the **existing** Plan 04 shape, unchanged | as today |
| `maxUsers` or `maxLlmCallsPerUserPerHour` set below its `min` via PATCH | **400** | `{ error: 'invalid_setting_value', key, datatype, min: 1 }` | no |
| `PATCH /api/account` with a non-boolean `shareLogsWithAdmin` | **400** | `{ error: 'invalid_body', field: 'shareLogsWithAdmin' }` | no — and the row is **not** written; a malformed body never silently means "false" any more than it means "true" (§8 invariant 15 applies to signup; here the correct answer is to reject, because the user is editing an existing value) |
| Unexpected server error | **500** | `{ error: 'internal' }` | **yes** — never including a password, hash, token, or secret |

**Why `404` and not `403` for cross-owner access** (constraint 3): a `403` is a confirmation
that the id exists. Iterating ids against a `403`/`404` split enumerates every agent in the
system. The two cases are made indistinguishable *at the response*, and distinguishable *in
the admin's server log*, which is exactly the right split of who learns what.

**Why the invite-code failure modes collapse into one message:** distinguishing "no such code"
from "already used" tells an attacker when they have found a real code. There is no legitimate
user need for the distinction — in both cases the answer is "ask the admin for a code."

---

## 8. Business rules

### Invariants (always true)

1. No route handler outside `/api/auth/*` executes any business logic before establishing a
   session. Enforced by the §10.4 fitness test, not by convention.
2. Every repository function that reads or writes an `agent` or `group` row applies
   `owner_id` **inside the same SQL statement** that touches the row. There is no
   check-then-act pair.
3. `ownerId` is a required, non-defaulted parameter everywhere it appears.
4. No entity other than `agent`, `group` (owner), and `llm_call_log` (user, nullable) carries
   a user reference. Child-row ownership is derived from the parent, never stored twice.
5. Password hashing and JWT signing never occur inside a `db.transaction()` callback;
   structurally guaranteed because the transactional signup primitive accepts a hash, not a
   password (§4.4).
6. Signup writes `role: 'user'` unconditionally. No request body field can influence role.
7. Cross-owner denial is always `404` with an identical body to a genuine miss, and is always
   logged server-side.
8. No plaintext password, password hash, session token, or `JWT_SECRET` appears in any
   response body, console line, `llm_call_log` payload, or error message.
9. A `user` row with `passwordHash === ''` can never authenticate; login rejects it before
   invoking bcrypt.
10. `middleware.ts` performs no database access of any kind (it cannot — Edge runtime).
11. `llm_call_log` remains append-only; `user_id` and `shared_with_admin` are set at write
    time or never (Rules Index #45/#46 extended).
12. An invite code transitions `unused → redeemed` exactly once, enforced by
    `UPDATE … WHERE code = ? AND redeemed_by IS NULL` inside the signup transaction.
13. *(review)* `llm_call_log.sharedWithAdmin` records the writing user's consent **as it was
    at write time** and is never updated by any code path. Changing the preference at
    `/account` affects future rows only (constraint 11, §5.6).
14. *(review)* No endpoint, page, or repository function returns another user's
    `requestPayload` or `responsePayload` when that row's `sharedWithAdmin` is false — not to
    the admin, not to anyone. Enforced in `getCallLog(id, viewerUserId)`, i.e. in the same
    statement-level position ownership occupies (§5.6, §6.1).
15. *(review)* At signup, consent is granted only by a request body carrying literally
    `shareLogsWithAdmin: true`. Absent, null, `"true"`, `1`, or malformed → **false**. Consent
    is never inferred from the absence of a refusal.
16. *(review)* `LlmCallContext.forceDryRun` can only turn a live call into a dry run, never a
    dry run into a live call. There is no request field, anywhere, that causes a real API call
    that would not otherwise have happened (§3.9).
17. *(review)* `/api/account` and `/account` read and write **only `session.userId`'s row**.
    No user id is accepted from a body, a query string, or a path segment, so there is no
    cross-user variant of these endpoints to get wrong.

### Policies (configurable / catalog-driven)

18. `maxUsers` — a `SETTING_DEFS` entry, `datatype: 'int'`, **default `5`**, `min: 1`.
    Checked **at signup only**, against `getUserCount()`, inside the signup transaction.
    Lowering it below the current user count never removes anyone; it only blocks new signups.
    **The admin counts toward the cap** (it is a count of `user` rows, not of "guests") —
    simpler to reason about, and stated in the setting's `hint` text so it is not a surprise.
    *(Confirmed at review, §16.8: no design change needed — it is already a DB-backed row,
    editable in System Settings with no migration.)*
19. Session lifetime is 7 days, fixed, no refresh. Logging out clears the cookie; it does not
    invalidate the token server-side (§9, §14).
20. Rate limit: 10 attempts / 15 min / (route, IP) on `/api/auth/login` and `/api/auth/signup`.
    *(Current default; the keep-or-drop question is open — §14, §16.7.)*
21. Invite codes do not expire and are unlimited in number. `maxUsers` is the cap that
    matters; an unredeemed code is inert once the cap is reached.
22. **Activity-log visibility is opt-in per user, snapshotted per row** *(rewritten at review,
    §5.6, §16.5)*. The admin always sees every row's **metadata** — who, which agent, when,
    tokens, cost, success or failure — because that is what auditing one shared API key
    requires. The admin sees a row's **prompt and response content** only when that row's
    `sharedWithAdmin` is true, i.e. when the user had consented at the moment the call was
    made. Consent is chosen explicitly at signup (default: private) and changeable at any time
    at `/account`, in either direction, with no retroactive effect either way. The admin's own
    rows and pre-multi-tenancy rows (`userId IS NULL`) are never redacted.
    **This must be disclosed to beta users in words** — Phase 6.3, non-negotiable.
23. Manual operations with no UI, documented in `docs/user-guide.md` and `README.md`:
    promote an admin (`UPDATE user SET role='admin' WHERE email=?`); delete a user
    (delete their `agent`/`group` rows first, or they become unreachable orphans — nothing
    cascades, by design); transfer ownership (`UPDATE agent SET owner_id=?`).
24. **Per-user LLM call cap** *(new at review, §3.9)* — `maxLlmCallsPerUserPerHour`, a
    `SETTING_DEFS` entry, `datatype: 'int'`, **default `15`**, `min: 1`. One global number for
    every non-admin user; **the admin is exempt**. Enforced in `lib/ai/gateway.ts` over a
    **rolling 60-minute** window counting that user's **non-dry-run** `llm_call_log` rows.
    Dry-run rows never count, so the offered fallback cannot push the user further over. A
    call blocked by the cap writes no log row. The user is offered dry-run/preview mode or a
    wait, never a bare failure.

### State transitions (sequences)

25. **Signup:** validate body (including the explicit consent choice, invariant 15) →
    normalize email + code → policy-check the password → **hash (outside any transaction)** →
    `createUserWithInvite()` (atomic: code check → cap check → email check → insert user with
    its consent value → redeem code) → sign JWT → `Set-Cookie` → `201`.
26. **Login:** rate-limit → normalize email → load user → reject empty-sentinel hash →
    `bcrypt.compare` → sign JWT → `Set-Cookie` → `200`. A missing user and a wrong password
    produce the identical `401`. *(A user-enumeration timing difference remains — a missing
    user skips the ~200 ms bcrypt compare. Accepted for a closed beta; §14 records the
    dummy-hash mitigation and its trigger.)*
27. **Logout:** clear the cookie → `204`. The token remains cryptographically valid until
    `exp`; there is no server-side revocation (§9).
28. **Any request:** middleware (signature + expiry, no DB) → handler `authenticate()`
    (cookie → verify → **fresh user row**) → repository (`WHERE owner_id = ?`). Three
    independent gates; only the last two are authoritative.
29. **Any LLM call** *(review)*: route builds `ctx` with `userId` from the session and
    `forceDryRun` from the body → gateway resolves the model → reads `liveLlmCalls` → if off
    **or** `forceDryRun`, writes a dry-run row and returns `dry_run_blocked` → otherwise, if
    `userId` is non-null and that user is not an admin, counts their non-dry-run rows in the
    trailing hour and returns `llm_cap_reached` if at or over the limit → otherwise calls the
    provider and writes a row carrying `userId` and the consent snapshot.
30. **Cap reached, from the user's side** *(review)*: `429 llm_cap_reached` with
    `retryAfterSeconds` and `canDryRun: true` → the client shows two actions → **Preview**
    re-sends the identical request with `dryRun: true`, which returns the familiar
    `409 llm_dry_run` and renders exactly as Plan 04's dry-run mode already does; **Wait**
    dismisses. Either way, nothing was sent and nothing was charged.
31. **Migration/bootstrap:** back up the DB file → `migrate()` creates the bootstrap admin
    with no password and assigns all legacy rows to it → app is fully locked out (correct) →
    `npm run auth:bootstrap` sets email + password → admin logs in → generates invite codes
    → friends sign up.

---

## 9. Non-functional requirements

- **Performance.**
  - `getSession()` per request: one `jose` HS256 verify (~0.1 ms) + one indexed PK read on
    synchronous `better-sqlite3`. Target **< 2 ms** added per request.
  - Middleware: signature verify only, no I/O. Target **< 1 ms**.
  - Login / signup: dominated by bcryptjs at cost 10. Target **< 500 ms** p95; if it measures
    above ~800 ms on the target host, drop the cost to 9 rather than switching libraries.
  - Owner-scoped queries: `agent_owner_idx` and `group_owner_idx` mean `listAgents(ownerId)`
    is an index scan over one tenant's rows, not a full table scan — **faster** than today's
    unfiltered list, not slower.
  - **The §3.9 cap adds two reads to the live LLM path** — one PK lookup (`getUserPolicy`) and
    one indexed range count over `llm_call_log_user_created_idx`. Target **< 2 ms** combined,
    against an operation that takes seconds and costs money. The count is bounded by the
    number of rows in one user's trailing hour (≤ ~15 in normal operation, since the cap
    itself bounds it), so it does not grow with the table.
- **Security.**
  - Secrets: `JWT_SECRET` ≥ 32 chars, validated at startup (§3.2); never logged.
  - Passwords: bcrypt cost 10; 72-byte cap enforced rather than silently truncated.
  - **Privacy of prompt content:** redaction is applied in the repository (§5.6), so an
    unredacted payload is not merely *not rendered* — it is never loaded into the response
    object at all. The narrow `getUserPolicy()` read means the LLM path never holds a password
    hash in memory either.
  - **Consent cannot be forged or inferred:** it is written only from the user's own row, only
    by the gateway, and only at write time (invariants 13, 15).
  - Cookies: `httpOnly`, `sameSite=lax`, `secure` in production. **`secure` requires the
    deploy to be HTTPS** — an http-only host would send session cookies in the clear. This is
    a hard prerequisite for the "deploy online" roadmap item, called out in Phase 6's docs.
  - Enumeration: cross-owner → `404`; login failures → one message; invite-code failures →
    one message.
  - Open redirect: the `next` parameter is validated on consumption (§3.6).
  - Authorization is never derived from a client-supplied value — not from the JWT's `email`
    claim, not from a request body, not from a URL segment alone.
  - **Residual, accepted:** no server-side session revocation. A stolen or exported cookie is
    valid until `exp` (≤ 7 days) even after logout or a password change. Mitigation trigger in
    §14; for a closed beta among friends this is the standard tradeoff.
- **Scalability at 10×.** 10× this beta is ~50 users and a few thousand agents. Every query is
  either PK or covered by the new owner indexes. Two things would degrade, both correctness
  caveats rather than throughput ones: the in-process login rate limiter under a
  multi-instance deploy (§3.8), and — unlike it — **the §3.9 LLM cap would *not* degrade**,
  because it counts rows in the shared database rather than in process memory. That is a
  second, unplanned argument for having built it over `llm_call_log` instead of a counter map.
- **Data integrity.**
  - Signup is one transaction; the three preconditions are re-checked inside it (§4.4).
  - `user.email`'s unique index is the last-resort backstop for a concurrent duplicate.
  - The migration's rebuild step is inside the migrator's transaction; a mid-way failure rolls
    back. The file backup (§4.5 step 0) covers the case the transaction cannot: getting the
    SQL wrong in a way that succeeds.
  - No transaction is held open across a bcrypt hash, a JWT sign, or a network call
    (the last one is Plan 04's rule, still true).
- **Observability.** Console prefix `[auth]` for: failed logins, cross-owner attempts,
  `403`s, rate-limit trips, and empty-sentinel login attempts. Never a password, hash, token,
  or full invite code (log the **last 4 characters** of a code if a code-related event ever
  needs correlating). Existing `[llm-log]` / route logging is unchanged; `[llm-gateway]` gains
  one line — `cap reached — user=<id> count=<n> limit=<n>` — which carries **no prompt
  content**, so it is safe regardless of that user's consent setting.
- **Compliance.** Still out of scope as a formal workflow — there is no GDPR data-export or
  erasure process — but the §5.6 consent model is a real, if minimal, privacy control: content
  is private by default, sharing is an affirmative act, and the user can revoke it for future
  calls at any time. That is worth stating in `docs/user-guide.md` as a stance, not a feature.
  What is still missing (erasure, export, a retention policy for `llm_call_log`) stays in §14
  so "we forgot" and "we decided not to yet" stay distinguishable.

---

## 10. Testing approach

Current baseline: **19 test files, 186 tests, all green.** Everything below assumes that
number only goes up.

### 10.1 The "existing suites break" problem — handled, and it is a compile-time problem

Per §5.5 #1, the break is `tsc`, not `beforeAll`. Sequence:

1. Add `lib/db/__tests__/test-users.ts`:
   `createTestUser(role: 'admin'|'user' = 'user', shareLogsWithAdmin = false):
   { id, email, role, shareLogsWithAdmin }` — inserts a row into the shared in-memory `testDb`
   with a unique email, returns it. **The consent parameter defaults to `false`**, matching
   the production default, so a test that wants shared content has to say so — the same
   "consent is never implicit" property, enforced in the test helper.
2. Run `npx tsc --noEmit`. **The error list is the exhaustive worklist.** Every call site of
   the 14 re-signed functions appears; nothing can be missed by inspection.
3. Fix each suite by adding `const owner = createTestUser();` to its `beforeAll` and threading
   `owner.id`. Suites needing this: `repo.test.ts`, `groups.test.ts` (repository);
   `agents.test.ts`, `export.test.ts`, `groups.test.ts` (routes), `chat.test.ts`,
   `chat-dryrun.test.ts`, `import-dryrun.test.ts`. The `lib/import/*`, `lib/serialize/*`,
   `lib/ai/gateway`, `settings`, and `llm-call-log` suites should need **no owner changes at
   all** — if one does, that is a signal the retrofit reached further than intended.
4. **Semantics change in one place, and the test must change with it:** the name-uniqueness
   tests in `repo.test.ts` / `groups.test.ts` currently assert *global* uniqueness. They become
   *per-owner*, and each gains a **new positive case**: two users may both own an agent named
   `dev`, and creating the second must succeed.

### 10.2 Mocking the session — one seam, no `next/headers` gymnastics in route tests

`@impact` flagged that no test infrastructure simulates `cookies()`. The answer is to not need
it in 13 route suites: `getSession()` is the only function in the codebase that touches
`next/headers`, so route tests mock **it** and let the real `authenticate()` run.

```
vi.mock('@/lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentTestSession),   // reassignable per test
}));
```

Every route suite then gets, at minimum, one **`getSession → null` → expect `401`** case,
which means the guard wiring is genuinely tested per route rather than assumed.

The real cookie-reading path is tested once, directly, in `lib/auth/__tests__/session.test.ts`
with `vi.mock('next/headers', …)` returning a hand-built cookie jar. One file, ~40 lines, and
the risk it covers (reading the wrong cookie name, not awaiting `cookies()`) is real but tiny
and static.

**Feasibility spike, Phase 1.0 (half a day, do it before committing to the rest of Phase 1):**
confirm in this repo's Vitest/node environment that (a) `vi.mock('next/headers')` works for an
async `cookies()`, and (b) `NextRequest`/`NextResponse` can be constructed outside a Next server
so `middleware.ts` is unit-testable. If (b) fails, the middleware falls back to **manual**
verification in the Phase 5 checklist — acceptable, because per constraint 4 middleware is not
the security boundary and every behavior it provides is duplicated authoritatively downstream.
No integration-test harness against a live Next process is introduced by this plan.

### 10.3 New test files

| File | Cases |
|---|---|
| `lib/db/__tests__/migration.test.ts` | On a fresh migrated in-memory DB: `agent.owner_id` is `NOT NULL`; `agent_owner_name_unique` and `group_owner_name_unique` exist; `agent_name_unique` is **gone**; two owners may share an agent name; one owner may not; `user`/`invite_code` exist with the expected columns; `user.share_logs_with_admin` and `llm_call_log.shared_with_admin` both exist, are `NOT NULL`, and **default to 0**; `llm_call_log_user_created_idx` exists |
| `lib/auth/__tests__/jwt.test.ts` | Round-trip sign→verify; tampered payload → null; expired → null; wrong secret → null; the token contains **no** `role` claim |
| `lib/auth/__tests__/password.test.ts` | hash→verify true; wrong password false; `''` sentinel never verifies; < 12 chars rejected; > 72 bytes rejected (incl. a multi-byte-UTF-8 case that is short in *characters* but long in *bytes*) |
| `lib/auth/__tests__/session.test.ts` | `next/headers` mocked: no cookie → null; valid token + existing user → session with the **DB's** role, not the token's; valid token + deleted user → null; role changed in the DB → the new role on the next call |
| `lib/auth/__tests__/guard.test.ts` | `authenticate` no session → 401 body/status; `authenticateAdmin` user → 403; admin → ok |
| `lib/auth/__tests__/inviteCode.test.ts` | Generated format matches `^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$`; excluded characters never appear across 10 000 generations; `normalizeInviteCode` accepts lowercase, missing dashes, and surrounding whitespace, and rejects garbage |
| `lib/db/repository/__tests__/users.test.ts` | `createUserWithInvite` happy path; unknown code; already-redeemed code; `maxUsers` reached; duplicate email; **on every failure path, zero rows are written and the code stays unredeemed**; `getUserCount`; `revokeInviteCode` on a redeemed code fails; **`createUserWithInvite` stores the consent value it was given, both ways**; `getUserPolicy` returns role + consent and **does not return `passwordHash`** (assert the key is absent, not merely unused); `setUserLogSharing` flips the value and returns false for an unknown id |
| `app/api/auth/__tests__/auth.test.ts` | login ok / wrong password / unknown email / sentinel-hash user; signup ok / bad code / cap reached / duplicate email / weak / over-long password; logout clears the cookie; the `Set-Cookie` header carries `HttpOnly` and `SameSite=Lax`; rate limiter trips at the 11th attempt; **signup with `shareLogsWithAdmin` absent / `null` / `"true"` / `1` all produce a user with consent `false`, and only literal `true` produces `true`** (§8 invariant 15 — one case per malformed input, because this is the invariant most likely to be undone by a well-meaning "be liberal in what you accept" refactor) |
| `app/api/settings/__tests__/invite-codes.test.ts` | Admin generate/list/revoke; user → 403; unauthenticated → 401; a generated code is single-use end-to-end (generate → signup → second signup with the same code fails) |
| **`app/api/__tests__/account.test.ts`** *(new at review)* | `GET` unauthenticated → 401; `GET` returns the caller's own email/role/consent; `PATCH { shareLogsWithAdmin: true }` flips it and a subsequent `GET` reflects it; `PATCH` with a non-boolean → 400 **and the stored value is unchanged**; **a body carrying another user's id in any field has no effect on that user's row** (§8 invariant 17); an admin session gets the same behavior as a user session — no elevated variant exists |
| **`lib/ai/__tests__/gateway-cap.test.ts`** *(new at review)* | Under the cap → provider called; at the cap → `{ ok:false, reason:'llm_cap_reached' }` **and no `llm_call_log` row written** and the provider never invoked; admin at the cap → provider called (exempt); `ctx.userId: null` at the cap → provider called (no cap outside a request); dry-run rows do not count toward the limit; **a row exactly 61 minutes old does not count, one 59 minutes old does** (the rolling window's boundary, the single most likely off-by-one); `retryAfterSeconds` is derived from the oldest in-window row; `forceDryRun: true` with `liveLlmCalls` on → dry-run row, provider untouched, cap **not** consulted |
| **`lib/db/repository/__tests__/llmCallLog-redaction.test.ts`** *(new at review)* | `getCallLog(id, viewer)` with viewer = the row's own user → full payloads; viewer = admin, row `sharedWithAdmin: false` → both payloads `null`, `redacted: true`, **and every metadata field still populated** (asserted field by field, so a future over-broad redaction is caught); viewer = admin, row shared → full payloads; row with `userId: null` → never redacted; `listCallLogs` sets `redacted` correctly per row |
| **`app/api/__tests__/tenancy.test.ts`** | **The crown jewel — see 10.4** |

### 10.4 The two tests that make this plan verifiable

**`app/api/__tests__/tenancy.test.ts` — cross-tenant isolation, table-driven.** Two users, A
and B; A owns one agent (with sections, config, a group, a membership). Then, with B's session,
for **every** id-taking endpoint:

| Endpoint | Expected with B's session |
|---|---|
| `GET /api/agents` | A's agent is absent from the list |
| `GET /api/agents/[A]` | 404 |
| `PATCH /api/agents/[A]` | 404, **and A's row is unchanged in the DB** |
| `DELETE /api/agents/[A]` | 404, **and A's row still exists** |
| `GET /api/agents/[A]/export` | 404 |
| `PATCH /api/agents/[A]/sections/[As]` | 404, **and the section content and version are unchanged** |
| `PATCH /api/agents/[B]/sections/[As]` | 404 — the §6.4 mismatched-pair case, both owned by different users |
| `PATCH /api/agents/[Bagent]/sections/[Bsection-of-another-B-agent]` | 404 — the mismatched-pair case **within one owner**, which is the part the naive fix misses |
| `POST /api/agents/[A]/groups` | 404 |
| `DELETE /api/agents/[A]/groups/[Ag]` | 404 |
| `GET /api/groups` | A's group absent |
| `DELETE /api/groups/[Ag]` | 404 |
| `POST /api/chat` with A's agentId | 404, **zero `section_revision` rows written** |
| `POST /api/agents/import` with a file named exactly like A's agent | **200, and a NEW agent is created for B — A's agent is untouched** (§6.3 hole 1) |
| `POST /api/agents` with the same name as A's agent | **201 — not 409** (§6.3 hole 2) |
| `GET /api/settings`, `PATCH /api/settings`, `GET /api/llm-call-log`, `GET /api/llm-call-log/[id]` | 403 (B is a user) |
| `GET /api/account` | **200 — B's own row**, and it is B's, not A's (this is the one endpoint in the table that must *succeed*, which is why it belongs here: a tenancy suite that only ever expects failure cannot catch an endpoint that fails for everyone) |
| `PATCH /api/account` | 200, **and A's `share_logs_with_admin` is unchanged** |
| `GET /api/llm-call-log/[A's row]` **as the admin**, A not consenting | 200, `redacted: true`, payloads `null`, metadata intact (§5.6) |
| `GET /api/llm-call-log/[A's row]` **as the admin**, A consenting | 200, `redacted: false`, payloads present |
| `POST /api/chat` as B, B at the hourly cap | **429 `llm_cap_reached`**, `canDryRun: true`, **zero `section_revision` rows written and no new `llm_call_log` row** |
| `POST /api/chat` as B with `dryRun: true`, B at the cap | **409 `llm_dry_run`** — the fallback works while capped (§3.9) |
| `POST /api/chat` as the admin, admin over the cap threshold | **not 429** — the exemption, asserted end-to-end and not only at the gateway |
| all of the above with `getSession → null` | 401 |

Every mutating row asserts **both** the status code and that the target row is byte-identical
afterwards. A `404` returned by a handler that already performed the write would otherwise pass
a status-only assertion. The same discipline applies to the two `429` rows: a cap that returns
the right status *after* calling the provider would be worse than no cap at all, so they assert
that no log row appeared.

**`app/api/__tests__/route-guard.test.ts` — a fitness function**, in the spirit of Plan 04
§10.2's one-SDK-importer test. It reads every `route.ts` under `app/api/` and asserts:

- every file outside `app/api/auth/` contains `authenticate(` or `authenticateAdmin(`;
- `app/api/settings/**` and `app/api/llm-call-log/**` contain `authenticateAdmin(`;
- **`app/api/account/**` contains `authenticate(` and does *not* contain `authenticateAdmin(`**
  — the User Settings surface must never acquire an admin gate by copy-paste from its
  neighbour (§5.7);
- no `'use client'` file under `app/` calls a bare `fetch('/api/` (they must use `apiFetch`).

~25 lines, no dependency, and it is the only thing that will still be enforcing this in six
months. This project has no ESLint config (roadmap TODO 6), so a test is the available
enforcement mechanism.

### 10.5 Component tests — the same accepted gap, restated

New `app/login/page.tsx`, `app/signup/page.tsx`, and `app/account/page.tsx` ship with **no
component tests**, consistent with `plans/roadmap.md` TODO 8 and Plan 04 §10.6. The
compensating control is the Phase 5 manual checklist. Two things reduce the risk honestly: the
forms are single-purpose and stateless apart from an error string, and the server-side routes
behind them are fully covered by §10.3. The recommendation to build component-test
infrastructure as its own roadmap item stands and is **strengthened** by this plan — it now
applies to a login form and a privacy consent control, not just a dialog.

**Two consequences of the review that this gap now covers, and should not be allowed to hide
in it.** The signup consent block (§5.6) and the cap-reached choice in `ChatPanel` /
`ImportDialog` (§3.9) are both *client-side presentations of a server-side rule*. The rules
themselves are fully tested server-side (§10.3–10.4). What is untested is whether the UI
presents them: that the consent block cannot be submitted unanswered, and that a `429` renders
two actions rather than a red error string. Both are **explicit items on the Phase 5.5 manual
checklist**, called out there by name, so the gap is a known one rather than an assumed one.

### 10.6 What must NOT change

`lib/serialize/__tests__/golden.test.ts`, `lib/import/__tests__/*`, and
`lib/ai/__tests__/gateway.test.ts` should pass **untouched**. They exercise pure functions with
no owner concept. If any of them needs an edit, the retrofit has leaked into a layer it had no
business reaching — treat that as a signal to stop and re-read §6, not as a test to fix.

**This still holds after the review's gateway changes, and it is a design constraint on them,
not a coincidence.** `lib/ai/__tests__/gateway.test.ts` builds `ctx` objects without a
`userId`; §3.9 step 4 skips the cap entirely when `userId` is null, and the consent snapshot
is `false` for the same rows. So every existing gateway case behaves exactly as before. The
new cap behavior is therefore tested in a **new file** (`gateway-cap.test.ts`, §10.3) rather
than by editing the old one — which keeps this section's guarantee literally true and makes
"did the cap change existing gateway behavior?" answerable by `git status` alone.

---

## 11. Implementation sequence

Phases are gated. Every gate includes `npx tsc --noEmit` clean and `npm test` green. Do not
start a phase before its gate predecessor passes.

### Phase 0 — Schema, migration, repository retrofit *(the big one; no auth yet)*

| Step | File | Depends on |
|---|---|---|
| 0.1 | `package.json` — `npm i jose bcryptjs && npm i -D @types/bcryptjs`; add `"auth:bootstrap"` | — |
| 0.2 | `lib/auth/constants.ts` | — |
| 0.3 | `lib/db/schema.ts` — `user` (incl. `shareLogsWithAdmin`), `inviteCode`; `agent`/`group` `ownerId` + composite unique + owner index; `llmCallLog.userId` + `sharedWithAdmin` + `llm_call_log_user_created_idx` (§4.1–4.3) | 0.2 |
| 0.4 | **Back up `myagent.db`**, stop the dev server, generate `0003_*`, hand-author its body (§4.5) | 0.3 |
| 0.5 | `lib/db/__tests__/test-users.ts` + `lib/db/__tests__/migration.test.ts` | 0.4 |
| 0.6 | `lib/db/repository/users.ts` + barrel — **including `getUserPolicy()` and `setUserLogSharing()`** (§6.2) | 0.4 |
| 0.7 | Owner-scope `agents.ts` (9 fns) and `groups.ts` (5 fns) — **including the three §6.3 security fixes and §6.4** | 0.4 |
| 0.8 | `llmCallLog.ts`: `userId` + `sharedWithAdmin` on write; `getCallLog(id, viewerUserId)` **redaction** (§5.6); `countLlmCallsInWindow()` (§3.9). `lib/ai/gateway.ts`: `LlmCallContext.userId` + `forceDryRun`, and write the two new columns. `scripts/test-structural-import.ts` one line | 0.4, 0.6 |
| 0.8b | `lib/db/repository/__tests__/llmCallLog-redaction.test.ts` (§10.3) — written now, with the repository change, because redaction is a data-access rule and testing it here needs no HTTP | 0.8 |
| 0.9 | `npx tsc --noEmit` → fix every existing suite from the error list (§10.1); update the name-uniqueness tests to per-owner semantics | 0.7 |
| 0.10 | `lib/db/repository/__tests__/users.test.ts`; new owner-isolation cases in `repo.test.ts` / `groups.test.ts` | 0.6, 0.9 |

**Gate 0:** `tsc` clean; 186 existing + new tests green; the three §4.5 verification checks
pass; **routes still compile and behave as before because they now pass a hardcoded
`BOOTSTRAP_USER_ID`** — a deliberate, temporary scaffold removed in Phase 3, and the reason
Phase 0 can be gated independently of the auth subsystem. *(Write it as an obvious
`// PHASE-0 SCAFFOLD — replaced in Phase 3` comment at every site so a partially-landed plan is
never mistaken for a finished one.)*

### Phase 1 — Auth core *(built and tested, wired to nothing)*

| Step | File |
|---|---|
| 1.0 | **Spike (§10.2):** confirm `vi.mock('next/headers')` and constructible `NextRequest` in this repo's Vitest setup. Decide middleware testability before writing it |
| 1.1 | `lib/env.ts` `getJwtSecret()`/`assertServerEnv()`; root `instrumentation.ts`; `.env.example` |
| 1.2 | `lib/auth/jwt.ts` (+ tests) |
| 1.3 | `lib/auth/password.ts` (+ tests) |
| 1.4 | `lib/auth/session.ts` (+ tests) |
| 1.5 | `lib/auth/guard.ts` (+ tests) |
| 1.6 | `lib/auth/inviteCode.ts` (+ tests); `lib/auth/rateLimit.ts` |

**Gate 1:** auth suites green; the app is byte-for-byte unchanged in behavior (nothing imports
`lib/auth/` yet); fully revertable by deleting one folder.

### Phase 2 — Auth + invite-code routes

| Step | File |
|---|---|
| 2.1 | `lib/settings.ts` — **`maxUsers` and `maxLlmCallsPerUserPerHour`** entries + typed accessors; `SettingDef.min/max`; `app/api/settings/route.ts` range validation; `lib/db/seed.ts` seeds **both** with `onConflictDoNothing` (Rules Index #47) |
| 2.2 | `app/api/auth/login/route.ts`, `signup/route.ts`, `logout/route.ts` — signup carries the **consent field** and its strict coercion (§8 invariant 15) |
| 2.3 | `app/api/settings/invite-codes/route.ts` + `[code]/route.ts` |
| 2.4 | **`app/api/account/route.ts`** — `GET`/`PATCH`, session-scoped (§5.7). Depends on 0.6's `setUserLogSharing()` |
| 2.5 | `app/api/auth/__tests__/auth.test.ts`, `app/api/settings/__tests__/invite-codes.test.ts`, **`app/api/__tests__/account.test.ts`** |

**Gate 2:** a full generate-code → signup (with either consent answer) → login → read/flip
`/api/account` → logout cycle passes in tests. Existing routes are still unauthenticated —
deliberately, so Phase 3 is a single reviewable change. The cap is **not** enforced yet: the
setting exists and is readable, but nothing consults it until 3.7, because `ctx.userId` is not
populated until 3.2.

### Phase 3 — Retrofit every existing route, page, and add middleware

| Step | File |
|---|---|
| 3.1 | `middleware.ts` (+ a test if the 1.0 spike said yes) |
| 3.2 | All 10 existing `app/api/**` route files: guard + session + `ownerId`; **`ctx.userId` from the session** on the three LLM-calling routes; **delete every Phase-0 scaffold constant** |
| 3.3 | `app/page.tsx`, `app/agents/[id]/page.tsx`, `app/settings/page.tsx` — `requirePageSession()` + the admin check; `/settings` passes `session.userId` into `getCallLog()` as the viewer (§5.6) |
| 3.4 | `app/api/__tests__/tenancy.test.ts` (§10.4) |
| 3.5 | `app/api/__tests__/route-guard.test.ts` (§10.4) |
| 3.6 | Add a `getSession → null` ⇒ 401 case to each existing route suite |
| 3.7 | **Per-user LLM cap, server side (§3.9)**: the gateway's step-4 gate + `LlmUserCapReachedError`; the one-block change in `chatMediator.ts` / `importConverter.ts` / `structuralConverter.ts`; `429` mapping and `dryRun` body handling in `/api/chat` and `/api/agents/import`. Depends on 0.8 (`countLlmCallsInWindow`, `ctx` fields), 2.1 (the setting), and **3.2** (`ctx.userId` actually populated) |
| 3.8 | `lib/ai/__tests__/gateway-cap.test.ts` (§10.3) + the four cap/redaction rows in the tenancy suite |

**Why 3.7 sits here and not in Phase 2.** The cap is enforced in the gateway, but it is inert
until a real `userId` reaches it, which happens in 3.2. Landing it in Phase 2 would mean
shipping a gate that cannot fire and cannot be tested end-to-end — the same reasoning that
puts the Phase-0 scaffold where it is. It is the last step of Phase 3 rather than the first so
that a failure here cannot be confused with a tenancy failure in 3.2–3.6.

**Gate 3:** `grep -rn 'PHASE-0 SCAFFOLD' app lib` returns nothing; the tenancy suite is fully
green; the route-guard fitness test passes; the cap suite is green and
`lib/ai/__tests__/gateway.test.ts` is still **unmodified** (§10.6).

### Phase 4 — UI

| Step | File |
|---|---|
| 4.1 | `lib/apiFetch.ts`; swap all 14 call sites in the 9 client components |
| 4.2 | `app/login/page.tsx` (incl. the `next` validation, §3.6) |
| 4.3 | `app/signup/page.tsx` — **including the cookie-banner-style consent block** (§5.6): its own bordered section, two explicit actions, no pre-selected answer, no submit without one |
| 4.4 | `Topbar.tsx` — `session` prop, email, Logout, always-visible **`Account`**, admin-only **`⚙ System Settings`** (§5.7); thread through `WorkbenchShell.tsx` and the two other pages that render it |
| 4.5 | `SettingsView.tsx` — the `maxUsers` and `maxLlmCallsPerUserPerHour` fields, the invite-code panel (generate + copy + list + revoke), and the **redacted-row treatment** in the activity log (a "content hidden" affordance on the row, not an empty payload panel on click) |
| 4.6 | **`app/account/page.tsx` + `app/components/Account/AccountView.tsx`** — User Settings: the consent toggle via `PATCH /api/account`, read-only email and role, and one sentence stating that changing it is **not retroactive in either direction** (§5.6) |
| 4.7 | **Cap-reached choice in `Chat/ChatPanel.tsx` and `Library/ImportDialog.tsx`** — on `429 llm_cap_reached` with `canDryRun: true`, render two actions ("Preview without sending" → re-send with `dryRun: true`; "Wait" → dismiss with a humanised `retryAfterSeconds`). Both components already handle the `409 llm_dry_run` response the preview path produces, so this adds a branch, not a new rendering mode |

**Layout note (standing rule 4) — waived once, deliberately.** 4.2, 4.3, 4.5's invite-code
panel, 4.6, and the 4.7 choice are new visual surfaces, so the standing rule would normally
require prototyping them in `architecture/layout/Layout-Workbench.html` first. **Confirmed at
review (§16.11): skip the detour for these.** They are forms and a two-button prompt built
from existing tokens and existing panel styles — the mockup's value is in resolving *layout*
questions, and these raise none. This is a **one-time exception for this plan's surfaces, not
a change to the standing rule**, which remains in force for anything that alters the workbench
shell.

**Gate 4:** `tsc` clean; all tests green; no bare `fetch('/api/` remains in a client component;
the Topbar shows two distinctly-labelled settings entry points, and only one of them to a
non-admin.

### Phase 5 — Bootstrap, real migration, manual verification

| Step | Action |
|---|---|
| 5.1 | Dev server **off**. `cp myagent.db myagent.db.bak-<date>` |
| 5.2 | `npm run db:seed` (runs `migrate()` then seeds `maxUsers` and `maxLlmCallsPerUserPerHour`) |
| 5.3 | Verify: agent/group counts unchanged; zero `owner_id IS NULL`; the bootstrap user exists with `role='admin'` and an empty hash |
| 5.4 | `BOOTSTRAP_USER_PASSWORD='…' BOOTSTRAP_USER_EMAIL='…' npm run auth:bootstrap` |
| 5.5 | **Manual checklist, dev server + browser, with "Live LLM calls" OFF so the whole pass is free (Plan 04 §10.6's argument applies verbatim):** log in as the admin; see exactly the pre-existing agents; hit `/settings` and generate a code; log out; `/agents/<id>` redirects to `/login`; sign up as a second user with the code; the new account sees **zero** agents; create an agent with the **same name** as one of the admin's — it succeeds; `/settings` as that user redirects to `/`; `GET /api/llm-call-log` as that user returns 403; paste the admin's agent id into the URL — 404; reuse the spent invite code — rejected; set `maxUsers` to the current count and confirm a third signup is refused; delete the session cookie in devtools and click something — the app lands on `/login` with `?next=` preserved and returns to the right page after logging back in |
| 5.5b | **Manual checklist, review additions** *(same session, still with "Live LLM calls" OFF)*: on `/signup`, confirm the consent block is visually prominent and **the form cannot be submitted with neither answer chosen**; sign up choosing *private*; as the admin, open the activity log and confirm that user's dry-run rows show metadata but **no prompt text**, with a visible "content hidden" marker; as that user, open **`Account`** from the Topbar, flip sharing on, make another call, and confirm the **new** row is readable to the admin while the **earlier** one is still hidden (the non-retroactivity rule, §5.6, seen end-to-end); confirm the Topbar shows `Account` for both accounts and `⚙ System Settings` only for the admin; then verify the cap **without spending anything**: set `maxLlmCallsPerUserPerHour` to `1` in System Settings and hand-insert one fake `llm_call_log` row for that user with `dry_run = 0` and `created_at = unixepoch()` (SQL, one statement — the gateway counts rows, so a real call is not needed and standing rule 2 is not touched); then send a chat instruction as that user and confirm it returns the **cap choice with two actions** rather than an error; take "Preview without sending" and confirm it produces the familiar dry-run result; repeat as the admin and confirm the **admin is not capped**; delete the fake row afterwards |
| 5.6 | **Shut the dev server down** (standing rule 3) |

### Phase 6 — Documentation sync

| Step | File |
|---|---|
| 6.1 | `architecture/TechDesign.md` — data-model entries for `User`/`InviteCode`, `ownerId` on `Agent`/`Group`, `llm_call_log`'s two new columns; Rules Index **#48–#62** (continuing from #47), listed in 6.1a below. Add §14's rows to Deferred Decisions. Also **remove** the stale "users/auth arrive with hosted mode, out of MVP scope" bullet in *Deferred (not in the data model yet)* |
| 6.2 | `README.md` — new env vars, the bootstrap command, the **HTTPS requirement** for the `secure` cookie, and the two new settings with their defaults |
| 6.3 | `docs/user-guide.md` — signing in; inviting someone; the **admin/user** distinction; **System Settings vs. your Account page**; the **§8 policy 22 privacy disclosure written as prose**: what the admin can always see (metadata, cost, which agent), what they can only see with your consent (your instructions and the AI's replies), that the choice is yours at signup and changeable at `/account`, and that changing it **is not retroactive in either direction**; and the per-user hourly LLM cap with the preview fallback (§3.9). **This step is a deliverable, not a formality** — the consent model is only honest if it is stated in words the beta users actually read |
| 6.4 | `plans/roadmap.md` — move Plan B into "What's built"; TODO 2 (deploy online) is now unblocked; add §14's deferred items. **Do not touch this file until the user has reviewed the completed build** |
| 6.5 | `CHANGELOG.md` + `CLAUDE.md` — an entry and a pointer, in the established shape |
| 6.6 | `lib/ai/CLAUDE.md` — the gateway section gains: `LlmCallContext` now carries `userId` and `forceDryRun`; the gateway enforces the per-user hourly cap and writes the consent snapshot. This is the file that documents the choke point, and the choke point now has a second responsibility |

**6.1a — the Rules Index entries to add (#48–#62), in order:**

| # | Rule | Source |
|---|---|---|
| 48 | Ownership is enforced in the repository, in the same statement that touches the row | §6.1 |
| 49 | `ownerId` is never optional and never defaulted in any signature | constraint 2 |
| 50 | Cross-owner denial is `404`, never `403` | constraint 3 |
| 51 | `middleware.ts` is never the authorization boundary and never reads the DB | constraint 4 |
| 52 | Password hashing never happens inside a `db.transaction()` callback | constraint 5 |
| 53 | Signup cannot mint an admin; no request field influences `role` | §8 invariant 6 |
| 54 | Role is read fresh from the DB on every request, never from a token claim | §2.1 |
| 55 | Invite codes are single-use and stored in plaintext, deliberately | §4.2 |
| 56 | `maxUsers` is checked inside the signup transaction, not only before it | §4.4 |
| 57 | *(review)* `llm_call_log.shared_with_admin` is written once at write time and never updated | constraint 11 |
| 58 | *(review)* Consent is never inferred: only a literal `true` grants it | §8 invariant 15 |
| 59 | *(review)* Redaction of another user's payloads happens in the repository, not the view | §8 invariant 14 |
| 60 | *(review)* The per-user LLM cap is enforced in the gateway, never in a route | constraint 12 |
| 61 | *(review)* `forceDryRun` may only downgrade a live call; no request field can cause a real API call | §8 invariant 16 |
| 62 | *(review)* `/api/account` operates only on `session.userId`; no user id is accepted from a request | §8 invariant 17 |

### 11.1 Dependencies and parallelization

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6
                │                       │          ▲
                └──── 4.2/4.3/4.6 ──────┴──────────┘   (may start once Phase 2 lands)
                      (login, signup+consent, /account)
```

- **Phase 0 blocks everything** and is roughly 40 % of the work.
- Phase 4.2/4.3/**4.6** depend only on Phase 2's routes (`/api/auth/*`, `/api/account`) and can
  be built in parallel with Phase 3 by a second worker; 4.1/4.4/4.5 need Phase 3.
- **Phase 4.7 (the cap-reached choice) depends on 3.7**, not merely on Phase 3 — it renders a
  response shape that does not exist until the gateway gate is in. It is the one UI step that
  cannot be pulled forward.
- Phase 5 cannot be parallelized — it mutates the one real database.

### 11.2 Risk per phase

| Phase | Risk | Mitigation |
|---|---|---|
| 0 | The hand-authored migration is wrong and `DROP TABLE` destroys real data | Mandatory file backup (§4.5 step 0); `test-db.ts` migrates from scratch on every test run, so malformed SQL fails all 19 suites instantly; three explicit verification checks at gate 0; the real DB is only touched in Phase 5, after the SQL has run hundreds of times in memory |
| 0 | A repository function is missed and stays unscoped | `tsc` enumerates the call sites; every function's owner behavior gets a repository test; the tenancy suite (Phase 3) is the end-to-end backstop |
| 0 | The temporary `BOOTSTRAP_USER_ID` scaffold survives into production | A grep gate at Phase 3 (`PHASE-0 SCAFFOLD` must return nothing) and a mandated comment marker at every site |
| 1 | `jose` or `bcryptjs` misbehaves in this toolchain (Edge build, Vitest, `server-only` alias) | The 1.0 spike; `jwt.ts` deliberately imports nothing Node-specific so the Edge build cannot break on it |
| 2 | Signup races produce two accounts on one code, or exceed `maxUsers` | All three checks re-run inside the transaction (§4.4); `UPDATE … WHERE redeemed_by IS NULL`; the `email` unique index; explicit concurrency tests |
| 3 | One route is retrofitted incorrectly and silently leaks | The tenancy suite covers **every** id-taking endpoint with both a status and an unchanged-row assertion; the route-guard fitness test catches a *missing* guard |
| 3 | Middleware over-matches and blocks static assets or the login page itself | The matcher excludes `_next/*`; the public allowlist is asserted; manual check at 5.5 |
| 3 | *(review)* The cap fires but only **after** the provider was called — a `429` that already spent the money | The gate is placed before the provider call in the gateway's normative order (§3.9), and `gateway-cap.test.ts` asserts **the provider mock was never invoked**, not merely that the status was 429 |
| 3 | *(review)* The rolling-window boundary is off by one and users are capped early or late | Two explicit boundary cases in `gateway-cap.test.ts` (59 vs. 61 minutes), written against a controlled clock |
| 4 | A client component keeps a bare `fetch` and shows a confusing error on session expiry | The fitness test forbids bare `fetch('/api/` in `'use client'` files |
| 4 | *(review)* The signup consent block is implemented as an ordinary checkbox and quietly defaults to "shared" | The server is the backstop: §8 invariant 15 means the route ignores anything that is not literally `true`, so a UI mistake fails **closed**. The UI requirement itself is on the 5.5b manual checklist |
| 4 | *(review)* `/account` is added under `/settings` by a later contributor and inherits an admin gate | The route-guard fitness test asserts `app/api/account/**` does **not** contain `authenticateAdmin(`; §5.7 records why the path is top-level |
| 5 | The admin locks themselves out (bad env var, typo'd email) | The bootstrap CLI is idempotent and re-runnable with `--force`; the DB backup allows a full revert; the exact recovery SQL goes in `README.md` |
| all | An accidental real Anthropic call during verification | Standing rule 2; Phase 5.5 **and 5.5b** are run with "Live LLM calls" **off**, which makes the entire manual pass free. **The cap check is the one step that naively appears to need a real call** — with live calls off every call is a dry run, and dry runs deliberately do not count (§3.9). It is verified instead by hand-inserting one fake non-dry-run log row and lowering the setting to `1`, because the gateway counts **rows**, not API responses. Recorded here explicitly so nobody "solves" it by turning live calls on |

### 11.3 Complexity — confirming `@impact`'s estimate

**Confirmed High**, with a sharper framing. `@impact` said "comparable to Plans 01–03
combined." The *conceptual* surface is smaller than Plan 01 (no new domain model, no AI
behavior, no serialization contract), but the **blast radius is the largest of any plan so
far**: 2 new tables, 3 altered (one with a destructive rebuild against real data), 15
repository functions re-signed and 10 added, 13 route handlers retrofitted and 8 added, 4
server components, 11 client components, 8 of 19 existing test suites edited, 13 test files
added, and 2 new runtime dependencies. Phase 0 alone is bigger than all of Plan 04. Sequencing
it so that Phase 0 lands with the app still fully working (via the scaffold constant) is the
single most important scheduling decision in this plan.

**What the review added, in scope terms.** Roughly one extra phase-step per phase: two schema
columns and one index (Phase 0), one setting and one route pair (Phase 2), one gateway gate
and three one-block caller edits (Phase 3), two UI surfaces and one branch in two existing
components (Phase 4), three test files (§10.3). None of it changes the plan's shape or its
critical path — the migration and the repository retrofit remain the risk, and the additions
all hang off structures Phase 0 was already building. The role rename is mechanical and
touches no logic. **The estimate moves from High to High; it does not move to a different
plan.**

---

## 12. Impact-report unknown / risk → resolution map

| # | Item | Resolved in |
|---|---|---|
| 1 | Bootstrap credentials mechanism | §5.1 — idempotent CLI; three alternatives rejected with reasons; §16.1 |
| 2 | Admin-distinction mechanism | §5.2 — `user.role`; §16.2 |
| 3 | Plan A's `setting` table shape | **Moot** — Plan A shipped; the real `setting`/`SETTING_DEFS`/`PATCH` allowlist were read directly. `maxUsers` is one appended `SETTING_DEFS` entry, exactly as Plan 04 §13 promised: no migration, no route change beyond the new admin guard and the `min` bound |
| 4 | `llm_call_log.userId` ownership | §4.3 — added here, nullable, never backfilled (§8 invariant 11) |
| — | `ImportedAgentData.ownerId` seam | §5.3 — a third option neither the analyst nor impact listed |
| — | 401 client handling | §5.4 — one `apiFetch` wrapper; count corrected to 9 files / 14 sites |
| — | Section route ignores `[id]` | §6.4 — closed on all three axes; two dedicated tenancy cases |
| — | `addMembership` cross-owner linking | §6.3 #3 — enforced in the repository |
| — | `updateAgent` name-collision leak | §6.3 #2 |
| — | Re-import overwriting another user's agent | §6.3 #1 — **not in the impact report**; found during this design pass and the most severe hole of the three |
| — | SQLite `NOT NULL` ALTER ordering | §4.5 — full hand-authored sequence, with the reason drizzle-kit cannot generate it |
| — | All 19 suites break on migration | §5.5 #1 (corrected diagnosis) + §10.1 (procedure) |
| — | No `next/headers` / edge test precedent | §10.2 — mock one seam; one direct test for the real path; a Phase 1.0 spike before committing to middleware tests |
| — | Six different ownership implementations would drift | §6.1 — one implementation, in the repository |
| — | *(review)* Who may read whose prompt content once there is more than one user | §5.6 — opt-in consent, snapshotted per row; §8 policy 22 |
| — | *(review)* One shared API key with no per-person ceiling | §3.9 — 15 calls/hour/user, admin exempt, enforced at the gateway; §8 policy 24 |
| — | *(review)* `/settings` serving two different audiences | §5.7 — System Settings (`/settings`, admin) vs. User Settings (`/account`, everyone) |

---

## 13. Plan 04 interaction — obligations inherited and discharged

| Plan 04 §13 promise | Status in this plan |
|---|---|
| `setting.maxUsers` as a data row, no migration | ✅ One `SETTING_DEFS` entry (§8 policy 18). The promise held exactly |
| `ALTER TABLE llm_call_log ADD COLUMN user_id TEXT` is one line | ✅ §4.5 step 2. `listCallLogs` already selects explicit columns, so the new column could not leak into the list DTO — it is added **deliberately** instead |
| "`/api/settings` and `/api/llm-call-log` must be in Plan B's first auth pass" | ✅ Both are admin-only (§7.1). `GET /api/llm-call-log/[id]`, which returns full prompts and agent bodies, is the most sensitive endpoint in the app and is now the most restricted |
| `setting` stays global/admin scope | ✅ Constraint 8; no `ownerId` on `setting` |
| One shared API key | ✅ Unchanged; per-tenant keys explicitly out of scope |
| Rules Index #45/#46 (append-only log, never backfilled) | ✅ Extended to `user_id` **and** to `shared_with_admin` (§8 invariants 11 and 13). The consent snapshot was designed *around* this rule rather than as an exception to it — §5.6's table shows the live-join alternative that would have broken it |
| Rules Index #47 (`onConflictDoNothing` for admin-owned seed rows) | ✅ Applied to `maxUsers` **and `maxLlmCallsPerUserPerHour`**; **and this plan deliberately does not seed any `user` row** — user creation never happens on `predev`, which is also why the bootstrap CLI stays out of `seed.ts` (§5.1) |
| Plan 04's dry-run mechanism | ✅ **Reused, not duplicated.** The §3.9 cap's fallback is Plan 04's dry-run path, reached via `ctx.forceDryRun`, returning Plan 04's existing `409 llm_dry_run` shape to components that already render it. The cap adds one gateway branch and one error type; it adds no second "blocked call" concept |
| Plan 04 constraint 2 (the gateway is the single choke point for AI calls) | ✅ Strengthened. The choke point now also enforces spend-per-user (constraint 12), which is only possible *because* the choke point exists — a per-route cap would have needed the same check in three places |

---

## 14. Deferred decisions (this plan's additions to `TechDesign.md`'s table)

Two kinds of row live here, and the difference matters when reading it:

- **Deferred** — a decision that *has* been made ("not now, and here is the trigger").
- **🔶 Open** — a decision that has **not** been made. The plan has a working default so the
  build is not blocked, but the default is a fallback, not a choice. Added at the 2026-07-30
  review, which deliberately left two questions unanswered rather than answering them thinly.

| Item | Why deferred | Revisit when |
|---|---|---|
| 🔶 **OPEN — the login/signup rate limiter: keep it or drop it?** (§3.8, §15.6) | **Not decided at review.** It is ~30 lines with no dependency, but it is per-process, resets on restart, trusts a spoofable `x-forwarded-for`, and was never in the approved scope. §3.8's design **stays as the current default because nothing overrides it**, not because it was chosen | Before the first real deploy, or whenever the host's own rate limiting / TLS termination story is known — the answer depends on what the platform already does |
| 🔶 **OPEN — whether to disclose the rate limit in the login UI** | **Not decided at review.** The `429` body already carries `retryAfterSeconds`, so a locked-out user is told *something*; the open question is whether the limit's existence is stated **before** anyone trips it. Arguments both ways were raised and neither was accepted: stating it is honest and reduces confusion; stating it also tells an attacker the exact budget | Resolved together with the row above — the two are one conversation |
| **In-place re-login modal preserving unsaved client state** (§5.4) — explicitly wanted as a future feature | Today a `401` hard-navigates to `/login`, discarding a half-typed chat instruction. A modal that re-authenticates in place and resumes the original request is materially more work: it needs a request-replay path, a modal that can render over any surface, and a decision about what happens if the *replay* also fails | Any beta user loses work to an expired session — or sooner, since this was raised as a wanted feature rather than a hypothetical. `lib/apiFetch.ts` is the single place it will be implemented, which is one more reason all 14 call sites go through it now |
| **Per-individual LLM quotas** (a per-user override of `maxLlmCallsPerUserPerHour`, §3.9) | The cap is one global number by decision, not by omission. A per-user override cannot live in `setting` (constraint 8) and would need a column on `user` or a small table, plus a UI to set it — for a beta where the answer to "this person needs more" is a conversation | Someone legitimately needs a different ceiling and raising it globally is the wrong answer |
| **Per-user LLM spend/cost caps rather than call-count caps** | A call count is a proxy for cost that ignores token size — 15 large imports cost far more than 15 short chats. `llm_call_log.usage` already records tokens, so a cost-based cap is the same query with a `SUM` instead of a `COUNT` | The proxy visibly misbehaves — i.e. the bill is high while nobody is near the call cap |
| Server-side session revocation (a token version column or a session table) | Requires a per-request read of a revocation source and a policy for what invalidates what. A 7-day JWT among ≤ 10 known friends does not justify it | A password reset flow exists, a user must be removable immediately, or the beta stops being closed |
| Sliding session refresh / "remember me" | A fixed 7-day window is one state to reason about; a refresh path is three | Users complain about re-logging-in, or the TTL is shortened for security reasons |
| Password reset / forgot-password | Needs an email transport, which the app does not have and which is its own infrastructure decision | Any beta user actually forgets a password (admin-side reset via the bootstrap CLI is the interim answer) |
| Argon2id instead of bcrypt | bcrypt's 72-byte cap and pure-JS slowness are real but adequate here; argon2 needs a native build | The native-dependency constraint disappears (a Docker image, a Linux-only host) — the hash format is prefix-tagged, so a lazy rehash-on-login migration is straightforward |
| Hashing invite codes at rest | Would prevent the admin from re-reading a code to re-send it — the main reason the Settings panel exists | Codes ever become long-lived, high-value, or numerous |
| Invite-code expiry (`expiresAt`) | `maxUsers` plus single-use already bounds the damage; an expiry column with no UI to set it is dead schema | Codes are handed out far enough ahead of use that staleness matters |
| CSRF tokens | `sameSite=lax` + JSON-only mutating verbs covers the realistic surface | Any mutating `GET` appears, or the app is ever embedded / consumed cross-origin |
| Constant-time login (dummy bcrypt compare for unknown emails) | The timing difference reveals only *whether an email is registered*, in a beta where the admin knows every user | The app opens to self-service signup without invite codes |
| Distributed / persistent rate limiting | The in-process limiter is per-instance and resets on restart. *(Note: this concerns §3.8's login limiter only. The §3.9 LLM cap is already DB-backed and needs nothing here)* | The deploy runs more than one instance, or brute-force attempts actually appear in the logs |
| Per-user view of the activity log (users see **their own** calls) | The admin-only view is the requirement; `llm_call_log.userId` makes this a filter argument, and `/account` is now the obvious page to hang it on. It is also the natural companion to §5.6: a user who is asked to consent to sharing has a fair claim to see what there is to share, and to see what their own calls cost | A user asks "what did my imports cost?", or asks to see what they consented to share |
| Retention / purge policy for `llm_call_log` | The log is append-only and unbounded. With prompt content in it — some of it consented, some not — "we keep everything forever" is a stance that should be chosen rather than defaulted into | The table gets large enough to notice, or the consent model raises the question of how long non-consented content is retained at all |
| Sharing / forking agents between users | Concept build-order #5, unchanged by this plan. `ownerId` is the prerequisite it was waiting for; a share would be a new join table, not a change to `ownerId` | Build-order #5 is picked up |
| Organizations / teams (a group of users owning agents jointly) | `ownerId` currently means "a user". Making it "a principal" is a real remodel | More than one household of friends needs shared agents |
| User self-service: change email, change password, delete account | **A UI surface now exists** — `/account` (§5.7) — and these are exactly what it was designed to grow into; they are deferred on content, not on placement. Each needs more than a form: changing a password should invalidate other sessions (which §14's revocation row says we cannot do yet), and deleting an account raises the orphaned-agent question §8 policy 23 answers manually today | Someone actually needs one — and when they do, the page, its route, its guard, and its test file already exist |
| GDPR-style data export / deletion workflow | No legal obligation for a private closed beta among friends | The app has users who are not friends |
| Agent ownership transfer UI | One `UPDATE`; a UI for it is premature | Users start handing agents to each other regularly |

---

## 15. Deviations from the approved `@analyst` task description

Each was deliberate; items 1–9 were reviewed on 2026-07-30 and **all confirmed**. Items 10–12
are additions made *during* that review — they deviate from the analyst's scope because the
user asked for them, not because the architect chose them.

1. **Ownership is enforced in the repository, not at the route layer** as the task description
   specified. Reasoned in §6.1 (one implementation instead of 13, impossible to forget by
   construction, testable without HTTP mocking — and see §6.1 for why the TOCTOU half of the
   original argument is weaker than it first appeared in this specific runtime).
   **Reconsidered and confirmed at review (§16.6);** it remains the largest deviation.
2. **`ownerId` is a parameter of `upsertAgentFromImport`, not a field on `ImportedAgentData`** —
   a third option neither the analyst nor `@impact` listed (§5.3).
3. **`invite_code` gained a `note` column** (an admin-facing label) beyond the analyst's
   description, so a list of codes is legible. Two lines; drop it if unwanted.
4. **`DELETE /api/settings/invite-codes/[code]`** (revoke an unredeemed code) is a seventh new
   route the analyst did not list. Included because generating a code by mistake is likely and
   the alternative is manual SQL.
5. **`SettingDef` gains optional `min`/`max`**, and `PATCH /api/settings` validates them.
   Without this, `maxUsers` can be set to `0` or `-1` through the documented API, silently
   closing signups in a way that looks like a bug. Six lines.
6. **A minimal in-process rate limiter** on the two public auth routes (§3.8). Not in the
   analyst's scope, added because these become the only endpoints on the public internet
   reachable without a session. **Still the current default, but no longer a settled
   decision** — the keep-or-drop question moved to §14 as an open item (§16.7).
7. **`deleteAgent` returns `boolean`** instead of `void`, so the route can stop doing a
   read-then-delete pair (§6.2).
8. **`instrumentation.ts` is added** to satisfy `@impact`'s "throw at startup, not lazily"
   requirement — a root file the impact report did not anticipate needing.
9. **The migration SQL is hand-authored**, explicitly departing from Plan 04 §4.3's
   never-hand-edit rule. Justified in §4.5; the snapshot and journal remain machine-generated.

**Added during the 2026-07-30 review — new scope, requested by the user:**

10. **Opt-in consent for activity-log content, with a per-row snapshot** (§5.6). The analyst's
    scope had no privacy model at all; the plan's own draft assumed blanket admin visibility.
    Cost: one column on `user`, one on `llm_call_log`, a redaction rule in one repository
    function, and a consent block on the signup form.
11. **A User Settings surface at `/account`, and `/settings` relabelled System Settings**
    (§5.7). Not in the analyst's scope. It exists because item 10 created the first genuinely
    per-person preference; without it, the consent choice would be permanent at signup.
12. **A per-user LLM call cap** (§3.9). Not in the analyst's scope. The analyst's cost controls
    were `liveLlmCalls` (global, all-or-nothing) and `maxUsers` (bounds people, not usage);
    this bounds usage per person, which is the axis the shared API key actually exposes.
    Cost: one setting, one gateway branch, one error type, one block in each of three callers,
    and a two-action prompt in two client components.
13. **The role values are `admin`/`user`, not `operator`/`member`** (§5.2). A naming decision
    made at review; the column name `role` is unchanged, and nothing about the design moved.

---

## 16. Decisions — **all resolved 2026-07-30**

> **Status: closed.** Every one of the eleven points below was walked section-by-section with
> the user on 2026-07-30 and decided. Nine were confirmed as drafted; §16.5 became new design
> work (§5.6); §16.7 was deliberately **not** decided and moved to §14 as an open item. Three
> further changes were raised during the same conversation and are folded in as §5.7 (User
> Settings), §3.9 (per-user LLM cap), and §5.2's terminology rename.
>
> This section is kept as a record of what was asked and what was answered. `@dev` does not
> need to act on it — the decisions are already reflected in the sections it points at.

| # | Question | Decision | Where it now lives |
|---|---|---|---|
| 1 | Bootstrap mechanism | ✅ Confirmed as drafted — separate CLI | §5.1 |
| 2 | Promotion path | ✅ Confirmed — manual SQL only | §5.2 |
| 3 | Import `ownerId` seam | ✅ Confirmed — separate parameter | §5.3 |
| 4 | 401 handling | ✅ Confirmed — hard navigate; modal deferred | §5.4, §14 |
| 5 | Activity-log visibility | 🆕 **New design** — opt-in consent, snapshotted | §5.6 |
| 6 | Ownership enforcement layer | ✅ Reconsidered, confirmed — repository | §6.1 |
| 7 | Login/signup rate limiter | 🔶 **Not decided** — moved to §14 | §14 |
| 8 | `maxUsers` | ✅ Confirmed — already satisfied, no change | §8 policy 18 |
| 9 | Session length | ✅ Confirmed — 7 days, no refresh, no revocation | §3.3 |
| 10 | Invite codes | ✅ Confirmed — plaintext | §4.2 |
| 11 | Layout prototyping | ✅ Waived once for this plan's forms | §11 Phase 4 |

1. **§5.1 — bootstrap mechanism. ✅ Confirmed as drafted:** a separate, manually-invoked
   command (`npm run auth:bootstrap`) reading `BOOTSTRAP_USER_EMAIL` /
   `BOOTSTRAP_USER_PASSWORD` from the environment. Explicitly **not** folded into `seed.ts`.
   The reasoning was made sharper than the draft's: `seed.ts` holds catalog definitions
   (`config_def`, `section_def`, and now the two setting rows) that are *safe to re-run on
   every dev start* because everything it writes is `onConflictDoNothing`; the bootstrap
   command touches a **real password** and should run only on special occasions, explicitly
   invoked. Keeping them structurally separate is what stops the password path from ever
   acquiring `seed.ts`'s "runs constantly" property. Written into §5.1.

2. **§5.2 — promotion path. ✅ Confirmed as drafted:** manual SQL only
   (`UPDATE user SET role='admin' WHERE email=?`). No promotion endpoint, no promotion UI, in
   this plan or implied by it. Recorded in §5.2 and §8 policy 23.

3. **§5.3 — import `ownerId`. ✅ Confirmed as drafted:** `upsertAgentFromImport(ownerId, data)`,
   with `ownerId` sourced from the authenticated session **at the route layer** and never a
   field on `ImportedAgentData`. `lib/import/assemble.ts` and `assembleStructural.ts` stay
   **completely untouched** by this plan. Recorded in §5.3.

4. **§5.4 — 401 handling. ✅ Confirmed as drafted:** `apiFetch()` hard-navigates to
   `/login?next=…` on any 401, discarding unsaved client state. **Plus one addition:** an
   in-place re-login modal that preserves unsaved state (a half-typed chat instruction) was
   explicitly requested as a **future** feature and is now a §14 row, not a rejected
   alternative. `lib/apiFetch.ts` is where it will land.

5. **§16.5 — activity-log visibility. 🆕 Resolved as new design; see §5.6 for the full
   write-up.** In short: consent is **opt-in**, chosen at signup in a cookie-banner-style
   block (prominent and explicit, not a buried checkbox); the user can change it later at
   `/account` (§5.7); each `llm_call_log` row carries `shared_with_admin` **as it was at write
   time** and is never rewritten, which preserves the append-only guarantee (Rules Index
   #45/#46, extended by constraint 11); the admin sees metadata for every row — which agent,
   when, tokens, cost, success or failure — but **prompt and response content are redacted**
   on non-consented rows. The Phase 6.3 disclosure obligation stands and now describes a
   consent model rather than blanket visibility.

6. **§6.1 / §15.1 — ownership enforcement layer. ✅ Reconsidered and confirmed: the repository
   layer**, exactly as originally drafted (§6.1, §6.2). This reaffirms the plan's design over
   the route-layer approach the `@analyst` task description specified. The mechanics do not
   change; what changed is that the *reasoning* is now stated precisely rather than
   generically — see §6.1's expanded rationale. The short version: in this app's synchronous
   `better-sqlite3`, single-process setup the TOCTOU argument is weaker than a generic version
   of it would suggest (no `await` occurs between a route-layer check and the act that follows,
   so no other request can interleave), but the durable and decisive benefit is **structural**
   — a future route handler cannot call a by-id function without supplying `ownerId`, so a
   forgotten check is impossible by construction rather than caught by review or by a test
   suite remembering to cover it.

7. **§3.8 / §15.6 — the login/signup rate limiter. 🔶 Deliberately not decided.** Neither
   "keep it or drop it" nor "disclose it in the login UI" was settled. §3.8's design — 10
   attempts per 15 minutes per (route, IP) — **stays as the current default and fallback,
   because nothing overrides it**, and `@dev` should build it as specified. Both questions are
   now **open rows in §14**, flagged as undecided rather than accepted, to be answered when the
   deployment host's own rate-limiting and TLS-termination behavior is known.

8. **§8 policy 18 — `maxUsers`. ✅ Confirmed; no design change was needed.** The question was
   already satisfied by the plan as drafted: `maxUsers` and the invite codes are DB-backed
   (the `setting` and `invite_code` tables), editable from System Settings, and changing the
   number requires no migration and no deploy. Marked resolved with no edit beyond this note.

9. **§3.3 — session length. ✅ Confirmed as drafted:** 7 days, fixed, **no sliding refresh**,
   **no server-side revocation**. Logging out clears the cookie; the token remains
   cryptographically valid until `exp`. The residual risk and its revisit trigger stay in §9
   and §14.

10. **§4.2 — invite codes. ✅ Confirmed as drafted:** stored in **plaintext**, so the admin can
    re-read a code and send it to someone a second time. The mitigating facts (single-use,
    worthless once redeemed or once `maxUsers` is reached, readable only by someone who already
    has admin access) and the hashing revisit trigger stay in §4.2 and §14.

11. **§11 Phase 4 / standing rule 4 — layout prototyping. ✅ Waived, once.** The login page,
    the signup page, and the invite-code panel — and, by the same reasoning, `/account` and the
    cap-reached prompt added later in the review — are **not** prototyped in
    `architecture/layout/Layout-Workbench.html` first. They are simple forms built from
    existing tokens and existing panel styles, and the mockup's value is in resolving layout
    questions they do not raise. **This is a one-time exception for this plan's surfaces, not
    a change to the standing rule**, which remains in force for anything touching the workbench
    shell. Noted in the header block and at Phase 4.

---

## 17. What the reviewer should sanity-check in this revision

Three judgment calls were made while folding the review in. None blocks the build; each is
cheap to change now and progressively less cheap later.

1. **`/account` as the User Settings route** (§5.7), chosen over `/settings/me` because
   nesting an everyone-page under an admin-only path invites a future layout-level guard to
   lock users out of their own privacy control. If "Account" reads wrong as a label, the
   alternatives are `/profile` or `/me` — a rename now is one folder and one `Link`.
2. **A rolling 60-minute window for the LLM cap** (§3.9), diverging from §3.8's fixed-window
   limiter. The divergence is justified by the different mechanism (a SQL count over stored
   timestamps vs. an in-memory counter) and buys an honest `retryAfterSeconds` and no
   boundary burst. If consistency with §3.8 matters more than either, the change is one
   `WHERE` clause and one test.
3. **The cap-blocked call writes no `llm_call_log` row** (§3.9), unlike a dry-run block, which
   does. The reason is that the log table *is* the counter and denials would inflate it. The
   cost is that a cap event is visible only in the console, not in the activity log. If the
   admin should be able to *see* that someone hit the cap, the fix is a separate counter or a
   distinct `kind` — not counting the row.
