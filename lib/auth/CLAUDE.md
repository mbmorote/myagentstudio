# lib/auth — Session, Password, Invite Codes, OAuth

Everything that establishes and checks who's making a request: JWT sessions, password
hashing, invite-code signup, the login/signup rate limiter, and Google OAuth. Nothing
outside this folder verifies a token or hashes a password directly — every route goes
through `guard.ts`/`session.ts`.

## Architecture

```
middleware.ts (Edge runtime)         route handler (Node runtime)
      │                                     │
      ▼                                     ▼
verifySessionToken()  ◄── jwt.ts ──►  authenticate() / requirePageSession()
                                             │            ← guard.ts
                                             ▼
                                        getSession()  ← session.ts
                                             │
                                             ▼
                              getUserById()  ← lib/db/repository/users.ts
```

`jwt.ts` is deliberately Edge-safe (no `server-only`, no Node-only imports) so
`middleware.ts` and every Node-runtime route handler verify a token through the exact same
code path — there's only one JWT verification implementation in the codebase. Everything
else in this folder (`password.ts`, `session.ts`, `guard.ts`, the OAuth files) is
Node-only, marked `server-only`, and never imported by `middleware.ts`.

`constants.ts` is the dependency root of the whole subsystem (no imports of its own, so it
can't create a circular dependency) — cookie names, TTL bounds, the bootstrap admin's fixed
id, and the bcrypt cost factor all live there.

## Session & JWT (`session.ts`, `jwt.ts`, `guard.ts`)

A session is a signed JWT (`jose`, HS256) in an `httpOnly` cookie, carrying `sub` (user
id), `email` (display only, never trusted for authorization), `iat`, and `exp` — no `role`
claim. `getSession()` is the single function that reads the cookie, verifies the token, and
re-reads the user's current `role` from the database on every call; nothing caches role
across requests, so a role change or account deletion takes effect on the very next request.

`guard.ts` wraps this into `authenticate()` (any signed-in user) and an admin-only variant,
each returning a discriminated union (`{ ok: true, session }` or `{ ok: false, response }`)
rather than a higher-order wrapper — every route handler opens with the same two-line
pattern and keeps its own normal function signature, so it stays directly callable from
tests. A `403` (an authenticated non-admin hitting an admin route) is always logged; a
`401` (no/expired session) is routine and isn't.

## Password (`password.ts`)

bcrypt hashing (cost 10) with an up-front length check: a password over 72 UTF-8 bytes is
rejected outright rather than silently truncated, since bcrypt itself truncates at 72 bytes
and two different long passwords could otherwise collide. The empty string is a reserved
sentinel meaning "no password set" (used for the bootstrap admin row, created by raw SQL
before any hashing can run, and for Google-only accounts) — `verifyPassword` refuses to
even attempt a bcrypt compare against it, a second check independent of the login route's
own guard against the same case.

## Invite codes (`inviteCode.ts`)

Generates a `XXXX-XXXX-XXXX-XXXX` code from a 31-symbol alphabet that excludes visually
ambiguous characters (`I`, `L`, `O`, `0`, `1`), using `crypto.randomInt` for unbiased
selection. On the rare primary-key collision, it regenerates (up to 3 attempts) rather than
erroring. This module has no `server-only` guard and no secrets — it's pure computation,
usable directly in tests.

## Rate limiting (`rateLimit.ts`)

An in-process, fixed-window limiter (10 attempts / 15 minutes / `(route, client IP)`)
guarding the two endpoints reachable without a session: login and signup. IP comes from the
first entry of `x-forwarded-for`, falling back to `'unknown'`. Its limitations — per-process
(a multi-instance deploy multiplies the effective limit), resets on restart, and a spoofable
IP header absent TLS-terminator rewriting — are accepted for the current single-instance,
small-user-base deployment, not overlooked; see `plans/roadmap.md` FUTURE for the
distributed version.

## OAuth — Google sign-in (`oauth/`)

```
route handler
   │
   ▼
getOAuthProvider('google')  ← providers.ts   (the registry — what tests mock)
   │
   ▼
createGoogleProvider()      ← google.ts      (the only file that imports `arctic`
   │                                            or calls createRemoteJWKSet)
   ▼
OAuthProfile { providerAccountId, email, emailVerified }
```

`oauth/types.ts` defines the provider-agnostic vocabulary (`OAuthProfile`,
`OAuthProvider`) — every other file, including every test, depends only on these types,
never on `arctic`'s classes directly. `oauth/providers.ts` is the small (~20-line) registry
mapping a provider name to an implementation; adding a second provider later is one new
file plus one new branch here, no changes to any route. `oauth/google.ts` is the only file
allowed to import `arctic` or call `createRemoteJWKSet` — it verifies a Google `id_token`'s
signature, issuer (Google emits two valid forms), audience, expiry, and nonce against
Google's real JWKS endpoint, and only trusts the profile when the provider also asserts
`email_verified === true` as a real boolean.

`oauth/tx.ts` manages the short-lived (10-minute) transaction cookie that survives the
browser's round trip through Google and back to `/callback` — one file owns all three
operations (set on `/start`, read in `/callback`, clear on every exit path from
`/callback`), because a mismatched cookie path between set and clear is exactly the kind of
bug that leaves a replayable transaction cookie behind. Its contents are base64url-encoded
JSON, deliberately unsigned — every value inside is re-validated authoritatively downstream
anyway.

`consentPopupFlag.ts` is unrelated to authentication itself — it's the small, client-safe
handoff constants (`sessionStorage` key, query-param name) that tell the workbench shell to
show the one-time activity-log-sharing popup right after a brand-new signup, covering both
the password-signup (client redirect) and Google-signup (server redirect) paths.

## Files in this folder

| File | Role |
|---|---|
| `constants.ts` | Cookie names, TTL bounds/getter, bootstrap admin id, bcrypt cost — the dependency root |
| `jwt.ts` | Sign/verify session JWTs. Edge-safe — the only JWT implementation in the codebase |
| `session.ts` | `getSession()` — cookie → token → user row. The only reader of `next/headers` |
| `guard.ts` | `authenticate()` / admin guard — the route-handler entry point |
| `password.ts` | bcrypt hash/verify + the no-password sentinel |
| `inviteCode.ts` | Invite-code generation and normalization |
| `rateLimit.ts` | Login/signup fixed-window rate limiter |
| `consentPopupFlag.ts` | Shared constants for the post-signup consent-popup handoff |
| `oauth/types.ts` | `OAuthProfile`/`OAuthProvider` — the provider-agnostic seam |
| `oauth/providers.ts` | The provider registry — what route tests mock |
| `oauth/google.ts` | Google provider implementation. The only `arctic`/JWKS importer |
| `oauth/tx.ts` | The OAuth transaction cookie (set/read/clear) |
| `__tests__/*.test.ts` | Unit tests mirroring each file above (password, session, guard, invite codes, rate limit, JWT, session TTL, consent-popup flags) |
| `oauth/__tests__/tx.test.ts` | Transaction cookie set/read/clear cases |
| `oauth/__tests__/google-idtoken.test.ts` | `id_token` verification against a locally generated JWKS — never a real Google call |
