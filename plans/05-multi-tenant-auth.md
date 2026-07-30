# Plan 05 — Multi-Tenant Schema, JWT Auth, Invite-Code Beta Signup

> **Status: 🟡 Written by `@architect` 2026-07-29 — NOT yet reviewed. Needs the user's
> section-by-section walk before any code is written**, same process as Plan 01 and Plan 04
> (see `CHANGELOG.md`'s 2026-07-29 Plan 04 entry). §16 lists what must be confirmed.
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
> session**, **layout prototyped in `architecture/layout/Layout-Workbench.html` first**.

---

## 0. What this plan is, in one paragraph

Every route handler and every repository function in this codebase operates on "all agents"
and "all groups" — there is no concept of *whose* they are. Deploying that outside the local
network would put every beta user's agents in one shared pool. This plan introduces a
`user` table, an `ownerId` column on the two root entities (`agent`, `group`), **ownership
enforcement pushed down into the repository layer** (not scattered across 13 route handlers),
JWT cookie sessions with `jose`, password hashing with `bcryptjs`, a login page, an
invite-code-gated signup page, a `maxUsers` cap reusing Plan 04's `setting` table, and an
operator/member role split that makes `/settings` (the live-LLM toggle, the activity log,
invite-code generation) operator-only. Existing local dev data is migrated onto a bootstrap
operator account so the current single-tenant workflow keeps working unchanged.

**The one behavior that matters most:** after this plan, it must be **impossible to reach
another user's agent or group through any code path** — not merely "every route remembers to
check." That is why the check lives in the repository, where the data lives, rather than in
the layer that maps HTTP (§6).

### Explicitly NOT in this plan

Carried verbatim from the approved `@analyst` scope, plus two additions found during design:

- **Per-tenant / per-user API keys.** One shared server-side Anthropic key stays
  (Design Principle #7). Every user's calls spend the operator's money — this is a closed
  beta for friends, and the `liveLlmCalls` switch plus the `maxUsers` cap are the controls.
- **Email verification, password reset / forgot-password, OAuth / social login.**
- **A full admin dashboard.** Invite-code generation + the bootstrap CLI are the entire
  user-management surface. Deleting a user, changing a role, or transferring agent ownership
  are manual SQL operations, documented in §8.
- **RBAC beyond `operator` vs. `member`.** Two roles, one privileged decision point
  (`/settings` and its routes).
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
   exists. The only `403` in this plan is the operator-only gate on `/settings`, where the
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
9. **`llm_call_log` stays append-only.** It gains one nullable `user_id` column and nothing
   else. Pre-auth rows keep `user_id: null`, meaning "before multi-tenancy" — they are never
   backfilled (same rule as `agentId`, Rules Index #45).
10. **The migration is destructive-by-necessity (`DROP TABLE` during rebuild) and therefore
    gets a mandatory file backup gate.** See §4.5 step 0.

---

## 2. Architecture

### 2.1 Layering

```
middleware.ts (Edge)         ← cookie present + JWT signature/exp valid? No DB. Redirect or 401.
  │                            NOT the authorization boundary (constraint 4).
  ├─ server component (app/**/page.tsx)
  │     └─ requirePageSession()  → redirect('/login?next=…')
  └─ route handler (app/api/**)
        └─ authenticate() / authenticateOperator()  → 401 / 403
              └─ lib/auth/session.ts   ← cookies() → verify JWT → load user row (fresh)
              └─ repository (lib/db/repository/*)
                    ← THE ownership boundary. Every query is owner-scoped.
                    └─ lib/db/client.ts
```

Two independent facts about a request are established in two different places, deliberately:

| Question | Answered by | Mechanism |
|---|---|---|
| *Who is calling?* | `lib/auth/session.ts` | Signed cookie → `sub` claim → fresh `user` row read |
| *May they touch this row?* | `lib/db/repository/*` | `WHERE owner_id = ?` in the same query that fetches it |

Neither can be satisfied by the other, and neither is optional. The second one is what makes
this plan safe to build in the presence of future routes written by someone who has not read
it.

**Why the session read hits the DB on every request.** `getSession()` does one indexed
primary-key lookup on `user` after verifying the token. It does *not* trust role or existence
claims baked into the JWT. This costs sub-millisecond on synchronous `better-sqlite3` and buys
two things a claims-only design cannot have: deleting a user kills their live sessions
immediately, and demoting an operator takes effect on their next request rather than on their
next login. This is the same reasoning Plan 04 §6 used to refuse caching the `liveLlmCalls`
setting — a security control that lags reality reads as unreliable.

### 2.2 Files

| File | New/Modified | Role |
|---|---|---|
| `package.json` | modified | `+jose`, `+bcryptjs`, `+@types/bcryptjs`; `+"auth:bootstrap"` script |
| `.env.example` | modified | `JWT_SECRET`, `BOOTSTRAP_USER_EMAIL`, `BOOTSTRAP_USER_PASSWORD` |
| `lib/env.ts` | modified | `getJwtSecret()` (+ length validation), `assertServerEnv()` |
| `instrumentation.ts` | **new** (root) | Next's startup hook — calls `assertServerEnv()` so a missing/short `JWT_SECRET` fails at boot, not on first login (§3.2) |
| `lib/db/schema.ts` | modified | `user`, `inviteCode` tables; `agent.ownerId`, `group.ownerId`, composite unique indexes; `llmCallLog.userId` |
| `lib/db/migrations/0003_*.sql` + `meta/` | **new** | Generated for the snapshot/journal, **body hand-authored** (§4.5) — the one deliberate exception to Plan 04's "never hand-edit" rule, justified there |
| `lib/auth/constants.ts` | **new** | `BOOTSTRAP_USER_ID`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS`, `BCRYPT_COST`, `NO_PASSWORD_SENTINEL` |
| `lib/auth/jwt.ts` | **new** | `signSessionToken()`, `verifySessionToken()` — `jose`, HS256. Edge-safe: no Node-only imports, no `server-only` |
| `lib/auth/password.ts` | **new** | `hashPassword()`, `verifyPassword()`, `validatePasswordPolicy()`. Node-only, `server-only` |
| `lib/auth/session.ts` | **new** | `getSession()`, `requirePageSession()`. Reads `next/headers` cookies, loads the user row |
| `lib/auth/guard.ts` | **new** | `authenticate()`, `authenticateOperator()` → `{ok:true,session} \| {ok:false,response}` |
| `lib/auth/inviteCode.ts` | **new** | `generateInviteCode()`, `normalizeInviteCode()` |
| `lib/auth/rateLimit.ts` | **new** | In-process fixed-window limiter for the two public auth routes (§3.8) |
| `middleware.ts` | **new** (root) | Coarse gate; public-path allowlist; `/api/*` → 401 JSON, pages → redirect |
| `lib/db/repository/users.ts` | **new** | Users + invite codes. `createUserWithInvite()` is the one transactional signup primitive |
| `lib/db/repository/agents.ts` | modified | 9 functions owner-scoped (§6.2) |
| `lib/db/repository/groups.ts` | modified | 5 functions owner-scoped (§6.2) |
| `lib/db/repository/llmCallLog.ts` | modified | `userId` on write input, list DTO, and as an optional filter |
| `lib/db/repository/index.ts` | modified | Barrel |
| `lib/db/seed.ts` | modified | Seeds `maxUsers` with `onConflictDoNothing` (Rules Index #47's rule applies). **Does not create users.** |
| `scripts/bootstrap-user.ts` | **new** | `npm run auth:bootstrap` — sets the bootstrap operator's email + password (§5.1) |
| `lib/settings.ts` | modified | `maxUsers` entry; `SettingDef` gains optional `min`/`max` |
| `app/api/settings/route.ts` | modified | `authenticateOperator()` on GET and PATCH; `min`/`max` validation |
| `app/api/llm-call-log/route.ts`, `[id]/route.ts` | modified | `authenticateOperator()` |
| `app/api/settings/invite-codes/route.ts` | **new** | `GET` list, `POST` generate — operator-only |
| `app/api/settings/invite-codes/[code]/route.ts` | **new** | `DELETE` revoke an unredeemed code — operator-only |
| `app/api/auth/login/route.ts` | **new** | `POST` — email+password → cookie |
| `app/api/auth/signup/route.ts` | **new** | `POST` — invite code + email + password → user + cookie |
| `app/api/auth/logout/route.ts` | **new** | `POST` — clears the cookie |
| `app/api/agents/route.ts` | modified | `authenticate()`; `listAgents(ownerId)` / `createAgent(ownerId, …)` |
| `app/api/agents/[id]/route.ts` | modified | `authenticate()`; owner-scoped GET/PATCH/DELETE |
| `app/api/agents/[id]/sections/[sectionId]/route.ts` | modified | `authenticate()`; **the confirmed `[id]`-ignored bug is fixed here** (§6.4) |
| `app/api/agents/[id]/export/route.ts` | modified | `authenticate()`; owner-scoped |
| `app/api/agents/[id]/groups/route.ts`, `[groupId]/route.ts` | modified | `authenticate()`; owner-scoped membership |
| `app/api/agents/import/route.ts` | modified | `authenticate()`; `upsertAgentFromImport(ownerId, …)`; `ctx.userId` |
| `app/api/groups/route.ts`, `[id]/route.ts` | modified | `authenticate()`; owner-scoped |
| `app/api/chat/route.ts` | modified | `authenticate()`; owner-scoped agent load; `ctx.userId` |
| `lib/ai/gateway.ts` | modified | `LlmCallContext.userId?: string \| null` → written to the log row |
| `lib/ai/importConverter.ts`, `structuralConverter.ts`, `chatMediator.ts` | *(unchanged)* | They pass `ctx` straight through — adding a field to the type touches nothing here |
| `scripts/test-structural-import.ts` | modified | One line: `userId: null` in its `ctx` literal |
| `app/page.tsx` | modified | `requirePageSession()`; `listAgents(session.userId)` |
| `app/agents/[id]/page.tsx` | modified | `requirePageSession()`; owner-scoped loads; passes `session` down |
| `app/settings/page.tsx` | modified | `requirePageSession()` + operator check → `redirect('/')` |
| `app/login/page.tsx`, `app/signup/page.tsx` | **new** | Client forms |
| `app/components/shell/Topbar.tsx` | modified | Takes a `session` prop; shows email + Logout; `⚙ Settings` only for operators |
| `app/components/WorkbenchShell.tsx` | modified | Threads `session` to `Topbar` |
| `app/components/Settings/SettingsView.tsx` | modified | `maxUsers` field + the invite-code panel |
| `lib/apiFetch.ts` | **new** | Client-side `fetch` wrapper: on `401`, hard-navigate to `/login?next=…` (§5.4) |
| 9 client components (14 call sites) | modified | Swap bare `fetch` → `apiFetch` (§5.4) |
| `lib/db/__tests__/test-users.ts` | **new** | `createTestUser(role?)` — used by every existing suite |
| tests | many modified, 8 new | §10 |

---

## 3. The auth subsystem

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
export type Session = { userId: string; email: string; role: 'operator' | 'member' };

getSession(): Promise<Session | null>
  cookies() → token → verifySessionToken() → getUserById(sub) → Session
  returns null on: no cookie · bad signature · expired · user row gone

requirePageSession(nextPath: string): Promise<Session>
  getSession() ?? redirect(`/login?next=${encodeURIComponent(nextPath)}`)
```

`getSession()` is the **single seam** the route tests mock (§10.2) — nothing else in the
codebase reads `next/headers`.

### 3.5 `lib/auth/guard.ts` — the route-handler shape

Deliberately a plain function returning a discriminated union rather than a higher-order
`withAuth(handler)` wrapper. Reasons: it matches this codebase's uniformly explicit,
non-HOF route style; it keeps the handler's own signature intact (the tests import and call
handlers directly, `agents.test.ts` line 35); and the `if (!auth.ok) return auth.response;`
line is visible in a diff, whereas a missing decorator is invisible.

```
const auth = await authenticate();            // or authenticateOperator()
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
a ≤ 10-user beta. §16.7 offers dropping it.

---

## 4. Data model

### 4.1 New entity: `user`

```ts
export const user = sqliteTable('user', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),          // stored lowercased + trimmed
  passwordHash: text('password_hash').notNull(),    // '' = sentinel, see §3.7
  role: text('role', { enum: ['operator', 'member'] }).notNull().default('member'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});
```

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text uuid | PK | Referenced by `agent.ownerId`, `group.ownerId`, `invite_code.createdBy`/`redeemedBy`, `llm_call_log.userId` — all **soft references**, matching every other cross-table link in this schema (`schema.ts` header comment). |
| `email` | text | not null, unique index | The login identifier. **Normalized to lowercase + trimmed before both storage and lookup** — otherwise `Bob@x.com` and `bob@x.com` are two accounts and the unique index does not stop it (SQLite's default collation is case-sensitive). |
| `passwordHash` | text | not null | bcrypt hash, or `''` for the un-activated bootstrap row. |
| `role` | text | not null, default `'member'` | Drizzle's `enum` on a SQLite `text` column is **TypeScript-only — no `CHECK` constraint is generated** (Plan 04 §4.2 established this for `kind`). Adding a third role later needs no migration. |
| `createdAt` | int timestamp | not null, default now | |

- **Lifecycle:** created by the migration (bootstrap only) or by signup. Never deleted by the
  application — there is no delete-user endpoint in scope. Manual deletion is documented in
  §8 including its consequence (orphaned agents).
- **No `updatedAt`.** Nothing about a user row changes after creation except
  `passwordHash` via the bootstrap CLI, which prints what it did.

### 4.2 New entity: `invite_code`

```ts
export const inviteCode = sqliteTable('invite_code', {
  code: text('code').primaryKey(),                  // canonical 'XXXX-XXXX-XXXX-XXXX'
  note: text('note'),                               // optional operator label ("for Alice")
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
| `note` | Optional free text the operator sets when generating, so a list of codes is legible. Rendered as a React text node, never HTML. |
| `redeemedBy` / `redeemedAt` | Both null or both set. Set atomically inside the signup transaction (§4.4). |

**Codes are stored in plaintext, not hashed.** This is a deliberate, stated tradeoff: the
operator must be able to *re-read* a code in Settings to send it to a friend a second time,
which hashing makes impossible. The mitigating facts: a code is single-use, worthless once
redeemed, worthless once `maxUsers` is reached, only grants "may create an account", and is
only readable by someone who already has operator DB or session access. Revisit trigger in §14.

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

**`llm_call_log`** — one nullable column, exactly as Plan 04 §13 promised:

```ts
  userId: text('user_id'),        // soft ref → user.id; NULL = pre-auth row
```

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
  email: string;          // already normalized
  passwordHash: string;   // already hashed — constraint 5
  code: string;           // already normalized
  maxUsers: number;       // read from settings by the caller
}): { ok: true; user: UserRow }
 | { ok: false; reason: 'invalid_code' | 'email_exists' | 'cap_reached' }
```

Everything below happens inside **one** synchronous `db.transaction()`:

1. `SELECT` the invite code. Absent, or `redeemedBy IS NOT NULL` → `invalid_code`.
2. `SELECT COUNT(*) FROM user`. `>= maxUsers` → `cap_reached`.
3. `SELECT` user by email → exists → `email_exists`.
4. `INSERT` the user (`role: 'member'`, always — signup can never mint an operator).
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
  `role` text DEFAULT 'member' NOT NULL,
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

-- 3 ── bootstrap owner, created ONLY if there is legacy data needing an owner.
--      password_hash '' is the "no password set" sentinel (§3.7); SQL cannot hash.
INSERT INTO `user` (`id`,`email`,`password_hash`,`role`,`created_at`)
SELECT '00000000-0000-4000-8000-00000000b007','bootstrap@localhost','','operator',unixepoch()
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
- **`llm_call_log` needs no rebuild** — nullable add only.
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
group belongs to the bootstrap operator, whose password is unset until
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
  conditional) → `INSERT` it with `role: 'operator'`.
- Prints the resulting email and role. **Never** prints the password or the hash.

| Option | Verdict |
|---|---|
| Env vars read by `lib/db/seed.ts` (which already runs on `predev`/`prebuild`) | **Rejected.** `seed.ts` runs on *every* `npm run dev`. The password would have to live permanently in `.env.local`, and any edit to it would silently reset the operator's password on the next dev start — precisely the class of bug Rules Index #47 exists to prevent for `setting`. |
| Interactive CLI prompt | **Rejected as the primary mechanism.** It cannot run unattended on a host's build/release step, which is exactly where this needs to work for the "going online" goal. |
| One-time HTTP setup endpoint (`POST /api/setup`, disables itself after first use) | **Rejected.** It is a publicly reachable, unauthenticated account-creation endpoint whose safety depends entirely on a self-disable flag being correct. If the flag is ever wrong — a restored backup, a fresh DB on a redeploy, an ordering bug — anyone who finds the URL becomes the operator. Not worth it to avoid one CLI command. |
| **Dedicated idempotent CLI reading env vars** | **Chosen.** Works headless; runs exactly when invoked; refuses to clobber an existing password by default; the plaintext only needs to exist for the duration of one shell command (`BOOTSTRAP_USER_PASSWORD='…' npm run auth:bootstrap`); adds zero public attack surface. |

Confirmation point in §16.1 (this is the kind of thing an operator has a legitimate preference
about).

### 5.2 Operator distinction → **a `role` column on `user`**

| Option | Verdict |
|---|---|
| `OPERATOR_EMAIL` env var, compared per request | **Rejected.** The user row must be loaded anyway, so it saves nothing; it breaks the moment the operator changes their email; and it puts an authorization fact in a place no query can join against (e.g. "list all operators"). |
| `isAdmin` boolean | **Rejected.** A boolean is a role enum that cannot grow. A third role (a read-only auditor, a per-user log view) would need a migration. |
| **`role text not null default 'member'`, values `'operator' \| 'member'`** | **Chosen.** One source of truth, in the same row as identity, read on the same query. Drizzle's `enum` is TS-only for SQLite text, so adding a value later is a code change with no migration (Plan 04 §4.2's precedent). |

Rules: the bootstrap user is `'operator'`. **Signup always writes `'member'`, unconditionally,
with no code path that accepts a role from a request body** (§8 invariant 6). There is no
role-change endpoint in scope — promoting a second operator is
`UPDATE user SET role='operator' WHERE email='…'`, documented in §8. Confirmation point §16.2.

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
— worth noting, since they are the most heavily fixture-tested code in the repo. Confirmation
point §16.3.

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

The hard navigation discards unsaved client state (a half-typed chat instruction). Accepted:
it only happens when the session is already dead, and the alternative — an in-place modal
re-login — is a materially larger feature. Confirmation point §16.4.

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
| TOCTOU window between "check" and "use" | Real, if small | **None** — the check *is* the query |
| Cost | 13 route diffs | 14 signature changes + 13 route diffs |

The TOCTOU point is the decisive one: a route-level `if (agent.ownerId !== me) return 404`
followed by `deleteAgent(id)` performs two queries and trusts that nothing changed between
them. `deleteAgent(id, ownerId)` with `WHERE id = ? AND owner_id = ?` is a single atomic
statement that cannot be wrong.

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

`lib/db/repository/llmCallLog.ts`: `WriteCallLogInput` gains `userId?: string | null`;
`CallLogListItem` and `CallLogFull` gain `userId: string | null`; `ListCallLogsOptions` gains
an optional `userId` filter (unused by the operator view today — present so a per-user view is
a filter argument, not a rewrite).

`lib/db/repository/users.ts` (new): `getUserById`, `getUserByEmail`, `getUserCount`,
`setUserPassword`, `createUserWithInvite` (§4.4), `createInviteCode`, `listInviteCodes`,
`revokeInviteCode`.

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

`LlmCallContext` gains `userId?: string | null`, set from the session by the three routes that
build it (`/api/chat`, and both pipelines in `/api/agents/import`) and written into the log row
by `lib/ai/gateway.ts`. The three callers pass `ctx` through untouched, so
`importConverter.ts` / `structuralConverter.ts` / `chatMediator.ts` need **no edits at all**.
`scripts/test-structural-import.ts` gets `userId: null` — it runs outside any request.

---

## 7. API surface

### 7.1 Endpoints

**New:**

| Method | Path | Auth | Request | Response | Errors | Side effects |
|---|---|---|---|---|---|---|
| `POST` | `/api/auth/login` | public | `{ email, password }` | `200 { user: { id, email, role } }` + `Set-Cookie` | `400 invalid_body`; `401 invalid_credentials`; `429 rate_limited` | none |
| `POST` | `/api/auth/signup` | public | `{ inviteCode, email, password }` | `201 { user }` + `Set-Cookie` | `400 invalid_body \| invalid_email \| weak_password \| password_too_long \| invalid_invite_code`; `409 email_exists`; `403 signups_closed`; `429 rate_limited` | Creates a `user`; marks the code redeemed |
| `POST` | `/api/auth/logout` | any session (also succeeds with none) | – | `204` + cookie cleared | – | none |
| `GET` | `/api/settings/invite-codes` | **operator** | – | `200 { codes: [{ code, note, createdAt, redeemedByEmail \| null, redeemedAt }] }` | `401`, `403` | none |
| `POST` | `/api/settings/invite-codes` | **operator** | `{ note?: string }` | `201 { code, note, createdAt }` | `400 invalid_body`; `401`; `403`; `500 code_generation_failed` | Inserts one `invite_code` |
| `DELETE` | `/api/settings/invite-codes/[code]` | **operator** | – | `204` | `401`; `403`; `404 not_found`; `409 already_redeemed` | Deletes one unredeemed row |

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
| `/api/agents/import` | POST | `authenticate()` | `401` |
| `/api/groups` | GET, POST | `authenticate()` | `401`; `409 name_exists` is now **per-owner** |
| `/api/groups/[id]` | DELETE | `authenticate()` | `401`; `404` also means "not yours" |
| `/api/chat` | POST | `authenticate()` | `401`; `404` also means "not yours" |
| `/api/settings` | GET, PATCH | **`authenticateOperator()`** | `401`, `403` |
| `/api/llm-call-log` | GET | **`authenticateOperator()`** | `401`, `403` |
| `/api/llm-call-log/[id]` | GET | **`authenticateOperator()`** | `401`, `403` |

**Backward compatibility.** Every success shape and every existing error code is unchanged.
The only new outcomes on existing endpoints are `401`, `403` (three routes), and a *wider
meaning* for the existing `404`. The sole consumers are this app's own components, all of
which are updated in the same plan — no versioning is warranted. **`GET /api/agents` returning
only your own agents is not a compatibility break; it is the entire feature.**

### 7.2 Pages

| Path | Access |
|---|---|
| `/login`, `/signup` | Public. Middleware bounces an already-authenticated visitor to `/`. |
| `/`, `/agents/[id]` | Any session. `requirePageSession()` → redirect to `/login?next=…`. |
| `/settings` | Operator only. Non-operator session → `redirect('/')`. Not a 404: the route's existence is not a secret, and a silent redirect is friendlier than a lie. |

### 7.3 Error handling

| Scenario | HTTP | Response shape | Logged? |
|---|---|---|---|
| No cookie / bad signature / expired, on `/api/*` | **401** | `{ error: 'unauthorized' }` | no — routine |
| Same, on a page | **307** | redirect `/login?next=…` | no |
| Valid session, non-operator, operator-only route | **403** | `{ error: 'forbidden' }` | **yes**, `[auth] forbidden <userId> <path>` — a member hitting an operator route is either a bug or probing |
| **Authenticated, resource belongs to someone else** | **404** | `{ error: 'not_found' }` | **yes**, `[auth] cross-owner access attempt <userId> <resource>` — indistinguishable to the client, fully visible to the operator |
| Resource genuinely absent | **404** | `{ error: 'not_found' }` | no |
| Bad login credentials | **401** | `{ error: 'invalid_credentials' }` | **yes**, `[auth] failed login <email>` — needed to notice a brute-force attempt |
| Login against the `''` sentinel hash | **401** | `{ error: 'invalid_credentials' }` (identical) | **yes**, `[auth] login attempted on user with no password set` |
| Unknown / already-redeemed / malformed invite code | **400** | `{ error: 'invalid_invite_code' }` — **one code for all three** | **yes** |
| Email already registered (signup) | **409** | `{ error: 'email_exists' }` | no |
| `maxUsers` reached | **403** | `{ error: 'signups_closed' }` | **yes** |
| Password < 12 chars | **400** | `{ error: 'weak_password', minLength: 12 }` | no |
| Password > 72 bytes | **400** | `{ error: 'password_too_long', maxBytes: 72 }` | no |
| Rate limit exceeded | **429** | `{ error: 'rate_limited', retryAfterSeconds }` + `Retry-After` header | **yes** |
| `maxUsers` set below 1 via PATCH | **400** | `{ error: 'invalid_setting_value', key, datatype, min: 1 }` | no |
| Unexpected server error | **500** | `{ error: 'internal' }` | **yes** — never including a password, hash, token, or secret |

**Why `404` and not `403` for cross-owner access** (constraint 3): a `403` is a confirmation
that the id exists. Iterating ids against a `403`/`404` split enumerates every agent in the
system. The two cases are made indistinguishable *at the response*, and distinguishable *in
the operator's server log*, which is exactly the right split of who learns what.

**Why the invite-code failure modes collapse into one message:** distinguishing "no such code"
from "already used" tells an attacker when they have found a real code. There is no legitimate
user need for the distinction — in both cases the answer is "ask the operator for a code."

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
6. Signup writes `role: 'member'` unconditionally. No request body field can influence role.
7. Cross-owner denial is always `404` with an identical body to a genuine miss, and is always
   logged server-side.
8. No plaintext password, password hash, session token, or `JWT_SECRET` appears in any
   response body, console line, `llm_call_log` payload, or error message.
9. A `user` row with `passwordHash === ''` can never authenticate; login rejects it before
   invoking bcrypt.
10. `middleware.ts` performs no database access of any kind (it cannot — Edge runtime).
11. `llm_call_log` remains append-only; `user_id` is set at write time or is null forever
    (Rules Index #45/#46 extended).
12. An invite code transitions `unused → redeemed` exactly once, enforced by
    `UPDATE … WHERE code = ? AND redeemed_by IS NULL` inside the signup transaction.

### Policies (configurable / catalog-driven)

13. `maxUsers` — a `SETTING_DEFS` entry, `datatype: 'int'`, **default `5`**, `min: 1`.
    Checked **at signup only**, against `getUserCount()`, inside the signup transaction.
    Lowering it below the current user count never removes anyone; it only blocks new signups.
    **The operator counts toward the cap** (it is a count of `user` rows, not of "guests") —
    simpler to reason about, and stated in the setting's `hint` text so it is not a surprise.
14. Session lifetime is 7 days, fixed, no refresh. Logging out clears the cookie; it does not
    invalidate the token server-side (§9, §14).
15. Rate limit: 10 attempts / 15 min / (route, IP) on `/api/auth/login` and `/api/auth/signup`.
16. Invite codes do not expire and are unlimited in number. `maxUsers` is the cap that
    matters; an unredeemed code is inert once the cap is reached.
17. The operator sees **all** rows in the activity log, including other users' prompts and
    agent content, because `/settings` is operator-only and the log's purpose is auditing the
    single shared API key the operator pays for. `llm_call_log.userId` makes a per-user filter
    a one-argument change later. **This must be disclosed to beta users** — noted as a
    non-code deliverable in Phase 6 and raised for confirmation in §16.5.
18. Manual operations with no UI, documented in `docs/user-guide.md` and `README.md`:
    promote an operator (`UPDATE user SET role='operator' WHERE email=?`); delete a user
    (delete their `agent`/`group` rows first, or they become unreachable orphans — nothing
    cascades, by design); transfer ownership (`UPDATE agent SET owner_id=?`).

### State transitions (sequences)

19. **Signup:** validate body → normalize email + code → policy-check the password → **hash
    (outside any transaction)** → `createUserWithInvite()` (atomic: code check → cap check →
    email check → insert user → redeem code) → sign JWT → `Set-Cookie` → `201`.
20. **Login:** rate-limit → normalize email → load user → reject empty-sentinel hash →
    `bcrypt.compare` → sign JWT → `Set-Cookie` → `200`. A missing user and a wrong password
    produce the identical `401`. *(A user-enumeration timing difference remains — a missing
    user skips the ~200 ms bcrypt compare. Accepted for a closed beta; §14 records the
    dummy-hash mitigation and its trigger.)*
21. **Logout:** clear the cookie → `204`. The token remains cryptographically valid until
    `exp`; there is no server-side revocation (§9).
22. **Any request:** middleware (signature + expiry, no DB) → handler `authenticate()`
    (cookie → verify → **fresh user row**) → repository (`WHERE owner_id = ?`). Three
    independent gates; only the last two are authoritative.
23. **Migration/bootstrap:** back up the DB file → `migrate()` creates the bootstrap operator
    with no password and assigns all legacy rows to it → app is fully locked out (correct) →
    `npm run auth:bootstrap` sets email + password → operator logs in → generates invite codes
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
- **Security.**
  - Secrets: `JWT_SECRET` ≥ 32 chars, validated at startup (§3.2); never logged.
  - Passwords: bcrypt cost 10; 72-byte cap enforced rather than silently truncated.
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
  either PK or covered by the new owner indexes. The one thing that would degrade is the
  in-process rate limiter under a multi-instance deploy (§3.8) — which is a correctness
  caveat, not a throughput one.
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
  needs correlating). Existing `[llm-gateway]` / `[llm-log]` / route logging is unchanged.
- **Compliance.** Out of scope; there is no GDPR/data-deletion workflow. Recorded honestly in
  §14 so "we forgot" and "we decided not to yet" stay distinguishable.

---

## 10. Testing approach

Current baseline: **19 test files, 186 tests, all green.** Everything below assumes that
number only goes up.

### 10.1 The "existing suites break" problem — handled, and it is a compile-time problem

Per §5.5 #1, the break is `tsc`, not `beforeAll`. Sequence:

1. Add `lib/db/__tests__/test-users.ts`:
   `createTestUser(role: 'operator'|'member' = 'member'): { id, email, role }` — inserts a row
   into the shared in-memory `testDb` with a unique email, returns it.
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
| `lib/db/__tests__/migration.test.ts` | On a fresh migrated in-memory DB: `agent.owner_id` is `NOT NULL`; `agent_owner_name_unique` and `group_owner_name_unique` exist; `agent_name_unique` is **gone**; two owners may share an agent name; one owner may not; `user`/`invite_code` exist with the expected columns |
| `lib/auth/__tests__/jwt.test.ts` | Round-trip sign→verify; tampered payload → null; expired → null; wrong secret → null; the token contains **no** `role` claim |
| `lib/auth/__tests__/password.test.ts` | hash→verify true; wrong password false; `''` sentinel never verifies; < 12 chars rejected; > 72 bytes rejected (incl. a multi-byte-UTF-8 case that is short in *characters* but long in *bytes*) |
| `lib/auth/__tests__/session.test.ts` | `next/headers` mocked: no cookie → null; valid token + existing user → session with the **DB's** role, not the token's; valid token + deleted user → null; role changed in the DB → the new role on the next call |
| `lib/auth/__tests__/guard.test.ts` | `authenticate` no session → 401 body/status; `authenticateOperator` member → 403; operator → ok |
| `lib/auth/__tests__/inviteCode.test.ts` | Generated format matches `^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$`; excluded characters never appear across 10 000 generations; `normalizeInviteCode` accepts lowercase, missing dashes, and surrounding whitespace, and rejects garbage |
| `lib/db/repository/__tests__/users.test.ts` | `createUserWithInvite` happy path; unknown code; already-redeemed code; `maxUsers` reached; duplicate email; **on every failure path, zero rows are written and the code stays unredeemed**; `getUserCount`; `revokeInviteCode` on a redeemed code fails |
| `app/api/auth/__tests__/auth.test.ts` | login ok / wrong password / unknown email / sentinel-hash user; signup ok / bad code / cap reached / duplicate email / weak / over-long password; logout clears the cookie; the `Set-Cookie` header carries `HttpOnly` and `SameSite=Lax`; rate limiter trips at the 11th attempt |
| `app/api/settings/__tests__/invite-codes.test.ts` | Operator generate/list/revoke; member → 403; unauthenticated → 401; a generated code is single-use end-to-end (generate → signup → second signup with the same code fails) |
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
| `GET /api/settings`, `PATCH /api/settings`, `GET /api/llm-call-log`, `GET /api/llm-call-log/[id]` | 403 (B is a member) |
| all of the above with `getSession → null` | 401 |

Every mutating row asserts **both** the status code and that the target row is byte-identical
afterwards. A `404` returned by a handler that already performed the write would otherwise pass
a status-only assertion.

**`app/api/__tests__/route-guard.test.ts` — a fitness function**, in the spirit of Plan 04
§10.2's one-SDK-importer test. It reads every `route.ts` under `app/api/` and asserts:

- every file outside `app/api/auth/` contains `authenticate(` or `authenticateOperator(`;
- `app/api/settings/**` and `app/api/llm-call-log/**` contain `authenticateOperator(`;
- no `'use client'` file under `app/` calls a bare `fetch('/api/` (they must use `apiFetch`).

~25 lines, no dependency, and it is the only thing that will still be enforcing this in six
months. This project has no ESLint config (roadmap TODO 6), so a test is the available
enforcement mechanism.

### 10.5 Component tests — the same accepted gap, restated

New `app/login/page.tsx` and `app/signup/page.tsx` ship with **no component tests**, consistent
with `plans/roadmap.md` TODO 8 and Plan 04 §10.6. The compensating control is the Phase 5
manual checklist. Two things reduce the risk honestly: the forms are single-purpose and
stateless apart from an error string, and the server-side routes behind them are fully covered
by §10.3. The recommendation to build component-test infrastructure as its own roadmap item
stands and is **strengthened** by this plan — it now applies to a login form, not just a dialog.

### 10.6 What must NOT change

`lib/serialize/__tests__/golden.test.ts`, `lib/import/__tests__/*`, and
`lib/ai/__tests__/gateway.test.ts` should pass **untouched**. They exercise pure functions with
no owner concept. If any of them needs an edit, the retrofit has leaked into a layer it had no
business reaching — treat that as a signal to stop and re-read §6, not as a test to fix.

---

## 11. Implementation sequence

Phases are gated. Every gate includes `npx tsc --noEmit` clean and `npm test` green. Do not
start a phase before its gate predecessor passes.

### Phase 0 — Schema, migration, repository retrofit *(the big one; no auth yet)*

| Step | File | Depends on |
|---|---|---|
| 0.1 | `package.json` — `npm i jose bcryptjs && npm i -D @types/bcryptjs`; add `"auth:bootstrap"` | — |
| 0.2 | `lib/auth/constants.ts` | — |
| 0.3 | `lib/db/schema.ts` — `user`, `inviteCode`; `agent`/`group` `ownerId` + composite unique + owner index; `llmCallLog.userId` (§4.1–4.3) | 0.2 |
| 0.4 | **Back up `myagent.db`**, stop the dev server, generate `0003_*`, hand-author its body (§4.5) | 0.3 |
| 0.5 | `lib/db/__tests__/test-users.ts` + `lib/db/__tests__/migration.test.ts` | 0.4 |
| 0.6 | `lib/db/repository/users.ts` + barrel | 0.4 |
| 0.7 | Owner-scope `agents.ts` (9 fns) and `groups.ts` (5 fns) — **including the three §6.3 security fixes and §6.4** | 0.4 |
| 0.8 | `llmCallLog.ts` `userId`; `lib/ai/gateway.ts` `LlmCallContext.userId`; `scripts/test-structural-import.ts` one line | 0.4 |
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
| 2.1 | `lib/settings.ts` — `maxUsers` entry; `SettingDef.min/max`; `app/api/settings/route.ts` range validation; `lib/db/seed.ts` `maxUsers` with `onConflictDoNothing` |
| 2.2 | `app/api/auth/login/route.ts`, `signup/route.ts`, `logout/route.ts` |
| 2.3 | `app/api/settings/invite-codes/route.ts` + `[code]/route.ts` |
| 2.4 | `app/api/auth/__tests__/auth.test.ts`, `app/api/settings/__tests__/invite-codes.test.ts` |

**Gate 2:** a full generate-code → signup → login → logout cycle passes in tests. Existing
routes are still unauthenticated — deliberately, so Phase 3 is a single reviewable change.

### Phase 3 — Retrofit every existing route, page, and add middleware

| Step | File |
|---|---|
| 3.1 | `middleware.ts` (+ a test if the 1.0 spike said yes) |
| 3.2 | All 10 existing `app/api/**` route files: guard + session + `ownerId`; **delete every Phase-0 scaffold constant** |
| 3.3 | `app/page.tsx`, `app/agents/[id]/page.tsx`, `app/settings/page.tsx` — `requirePageSession()` + the operator check |
| 3.4 | `app/api/__tests__/tenancy.test.ts` (§10.4) |
| 3.5 | `app/api/__tests__/route-guard.test.ts` (§10.4) |
| 3.6 | Add a `getSession → null` ⇒ 401 case to each existing route suite |

**Gate 3:** `grep -rn 'PHASE-0 SCAFFOLD' app lib` returns nothing; the tenancy suite is fully
green; the route-guard fitness test passes.

### Phase 4 — UI

| Step | File |
|---|---|
| 4.1 | `lib/apiFetch.ts`; swap all 14 call sites in the 9 client components |
| 4.2 | `app/login/page.tsx` (incl. the `next` validation, §3.6) |
| 4.3 | `app/signup/page.tsx` |
| 4.4 | `Topbar.tsx` — `session` prop, email, Logout, operator-only `⚙ Settings`; thread through `WorkbenchShell.tsx` and the two other pages that render it |
| 4.5 | `SettingsView.tsx` — the `maxUsers` field and the invite-code panel (generate + copy + list + revoke) |

**Layout note (standing rule 4):** 4.2/4.3/4.5 are new visual surfaces. Prototype the login /
signup shell and the invite-code panel in `architecture/layout/Layout-Workbench.html` before
writing React, unless the review decides these are trivial enough to skip the detour.

**Gate 4:** `tsc` clean; all tests green; no bare `fetch('/api/` remains in a client component.

### Phase 5 — Bootstrap, real migration, manual verification

| Step | Action |
|---|---|
| 5.1 | Dev server **off**. `cp myagent.db myagent.db.bak-<date>` |
| 5.2 | `npm run db:seed` (runs `migrate()` then seeds `maxUsers`) |
| 5.3 | Verify: agent/group counts unchanged; zero `owner_id IS NULL`; the bootstrap user exists with `role='operator'` and an empty hash |
| 5.4 | `BOOTSTRAP_USER_PASSWORD='…' BOOTSTRAP_USER_EMAIL='…' npm run auth:bootstrap` |
| 5.5 | **Manual checklist, dev server + browser, with "Live LLM calls" OFF so the whole pass is free (Plan 04 §10.6's argument applies verbatim):** log in as the operator; see exactly the pre-existing agents; hit `/settings` and generate a code; log out; `/agents/<id>` redirects to `/login`; sign up as a second user with the code; the new account sees **zero** agents; create an agent with the **same name** as one of the operator's — it succeeds; `/settings` as that user redirects to `/`; `GET /api/llm-call-log` as that user returns 403; paste the operator's agent id into the URL — 404; reuse the spent invite code — rejected; set `maxUsers` to the current count and confirm a third signup is refused; delete the session cookie in devtools and click something — the app lands on `/login` with `?next=` preserved and returns to the right page after logging back in |
| 5.6 | **Shut the dev server down** (standing rule 3) |

### Phase 6 — Documentation sync

| Step | File |
|---|---|
| 6.1 | `architecture/TechDesign.md` — data-model entries for `User`/`InviteCode`, `ownerId` on `Agent`/`Group`; Rules Index **#48–#56** (continuing from #47): repository-layer ownership; `ownerId` never optional; 404-not-403; middleware-is-not-the-boundary; hash-outside-transaction; signup-cannot-mint-an-operator; role read fresh from the DB, never from the token; invite codes single-use and stored plaintext; `maxUsers` checked in-transaction at signup. Add §14's rows to Deferred Decisions. Also **remove** the stale "users/auth arrive with hosted mode, out of MVP scope" bullet in *Deferred (not in the data model yet)* |
| 6.2 | `README.md` — new env vars, the bootstrap command, the **HTTPS requirement** for the `secure` cookie |
| 6.3 | `docs/user-guide.md` — signing in, inviting someone, the operator/member distinction, and the §8/17 disclosure that the operator can see all activity-log entries |
| 6.4 | `plans/roadmap.md` — move Plan B into "What's built"; TODO 2 (deploy online) is now unblocked; add §14's deferred items |
| 6.5 | `CHANGELOG.md` + `CLAUDE.md` — an entry and a pointer, in the established shape |
| 6.6 | `lib/ai/CLAUDE.md` — one line: `LlmCallContext` now carries `userId` |

### 11.1 Dependencies and parallelization

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6
                │                                  ▲
                └──── 4.2/4.3 (login+signup UI) ────┘   (may start once Phase 2 lands)
```

- **Phase 0 blocks everything** and is roughly 40 % of the work.
- Phase 4.2/4.3 depend only on Phase 2's routes and can be built in parallel with Phase 3 by a
  second worker; 4.1/4.4/4.5 need Phase 3.
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
| 4 | A client component keeps a bare `fetch` and shows a confusing error on session expiry | The fitness test forbids bare `fetch('/api/` in `'use client'` files |
| 5 | The operator locks themselves out (bad env var, typo'd email) | The bootstrap CLI is idempotent and re-runnable with `--force`; the DB backup allows a full revert; the exact recovery SQL goes in `README.md` |
| all | An accidental real Anthropic call during verification | Standing rule 2; Phase 5.5 is run with "Live LLM calls" **off**, which makes the entire manual pass free |

### 11.3 Complexity — confirming `@impact`'s estimate

**Confirmed High**, with a sharper framing. `@impact` said "comparable to Plans 01–03
combined." The *conceptual* surface is smaller than Plan 01 (no new domain model, no AI
behavior, no serialization contract), but the **blast radius is the largest of any plan so
far**: 2 new tables, 3 altered (one with a destructive rebuild against real data), 14
repository functions re-signed and 8 added, 13 route handlers retrofitted and 6 added, 3 server
components, 9 client components, 8 of 19 existing test suites edited, 10 test files added, and
2 new runtime dependencies. Phase 0 alone is bigger than all of Plan 04. Sequencing it so that
Phase 0 lands with the app still fully working (via the scaffold constant) is the single most
important scheduling decision in this plan.

---

## 12. Impact-report unknown / risk → resolution map

| # | Item | Resolved in |
|---|---|---|
| 1 | Bootstrap credentials mechanism | §5.1 — idempotent CLI; three alternatives rejected with reasons; §16.1 |
| 2 | Operator-distinction mechanism | §5.2 — `user.role`; §16.2 |
| 3 | Plan A's `setting` table shape | **Moot** — Plan A shipped; the real `setting`/`SETTING_DEFS`/`PATCH` allowlist were read directly. `maxUsers` is one appended `SETTING_DEFS` entry, exactly as Plan 04 §13 promised: no migration, no route change beyond the new operator guard and the `min` bound |
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

---

## 13. Plan 04 interaction — obligations inherited and discharged

| Plan 04 §13 promise | Status in this plan |
|---|---|
| `setting.maxUsers` as a data row, no migration | ✅ One `SETTING_DEFS` entry (§8 policy 13). The promise held exactly |
| `ALTER TABLE llm_call_log ADD COLUMN user_id TEXT` is one line | ✅ §4.5 step 2. `listCallLogs` already selects explicit columns, so the new column could not leak into the list DTO — it is added **deliberately** instead |
| "`/api/settings` and `/api/llm-call-log` must be in Plan B's first auth pass" | ✅ Both are operator-only (§7.1). `GET /api/llm-call-log/[id]`, which returns full prompts and agent bodies, is the most sensitive endpoint in the app and is now the most restricted |
| `setting` stays global/operator scope | ✅ Constraint 8; no `ownerId` on `setting` |
| One shared API key | ✅ Unchanged; per-tenant keys explicitly out of scope |
| Rules Index #45/#46 (append-only log, never backfilled) | ✅ Extended verbatim to `user_id` (§8 invariant 11) |
| Rules Index #47 (`onConflictDoNothing` for operator-owned seed rows) | ✅ Applied to `maxUsers`; **and this plan deliberately does not seed any `user` row** — user creation never happens on `predev` |

---

## 14. Deferred decisions (this plan's additions to `TechDesign.md`'s table)

| Item | Why deferred | Revisit when |
|---|---|---|
| Server-side session revocation (a token version column or a session table) | Requires a per-request read of a revocation source and a policy for what invalidates what. A 7-day JWT among ≤ 10 known friends does not justify it | A password reset flow exists, a user must be removable immediately, or the beta stops being closed |
| Sliding session refresh / "remember me" | A fixed 7-day window is one state to reason about; a refresh path is three | Users complain about re-logging-in, or the TTL is shortened for security reasons |
| Password reset / forgot-password | Needs an email transport, which the app does not have and which is its own infrastructure decision | Any beta user actually forgets a password (operator-side reset via the bootstrap CLI is the interim answer) |
| Argon2id instead of bcrypt | bcrypt's 72-byte cap and pure-JS slowness are real but adequate here; argon2 needs a native build | The native-dependency constraint disappears (a Docker image, a Linux-only host) — the hash format is prefix-tagged, so a lazy rehash-on-login migration is straightforward |
| Hashing invite codes at rest | Would prevent the operator from re-reading a code to re-send it — the main reason the Settings panel exists | Codes ever become long-lived, high-value, or numerous |
| Invite-code expiry (`expiresAt`) | `maxUsers` plus single-use already bounds the damage; an expiry column with no UI to set it is dead schema | Codes are handed out far enough ahead of use that staleness matters |
| CSRF tokens | `sameSite=lax` + JSON-only mutating verbs covers the realistic surface | Any mutating `GET` appears, or the app is ever embedded / consumed cross-origin |
| Constant-time login (dummy bcrypt compare for unknown emails) | The timing difference reveals only *whether an email is registered*, in a beta where the operator knows every member | The app opens to self-service signup without invite codes |
| Distributed / persistent rate limiting | The in-process limiter is per-instance and resets on restart | The deploy runs more than one instance, or brute-force attempts actually appear in the logs |
| Per-user view of the activity log (members see their own calls) | The operator-only view is the requirement; `llm_call_log.userId` makes this a filter argument | A member asks "what did my imports cost?" or the operator wants to stop seeing others' prompts |
| Sharing / forking agents between users | Concept build-order #5, unchanged by this plan. `ownerId` is the prerequisite it was waiting for; a share would be a new join table, not a change to `ownerId` | Build-order #5 is picked up |
| Organizations / teams (a group of users owning agents jointly) | `ownerId` currently means "a user". Making it "a principal" is a real remodel | More than one household of friends needs shared agents |
| User self-service: change email, change password, delete account | No UI surface exists for account management at all; §8 policy 18's manual SQL is the honest interim | Someone actually needs one |
| GDPR-style data export / deletion workflow | No legal obligation for a private closed beta among friends | The app has users who are not friends |
| Agent ownership transfer UI | One `UPDATE`; a UI for it is premature | Users start handing agents to each other regularly |

---

## 15. Deviations from the approved `@analyst` task description

Each is deliberate and revertable during review:

1. **Ownership is enforced in the repository, not at the route layer** as the task description
   specified. Reasoned in §6.1 (TOCTOU, one implementation instead of 13, testable without
   HTTP mocking). This is the largest deviation in the plan and the one most worth pushing back
   on if the reasoning does not land. §16.6.
2. **`ownerId` is a parameter of `upsertAgentFromImport`, not a field on `ImportedAgentData`** —
   a third option neither the analyst nor `@impact` listed (§5.3).
3. **`invite_code` gained a `note` column** (an operator-facing label) beyond the analyst's
   description, so a list of codes is legible. Two lines; drop it if unwanted.
4. **`DELETE /api/settings/invite-codes/[code]`** (revoke an unredeemed code) is a seventh new
   route the analyst did not list. Included because generating a code by mistake is likely and
   the alternative is manual SQL.
5. **`SettingDef` gains optional `min`/`max`**, and `PATCH /api/settings` validates them.
   Without this, `maxUsers` can be set to `0` or `-1` through the documented API, silently
   closing signups in a way that looks like a bug. Six lines.
6. **A minimal in-process rate limiter** on the two public auth routes (§3.8). Not in the
   analyst's scope, added because these become the only endpoints on the public internet
   reachable without a session. §16.7 offers dropping it.
7. **`deleteAgent` returns `boolean`** instead of `void`, so the route can stop doing a
   read-then-delete pair (§6.2).
8. **`instrumentation.ts` is added** to satisfy `@impact`'s "throw at startup, not lazily"
   requirement — a root file the impact report did not anticipate needing.
9. **The migration SQL is hand-authored**, explicitly departing from Plan 04 §4.3's
   never-hand-edit rule. Justified in §4.5; the snapshot and journal remain machine-generated.

---

## 16. Decisions needed before build starts

Everything the impact report raised is resolved above; nothing is left open by omission. What
follows are the points where a different call is genuinely defensible and the user's preference
should decide.

1. **§5.1 — the bootstrap mechanism: an idempotent CLI (`npm run auth:bootstrap`) reading
   `BOOTSTRAP_USER_EMAIL` / `BOOTSTRAP_USER_PASSWORD`.** The alternatives (env vars consumed by
   `seed.ts`, an interactive prompt, a one-time HTTP setup endpoint) are each rejected with a
   reason in §5.1. If the eventual host makes running a one-off command awkward, say so now —
   it changes the shape of Phase 5.

2. **§5.2 — operator distinction via a `role` column on `user`**, with no API to change it
   (promotion is manual SQL). Confirm both halves: the column *and* the absence of a
   role-management endpoint.

3. **§5.3 — `upsertAgentFromImport(ownerId, data)` rather than `ownerId` on
   `ImportedAgentData`.** This keeps the two import assemblers and their fixture tests entirely
   untouched. The alternative the analyst implied (assemblers emit `ownerId`) is defensible if
   you would rather the import path carry one complete object end-to-end.

4. **§5.4 — 401 handling via a shared `apiFetch()` that hard-navigates to `/login?next=…`.**
   This discards unsaved client state (a half-typed chat instruction) when a session expires.
   The alternative is an in-place re-login modal, which is materially more work and is not in
   this plan.

5. **§8 policy 17 — the operator can read every user's prompts and agent content** in the
   activity log, because `/settings` is operator-only and there is one shared API key. This is
   a real privacy position, not just a technical default. Confirm it, and confirm that
   disclosing it to beta users (Phase 6.3) is the right handling. The alternative — members see
   only their own rows, operator sees only aggregates — is a filter argument away, but changes
   what the operator can debug.

6. **§6.1 / §15.1 — enforcing ownership in the repository rather than at the route layer**,
   which is the one place this plan contradicts the approved task description. The cost is 14
   changed signatures; the benefit is that a future route cannot forget. If you would rather
   keep the repository signatures stable and take the route-layer approach the analyst
   described, that is the single biggest structural fork in this plan and now is the moment.

7. **§3.8 / §15.6 — the in-process rate limiter on login/signup.** Small, imperfect (per-process,
   spoofable `x-forwarded-for`), and not in the approved scope. Keep it or drop it.

8. **§8 policy 13 — `maxUsers` default of `5`, and the operator counting toward it.** Both are
   arbitrary product calls. How many friends is "a small number"?

9. **§3.3 — a 7-day session with no refresh and no server-side revocation** (logging out clears
   the cookie but does not kill the token). Standard for this size of deployment; confirm you
   are comfortable with it rather than a shorter TTL.

10. **§4.2 — invite codes stored in plaintext** so the operator can re-read and re-send one.
    Confirm the tradeoff, or accept that a code is write-once-and-copy-immediately.

11. **§11 Phase 4 / standing rule 4 — whether the login page, signup page, and invite-code panel
    are prototyped in `architecture/layout/Layout-Workbench.html` first.** They are new visual
    surfaces, so the rule says yes; they are also simple enough that the detour may be waste.
    Your call.
