# Plan 17 — User-Configured LLM Key (BYOK)

> **Status: 🔴 Drafted 2026-08-28, not started.** Like Plan 14 and Plan 16, this plan stands up
> **infrastructure this codebase does not have anywhere today** — but the specific thing it
> introduces is narrower and sharper than either: **a reversibly-encrypted secret at rest.**
> Every credential in this repo today is one of exactly two things: a **one-way hash** (bcrypt
> for passwords, SHA-256 hex for API tokens — `lib/auth/apiToken.ts` states the four reasons for
> the latter) or a **process environment variable** (`ANTHROPIC_API_KEY`,
> `OPENAI_COMPATIBLE_API_KEY`, `JWT_SECRET`). Nothing is stored in a form the application can
> read back. A BYOK key is structurally the opposite requirement: the app must replay it,
> verbatim, to a third party, forever.
>
> **Two decisions are already LOCKED by the user and are not re-opened below** — they appear in
> §3 as constraints with their reasoning, not in §8 as questions:
> 1. **BYOK keys are stored persistently, encrypted at rest** — not session-only, not re-entered
>    per call.
> 2. **BYOK covers both providers** — Anthropic *and* the OpenAI-compatible provider — so two
>    key shapes are stored and the resolution branches on whichever provider
>    `resolveActiveProvider()` picked for that call.
>
> **Nine decisions (D1–D9) are open**, every one with a recommendation and reasoning in §8.
> **None of them blocks starting.** Every one has a call baked into §4, so Phases 1–8 are
> unblocked regardless; changing any one afterwards is a localized edit. **D2 is the highest
> stakes** — it is the wrapping-key lifecycle, including the answer to *"what happens to a
> user's calls if `BYOK_ENCRYPTION_KEY` is ever lost or rotated without a migration?"* — and §4.3
> answers it in full rather than gesturing at it.
>
> **Scale note — High, and honestly so.** One new table, two new columns on `user`, three new
> columns on `llm_call_log`, a new `lib/byok/` subsystem with its own `CLAUDE.md`, a new
> repository file, a new pure `lib/ai/caps.ts`, a new `lib/ai/pricing.ts`, changes to the
> gateway's normative gate order, a new optional field on `ResolvedLlmRequest` that both
> providers honour, a new typed provider error class with per-provider classification, four new
> account routes, one new admin route, two new settings, and three mockup dispatches. The
> roadmap's own status for this item — *"Needs an LLM strategy review first"* — was accurate:
> it bundles three sub-asks (per-individual quota override, per-user spend cap, currency estimate
> on Activity Log rows) that only make sense answered together, and §4.9/§8 answer them together.
>
> **Cost and network posture — read this one carefully, because this plan is the most exposed
> item in the repo to standing rule 2.** Steps 1–11 (§6) are **fully offline and cost nothing**:
> encryption round-trips, the schema, the repository, the pricing table, the cap decision, both
> providers' credential plumbing, the entire gateway logic, every fitness function, and — via a
> ~30-line local `node:http` echo server (§5.7) — a **real HTTP end-to-end proof of
> credential routing for the OpenAI-compatible provider with zero network egress and zero
> spend**. Exactly three things are unavoidably live (§5.8), and **each is a separate explicit
> ask, never an automatic step**: an invalid-key classification check (costs $0 — a rejected
> request is not billed — but is still a real call to a real vendor with `liveLlmCalls` on, so
> the ask applies in full), one real billed BYOK turn, and one real billed platform-key turn
> immediately after it to prove the two do not cross-contaminate.
>
> **The new sharp edge standing rule 2 has never had before:** until now, "a real Anthropic API
> call spends the user's money" had exactly one meaning, because there was exactly one key. After
> this ships, **whose money a call spends is a database row**. Say whose key is about to be used
> before asking, every time (§7 risk 8 also flags whether standing rule 2's wording deserves
> widening — flagged for the user to decide, not decided here, the same posture Plan 14 took for
> email sends).
>
> Standing project rules apply in full, restated rather than cited by number: **never `git commit`
> without the user explicitly saying to** — not on phase completion, not on a green suite;
> **never make a real billed Anthropic (or OpenAI-compatible) API call without asking first**,
> and say what the call is, whose key it uses, and roughly what it costs before asking; **shut
> the dev server down after any verification session** (default off — stray `next dev` processes
> on the same SQLite file have caused a real, hours-long false bug hunt in this repo before); and
> **ask before running any test, build, or `tsc --noEmit` check**, including the ones this plan's
> own phases call for. UI work prototypes in `reference/layout/Layout-Workbench.html` before any
> React code — §4.11 marks exactly which parts that applies to and which are exempt.
>
> Addresses `plans/roadmap.md` NEXT item **User-configured LLM key (BYOK)**, including the two
> sub-asks it absorbed (per-individual LLM quotas; per-user spend/cost caps with a currency
> estimate on Activity Log rows). Touches, but does not build, three other roadmap items —
> **Delete or disconnect user (admin)**, **Log retention / pruning / pagination**, and
> **GDPR-style export/deletion workflow** (§10).

---

## 1. What this plan is, in one paragraph

Every AI call in this deployment is funded by one credential: `ANTHROPIC_API_KEY` or
`OPENAI_COMPATIBLE_API_KEY`, read from the server's environment, shared by every user, metered
by one global per-user hourly call cap. This plan lets a user store **their own** key for
whichever provider is active, so their imports and chat turns bill their account instead of the
operator's — and, because that changes who is paying, it also answers the three questions that
only become answerable once "who pays" varies: an admin override of the hourly cap for one
individual, a per-user spend ceiling denominated in money rather than call count, and a currency
estimate beside the token counts the Activity Log already shows. The key itself is stored in one
new table, sealed with AES-256-GCM under a wrapping key that lives only in the server's
environment, and is decrypted exactly once per live call inside `lib/ai/gateway.ts` — the single
file already permitted to touch the database from the AI subsystem. **No provider interface
changes shape, no provider instance is cached per user, and `resolveActiveProvider()`'s
zero-argument contract is not touched**: the credential travels with the request, not with the
provider.

**The one rule that shapes every other decision in this document:** *a user's call is funded by
exactly one credential, chosen before the call and recorded on the log row, and the app never
silently changes which one that is.* No automatic fallback to the platform key when a BYOK key
is unreadable, rejected, or expired — because a fallback that spends the operator's money
without the user asking is a financial surprise for one party and a consent violation for the
other. Every failure state is loud, named, and recoverable by the user re-entering a key. The
one and only case where a stored key is legitimately ignored is when the deployment has **no
wrapping key configured at all**, and even then the Account page says so in words (§4.3).

---

## 2. Current state (verified by reading the code this session, 2026-08-28)

| Fact | Where | Note |
|---|---|---|
| **No reversible secret exists anywhere in this codebase.** Passwords are bcrypt (one-way); API tokens are SHA-256 hex (one-way); invite codes are plaintext *on purpose*; every provider credential is a process env var. | `lib/auth/password.ts`, `lib/auth/apiToken.ts:16-27`, `lib/auth/CLAUDE.md` ("an invite code is human-typed and stored plaintext on purpose so the admin can resend it; an API token is machine-copied and must never be re-readable by anyone, including the admin"), `lib/env.ts` | **This is the single most structurally new requirement in the plan.** `apiToken.ts` is the nearest-looking precedent and it is the *wrong shape* — its whole design goal is that the plaintext is never recoverable. A BYOK key must be recoverable by the app forever and by nobody else, ever. |
| No encryption library is present | `package.json` — `jose` is JWT/HMAC signing (HS256), `bcryptjs` is one-way, `arctic` is an OAuth client | Node's built-in `crypto` is already used directly (`createHash`, `randomBytes` in `lib/auth/apiToken.ts:29`). AES-GCM needs **zero new dependency** — consistent with the precedent Plan 11 set when it implemented the second LLM provider over plain `fetch` rather than vendoring a second SDK. |
| `getAnthropicApiKey()` reads **one** process-level env var and is the only source of the Anthropic credential | `lib/env.ts:72-80` | Throws at call time with a clear message if unset. Never logged — the file says so explicitly for `JWT_SECRET` at `lib/env.ts:150-156` and the same posture applies here. |
| The OpenAI-compatible credential is **also** a single env var, read fresh on every call — no singleton for the key itself | `lib/env.ts:109-117` (`getOpenAICompatibleApiKey()`), used at `lib/ai/openaiCompatibleProvider.ts` in both `complete()` and `stream()` as `Authorization: Bearer ${getOpenAICompatibleApiKey()}` | **This is the easy half of the two-provider requirement** — the change is `req.credential ?? getOpenAICompatibleApiKey()` in two places. |
| **`anthropicProvider.ts` holds a module-level lazy SDK singleton constructed with one key** | `lib/ai/anthropicProvider.ts:44-52` — `let _sdk: Anthropic \| null = null;` … `_sdk = new Anthropic({ apiKey: getAnthropicApiKey() })` | **This is the hard half.** One `Anthropic` object per process, built once with whichever key was first needed. Two users with different keys cannot share it, and a naive fix that swaps the singleton's key would race: user A's call could execute against user B's credential. §4.6 and §7 risk 2. |
| The OpenAI-compatible base URL is **operator-configured and vendor-specific** | `lib/env.ts:125-133`; `lib/ai/CLAUDE.md` notes `OPENAI_COMPATIBLE_BASE_URL` is expected to already carry the vendor's own `/v1` segment, and that a real double-`/v1` bug was found and fixed live 2026-08-20 | Consequence for BYOK: a user's `openaiCompatible` key must be a key **for the vendor the operator configured**, because the base URL is not per-user (D9 — and it must not become per-user; that is an SSRF surface). |
| There is **no canonical shape** for the OpenAI-compatible key | `lib/env.ts:109-117` validates only presence. Real vendors differ: NVIDIA NIM uses `nvapi-…`, OpenAI `sk-…`, Groq `gsk_…`; the default model is `meta/llama-3.1-8b-instruct`, "confirmed callable on a real NVIDIA NIM free-tier account (2026-08-20)" | So the two stored key shapes are genuinely different problems: Anthropic has a recognisable `sk-ant-` prefix; the other provider has none that can be assumed. §4.5 — and the Anthropic prefix check is a **warning, never a rejection**. |
| **`resolveActiveProvider()` is a ZERO-ARGUMENT function** and that is architectural, not incidental | `lib/ai/providerRegistry.ts:111-113`; `createGateway(providerOrResolver: LLMProvider \| (() => LLMProvider))` at `lib/ai/gateway.ts:172-177` | Widening it to take a `userId` breaks the resolver contract and every `createGateway(fakeProvider)` call site in three test suites. §4.6's design exists specifically so this contract is **not** touched. |
| `providerRegistry.ts`'s `_instances` Map is keyed on **provider id alone**, process-wide | `lib/ai/providerRegistry.ts:36` | Caching per-user provider instances here would grow unboundedly in a long-running process. §4.6 keeps this Map exactly as it is — that is a design goal, not an accident. |
| `LlmCallContext` already carries `userId`, but it **never reaches `resolve()`** | `lib/ai/gateway.ts:37-60` (`userId?: string \| null`), and step 0 at `gateway.ts:185` is a bare `resolve()` | The userId is in the right place already; it just has nowhere to go today. §4.7 gives it one, inside `run()`, without changing `resolve()`. |
| **Only `gateway.ts` may import from `lib/db/` within `lib/ai/`, and it is test-enforced** | `lib/ai/__tests__/architecture.test.ts:111-135` (type-only import lines are excluded before searching, a deliberate documented carve-out) | So the BYOK row lookup **must** happen inside `gateway.ts`'s `run()`. That is a constraint on placement, and §4.7 obeys it rather than widening the rule. `lib/byok/` is kept DB-free so the same posture extends to it. |
| The `setting` table's `key` is the **sole primary key** — global by construction | `lib/db/schema.ts:195-200`; `lib/db/repository/settings.ts` `getSetting(key)` / `setSetting(key, …)` take no `userId` | Per-user scoping is structurally impossible here. A naming hack (`'byokKey:' + userId`) would compile and be wrong — untestable, unindexable, and it would put a ciphertext in the operator-settings table. **A new table is the answer** (§4.4). |
| The `user` table's only per-user configuration beyond `role` is **one boolean** | `lib/db/schema.ts:22-38` — `id`, `email`, `passwordHash`, `role`, `shareLogsWithAdmin`, `createdAt` | A nullable numeric override is new ground on this table, though a cheap one — see the next row. |
| A nullable `ALTER TABLE ADD COLUMN` on SQLite is metadata-only (no table rebuild), and this repo has already reasoned that out in writing | `lib/db/schema.ts:237-241` — `llm_call_log.origin`'s own comment: *"NOT NULL DEFAULT 'web' would require a table rebuild to add to an existing deployment, so nullable is more migration-friendly"* | Every column this plan adds to an existing table is nullable, for exactly that stated reason. |
| **`llm_call_log` stores token counts and no cost** | `lib/db/schema.ts:233` — `usage: … $type<{ inputTokens: number; outputTokens: number } \| null>()`; rendered at `app/components/Settings/ActivityLogPane.tsx:279` as `Tokens: {…inputTokens} in / {…outputTokens} out` | No price-per-token constant exists anywhere in the repo. The currency-estimate sub-ask needs a pricing source that does not exist (D6). |
| `sharedWithAdmin` is the established **snapshot-at-write-time, never updated** precedent on that table | `lib/db/schema.ts:235-236`; `lib/db/CLAUDE.md` ("written once by the gateway at call time and never touched again") | Directly reusable reasoning for the stored cost column: the price in effect *at the time of the call* is a fact about that call, and re-pricing history later would produce a number that looks authoritative and isn't. §4.9. |
| `llm_call_log` has exactly one sanctioned `UPDATE`, and it is documented as a named exception rather than a precedent | `lib/db/CLAUDE.md`: *"`reserveCallSlot()`/`finalizeCallLog()` together close a cap-check race by updating a single reserved row exactly once, by its own writer … documented as the sanctioned exception, not a precedent for more"* | The BYOK `status` flip (§4.3) is an `UPDATE` on the **new** table, not on the log — so it does not touch that boundary at all. Worth saying, because it is the obvious place to accidentally reach for. |
| The cap gate reads **one global setting**, applies to non-admins only, and fails **closed** on a missing policy row | `lib/ai/gateway.ts:237-277`; `getMaxLlmCallsPerUserPerHour()` at `gateway.ts:134-145`; the comment at `gateway.ts:241-245` records a real code-review finding: *"the prior `policy !== null && …` check silently skipped the cap for a null policy too"* | The asymmetry is stated in that comment and is binding here: **money-spending exemptions may only come from a CONFIRMED admin role, never from the absence of a policy row.** Every fail-safe in this plan follows the same asymmetry. |
| `getUserPolicy()` is already the gateway's narrow per-call per-user read | `lib/db/repository/users.ts:101-113` — selects exactly `{ role, shareLogsWithAdmin }` | Adding the two override columns to *this one existing query* costs one extra column in a query that already runs, not a second query. D5. |
| Cap-blocked calls write **no** log row, deliberately | `lib/ai/gateway.ts:262-264`: *"the log IS the counter; writing a denial row would inflate the count and make retryAfterSeconds drift forward on every retry"* | Any new refusal arm this plan adds must make the same call explicitly. §4.7 does: the two BYOK refusal arms **do** write a row, and §4.7 says why the reasoning differs. |
| `liveLlmCalls` blocks **all** users unconditionally, and its own hint describes a *network* posture | `lib/settings.ts:48-54` — *"When off, AI calls are recorded and blocked before any network request is made. No response is produced."* | There is no "this doesn't apply to you" concept anywhere. D3 decides whether BYOK gets one (recommendation: **no**). |
| Settings are a generic end-to-end catalog — a new one is **one array entry** | `lib/settings.ts` `SETTING_DEFS`; `app/api/settings/route.ts:102-103` (PATCH allowlist) and `:155-157` (the `llmProvider`-specific `isProviderConfigured` gate); `SettingsView.tsx:593-620` renders `bool`/`int`/`enum` | Storage parsing, the PATCH allowlist and the UI renderer all already exist. The two new settings cost no UI work. |
| A default-**off** money-spending switch has an exact precedent, with its fail-safe reasoning written down | `lib/settings.ts` `mcpWrites` (bool, default false) and `getMcpWrites()` at `:299-314`: *"money-spending capabilities may only come from the ABSENCE of configuration in the fail-open direction, never from the fail-closed direction"* | The spend cap ships default-off (0 = disabled) for the same reason: shipping it must change nothing until an operator opts in. §4.9. |
| Env vars follow an **all-or-nothing group** pattern with boot-time validation and call-time throws | `lib/env.ts:181-192` (`assertServerEnv()`), `:208-259` (`_assertOAuthEnv()`: none set → feature off, some set → refuse to boot, all set → validate strictly) | `BYOK_ENCRYPTION_KEY` follows this exactly: **absent → BYOK off deployment-wide** (and the UI says so); **present → validated at boot or the app refuses to start**. §4.3. |
| The MCP guard's best-effort, throttled "touch" pattern already exists and never fails a request | `lib/auth/mcpGuard.ts:40, 126-137` (`TOUCH_THROTTLE_MS`) | Reused verbatim for `user_llm_key.lastUsedAt`. |
| Composite-primary-key tables with a soft user reference and an open-catalog text column already exist | `lib/db/schema.ts:275-286` — `oauth_account`, `primaryKey({ columns: [provider, providerAccountId] })`, and `provider: text('provider').notNull()` with the comment *"'google' — open catalog, no DB enum"* | `user_llm_key`'s `(userId, providerId)` composite PK and its enum-free `providerId` column copy this shape exactly, so a third LLM provider needs no migration. |
| Soft references carry **no** Drizzle `references()` cascade — deletion cascades are explicit in the repository | `lib/db/schema.ts:11-16`; `lib/db/CLAUDE.md` (*"so every soft-reference behaves the same visible way in one place"*) | `user_llm_key.userId` follows this. §7 risk 11 hands the user-deletion rule to the roadmap item that will need it — and asks for a **hard** delete there, deliberately diverging from `apiToken`'s soft delete, with the reason stated. |
| Repository barrel is the sole DB import surface outside `lib/db/` | `lib/db/CLAUDE.md` | One new repository file, re-exported through `repository/index.ts`; nothing imports `schema.ts` or an individual repository file directly. |
| A repository already refuses to return a stored secret's shadow, by type | `lib/db/CLAUDE.md` on `apiTokens.ts`: *"`tokenHash` is never returned by `listApiTokensForUser()` — only `prefix`/`name`/`scope`/dates"* | The exact rule `listLlmKeysForUser()` inherits for `sealedKey`, enforced by the DTO type first and a fitness assertion second. |
| "The API key must never appear in any error message" is **already a test**, for the global key | `lib/ai/__tests__/openaiCompatibleProvider.test.ts:206`; the provider file's own comment: *"NEVER read or include request headers — they carry the Authorization key"* | Extended to the BYOK path in §5.5. A leaked *user's own* key in an admin-visible log is a distinct and worse incident than a leaked platform key, which is why it gets its own assertion rather than riding on the existing one. |
| The gateway already records `${err.name}: ${err.message}` and nothing more into `llm_call_log.error` | `lib/ai/gateway.ts:314-316`, truncated to 2000 chars | Safe today by construction. **After this ships that safety is load-bearing rather than incidental** — a future "let's log more error detail" change becomes a credential-leak vector. §7 risk 3 says so in words so the constraint survives without depending on someone re-deriving it. |
| Provider errors are opaque and unclassified — there is no "your key looks invalid" layer, and no precedent for one | `lib/ai/gateway.ts:309-326` re-throws the original object (identity preserved so `err.name === 'AbortError'` keeps working downstream); `openaiCompatibleProvider.ts` throws a bare `Error` on any non-OK status | D8 builds the narrowest possible classifier: **HTTP status codes only, no message parsing** — consistent with this repo's rule that content classification is quantitative/structural, never keyword or phrase matching. |
| Callers already thread two typed gateway refusals through a belt-and-braces re-throw | `lib/ai/CLAUDE.md` "Callers — shape (§3.6, normative)": `if (err instanceof LlmDryRunBlockedError) throw err;` … then `if (!res.ok) { if (res.reason === 'llm_cap_reached') … }` | The two new refusal arms slot into this exact pattern in all three callers. No new mechanism, three near-identical edits. |
| Route-guard fitness buckets already cover both directories this plan adds routes to | `app/api/__tests__/route-guard.test.ts` — `account/**` requires `authenticate(` and forbids `authenticateAdmin(`; `settings/**` requires `authenticateAdmin(` | **This plan needs no new bucket** — unlike Plan 16, which had to replace a prefix rule with a per-file table. Worth stating as a cost this plan does not pay. |
| The admin Users grid is read-only and **says so in its own copy** | `app/components/Settings/AdminSettingsPane.tsx:531-534`: *"Read-only here — role and log-sharing changes aren't editable from this grid yet."* `ADMIN_KEYS` at `:25` covers only `maxUsers`, `accessRequestCodeExpiryHours`, `mcpWrites` | D5's per-user override makes this grid editable for the first time. That copy becomes wrong on ship and is a correctness fix, not polish (§10). |
| Migrations run `0000`–`0009`; `0009_share_agent.sql` (Plan 15, shipped 2026-08-31) is newest | `lib/db/migrations/` (verified by listing) | **Plan 14 still claims `0009` — now stale, since Plan 15 landed first and took it. Plan 16 claims "whatever is next."** This plan takes whatever `drizzle-kit` generates — §7 risk 5. A hand-written migration missing its `meta/` journal entry was a real Plan 13 bug; verify the journal entry lands. |
| Deployment is a single EC2 instance behind `https://myagentstudio.dev`; **merging to `master` is itself the deploy** | `CHANGELOG.md` 2026-08-26, `.github/workflows/ci.yml` | Single process → per-call SDK construction is cheap and an in-process anything is viable. Deploy-on-merge → the two new settings default to inert, and BYOK is off entirely without the env var. |
| Node 22 in CI | `.github/workflows/ci.yml` | `crypto.subtle` (WebCrypto), `crypto.randomBytes`, `crypto.createCipheriv`, `AbortSignal.timeout()` all available with no polyfill and no dependency. |
| The privacy policy currently enumerates who receives a user's data | `app/privacy/page.tsx` §"Data Sharing" (the same passage Plan 14 identified as mandatory to edit for an email processor) | Storing a user's third-party credential is a new category of stored personal data. **Likely a mandatory edit here, not a "check and judge"** — §7 risk 12. |

---

## 3. Guiding constraints (locked — do not replan during build)

Constraints 1 and 2 are the user's already-made decisions, recorded here with their reasoning
rather than re-litigated in §8.

1. **BYOK keys are stored persistently, encrypted at rest.** *(Locked by the user before
   drafting.)* Not session-only, not re-entered per call. The trade-off this accepts, stated
   plainly: a session-only key never exists on disk, so a database compromise leaks nothing —
   but it also means a user re-pastes their key on every login, and it is **unimplementable for
   MCP**, where there is no session and no UI to paste into (`push_agent` reaches the gateway
   with only a bearer token and a `userId`). Persistent storage is the only option that covers
   all four call paths (chat, strict import, structural import, MCP). The cost is that this
   codebase now owns a reversible-secret lifecycle it has never owned before, and §4.2/§4.3 are
   the price of that.
2. **BYOK covers both providers.** *(Locked by the user before drafting.)* One key per
   `(user, provider)` pair. The resolution branches on the provider `resolveActiveProvider()`
   already chose for that call — never on an assumption that Anthropic is active. A user with an
   Anthropic key and no OpenAI-compatible key, on a deployment whose `llmProvider` setting is
   `openaiCompatible`, uses the **platform** key for that call, and the Account UI tells them
   which provider is currently active so this is never a surprise. Alternative rejected:
   Anthropic-only BYOK, which would silently mean "your key applies except when the operator
   flips a setting you cannot see."
3. **The credential travels with the request, never with the provider.** `LLMProvider` gains no
   method, `resolveActiveProvider()` keeps its zero-argument signature, `providerRegistry.ts`'s
   `_instances` Map keeps provider-id as its only key, and `createGateway(fakeProvider)`
   keeps compiling at every existing call site. Per-user provider instances are **not** cached
   anywhere.
4. **Only `lib/ai/gateway.ts` reads a stored key and only `lib/ai/gateway.ts` decrypts one.**
   The existing test-enforced boundary (`lib/ai/__tests__/architecture.test.ts:111-135`: no file
   under `lib/ai/` except `gateway.ts` may import from `lib/db/`) is **not widened**, and
   `lib/byok/` is kept DB-free so it inherits the same posture. Asserted in §4.12, not merely
   intended.
5. **Only `gateway.ts` may set `credential` on a request.** The field exists on
   `ResolvedLlmRequest` (which the gateway builds) and **not** on `LlmRequest` (which callers
   build), so a caller literally cannot supply one. This mirrors the existing asymmetry the
   gateway already documents for `forceDryRun` — *"May only downgrade a live call to a dry run —
   never the reverse"* (`lib/ai/gateway.ts:44-48`): there is no field a caller can set that
   causes a call to be funded differently than the gateway decided.
6. **No automatic fallback to the platform key, in any BYOK failure state.** Unreadable,
   rejected, expired, revoked — all refuse loudly and name the recovery. The **one** exception is
   deployment-wide absence of a wrapping key, which is an operator act, not an accident, and is
   disclosed in the Account UI in words (§4.3). Reasoning: an automatic fallback spends the
   operator's money without the user asking and moves the user's data to a key they did not
   choose — two different parties surprised by one silent branch.
7. **No plaintext key is ever persisted, logged, echoed, or shown to an admin.** Not in
   `llm_call_log.error`, not in a response body (including the response to the request that just
   supplied it), not in a `console` line, not in an admin surface. The owning user sees **last 4
   characters only**; an admin sees `platform` vs `byok` and nothing else, ever.
8. **"Flag, don't block" applies to key *shape*, and does not apply to key *state*.** This
   distinction is load-bearing and must be stated in the code, because a future session will
   otherwise cite the principle at the wrong layer. `docs/system-about.md` §3's principle —
   nothing is silently rewritten or refused on the way in; a problem is surfaced for the user to
   notice and act on — **does** govern the pasted value: a key that does not look like
   `sk-ant-…` is stored with a visible warning, never rejected, because Anthropic can change its
   key format and this app must not be the reason a valid key is refused (and because the
   OpenAI-compatible provider has no canonical shape at all). It **does not** govern a key in
   `unreadable` or `rejected` state: that is a hard refusal, exactly as `authenticateMcpToken()`
   hard-refuses a bad token, and calling it "flagging" would mean spending someone's money to
   find out.
9. **The cap gate contains no funding-source branch.** Whether a call is BYOK-funded or
   platform-funded must not change *whether* a cap applies — only an admin's explicit per-user
   override changes a limit. Enforced structurally, not by convention: the cap decision moves to
   a pure `lib/ai/caps.ts` function whose **signature has no `keySource` parameter**, so a
   special case cannot be written without changing a type (§4.12).
10. **Every new column on an existing table is nullable, and nothing is backfilled.** The stated
    reason is the one `llm_call_log.origin`'s own comment already gives — a `NOT NULL DEFAULT`
    requires a table rebuild on an existing deployment. Beyond migration friendliness, backfilling
    a cost estimate onto historical rows would apply today's prices to past calls and produce a
    number that looks authoritative and is not; NULL means "unknown," which is the truth.
11. **A deployment with no `BYOK_ENCRYPTION_KEY` behaves exactly as today**, and a deployment
    with a partially/incorrectly configured one **refuses to boot** — the all-or-nothing pattern
    `_assertOAuthEnv()` already implements (`lib/env.ts:208-259`) and the reason it gives:
    partial config is worse than none.
12. **No live call, no billed call, and no test/build run happens without an explicit ask.**
    Steps 1–11 in §6 are fully offline. §5.8's three live steps are asks, not steps, and each
    names whose key it will spend before it is asked.

---

## 4. Implementation shape

### 4.1 Where the code lives

A new top-level **`lib/byok/`**, sibling to `lib/ai/`, `lib/mcp/`, `lib/auth/` — not
`lib/auth/byok/` and not a lone file under `lib/ai/`.

Reasons, each concrete:

- It is **not authentication**. `lib/auth/` answers "who is making this request." BYOK answers
  "which third-party credential funds this request." Filing it under `lib/auth/` would put two
  unrelated meanings of the word *credential* behind one path segment — the same confusion Plan
  16 avoided by refusing to nest `lib/oauth-server/` under `lib/auth/oauth/`.
- It **cannot** live under `lib/ai/`, because the wrapping-key lifecycle wants its own
  `CLAUDE.md` and `lib/ai/CLAUDE.md` is already the longest folder doc in the repo.
- It earns a per-subsystem `__tests__/architecture.test.ts` under this repo's existing precedent
  (`lib/ai/` and `lib/mcp/` each carry one).

**`lib/byok/` is DB-free and gateway-free.** It is pure computation plus one env read:

```
lib/byok/secretBox.ts   seal()/open() — AES-256-GCM, versioned envelope, AAD binding
lib/byok/keyShape.ts    normalize + shape warning + last4 — pure, no I/O
lib/byok/constants.ts   envelope version, cipher params, status vocabulary. No imports.
lib/byok/CLAUDE.md      the wrapping-key lifecycle, in its own words
```

The DB read and the decrypt **call** both happen in `lib/ai/gateway.ts`, per constraint 4. The
write path (sealing a newly pasted key) happens in the account route, which is already permitted
to import the repository barrel like every other route.

```
POST/PUT /api/account/llm-keys/[providerId]
   │  keyShape.normalize() → warn (never reject) → secretBox.seal()
   ▼
lib/db/repository/userLlmKeys.ts  ──►  user_llm_key   (sealed_key, wrapping_key_id, last4, …)
                                              │
   caller (prometheus/hermes/daedalus/MCP)     │
        │                                      │
        ▼                                      │
   lib/ai/gateway.ts  ── step 2b: read row ◄───┘         ← the ONLY DB reader (constraint 4)
        │              ── step 4:  secretBox.open()      ← the ONLY decrypter
        ▼
   resolvedReq = { ...req, model, credential }           ← constraint 5
        │
        ▼
   provider.complete/stream(resolvedReq)
        ├─ anthropicProvider.ts       credential ? new Anthropic({apiKey}) : the singleton
        └─ openaiCompatibleProvider.ts  `Bearer ${req.credential ?? getOpenAICompatibleApiKey()}`
```

### 4.2 The cipher and the envelope (`lib/byok/secretBox.ts`)

**AES-256-GCM via `crypto.subtle`** (WebCrypto, global in Node 22 — `lib/ai/CLAUDE.md`'s own
note that Node 22 is the CI runtime and gives global `fetch`/`AbortSignal.timeout()` with no
polyfill applies identically here). **Zero new npm dependency**, consistent with the precedent
Plan 11 set when it implemented the second LLM provider over plain `fetch` rather than vendoring
a second SDK.

Why AES-GCM specifically, and why `subtle` rather than the older `createCipheriv`:

- GCM is an **AEAD** — it authenticates as well as encrypts, so a tampered or truncated
  ciphertext fails to open rather than decrypting to garbage that then gets sent to a vendor as
  an `Authorization` header.
- `crypto.subtle`'s `encrypt`/`decrypt` handle the authentication tag **as part of the
  ciphertext**. `createCipheriv`'s GCM mode requires calling `getAuthTag()` and
  `setAuthTag()` by hand, and forgetting `setAuthTag()` on the decrypt side silently disables
  authentication — the classic footgun in exactly this code. Choosing the API that makes the
  mistake unrepresentable is worth more here than the syntactic familiarity of `createCipheriv`.
- **The cost, stated:** `crypto.subtle` is Promise-based, and this codebase is otherwise
  synchronous around the database (`better-sqlite3` is sync; `getUserPolicy()` is sync). The
  decrypt happens inside `gateway.ts`'s `run()`, which is **already `async`**, so it is
  contained — and a future refactor that tries to move a decrypt into a synchronous path will
  fail to compile, which is a feature. If the user prefers synchronous, `createCipheriv`/
  `createDecipheriv` with explicit tag handling is the drop-in alternative and changes only this
  one file; it is not the recommendation (D2).

**The envelope** — one opaque, self-describing, versioned string stored in one column:

```
v1.<base64url(iv, 12 bytes)>.<base64url(ciphertext ‖ tag)>
```

- **Version prefix `v1`** so a future algorithm change is detectable without a schema change and
  without guessing. An unrecognised version is a hard `open()` failure, never a best-effort parse.
- **A fresh random 12-byte IV per seal**, from `crypto.randomBytes` — never derived, never
  reused. IV reuse under a fixed key is the one catastrophic misuse of GCM, so it is generated at
  the single call site and never passed in.
- **AAD (additional authenticated data) = `` `${userId}|${providerId}|v1` ``.** This binds the
  ciphertext to the row it lives in: copying user A's `sealed_key` value into user B's row, or
  into A's *other* provider row, produces an authentication failure rather than a working
  credential. It costs nothing and closes a real database-tampering path. §5.1 tests it directly.

**`open()` never throws a leaky error.** It returns a discriminated result —
`{ ok: true, plaintext }` | `{ ok: false, reason: 'wrong_wrapping_key' | 'tampered' |
'unknown_version' }` — because a thrown `OperationError` from WebCrypto, caught generically
upstream and stringified into `llm_call_log.error`, is exactly how implementation detail leaks
into an admin-visible log.

### 4.3 The wrapping key — configuration, rotation, and the loss failure mode

**This is the highest-stakes design in the plan.** It has three parts: how the key is
configured, how it is rotated safely, and what happens when it is lost or changed anyway.

#### Configuration

Two environment variables, validated in `lib/env.ts` alongside the existing OAuth group:

| Var | Required? | Role |
|---|---|---|
| `BYOK_ENCRYPTION_KEY` | Optional as a group; **if present, must be valid or the app refuses to boot** | 32 random bytes, base64-encoded (44 chars) or 64 hex chars. Seals every new key; opens every row whose `wrapping_key_id` matches it. |
| `BYOK_ENCRYPTION_KEY_PREVIOUS` | Optional | **Decrypt-only.** Never seals anything. Exists solely so a rotation is zero-downtime. |

`_assertByokEnv()`, wired into `assertServerEnv()`, follows `_assertOAuthEnv()`'s exact shape and
stated rule (*none set → feature disabled, app runs normally; set but invalid → throw, because
partial config is worse than none*):

- Neither set → BYOK is **not configured** on this deployment. No error, no warning at boot.
- `BYOK_ENCRYPTION_KEY` set but not decodable to exactly 32 bytes → **throw at boot** with a
  message that says the required length and encoding and **never echoes the value**.
- `BYOK_ENCRYPTION_KEY_PREVIOUS` set without `BYOK_ENCRYPTION_KEY` → **throw** (a decrypt-only
  key with nothing to seal with is a half-finished rotation, and silently ignoring it would mean
  every new key is sealed under a key the operator thinks is retired).
- Both set and equal → **throw** (a no-op rotation that gives false confidence).

**`.env.example` and `README.md` must mark `BYOK_ENCRYPTION_KEY` as backup-critical, on the same
tier as `JWT_SECRET`, with the consequence restated inline at the citation site rather than
cross-referenced** — losing `JWT_SECRET` logs everyone out and they log back in; losing
`BYOK_ENCRYPTION_KEY` makes every stored BYOK key permanently unreadable and forces every BYOK
user to mint a new key at their provider. Those are different severities and both must be written
out where the variable is documented.

#### The wrapping-key id (`wrapping_key_id`)

Every row records **which** wrapping key sealed it: 8 hex characters of
`sha256('myagentstudio-byok-kid-v1' ‖ keyBytes)`.

- **Domain-separated on purpose** — the prefix means the stored value cannot be reused as a
  precomputation target against the raw key material anywhere else.
- **Truncated to 8 hex chars** — enough to distinguish keys in a deployment that will ever have
  two or three, far too little to attack a 256-bit secret.
- It buys three concrete things: (a) `open()` can distinguish *wrong key* from *tampered data*
  **before** attempting a decrypt; (b) rotation can find rows still sealed under the previous
  key; (c) an admin can see, at a glance, that all their BYOK rows are sealed under a key id that
  no longer matches the running server — which is the tell that says "you rotated the env var,"
  not "one user's row is corrupt."

#### Rotation, done properly — so loss is exceptional rather than routine

1. Operator generates a new 32-byte key.
2. Sets `BYOK_ENCRYPTION_KEY` = new, `BYOK_ENCRYPTION_KEY_PREVIOUS` = old. Deploy.
3. **Lazy re-seal on read:** when the gateway opens a row whose `wrapping_key_id` matches the
   *previous* key, it decrypts with the previous key, **immediately re-seals with the current
   key**, and writes back the new envelope + new `wrapping_key_id` — best-effort, inside its own
   try/catch, and **a failed re-seal never fails the call** (the plaintext is already in hand;
   discarding a working call for a housekeeping write would be strictly worse — the same rule
   `gateway.ts:338-341` already states for a failed log finalize).
4. **`scripts/rotate-byok-keys.ts`** re-seals every row eagerly in one pass, so the operator does
   not have to wait for organic traffic. Offline, no network, no LLM call, and **fully testable
   against the in-memory DB with two fabricated wrapping keys** — this script needs no live
   anything.
5. Once the script reports zero rows on the previous key, remove `BYOK_ENCRYPTION_KEY_PREVIOUS`.
   Deploy.

That is a real, complete, zero-downtime rotation path, and it exists specifically so the failure
mode below is an accident rather than a normal Tuesday.

#### The failure mode: the wrapping key is lost, or rotated without `_PREVIOUS`

**Start with the honest part.** If `BYOK_ENCRYPTION_KEY` is lost with no `_PREVIOUS` and no
backup, every stored ciphertext is **cryptographically unrecoverable.** That is not a defect to
be engineered around — it is the property that made encryption at rest worth doing. There is no
recovery mechanism to build. What must be designed is the **product behavior**, and it has to be
right, because the alternative failure modes are genuinely bad.

The design turns on one distinction, and everything follows from it:

> **Is there a wrapping key configured at all?** *Absent* means the operator turned BYOK off
> deployment-wide — a deliberate, global, explainable state. *Present but not the one that sealed
> this row* means something went wrong with this row — an accidental, per-user, actionable state.
> These are different situations and must not produce the same behavior.

**Case A — no wrapping key configured (`BYOK_ENCRYPTION_KEY` absent).**
This is the rollback path and the fresh-install path. Every stored row is **inert**: the gateway
does not read it, does not attempt to decrypt it, and every call uses the platform key.
**Critically, this is not silent.** The Account page renders, unconditionally and without the user
having to do anything: *"Bring-your-own-key is turned off on this deployment. Your saved key is
stored but is not being used — calls are running on the platform's key."* `PUT` returns
`409 byok_not_configured`. The row survives untouched, so re-configuring the same wrapping key
restores everything with no user action. Constraint 6's exception is exactly this case, and it is
an exception only because the disclosure makes it not a silent fallback.

**Case B — a wrapping key is configured, but this row cannot be opened under it.** Either
`wrapping_key_id` does not match the current key or the previous key, or it matches and the GCM
authentication fails anyway (tampering, corruption, a truncated column). Behavior, in order:

1. **No decrypt is attempted on an id mismatch.** The comparison is a cheap string equality on a
   value already in the row.
2. The row's `status` is flipped to `'unreadable'` with `status_changed_at = now` — one
   `UPDATE` on the **new** table (not on `llm_call_log`, so the sanctioned-exception boundary
   `lib/db/CLAUDE.md` documents there is untouched). This is why the user finds out from the
   Account page rather than from a failed chat turn: the state is recorded the first time it is
   observed, not re-derived each time.
3. **The call fails loudly.** The gateway returns a new arm
   `{ ok: false, reason: 'byok_key_unreadable', model, logId, providerId }`; the caller throws
   `LlmByokKeyUnreadableError` through the existing belt-and-braces pattern; every AI route maps
   it to **`409 { error: 'byok_key_unreadable', providerId, action: 're_enter_key' }`**.
   **409, not 500** — this is not a server fault from the user's side, it is an account state the
   user can fix, and it shares its status code with the existing
   `409 { error: 'llm_dry_run' }` refusal for the same reason: the request was well-formed and
   the account's current state refuses it.
4. **A log row IS written** (unlike a cap-blocked call, which deliberately writes none because
   *"the log IS the counter"* — `gateway.ts:262-264`). The reasoning differs and should be stated
   in the code: nothing counts BYOK failures, so writing a row does not inflate anything it later
   reads, and the operator needs to see the failure in the Activity Log. The row records
   `keySource: 'byok'`, `error: 'byok_key_unreadable'`, `dryRun: false`, no provider call made.
5. **The Account page shows a specific, actionable banner**, not a generic error:
   *"This server can no longer read your saved Anthropic key. Paste it again to continue — or
   switch to the platform's key."* Two buttons, both one click: **Re-enter key** and **Use the
   platform key instead** (which sets `enabled = 0` — an explicit, user-pressed fallback, which
   is precisely why it does not violate constraint 6).
6. **The row is never deleted on a failed open.** Deleting it would destroy the record that the
   user ever configured BYOK, and would make the next call fall back to the platform key
   *silently* — re-introducing, as a side effect, the exact behavior constraint 6 forbids.
7. **The admin sees an aggregate immediately.** `GET /api/settings/byok-status` returns
   `{ configured, wrappingKeyId, counts: { active, rejected, unreadable } }` and the Settings
   pane renders it. This is the operational tell that matters: **if the env var was rotated
   without `_PREVIOUS`, every BYOK user broke at the same instant**, and the operator needs to see
   `unreadable: 4` on one screen rather than diagnose it one support message at a time.
   **Counts only — never which users**, matching this codebase's existing non-disclosure posture
   and because naming them adds nothing operationally.

**Recovery, in one sentence:** the user mints a new key at their provider and pastes it. That is
always possible — unlike restoring a plaintext the app deliberately never kept — and it is the
only recovery path that exists, which is why every failure surface routes to it explicitly
instead of to a generic error.

**The two rejected alternatives, recorded so they are not re-proposed:**

- **Silent fallback to the platform key.** Rejected: it spends the operator's money without
  anyone asking, and it moves a user's prompts onto a credential and account they did not choose
  — two different parties surprised by one invisible branch. It is also the single hardest kind
  of bug to notice, since everything appears to work until the invoice arrives.
- **A generic hard failure with the existing opaque upstream error.** Rejected: indistinguishable
  from "the AI is down," so the user waits instead of acting, and the one thing that would fix it
  in five seconds is never surfaced.

### 4.4 Data model

#### `user_llm_key` — new table

One row per `(user, provider)`. Composite primary key, soft user reference with no Drizzle
`references()` cascade, enum-free provider column — copying `oauth_account`'s shape
(`lib/db/schema.ts:275-286`), whose `provider` column carries the comment *"open catalog, no DB
enum"* for the same reason: a third provider must not need a migration.

| Column | Type | Constraints / Notes |
|---|---|---|
| `user_id` | text, not null | Soft ref → `user.id`. PK part 1. Cascade on user deletion is explicit in the repository (§7 risk 11 — and it must be a **hard** delete). |
| `provider_id` | text, not null | `'anthropic'` \| `'openaiCompatible'` today; matches `PROVIDER_IDS` in `lib/ai/providerRegistry.ts:30`. PK part 2. **No DB enum.** |
| `sealed_key` | text, not null | The `v1.<iv>.<ct‖tag>` envelope (§4.2). **The only reversible secret in this schema.** Never returned by any list/read DTO — the same rule `listApiTokensForUser()` follows for `tokenHash`. |
| `wrapping_key_id` | text, not null | 8 hex chars (§4.3). Drives wrong-key detection and lazy re-seal. |
| `last4` | text, not null | Last 4 chars of the plaintext. **Owner-visible only, never admin-visible.** Last-4 rather than first-N because every Anthropic key shares its leading bytes (`sk-ant-…`), so a *display prefix* — the shape `api_token.prefix` uses at `lib/db/schema.ts:261` — would identify nothing here. |
| `shape_warning` | text, nullable | The stored warning from `keyShape.ts` if the pasted value did not match the expected shape. NULL = no warning. Persisted rather than recomputed so the UI can show it without the plaintext. |
| `enabled` | integer bool, not null, default `1` | The user's own on/off. Off ⇒ the platform key is used, the row is retained. |
| `status` | text, not null, default `'active'` | `'active'` \| `'rejected'` \| `'unreadable'`. §4.3 and §4.8 own the transitions. |
| `status_changed_at` | integer timestamp, nullable | When status last left `'active'`. Display only. |
| `created_at` | integer timestamp, not null | `default (unixepoch())`. |
| `updated_at` | integer timestamp, not null | Bumped on every key replacement and every status change. |
| `last_used_at` | integer timestamp, nullable | Best-effort, throttled to once per 5 minutes per row — byte-for-byte the `TOUCH_THROTTLE_MS` pattern at `lib/auth/mcpGuard.ts:40, 126-137`. A failure here never fails the call. |

Primary key: `primaryKey({ columns: [userId, providerId] })`.
Index: `user_llm_key_user_idx (user_id)` — the Account list; the composite PK already covers the
gateway's per-call lookup, which is the hot path.

**Deliberately not columns, each with a reason:**

- **Any plaintext key**, anywhere, ever.
- **A hash of the key.** Nothing looks a BYOK key up *by value* — the lookup is always
  `(userId, providerId)`. A hash column would exist only to be a second artefact derived from a
  secret, with no reader.
- **A per-user base URL** (D9). A user-supplied outbound URL makes the server issue requests to
  an arbitrary user-controlled host with a user-controlled body — textbook SSRF, on a single EC2
  instance whose metadata endpoint is reachable from itself. Named and refused here so a future
  session does not add it as an obvious convenience.
- **A per-user model override.** That is the separate roadmap item *Wiring a declared model for
  Prometheus*, which has its own open design question about model/provider coupling.
- **A second key per provider per user.** One key per pair; there is no stated need for two, and
  a second is a rename of the same concept with a multiplied surface.

#### `user` — two new nullable columns (D5)

| Column | Type | Notes |
|---|---|---|
| `llm_calls_per_hour_override` | integer, nullable | NULL ⇒ use the global `maxLlmCallsPerUserPerHour` setting. A value **replaces** the global for that user — it does not add to it. May be **lower** than the global, which makes the same field a throttle for an abusive account at no extra cost. |
| `llm_spend_per_day_cents_override` | integer, nullable | NULL ⇒ use the global spend-cap setting. `0` ⇒ **no spend cap for this user** (the global's own "0 = off" convention, §4.9). |

Why columns on `user` and not a `user_policy` table: `getUserPolicy()`
(`lib/db/repository/users.ts:101-113`) is already the narrow per-user read the gateway performs
on **every** call, selecting exactly `{ role, shareLogsWithAdmin }`. Adding two columns to that
one existing query costs nothing; a separate table costs a join or a second query on the hottest
path in the app, for two integers with no history requirement. A nullable
`ALTER TABLE ADD COLUMN` on SQLite is metadata-only — the reasoning `llm_call_log.origin`'s own
comment already records. **The ceiling, stated now so it is not discovered later
(§7 risk 7): at a third per-user override, move to a `user_policy` table.** Two is under it, and
`getUserPolicy()` is the single read that would change.

#### `llm_call_log` — three new nullable columns

| Column | Type | Notes |
|---|---|---|
| `key_source` | text, nullable | `'platform'` \| `'byok'` \| NULL (pre-BYOK rows — all platform-funded, but recorded as unknown rather than asserted). Nullable for the migration-friendliness reason `origin`'s own comment states. |
| `cost_micro_usd` | integer, nullable | Estimated cost in **micro-USD integers**, computed at finalize time from `usage` + `lib/ai/pricing.ts`. NULL = no pricing known for that model — **which is emphatically not `0`** (§4.9). Integers, not floats, because currency in floating point is a defect waiting for a large `SUM()`. |
| `pricing_as_of` | text, nullable | The `asOf` date of the pricing row used. Snapshot at write time, never updated — the same rule `sharedWithAdmin` follows on this table (`lib/db/CLAUDE.md`: *"written once by the gateway at call time and never touched again"*). |

The existing `llm_call_log_user_created_idx (user_id, created_at)` — added for the cap count —
covers the spend-window `SUM()` too, so **no new index is needed**.

**Existing data:** no row is modified, no backfill runs, no existing column changes meaning. One
new table nothing reads until a user configures a key, and five nullable columns that are NULL on
every pre-existing row.

### 4.5 Key shape handling (`lib/byok/keyShape.ts`) — pure, no I/O

`normalizeAndInspect(providerId, raw)` → `{ normalized, last4, warning: string | null }` or a
hard `reject` for exactly three hygiene failures.

**Rejected outright** (these are not "shape" judgements, they are correctness):

- Empty after trimming.
- Contains a CR or LF. A newline in a value destined for an HTTP `Authorization` header is a
  header-injection vector, and there is no legitimate key containing one.
- Contains a non-printable or non-ASCII character, or exceeds 512 characters. A generous bound
  that no real key approaches, present so a paste accident cannot become a large ciphertext.

**Warned, never rejected** (constraint 8):

- `anthropic`: the value does not start with `sk-ant-`. Stored anyway, with
  `shape_warning: "This doesn't look like an Anthropic key (they usually start with sk-ant-). Saved anyway — the first real call will tell us."`
  **Rationale, restated at the code site rather than cited:** Anthropic can change its key format,
  and this app must not be the reason a valid key is refused; the vendor's own 401 is the
  authoritative check, and D8 turns that into a clear message.
- `openaiCompatible`: **no shape check at all, ever.** There is no canonical shape — the same
  variable in this codebase has been valid holding an `nvapi-…` value (NVIDIA NIM, the
  confirmed-working configuration recorded in `lib/env.ts:136-144`), and OpenAI/Groq/others each
  use their own. Inventing a prefix heuristic here would be a keyword heuristic on
  vendor-controlled data, which is the class of check this repo has already decided against for
  agent content and which is no more defensible here.

Normalization is `trim()` only. **No case folding, no internal whitespace removal, no "helpful"
repair** — a key is an opaque bearer value and any transformation risks turning a valid key into
an invalid one that then produces a confusing 401.

### 4.6 The resolution chain — how a per-user key reaches a provider

The impact analysis correctly identifies the two structural obstacles:
`resolveActiveProvider()` is zero-argument by contract, and `anthropicProvider.ts` holds a
module-level SDK singleton built with one key. The design routes around both rather than through
either.

**Rejected — widening the resolver to `(userId?) => LLMProvider`.** It breaks
`createGateway()`'s published contract and every `createGateway(fakeProvider)` call site across
`gateway.test.ts`, `gateway-cap.test.ts` and `providerRegistry.test.ts`; and it forces
`providerRegistry.ts` to cache provider instances per user, which is the unbounded-Map growth the
impact analysis flags. Both costs are paid for a benefit that the alternative provides for free.

**Chosen — the credential travels with the request** (constraint 3):

```ts
// lib/ai/provider.ts — shape, not final code
export type ResolvedLlmRequest = LlmRequest & {
  model: string;
  /**
   * Per-user BYOK credential. Set by lib/ai/gateway.ts ONLY (constraint 5) — it is
   * deliberately absent from LlmRequest so no caller can supply one. Absent/undefined
   * means "use this provider's own configured platform credential."
   */
  credential?: string;
};
```

`credential` is on `ResolvedLlmRequest` (which only the gateway builds, at
`gateway.ts:189`'s `const resolvedReq = { ...req, model }`) and **not** on `LlmRequest` (which the
three callers build). A caller writing `credential:` in its request literal gets a TypeScript
excess-property error, and a fitness function catches anything that slips past the type
(§4.12).

**`openaiCompatibleProvider.ts` — two one-line changes.** The key is already read per call
(`Authorization: Bearer ${getOpenAICompatibleApiKey()}` in both `complete()` and `stream()`);
it becomes `req.credential ?? getOpenAICompatibleApiKey()`. There is no singleton to work
around: the provider object *"holds no connection state (fetch is stateless)"*, per that file's
own comment.

**`anthropicProvider.ts` — the singleton is preserved for platform calls and bypassed for BYOK
calls:**

```
getSdk(credential?: string): Anthropic
  credential === undefined  → the existing module-private lazy singleton, unchanged
  credential !== undefined  → new Anthropic({ apiKey: credential })   // per call, not cached
```

**Per-call construction, deliberately not cached, and the reason is security before
simplicity.** A cache keyed on a hash of the credential would work and would preserve connection
pooling — but it keeps N client objects, each holding a user's plaintext key, alive in process
memory for the lifetime of the process. Constructing per call keeps each plaintext's lifetime
bounded to one request. The performance cost is negligible in context: the modern SDK client is a
thin wrapper over `fetch`, and it is being constructed on a path that takes seconds and spends
money. If profiling ever shows otherwise, a **bounded** LRU keyed on `sha256(credential)` inside
this file is the escape hatch — **never** in `providerRegistry.ts`'s `_instances` Map, which
keeps provider-id as its only key (constraint 3, closing the unbounded-growth risk the impact
analysis raised).

**Neither provider file gains a DB import, a settings import, or knowledge of BYOK as a concept.**
Each sees one optional string on a request. That is what keeps this change from spreading.

### 4.7 The gateway's new gate order (`lib/ai/gateway.ts`)

The existing normative order is documented in `gateway.ts:149-171` and in `lib/ai/CLAUDE.md`. It
gains two steps and modifies two; **both documents must be updated in the same pass**, since a
normative ordering that exists in two places and disagrees is worse than one that exists in
neither.

```
0.   Resolve provider via resolve()                       UNCHANGED (zero-arg, constraint 3)
1.   Resolve model (req.model ?? provider.defaultModel()) UNCHANGED
2.   Read liveLlmCalls fresh                              UNCHANGED
2b.  NEW — READ the BYOK row for (ctx.userId, provider.id)
       skipped entirely when ctx.userId is null (scripts/tests/pre-auth)
       skipped entirely when no wrapping key is configured (§4.3 Case A)
       → keySource = 'byok' | 'platform'    (a row read, NO decrypt yet)
3.   Dry-run gate                                          UNCHANGED IN BEHAVIOR
       the log row now records keySource
       ── NOTE: 2b runs BEFORE this gate for the same stated reason step 1 does —
          so a dry-run row records what WOULD have been used. And because 2b does
          not decrypt, a dry-run deployment never touches the wrapping key at all.
4.   NEW — BYOK gate (live path only), in this order:
       status === 'unreadable'  → { ok:false, 'byok_key_unreadable' }  (no provider call)
       status === 'rejected'    → { ok:false, 'byok_key_rejected'   }  (no provider call, D8)
       otherwise → secretBox.open()  → on failure: mark 'unreadable', same refusal
                                     → on previous-key success: lazy re-seal, best-effort
       BOTH refusal arms WRITE a log row (reasoning in §4.3 step 4 — nothing counts
       these, so a row inflates nothing it later reads)
5.   Cap gate — MODIFIED: delegates to the pure lib/ai/caps.ts decision, which now
     takes the per-user overrides and the spend window. NO keySource parameter,
     by design and by signature (constraint 9).
6.   reserveCallSlot — now also writes keySource
7.   provider.complete/stream({ ...req, model, credential })
8.   finalizeCallLog — now also writes cost_micro_usd + pricing_as_of
     ── plus, on an LlmProviderAuthError from a BYOK call: mark status 'rejected' (D8)
```

**Two ordering choices worth stating explicitly, because both are easy to get backwards:**

- **Read the row before the dry-run gate; decrypt only after it.** Reading is a sub-millisecond
  indexed composite-PK lookup on `better-sqlite3` and makes the dry-run row accurate. Decrypting
  is the operation that touches the wrapping key, and a deployment in dry-run mode — the
  Plan 04-documented no-API-key deployment mode that `providerRegistry.ts:60-78` went out of its
  way to preserve — must not need one.
- **The BYOK gate runs before the cap gate.** A user whose key is unreadable should be told that,
  not told they are rate-limited; and a refusal that never reaches the provider should not consume
  cap budget.

**Latency, with numbers rather than reassurance:** one additional single-row composite-PK lookup
per call (`better-sqlite3` is synchronous and this is sub-millisecond), plus, on live BYOK calls
only, one AES-GCM decrypt of a ~100-byte payload (microseconds). Against a call path that takes
seconds and costs money, both are immaterial. The `getUserPolicy()` read the cap gate already
performs is unchanged in count — it gains two columns, not a second query.

### 4.8 Provider error classification (`LlmProviderAuthError`) — D8

Today any provider failure re-throws as an opaque object which routes map to a generic
`502 ai_upstream`. For BYOK that is unacceptable: a user whose key was revoked at the vendor
would watch chat "break" with no clue that a five-second fix exists.

**The classifier is deliberately the narrowest thing that works: HTTP status codes only, no
message parsing.** `LlmProviderAuthError extends Error` lives in `lib/ai/provider.ts`, beside the
existing `LlmProviderResponseError` and for the identical stated reason — *"the error class lives
here (not in a specific provider file) so both implementations can import it without either one
importing the other."*

- **`openaiCompatibleProvider.ts`**: `res.status === 401 || res.status === 403` →
  `LlmProviderAuthError`. Everything else keeps today's behavior byte-for-byte, including the
  400-character body snippet and the existing absolute rule that request headers are never read
  or included (they carry the `Authorization` value).
- **`anthropicProvider.ts`**: the SDK's own typed authentication error, or `err.status === 401`.
  This classification belongs in this file and nowhere else, because it is the sole
  `@anthropic-ai/sdk` importer and that is test-enforced
  (`lib/ai/__tests__/architecture.test.ts` `SOLE_IMPORTER_TABLE`).

**No message, body, or phrase matching anywhere in the classifier.** This repo has already
decided that classification of vendor-controlled text by keyword is not acceptable, and a vendor
rewording an error string must not silently turn a clear message into a generic one.

**The gateway branches the *same* classified error on `keySource`, and this is the part that
prevents a very confusing misfire:**

| `keySource` | Meaning | Result |
|---|---|---|
| `'byok'` | The **user's** key was refused | Mark the row `status = 'rejected'`; caller throws `LlmByokKeyRejectedError`; route returns `409 { error: 'byok_key_rejected', providerId, action: 're_enter_key' }`. Account page shows the re-enter banner. |
| `'platform'` | The **operator's** key was refused | Today's behavior, unchanged: the original error re-throws to the existing generic upstream mapping. **Under no circumstances does this produce "re-enter your key"** — the user has no key to re-enter and the actual problem is the deployment's configuration. |

**A `'rejected'` key short-circuits at step 4** so every subsequent call does not pay for a
doomed round trip. That is correct for a revoked key and wrong for a transient vendor hiccup, so
the Account page carries a **"Try again"** action that flips `'rejected'` → `'active'` without
re-entering anything. One click, no re-paste, and the transient case resolves itself.

### 4.9 Business rules, stated once

#### Invariants (always true)

1. A call is funded by exactly one credential, decided before the provider is invoked and
   recorded on the log row as `key_source`.
2. No plaintext key is persisted, logged, echoed in any response body (including the response to
   the request that supplied it), or shown to any admin.
3. `sealed_key` is never returned by any DTO, route, or repository read function.
4. A BYOK credential is used only for the provider it was stored against. A key stored for
   `anthropic` is never sent to the OpenAI-compatible endpoint, and vice versa — enforced by the
   composite-PK lookup being performed with the *already-resolved* `provider.id`, not with a
   guess.
5. The AAD binding means a `sealed_key` value moved to a different `(user_id, provider_id)` row
   cannot be opened.
6. Nothing outside `lib/ai/gateway.ts` decrypts a stored key; nothing outside
   `lib/byok/secretBox.ts` performs a cryptographic operation on one.
7. `cost_micro_usd` is NULL when pricing is unknown. It is never `0` as a stand-in for unknown.
8. The cap decision never reads `key_source` — structurally, because `lib/ai/caps.ts`'s signature
   does not accept it.

#### Policies (configurable, with their defaults and fail-safes)

9. **`BYOK_ENCRYPTION_KEY` absent ⇒ BYOK is off deployment-wide**, stored rows are inert, and the
   Account page discloses this in words. Present-but-invalid ⇒ the app refuses to boot.
10. **`liveLlmCalls: off` blocks BYOK users too** (D3). The toggle's own hint describes a network
    posture — *"blocked before any network request is made"* — not a billing posture, and this
    repo's standing rule against unasked billed calls is enforced by exactly this switch. A
    partial guarantee would be worse than a clear one.
11. **Both caps apply to everyone by default and are raised (or disabled) per user by an admin
    override**, never by a BYOK special case (D4). The hourly call cap remains a runaway-loop
    control as much as a spend control — an MCP client looping with a BYOK key still consumes the
    operator's CPU, SQLite write throughput and egress, none of which the user's key pays for.
12. **Admins remain cap-exempt**, unchanged. The per-user override is therefore moot for them,
    and the code says so rather than implying it.
13. **The spend cap ships default-off** (`0` = disabled), matching `mcpWrites`'s default-off
    precedent and its stated reason. Shipping this changes nothing until an operator opts in.
    Window: **rolling 24 hours** (an hour of spend is too noisy a number to cap on), computed as a
    single `SUM(cost_micro_usd)` over the existing `(user_id, created_at)` index.
14. **The spend cap fails *open* on unknown pricing**, and this is safe for one specific reason
    that must be stated wherever the rule appears: **the call-count cap is an always-on floor
    beneath it.** An unpriced model is therefore never unbounded, only unpriced — so refusing
    calls the moment a vendor ships a model the pricing table has not caught up with would block
    legitimate use to defend a ceiling that is already defended.
15. **Pricing lives in `lib/ai/pricing.ts` as a hardcoded, versioned constants table** (D6):
    `{ providerId, modelPrefix, inputPerMTokUsd, outputPerMTokUsd, currency: 'USD', asOf }`,
    matched by **longest prefix** (model ids carry version suffixes, so exact match goes stale
    faster). Every row carries `asOf`; the UI renders the word *estimate* and that date. **The
    staleness risk is made visible rather than hidden** — that is the entire mitigation, and it is
    honest about what a hardcoded table is.

#### State transitions

16. `(absent)` → `active`: user pastes a key (`PUT`). Seals, stores, sets `enabled = 1`,
    `status = 'active'`.
17. `active` → `rejected`: the vendor returned 401/403 on a BYOK-funded call (D8).
18. `active` → `unreadable`: `open()` failed — wrong wrapping key, or authentication failure
    (§4.3 Case B).
19. `rejected` → `active`: user presses **Try again** (no re-paste), or pastes a new key.
20. `unreadable` → `active`: **only** by pasting a key. "Try again" is deliberately not offered
    here — nothing about the situation can change without new plaintext, and offering a button
    that cannot work is worse than offering none.
21. `enabled: 1` → `0`: user presses **Use the platform key instead**. The row and its status are
    retained; calls fund from the platform key. This is the one user-initiated fallback, and it is
    consent-preserving precisely because the user pressed it.
22. Any state → `(absent)`: user presses **Remove**. Hard delete of the row — a stored live
    third-party credential is not something to soft-delete for an audit trail.
23. `wrapping_key_id = previous` → `wrapping_key_id = current`: lazy re-seal on a successful open
    under `BYOK_ENCRYPTION_KEY_PREVIOUS`, or eagerly via `scripts/rotate-byok-keys.ts`.
    Best-effort; a failed re-seal never fails the call.

### 4.10 API surface

Five new routes. **Every one falls into an existing route-guard fitness bucket** — `account/**`
(requires `authenticate(`, forbids `authenticateAdmin(`) and `settings/**` (requires
`authenticateAdmin(`) — so unlike Plan 16, this plan adds **no new bucket and no per-file table**.
Stated as a cost this plan does not pay.

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| `GET` | `/api/account/llm-keys` | session — `authenticate(` | — | `{ byokConfigured, activeProviderId, endpointHost?, keys: [{ providerId, last4, enabled, status, statusChangedAt, shapeWarning, createdAt, lastUsedAt }] }` | `401` |
| `PUT` | `/api/account/llm-keys/[providerId]` | session | `{ key: string }` | `200 { providerId, last4, status:'active', shapeWarning }` | `400 invalid_provider`, `400 invalid_key` (the three hygiene rejections only), `409 byok_not_configured`, `401`, `429` |
| `PATCH` | `/api/account/llm-keys/[providerId]` | session | `{ enabled: boolean }` **or** `{ retry: true }` | `200 {…same shape as GET's row…}` | `400`, `404`, `401` |
| `DELETE` | `/api/account/llm-keys/[providerId]` | session | — | `204` | `404`, `401` |
| `GET` | `/api/settings/byok-status` | **admin** — `authenticateAdmin(` | — | `{ configured, wrappingKeyId, counts: { active, rejected, unreadable } }` | `401`, `403` |

Route-level rules, each a real requirement rather than boilerplate:

- **No route ever returns a plaintext key** — including `PUT`, which has one in hand. Echoing it
  back puts it in the browser's network log and any intermediary cache for zero benefit.
- **`PUT` is idempotent replace, not create.** Re-pasting is the primary recovery action for both
  failure states, so there is no separate update verb and no `409 already_exists`.
- **`PUT` is rate-limited** via the existing `checkRateLimitByKey('byok-put:<userId>')` primitive
  (`lib/auth/rateLimit.ts`, already used with a non-IP identity by `mcpGuard.ts` as
  `mcp:<tokenId>`). Not because guessing matters — the caller is authenticated — but because each
  `PUT` is an encryption plus a write, and an authenticated loop is still a loop.
- **`endpointHost` is the *host only*** of `OPENAI_COMPATIBLE_BASE_URL`, and it is present only
  when that provider is active. The user needs to know which vendor's key to paste (D9 keeps the
  base URL operator-owned); the host is the operator's vendor choice and is not a secret. The
  full URL, the path, and the operator's own key are never sent.
- **`/api/settings/byok-status` returns counts, never identities.** It exists for exactly one
  operational question — *did I just break everyone by rotating the env var?* — which a count
  answers and a user list does not improve.
- **Backward compatibility:** no existing request or response shape changes. AI-calling routes
  gain two new `409` error arms (`byok_key_unreadable`, `byok_key_rejected`); a client that does
  not recognise them falls through to its generic error rendering — degraded, not broken. **No
  API versioning is needed.**

### 4.11 UI — mockup-first per standing rule 4

Per this repo's standing rule that layout/UI changes prototype in
`reference/layout/Layout-Workbench.html` before touching live React — because that file is
self-contained (no dev server, no DB, no build step), so iterating there is faster to test and
safer to throw away — and per its dispatch guidance: **one visual concept per dispatch**, and
**explicitly waive the build-equivalent sanity check** in the dispatch prompt, since there is no
compiler for that file and the gate is a human looking at it in a browser.

| Surface | Where | Mockup first? |
|---|---|---|
| **A. "Your LLM key" section** — one row per configurable provider: which provider is active, a masked field showing `…last4`, a status badge, the enable toggle, **Re-enter**, **Try again** (only when `rejected`), **Use the platform key instead**, **Remove**; plus the paste field with its shape-warning line. | `app/components/Account/AccountView.tsx` + new `app/components/Account/AccountLlmKeys.tsx` | **Yes — dispatch 1.** A secret-entry field with a four-state machine is a genuinely new visual concept; the API-tokens list next to it is a *create-once, display-prefix, revoke* pattern and does not cover a re-enterable, re-validatable secret. |
| **B. The failure banners** — the `unreadable` banner (§4.3 step 5) and the `rejected` banner (§4.8), plus the deployment-wide "BYOK is turned off here, your saved key is not being used" notice (§4.3 Case A). | same components | **Yes — dispatch 2**, small; foldable into dispatch 1 if the user prefers fewer round trips. These three messages are the entire recovery UX and are worth seeing side by side. |
| **C. Per-user cap override in the admin Users grid** — the first editable cell in a grid whose own copy currently reads *"Read-only here — role and log-sharing changes aren't editable from this grid yet"* (`AdminSettingsPane.tsx:531-534`). | `app/components/Settings/AdminSettingsPane.tsx` | **Yes — dispatch 3.** Turning a read-only table into an editable one is a new interaction for that pane, and it needs an answer for the empty/NULL state ("uses global: 15") that does not read as "0". |
| **D. Activity Log: `key_source` badge + cost estimate** beside the existing `Tokens: N in / N out` line (`ActivityLogPane.tsx:279`). | `app/components/Settings/ActivityLogPane.tsx` | **No.** A badge and one line in an existing expanded-row layout, using the visual that pane already ships. Re-prototyping a shipped table is the detour standing rule 4 warns against, not the discipline it asks for. |
| **E. Two new settings rows** (spend cap; and D3's optional exemption if the user takes that branch) | `app/components/Settings/SettingsView.tsx` | **No.** One `SETTING_DEFS` entry each through the existing `int`/`bool` renderers (`SettingsView.tsx:593-620`) — zero UI work, exactly like `mcpWrites`. |
| **F. Admin BYOK status line** (`{ counts }` from `/api/settings/byok-status`) | `AdminSettingsPane.tsx` | **No.** One line of text in an existing pane. |

**Two copy rules that are requirements, not tone:**

- **The Account page must always say which provider is currently active**, because a user's
  Anthropic key does nothing on a deployment whose `llmProvider` setting is `openaiCompatible`
  (constraint 2). Without that line, a correctly-stored key that is simply not in use looks
  broken.
- **Every failure banner names the fix in its first sentence.** The failure modes here are ones
  the user can resolve in seconds and cannot diagnose at all — that asymmetry is the whole reason
  D8 exists.

### 4.12 Fitness functions

New: `lib/byok/__tests__/architecture.test.ts`, following the per-subsystem precedent (`lib/ai/`
and `lib/mcp/` each carry one) and table-driven so a future addition is a row rather than an
exception. Plus additions to `lib/ai/__tests__/architecture.test.ts`'s existing tables.

| Rule | Assertion |
|---|---|
| **Only the gateway decrypts** *(the most valuable assertion here)* | `openSealedKey(` appears in exactly one file outside `lib/byok/` and its tests: `lib/ai/gateway.ts`. |
| **Only the gateway sets a credential** | The token `credential:` appears only in `lib/ai/gateway.ts`, `lib/ai/provider.ts`, `lib/ai/anthropicProvider.ts`, `lib/ai/openaiCompatibleProvider.ts`. **No caller** (`hermes.ts`, `daedalus.ts`, `prometheus.ts`), no route, no component. |
| **The existing DB boundary is untouched** | `lib/ai/__tests__/architecture.test.ts:111-135`'s rule passes **unmodified** — if it needed editing, the design has been misread; stop. **Plus a new sibling:** no file under `lib/byok/` imports from `lib/db/` at all. |
| **The wrapping key has exactly one reader** | `BYOK_ENCRYPTION_KEY` appears in exactly one source file: `lib/env.ts`. (`.env.example` is not a `.ts` file and is outside the scan.) |
| **No plaintext or sealed key escapes the repository** | `sealedKey` appears only in `lib/db/schema.ts`, `lib/db/repository/userLlmKeys.ts`, and `lib/byok/`. **Zero occurrences under `app/`.** |
| **No admin surface touches key material** | Neither `last4` nor `sealedKey` appears in any file under `app/api/settings/` or `app/components/Settings/`. |
| **The cap gate has no funding-source branch** *(constraint 9, made structural)* | Asserted **by type, not by string scan**: `lib/ai/caps.ts` exports the cap decision as a pure function whose parameter type has no `keySource` field. A special case cannot be written without changing a published type — which is exactly the review moment that change deserves. The string-level assertion (`keySource` does not appear in `caps.ts`) is the second line, not the first. |
| **One cipher implementation** | `crypto.subtle` / `AES-GCM` appears under `lib/` in exactly one file: `lib/byok/secretBox.ts`. Two encryption implementations that could drift is the failure this prevents. |

### 4.13 Files

| File | New/Mod | Role |
|---|---|---|
| `lib/byok/constants.ts` | **new** | Envelope version, IV length, key length, status vocabulary, AAD template. No imports (dependency root of this subsystem). |
| `lib/byok/secretBox.ts` | **new** | `seal()` / `open()` — AES-256-GCM, versioned envelope, AAD binding, discriminated failure result (§4.2). Sole owner of the cipher. |
| `lib/byok/keyShape.ts` | **new** | `normalizeAndInspect()` — three hygiene rejections, one soft warning, `last4`. Pure (§4.5). |
| `lib/byok/CLAUDE.md` | **new** | Folder explainer. **Must state the wrapping-key lifecycle in its own words** — configuration, rotation with `_PREVIOUS`, and both failure cases — not point at this plan, which will be archived. |
| `lib/byok/__tests__/*.test.ts` | **new** | §5.1 + §4.12. |
| `lib/env.ts` | mod | `isByokConfigured()`, `getByokWrappingKey()`, `getByokPreviousWrappingKey()`, `getByokWrappingKeyId()`, `_assertByokEnv()` wired into `assertServerEnv()` (§4.3). |
| `lib/db/schema.ts` | mod | `user_llm_key` + its index; two nullable `user` columns; three nullable `llm_call_log` columns (§4.4). |
| `lib/db/migrations/00NN_*.sql` | **new** | `drizzle-kit`-generated. **Verify the `meta/` journal entry lands** — a hand-written migration missing one was a real Plan 13 bug. Number contested with Plans 14/16 (§7 risk 5). |
| `lib/db/repository/userLlmKeys.ts` | **new** | Sole owner of `user_llm_key`. `getLlmKeyFor(userId, providerId)`, `listLlmKeysForUser(userId)` (**never selects `sealedKey`**), `upsertLlmKey`, `setLlmKeyEnabled`, `setLlmKeyStatus`, `reSealLlmKey`, `deleteLlmKey`, `touchLlmKeyUsed` (throttled), `countLlmKeysByStatus()` (the admin aggregate). |
| `lib/db/repository/users.ts` | mod | `getUserPolicy()` returns the two override columns; an admin setter for them. |
| `lib/db/repository/llmCallLog.ts` | mod | `reserveCallSlot`/`finalizeCallLog` accept `keySource`/`cost`/`pricingAsOf`; new `sumLlmCostInWindow(userId, since)`; `CallLogListItem` gains the cost fields. |
| `lib/db/repository/index.ts` | mod | Barrel re-exports — the only import surface outside `lib/db/`. |
| `lib/ai/provider.ts` | mod | `ResolvedLlmRequest.credential?: string` (**not** on `LlmRequest`); `LlmProviderAuthError` beside the existing `LlmProviderResponseError`, for that class's own stated reason. |
| `lib/ai/anthropicProvider.ts` | mod | `getSdk(credential?)` — singleton for platform, per-call client for BYOK (§4.6); SDK auth-error classification (§4.8). |
| `lib/ai/openaiCompatibleProvider.ts` | mod | `req.credential ?? getOpenAICompatibleApiKey()` in `complete()` and `stream()`; 401/403 → `LlmProviderAuthError`. |
| `lib/ai/caps.ts` | **new** | The cap decision as a pure function — **signature carries no funding-source input** (constraint 9, §4.12). Extracted from `gateway.ts` behavior-preservingly, with the existing `gateway-cap.test.ts` as its regression net. No DB import. |
| `lib/ai/pricing.ts` | **new** | The hardcoded pricing table + longest-prefix lookup + micro-USD arithmetic. Pure, no DB, no network (D6). |
| `lib/ai/gateway.ts` | mod | Steps 2b and 4; two new `LlmGatewayResult` arms; two new error classes; `keySource`/cost on log rows; the cap gate through `caps.ts`; lazy re-seal (§4.7). |
| `lib/ai/hermes.ts`, `daedalus.ts`, `prometheus.ts` | mod | Three near-identical edits: the two new refusal arms threaded through the existing belt-and-braces re-throw pattern documented in `lib/ai/CLAUDE.md`. |
| `lib/ai/CLAUDE.md` | mod | The gate order (which that file states normatively today), the gateway-only `credential` rule, the two new result arms, the cost columns. |
| `lib/settings.ts` | mod | `maxLlmSpendPerUserPerDayCents` (int, default `0` = off) + typed accessor; D3's optional exemption bool if taken. |
| `app/api/account/llm-keys/route.ts` | **new** | `GET`. |
| `app/api/account/llm-keys/[providerId]/route.ts` | **new** | `PUT` / `PATCH` / `DELETE`. |
| `app/api/settings/byok-status/route.ts` | **new** | `GET`, admin, counts only. |
| every AI-calling route (`/api/chat`, `/api/agents/import`, apply/proposal paths, and the MCP tool path via the gateway) | mod | Map the two new typed errors to `409`. Mechanical; the `LlmDryRunBlockedError`/`LlmUserCapReachedError` mapping is the template. |
| `app/components/Account/AccountLlmKeys.tsx` | **new** | Dispatches 1–2's output. |
| `app/components/Account/AccountView.tsx` | mod | Mount the new section beside API tokens. |
| `app/components/Settings/ActivityLogPane.tsx` | mod | `key_source` badge + cost estimate (no mockup — §4.11 D). |
| `app/components/Settings/AdminSettingsPane.tsx` | mod | Editable override cell (dispatch 3); the BYOK status line; **fix the "Read-only here" copy**, which becomes false. |
| `scripts/rotate-byok-keys.ts` | **new** | Eager re-seal pass (§4.3). Offline, no network, no LLM call. |
| `reference/layout/Layout-Workbench.html` | mod | Three mockup dispatches (§4.11) — **before** any React work. |
| `lib/ai/__tests__/architecture.test.ts` | mod | New rows in the existing tables (§4.12). |
| tests | **new/mod** | §5. |
| `docs/system-about.md`, `docs/user-guide.md`, `docs/roadmap.md`, `lib/db/CLAUDE.md`, `lib/auth/CLAUDE.md`, root `CLAUDE.md`, `README.md`, `.env.example`, `CHANGELOG.md`, `plans/roadmap.md`, `app/privacy/page.tsx` | mod | §10. |

---

## 5. Testing approach

Everything in §5.1–§5.7 is **offline, mocked, and free** — the existing in-memory-DB harness
(`lib/db/__tests__/test-db.ts`, `test-users.ts`) plus fake providers, exactly the pattern every
existing suite uses, and the `vi.mock('.../ai/*.js', …)` convention this repo already relies on to
keep automated tests off the real API. §5.8 is the only live pass and it is **three separate
asks**, not steps. Per this repo's standing rule that no test/build/`tsc` run happens
automatically: **stop and ask before running any of these**, including at the end of a phase whose
definition of done mentions them.

### 5.1 `lib/byok/` — pure, no DB, no mocks

`secretBox.test.ts`:
- Round trip: `open(seal(k)) === k`, for a 40-char and a 200-char value.
- **Wrong wrapping key** → `{ ok:false, reason:'wrong_wrapping_key' }`, and **no exception
  escapes**.
- **Tampered ciphertext** (flip one byte) → `'tampered'`. Tampered IV → same.
- **AAD binding:** a blob sealed for `(userA, 'anthropic')` fails to open as
  `(userB, 'anthropic')` **and** as `(userA, 'openaiCompatible')`. This is the
  copy-a-row-between-users regression test.
- **IV uniqueness:** 1000 seals of the same plaintext produce 1000 distinct envelopes (a smoke
  check on the RNG wiring, not a statistical claim).
- Envelope shape: `v1.` prefix; three dot-separated parts; base64url character set only.
- **A `v2.` envelope is rejected as `'unknown_version'`, never best-effort parsed.**
- `wrappingKeyId` is stable for one key, differs across keys, and is exactly 8 hex chars.

`keyShape.test.ts`:
- Anthropic: `sk-ant-…` → no warning; `nvapi-…` → **a warning and a stored value**, never a
  rejection (constraint 8's regression test).
- `openaiCompatible`: **no input produces a shape warning**, asserted across several real vendor
  prefixes.
- Rejections: empty; whitespace-only; contains `\n`; contains `\r`; >512 chars; non-ASCII.
- Normalization is `trim()` only — a key with internal characters that look like whitespace is
  unchanged.
- `last4` on a 5-char and a 200-char value.

`pricing.test.ts`:
- Longest-prefix wins when two rows could match.
- **An unknown model returns `null`, and the test asserts `null` and not `0`** — explicitly, in
  its own case, because a silent zero is the single worst failure a spend cap can have.
- Every table row has a non-empty `asOf`.
- Micro-USD arithmetic over 10,000 rows produces an exact integer (no float drift).

### 5.2 Repository (in-memory DB)

`lib/db/repository/__tests__/userLlmKeys.test.ts`:
- Composite-PK upsert: two providers for one user coexist; re-`PUT` for one replaces only that
  row and bumps `updated_at`.
- **`listLlmKeysForUser()` never returns `sealedKey`** — asserted on the returned object's **key
  set**, not by eyeballing a field, the same way `apiTokens.ts`'s equivalent rule is held.
- **Cross-user isolation:** every read/write function scoped by `userId` returns nothing and
  changes nothing for another user — the posture `app/api/__tests__/tenancy.test.ts` already
  holds for agents.
- Status transitions (§4.9 rules 16–23), including that `unreadable` → `active` is **not**
  reachable via the retry path.
- `touchLlmKeyUsed` throttling: two calls within the window write once.
- `countLlmKeysByStatus()` aggregates correctly and returns no identities.
- Rotation: `reSealLlmKey` changes `sealed_key` and `wrapping_key_id` and leaves `last4`,
  `status`, `enabled` and `created_at` untouched.

`users.test.ts` additions: `getUserPolicy()` returns both overrides; NULL is distinguishable from
`0`.

`llmCallLog.test.ts` additions: `keySource`/cost round-trip; `sumLlmCostInWindow` ignores
`NULL` costs and dry-run rows; window boundary rows.

### 5.3 `lib/ai/caps.ts` — pure

- Override replaces the global; NULL uses the global; an override **lower** than the global is
  honoured.
- Admin exemption unchanged.
- `userId: null` skips, unchanged.
- **The existing `gateway-cap.test.ts` passes unmodified** after the extraction — that suite is
  the regression net for a refactor that must change no behavior. If it needed editing, the
  extraction was not behavior-preserving; stop.

### 5.4 The gateway — the credential-recording fake provider

**This harness is the single most valuable new test asset in the plan**, because the impact
analysis is correct that *no test can currently express "which key did this call use"* — the
existing fakes have no credential concept at all. The fake records `req.credential` and its own
call count.

- Platform user (no row) → `credential` is `undefined`.
- BYOK user, `enabled`, `active` → `credential` is **exactly** the plaintext that was sealed.
- BYOK row present but `enabled: 0` → `undefined`.
- **BYOK row stored for `anthropic` while `openaiCompatible` is the active provider →
  `undefined`.** This is constraint 2's regression test and the one a single-provider design
  would get wrong.
- `status: 'unreadable'` → `byok_key_unreadable` result, **provider call count is 0**.
- `status: 'rejected'` → `byok_key_rejected` result, **provider call count is 0**.
- Wrong wrapping key configured → status flips to `'unreadable'` **and** the refusal is returned,
  in one call.
- Previous-key row → opens, the call **succeeds**, and the row is re-sealed under the current key.
  Then: **a forced re-seal failure still lets the call succeed** (best-effort, §4.3 step 3).
- **Dry-run + BYOK:** the log row records `keySource: 'byok'` **and the decrypt function is never
  called** — asserted by spying on `open()` and expecting zero calls. This is the
  dry-run-deployment-needs-no-wrapping-key guarantee.
- `ctx.userId: null` → no row read at all (assert the repository function's call count is 0).
- No wrapping key configured → no row read, `credential` undefined, call succeeds on the platform
  key (§4.3 Case A).
- Cost: a live call with known pricing writes a non-NULL `cost_micro_usd` + `pricing_as_of`; with
  unknown pricing writes **NULL, not 0**.
- **A BYOK user and a platform user hit the same cap with the same override** — the no-special-case
  test for constraint 9.

### 5.5 Credential non-disclosure — the severity-1 suite

Extends the pattern already established at `lib/ai/__tests__/openaiCompatibleProvider.test.ts:206`
(*the API key must never appear in any error message*) to the BYOK path, as its **own** suite
rather than a rider on the existing one — a leaked *user's own* key in an admin-visible log is a
distinct and worse incident than a leaked platform key.

With a distinctive sentinel plaintext (`sk-ant-TESTSENTINEL…`), assert it appears in **none** of:
- Any `llm_call_log` row written on any path — success, provider error, auth error, dry-run,
  unreadable, rejected.
- Any error message thrown by either provider, including the 400-char body snippet path.
- Any response body from any of the five new routes, **including `PUT`'s own `201`/`200`**.
- Any `console.*` output captured during the run.
- Any DTO returned by `listLlmKeysForUser()` or `getUserPolicy()`.

### 5.6 Routes

- `PUT` stores; `GET` reflects; `PATCH { enabled:false }` disables without deleting;
  `PATCH { retry:true }` clears `'rejected'` but **not** `'unreadable'`; `DELETE` removes.
- `409 byok_not_configured` when no wrapping key is set, on `PUT` specifically.
- Tenancy: user A cannot `GET`/`PATCH`/`DELETE` user B's key by supplying a `providerId` —
  scoping is by session `userId`, never by a body or path value.
- `/api/settings/byok-status` requires admin (`403` for a signed-in non-admin) and **contains no
  user identifier and no key material** — asserted on the serialized body, not on the handler.
- Every AI route maps the two new gateway refusals to `409` with the documented body, and the
  **platform**-key auth failure maps to today's generic upstream error and **not** to
  `byok_key_rejected` (§4.8's misfire test).
- Rate limit: `PUT` returns `429` past its window.

### 5.7 The local echo-server harness — real HTTP, zero network, zero cost

A ~30-line `node:http` server bound to `127.0.0.1` on an ephemeral port, used as
`OPENAI_COMPATIBLE_BASE_URL` for one suite. It records the `Authorization` header of every request
and returns a minimal valid chat-completions body.

This gives, **entirely offline and for free**, the thing that otherwise looks like it needs a live
vendor:

- A **real** `fetch` round trip through the real `openaiCompatibleProvider.ts` code path.
- Proof that a BYOK call carries the **user's** key in the header and a platform call carries the
  **operator's** — the credential-routing property, verified on the wire rather than through a
  fake.
- **The cross-contamination check for this provider:** BYOK call, then platform call, then BYOK
  call again for a *different* user, in one process — assert three headers, three different
  values, in order.
- A `401` response from the echo server exercising the real classification path end to end.

**What it does not cover, stated plainly:** the Anthropic SDK path, and therefore the module-level
singleton — which is the higher-risk of the two providers (§7 risk 2). `anthropicProvider.ts` does
not expose a `baseURL` knob, and adding one solely for tests would be production code existing for
test convenience. So the singleton question is narrowed by this harness to exactly one claim —
*does per-call client construction keep a BYOK call and a platform call independent* — and that
claim is what §5.8's live steps 2 and 3 exist to settle. **Narrowing the live surface to one claim
is the point of building this harness.**

### 5.8 Live verification — **three separate explicit asks; never run automatically**

Everything above touches no external network and spends nothing. Three things cannot be faked.
Each is an **ask**: present it, say what it does, **say whose key it will use**, and wait.
Preconditions for all three: the dev server started **for this purpose only and shut down
immediately after** (stray `next dev` processes on the same SQLite file have previously caused an
hours-long false bug hunt in this repo), and `liveLlmCalls` turned on in `/settings` — **flipping
that toggle back on is itself part of what needs asking**, since it is the gateway-level switch
that enforces the no-unasked-billed-calls rule.

**Live ask 1 — invalid-key classification. Costs $0, still an ask.**
Paste a deliberately invalid key (`sk-ant-invalid-<random>`), run one chat turn. Confirm: the
vendor's 401 classifies to `LlmProviderAuthError`; the row flips to `'rejected'`; the route returns
`409 byok_key_rejected`; the Account banner offers **Re-enter** and **Try again**; the next call
short-circuits without a network round trip. **A rejected request is not billed, so this costs
nothing** — but it is a real call to a real vendor with live calls enabled, so standing rule 2's
ask applies in full. **Do this one first**, because it is the cheapest way to prove the most
fragile new code path.

**Live ask 2 — one real billed BYOK turn. Spends the pasted key's money.**
Paste a real Anthropic key, run **one** minimal chat turn. Confirm: it succeeds; the log row shows
`key_source: 'byok'`; a cost estimate appears; and the charge lands on **that key's** Anthropic
console, not the platform's. Before asking: name whose key will be used and the approximate cost
of one small turn.

**Live ask 3 — one platform-key turn immediately after. Spends the operator's money.**
Disable BYOK for that user (`PATCH { enabled:false }`) and run one more minimal turn in the **same
process**. Confirm: `key_source: 'platform'`, and the user's Anthropic console shows **exactly
one** call, not two.

**Ask 3 is the single most important live assertion in this plan.** It is the only real-world
proof that the Anthropic SDK singleton was not poisoned by the BYOK call — the failure mode with
the worst possible consequence (billing user A's key for user B's call), and the one that offline
tests with a fake provider can only approximate. It is deliberately scoped to two minimal turns so
the cost of proving it is a few cents.

**Not part of this plan's gate:** verifying a second real vendor for the OpenAI-compatible provider
(§5.7's echo server covers that code path); pricing accuracy against a real invoice (the number is
an estimate and is labelled as one); behavior across an Anthropic SDK major-version upgrade.

---

## 6. Implementation sequence

| # | Step | Depends on | Offline? | Notes / risk |
|---|---|---|---|---|
| 0 | **Answer D1–D9.** None blocks starting — every one has a call baked into §4. | — | — | D2 shapes the most code and carries the most risk; D6 shapes a data file; D3/D4 are policy one-liners with large product consequences. |
| 1 | `lib/byok/` (constants, secretBox, keyShape) + `lib/env.ts` wrapping-key getters + `_assertByokEnv()` + §5.1 tests | — | **Yes — free** | Pure functions and one env read. No DB, no gateway, no provider. **Parallel with 2 and 3.** |
| 2 | Schema + migration + `userLlmKeys.ts` + `users.ts`/`llmCallLog.ts` column additions + barrel + §5.2 tests | — | **Yes — free** | Behavior-preserving alone: one table nothing reads, five nullable columns nothing writes. Verify the `meta/` journal entry. **Parallel with 1 and 3.** |
| 3 | `lib/ai/pricing.ts` + `lib/ai/caps.ts` (behaviour-preserving extraction) + §5.1/§5.3 tests | — | **Yes — free** | The extraction's regression net is the **existing** `gateway-cap.test.ts`, which must pass unmodified. **Parallel with 1 and 2.** |
| 4 | `provider.ts`'s `credential` + `LlmProviderAuthError` + both provider files + §5.7's echo-server harness | 1 | **Yes — free** | Two one-line changes on the OpenAI-compatible side; the SDK-singleton bypass on the Anthropic side. §5.7 proves credential routing on the wire for one provider here, before the gateway exists. |
| 5 | `gateway.ts`: steps 2b + 4, two result arms, two error classes, `keySource`/cost on rows, cap via `caps.ts`, lazy re-seal + §5.4 tests | 1, 2, 3, 4 | **Yes — free** | The largest chunk of real logic. The credential-recording fake provider lands here and is the plan's most valuable test asset. |
| 6 | Three callers + every AI route: thread and map the two new refusals | 5 | **Yes — free** | Three near-identical caller edits following the documented belt-and-braces pattern; mechanical route mapping. |
| 7 | The five routes + §5.6 tests | 2 | **Yes — free** | **No new route-guard bucket needed** — both directories are already covered. Can start as soon as 2 lands, in parallel with 5–6. |
| 8 | §4.12 fitness suite + §5.5 non-disclosure suite | 4, 5, 7 | **Yes — free** | **Same batch as 4–7, not after.** Plan 11 found exactly this gap for `lib/ai`'s DB rule: a boundary that is documented but unenforced is a boundary already broken. §5.5 in particular must not trail the code it protects. |
| 9 | **Mockup pass** — three dispatches (§4.11 A, B, C), one concept each, **build-equivalent sanity check explicitly waived** | — | **Yes — free** | **Parallel with 1–8** — a static HTML file with no dependency on any code here. Starting it on day one is the single biggest schedule win in this plan. |
| 10 | React: `AccountLlmKeys.tsx`, Activity Log badge + cost, admin override cell + status line, **and the "Read-only here" copy fix** | 7, 9 | **Yes — free** | The recovery affordances are not decoration: without them a user whose key goes `unreadable` has no path back except an admin editing the database. |
| 11 | `scripts/rotate-byok-keys.ts` + the rotation runbook in `lib/byok/CLAUDE.md` | 1, 2 | **Yes — free** | Testable end to end against the in-memory DB with two fabricated wrapping keys. **This step is what makes D2's loss case exceptional rather than routine — do not defer it to "later."** |
| 12 | **Live ask 1 — invalid-key classification. $0, still an ask.** | 5, 6, 10 | **No — live** | §5.8. Cheapest proof of the most fragile path; do it before any billed step. |
| 13 | **Live ask 2 — one billed BYOK turn. Spends the pasted key's money.** | 12 | **No — billed** | §5.8. Name whose key before asking. |
| 14 | **Live ask 3 — one billed platform turn, same process. Spends the operator's money.** | 13 | **No — billed** | §5.8. The cross-contamination proof — the highest-consequence assertion in the plan. |
| 15 | Docs (§10) | 1–14 | **Yes — free** | Includes the privacy-policy edit, which is likely mandatory rather than optional here (§7 risk 12). |

**What can be built and proven with zero live access, stated explicitly:** steps 1–11 in their
entirety. The encryption round-trip and every failure mode of it, the schema and repository, the
pricing table, the cap decision, both providers' credential plumbing **verified over real HTTP for
the OpenAI-compatible provider** (§5.7), the complete gateway logic including every BYOK refusal
path, all five routes, every fitness function, the non-disclosure suite, all UI, and the rotation
script with two fabricated wrapping keys. **Only steps 12–14 touch a real vendor, and only 13–14
cost money — a few cents, deliberately.**

**Rollback.** Unset `BYOK_ENCRYPTION_KEY` and restart. BYOK is off deployment-wide, every stored
row is inert, every call funds from the platform key, and — crucially — **the Account page says so
in words** rather than falling back silently (§4.3 Case A; constraint 6's only exception, and it
is an exception only because of that disclosure). Rows are untouched, so re-setting the same key
restores everything with no user action. The two new settings are inert at their defaults
(spend cap `0` = off). Reverting the code leaves one orphaned table and five NULL columns that
nothing reads. **This is a stronger rollback than a code revert**, and it matters because the
deployment pipeline offers no separate gate: merging to `master` is itself the deploy to
production.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Wrapping-key loss is unrecoverable by construction.** If `BYOK_ENCRYPTION_KEY` is lost with no `_PREVIOUS` and no backup, every stored key is permanently unreadable. This is not a defect to engineer around — it is the property that made encryption at rest worth doing. | The whole of §4.3: `_PREVIOUS` + lazy re-seal + `scripts/rotate-byok-keys.ts` make **rotation** safe and routine, so loss is exceptional; and when it happens anyway the behavior is a named, per-user, one-click-recoverable `unreadable` state, plus an **admin-visible aggregate count** that makes "I rotated the env var and broke everyone" diagnosable on one screen instead of one support ticket at a time. **The honest residual:** the user may have pasted their only copy of the key, since Anthropic shows a key once. Recovery is then "mint a new key at your provider" — always possible, unlike restoring a plaintext this app deliberately never kept. `.env.example` and `README.md` must mark the variable backup-critical **with that consequence written out inline**, not cross-referenced. |
| 2 | **Cross-user credential leak through the shared Anthropic SDK singleton.** `anthropicProvider.ts:44-52` holds one `Anthropic` object per process built with one key. A naive fix that swaps its key races: user A's in-flight call could execute under user B's credential. **This is the severity-1 risk in the plan.** | Per-call client construction for BYOK, singleton untouched for platform (§4.6); the credential-recording fake provider (§5.4); the echo-server harness proving the property on the wire for the other provider (§5.7); and **live ask 3** (§5.8) as the only real-world proof for the SDK path — which is exactly why that ask exists and is scoped to two minimal turns. |
| 3 | **A user's key reaching a log line, an error message, or an admin surface.** Worse than a leaked platform key, because the operator can rotate their own and the user may not even learn theirs leaked. | §5.5's dedicated sentinel suite; §4.12's fitness assertions; `last4`-only display, owner-scoped. **And one specific new hazard, named so it survives:** the gateway records exactly `${err.name}: ${err.message}` into `llm_call_log.error` (`gateway.ts:314-316`). That is safe today by accident of brevity; **after this ships it is load-bearing**, because a future "let's capture more error detail" change — stringifying the whole SDK error object, say — becomes a credential-leak vector. The constraint must be written at that code site in words, not left to be re-derived. |
| 4 | **`crypto.subtle` is async in a codebase that is synchronous around the database.** | Contained: the decrypt happens inside `gateway.ts`'s `run()`, which is already `async`, and everything in `lib/byok/` is called from there. A future refactor that moves a decrypt into a sync path will fail to compile — a feature, not a bug. If this ever genuinely bites, `createCipheriv`/`createDecipheriv` with explicit `getAuthTag()`/`setAuthTag()` handling is the synchronous drop-in and changes only `secretBox.ts` (D2). |
| 5 | **Migration number contested with Plans 14 and 16.** Plan 15 already landed and took `0009`; Plan 14 still claims `0009` (now stale — needs updating) and Plan 16 takes "whatever is next." | Whoever lands last takes the next free number. `drizzle-kit` derives it from the existing folder, so this resolves itself **provided the migration is generated, never hand-numbered** — and a hand-written migration missing its `meta/` journal entry was a real Plan 13 bug. Check `lib/db/migrations/` immediately before generating; verify the journal entry after. |
| 6 | **Pricing goes stale silently**, and a stale price on a *cap* is worse than a stale price on a *display*. | Three layers, none of which pretend the table is authoritative: every row carries `asOf` and the UI renders the word *estimate* with that date; an unknown model yields **`null`, never `0`** (§5.1 asserts this explicitly); and the spend cap fails **open** on unknown pricing **because the call-count cap is an always-on floor beneath it** — so an unpriced model is never unbounded, only unpriced. The staleness is made visible rather than hidden, which is the honest mitigation for a hardcoded table (D6). |
| 7 | **Two numeric override columns on `user` is the first per-user numeric policy in this schema** (the only precedent is one boolean), and a third would start column-per-policy sprawl on the hottest-read table. | The ceiling is stated now rather than discovered later: **at a third override, move to a `user_policy` table**, and `getUserPolicy()` (`lib/db/repository/users.ts:101-113`) is the single read that would change. Two is under the ceiling and buys a query-free implementation of the roadmap's own bundled sub-ask. |
| 8 | **"Whose money" becomes a database question.** This repo's standing rule — never a real billed API call without an explicit ask — has always had exactly one answer, because there was exactly one key. After this ships, a mistake bills *a user*. | `key_source` on every log row; §5.8's three asks each name the payer before being asked; §5.4's per-provider and per-user routing tests. **And a flag for the user, not a decision made here:** standing rule 2's wording may deserve widening to say "…and say whose key it will use," exactly as Plan 14 flagged that a real email send is the same *category* of act as a billed API call. Raised, deliberately not resolved. |
| 9 | **SSRF, if a per-user base URL is ever added.** A user-supplied outbound URL means the server issues requests to an arbitrary user-controlled host with a user-controlled body, on a single EC2 instance whose own metadata endpoint is reachable. | Refused now (D9), with the reason recorded in `lib/byok/CLAUDE.md` and in the schema's "deliberately not columns" list — because "let the user point at their own endpoint" is an *obvious-looking* convenience that a future session would otherwise add without noticing what it is. |
| 10 | **`liveLlmCalls: off` blocks BYOK users who are costing the operator nothing** (D3). A real cost of the recommended answer, not an oversight. | Accepted and stated rather than papered over. The escape hatch is named so it is a small change if the complaint ever materialises: a **second** setting (`liveLlmCallsByokExempt`, default off — one `SETTING_DEFS` entry, zero UI work), never a change to what `liveLlmCalls` itself means. |
| 11 | **An orphaned key row survives a deleted user.** No user-deletion path exists yet, so this is latent rather than live. | §10 hands the **Delete or disconnect user (admin)** roadmap item exactly one rule: deleting a user must **hard-delete** their `user_llm_key` rows in the same transaction. That is a deliberate divergence from `apiToken`'s soft-delete convention (`revokedAt`, row retained so `lastUsedAt` survives as an audit trail) and the reason must be written where the divergence lives: retaining a live third-party credential after an account is deleted is indefensible, and there is no audit value in the row that outweighs it. |
| 12 | **The privacy policy becomes incomplete on ship.** `app/privacy/page.tsx` enumerates who receives a user's data; storing a user's credential *to a third party* is a new category of stored personal data, not just a new recipient. | **Treat this as a mandatory edit, not a "check and judge"** — unlike Plan 16's `Origin`-header-style maybe, this one changes what the app stores about a person. Read and edit it during step 15. |
| 13 | **Test-suite blast radius on the gateway suites.** Three suites construct gateways with fake providers. | Deliberately minimised by design: the resolver contract is untouched (constraint 3), so every `createGateway(fakeProvider)` call site compiles unchanged. Only assertions that inspect a log row's shape need the five new nullable columns. If a suite needs a *structural* change, the design has been misread — stop. |
| 14 | **Log retention and the spend window interact, invisibly.** The spend cap sums `cost_micro_usd` over a rolling 24 hours; the **Log retention / pruning** roadmap item will delete old rows. | Named now so it is not discovered as a bug: **a retention policy that prunes rows younger than the spend window silently uncaps spending.** §10 hands that item the rule — retention must never prune inside the widest active cap window, and if it must, the spend cap has to be recomputed from a separate aggregate rather than from the log. |
| 15 | **`llm_call_log` writes are already silently swallowed on failure** (`gateway.ts:229-232, 317-323, 338-341`), and now one of the things a swallowed write loses is a **cost** figure the spend cap reads. | Accepted, unchanged, and stated: the failure mode is that a call is under-counted against the spend cap, not that money is spent unmetered — the call-count cap still counts it, because that gate reads row *existence*, and a failed reservation loses the row for both. This is the same trade-off **Compliance-grade (non-droppable) logging** already tracks as a FUTURE roadmap item; this plan inherits it rather than solving it, and §10 hands that item one more reason to exist. |

---

## 8. Decisions — judgment calls made here, awaiting confirmation

Each already has a call baked into §4 so implementation is unblocked; changing one is a localized
edit. **The user's two locked decisions are not here** — they are constraints 1 and 2 in §3.

### D1 — Does BYOK fully replace the platform key for that user, or is it a per-call choice?

**Recommendation: full replacement, per `(user, provider)`, whenever `enabled = 1` and
`status = 'active'`. No per-call choice, no automatic fallback.**

Three reasons, the third decisive:

1. The roadmap's own wording is *"supply their own key **instead of** sharing the platform's"* —
   replacement, not selection.
2. A per-call choice needs a control on every call surface. There are four: chat, strict import,
   structural import, and MCP `push_agent`.
3. **MCP has no UI at all.** An MCP-initiated call arrives with a bearer token and a `userId` and
   nothing else, so a per-call choice is literally *unrepresentable* on one of the four paths.
   Any design that cannot express itself on a quarter of its surface is the wrong design.

The user's "choice" is a single toggle in `/account`, made once, plus the explicit **Use the
platform key instead** action. **If the user wants a per-call choice anyway:** it is a `LlmRequest`
field and a UI control on three of the four paths, with MCP defaulting to the stored preference —
i.e. exactly this design plus an override, which is worth doing later if asked and is not worth
paying for now.

### D2 — Wrapping-key strategy, cipher, and the loss/rotation failure mode *(the highest-stakes decision)*

**Recommendation, in four parts:**

**(a) Cipher: AES-256-GCM via `crypto.subtle`, zero new dependency.** GCM is AEAD, so a tampered
ciphertext fails to open rather than decrypting into garbage that then travels to a vendor as an
`Authorization` header. `crypto.subtle` handles the authentication tag as part of the ciphertext,
whereas `createCipheriv`'s GCM mode requires manual `getAuthTag()`/`setAuthTag()` — and forgetting
the latter **silently disables authentication**. Choosing the API where that mistake is
unrepresentable is worth more than syntactic familiarity. Zero-dependency matches this codebase's
demonstrated preference (Plan 11 implemented the second LLM provider over plain `fetch` rather than
vendoring an SDK). **The cost:** `subtle` is async in an otherwise-sync-around-the-DB codebase —
contained because `gateway.ts`'s `run()` is already `async` (§7 risk 4). **If the user prefers
synchronous:** `createCipheriv` with explicit tag handling, changing only `secretBox.ts`.

**(b) Envelope: `v1.<base64url iv>.<base64url ct‖tag>`, with AAD = `` `${userId}|${providerId}|v1` ``.**
The version prefix makes a future algorithm change detectable rather than guessed; a fresh
12-byte random IV per seal avoids GCM's one catastrophic misuse; and the AAD binds the ciphertext
to its row, so a `sealed_key` copied between users or between a user's two provider rows fails to
open. That last one costs nothing and closes a real database-tampering path.

**(c) Wrapping key: `BYOK_ENCRYPTION_KEY` (32 bytes, base64 or hex), plus an optional
decrypt-only `BYOK_ENCRYPTION_KEY_PREVIOUS`, validated at boot in the all-or-nothing shape
`_assertOAuthEnv()` already uses** — none set → feature off and the app runs normally; set but
invalid → **refuse to boot**, because partial config is worse than none. Every row records an
8-hex-char, domain-separated `wrapping_key_id` so *wrong key* is distinguishable from *corrupt
data* **before** a decrypt is attempted. Rotation is: set new as primary, old as `_PREVIOUS`,
deploy, let rows re-seal lazily on read and eagerly via `scripts/rotate-byok-keys.ts`, then drop
`_PREVIOUS`. Zero downtime, no migration, no user action.

**(d) The failure mode — the part this decision actually exists to answer.** The behaviour turns on
one distinction, and the two halves must not be conflated:

- **No wrapping key configured at all** ⇒ BYOK is off *deployment-wide*. Stored rows are inert,
  calls fund from the platform key, and **the Account page says so in words**. This is a
  deliberate operator act and the rollback path — and it is not a "silent fallback" precisely
  because of the disclosure.
- **A wrapping key is configured but this row cannot be opened under it** ⇒ mark the row
  `'unreadable'`, **refuse the call loudly** with `409 byok_key_unreadable`, write a log row, and
  show a banner whose first sentence is the fix: *paste your key again, or switch to the platform
  key.* Never delete the row (deleting re-introduces silent fallback as a side effect). Never fall
  back automatically. Surface an **aggregate count to the admin**, because a rotation accident
  breaks every BYOK user at the same instant and that must be one glance, not four support
  messages.

**Both alternatives are rejected on the record so they are not re-proposed.** *Silent fallback to
the platform key*: spends the operator's money without anyone asking and moves the user's prompts
onto an account they did not choose — two parties surprised by one invisible branch, and the
hardest class of bug to notice, since everything works until the invoice arrives. *A generic hard
failure*: indistinguishable from "the AI is down," so the user waits instead of acting, and the
five-second fix is never surfaced.

**And the honest part, stated rather than engineered around:** if the wrapping key is lost with no
`_PREVIOUS` and no backup, the ciphertexts are gone. There is no recovery mechanism to build —
that is the property that made encryption at rest worth doing. What is designed here is the
*product behavior*, and the recovery path is always available: mint a new key at the provider and
paste it.

### D3 — Does a BYOK user bypass the `liveLlmCalls` kill switch?

**Recommendation: no. `liveLlmCalls: off` blocks everyone, BYOK included.**

Three reasons: the setting's own hint describes a **network** posture, not a billing one — *"AI
calls are recorded and blocked before any network request is made"* (`lib/settings.ts:53`); this
repo's standing rule against unasked billed calls is enforced at the gateway by **exactly this
switch**, and a BYOK bypass would turn a clear guarantee into a partial one, which is worse than
either extreme; and a dry-run deployment is often deliberately offline (a demo instance, a
verification session), where a user's stored key punching through is precisely the surprise the
toggle exists to prevent. BYOK users still get dry-run log rows, so nothing silently breaks.

**The cost, named rather than hidden:** an operator who turns the toggle off to control *their own*
spend also stops a BYOK user who is costing them nothing. **If the user disagrees:** the fix is a
**second** setting (`liveLlmCallsByokExempt`, bool, default off — one `SETTING_DEFS` entry, no UI
work), never a redefinition of what `liveLlmCalls` means.

### D4 — Does `maxLlmCallsPerUserPerHour` apply to a BYOK user?

**Recommendation: yes, unchanged — and the per-user admin override (D5) is the mechanism for
raising it, not a BYOK exemption.**

Reasons: the hourly cap is **not only** a spend control, it is a runaway-loop control — an MCP
client looping with a BYOK key still consumes the operator's CPU, SQLite write throughput, and
egress on a single EC2 instance, none of which the user's key pays for. Exempting BYOK entirely
would create a class of user with unlimited call volume against a deployment whose whole
scalability story is "one process, one SQLite file." And the override has to be built anyway,
because it is the roadmap's own bundled sub-ask — so "raise this user's cap to 500" becomes a
one-cell admin edit rather than a new mechanism.

**The structural half of this recommendation matters as much as the policy half:** the cap gate
gets **no** BYOK branch, ever. That is constraint 9, and §4.12 enforces it by making
`lib/ai/caps.ts`'s signature incapable of receiving a funding source. **If the user wants BYOK
exempt anyway:** set that user's override to a very high number — the same outcome, through the
same mechanism, with no special case in the code.

### D5 — What is the stored shape for a per-individual quota override?

**Recommendation: two nullable integer columns on `user` — `llm_calls_per_hour_override` and
`llm_spend_per_day_cents_override`. NULL = use the global setting; a value replaces it.**

Reasons: `getUserPolicy()` (`lib/db/repository/users.ts:101-113`) is already the narrow per-user
read the gateway performs on **every** call, so two more columns in one existing query cost
nothing, where a `user_policy` table costs a join or a second query on the hottest path for two
integers with no history requirement; a nullable `ALTER TABLE ADD COLUMN` on SQLite is
metadata-only, the reasoning `llm_call_log.origin`'s own comment already records; and an override
that may be **lower** than the global gives the same field a second use — throttling a specific
account — at no extra cost.

The precedent is thin and worth acknowledging: the only per-user config on that table today is one
boolean (`shareLogsWithAdmin`), so this is genuinely new ground. **The ceiling is therefore stated
up front: at a third override, move to a `user_policy` table** (§7 risk 7). Two is under it.

### D6 — What is the pricing source and format, and what shape is the spend cap?

**Recommendation: a hardcoded, versioned constants file (`lib/ai/pricing.ts`) as v1, with
staleness made visible rather than hidden; cost stored per row as integer micro-USD; the cap
default-off.**

- **Format:** `{ providerId, modelPrefix, inputPerMTokUsd, outputPerMTokUsd, currency:'USD', asOf }[]`,
  matched by **longest prefix** — model ids carry version suffixes, so exact match goes stale
  faster than the price does.
- **Unknown model ⇒ `null`, never `0`.** §5.1 asserts this in its own case, because a silent zero
  makes an unpriced model look free and is the single worst failure a spend cap can have.
- **Store the cost on the row** (`cost_micro_usd`, `pricing_as_of`), computed at finalize time.
  Two reasons: the spend gate must be one indexed `SUM()` on every call, not "load every row and
  re-price it in JS"; and it snapshots the price actually in effect, so a later price change
  cannot retroactively rewrite history — the same **snapshot-at-write-time-never-updated** rule
  `sharedWithAdmin` already follows on that table. Integers, not floats, because currency in
  floating point is a defect waiting for a large `SUM()`.
- **The cap:** `maxLlmSpendPerUserPerDayCents` (int, **default `0` = disabled**), rolling 24-hour
  window over the existing `(user_id, created_at)` index. Default-off matches `mcpWrites`'s stated
  fail-safe posture — shipping this changes nothing until an operator opts in. `0` is unambiguous
  here (unlike `maxLlmCallsPerUserPerHour`, which forbids `0`) **because the call-count cap is an
  always-on floor beneath it**, so "no spend cap" never means "no cap."
- **Fails open on unknown pricing**, for that same reason, stated wherever the rule appears.

**Alternatives, with why not:** an admin-configurable DB table is a new table, new admin UI, and an
ongoing maintenance burden for data the operator does not control and cannot verify; a live pricing
feed adds a network dependency with no precedent in this codebase, on a path that must not fail,
for data neither vendor publishes in a stable machine-readable form. **If the user wants
admin-editable pricing later:** the constants file becomes the seed for a table, exactly as
`sectionDefsSeed.ts` seeds the DB-owned section catalog today — a known, already-walked migration
path in this repo.

### D7 — What does an admin see about a BYOK call?

**Recommendation: a `key_source` value of `'platform'` or `'byok'` on every log row, rendered as a
small badge — and nothing else, ever. No key, no prefix, no fingerprint, no user's `last4`.**

The gateway's own stated principle applies verbatim to a second *funding* source: *"an audit log
that can't tell them apart is actively wrong once two sources exist"* (`gateway.ts:50-57`, written
about `origin`). And the operator has a legitimate, unavoidable question — *which of these calls
did I pay for?* — that only this column answers.

**But a key prefix is disclosed nowhere.** `api_token.prefix` exists because the **owner** needs to
identify their own token in a list of their own tokens; that is a different need from an admin
identifying a funding source, and it does not generalise. So: the **owning user** sees `last4` of
their own key (which they already know, so it discloses nothing new and lets them tell which key
they pasted); the **admin** sees `platform` / `byok` and a status count. Note **last-4 rather than
first-N**, because every Anthropic key shares its leading bytes — a display prefix would identify
nothing here, which is exactly why `api_token.prefix`'s shape is not copied.

`key_source` is a **nullable text** column, matching `origin`'s stated migration-friendliness
reasoning, with NULL on every pre-existing row meaning "unknown," not "platform."

### D8 — What UX handles an invalid or revoked BYOK key?

**Recommendation: a narrow status-code-only classifier, a short-circuit, and a one-click retry.**

- **Classify by HTTP status only** — `401`/`403` for the OpenAI-compatible provider, the SDK's
  typed authentication error (or `status === 401`) for Anthropic — into one shared
  `LlmProviderAuthError` living in `provider.ts` beside `LlmProviderResponseError`, for that
  class's own stated reason (*"so both implementations can import it without either one importing
  the other"*). **No message, body, or phrase matching anywhere**, consistent with this repo's
  existing decision that classification of vendor-controlled text by keyword is not acceptable.
- **Branch on `keySource`, and this is the part that prevents a bad misfire:** the same classified
  error means *your key was refused* for a BYOK call (→ mark `'rejected'`, `409
  byok_key_rejected`, re-enter banner) and *the deployment's key was refused* for a platform call
  (→ today's generic upstream error, unchanged). Telling an operator's user to "re-enter your key"
  when the operator's own key is misconfigured is a confusing and unfixable dead end.
- **Short-circuit a `'rejected'` key** at the gateway so subsequent calls do not pay for a doomed
  round trip — correct for a revoked key, wrong for a transient vendor hiccup, which is why the
  Account page carries a **Try again** action that clears `'rejected'` without a re-paste. One
  click, and the transient case resolves itself.
- **`'unreadable'` deliberately gets no Try-again** (§4.9 rule 20): nothing about that situation
  can change without new plaintext, and a button that cannot work is worse than no button.

### D9 — Does an `openaiCompatible` BYOK user also supply their own base URL?

**Recommendation: no — key only. The base URL stays operator-owned, permanently.**

Reason, stated bluntly because it is a security boundary rather than a preference: a user-supplied
base URL makes the server issue outbound HTTP requests to an arbitrary user-controlled host with a
user-controlled body — a textbook SSRF, on a single EC2 instance whose own metadata endpoint is
reachable from itself. There is no validation that makes this safe cheaply, and the feature it
would buy (using a *different* vendor than the operator chose) is not what BYOK is for.

The consequence must be **disclosed in the UI, not discovered**: an `openaiCompatible` BYOK key
must be a key for the vendor the operator configured. `GET /api/account/llm-keys` therefore returns
`endpointHost` — the **host only** of `OPENAI_COMPATIBLE_BASE_URL`, which is the operator's vendor
choice and not a secret — so the paste field can say which vendor's key it wants. The full URL, the
path, and the operator's own key are never sent.

This decision is not in the impact analysis; it surfaced from reading `lib/env.ts:125-133` and
`lib/ai/CLAUDE.md`'s note that the base URL is expected to carry the vendor's own `/v1` segment.
It is recorded here so the refusal is deliberate and documented rather than an omission a future
session helpfully "fixes."

---

## 9. Explicitly NOT in this plan

- **A KMS, HSM, or external secret manager.** An env-var wrapping key with AES-256-GCM is the
  right tier for a single-instance EC2 deployment on SQLite. A managed key service is a different
  infrastructure plan with a different operational story, and adopting one would be the
  *replacement* for §4.3, not an addition to it.
- **Database-level encryption (SQLCipher or equivalent).** `better-sqlite3` writes a plain file;
  application-layer column encryption is the only realistic option on this stack, as the impact
  analysis concluded.
- **A per-user base URL or per-user vendor selection** (D9 — SSRF).
- **A per-user model override.** That is the roadmap's own *Wiring a declared model for Prometheus*
  item, which has its own unresolved model/provider-coupling question.
- **More than one key per `(user, provider)`.** No stated need; a second key is a rename of the
  same concept with a multiplied surface.
- **Any automatic fallback to the platform key** in any failure state (constraint 6). The single
  disclosed exception is deployment-wide absence of a wrapping key.
- **A billing, invoicing, or reconciliation system.** `cost_micro_usd` is an **estimate** derived
  from a hardcoded table and is labelled as one everywhere it appears. It is not an invoice and
  must never be presented as one.
- **Live-fetched or admin-editable pricing** (D6). The constants file is the v1, and the migration
  path to a DB-owned catalog is already walked in this repo (`sectionDefsSeed.ts` → the DB-owned
  section catalog) if it is ever wanted.
- **Organization- or team-level shared keys.** Requires the *Organizations / teams* roadmap item,
  which is still an IDEA needing a product debate.
- **Changes to what is logged.** BYOK changes *who paid*, not *what is captured* —
  `requestPayload`/`responsePayload` behavior is untouched. A BYOK user's prompts are stored
  exactly as a platform user's are, subject to the same `shareLogsWithAdmin` consent snapshot.
- **Non-droppable logging.** The gateway's existing swallow-on-failure behavior is inherited
  unchanged (§7 risk 15); making it durable is the *Compliance-grade logging* roadmap item.
- **Widening standing rule 2's wording.** Flagged for the user in §7 risk 8; deliberately not
  edited here. Rules in `CLAUDE.md` are the user's to change.
- **Exposing BYOK state over MCP.** MCP-initiated calls *use* a stored key exactly like a web call
  does — that is automatic, because they pass through the same gateway with the same `userId` —
  but no MCP tool reads, writes, or reports key state. `lib/mcp/`'s four fitness assertions must
  pass unmodified; if a build finds itself editing them, the design has been misread.

---

## 10. Documentation this plan must update, and what it hands to other roadmap items

**Docs that become factually wrong or incomplete on ship** (step 15 — correctness fixes, not
polish):

- **`app/components/Settings/AdminSettingsPane.tsx:531-534`** — *"Read-only here — role and
  log-sharing changes aren't editable from this grid yet"* is false once D5's override cell ships.
  Rewrite the copy; do not leave it as a stale hedge.
- **`lib/ai/CLAUDE.md`** — this file states the gateway's execution order **normatively**, in
  numbered steps. It gains steps 2b and 4 and two modified steps, and must be updated **in the same
  pass as `gateway.ts`'s own header comment**, because a normative ordering that exists in two
  places and disagrees is worse than one that exists in neither. Also: the gateway-only `credential`
  rule, the two new `LlmGatewayResult` arms, `LlmProviderAuthError`, and `caps.ts`/`pricing.ts` in
  the file table.
- **`lib/db/CLAUDE.md`** — `user_llm_key` and `userLlmKeys.ts` in the schema section, the
  repository list and the file table; the two `user` columns; the three `llm_call_log` columns;
  and one sentence recording that `sealed_key` is **the only reversible secret in this schema** and
  is never returned by any read DTO — the same rule already stated there for `tokenHash`.
- **`lib/auth/CLAUDE.md`** — **the single most useful sentence this plan adds anywhere.** That file
  currently explains two credential postures; there are now three, and naming them together is
  what stops the next person from reaching for the wrong one: **one-way hashed** (passwords via
  bcrypt, API tokens via SHA-256 — never re-readable, by design), **plaintext by design** (invite
  codes, so an admin can re-read and resend one), and **reversibly encrypted** (BYOK keys, because
  the app must replay them verbatim to a third party forever, and no hash can do that). Add a
  pointer that the third lives in `lib/byok/`, with the *reason* restated inline, not a bare path.
- **`lib/byok/CLAUDE.md`** (new) — must state, in its own words rather than by reference to this
  plan (which will be archived): the envelope format and why it is versioned; the AAD binding and
  what it prevents; the two env vars and the all-or-nothing boot rule; **the full rotation runbook**;
  and both failure cases with their distinct behaviours (§4.3 A and B). Also the D9 refusal, so
  "let the user set their own base URL" is visibly a decision and not an oversight.
- **Root `CLAUDE.md`** — the Folders section gains `lib/byok/` with its own `CLAUDE.md`, alongside
  `lib/ai/`, `lib/mcp/` and the rest.
- **`docs/system-about.md`** — §4 (data model) gains one table and five columns; the LLM-gateway
  section gains the new gate order; and §10 (auth & multi-tenancy) gains a paragraph on the new
  category: **the app now stores a user-supplied third-party credential in a form it can read
  back**, which is a genuinely new class of data for this system and deserves more than a table
  row.
- **`docs/user-guide.md`** — a new task section: adding your own key, what happens when it is
  rejected, what "we can't read your key any more" means and how to fix it, and how to go back to
  the platform key.
- **`README.md`** and **`.env.example`** — `BYOK_ENCRYPTION_KEY` and `BYOK_ENCRYPTION_KEY_PREVIOUS`,
  the all-or-nothing boot rule, and the **backup-critical** marking with the consequence written
  out inline: losing `JWT_SECRET` logs everyone out and they log back in; losing
  `BYOK_ENCRYPTION_KEY` makes every stored BYOK key permanently unreadable and forces every BYOK
  user to mint a new one at their provider.
- **`app/privacy/page.tsx`** — treat as a **mandatory** edit (§7 risk 12), not a check-and-judge.
- **`docs/roadmap.md`** — the item moves from "Planned" toward "Available today."
- **`plans/roadmap.md`** — the item's Status cell. *(Updated to "On-going — plan drafted at
  `plans/17-byok-llm-key.md`" when this plan was written.)*
- **`CHANGELOG.md`**.

**What this hands to other roadmap items** (none of them built here):

- **Delete or disconnect user (admin)** — one new rule: deleting a user must **hard-delete** their
  `user_llm_key` rows in the same transaction as the deletion. Explicitly *not* the soft delete
  `apiToken` uses (`revokedAt`, row retained so `lastUsedAt` survives as an audit trail): retaining
  a live third-party credential after an account is deleted is indefensible, and no audit value in
  that row outweighs it. Write the divergence and its reason where the code lives.
- **Log retention / pruning / pagination** — two things. (1) Three new columns on the table that
  item exists to bound. (2) **A real, invisible interaction, named here so it is not found as a
  bug:** the spend cap sums `cost_micro_usd` over a rolling 24 hours, so a retention policy that
  prunes rows younger than the widest active cap window **silently uncaps spending**. Retention
  must never prune inside that window, or the spend cap must move to a separate aggregate.
- **GDPR-style export/deletion workflow** — `user_llm_key` is a new place a user's data lives, and
  it is the most sensitive one in the schema. An export must **never** include `sealed_key` (it
  would be useless to the user and a liability in a downloaded file) and should report only
  "a key is configured for provider X, ending …abcd." A deletion must remove the row.
- **Compliance-grade (non-droppable) logging** — one more reason to exist: a swallowed log write
  now also loses a cost figure the spend cap reads (§7 risk 15).
- **Email-sending provider (Plan 14)** — *"your saved LLM key stopped working"* is one template
  file, one `kind` string, and one `sendEmail()` call placed after the status flip commits. Plan
  14's rule that a send can never fail the action that triggered it is exactly right for this.
- **Database server migration** — a genuine, non-obvious benefit worth recording: `sealed_key` is
  opaque text and migrates verbatim to any engine, and **the wrapping key does not live in the
  database at all**, so a storage-engine migration never moves the secret. The one thing that
  migration must not do is change the `(user_id, provider_id)` values, since they are the AAD.
- **Review/improve CI/CD process** — merging to `master` deploys to production with no separate
  gate, and what is being deployed here handles user credentials. The absent-`BYOK_ENCRYPTION_KEY`
  default makes the first deploy inert, which mitigates it; a deploy gate would address it.

**Scope boundary, stated once:** this plan ships when a user can paste their own Anthropic **or**
OpenAI-compatible key in `/account`, see it stored with only its last four characters visible, have
their next chat turn and both import paths funded by it with `key_source: 'byok'` on the log row and
a cost estimate beside the token counts; when a revoked key produces a specific "re-enter your key"
message instead of a generic AI error; when an admin can raise or lower one individual's hourly cap
from the Users grid; when rotating `BYOK_ENCRYPTION_KEY` with `_PREVIOUS` set re-seals every row
with no user noticing; and when rotating it **without** `_PREVIOUS` produces a loud, named,
one-paste-recoverable state for each affected user and a single visible count for the admin —
with every existing test in `lib/ai/`, `lib/mcp/` and `lib/auth/` passing unmodified throughout.
