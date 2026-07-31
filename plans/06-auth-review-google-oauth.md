# Plan 06 — Auth Framework Review: Middleware Fix, Configurable Session TTL, Google OAuth/OIDC

> **Status: 🟢 Reviewed 2026-07-31 — all six §16 decision points resolved; ready for `@dev`.**
> Written by `@architect` 2026-07-31 and walked with the user the same day (same process as
> Plans 01, 04, and 05). §16 now records each decision rather than asking for it. **No code
> has been written or edited yet — this document is the specification, not a build record.**
>
> **What the review changed.** Four of the six points were confirmed as proposed. Two changed
> the design:
>
> | Change | Where |
> |---|---|
> | The `oauthAutoLinkVerifiedEmail` admin setting is **declined** — auto-linking is hardcoded `true`, a plain `if`. No `SETTING_DEFS` row, no toggle, no `oauth_link_required` error code | §5.3 (rewritten as the rejected-option record), §3.7, §6, §7.3, §8, §9, §11 (steps 2.5 / 4.5 removed), §10.4 |
> | The auto-linking residual risk (Google Workspace domain takeover) is **reviewed and accepted**, for all domains — option (b), the `hd`-claim restriction, was explicitly declined | §3.7 "Accepted risk", §9, §13 (revisit trigger), §15 rule #72 |
>
> **Origin.** `plans/roadmap.md` TODO item 2 — *"Auth framework review — JWT session config +
> OAuth 2.0 + OpenID Connect"* (added 2026-07-30). It began as a review of what
> `plans/05-multi-tenant-auth.md` already built. The review found one real defect, and the
> scope then expanded in conversation with the user into three workstreams:
>
> | # | Workstream | Size |
> |---|---|---|
> | A | **Fix:** `middleware.ts` duplicates JWT verification instead of reusing `lib/auth/jwt.ts` (§3.1) | Small |
> | B | **Make configurable:** `SESSION_TTL_SECONDS` becomes an env var, default unchanged (§3.2) | Small |
> | C | **Build:** real Google OAuth 2.0 / OpenID Connect sign-in, alongside password auth (§3.3–§3.7, §4–§7) | Medium |
>
> Workstream C **deliberately reopens an exclusion Plan 05 stated in writing.** Plan 05 §0
> ("Explicitly NOT in this plan") lists *"Email verification, password reset /
> forgot-password, **OAuth / social login**."* That exclusion is **overridden here at the
> user's explicit request (2026-07-31)** — it is a scope decision reversed on purpose, not an
> oversight in Plan 05 and not an accident here. Recorded again, at length, in §14.1.
>
> **Plan 05's constraints remain binding.** Every one of its twelve §1 guiding constraints
> still holds unless this document says otherwise in a numbered §14 entry. In particular:
> ownership is enforced in the repository (its constraint 1), `middleware.ts` is **never** the
> authorization boundary (its constraint 4 — workstream A does *not* change this), password
> hashing never happens inside a `db.transaction()` (its constraint 5), and no secret ever
> reaches a log line (its constraint 7).
>
> **Numbering:** `06` is correct. `01`–`05` are the existing numbered execution specs;
> `plans/roadmap.md` and `plans/Evaluation-260730.md` are deliberately unnumbered.
>
> Standing project rules apply in full: **no commits without an explicit ask**, **no real
> external API call without an explicit ask** (§10.6 explains why this rule now has a second
> subject: Google's OAuth endpoints, not only Anthropic's), **dev server off after any
> verification session**, **layout prototyped in `architecture/layout/Layout-Workbench.html`
> first** — see §11 Phase 4 for how the last one is handled here (**not** waived this time).

---

## 0. What this plan is, in one paragraph

Plan 05 shipped a working single-mechanism auth system: email + password, bcrypt, a 7-day
HS256 JWT in an httpOnly cookie, invite-code-gated signup, and repository-level ownership.
This plan does three things to it. It **removes a duplicated JWT verifier** in `middleware.ts`
that drifted from the canonical one in `lib/auth/jwt.ts` (weaker in two specific ways — §3.1).
It **promotes the hardcoded session lifetime to an environment variable**, keeping 7 days as
the default, so the first real deploy can shorten it without a code change. And it **adds
Google as a second login mechanism** — OAuth 2.0 authorization-code flow with PKCE, the
OpenID Connect `id_token` verified against Google's JWKS with `jose`, a new `oauth_account`
table keyed on `(provider, providerAccountId)`, and an `OAuthProvider` seam so that adding
GitHub later is a registry entry plus one `getProfile()` implementation rather than a second
copy of the flow. **Google is a second way to prove who you are; it is not a second way to get
in.** A brand-new Google identity still needs a valid, unredeemed invite code and still counts
against `maxUsers`, enforced inside the same single transaction Plan 05 §4.4 already uses.
Password auth stays, unchanged and undeprecated, as a first-class path.

**The one behavior that matters most:** after this plan, **no OAuth code path may create a
user account without redeeming an invite code inside the same transaction that creates the
row.** The closed beta's admission control is Plan 05's, unchanged; OAuth attaches to it
rather than sitting beside it.

### Explicitly NOT in this plan

- **Any provider other than Google.** GitHub, Microsoft, Apple: the seam exists (§3.3, §5.1)
  and adding one is scoped in §13, but none is built. One provider is registered.
- **Linking Google to an existing account from `/account`, and unlinking.** Auto-linking on a
  verified email (§3.7) covers the realistic case without a UI. A manual link/unlink surface
  needs a re-authentication story and, for unlink, a "you are about to remove your only way
  in" guard — deferred (§13).
- **A "set a password" flow for a Google-only account.** Such an account has
  `passwordHash = NO_PASSWORD_SENTINEL` and genuinely cannot use `/api/auth/login`. That is
  correct and intended; giving them a password later is the same deferred surface as
  password-change (Plan 05 §14 → `TechDesign.md` P05j).
- **Refresh tokens, offline access, or calling any Google API after sign-in.** We request
  `openid email profile`, read three claims out of the `id_token`, and discard every token.
  Nothing Google issues is ever persisted (§8 invariant 5).
- **Server-side session revocation, sliding refresh.** Still deferred (P05f, P05g) and
  **not** made easier by this plan. Making the TTL configurable is not revocation — §3.2
  states the difference explicitly because it is easy to assume otherwise.
- **Email verification for password signups.** Google-verified email and this app's own
  unverified signup email remain two different things, and §3.7 depends on that distinction.
- **Replacing or deprecating password auth.** Both paths are permanent for now.
- **Changing where ownership is enforced, what `middleware.ts` is for, or anything about the
  activity-log consent model.** This plan touches auth *mechanism*, not authorization.

---

## 1. Guiding constraints (locked — do not replan during build)

Plan 05's twelve constraints carry over verbatim and are **not** restated here. These are
this plan's additions. Where one interacts with a Plan 05 constraint, that constraint's
number is given as `P05-C<n>`.

1. **There is exactly one JWT verification implementation in this repository.**
   `verifySessionToken()` in `lib/auth/jwt.ts`. `middleware.ts`, route handlers, and server
   components all call it. No file other than `lib/auth/jwt.ts` may import `jwtVerify` or
   `SignJWT` from `jose` for session tokens. Enforced by a fitness test (§10.4), not by
   convention — the duplicate this plan deletes is proof that convention was insufficient.
   *(This is the generalized form of the defect in §3.1.)*
2. **Fixing the duplication does not promote `middleware.ts` to an authorization boundary.**
   `P05-C4` is unchanged and is the reason the fix is safe to make: middleware still verifies
   signature and expiry only, still reads no database, and every route handler still
   establishes its own session independently. If a future change makes middleware's verdict
   load-bearing, that is a violation of `P05-C4`, not of this constraint.
3. **Nothing in `middleware.ts`'s transitive import graph may reach `lib/db/`,
   `next/headers`, `bcryptjs`, or `node:*`.** The Edge runtime cannot open `better-sqlite3`.
   Importing from `lib/auth/` — which this plan starts doing — opens a door to
   `lib/auth/session.ts`, which does reach the DB. Enforced by a fitness test that walks the
   import closure (§10.4), because the failure mode is a broken production build discovered
   at deploy time, not a failing unit test.
4. **The session lifetime is resolved through one function, called once per issuance.**
   `getSessionTtlSeconds()`. Both the JWT's `exp` and the cookie's `maxAge` derive from the
   *same call in the same request*, so they can never disagree (this is Plan 05 §3.3's
   "no cookie-present-but-token-dead state", preserved through the change). An invalid
   `SESSION_TTL_SECONDS` **throws at boot**, never silently falls back to the default.
5. **OAuth is a login mechanism, never an admission mechanism.** Creating a `user` row from
   an OAuth callback redeems an invite code and re-checks `maxUsers` inside the *same
   transaction*, exactly as `createUserWithInvite()` does today (Plan 05 §4.4). There is no
   OAuth code path that inserts a `user` row outside that transaction.
6. **An account is only ever created from a flow that started on `/signup`.** The OAuth
   transaction record carries `mode: 'login' | 'signup'`. A callback resolving to "no such
   identity, no matching user" under `mode: 'login'` is an error, never a silent signup.
   Reason: the §5.6 activity-log consent choice and the invite code are both collected on
   `/signup` and nowhere else, and Plan 05 §5.6 requires the consent question to be *answered*,
   not defaulted.
7. **Identity is `(provider, providerAccountId)`, never the email address.** Google's `sub`
   is the key. Email is used for exactly two things: the auto-link heuristic on first sight
   (§3.7) and the initial value of `user.email` at creation. **A later sign-in never updates
   `user.email` from the provider**, because that would let a change at the identity provider
   silently move this app's login identifier — or collide with another user's row.
8. **No token issued by an OAuth provider is ever persisted, logged, or returned to the
   client.** Not the access token, not the refresh token (we never request one), not the
   `id_token`. They exist inside one function call and are discarded. This is `P05-C7`
   applied to a new class of secret.
9. **Exactly one file may import the OAuth client library.** `lib/auth/oauth/google.ts`.
   Everything above it depends on this repo's own `OAuthProvider` interface. Same rule, same
   reason, and same enforcement mechanism as `@anthropic-ai/sdk`'s one-importer rule
   (Rules Index #41, `lib/ai/__tests__/architecture.test.ts`).
10. **The OAuth transaction cookie is single-use and is cleared on every exit path from the
    callback** — success, cancellation, state mismatch, provider error, unverified email,
    invalid invite code, everything. A surviving transaction cookie is a replayable
    authorization state. Asserted per-path in tests (§10.3), because "cleared on the happy
    path only" is the shape this bug takes.
11. **No automated test may contact Google, and no automated test may import the OAuth client
    library.** Provider interaction is mocked at this repo's own seam
    (`lib/auth/oauth/providers.ts`), the same way `lib/ai/*` calls are mocked today. Asserted
    by the §10.4 fitness test.
12. **Every OAuth failure the user can reach is a redirect to `/login` or `/signup` carrying
    an `?error=<code>` from a closed vocabulary — never a JSON error body, never a stack
    trace, never a provider message passed through.** The callback is a browser navigation;
    a JSON body there is a dead end for the user and an information leak from Google's
    response. The error *codes* stay in this codebase's existing snake_case vocabulary (§7.3).

---

## 2. Architecture

### 2.1 What changes in the layering

Plan 05 §2.1's diagram is unchanged in shape. Two boxes change contents:

```
middleware.ts (Edge)      ← was: its own inline jwtVerify()
  │                         now: verifySessionToken() from lib/auth/jwt.ts   (§3.1)
  │                         still: no DB, still NOT the authorization boundary (P05-C4)
  │
  ├─ /api/auth/oauth/[provider]/start     ← public. Builds the authorize URL, sets the tx cookie.
  ├─ /api/auth/oauth/[provider]/callback  ← public. The only new place a session is issued.
  │     └─ lib/auth/oauth/providers.ts    ← THE provider seam. Mocked in tests.
  │           └─ lib/auth/oauth/google.ts ← the ONLY importer of `arctic`; verifies the
  │                                          id_token with `jose` + a remote JWKS.
  │     └─ lib/db/repository/users.ts     ← createUserWithInvite(), extended with `oauth`
  │                                          (still ONE transactional signup primitive)
  └─ (everything else, unchanged)
```

Three facts about an OAuth callback are established in three different places, deliberately:

| Question | Answered by | Mechanism |
|---|---|---|
| *Did this browser start this flow?* | the route handler | `state` in the query equals `state` in the httpOnly, path-scoped, 10-minute tx cookie |
| *Did Google really assert this identity?* | `lib/auth/oauth/google.ts` | `id_token` signature verified against Google's JWKS, **plus** `iss`, `aud`, `exp`, `nonce` |
| *Is this person allowed to have an account here?* | `lib/db/repository/users.ts` | invite code + `maxUsers`, re-checked inside the creating transaction (`P05-C5` here, Plan 05 §4.4) |

None substitutes for another. The first is CSRF, the second is authentication, the third is
admission. Conflating the second and third — "Google says they're real, so let them in" — is
precisely the bug constraint 5 exists to prevent.

### 2.2 Files

| File | New/Modified | Role |
|---|---|---|
| `package.json` | modified | `+arctic` (pinned `^3`). **The only new runtime dependency in this plan** — `jose` is already present and does the OIDC verification |
| `.env.example` | modified | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE_URL`, `SESSION_TTL_SECONDS` |
| `lib/env.ts` | modified | `getOAuthConfig()`, `isOAuthConfigured()`; `assertServerEnv()` gains the all-or-nothing OAuth check and the TTL check (§3.4) |
| `lib/auth/constants.ts` | modified | `SESSION_TTL_SECONDS` const → `DEFAULT_SESSION_TTL_SECONDS` + `getSessionTtlSeconds()`; `+OAUTH_TX_COOKIE`, `+OAUTH_TX_TTL_SECONDS`, `+OAUTH_SCOPES` |
| `lib/auth/jwt.ts` | modified — **1 line** | `SESSION_TTL_SECONDS` → `getSessionTtlSeconds()` |
| `middleware.ts` | modified | Import `verifySessionToken`; **delete the local `verifyToken()`**; public-path allowlist gains the `/api/auth/oauth/` prefix (§3.1) |
| `lib/auth/oauth/types.ts` | **new** | `OAuthProvider`, `OAuthProfile`, `OAuthTx`, `OAuthError` — the seam's vocabulary. No dependency on `arctic` |
| `lib/auth/oauth/providers.ts` | **new** | The registry: `getOAuthProvider(name): OAuthProvider \| null`. **The single seam mocked by tests** (constraint 11) |
| `lib/auth/oauth/google.ts` | **new** | The Google implementation. **The only file importing `arctic`** (constraint 9) and the only file calling `createRemoteJWKSet` |
| `lib/auth/oauth/tx.ts` | **new** | `buildOAuthTxCookie()`, `readOAuthTx()`, `clearOAuthTxOn(response)` — the transaction cookie, one owner (§3.5) |
| `lib/db/schema.ts` | modified | `oauthAccount` table (§4.1) |
| `lib/db/migrations/0004_*.sql` + `meta/` | **new** | **Machine-generated by `drizzle-kit`, not hand-edited** — pure `CREATE TABLE` + indexes. Plan 05 §4.5's hand-authoring exception does not apply and must not be reused (§4.3) |
| `lib/db/repository/oauthAccounts.ts` | **new** | `getOAuthAccount()`, `listOAuthAccountsForUser()`, `linkOAuthAccount()` |
| `lib/db/repository/users.ts` | modified | `createUserWithInvite()` gains a **required, explicitly-nullable** `oauth` field and a fourth failure reason (§4.2) |
| `lib/db/repository/index.ts` | modified | Barrel |
| ~~`lib/settings.ts`~~ | — | **Not touched.** The `oauthAutoLinkVerifiedEmail` setting was proposed and **declined at review (§16.4)** — auto-linking is a hardcoded `true` (§5.3) |
| ~~`lib/db/seed.ts`~~ | — | **Not touched**, for the same reason. This plan adds **no** setting and seeds nothing |
| `app/api/auth/oauth/[provider]/start/route.ts` | **new** | `POST` → `{ authorizeUrl }` + tx cookie (§7.1) |
| `app/api/auth/oauth/[provider]/callback/route.ts` | **new** | `GET` → the whole flow (§6) |
| `app/api/auth/login/route.ts` | modified — **1 log line** | The sentinel-hash warning is reworded: with Google-only accounts it is now a routine event, not a suspicious one (§3.8) |
| `app/api/account/route.ts` | modified | `GET` response gains `linkedProviders: string[]` (read-only) |
| `app/login/page.tsx` | modified — **split** | Becomes a server component reading `isOAuthConfigured()`; the form moves to `app/components/Auth/LoginForm.tsx` |
| `app/signup/page.tsx` | modified — **split** | Same split → `app/components/Auth/SignupForm.tsx`; gains the Google path, which must collect the invite code **and** the consent answer before redirecting (§7.2) |
| `app/components/Auth/GoogleButton.tsx` | **new** | Shared "Continue with Google" control. Calls the `start` route, then `window.location.assign(authorizeUrl)` |
| `app/components/Account/AccountView.tsx` | modified | One read-only line: "Signed in with: password / Google (`<email>`)" |
| `lib/auth/__tests__/sessionTtl.test.ts` | **new** | §10.3 |
| `lib/auth/oauth/__tests__/tx.test.ts` | **new** | §10.3 |
| `lib/auth/oauth/__tests__/google-idtoken.test.ts` | **new** | §10.3 |
| `lib/db/repository/__tests__/oauthAccounts.test.ts` | **new** | §10.3 |
| `app/api/auth/__tests__/oauth-callback.test.ts` | **new** | §10.3 — the crown jewel (§10.4) |
| `app/api/auth/__tests__/oauth-start.test.ts` | **new** | §10.3 |
| `app/api/__tests__/route-guard.test.ts` | modified | Three new fitness assertions (§10.4) |
| `lib/db/__tests__/migration.test.ts` | modified | `oauth_account` shape + indexes |
| `app/api/auth/__tests__/auth.test.ts` | modified | One case: a Google-only user (`passwordHash: ''`) cannot log in with a password |

---

## 3. The three workstreams

### 3.1 Workstream A — `middleware.ts` stops duplicating JWT verification

**The defect, precisely.** `lib/auth/jwt.ts`'s header comment states its purpose:

> *"Deliberately Edge-safe: no Node-only imports, no `server-only`. This lets middleware.ts
> (which runs on the Next.js Edge runtime) verify tokens using the same code path as route
> handlers."*

`middleware.ts` does not use it. It carries a private `verifyToken()` (lines 73–83) that
reimplements the same job. The two have drifted in three ways:

| | `lib/auth/jwt.ts` `verifySessionToken()` | `middleware.ts` `verifyToken()` | Consequence |
|---|---|---|---|
| Secret resolution | `getJwtSecret()` from `lib/env.ts` — throws on unset **or** `< 32` chars | reads `process.env.JWT_SECRET` inline; **returns `false`** on unset or short | A second, silent copy of a security rule that `lib/env.ts` owns. Fails closed today, so it is not currently exploitable — but the rule now exists in two places and only one of them is tested |
| Algorithm | `jwtVerify(token, secret, { algorithms: ['HS256'] })` | `jwtVerify(token, key)` — **no `algorithms` restriction** | With a symmetric secret and `jose`'s own defences the practical exposure is low (`jose` rejects `alg: none` outright). It is nonetheless the standard hardening for this exact call, it is present 40 lines away, and its absence here is unexplained rather than reasoned |
| Payload shape | Requires `sub` and `email` to be strings; returns the payload | Returns a bare `boolean`; a validly-signed token with no `sub` passes | Middleware would let such a token through; `getSession()` then rejects it downstream. Not a hole (P05-C4), but it makes middleware's verdict differ from the app's for no reason |

None of these is an exploitable vulnerability *today*, and this plan does not claim
otherwise — `P05-C4` is exactly why: the route handler's `authenticate()` and the
repository's `WHERE owner_id = ?` are still in the path regardless of what middleware
concludes. The defect is that **the same question has two answers in one codebase**, one of
them untested, and Plan 05 §3.1 chose `jose` specifically so that would not be true:

> *"two implementations of 'is this token valid' is exactly the drift this codebase's fitness
> tests exist to prevent."*

**The fix.**

```
middleware.ts
  - import { jwtVerify } from 'jose';
  - async function verifyToken(token: string): Promise<boolean> { … }        ← deleted
  + import { verifySessionToken } from '@/lib/auth/jwt';
    …
  - const tokenValid = token ? await verifyToken(token) : false;
  + const tokenValid = token ? (await verifySessionToken(token)) !== null : false;
```

**The one thing that had to be verified before committing to this, and was:** `lib/auth/jwt.ts`
imports `getJwtSecret` from `lib/env.ts`, and `lib/env.ts` begins with `import 'server-only'`.
The obvious worry is that this breaks the Edge build of `middleware.ts`. **It does not.**
Verified against the installed Next 15.5.22 on 2026-07-31: `next/dist/lib/constants.js`
defines `WEBPACK_LAYERS.GROUP.serverOnly` as `['rsc', 'action-browser', 'instrument',
'middleware']`, and `next/dist/build/webpack-config.js` aliases `server-only` to an empty
module for every layer in that group — the build-time error is raised only for layers *not*
in it (client component trees). Middleware is a server-only layer; `import 'server-only'` is a
no-op there. *(`instrumentation.ts` line 20's comment implies the opposite. It is defensive
rather than wrong — it dynamic-imports `lib/env.js` to keep the Edge copy from *evaluating*
`assertServerEnv()`, which is a different and valid concern. No change needed there.)*

**Behavioural deltas after the fix**, stated so the reviewer can check each:

1. A missing or short `JWT_SECRET` still fails closed. `getJwtSecret()` throws *inside*
   `verifySessionToken`'s `try`, which returns `null` → same redirect as today.
2. `algorithms: ['HS256']` now applies at the edge.
3. A signed token lacking `sub`/`email` is now rejected at the edge as well as downstream.
4. Middleware now imports from `lib/auth/`. **That is the fix's one real hazard** — the next
   person to need something in middleware will reach for `lib/auth/session.ts`, which pulls
   `lib/db/`, which cannot run on Edge. Constraint 3 plus the §10.4 import-closure fitness
   test is the guard, and it is why that test is written in the same phase as the fix.

**Public-path allowlist.** `PUBLIC_PATHS` is an exact-match `Set`. The new OAuth routes live
under a dynamic segment, so the check becomes *exact-match set* **∪** *prefix
`/api/auth/oauth/`*. Next normalizes `pathname` before middleware sees it, so `..` traversal
cannot smuggle a protected path under that prefix; the prefix is also deliberately narrow
(`/api/auth/oauth/`, not `/api/auth/`) so it cannot silently widen to cover a future
authenticated route under `/api/auth/`.

### 3.2 Workstream B — `SESSION_TTL_SECONDS` becomes an env var

Today: `lib/auth/constants.ts` line 19, `export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;`.
Read by `lib/auth/jwt.ts` (the JWT `exp`) and by the login and signup routes (the cookie
`maxAge`).

After:

```ts
// lib/auth/constants.ts  — still importless, still the dependency root
export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;   // 7 days — unchanged default
export const MIN_SESSION_TTL_SECONDS = 60;                     // below this is a misconfiguration
export const MAX_SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;      // beyond this "it expires" is meaningless

export function getSessionTtlSeconds(): number {
  const raw = process.env.SESSION_TTL_SECONDS;
  if (raw === undefined || raw === '') return DEFAULT_SESSION_TTL_SECONDS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_SESSION_TTL_SECONDS || n > MAX_SESSION_TTL_SECONDS) {
    throw new Error(
      `SESSION_TTL_SECONDS must be an integer between ${MIN_SESSION_TTL_SECONDS} and ` +
      `${MAX_SESSION_TTL_SECONDS} seconds (got: ${raw}).`,
    );
  }
  return n;
}
```

| Decision | Choice | Why |
|---|---|---|
| Where it lives | `lib/auth/constants.ts`, **not** `lib/env.ts` | `lib/env.ts` is `server-only`, and this value is read by `lib/auth/jwt.ts`, which must stay Edge-clean by construction (it is imported by `middleware.ts` as of §3.1 — although only `signSessionToken` uses the TTL, keeping the whole module Edge-safe is the property worth preserving). `constants.ts` is already the importless dependency root, and `process.env` needs no import |
| Invalid value | **Throws**, at boot | `assertServerEnv()` calls `getSessionTtlSeconds()`. A typo'd value silently becoming 7 days is the same silent-misconfiguration class as a 20-character `JWT_SECRET`, which Plan 05 §3.2 already refuses to tolerate |
| Unset value | 7 days, no warning | The current behaviour, unchanged. Every existing `.env.local` keeps working |
| Bounds | 60 s … 90 d | A sub-minute session breaks the app for its own users; a >90-day one makes "a leaked token expires" a fiction. Both are configuration errors, not preferences |
| Live-editable admin setting (`setting` table + System Settings UI) | **Rejected** | Two reasons. (a) No trigger: this is a closed beta of ≤ 5 friends and the value has never been changed once. (b) **It would not do what it looks like it does** — see the note below. A control that appears to govern sessions but governs only *future* ones is worse than a documented env var |

**The nuance that decides (b), and that must be in the README:** a JWT carries its own `exp`,
baked in at signing time. Changing the TTL — by any mechanism — affects **only tokens issued
after the change**. Every already-issued session keeps its original lifetime until it expires
on its own. And because there is still no server-side revocation (P05f), *shortening* the TTL
cannot shorten a live session. So:

- Lengthening it takes effect for everyone on their next login.
- Shortening it takes effect for everyone on their next login, and does **nothing** for anyone
  currently signed in — worst case, 7 more days.
- If a session must actually be killed now, the answer today is still the Plan 05 answer:
  delete or alter the `user` row (`getSession()` re-reads it every request), or rotate
  `JWT_SECRET`, which invalidates every session at once.

That last sentence is the honest operational answer and belongs in `README.md` (Phase 5.2).

### 3.3 Workstream C — library choice

| Concern | Choice | Why this one |
|---|---|---|
| OAuth 2.0 client | **`arctic`** (`arcticjs.dev`), pinned `^3` | Zero runtime dependencies of its own, pure JS/WebCrypto, **no native compilation** — the same criterion that chose `bcryptjs` over `bcrypt`/`argon2` (Plan 05 §3.1) and `jose` over `jsonwebtoken`. Ships maintained per-provider classes (Google, GitHub, Microsoft, Apple, …). The value is **not** the OAuth2 dance — that is ~40 lines — it is that each provider deviates from the spec in its own way (GitHub returns no `id_token` and needs `Accept: application/json`; Apple requires a signed client secret), and those deviations are what a second provider actually costs |
| OIDC `id_token` verification | **`jose`** — already a dependency | `createRemoteJWKSet('https://www.googleapis.com/oauth2/v3/certs')` + `jwtVerify(idToken, jwks, { issuer, audience })`. `jose` caches the key set and handles rotation. Arctic deliberately does **not** verify id_tokens, so this is a real gap it does not fill — and it needs no new library to fill |
| Auth.js / NextAuth | **Rejected** | It would own the session, the cookie, the callbacks, and the adapter — replacing a working, fully-tested subsystem (`lib/auth/*`, 5 test files, Rules Index #51–#54, #62) to gain one provider. It also brings its own DB adapter shape, which conflicts with this repo's soft-reference, no-FK schema convention |
| Hand-rolled, no library | **Rejected, narrowly** | Genuinely viable for Google alone. Rejected because the stated goal is that a *second* provider be cheap, and hand-rolling makes the second provider cost exactly what the first did |

**And one addition on top of the user's proposal.** `arctic` is wrapped behind this repo's own
`OAuthProvider` interface (§5.1), for the same three reasons `lib/ai/provider.ts` wraps the
Anthropic SDK: tests mock our seam rather than a third party's internals; a library swap is
one file; and a fitness test can assert the one-importer rule mechanically. With one provider
registered this is a **seam, not a framework** — `providers.ts` is about twenty lines.

> **Accuracy note for `@dev`:** `arctic` is **not installed**, so the exact v3 method names
> below (`generateState()`, `generateCodeVerifier()`, `new Google(id, secret, redirectURI)`,
> `createAuthorizationURL(state, codeVerifier, scopes)`,
> `validateAuthorizationCode(code, codeVerifier)`, `tokens.idToken()`) are **from
> documentation, not verified against an install**. Phase 0.1 confirms them against the
> installed version before anything is built on top. Everything in this plan above the seam is
> written against `lib/auth/oauth/types.ts`, so a naming difference is contained to
> `google.ts`.

### 3.4 Env and secret handling

```
GOOGLE_CLIENT_ID=…apps.googleusercontent.com   # not secret, but pointless alone
GOOGLE_CLIENT_SECRET=…                          # secret; never logged, never sent to a client
OAUTH_REDIRECT_BASE_URL=http://localhost:3000   # scheme + host + optional port. NO trailing slash, NO path
SESSION_TTL_SECONDS=604800                      # optional (§3.2)
```

- **Why a base URL, not a full `GOOGLE_REDIRECT_URI`.** The callback path is derivable:
  `${base}/api/auth/oauth/${provider}/callback`. Adding GitHub then needs two env vars, not
  three. The full URI is what gets registered in the provider's console, and §11 Phase 5.0
  prints it so it can be copied exactly.
- **OAuth configuration is all-or-nothing, checked at boot.** `assertServerEnv()` gains: *if
  none of the three OAuth variables is set, OAuth is disabled and the app runs normally
  (password auth only); if **some but not all** are set, throw.* A half-configured OAuth
  deployment is the state that produces a "Continue with Google" button leading to a
  provider error page, and it is exactly the class of silent misconfiguration Plan 05 §3.2
  built `instrumentation.ts` to catch. This mirrors how `ANTHROPIC_API_KEY` is legitimately
  optional at boot (dry-run mode) — optional is fine; *partial* is not.
- **`OAUTH_REDIRECT_BASE_URL` is validated, not trusted.** Must parse as an absolute URL,
  scheme `http:` or `https:`, no path/query/fragment, no trailing slash. In production
  (`NODE_ENV === 'production'`) it must be `https:` — Google rejects non-HTTPS redirect URIs
  except for `localhost`, and the session cookie is `secure` in production anyway (Plan 05 §9
  already makes HTTPS a hard deploy prerequisite). Validation happens in `assertServerEnv()`
  so it fails at boot.
- **The redirect URI sent to Google is always built from this env var, never from the incoming
  request's `Host` header.** A `Host`-derived redirect URI is host-header-injection bait.
  (In practice Google would also reject an unregistered URI — but relying on the provider to
  catch our bug is not a control.)
- `GOOGLE_CLIENT_SECRET` is read once, used in one server-to-server POST, and never appears in
  a response, a log line, or an `llm_call_log` payload (`P05-C7`).

### 3.5 The OAuth transaction cookie (`myagent_oauth_tx`)

Three pieces of state must survive a round trip through Google: the CSRF `state`, the PKCE
`code_verifier`, and — for a signup — the invite code and the consent answer. Plus, for
parity with password login, the `?next=` destination.

| Property | Value | Rationale |
|---|---|---|
| Name | `myagent_oauth_tx` | Matches the `myagent_session` naming convention |
| Contents | base64url of `{ v: 1, provider, mode, state, codeVerifier, nonce, inviteCode?, consent?, next? }` | One cookie, one lifecycle, one `delete` |
| `httpOnly` | `true` | The invite code is a bearer credential; no script needs it |
| `sameSite` | **`lax`** | **Load-bearing.** The callback arrives as a *cross-site top-level GET navigation* from `accounts.google.com`. `Strict` would withhold the cookie on that navigation in most browsers, and the symptom is a mystifying "state cookie missing" on every attempt. `lax` sends it; `lax` still blocks the cross-site POST surface |
| `secure` | `NODE_ENV === 'production'` | Same rule as the session cookie |
| `path` | **`/api/auth/oauth`** | Both routes live under it, so the cookie never rides along on any other request. **The clear must use the identical `path`** or the delete silently no-ops — the single most common bug in this pattern |
| `maxAge` | `OAUTH_TX_TTL_SECONDS = 600` (10 min) | Long enough for a real consent screen including a fresh Google login; short enough that an abandoned flow is not resumable an hour later |
| Signed / encrypted? | **No** | Deliberate, and stated so it is not later "fixed" by cargo cult. The cookie is set by us and read by us; **every value in it is re-validated authoritatively downstream** — the invite code inside the creating transaction, the consent flag by strict `=== true` coercion, `next` by the open-redirect regex, `state` against Google's echo. A user forging their own tx cookie gains nothing they could not get by filling in the form. Signing would protect a property nothing depends on |

`lib/auth/oauth/tx.ts` owns all three operations (`build`, `read`, `clearOn(response)`), so
the `path` can only be got wrong in one place. `readOAuthTx()` returns `null` on absent,
malformed, wrong-version, or wrong-`provider` cookies — all treated identically (§7.3).

**Why not put the invite code in `state`?** Because `state` is echoed back by Google in the
redirect **URL**. A URL lands in browser history, in `Referer` headers on any subsequent
navigation, and in the access log of anything terminating TLS. An invite code is a credential
that grants "may create an account here". It stays in an httpOnly cookie and never appears in
a URL. *(This confirms the user's own instinct to keep the two separate, with the specific
reason.)*

**Why not a server-side pending-auth table?** It would need a table, an expiry sweep, and a
cleanup policy, to hold data for 30 seconds. The cookie is already scoped, short-lived, and
self-cleaning.

### 3.6 Verifying Google's `id_token`

```
jwtVerify(idToken, GOOGLE_JWKS, {
  issuer:   ['https://accounts.google.com', 'accounts.google.com'],   // Google emits both forms
  audience: GOOGLE_CLIENT_ID,
})
→ then require, explicitly:
    payload.sub            is a non-empty string     → providerAccountId
    payload.email          is a non-empty string
    payload.email_verified === true                  ← the boolean, not merely the field's presence
    payload.nonce          === tx.nonce
```

- **`aud` and `iss` are the checks that actually matter** and are the ones most often skipped.
  Without `aud`, an `id_token` minted for a *different* Google application would validate here
  — every claim genuine, every signature valid, wrong audience. `jose` enforces both when
  given the options; they are passed explicitly rather than checked afterwards so they cannot
  be forgotten in a refactor.
- **Signature verification is defence-in-depth here, and the plan says so rather than
  overstating it.** OIDC Core §3.1.3.7 permits a client to skip `id_token` signature
  validation when the token was received directly from the token endpoint over TLS with client
  authentication — which is our case. We verify anyway because it costs one cached JWKS fetch
  and it stops being optional the moment anyone ever accepts an `id_token` by another route.
  The `iss`/`aud`/`exp`/`nonce` checks are **not** optional in either reading.
- **`email_verified` is checked as `=== true`.** Google sends it as a real boolean; some
  providers send `"true"`. Coercing would be exactly the "be liberal in what you accept"
  mistake Plan 05 §8 invariant 15 exists to forbid, in a claim that gates account linking.
- `createRemoteJWKSet` performs an outbound HTTPS request to Google on first use and caches
  the keys. It lives in `google.ts` only (constraint 9), so no test can trigger it
  (constraint 11).
- **Nothing else in the `id_token` is read.** No `name`, no `picture`, no `hd`. This app has
  no profile surface, and not reading a claim is the cheapest way to not store it. Reading
  `hd` to restrict auto-linking to consumer Google accounts was offered at review and
  **explicitly declined (§16.5)** — so `hd` stays unread, and that is now a decision rather
  than an omission.

### 3.7 Account resolution: login vs. link vs. create

The callback resolves the verified profile to exactly one of three outcomes:

| # | Precondition | Outcome | Invite code needed? |
|---|---|---|---|
| 1 | An `oauth_account` row exists for `(provider, sub)` | **Login.** Load `user` by that row's `userId`, issue a session | No — they already have an account |
| 2 | No such row, but a `user` exists whose `email` equals the verified email | **Auto-link.** Insert the `oauth_account` row pointing at that existing user, then log in | No |
| 3 | Neither | **Create** — only if `mode === 'signup'` (constraint 6) | **Yes**, redeemed in the creating transaction |

**Outcome 2 is the security-relevant judgment call in this plan. It was put to the user at
review on 2026-07-31, with the risk below stated at full strength, and it was accepted as
written — see "Accepted risk" at the end of this section.** The reasoning for allowing it:

- Google asserting `email_verified: true` means *Google* has established that this identity
  controls that mailbox. This app has established no such thing about its own password
  signups — there is no email verification (Plan 05 §0), so `user.email` is, strictly, an
  unverified string somebody typed. The auto-link therefore adds a *stronger* claim to a
  weaker one, not the reverse.
- Without it, a beta user who signed up with `alice@gmail.com` and later clicks "Continue with
  Google" gets an error telling them their own email is taken — by themselves. The alternative
  is building the manual link surface this plan explicitly excludes.

**The risk, stated at full strength rather than minimised.** Auto-linking is the one path in
this plan that grants access to an existing account **without an invite code and without a
password**. Its entire security therefore rests on `email_verified`, and `email_verified` is
*not* uniformly strong across Google account types:

- For consumer `@gmail.com` addresses it is as strong as Google's own account security.
- For **Google Workspace** addresses on a custom domain, `email_verified: true` means the
  *domain* was verified — so whoever controls the domain's Workspace tenant can mint an
  identity for any address on it. This is the well-known "Workspace domain takeover"
  vector: if a beta user signed up with `alice@somecompany.com` and an attacker later
  acquires `somecompany.com` as a Workspace domain, they can produce a genuine, correctly
  signed `id_token` for `alice@somecompany.com` and take over Alice's MyAgent account.

Three ways to close or narrow that were put to the user, in increasing cost:

| Option | Effect | Cost | Verdict at review |
|---|---|---|---|
| **(a) Auto-link whenever `email_verified === true`**, every domain included | Best UX; carries the Workspace-domain residual risk | 0 | ✅ **Chosen (§16.5)** |
| **(b) Auto-link only when the `hd` claim is absent** (consumer Google accounts only) | Removes the Workspace vector entirely; a Workspace user must use their password instead | ~3 lines, one more error the UI must explain | ❌ **Explicitly declined** — "accept all workspace for now" |
| **(c) Never auto-link** — always refuse, linking only from `/account` after a password login | No residual risk; requires the link UI this plan excludes | A new surface, a re-auth story, a phase | ❌ Declined |
| *(d) (a) plus an admin kill switch* — a `SETTING_DEFS` toggle making (a) revertible without a deploy | Same as (a), reversible after the fact | 1 setting, 1 UI control, 2 build steps | ❌ **Declined (§16.4)** — "don't want to overcomplicate" |

#### Accepted risk — reviewed, not defaulted

**Read this before changing anything here.** The Google Workspace domain-takeover vector
described above is **a known, reviewed, and deliberately accepted risk as of 2026-07-31**, not
an oversight and not a default nobody looked at. It was written out in full, options (b), (c)
and (d) were each offered as mitigations, and the user chose (a) for all domains — including
Workspace-hosted custom domains — knowing that:

- auto-linking is the **only** path in this system that reaches an existing account with
  neither an invite code nor a password;
- for a Workspace-hosted address, `email_verified: true` attests that the **domain** was
  verified, so the domain's Workspace administrator — present or future — can mint an identity
  for any address on it;
- there is deliberately **no runtime switch** to turn this off; reverting it is a code change.

Why that is a reasonable call *today*, stated so the trade is legible rather than merely
asserted: the beta is capped at `maxUsers` (currently 5), every account is invite-gated, and
the admin personally knows every person in it and therefore every email domain in play. The
attack requires an adversary to acquire Workspace control of one of those specific known
domains. That is a real but narrow exposure against a small, known population.

**Revisit when** *(the trigger, in the style of Plan 05 §14 — this row is carried into
`TechDesign.md`'s Deferred Decisions at Phase 6.1, and is also Rules Index #72)*:

- **before the beta opens beyond people the admin personally knows**, or self-service signup
  without invite codes arrives — at that point the "I know every domain" premise is gone and
  option (b) becomes the default answer, not the hardening; **or**
- a beta user signs up with an address on a domain the admin does not control and does not
  trust indefinitely (a former employer, a hobby project's domain, anything that could lapse
  and be re-registered); **or**
- any account is compromised by this route, or any near-miss is observed in the `[auth]` log.

Whoever picks that up: the fix is option (b) — reject the auto-link when the `id_token`
carries an `hd` claim — plus a user-facing message and one error code. It is roughly three
lines in the callback plus the copy. It was costed at review; it was not omitted for lack of a
design.

Every auto-link writes `[auth] oauth account auto-linked provider=<p> userId=<id>` — no email,
no token. It is a rare, security-relevant event, it is the audit trail this accepted risk
relies on, and it should be greppable.

### 3.8 Interaction with password login

- A Google-only user's `passwordHash` is `NO_PASSWORD_SENTINEL` (`''`). **Re-verified against
  the built code on 2026-07-31, and the reuse is sound at two independent layers:**
  `app/api/auth/login/route.ts` lines 57–64 reject the sentinel *before* bcrypt and return the
  identical `401 invalid_credentials`; and `lib/auth/password.ts` line 67
  (`if (hash === NO_PASSWORD_SENTINEL) return false;`) rejects it again even if a future caller
  bypasses the route check. No new concept is needed and none is introduced.
- **One wording change.** That path currently logs
  `[auth] login attempted on user with no password set` — phrased as a suspicious event,
  because before this plan the only such row was the un-bootstrapped admin. It now also fires
  every time a Google user absent-mindedly types their email into the password form. Reword to
  `[auth] password login attempted on a passwordless account (oauth-only or un-bootstrapped)`.
  The **response is unchanged** — identical `401`, identical body (Plan 05 §8 invariant 9, and
  the no-enumeration rule).
- **The login form must not say "this account uses Google".** That is a user-enumeration
  oracle: it confirms the email exists. Instead, a *static* line beneath the form, shown to
  everyone regardless of input: *"Signed up with Google? Use Continue with Google above."*
  No oracle, same help.
- Rate limiting: `POST /api/auth/oauth/[provider]/start` goes through the existing
  `checkRateLimit(request, 'oauth_start')`. **The callback deliberately gets no limiter** —
  it performs no network call and touches no database until the tx cookie has been read and
  its `state` matched, so a request without a cookie we issued is rejected in microseconds.
  Reaching the expensive part requires first passing through `start`, which *is* limited.
  Adding a second limiter would buy nothing and could lock a legitimate user out of the return
  leg of their own flow.

---

## 4. Data model

### 4.1 New entity: `oauth_account`

```ts
export const oauthAccount = sqliteTable('oauth_account', {
  provider: text('provider').notNull(),                        // 'google' — open catalog, no DB enum
  providerAccountId: text('provider_account_id').notNull(),    // Google's `sub` — stable, never the email
  userId: text('user_id').notNull(),                           // soft ref → user.id
  providerEmail: text('provider_email'),                       // audit/display only — never authoritative
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull().default(sql`(unixepoch())`),
}, (t) => ({
  pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  byUser: index('oauth_account_user_idx').on(t.userId),
  userProvider: uniqueIndex('oauth_account_user_provider_unique').on(t.userId, t.provider),
}));
```

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `provider` | text | PK part 1 | Lowercase registry key (`'google'`). **Not a Drizzle enum** — following `agent.platform`'s precedent (an open catalog, `schema.ts` line 50), so registering GitHub is a code change with no migration |
| `providerAccountId` | text | PK part 2 | Google's `sub`. **Never the email** (constraint 7). Opaque; never parsed, never displayed |
| `userId` | text | not null, indexed | Soft reference → `user.id`, matching every other cross-table link in this schema (no `references()`, `schema.ts` header) |
| `providerEmail` | text | nullable | The email as Google asserted it *at link time*. Has exactly one reader: the `/account` "Signed in with: Google (`…`)" line and the equivalent admin-side debugging question "which Google account is this?". Nullable because a future provider may not supply one (GitHub can hide it) |
| `createdAt` | int timestamp | not null, default now | |

**Design notes, each answering a question a reviewer will ask:**

- **Composite primary key, not a surrogate `id` + a unique index.** The task description
  called for "a unique index on `(provider, providerAccountId)`"; in SQLite a composite PK
  *is* that unique index, and it is strictly stronger — there is no second identifier that can
  drift out of agreement with it. This follows `invite_code`'s natural-PK reasoning
  (Plan 05 §4.2) and `membership`/`agent_config`'s existing composite-PK style.
- **`oauth_account_user_provider_unique` on `(userId, provider)`** — one identity per provider
  per user. This is precisely the shape the requirement asks for ("a user could eventually
  link more than one **provider**"): more than one provider, yes; two different Google
  accounts on one MyAgent user, no. Without it, a future unlink UI has to answer "which of
  these two Google accounts did you mean?" for a state nobody wanted.
- **No `lastLoginAt`.** Nothing in this plan reads it, and adding it would turn an
  insert-only table into one with an `UPDATE` path on the hot login route. Same reasoning
  Plan 05 §4.1 used to refuse `user.updatedAt`. Deferred in §13 with a real trigger
  ("the admin asks who is still using this").
- **No token columns of any kind.** Constraint 8. There is deliberately nowhere to put one.
- **Lifecycle:** created by the OAuth callback (outcome 2 or 3 of §3.7). Never updated. Never
  deleted by the application — unlinking is out of scope, and manual deletion is one `DELETE`,
  documented alongside Plan 05 §8 policy 23's other manual operations.

### 4.2 Modified: `createUserWithInvite()` — still exactly one signup primitive

Plan 05 §4.4 calls this "the one transactional signup primitive". Adding a second one for
OAuth would put the three admission checks (code validity, `maxUsers`, email uniqueness) in
two places — exactly the drift Plan 05 §6.1 refused to accept for ownership checks. So the
primitive is **extended**, not duplicated:

```
createUserWithInvite(input: {
  email: string;                  // already normalized
  passwordHash: string;           // already hashed, or NO_PASSWORD_SENTINEL for an OAuth-only user
  code: string;                   // already normalized
  maxUsers: number;
  shareLogsWithAdmin: boolean;
  oauth: { provider: string; providerAccountId: string; providerEmail: string | null } | null;  // ← NEW
}): { ok: true; user: UserRow }
 | { ok: false; reason: 'invalid_code' | 'email_exists' | 'cap_reached' | 'oauth_account_exists' }
```

- **`oauth` is required and explicitly nullable, never optional.** `oauth: null` at the
  password call site; a populated object at the OAuth one. This is `P05-C2`'s reasoning
  applied to a new field: *"an optional parameter is an opt-out, and an opt-out will
  eventually be taken by accident."* Both call sites must state their intent. The cost is one
  edited line in `app/api/auth/signup/route.ts` and the corresponding test fixtures.
- Inside the existing transaction, between steps 4 and 5 (Plan 05 §4.4's numbering):
  - **4a.** If `oauth !== null`: `SELECT` `oauth_account` by `(provider, providerAccountId)`.
    Present → `oauth_account_exists` and the whole transaction rolls back. This is the
    in-transaction re-check of a precondition the route already checked, for the same reason
    steps 1–3 are re-checked there (Plan 05 §4.4): only the in-transaction check is
    authoritative under concurrency. The composite PK is the independent backstop.
  - **4b.** `INSERT` the `oauth_account` row pointing at the new `userId`.
- **Nothing else about the function changes.** It still accepts a hash and never a password
  (`P05-C5`); it still writes `role: 'user'` unconditionally (Plan 05 §8 invariant 6 — an
  OAuth signup cannot mint an admin either); it still redeems the code with
  `AND redeemed_by IS NULL`.
- **A failure anywhere leaves the invite code unredeemed and zero rows written.** Already true
  for the three existing reasons; §10.3 adds the fourth as an explicit test case.

`linkOAuthAccount()` (outcome 2 of §3.7) is a **separate, single-statement insert** in
`lib/db/repository/oauthAccounts.ts` — it creates no user, redeems no code, and needs no
transaction. Its uniqueness guarantee is the composite PK; a race between two concurrent
link attempts for the same `(provider, sub)` produces one row and one caught constraint
error, which the callback maps to "read the existing row and log that user in".

### 4.3 Migration

`0004_add_oauth_account.sql` — one `CREATE TABLE`, one `CREATE INDEX`, one
`CREATE UNIQUE INDEX`. No data, no backfill, no rebuild, no `DROP`.

**Machine-generated by `npx drizzle-kit generate`, and the body is not hand-edited.**
Plan 05 §4.5's hand-authoring exception was justified by two conditions — a DML backfill, and
SQLite's inability to add a `NOT NULL` column to a populated table — and **neither applies
here**. Plan 04 §4.3's "never hand-edit the SQL" rule is back in force. If a future reader
sees a hand-edited `0004`, that is a defect.

Verification at the phase gate, mirroring Plan 05 §4.5's three checks minus the ones about
existing data:

1. `npm test` — `lib/db/__tests__/test-db.ts` runs every migration from scratch on a fresh
   in-memory DB at module load, so malformed SQL fails every suite immediately.
2. `npx drizzle-kit generate` a second time → must report no changes.
3. Against the **real** `myagent.db` (Phase 5): a file backup first (standing practice from
   Plan 05 §4.5 step 0, kept even though this migration is additive and non-destructive —
   the discipline is cheaper than the exception), then `.schema oauth_account` shows the
   composite PK and both indexes, and existing row counts are untouched.

### 4.4 Existing data

Nothing is migrated, backfilled, or reinterpreted. Every existing `user` row keeps its
password hash and gains no `oauth_account` row. The real admin account continues to log in
with a password. The first `oauth_account` row appears the first time somebody clicks
"Continue with Google".

---

## 5. Design resolutions

### 5.1 The provider seam

```ts
// lib/auth/oauth/types.ts — no dependency on any OAuth library
export type OAuthProfile = {
  providerAccountId: string;    // stable provider-side id (Google: `sub`)
  email: string;                // asserted by the provider
  emailVerified: boolean;       // must be a real boolean; see §3.6
};

export type OAuthProvider = {
  readonly name: string;                                    // 'google'
  createAuthorizationUrl(args: {
    state: string; codeVerifier: string; nonce: string;
  }): URL;
  /** Exchanges the code and returns a VERIFIED profile. Throws OAuthError on any failure. */
  exchangeAndVerify(args: {
    code: string; codeVerifier: string; nonce: string;
  }): Promise<OAuthProfile>;
};
```

```ts
// lib/auth/oauth/providers.ts — the registry. THE seam tests mock.
export function getOAuthProvider(name: string): OAuthProvider | null;
export function listConfiguredProviders(): string[];        // [] when unconfigured
```

**Why `exchangeAndVerify` is one method rather than `exchange` + `verify`.** A caller must
never be able to hold an unverified profile. Splitting them creates a moment where the route
handler has token material and an unvalidated claim set, and a moment like that is where the
verification step eventually gets skipped in a refactor. One method returns either a verified
profile or throws. This is the same argument Plan 05 §6.1 made for putting the owner check
inside the query rather than beside it.

**Adding GitHub later, concretely** (this is the answer to the user's question, and the
design's success criterion): one file `lib/auth/oauth/github.ts` implementing the two methods
(its `exchangeAndVerify` calls `/user` and `/user/emails` instead of parsing an `id_token`,
because GitHub is not an OIDC provider), one line in the registry, two env vars, and one
button. **No new route, no schema change, no migration, no change to the callback's logic** —
the routes are `[provider]`-parametric and the `oauth_account` row is provider-keyed. That
property is the whole reason for the dynamic segment and the registry.

### 5.2 Route shape

| Option | Verdict |
|---|---|
| `GET /api/auth/oauth/google/start` as a plain `<a href>` link | **Rejected.** A GET cannot carry the invite code in a body, so it would go in the query string — putting a bearer credential into browser history, `Referer` headers, and every access log between here and the process |
| `POST` returning a `303` redirect straight to Google | **Rejected.** The client cannot then render `invalid_invite_code` inline in the form; the browser has already left |
| **`POST … /start` → `200 { authorizeUrl }` + `Set-Cookie`, client calls `window.location.assign()`** | **Chosen.** The invite code stays in a request body; validation errors render in the form the user is already looking at; the tx cookie is set on the JSON response as normal; and `sameSite=lax` blocks a cross-site POST, so login-CSRF on the start route is closed too |
| Static `google/` route pair vs. dynamic `[provider]/` | **Dynamic chosen** (§5.1). The per-provider difference is entirely inside `exchangeAndVerify`; the routes have none |

`GET /api/auth/oauth/[provider]/callback` is necessarily a GET — the provider redirects the
browser to it.

Both live under `app/api/auth/`, so the existing `route-guard.test.ts` fitness test's
`inAuthDir()` exemption already covers them: they are public by design and must not call
`authenticate()`. No change to that test's first three assertions is needed — but §10.4 adds a
fourth that pins the exemption to exactly the paths that deserve it.

### 5.3 Auto-linking is hardcoded, not a setting — **rejected option, kept as the record**

An earlier draft of this plan proposed an `oauthAutoLinkVerifiedEmail` `SETTING_DEFS` boolean
(default `true`, admin-editable in System Settings) so that §3.7's judgment call could be
reverted after deploy without a code change. **Declined at review (§16.4): "don't want to
overcomplicate."**

| Option | Verdict |
|---|---|
| `SETTING_DEFS` boolean + a System Settings toggle, read fresh at callback time | **Rejected (§16.4).** One setting row, one seed line, one UI control, and a second reachable branch through the callback — for a switch nobody has yet had a reason to flip in a five-person beta |
| An env var | **Rejected**, not seriously considered: it has the same cost as the setting and none of its after-the-fact reversibility |
| **A hardcoded `true` — i.e. no branch at all** | **Chosen.** Auto-linking on `email_verified === true` is unconditional. Changing it is a code change, which §3.7's "Accepted risk" note says plainly |

**Consequences of the decline, all of them already applied to this document** — listed
because a reader who only skims §3.7 will otherwise expect a toggle that does not exist:

- `lib/settings.ts` and `lib/db/seed.ts` are **not modified by this plan** (§2.2). This plan
  adds no setting and seeds no row, so Rules Index #47 (`onConflictDoNothing` for seed rows)
  is not engaged at all.
- `app/components/Settings/SettingsView.tsx` is untouched; System Settings gains nothing.
- **The `oauth_link_required` error code is deleted from the vocabulary** (§7.3). It was
  reachable only with the toggle off. A closed error vocabulary should not carry a code that
  no code path can produce — someone would write UI copy for a state that cannot happen.
  If auto-linking is ever restricted (§3.7's revisit trigger, or §13's row), that code comes
  back with it.
- The callback's outcome-2 branch is a plain link-then-continue with no policy read (§6).
- Phase steps **2.5 and 4.5 are removed** (§11), and the Phase 5.3 manual checklist's
  toggle-off step is replaced by a positive auto-link check.

`P05-C8` (settings stay global) is untouched — this plan simply adds no setting.

### 5.4 Where the "Continue with Google" button's visibility comes from

The button must not render when OAuth is unconfigured. Three ways:

| Option | Verdict |
|---|---|
| `NEXT_PUBLIC_GOOGLE_ENABLED` | **Rejected.** A second source of truth for "is OAuth configured", which can disagree with the first |
| `GET /api/auth/oauth/providers` fetched on mount | **Rejected.** A public route and a render flash, to answer a question the server knew before it rendered the page |
| **Server component reads `isOAuthConfigured()` and passes a prop** | **Chosen.** One source of truth, no flash, no route. Requires splitting `app/login/page.tsx` and `app/signup/page.tsx` into a server `page.tsx` plus a client form component — a small refactor that also gives the pages a natural place for future server-side data |

Note for `@dev`: `LoginForm` uses `useSearchParams()`, which in Next 15 must sit inside a
`<Suspense>` boundary when its route is statically rendered. Verify the behaviour after the
split and add the boundary in `page.tsx` if the build asks for it. (Flagged as a thing to
check, not a claim about current behaviour.)

---

## 6. The full request flow, end to end

**Leg 1 — start.** `POST /api/auth/oauth/google/start`, body
`{ mode: 'login' | 'signup', inviteCode?, shareLogsWithAdmin?, next? }`.

```
1.  checkRateLimit(request, 'oauth_start')             → 429 rate_limited
2.  getOAuthProvider(params.provider)          null    → 404 unknown_provider
    isOAuthConfigured()                        false   → 503 oauth_not_configured
3.  Validate the body:
      mode not 'login'|'signup'                        → 400 invalid_body
      mode === 'signup' and inviteCode missing         → 400 invalid_body
4.  mode === 'signup' only — cheap, NON-authoritative pre-checks, so nobody is sent through a
    Google consent screen only to be refused on the way back:
      normalizeInviteCode() fails / unknown / redeemed → 400 invalid_invite_code
      getUserCount() >= getMaxUsers()                  → 403 signups_closed
    (Authoritative versions of both re-run inside the transaction in leg 3 — §4.2.)
5.  state         = 32 random bytes, base64url
    codeVerifier  = PKCE verifier (arctic)
    nonce         = 32 random bytes, base64url
6.  authorizeUrl  = provider.createAuthorizationUrl({ state, codeVerifier, nonce })
      scope = 'openid email profile'; NO access_type=offline; NO prompt=consent
7.  200 { authorizeUrl }
      + Set-Cookie: myagent_oauth_tx = { v:1, provider, mode, state, codeVerifier, nonce,
                                         inviteCode?, consent?, next? }   (§3.5)
```

`consent` is written into the tx **only** as the literal boolean the form sent; the coercion to
`=== true` happens once, at the point of use in leg 3 (Plan 05 §8 invariant 15).

**Leg 2 — the user is at Google.** They authenticate and consent. Nothing of ours runs. If
they cancel, Google redirects to our callback with `?error=access_denied`.

**Leg 3 — callback.** `GET /api/auth/oauth/google/callback?code=…&state=…`

```
0.  Build every response through a helper that CLEARS the tx cookie (constraint 10).
    There is no exit from this handler that does not clear it.

1.  tx = readOAuthTx(request, params.provider)
      null (absent / malformed / expired / wrong provider) → 303 /login?error=oauth_state
2.  getOAuthProvider(params.provider) null                 → 303 /login?error=oauth_failed
3.  query.error present:
      'access_denied'                                      → 303 /login?error=oauth_cancelled   (not logged)
      anything else                                        → 303 /login?error=oauth_failed      (logged, code only)
4.  query.state !== tx.state, or query.code is not a string
                                                           → 303 /login?error=oauth_state
                                                              log [auth] oauth state mismatch
5.  profile = await provider.exchangeAndVerify({ code, codeVerifier: tx.codeVerifier,
                                                 nonce: tx.nonce })
      throws (network, HTTP 4xx/5xx, bad signature, wrong aud/iss, expired, nonce mismatch)
                                                           → 303 /login?error=oauth_failed
                                                              log the OAuthError CODE only —
                                                              never the provider body, never a token
6.  profile.emailVerified !== true                         → 303 /login?error=oauth_email_unverified
    email = profile.email.trim().toLowerCase()             (same normalization as §4.1)

7.  existing = getOAuthAccount(provider, profile.providerAccountId)
      FOUND → user = getUserById(existing.userId)
                null (row deleted under a live link) → 303 /login?error=oauth_failed
                                                        log [auth] dangling oauth link
              → go to 11                                   ← OUTCOME 1: login

8.  byEmail = getUserByEmail(email)
      FOUND → linkOAuthAccount(provider, providerAccountId, byEmail.id, profile.email)
              (unique-violation race → re-read and continue)
              log [auth] oauth account auto-linked provider=<p> userId=<id>
              user = byEmail → go to 11                    ← OUTCOME 2: auto-link
              UNCONDITIONAL — no policy read, no toggle (§5.3). The only precondition is
              step 6's emailVerified === true, and its residual risk is accepted (§3.7).

9.  tx.mode !== 'signup'  OR  tx.inviteCode absent
                                                           → 303 /signup?error=oauth_no_account
                                                              (constraint 6 — never a silent signup)

10. result = createUserWithInvite({
      email, passwordHash: NO_PASSWORD_SENTINEL, code: tx.inviteCode,
      maxUsers: getMaxUsers(), shareLogsWithAdmin: tx.consent === true,
      oauth: { provider, providerAccountId: profile.providerAccountId,
               providerEmail: profile.email },
    })
      'invalid_code'          → 303 /signup?error=invalid_invite_code
      'cap_reached'           → 303 /signup?error=signups_closed
      'email_exists'          → 303 /login?error=oauth_failed   (lost a race with step 8; log it)
      'oauth_account_exists'  → re-read the link and log that user in (lost a race with step 7)
      ok                      → user = result.user            ← OUTCOME 3: create

11. token = await signSessionToken({ sub: user.id, email: user.email })
    303 → safeNext(tx.next) ?? '/'          ← validated server-side with ^/(?!/) (Plan 05 §3.6)
        + Set-Cookie: myagent_session (httpOnly, sameSite=lax, secure in prod, path=/,
                      maxAge = getSessionTtlSeconds())   ← identical options to the login route
        + tx cookie cleared
```

Two properties worth naming because they are easy to lose in a refactor:

- **Step 11 is the only place in the OAuth flow that issues a session**, and it is reached by
  all three outcomes. There is no early `Set-Cookie`.
- **A `Set-Cookie` on a 303 responding to a cross-site top-level navigation is delivered
  normally** for a `SameSite=Lax` cookie — Lax restricts *sending* on cross-site subrequests,
  not setting on a top-level GET. This is worth stating because it is the step people expect
  to fail.

---

## 7. API surface

### 7.1 Endpoints

**New:**

| Method | Path | Auth | Request | Response | Errors | Side effects |
|---|---|---|---|---|---|---|
| `POST` | `/api/auth/oauth/[provider]/start` | public | `{ mode: 'login'\|'signup', inviteCode?, shareLogsWithAdmin?, next? }` | `200 { authorizeUrl }` + `Set-Cookie: myagent_oauth_tx` | `400 invalid_body`; `400 invalid_invite_code`; `403 signups_closed`; `404 unknown_provider`; `429 rate_limited`; `503 oauth_not_configured` | Sets one short-lived cookie. **No DB write** |
| `GET` | `/api/auth/oauth/[provider]/callback` | public | query `code`, `state`, or `error` | **`303` redirect** + `Set-Cookie: myagent_session` on success; tx cookie cleared on every path | All failures are `303` to `/login` or `/signup` with `?error=<code>` (§7.3) — never a JSON body (constraint 12) | On outcome 2: one `oauth_account` insert. On outcome 3: one user + one `oauth_account` + one code redemption, in one transaction |

**Modified:**

| Path | Change |
|---|---|
| `GET /api/account` | Response gains `linkedProviders: string[]` (e.g. `['google']`, or `[]`). Read-only; still only `session.userId`'s own row (Plan 05 §8 invariant 17, unchanged) |
| `POST /api/auth/login` | **No contract change.** One log line reworded (§3.8) |

**Backward compatibility.** No existing success shape or error code changes. `GET /api/account`
gains a field additively; its only consumer is this app's own `/account` page, updated in the
same plan. No versioning is warranted.

### 7.2 Pages

| Path | Change |
|---|---|
| `/login` | Split into a server `page.tsx` + client `LoginForm`. Gains "Continue with Google" (when configured), a static "Signed up with Google?" hint, and rendering for the `?error=` vocabulary |
| `/signup` | Same split. **The Google path requires the invite code field to be filled and the §5.6 consent question to be answered before the button is enabled** — identical preconditions to the password submit, because it leads to the same account creation |
| `/account` | One new read-only line: "Signed in with: password / Google (`<providerEmail>`)". No link/unlink controls (out of scope) |

**The signup page's Google path is the one place the two flows must not diverge.** If the
consent block can be skipped by clicking the Google button, the §5.6 model is broken for every
OAuth user, and it fails *open* in the UI even though the server fails closed (`tx.consent ===
true`). The UI precondition is a Phase 4 requirement and a Phase 5 manual-checklist item.

### 7.3 Error handling

**JSON errors (the `start` route) — existing vocabulary, existing shapes:**

| Scenario | HTTP | Body | Logged? |
|---|---|---|---|
| Malformed body / bad `mode` / signup without a code | 400 | `{ error: 'invalid_body' }` | no |
| Invite code unknown, redeemed, or malformed | 400 | `{ error: 'invalid_invite_code' }` — **one code for all three**, as Plan 05 §7.3 | yes |
| `maxUsers` already reached | 403 | `{ error: 'signups_closed' }` | yes |
| Unknown provider in the path | 404 | `{ error: 'unknown_provider' }` | no |
| Rate limited | 429 | `{ error: 'rate_limited', retryAfterSeconds }` + `Retry-After` | yes |
| OAuth not configured on this deployment | 503 | `{ error: 'oauth_not_configured' }` | yes — a configured button leading here is a deployment fault |

**Redirect errors (the callback) — a closed vocabulary rendered by `/login` and `/signup`:**

| `?error=` | Meaning | Redirects to | Message shown | Logged? |
|---|---|---|---|---|
| `oauth_cancelled` | The user pressed Cancel at Google | `/login` | "Sign-in cancelled." | no |
| `oauth_state` | tx cookie missing/expired/malformed, or `state` mismatch | `/login` | "That sign-in link expired or didn't match. Please try again." | **yes** — could be an attempted CSRF, could be a 10-minute-old tab |
| `oauth_failed` | Token exchange failed, `id_token` invalid, or a dangling link | `/login` | "Google sign-in failed. Please try again." | **yes**, code only |
| `oauth_email_unverified` | `email_verified !== true` | `/login` | "Your Google account's email address isn't verified, so it can't be used to sign in here." | yes |
| `oauth_no_account` | Login-mode flow, no account exists | `/signup` | "No account yet. Sign up with an invite code first." | no |
| `invalid_invite_code` | Authoritative in-transaction rejection | `/signup` | Reuses the existing signup copy | yes |
| `signups_closed` | `maxUsers` reached, caught in-transaction | `/signup` | Reuses the existing signup copy | yes |

**Rules that shape this table:**

- **No provider text is ever surfaced.** Google's error bodies can contain client identifiers
  and internal descriptions. The user sees our sentence; the console sees our code.
- **`oauth_state` deliberately does not distinguish** "no cookie", "expired cookie",
  "malformed cookie", and "state mismatch". Same reasoning as Plan 05's single
  `invalid_invite_code`: the distinction helps only someone probing.
- **An unknown `?error=` value renders the generic message**, so a hand-crafted
  `/login?error=<script>` cannot inject copy. Codes are matched against the closed list; the
  value is never rendered.
- **Nothing here is a `403` or a `401`.** The callback's failures are all "start over",
  which is a redirect. Plan 05 §7.3's status-code table is untouched.
- **The vocabulary is exactly this table — there is deliberately no `oauth_link_required`.**
  An earlier draft carried one, reachable only when auto-linking was switched off; the switch
  was declined at review (§5.3, §16.4), so the code is gone rather than left dangling. It
  returns if and when auto-linking is ever restricted (§3.7's revisit trigger).

---

## 8. Business rules

### Invariants (always true)

1. Exactly one implementation of session-token verification exists
   (`lib/auth/jwt.ts`); `middleware.ts` calls it (constraint 1, §3.1).
2. `middleware.ts` performs no database access and is never the authorization boundary
   (`P05-C4`, unchanged) — and nothing in its transitive import graph reaches `lib/db/`,
   `next/headers`, `bcryptjs`, or `node:*` (constraint 3).
3. The JWT's `exp` and the session cookie's `maxAge` always come from the same
   `getSessionTtlSeconds()` call in the same request (constraint 4).
4. An invalid `SESSION_TTL_SECONDS` prevents the process from starting; it never silently
   becomes the default.
5. No OAuth provider token — access, refresh, or `id_token` — is persisted, logged, or
   returned to any client (constraint 8).
6. A `user` row is never created from an OAuth callback except by `createUserWithInvite()`,
   which redeems an invite code and re-checks `maxUsers` in the same transaction
   (constraint 5).
7. An account is created only from a flow whose tx cookie says `mode: 'signup'`
   (constraint 6). No `mode: 'login'` flow creates anything.
8. OAuth signup writes `role: 'user'` unconditionally — inherited from
   `createUserWithInvite()`, which accepts no role parameter from anywhere (Plan 05 §8
   invariant 6, still structurally true).
9. A user's identity at a provider is `(provider, providerAccountId)`. A later sign-in never
   rewrites `user.email` from a provider claim (constraint 7).
10. An account is linked or created from an OAuth profile only when
    `emailVerified === true` — the boolean, never a coerced value (§3.6). That is the **only**
    precondition on auto-linking: it is unconditional otherwise, with no domain restriction and
    no runtime toggle (§5.3, §16.4), and its residual risk is reviewed and accepted (§3.7).
11. The `id_token` is accepted only when its signature, `iss`, `aud`, `exp`, and `nonce` all
    validate. `aud` must equal this deployment's `GOOGLE_CLIENT_ID`.
12. The OAuth transaction cookie is cleared on **every** exit path from the callback
    (constraint 10), and its `path` on clear matches its `path` on set.
13. The invite code never appears in a URL, a query string, a `state` value, a log line, or
    any response body (§3.5; extends `P05-C7`).
14. Consent for activity-log sharing is granted only by a literal boolean `true` surviving the
    round trip (`tx.consent === true`) — Plan 05 §8 invariant 15, now enforced on a second
    path.
15. A Google-only user has `passwordHash === NO_PASSWORD_SENTINEL` and can never authenticate
    by password — rejected at the route *and* inside `verifyPassword()` (Plan 05 §8
    invariant 9, verified still true in §3.8).
16. The redirect URI sent to a provider is always derived from `OAUTH_REDIRECT_BASE_URL`,
    never from a request header (§3.4).
17. `arctic` is imported by exactly one file, and by no test (constraints 9 and 11).

### Policies (configurable)

> **This plan adds no database-backed setting.** The one that was proposed
> (`oauthAutoLinkVerifiedEmail`) was declined at review (§5.3, §16.4), so everything below is
> either an environment variable or a deployment-shape fact — nothing here is editable from
> System Settings, and `lib/settings.ts` is untouched.

18. **`SESSION_TTL_SECONDS`** — env var, default 7 days, bounds 60 s … 90 d. Affects only
    tokens issued after a restart (§3.2).
19. **OAuth is optional per deployment.** All three variables set → enabled; none set →
    disabled and the button is not rendered; some set → the process refuses to start (§3.4).
20. **Scopes are fixed at `openid email profile`**, with no offline access. Adding a scope is
    a code change and should be treated as a design decision, not configuration.
21. **`maxUsers` counts every account regardless of how it was created.** A Google signup and
    a password signup consume the same seat and the same invite code supply.

### State transitions

22. **OAuth login (existing link):** start → tx cookie → Google → callback → state match →
    exchange + verify → `oauth_account` hit → session issued → redirect to `next`.
23. **OAuth auto-link:** as 22, but `oauth_account` misses and `getUserByEmail` hits → link row
    inserted **unconditionally** (invariant 10; no policy read) → session issued. **No invite
    code consumed, no new user.**
24. **OAuth signup:** as 22, but both lookups miss → `mode` must be `'signup'` → one
    transaction: code validated → cap checked → email checked → `user` inserted with
    `passwordHash = ''` → `oauth_account` inserted → code redeemed → session issued.
25. **OAuth cancelled or failed:** tx cookie cleared → redirect with an `?error=` code →
    **nothing written, no code redeemed, no session issued.**
26. **Password login, unchanged:** Plan 05 §8 sequence 26 in full. A Google-only account
    reaches the sentinel branch and gets the same `401` as a wrong password.
27. **Session lifetime change:** operator edits `SESSION_TTL_SECONDS` → restarts → *new*
    logins get the new lifetime; existing sessions keep theirs until `exp` (§3.2).

---

## 9. Non-functional requirements

- **Performance.**
  - Middleware after §3.1: unchanged in shape — one HS256 verify, no I/O. Target **< 1 ms**.
    The extra import adds bundle size, not latency.
  - `start`: two indexed reads at most (invite code, user count) plus random generation.
    Target **< 5 ms**.
  - `callback`: dominated by one outbound HTTPS round trip to Google's token endpoint
    (typically 100–400 ms, entirely outside our control), plus a cached JWKS lookup (a second
    outbound request on the first call after a cold start only), plus 1–3 indexed queries.
    Target **< 600 ms p95** end to end; no target is meaningful for the network leg.
  - `getSessionTtlSeconds()` parses one env var per call — nanoseconds, called once per
    issuance. Not cached, deliberately: caching would create a state where a restart is
    required for correctness in a way nothing announces.
- **Security.**
  - CSRF on the OAuth flow: `state` + an httpOnly, path-scoped, 10-minute, single-use cookie.
  - Code interception: PKCE (`code_verifier`/`code_challenge`) on every flow.
  - Token replay: `nonce` bound into the `id_token` and checked (defence-in-depth over PKCE).
  - Audience confusion: `aud` pinned to this deployment's client id (§3.6).
  - Open redirect: `next` survives in a server-side cookie and is validated on consumption
    with Plan 05 §3.6's `^/(?!/)` rule.
  - Credential exposure: the invite code never enters a URL; `GOOGLE_CLIENT_SECRET` never
    leaves the server; no provider token is stored.
  - Enumeration: the login form gains no new oracle — the sentinel path returns the same
    `401`, and the "Signed up with Google?" hint is static (§3.8).
  - **Residual — reviewed and accepted 2026-07-31, not defaulted (§3.7 "Accepted risk",
    §16.5).** Auto-linking on `email_verified` carries the Google Workspace domain-takeover
    vector, and it is accepted **for all domains**: the `hd`-claim restriction (option b), the
    never-auto-link posture (option c), and an admin kill switch (option d) were each offered
    and each declined. There is therefore **no runtime mitigation** — reverting this is a code
    change. The compensating facts are the small, invite-gated, personally-known user
    population and the `[auth] oauth account auto-linked` log line. §3.7 carries the revisit
    trigger; §13 and Rules Index #72 carry it forward into `TechDesign.md`.
  - **Residual, unchanged from Plan 05:** no server-side session revocation. A Google sign-in
    produces the same cookie with the same properties, so this plan neither improves nor
    worsens it — but it does mean *revoking access at Google does not end a MyAgent session*.
    That is worth one sentence in `docs/user-guide.md`, because it is a reasonable thing for a
    user to assume works.
- **Scalability at 10×.** ~50 users. The OAuth path adds one row per user, one index lookup
  per login, and one outbound request per login. Nothing here degrades. The `oauth_start`
  rate limiter inherits §3.8's per-process limitation (P05n), unchanged.
- **Data integrity.** Account creation stays one transaction with all four preconditions
  re-checked inside it (§4.2). The `(provider, providerAccountId)` composite PK and the
  `(userId, provider)` unique index are the independent backstops for the two link races. No
  transaction is held open across the network call to Google — the exchange completes
  *before* the transaction opens, which is Plan 04's rule and remains true here.
- **Observability.** Console prefix `[auth]` for: state mismatches, exchange/verification
  failures (**code only**), unverified-email rejections, auto-links, and dangling links. Never
  a token, never an invite code, never a `client_secret`, never a provider response body.
  **The auto-link line is not routine logging** — it is the audit trail §3.7's accepted risk
  depends on, and it is the one line here that should survive any future log-noise cleanup.
- **Compliance.** One new personal datum is stored: `oauth_account.providerEmail`. It is the
  same email already in `user.email` in the normal case, is displayed only to its own owner
  and the admin, and is covered by the same "no formal GDPR workflow yet" stance
  (Plan 05 §9). `docs/user-guide.md` must say that signing in with Google tells this app your
  Google email address and nothing else — no contacts, no Drive, no profile picture, no
  ongoing access.

---

## 10. Testing approach

Baseline: **368 tests, all green** (per `plans/roadmap.md`, 2026-07-31). That number only
goes up.

### 10.1 The rule that shapes everything here

**No automated test may contact Google** (constraint 11), for the same reason no automated
test may contact Anthropic (`CLAUDE.md` standing rule 2). The mechanism is the same one the
existing suites use for `lib/ai/*`: mock this repo's own seam, never the third party's
internals.

```ts
vi.mock('@/lib/auth/oauth/providers.js', () => ({
  getOAuthProvider: vi.fn(() => fakeProvider),      // reassignable per test
  listConfiguredProviders: vi.fn(() => ['google']),
}));
```

`fakeProvider.exchangeAndVerify` is a `vi.fn()` returning a profile or throwing an
`OAuthError`. No test constructs a real `Google` instance, no test calls
`createRemoteJWKSet`, and no test sets `GOOGLE_CLIENT_SECRET` to a real value.

### 10.2 Mocking the session — unchanged

`getSession()` remains the single seam (Plan 05 §10.2). The OAuth routes are public and call
it not at all, so most of the new suites need no session mocking whatsoever — they assert on
`Set-Cookie` headers and on database state.

### 10.3 New and modified test files

| File | Cases |
|---|---|
| `lib/auth/__tests__/sessionTtl.test.ts` | Unset → 604800; valid value → parsed; `'0'`, `'-1'`, `'abc'`, `'60.5'`, `'99999999'` each **throw**; `assertServerEnv()` throws on an invalid value; the JWT's `exp` and the returned `maxAge` derive from the same number |
| `lib/auth/oauth/__tests__/tx.test.ts` | Round-trip build→read; malformed base64 → null; wrong `v` → null; wrong `provider` → null; the cookie attributes are exactly `HttpOnly`, `SameSite=Lax`, `Path=/api/auth/oauth`, `Max-Age=600`; **`clearOAuthTxOn()` emits the identical `Path`** (the silent-no-op bug) |
| `lib/auth/oauth/__tests__/google-idtoken.test.ts` | Against a **locally generated** HS256/RS256 key pair with an injected JWKS — never Google's: valid token → profile; wrong `aud` → throws; wrong `iss` → throws; expired → throws; `nonce` mismatch → throws; `email_verified: false` → verified profile with `emailVerified: false`; `email_verified: "true"` (string) → `emailVerified: false`; missing `sub` → throws |
| `lib/db/repository/__tests__/oauthAccounts.test.ts` | `linkOAuthAccount` inserts and is readable; a duplicate `(provider, sub)` violates the PK; a second provider for the same user is allowed; a **second Google account** for the same user violates `oauth_account_user_provider_unique`; `listOAuthAccountsForUser` returns `[]` for a password-only user |
| `lib/db/repository/__tests__/users.test.ts` *(modified)* | `createUserWithInvite` with `oauth: {...}` creates **both** rows and redeems the code; with `oauth: null` behaves exactly as before; `oauth_account_exists` → **zero rows written and the code still unredeemed**; a Google signup with `passwordHash: ''` stores the sentinel |
| `app/api/auth/__tests__/oauth-start.test.ts` | `mode:'signup'` without a code → 400; unknown/redeemed code → `400 invalid_invite_code`; cap reached → `403 signups_closed`; unknown provider → 404; unconfigured → 503; rate limit trips; success returns an `authorizeUrl` whose `state` matches the cookie's and whose `redirect_uri` is built from the env var; **`inviteCode` appears nowhere in the returned URL** |
| **`app/api/auth/__tests__/oauth-callback.test.ts`** | **The crown jewel — see 10.4** |
| `app/api/auth/__tests__/auth.test.ts` *(modified)* | A Google-only user (`passwordHash: ''`) attempting password login gets `401 invalid_credentials` — the same body as a wrong password |
| `lib/db/__tests__/migration.test.ts` *(modified)* | `oauth_account` exists with the expected columns; its PK is `(provider, provider_account_id)`; `oauth_account_user_idx` and `oauth_account_user_provider_unique` exist |
| `app/api/__tests__/route-guard.test.ts` *(modified)* | Three new fitness assertions — §10.4 |

### 10.4 The tests that make this plan verifiable

**`app/api/auth/__tests__/oauth-callback.test.ts` — table-driven, every path:**

| Scenario | Expected |
|---|---|
| No tx cookie | 303 `/login?error=oauth_state`; **no DB write** |
| Expired / malformed / wrong-provider tx cookie | 303 `/login?error=oauth_state` |
| `state` mismatch | 303 `/login?error=oauth_state`; **`exchangeAndVerify` never called** |
| `?error=access_denied` | 303 `/login?error=oauth_cancelled`; provider never called |
| `exchangeAndVerify` throws | 303 `/login?error=oauth_failed`; **no session cookie**; no DB write |
| `emailVerified: false` | 303 `/login?error=oauth_email_unverified`; **no link, no user** |
| Existing `oauth_account` | 200-equivalent 303 to `/`; session cookie set; **no new rows** |
| Existing link, `user` row deleted | 303 `/login?error=oauth_failed`; no session cookie |
| Email matches an existing **password** user | one `oauth_account` row inserted pointing at that user; session set; **the `user` row is unchanged — asserted field by field, `email` and `passwordHash` included** (invariant 9: a provider claim never rewrites `user.email`); **no invite code redeemed, no second user created** |
| Email matches, and the tx carries a valid invite code anyway | **still a link, not a signup** — the code stays unredeemed. *(This is the case that catches an implementation which falls through to step 10 after linking)* |
| No match, `mode: 'login'` | 303 `/signup?error=oauth_no_account`; **zero rows written** |
| No match, `mode: 'signup'`, valid code | `user` + `oauth_account` created, code redeemed, `passwordHash === ''`, `role === 'user'`, session set |
| Same, code already redeemed | 303 `/signup?error=invalid_invite_code`; **zero rows written** |
| Same, `maxUsers` reached | 303 `/signup?error=signups_closed`; **zero rows, code unredeemed** |
| Same, `consent` absent / `null` / `"true"` / `1` | user created with `shareLogsWithAdmin === false`; only literal `true` → `true` *(Plan 05 invariant 15, on the new path — one case per malformed input)* |
| `tx.next = '/agents/abc'` | redirect target is `/agents/abc` |
| `tx.next = 'https://evil.example'` or `'//evil.example'` | redirect target is `/` |
| **Every row above** | **the tx cookie is cleared in the response** — asserted as a parametrized loop over all scenarios, not per-case (constraint 10) |
| **Every failing row above** | **no `myagent_session` cookie is set** — same parametrized treatment |

The last two rows are the point of the file. A callback that returns the right status while
leaving a replayable transaction cookie behind, or while issuing a session on a failure path,
would pass a status-only assertion. Plan 05 §10.4 applied the same discipline to its `429`
rows and its mutating `404`s.

**`app/api/__tests__/route-guard.test.ts` — three new fitness assertions:**

1. **One JWT verifier.** No file other than `lib/auth/jwt.ts` imports `jwtVerify` or `SignJWT`
   from `jose`; `middleware.ts` contains `verifySessionToken` and does **not** contain
   `jwtVerify(` (constraint 1). *This is the assertion that stops §3.1's defect from growing
   back, and it is the reason the fix is worth doing as a plan item rather than a drive-by
   edit.*
2. **Middleware's import closure is Edge-clean.** Starting from `middleware.ts`, follow every
   relative and `@/`-aliased import transitively and assert none resolves under `lib/db/`, and
   that no file in the closure imports `next/headers`, `bcryptjs`, or `node:*` (constraint 3).
   ~30 lines of `readFileSync` + regex; no dependency.
3. **One OAuth-library importer.** `arctic` is imported by exactly `lib/auth/oauth/google.ts`,
   and by no file under any `__tests__/` directory (constraints 9 and 11). Directly modelled on
   `lib/ai/__tests__/architecture.test.ts`'s one-SDK-importer test (Rules Index #41).

### 10.5 Component tests — the same accepted gap, restated once more

`LoginForm`, `SignupForm`, and `GoogleButton` ship with **no component tests**, consistent
with `plans/roadmap.md` TODO 1 and Plan 05 §10.5. **One consequence must not hide in that
gap:** whether the signup page's Google button is genuinely disabled until the invite code is
filled *and* the consent question answered (§7.2). The server fails closed — an absent
`tx.consent` yields `false`, an absent code yields `oauth_no_account` — so a UI mistake cannot
grant consent or bypass admission. But it could produce a user who was never *asked*, which is
a §5.6 violation in substance. It is an explicit Phase 5 manual-checklist item, named there.

### 10.6 The live-flow warning — read this before Phase 5

**Exercising the real Google sign-in flow in a browser is a live external call.** It requires
real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, contacts `accounts.google.com` and
`oauth2.googleapis.com`, and — on a successful signup — **writes a real user row into the real
`myagent.db`**.

This is not literally `CLAUDE.md` standing rule 2 (which names Anthropic and money). It is the
same *spirit*: an action that reaches outside this machine and mutates real state, which a
task description might seem to imply should just happen. **Treat it the same way — stop and
ask the user before running it**, say exactly what will be contacted and what will be written,
and do not "just try it" to see whether the flow works. Everything except the last leg is
verifiable offline with mocks (§10.3), and Phase 5 is sequenced so the live pass is the very
last thing and is explicitly gated on the user's go-ahead.

There is also a **manual prerequisite only the user can perform**: creating an OAuth client in
the Google Cloud console, choosing the consent-screen mode (a project in "Testing" mode limits
sign-in to explicitly listed test accounts — likely the right setting for a closed beta), and
registering the exact redirect URI. Phase 5.0 prints the exact URI to paste. This blocks the
live pass and nothing else.

---

## 11. Implementation sequence

Phases are gated. Every gate includes `npx tsc --noEmit` clean and `npm test` green. Do not
start a phase before its predecessor's gate passes.

### Phase 0 — Workstreams A and B *(small, independent, no new dependency)*

| Step | File | Depends on |
|---|---|---|
| 0.1 | `lib/auth/constants.ts` — `DEFAULT_SESSION_TTL_SECONDS`, bounds, `getSessionTtlSeconds()` | — |
| 0.2 | `lib/auth/jwt.ts` (1 line); `app/api/auth/login/route.ts`, `signup/route.ts` (`maxAge`) | 0.1 |
| 0.3 | `lib/env.ts` — `assertServerEnv()` calls `getSessionTtlSeconds()`; `.env.example` | 0.1 |
| 0.4 | `lib/auth/__tests__/sessionTtl.test.ts` | 0.1 |
| 0.5 | **`middleware.ts`** — import `verifySessionToken`, delete `verifyToken()`, add the `/api/auth/oauth/` prefix to the allowlist (§3.1) | — |
| 0.6 | `app/api/__tests__/route-guard.test.ts` — fitness assertions 1 and 2 (§10.4) | 0.5 |

**Gate 0:** `tsc` clean; 368 + new tests green; **the app's behaviour is unchanged** with no
`SESSION_TTL_SECONDS` set. This phase is independently shippable and independently revertable,
and does **not** depend on anything in workstream C — if the OAuth review stalls, A and B can
land alone.

### Phase 1 — OAuth foundations *(built and tested, wired to nothing)*

| Step | File |
|---|---|
| 1.1 | `npm i arctic` (pin `^3`). **Confirm the installed API surface against §3.3's note before writing `google.ts`** |
| 1.2 | `lib/auth/oauth/types.ts` — the seam's vocabulary, no library import |
| 1.3 | `lib/auth/oauth/tx.ts` (+ `tx.test.ts`) |
| 1.4 | `lib/env.ts` — `getOAuthConfig()`, `isOAuthConfigured()`, the all-or-nothing + URL validation in `assertServerEnv()` (§3.4); `.env.example` |
| 1.5 | `lib/auth/oauth/google.ts` (+ `google-idtoken.test.ts` against a locally generated key set) |
| 1.6 | `lib/auth/oauth/providers.ts` — the registry |
| 1.7 | `route-guard.test.ts` — fitness assertion 3 (one `arctic` importer) |

**Gate 1:** auth suites green; nothing outside `lib/auth/oauth/` imports any of it; the app is
byte-for-byte unchanged in behaviour; fully revertable by deleting one folder.

### Phase 2 — Schema and repository

| Step | File |
|---|---|
| 2.1 | `lib/db/schema.ts` — `oauthAccount` (§4.1) |
| 2.2 | `npx drizzle-kit generate` → `0004_*` **machine-generated, not hand-edited** (§4.3) |
| 2.3 | `lib/db/repository/oauthAccounts.ts` + barrel |
| 2.4 | `lib/db/repository/users.ts` — `createUserWithInvite`'s `oauth` field and the fourth reason (§4.2); update the one existing call site in `app/api/auth/signup/route.ts` to pass `oauth: null` |
| 2.5 | Tests: `oauthAccounts.test.ts`; the `users.test.ts` additions; the `migration.test.ts` additions |

*(The pre-review draft had a step 2.5 adding `oauthAutoLinkVerifiedEmail` to `lib/settings.ts`
+ `lib/db/seed.ts`; it was **removed** when the setting was declined — §5.3, §16.4 — and the
test step moved up into 2.5. `lib/settings.ts` and `lib/db/seed.ts` are not touched by this
plan at all.)*

**Gate 2:** `tsc` clean; all tests green; **the existing password signup path behaves
identically** (asserted by the unmodified portions of `auth.test.ts`).

### Phase 3 — The two routes

| Step | File |
|---|---|
| 3.1 | `app/api/auth/oauth/[provider]/start/route.ts` (+ `oauth-start.test.ts`) |
| 3.2 | `app/api/auth/oauth/[provider]/callback/route.ts` (+ `oauth-callback.test.ts`, §10.4) |
| 3.3 | `app/api/auth/login/route.ts` — the log-line rewording (§3.8); `auth.test.ts`'s Google-only case |
| 3.4 | `app/api/account/route.ts` — `linkedProviders` |

**Gate 3:** the full callback table (§10.4) is green, including the two parametrized
invariants (tx cookie always cleared; no session on any failure path). **The UI still has no
Google button**, so the flow is unreachable from the app — deliberate, so Phase 4 is a single
reviewable change.

### Phase 4 — UI

| Step | File |
|---|---|
| 4.1 | Split `app/login/page.tsx` → server `page.tsx` + `app/components/Auth/LoginForm.tsx`; render the `?error=` vocabulary; add the static "Signed up with Google?" hint |
| 4.2 | Split `app/signup/page.tsx` → server `page.tsx` + `app/components/Auth/SignupForm.tsx`; render `?error=`; **gate the Google button on invite code filled AND consent answered** (§7.2) |
| 4.3 | `app/components/Auth/GoogleButton.tsx` |
| 4.4 | `app/components/Account/AccountView.tsx` — the "Signed in with" line |

*(A step 4.5 adding an `oauthAutoLinkVerifiedEmail` toggle to `SettingsView.tsx` existed in
the pre-review draft and was **removed** with the setting — §5.3, §16.4. System Settings gains
nothing from this plan.)*

**Layout note (standing rule 4) — NOT waived, and no detour needed. Confirmed at review
(§16.6).** Plan 05 §16.11 waived the mockup detour once, for its own five form surfaces, and
was explicit that it was *"a one-time exception for this plan's surfaces, not a change to the
standing rule."* **This plan does not inherit or extend that waiver**, and deliberately does
not claim one. It relies instead on the standing rule's own text — *"this rule is about
efficiency of iteration, not process for its own sake — a trivial one-line style tweak doesn't
need a mockup detour"* — because adding one branded button plus a divider to two existing
forms, and one read-only line to `/account`, raises no layout question: the forms' structure
is unchanged and every token already exists. **Build 4.1–4.4 directly.** The standing rule
remains in full force for anything touching the workbench shell.

**Gate 4:** `tsc` clean; all tests green; the button is absent when OAuth is unconfigured; no
bare `fetch('/api/` was introduced (the existing fitness test covers this — note that
`app/login/` and `app/signup/` are already excluded from it, and `GoogleButton.tsx` lives
under `app/components/Auth/`, which is **not** excluded, so it must use `apiFetch`… **except**
that `apiFetch` redirects to `/login` on a `401`, which the start route never returns.
Decision: `GoogleButton` uses `apiFetch` for consistency; if the fitness test's exclusion list
needs adjusting instead, adjust the list, not the component).

### Phase 5 — Configuration and live verification

| Step | Action |
|---|---|
| 5.0 | **Prerequisite, user-performed:** create the Google Cloud OAuth client. Print the exact redirect URI (`<OAUTH_REDIRECT_BASE_URL>/api/auth/oauth/google/callback`) and the consent-screen/test-user guidance for them to paste. **Nothing in this phase proceeds without it** |
| 5.1 | Set the three env vars locally; restart; confirm the boot check passes and that removing one of the three makes the process refuse to start (§3.4) |
| 5.2 | `README.md` — the four env vars, the redirect-URI format, the HTTPS requirement, the "what changing `SESSION_TTL_SECONDS` does and does not do" note (§3.2), and the "rotate `JWT_SECRET` to kill all sessions" operational answer |
| 5.3 | **Manual checklist, dev server + browser — with "Live LLM calls" OFF throughout (no LLM call is involved in any of this, but the setting stays off so an accidental navigation cannot spend anything):** the Google button is hidden when unconfigured and shown when configured; on `/signup` the button is **disabled** until the invite code is filled and consent is answered; sign in with Google as a brand-new identity using a valid code → account created, session live, `/account` shows "Signed in with: Google"; the code is now spent; attempt the same code again → refused; sign out and sign in with Google again → logs straight in, no second account, no second code consumed; press **Cancel** at Google → lands back on `/login` with the cancelled message and no session; hand-craft `/api/auth/oauth/google/callback?code=x&state=y` with no tx cookie → the state error, no session; log in with the **password** account and confirm it still works unchanged; type a Google-only account's email into the password form → the same generic "Incorrect email or password"; **and the auto-link path end to end (§3.7)** — sign in with Google using the Google account whose email matches an **existing password account**, and confirm it (i) logs into *that* account rather than creating a second one, (ii) consumes **no** invite code, (iii) leaves that user's `email` and `password_hash` unchanged in the DB so the password still works afterwards, and (iv) writes exactly one `[auth] oauth account auto-linked` line |
| 5.4 | Set `SESSION_TTL_SECONDS=120`, restart, log in, wait, confirm the session expires and the `?next=` round trip returns to the right page; then unset it and confirm 7 days returns. Confirm an invalid value refuses to boot |
| 5.5 | **Clean up:** delete any test accounts and their `oauth_account` rows from the real DB, exactly as the Plan 05 pass did |
| 5.6 | **Shut the dev server down** (standing rule 3) |

**⚠ 5.3 and 5.4 involve real Google endpoints and real DB writes. Per §10.6, confirm with the
user before starting them.**

### Phase 6 — Documentation sync

| Step | File |
|---|---|
| 6.1 | `architecture/TechDesign.md` — the `OAuthAccount` entity; the `createUserWithInvite` extension; **Rules Index #63–#71** (§15); the Deferred Decisions edits (§13), including closing **P05a/P05b** and pointing **P05f/P05g** at this plan |
| 6.2 | `README.md` (from 5.2, if not already done) |
| 6.3 | `docs/user-guide.md` — signing in with Google; that it still needs an invite code; what Google is told (nothing) and what we are told (your email address); that revoking access at Google does **not** end an active session here; that a Google-only account has no password |
| 6.4 | `plans/roadmap.md` — TODO item 2 → "What's built". **Do not touch until the user has reviewed the completed build** |
| 6.5 | `CHANGELOG.md` + `CLAUDE.md` — an entry and a pointer, in the established shape |

### 11.1 Dependencies and parallelization

```
Phase 0 ─────────────────────────────────────────────► (independently shippable)

Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6
                                        ▲
              Phase 5.0 (user's console setup) ────────────┘  (can happen any time; blocks 5.1+)
```

- **Phase 0 is independent of everything else** and should land first regardless of what
  happens to workstream C in review. It is the only part of this plan that fixes an existing
  defect.
- Phase 5.0 is user-performed and can be started the moment the plan is approved — it is the
  longest-latency item and blocks nothing until Phase 5.
- Phase 4.1/4.2's page split can be done in parallel with Phase 3 by a second worker; 4.3
  needs Phase 3's routes to exist.

### 11.2 Risk per phase

| Phase | Risk | Mitigation |
|---|---|---|
| 0 | Importing `lib/auth/jwt.ts` breaks the Edge build via `server-only` | **Verified false** against the installed Next 15.5.22 (§3.1). Additionally, `npm run build` is an explicit gate-0 check — not just `tsc` and tests, because this is the one failure mode neither would catch |
| 0 | Middleware later grows an import that reaches the DB | Fitness assertion 2 (§10.4), written in the same phase as the fix |
| 0 | An operator sets a bad `SESSION_TTL_SECONDS` and locks everyone into 60-second sessions | Bounds + boot-time throw; 5.4 exercises it deliberately |
| 1 | `arctic`'s installed API differs from the documented one | 1.1 confirms before 1.5 is written; everything above the seam is written against our own types, so the blast radius is one file |
| 2 | Extending `createUserWithInvite` breaks the working password signup | `oauth` is required-and-nullable, so `tsc` enumerates every call site; the unmodified portions of `users.test.ts` and `auth.test.ts` are the regression net |
| 3 | The callback issues a session on a path that should have failed | The parametrized "no session cookie on any failure path" assertion (§10.4) |
| 3 | The tx cookie survives a failure and becomes replayable | The parametrized "cleared on every path" assertion; one owner module for the cookie's `path` |
| 3 | Auto-linking attaches a Google identity to the wrong account | `email_verified === true` is required, and it is the only gate — **there is no runtime switch** (declined, §16.4) and no domain restriction (declined, §16.5). The controls that remain are: the §10.4 test cases asserting the linked `user` row is otherwise unchanged; the `[auth] oauth account auto-linked` audit line; and §3.7's revisit trigger. **This is a knowingly accepted residual risk, not an unmitigated one by accident** |
| 4 | The signup page lets the Google path skip the consent question | Server fails closed (`tx.consent === true`); UI gating is an explicit 5.3 checklist item |
| 5 | A live pass writes junk into the real `myagent.db` | 5.5 cleanup, mirroring Plan 05's; and 5.3/5.4 are gated on an explicit user go-ahead (§10.6) |
| 5 | The redirect URI in the Google console does not match ours byte for byte | 5.0 prints the exact string to paste; the mismatch is the single most common first-run failure and it produces a Google-side error page, not one of ours |
| all | An accidental live Google call during development | Constraint 11 + fitness assertion 3: no test may import `arctic` or reach the network. The only live path is a browser, deliberately |

### 11.3 Complexity

**Medium.** Concretely: 1 new table (additive, machine-generated migration), 1 repository
function signature extended and 3 added, 2 new routes, 4 new `lib/auth/oauth/` modules, 2
pages split, 2 components touched plus 1 new, 1 new runtime dependency, 6 new test files and 4
modified, 3 new fitness assertions. **No new setting, and `lib/settings.ts` / `lib/db/seed.ts`
/ `SettingsView.tsx` are untouched** — that is one fewer moving part than the pre-review draft
(§16.4). **Phase 0 is perhaps 5 % of the work and is the only part that fixes something
broken** — which is why the review confirmed landing it separately and early (§16.1), rather
than bundling it as a warm-up.

Smaller than Plan 05 by a wide margin: no destructive migration, no repository-wide retrofit,
no change to authorization, no change to the ownership model, and every existing route's
contract untouched.

---

## 12. Plan 05 interaction — obligations inherited and discharged

| Plan 05 item | Status in this plan |
|---|---|
| §0 "Explicitly NOT in this plan: … OAuth / social login" | ⚠️ **Deliberately overridden**, at the user's explicit request, 2026-07-31. See §14.1 |
| §3.1 "two implementations of 'is this token valid' is exactly the drift this codebase's fitness tests exist to prevent" | ✅ **Discharged.** That drift had happened anyway; §3.1 removes it and §10.4 adds the fitness test that was implied but never written |
| §3.3 "Lifetime: 7 days, fixed" | ⚙️ **Extended, default unchanged.** Fixed → env-configurable with the same default (§3.2). The "no sliding refresh" half is untouched |
| §3.7 "`passwordHash === ''` means no password set" | ✅ **Reused, not duplicated.** Verified against the built code at both enforcement points (§3.8). No parallel "oauth-only" concept is introduced |
| §4.4 "the one transactional signup primitive" | ✅ **Still one.** Extended rather than duplicated (§4.2), specifically so the three admission checks stay in one place |
| §4.5 "the migration is hand-authored — the one deliberate exception" | ✅ **Exception not inherited.** `0004` is machine-generated (§4.3); Plan 04 §4.3's rule is back in force |
| §5.6 opt-in consent, snapshotted per row | ✅ **Extended to the new signup path.** `tx.consent === true` is the only way to grant it; §10.4 tests the malformed inputs individually |
| §7.3 "cross-owner denial is 404" and the whole status table | ✅ **Untouched.** This plan adds no `403`/`404` semantics; its failures are redirects |
| §8 invariant 6 "signup writes `role: 'user'` unconditionally" | ✅ **Structurally preserved** — OAuth signup goes through the same primitive, which takes no role parameter |
| §8 policy 18 `maxUsers` | ✅ **Applies identically** to OAuth signups (§8 policy 21). Checked in the transaction, plus a courtesy pre-check at `start` |
| §14 🔶 OPEN — keep or drop the rate limiter | ✅ **Closed: keep.** §14.4 |
| §14 🔶 OPEN — disclose the rate limit in the login UI | ✅ **Closed: do not disclose.** §14.5 |
| P05f (session revocation) / P05g (sliding refresh) | ⏸️ **Still deferred, and explicitly not solved here.** §3.2 states why a configurable TTL is not revocation |
| `P05-C4` middleware is not the authorization boundary | ✅ **Reaffirmed.** Constraint 2 exists to stop §3.1's fix being misread as a promotion |
| Rules Index #41 (one SDK importer) | ✅ **Pattern reused** for `arctic` (constraint 9, fitness assertion 3) |
| Rules Index #47 (`onConflictDoNothing` for admin-owned seed rows) | ➖ **Not engaged.** The one setting this plan proposed was declined at review (§16.4), so nothing is seeded and `lib/db/seed.ts` is untouched |

---

## 13. Deferred decisions (this plan's additions to `TechDesign.md`'s table)

| Item | Why deferred | Revisit when |
|---|---|---|
| **A second OAuth provider (GitHub, Microsoft, Apple)** | The seam exists and the cost is known (§5.1: one provider file, one registry line, two env vars, one button — no route, no schema, no migration). Building a second one now would be speculation about which one anyone wants | Somebody actually wants to sign in with it |
| **Manual link / unlink of a provider from `/account`** | Auto-linking (§3.7) covers the realistic case. A manual surface needs a re-authentication step, and unlink needs a "this is your only way in" guard that depends on the deferred set-a-password flow | Auto-linking is ever restricted (see the row below), or a user has two providers and wants one gone |
| **Restricting auto-linking — the `hd`-claim check (option b), or manual linking only (option c)** | **Not deferred for lack of a design: offered at review 2026-07-31 and explicitly declined** (§16.5, "accept all workspace for now"). The Google Workspace domain-takeover residual risk is knowingly accepted for all domains, on the strength of a ≤ 5-user, invite-gated beta whose every email domain the admin knows. The fix, when it is wanted, is ~3 lines in the callback plus one error code | **Before the beta opens beyond people the admin personally knows**, or self-service signup arrives; **or** a user signs up on a domain the admin does not control and does not trust indefinitely; **or** any account is compromised this way or a near-miss appears in the `[auth]` log |
| **An admin toggle for auto-linking** (`oauthAutoLinkVerifiedEmail`) | Proposed and **declined at review (§16.4)** — "don't want to overcomplicate". Recorded so it reads as a decision, not an omission; §5.3 keeps the full rejected-option table | Only alongside the row above — if auto-linking is ever restricted, a switch is the cheaper half of that change |
| **"Set a password" for a Google-only account** | Same surface and same blockers as P05j (self-service change-password). Today such a user depends entirely on Google | A Google-only user needs a password, or Google sign-in breaks for a deployment |
| **`oauth_account.lastLoginAt`** | Nothing reads it, and adding it turns an insert-only table into one with an `UPDATE` on the login path (§4.1) | The admin asks who is still actually using this — at which point `llm_call_log` may answer it already |
| **Storing provider tokens to call provider APIs later** | Constraint 8 forbids it, and there is no feature that needs it. Adding token columns is the point at which this app becomes a holder of other people's credentials | A feature genuinely needs to act at the provider on the user's behalf — and that decision deserves its own review, not a column |
| **Restricting sign-in to an email domain** (`hd`-based allowlist) | `maxUsers` + invite codes are already the admission control; a domain allowlist would be a third one | The beta opens beyond invite codes |
| **Rate-limiting the OAuth callback** | The tx cookie already gates it before any expensive work (§3.8) | Callback abuse actually appears in the logs |
| **Distributed / persistent rate limiting for `oauth_start`** | Inherits P05n exactly | Same trigger as P05n |
| **Sliding session refresh, now that the TTL is configurable** | Configurability and refresh are unrelated: one changes the number baked into new tokens, the other changes when tokens are reissued. P05g's reasoning is unchanged | P05g's existing trigger |

**Edits to existing rows** (Phase 6.1):

- **P05a** (🔶 OPEN — keep or drop the rate limiter) → **Resolved 2026-07-31, Plan 06 §14.4:
  keep.** Rewritten as a resolved row with a pointer, following how §16 closed Plan 05's own
  open points rather than deleting them.
- **P05b** (🔶 OPEN — disclose the rate limit) → **Resolved 2026-07-31, Plan 06 §14.5: do not
  disclose.**
- **P05f** (server-side session revocation) → unchanged in substance; add *"Plan 06 §3.2 makes
  the TTL configurable, which is explicitly **not** revocation — shortening it does not affect
  a live session. Rotating `JWT_SECRET` remains the only immediate kill switch."*
- **P05g** (sliding refresh) → add *"Plan 06 §3.2 made the TTL configurable; this row is
  unaffected."*
- **P05j** (self-service change email/password/delete) → add *"Plan 06 adds a third case: a
  Google-only account (`passwordHash = ''`) that has no password to change."*

---

## 14. Deviations from Plan 05's stated scope

Each is deliberate. Items 1–3 are scope reversals requested by the user; 4–5 close Plan 05's
own open questions; 6–8 are architect's-judgment additions flagged for approval in §16.

1. **OAuth / social login is built, reversing Plan 05 §0's explicit exclusion.**
   Requested by the user on 2026-07-31, with the scope decisions (Google only, invite gate
   still applies, password auth stays, `oauth_account` as its own table, auto-link on verified
   email) settled in that conversation before this plan was written. Recorded here at length
   because a future reader finding Plan 05's exclusion and this plan's implementation should
   find the reversal documented on both ends — Phase 6.1 adds a one-line pointer to Plan 05
   §0 as well.
2. **The session lifetime is no longer "7 days, fixed"** (Plan 05 §3.3, confirmed at its
   §16.9 review). Now env-configurable with the same default. The *other* half of that
   decision — no sliding refresh, no revocation — is unchanged.
3. **`createUserWithInvite()`'s signature changes** (Plan 05 §4.4). Justified in §4.2: the
   alternative is two copies of the three admission checks.
4. **Plan 05 §14's first open item is closed: the rate limiter stays.** Decided by the user,
   2026-07-31. It costs ~30 lines and no dependency; it turns unlimited offline-speed guessing
   into 10 tries per window; its stated limitations (per-process, resets on restart, spoofable
   `x-forwarded-for`) are accepted rather than engineered around, and P05n still tracks the
   distributed version if a multi-instance deploy ever happens. This plan also gives it a
   third caller (`oauth_start`), which makes "delete it" meaningfully more expensive than when
   the question was first raised — worth noting as a fact, not as the reason.
5. **Plan 05 §14's second open item is closed: the rate limit is not disclosed in the login
   UI.** Decided by the user, 2026-07-31. The existing `429 { error: 'rate_limited',
   retryAfterSeconds }` body — which the login page already renders as "Too many attempts. Try
   again in N seconds." — is sufficient: a locked-out user is told what happened and when to
   retry. No proactive "you get N attempts" messaging is added, because stating the budget up
   front helps a prober plan around it and helps nobody else.
6. *(architect's addition — **withdrawn at review, §16.4**)* **`oauthAutoLinkVerifiedEmail` as
   a `SETTING_DEFS` entry.** Proposed because auto-linking is the one genuinely
   security-relevant judgment call here and a switch seemed a better artefact than a
   paragraph. **Declined** — "don't want to overcomplicate". Auto-linking is a hardcoded
   `true`; the paragraph (§3.7's "Accepted risk") is the artefact after all, and it carries a
   revisit trigger so it is not merely prose. This plan therefore adds **no** setting, and
   `lib/settings.ts` / `lib/db/seed.ts` / `SettingsView.tsx` are untouched.
7. *(architect's addition — §16.3)* **The `OAuthProvider` seam and the `[provider]` dynamic
   route**, rather than static `google/` routes calling `arctic` directly. Proposed because
   the user's stated goal was that a second provider be cheap, and this is the shape that
   actually delivers it — plus it is what makes constraint 11's mocking rule possible.
8. *(architect's addition — §16.2)* **Three new fitness assertions** (§10.4), including the
   import-closure walk for `middleware.ts`. Not requested. Proposed because the defect in
   §3.1 is exactly the kind that a fitness test would have prevented, and because the fix
   itself opens the door (middleware importing from `lib/auth/`) that assertion 2 closes.

---

## 15. Rules Index additions (#63–#72)

To be added to `architecture/TechDesign.md`'s Rules Index at Phase 6.1, continuing from #62.

| # | Rule | Type | Lives in | Source |
|---|---|---|---|---|
| 63 | **There is exactly one JWT verification implementation.** `middleware.ts` calls `verifySessionToken()` from `lib/auth/jwt.ts`; no other file imports `jwtVerify`/`SignJWT` from `jose` for session tokens | Architecture | `middleware.ts`, `lib/auth/jwt.ts`, `app/api/__tests__/route-guard.test.ts` | Plan 06 §3.1, constraint 1 |
| 64 | **Nothing in `middleware.ts`'s transitive import graph may reach `lib/db/`, `next/headers`, `bcryptjs`, or `node:*`.** The Edge runtime cannot open `better-sqlite3` | Architecture | `middleware.ts`, fitness test | Plan 06 constraint 3 |
| 65 | **The JWT `exp` and the cookie `maxAge` always derive from the same `getSessionTtlSeconds()` call.** An invalid `SESSION_TTL_SECONDS` throws at boot rather than falling back to the default | Data integrity | `lib/auth/constants.ts`, `lib/env.ts` | Plan 06 §3.2, constraint 4 |
| 66 | **OAuth is a login mechanism, never an admission mechanism.** Creating a user from an OAuth callback redeems an invite code and re-checks `maxUsers` inside the same transaction | Data integrity | `lib/db/repository/users.ts` | Plan 06 constraint 5 |
| 67 | **An account is created only from a flow that started on `/signup`** (`tx.mode === 'signup'`), because the invite code and the §5.6 consent answer are collected there and nowhere else | Data integrity | `app/api/auth/oauth/[provider]/callback/route.ts` | Plan 06 constraint 6 |
| 68 | **Provider identity is `(provider, providerAccountId)`, never the email.** A later sign-in never rewrites `user.email` from a provider claim | Data integrity | `lib/db/schema.ts`, callback route | Plan 06 constraint 7 |
| 69 | **No OAuth provider token — access, refresh, or `id_token` — is ever persisted, logged, or returned to a client.** There is deliberately nowhere in the schema to put one | Security | `lib/auth/oauth/*`, `lib/db/schema.ts` | Plan 06 constraint 8 |
| 70 | **An OAuth profile is trusted only when the `id_token`'s signature, `iss`, `aud`, `exp`, and `nonce` all validate and `email_verified === true`** (the boolean, never coerced) | Security | `lib/auth/oauth/google.ts` | Plan 06 §3.6 |
| 71 | **The OAuth transaction cookie is single-use and cleared on every exit path from the callback**, with an identical `path` on clear and set | Security | `lib/auth/oauth/tx.ts`, callback route | Plan 06 constraint 10 |
| 72 | **Auto-linking a Google identity to an existing account on a verified email is unconditional — every domain, no toggle — and its residual risk is a reviewed, accepted decision, not a default.** The Google Workspace domain-takeover vector (a domain's Workspace admin can mint an identity for any address on it) was written out in full and accepted on 2026-07-31; the `hd`-claim restriction, the never-auto-link posture, and an admin kill switch were each offered and declined. **Do not silently "harden" or "loosen" this — it is a decision with a stated revisit trigger** (Deferred Decisions: "Restricting auto-linking"). The `[auth] oauth account auto-linked` log line is the audit trail it relies on | Security | `app/api/auth/oauth/[provider]/callback/route.ts` | Plan 06 §3.7, §16.5 |

*(Constraint 9's one-`arctic`-importer rule is deliberately **not** given its own number — it
is Rules Index #41 applied to a second library, and Phase 6.1 should extend #41's wording to
name both rather than create a near-duplicate row.)*

---

## 16. Decisions — **all resolved 2026-07-31**

> **Status: closed.** All six points below were put to the user on 2026-07-31 and decided.
> Four were confirmed as proposed; two (§16.4, §16.5) changed the design, and those changes
> are already applied throughout this document — `@dev` does **not** need to act on this
> section, it is the record of what was asked and what was answered.

| # | Question | Decision | Where it now lives |
|---|---|---|---|
| 1 | Land Phase 0 (A+B) separately from C? | ✅ Confirmed as proposed — yes | §11 Phase 0, §11.1 |
| 2 | Build the three fitness assertions, incl. the import-closure walk? | ✅ Confirmed as proposed — yes | §10.4, §11 steps 0.6 / 1.7 |
| 3 | `OAuthProvider` seam + dynamic `[provider]` routes? | ✅ Confirmed as proposed — yes | §5.1, §5.2 |
| 4 | `oauthAutoLinkVerifiedEmail` admin setting? | ❌ **Declined** — hardcode `true` | §5.3 (rejected-option record), §2.2, §8, §11 |
| 5 | Auto-linking: option (a), (b), or (c)? | ✅ **(a), all domains** — (b) and (c) declined; residual risk accepted | §3.7 "Accepted risk", §9, §13, Rules Index #72 |
| 6 | Layout-mockup detour for the Google button? | ✅ Confirmed as proposed — not needed, and **not** a waiver | §11 Phase 4 |

1. **Landing Phase 0 separately. ✅ Resolved 2026-07-31: yes, as proposed.** Workstreams A and
   B (the `middleware.ts` JWT-duplication fix and the configurable session TTL) land as their
   own reviewable change, independently of the OAuth work. They fix an existing defect, touch
   no new dependency, and are revertable on their own. §11.1's dependency graph already shows
   Phase 0 as detached; nothing else changed.

2. **The three fitness assertions, particularly the import-closure walk. ✅ Resolved
   2026-07-31: build them, as proposed.** Assertion 2 (~30 lines walking `middleware.ts`'s
   transitive imports and asserting none reaches `lib/db/`, `next/headers`, `bcryptjs`, or
   `node:*`) is the most bespoke thing in this plan, and it is accepted precisely because
   §3.1's fix is what opens that door: middleware now imports from `lib/auth/`, one hop from
   `session.ts` → the database → an Edge build that fails at deploy time rather than in CI.
   It ships in the same phase as the fix (step 0.6).

3. **The `OAuthProvider` seam + dynamic `[provider]` routes. ✅ Resolved 2026-07-31: yes, as
   proposed.** `arctic` stays behind this repo's own interface (constraint 9) and the routes
   are provider-parametric, so GitHub later is a provider file, a registry line, two env vars
   and a button — no route, no schema change, no migration (§5.1). This is also what makes
   constraint 11's "no test may contact Google" enforceable, since tests mock our seam rather
   than a third party's internals.

4. **`oauthAutoLinkVerifiedEmail` as an admin setting. ❌ Resolved 2026-07-31: declined.**
   The user's words: *"don't want to overcomplicate."* Auto-linking is a **hardcoded `true`**
   — a plain `if`, no `SETTING_DEFS` row, no seed line, no System Settings control, and no
   second branch through the callback. The architect's own stated fallback is taken exactly as
   written. Everything that existed only to support the toggle has been removed from this
   document and is enumerated in §5.3: `lib/settings.ts`, `lib/db/seed.ts` and
   `SettingsView.tsx` drop off §2.2's file list; the draft's phase steps 2.5 and 4.5 are gone
   (Phase 2's test step moved up into 2.5); the
   `oauth_link_required` error code is deleted from §7.3's vocabulary (it was reachable only
   with the toggle off, and a closed vocabulary should not carry an unreachable code); §8's
   policy block now states plainly that this plan adds no setting at all; and §10.4's
   "auto-link off" test case is replaced by a positive case asserting the linked user's row is
   left unchanged. **One consequence to be clear about:** reverting auto-linking is now a code
   change and a deploy, not a toggle — which §3.7's "Accepted risk" note states in those words.

5. **The auto-linking security call itself. ✅ Resolved 2026-07-31: option (a) — auto-link on
   `email_verified === true`, for every domain, including Google Workspace custom domains.
   Options (b) and (c) explicitly declined.** The user's words: *"accept all workspace for
   now."* This is the one decision in the plan whose worst case is account takeover rather
   than inconvenience, and it was decided with the risk written out at full strength rather
   than summarised: auto-linking is the only path in this system that reaches an existing
   account with neither an invite code nor a password; for a Workspace-hosted address,
   `email_verified: true` attests that the *domain* was verified, so that domain's Workspace
   administrator — present or future — can mint an identity for any address on it; and with
   §16.4 declined there is no runtime switch to fall back on.
   **This is recorded as an accepted risk, not an unexamined default** — §3.7 now carries a
   dedicated "Accepted risk — reviewed, not defaulted" subsection with the compensating facts
   (a ≤ `maxUsers` beta, every account invite-gated, every email domain personally known to
   the admin) and a **revisit trigger**: before the beta opens beyond people the admin
   personally knows or self-service signup arrives; or when someone signs up on a domain the
   admin does not control and does not trust indefinitely; or on any compromise or near-miss
   in the `[auth]` log. That trigger is carried into `TechDesign.md`'s Deferred Decisions
   ("Restricting auto-linking", §13) and into the Rules Index as **#72**, so a future reader
   — including a future `@dev` or the user months from now — finds it as a decision with a
   trigger rather than as prose in an old plan.

6. **Layout prototyping (standing rule 4) for Phase 4. ✅ Resolved 2026-07-31: no mockup
   detour, and no waiver claimed.** The reading stands: one branded button plus a divider on
   two forms that already exist, and one read-only line on `/account`, fall under the standing
   rule's own *"a trivial one-line style tweak doesn't need a mockup detour"* clause — the
   forms' structure is unchanged and every token already exists. **This is explicitly not an
   exception to the rule** (unlike Plan 05 §16.11's one-time waiver, which this plan does not
   inherit); the rule remains in full force for anything touching the workbench shell.

---

## 17. Remaining judgment calls — cheap to change now, less cheap later

Item 1 was the plan's highest-stakes call and is **now decided** (§16.5); it is kept here as a
pointer rather than deleted, so a reader scanning this section does not conclude it was never
weighed. Items 2–4 were not raised at the review and are `@dev`'s to flag if they look wrong
while building — none blocks the build.

1. ~~**Auto-linking (§3.7).**~~ **Decided at review, 2026-07-31 (§16.5): option (a), all
   domains, residual risk accepted, revisit trigger recorded.** It remains the only decision
   in this document whose worst case is account takeover rather than inconvenience, and the
   only one with no runtime mitigation behind it (§16.4). If it is to be reconsidered, §3.7's
   "Accepted risk" subsection is where the argument and the three costed alternatives live.
2. **`createUserWithInvite()`'s extension rather than a second primitive (§4.2).** The
   alternative — a separate `createOAuthUserWithInvite()` — is arguably cleaner to read and
   definitely safer for the existing password path, at the cost of two copies of the three
   admission checks. This plan chose one primitive because Plan 05 chose one implementation
   for ownership and gave a reason that applies verbatim. If you'd rather not touch a working,
   well-tested function at all, that is a defensible different answer.
3. **A single tx cookie carrying five fields, unsigned (§3.5).** The reasoning is that every
   field is re-validated authoritatively downstream, so signing protects nothing. If that
   argument has a hole, the fix is to sign the payload with the existing `JWT_SECRET` — about
   six lines, and best decided now rather than after the cookie format is deployed.
4. **`SESSION_TTL_SECONDS` bounds of 60 s and 90 d (§3.2).** Arbitrary but defensible.
   The lower bound in particular makes 5.4's expiry test convenient; if you want to test with
   a 10-second session, the bound needs to be lower.
