# Plan 14 — Email-Sending Provider

> **Status: 🔴 Drafted 2026-08-27, not started. Six decisions (D1–D6) are OPEN and must be
> answered before implementation begins** — D1 (which provider) and D2 (sender identity)
> additionally require the user to perform out-of-band account/DNS work that no agent can do
> for them (§4.11 Phase 0). Every decision below carries a recommendation with reasoning; none
> is settled.
>
> - **D1 (provider):** recommendation is **Resend over plain `fetch`, behind a one-file
>   `EmailProvider` seam** — no new npm dependency, same posture Plan 11 took for the second
>   LLM provider (implement the transport, don't vendor-lock the codebase). **Not confirmed** —
>   it commits the user to a third-party account and DNS records on `myagentstudio.dev`.
> - **D2 (sender identity):** which `From:` address, on which (sub)domain, and whether replies
>   go anywhere. Blocks Phase 0; nothing else.
> - **D3 (which codes get emailed, and when):** auto-send on "Generate code" from an access
>   request vs. an explicit "Send" click; what happens for unbound codes with no known
>   recipient.
> - **D4 (admin notification on a new access request):** wanted or not — it is the only
>   proposed trigger fired by an *unauthenticated* endpoint.
> - **D5 (HTML + plain text, or text only).**
> - **D6 (where failures surface):** inline flag only, or a full Email log pane mirroring the
>   Activity log.
>
> **Scale note — Medium, and deliberately narrow.** This plan builds the *infrastructure* plus
> exactly **one** real trigger (invite-code delivery), because a gateway with no caller cannot
> be verified end-to-end. It does **not** build password reset and does **not** build the
> account-deletion notice — those stay their own roadmap items (§10 says precisely what this
> plan hands them).
>
> **A standing-rule question this plan raises (§3 constraint 10):** `CLAUDE.md` standing rule 2
> forbids a real Anthropic API call without an explicit ask. A real *email* send is the same
> category of act — it spends a third-party quota, and unlike an LLM call it also burns sending
> reputation on a domain that cannot be un-burned. This plan treats a live send as requiring
> the same explicit ask (§5.6) and flags for the user whether standing rule 2 should be widened
> to say so in words.
>
> Standing project rules apply in full: **no commit without an explicit ask**, **no real billed
> API call without an explicit ask**, **dev server off after any verification session**, and
> **ask before running any test/build/tsc check** (`CLAUDE.md` standing rules 1, 2, 3, 5). UI
> work prototypes in `reference/layout/Layout-Workbench.html` first (standing rule 4) — §4.9
> marks which parts that applies to.
>
> Addresses `plans/roadmap.md` NEXT item **Email-sending provider**. Unblocks two other roadmap
> items without building either of them — **Delete or disconnect user (admin)** and **Review
> user account management** (§10).

---

## 1. What this plan is, in one paragraph

MyAgentStudio has **no way to send an email today** — not one line of code, not one
dependency, not one env var. Two places in the running product already promise otherwise: the
public access-request endpoint answers every visitor with *"Thanks — if we can offer you a
spot, we'll email your invite code soon."* (`app/api/auth/request-access/route.ts`), and the
admin Settings pane then tells the admin the opposite — *"the code isn't emailed automatically
yet, so copy it and send it to them yourself"* (`AdminSettingsPane.tsx`). This plan closes that
gap by building a small email subsystem in the exact shape the LLM subsystem already has — one
provider interface, one transport implementation, one **gateway** that is the single choke
point for every send, one append-only log table, and admin settings for the kill switch and the
rate cap — then wires **one** trigger through it: delivering an invite code to the person who
asked for it. Everything else that will eventually send an email (password reset, deletion
notice) inherits the gateway by construction and is out of scope here.

**The one rule that shapes every other decision in this document:** an email failure must never
fail the action that triggered it. The invite code is created, committed, and shown to the
admin *before* any send is attempted, and the send's outcome is reported as a **flag on the
response**, never as an error status. That is this codebase's stated "Flag, don't block"
principle (`docs/system-about.md` §3: nothing is silently rewritten or refused on the way in; a
problem is surfaced for the user to notice and act on, not turned into a rejection) applied to
an outbound side effect.

---

## 2. Current state (verified by reading the code this session, 2026-08-27)

| Fact | Where | Note |
|---|---|---|
| **Zero email capability exists.** No package, no env var, no code path. | `package.json`, `lib/env.ts`, `.env.example` | Nothing to extend — this is a new subsystem, not a swap. |
| The access-request endpoint **already promises an email** | `app/api/auth/request-access/route.ts:28` | `"Thanks — if we can offer you a spot, we'll email your invite code soon."` — returned identically on every branch (anti-enumeration). Today that promise is kept by hand. |
| The admin pane **admits the gap in its own copy** | `AdminSettingsPane.tsx:320-324` | "…the code isn't emailed automatically yet, so copy it and send it to them yourself." Must be corrected by this plan, not left stale. |
| `docs/user-guide.md` says the same thing twice | `docs/user-guide.md:45` | "Nothing is emailed automatically yet — copy the code and send it yourself." |
| **The privacy policy currently states a fact this plan makes false** | `app/privacy/page.tsx:150-153` | *"It is shared only with the AI provider processing your request (§4) and, according to your own consent choice, with the admin (§5). We do not share your data with any other third party."* An email provider receives a recipient address. **This edit is mandatory, not optional** (§4.10, §6 step 7). |
| Invite codes are generated in two places | `app/api/settings/invite-codes/route.ts` (POST, admin's plain "+ Generate code"), `app/api/settings/access-requests/[id]/generate-code/route.ts` | Only the second has a known recipient: it sets `boundEmail` from the access request and `expiresAt` from `getAccessRequestCodeExpiryHours()` (default 5h), then deletes the request row. |
| Invite codes are stored **plaintext on purpose** | `docs/system-about.md` §4, `lib/auth/CLAUDE.md` | "so the admin can re-read and resend one" — the resend mechanism that decision anticipated is exactly what this plan builds. |
| The generate-code route already returns the code in its `201` body, and the UI already renders it in a copyable box | `generate-code/route.ts:55-64`, `AdminSettingsPane.tsx:236-238` (`setNewCode(row.code)`) | So the "email failed, copy it manually" fallback **already exists visually** — it only needs a status line next to it. |
| The LLM gateway is the architectural template | `lib/ai/gateway.ts`, `lib/ai/CLAUDE.md` | Single choke point; reads its kill-switch setting fresh per call (no cache); dry-run writes a log row and touches no network; cap gate; log-write failures swallowed; **no DB transaction spans the network call**. |
| Per-transport isolation is **test-enforced**, table-driven | `lib/ai/__tests__/architecture.test.ts`, `lib/mcp/__tests__/architecture.test.ts` | Sole-importer + sole-owner string tables, plus "no file in the folder except the gateway imports `lib/db/`". Each subsystem carries its own `__tests__/architecture.test.ts` — the precedent for a new one under `lib/email/`. |
| Settings are a generic end-to-end catalog | `lib/settings.ts` (`SETTING_DEFS`), `app/api/settings/route.ts`, `SettingsView.tsx` | A new `bool` or `int` setting is **one array entry** — storage parsing, the PATCH allowlist and the UI renderer all already exist. Fail-safe pattern: row absent → def default; unparseable → safest value + `console.warn`. |
| Env vars follow an **all-or-nothing group** pattern with call-time throws | `lib/env.ts` (`isOAuthConfigured()`, `_assertOAuthEnv()`, `getAnthropicApiKey()`) | Partial config refuses to boot; a fully absent group just disables the feature. Keys are never logged. |
| A ~20-line registry is the established "second provider later" seam | `lib/auth/oauth/providers.ts` (per `lib/auth/CLAUDE.md`: "adding a second provider later is one new file plus one new branch here, no changes to any route") | Directly reusable shape for email. |
| `llm_call_log` is the append-only-audit template | `lib/db/schema.ts:221`, `repository/llmCallLog.ts` | Also the cap counter (`llm_call_log_user_created_idx`). Note it **does** store request/response payloads; §4.4 deliberately diverges. |
| Migrations run `0000`–`0009`; `0009_share_agent.sql` (Plan 15, shipped 2026-08-31) is newest | `lib/db/migrations/` | This plan's own `0009` claim below is now stale — Plan 15 landed first and took it. Re-check `lib/db/migrations/` immediately before generating; whatever `drizzle-kit` produces next (likely `0010`) is the real number, not a hand-picked one. |
| Deployment is a single EC2 instance behind `https://myagentstudio.dev`, deployed by merging to `master` | `CHANGELOG.md` 2026-08-26, `.github/workflows/ci.yml` | The domain that would carry SPF/DKIM records. Single instance → an in-process anything is viable, but §4.4 uses the DB as the counter anyway, matching the LLM cap. |
| Node 22 in CI | `.github/workflows/ci.yml` | Global `fetch`, `AbortSignal.timeout()` available — no polyfill, no dependency. |
| `maxUsers` defaults to 5 | `lib/settings.ts` | Real volume is a handful of emails a month. Any free tier covers it; see D1. |

---

## 3. Guiding constraints (locked — do not replan during build)

1. **The choke point stays single.** Every send goes `caller → gateway → provider`. Nothing
   may call a provider directly, and no provider file may import from `lib/db/`.
2. **The gateway never throws.** It returns a discriminated result for every outcome —
   success, not-configured, kill-switch-off, cap-reached, provider error, timeout. This is a
   **deliberate divergence** from `lib/ai/gateway.ts`, which re-throws a provider error: an AI
   call *is* the user's requested action, so failing it is correct; an email is a side effect
   of someone else's action, so failing that action would violate "Flag, don't block".
3. **No caller's success depends on a send.** The triggering write is committed, and its
   response body is already correct, before `sendEmail()` is called. The send result is added
   to the response as a status field. **No HTTP status code anywhere in this plan changes
   because an email failed.**
4. **No send inside a DB transaction**, and no send that can hang a request: every provider
   call carries an `AbortSignal.timeout()` (10s recommended). Same rule
   `lib/ai/gateway.ts` states for the AI network call.
5. **A recipient address is never taken from an unauthenticated request body.** Recipients come
   from stored values (`invite_code.bound_email`, `user.email`) or from a fixed env-configured
   admin address. The one exception is the admin-only manual send route, where the deployment
   owner may type an address — that path is authenticated as admin, capped, and logged with
   `triggeredBy`. Without this rule the app is an open mail relay with the operator's own
   domain reputation as the fuel.
6. **The kill switch and the cap are read fresh on every send**, never cached — same rule
   `getLiveLlmCalls()` follows, and for the same reason (a toggle that lags looks broken).
7. **No credential and no message body is ever persisted or logged.** The API key never
   appears in a log line, an error message, a response body, or an error echo of request
   headers. `email_log` stores kind/recipient/subject/status/error — **never the rendered
   body**, because a future password-reset email's body contains a live reset token and the
   log table must not become a credential store. (This is where `email_log` intentionally
   differs from `llm_call_log`, which does store payloads.)
8. **Transactional only.** No marketing, no lists, no tracking pixels, no click tracking
   (disabled at the provider), no unsubscribe machinery — nothing in scope here is a message a
   user could opt out of without breaking their own account flow.
9. **A fresh install with no email env vars behaves exactly as today.** Codes are generated and
   copied by hand; the UI says so; nothing errors, nothing warns at boot. Email is
   all-or-nothing config, like OAuth: none set → feature off; some set → refuse to boot.
10. **A real send needs an explicit user go-ahead**, like a real Anthropic call
    (`CLAUDE.md` standing rule 2). Every automated test is mocked; the single live pass is
    §5.6 and it is an *ask*, not a step.

---

## 4. Implementation shape

### 4.1 Files

| File | New/Mod | Role |
|---|---|---|
| `lib/email/provider.ts` | **new** | `EmailProvider` interface + `EmailMessage` / `ProviderSendResult` types + shared `EmailProviderError`. Vendor-neutral; the error class lives here so a second provider never has to import the first. |
| `lib/email/resendProvider.ts` | **new** | The one implementation. Plain `fetch`, zero new deps. **Sole owner of the string `api.resend.com`** (§4.10). `import 'server-only'`. |
| `lib/email/registry.ts` | **new** | `isEmailProviderConfigured()` + `resolveEmailProvider()`. ~20 lines, modelled on `lib/auth/oauth/providers.ts` — the only file that knows which providers exist, so a second one is one file plus one branch. |
| `lib/email/gateway.ts` | **new** | The choke point: kill-switch gate → cap gate → provider call (timed out) → log row → typed result. **The only file under `lib/email/` allowed to import from `lib/db/`.** |
| `lib/email/templates/shared.ts` | **new** | `escapeHtml()`, `stripHeaderChars()` (no CR/LF into a subject), the shared HTML shell and footer, `appUrl()`. |
| `lib/email/templates/inviteCode.ts` | **new** | `renderInviteCodeEmail({ code, expiresAt, appBaseUrl })` → `{ subject, text, html }`. Pure function, no I/O. |
| `lib/email/templates/accessRequestNotice.ts` | **new** (D4) | Admin-facing "someone requested access" notice. |
| `lib/email/CLAUDE.md` | **new** | Folder explainer, per this repo's convention that every `lib/` subsystem carries one (`lib/ai`, `lib/auth`, `lib/db`, `lib/import`, `lib/mcp`, `lib/serialize` all do). |
| `lib/email/__tests__/gateway.test.ts` | **new** | Gateway behaviour via a fake provider (§5.3). |
| `lib/email/__tests__/resendProvider.test.ts` | **new** | Transport unit tests against a mocked `fetch` (§5.2). |
| `lib/email/__tests__/templates.test.ts` | **new** | Rendering + escaping (§5.4). |
| `lib/email/__tests__/architecture.test.ts` | **new** | Fitness function (§4.10). |
| `lib/db/schema.ts` | mod | Add the `emailLog` table (§4.4). |
| `lib/db/migrations/00XX_*.sql` (`0009` is now taken by Plan 15 — this plan takes whatever's next when implemented) | **new** | `CREATE TABLE email_log` + two indexes. `drizzle-kit`-generated; **its journal entry must be present** (a hand-written migration missing its journal entry was a real bug found during Plan 13). |
| `lib/db/repository/emailLog.ts` | **new** | `writeEmailLog()`, `countBillableEmailsInWindow()`, `listEmailLog()`, `getLastEmailForInviteCode()`. Append-only: no `UPDATE`/`DELETE` exported. |
| `lib/db/repository/index.ts` | mod | Barrel re-export — the only import surface outside `lib/db/`. |
| `lib/settings.ts` | mod | `liveEmailSends` (bool) + `maxEmailsPerHour` (int) defs and typed accessors (§4.6). |
| `lib/env.ts` | mod | `isEmailConfigured()`, `getResendApiKey()`, `getEmailFrom()`, `getEmailReplyTo()`, `getAdminNotificationEmail()`, `getAppBaseUrl()`, and `_assertEmailEnv()` wired into `assertServerEnv()` (all-or-nothing, §4.6). |
| `app/api/settings/access-requests/[id]/generate-code/route.ts` | mod | After the code is created and the request row deleted, attempt the send; add `emailStatus` to the existing `201` body. Header comment ("Nothing is emailed automatically yet") is now wrong — rewrite it. |
| `app/api/settings/invite-codes/route.ts` | mod (D3) | Optional `sendTo` in the POST body for the admin's plain "+ Generate code"; same `emailStatus` field. |
| `app/api/settings/invite-codes/[code]/send/route.ts` | **new** | `POST` — admin-only manual (re)send for an existing code. The recovery path for a failed send, and the reason this plan needs no retry queue. |
| `app/api/auth/request-access/route.ts` | mod (D4) | Fire-and-report the admin notice. **Its response body must not change in any branch** — the anti-enumeration guarantee in its own header comment outranks reporting an email outcome to an anonymous visitor. |
| `app/components/Settings/AdminSettingsPane.tsx` | mod | Status line next to the generated code, an email-status column + "Send"/"Resend" action on the codes table, corrected copy (§4.9). |
| `app/privacy/page.tsx` | mod | §6 "Data Sharing" is factually wrong once this ships (§2). Also add the recipient address to §4's processor list. |
| `.env.example`, `README.md` | mod | Document the new vars, the all-or-nothing rule, and the DNS/verification prerequisite. |
| `docs/system-about.md`, `docs/user-guide.md`, `docs/roadmap.md`, `CLAUDE.md` (root folder map), `CHANGELOG.md`, `plans/roadmap.md` | mod | §6 step 7. `docs/user-guide.md:45` and the pane copy both currently say the opposite of what will be true. |

### 4.2 The provider seam

```ts
// lib/email/provider.ts  (shape, not final code)
export type EmailMessage = {
  to: string;                 // exactly one recipient per send — see below
  subject: string;            // CR/LF stripped by the template layer
  text: string;               // always present
  html?: string;              // D5
  idempotencyKey?: string;    // §4.7
};

export type ProviderSendResult = { providerMessageId: string | null };

export interface EmailProvider {
  readonly id: string;        // 'resend' — written to email_log.provider
  send(msg: EmailMessage, opts: { signal: AbortSignal }): Promise<ProviderSendResult>;
}
```

**One recipient per send, no `cc`/`bcc`.** Every message in scope is addressed to exactly one
person, and a multi-recipient API is the shape that leaks one user's address to another by
accident. A future bulk need can add a field; it cannot be un-leaked.

`resendProvider.ts` responsibilities — each item is a real requirement, not boilerplate:

- `POST https://api.resend.com/emails` with `Authorization: Bearer <key>`, JSON body
  `{ from, to: [to], subject, text, html?, reply_to? }`; success returns `{ id }` → the
  `providerMessageId`. **Verify the request/response shape and the free-tier limits against
  the vendor's current docs at build time** — the same posture Plan 13 took for MCP protocol
  facts, since a third-party wire format can move between drafting and building.
- Non-2xx → throw `EmailProviderError` carrying the status and a **truncated** body, and
  **never** the request headers (constraint 7). Assert this in a test.
- `AbortError` from the caller's timeout signal propagates unchanged, so the gateway can
  classify it distinctly from a provider rejection.
- Reads `RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_REPLY_TO` from `lib/env.ts` at call time,
  never at module load — the same rule `getAnthropicApiKey()` follows, so a deployment with no
  email configured still boots and still runs everything else.

### 4.3 The gateway, precisely

```ts
sendEmail(msg: OutboundEmail, ctx: EmailContext): Promise<EmailSendResult>
```

Order of operations (mirrors `lib/ai/gateway.ts` step-for-step, minus the re-throw):

0. **Resolve the provider** via `resolveEmailProvider()`. Not configured →
   `{ ok:false, reason:'not_configured' }` **+ one log row** with `status:'not_configured'`, so
   "why did nothing arrive?" is answerable from data rather than from someone's memory of the
   deployment's env file.
1. **Kill-switch gate** — `getLiveEmailSends()`, read fresh. Off → log row with
   `status:'dry_run'`, `{ ok:false, reason:'dry_run_blocked' }`. **No network traffic at all**,
   same hard-stop semantics as the LLM dry run: no synthetic success, no partial degradation.
2. **Cap gate** — count `email_log` rows in the trailing 60 minutes whose status is `sent` or
   `failed` (i.e. the ones that actually reached the provider) against `getMaxEmailsPerHour()`.
   At or over → log row with `status:'blocked_cap'`, `{ ok:false, reason:'cap_reached', retryAfterSeconds }`.
   **Deliberate divergence from the LLM cap**, which writes *no* row because its log table is
   its own unfiltered counter: here the counter is a *filtered* query (`status IN ('sent','failed')`),
   so a denial row cannot inflate the count that produced it, and keeping the row is strictly
   more observable. Write this reasoning into the file as a comment — it will otherwise look
   like an inconsistency with `lib/ai/gateway.ts` and get "fixed".
3. **Live path** — `provider.send(msg, { signal: AbortSignal.timeout(10_000) })`, then a log
   row with `status:'sent'` + `providerMessageId` + `durationMs`, returning
   `{ ok:true, providerMessageId, logId }`. On throw: log row with `status:'failed'` +
   `error` (`'<Name>: <message>'`, ≤2000 chars, key-free), returning
   `{ ok:false, reason:'provider_error' }` — **never a re-throw** (constraint 2).
4. **Log-write failures are swallowed** with a `console.error`, exactly as the AI gateway does
   on its live path: the mail is already sent (or already failed); discarding the outcome
   because the audit write failed is strictly worse. A failed log write on the dry-run/blocked
   paths still returns the blocked result, with `logId: null`.

```ts
type EmailSendResult =
  | { ok: true;  reason?: never; providerMessageId: string | null; logId: string | null }
  | { ok: false; reason: 'not_configured' | 'dry_run_blocked' | 'cap_reached' | 'provider_error' | 'timeout';
      detail?: string; retryAfterSeconds?: number; logId: string | null };
```

`EmailContext` carries `kind`, `relatedType`/`relatedId` (soft references — see §4.4), and
`triggeredBy` (the acting admin's user id, or `null` for a system-triggered send).

### 4.4 Data model — `email_log` (migration `00XX` — `0009` now taken by Plan 15, see §2)

Append-only, one row per send *attempt*, in the same spirit as `llm_call_log` and with the same
soft-reference convention (no Drizzle `references()` — deletion cascades are handled in the
repository layer so the pattern is uniform, per `lib/db/schema.ts`'s header).

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `crypto.randomUUID()` |
| `kind` | text, not null | `'invite_code'` today; `'access_request_notice'` under D4. **Plain `text`, not a Drizzle enum** — unlike `llm_call_log.kind`, this list is expected to grow in *other* plans (password reset, deletion notice), and a plain column lets those add a kind with no schema edit. The union type is documented in TypeScript. |
| `provider` | text, not null | `'resend'`. Present from row one; Plan 11 had to retrofit this on `llm_call_log` and the audit log lied in the meantime. |
| `to_email` | text, not null | Stored lowercased/trimmed. Already stored elsewhere (`user.email`, `invite_code.bound_email`) — no new PII category. |
| `subject` | text, not null | Rendered subject. **The body is never stored** (constraint 7). |
| `status` | text, not null | `'sent' \| 'failed' \| 'dry_run' \| 'blocked_cap' \| 'not_configured'` |
| `provider_message_id` | text, nullable | Non-null only when `status='sent'` — the handle for a support/deliverability question later. |
| `error` | text, nullable | `'<Name>: <message>'`, ≤2000 chars, credential-free. |
| `duration_ms` | integer, not null | `0` for every non-network path. |
| `related_type` | text, nullable | `'invite_code' \| 'user' \| 'access_request'` — soft reference. |
| `related_id` | text, nullable | e.g. the invite code itself. Lets the codes table show a per-row send status without a join table. |
| `triggered_by` | text, nullable | Soft ref → `user.id`. `null` = system-triggered. |
| `created_at` | integer timestamp | Default `unixepoch()` |

Indexes: `email_log_created_idx (created_at)` for the cap window, and
`email_log_related_idx (related_type, related_id)` for the per-code status lookup.

**Existing data:** none — a new table, nothing to backfill, no existing row's meaning changes.
No other table gains a column: the last send for a code is derivable from `email_log`, and
duplicating it onto `invite_code` would create a second source of truth for the same fact.

### 4.5 Repository (`lib/db/repository/emailLog.ts`)

- `writeEmailLog(input)` — insert, returns the id.
- `countBillableEmailsInWindow(sinceMs)` — `status IN ('sent','failed')` only. This asymmetry
  is the whole reason denials can be logged (§4.3 step 2).
- `getLastEmailForInviteCode(code)` — one row, for the codes-table status column.
- `listEmailLog({ limit, offset })` — admin-only read, used by D6's pane if built; harmless if
  not.
- **No `UPDATE`, no `DELETE` exported** — the same append-only convention `llmCallLog.ts`
  holds, minus even its one sanctioned `reserveCallSlot`/`finalizeCallLog` exception (nothing
  here needs a reserved row: the cap counter is a filtered query, not the raw row count).

### 4.6 Configuration — two settings, one env group

Two `SETTING_DEFS` entries (`lib/settings.ts`), which is **all** the UI work they need: the
existing `bool` and `int` renderers in `SettingsView.tsx` already cover them.

```
key:      'liveEmailSends'      datatype: bool   default: true
label:    'Live email sends'
hint:     'When off, outbound emails are recorded and blocked before any network request is
           made — nothing is delivered. Turning this off does not stop invite codes from being
           created; the admin just copies and sends them by hand, as before email existed.'

key:      'maxEmailsPerHour'    datatype: int    default: 50   min: 1
label:    'Max emails per hour'
hint:     'Deployment-wide ceiling on outbound emails in a rolling 60-minute window, counting
           only attempts that actually reached the provider. A blocked send is recorded and
           flagged, never silently dropped. Exists so a loop or a burst of access requests
           cannot exhaust the provider quota or damage the sending domain's reputation.'
```

Fail-safe semantics, matching the established pattern exactly:
- `liveEmailSends`: row absent → `true` (fail-open, preserves the intended behavior of a
  configured deployment); unparseable → `false` + `console.warn` (fail-closed). The same
  asymmetry `getLiveLlmCalls()` uses — a spending default may come from the *absence* of
  configuration, never from *garbage* configuration. Note the real safety layer is the env
  group: with no `RESEND_API_KEY`, a deployment cannot send regardless of this toggle.
- `maxEmailsPerHour`: row absent → `50`; unparseable or `< 1` → `1` + `console.warn`.

Env vars (all-or-nothing group, validated in `assertServerEnv()` via `_assertEmailEnv()`, same
shape as `_assertOAuthEnv()`):

| Var | Required | Note |
|---|---|---|
| `RESEND_API_KEY` | with the group | Never logged, never returned, call-time getter that throws. |
| `EMAIL_FROM` | with the group | e.g. `MyAgentStudio <noreply@myagentstudio.dev>` — D2. Must be on a verified domain or the provider rejects every send. |
| `APP_BASE_URL` | with the group | Absolute origin for links in emails, e.g. `https://myagentstudio.dev`. Validated like `OAUTH_REDIRECT_BASE_URL` (scheme+host+optional port, no trailing slash, https in production). **A new var rather than reusing `OAUTH_REDIRECT_BASE_URL`**: that one is optional and OAuth-scoped, and quietly overloading it makes disabling OAuth silently break email links. If both end up set to the same value, note it in `.env.example`; collapsing them is a separate cleanup. |
| `EMAIL_REPLY_TO` | optional | D2. Absent → no `reply_to` header. |
| `ADMIN_NOTIFICATION_EMAIL` | optional (required only if D4 = yes) | Fixed recipient for the admin notice. Deliberately env-configured, not read from the admin's `user.email` row, so a role change never silently redirects operational mail. |

None set → email disabled, app runs exactly as today. Some but not all set → refuse to boot
(a partial config produces a "we'll email you" promise that silently never fires — the same
reasoning behind OAuth's all-or-nothing rule).

### 4.7 Templates

Plain TypeScript functions returning `{ subject, text, html }`, one file per message kind, no
I/O and no DB access — unit-testable with no mocks at all.

**Deliberately *not* built like the system-agent prompts** (`lib/ai/prompts/system-agents/*.md`
compiled by `scripts/build-prompts.ts`). That pipeline exists because a prompt is one
continuous AI-facing blob a human edits as prose; an email is two parallel renderings (text +
HTML) with per-field escaping and a subject that must be header-safe. A build step would buy
consistency of *file location* at the cost of losing the type checker on every interpolation.
State this in `lib/email/CLAUDE.md` so it doesn't get "harmonized" later.

Rules for every template:
- Every interpolated value goes through `escapeHtml()` in the HTML part. The invite code is
  the only interpolated value in the first template, but the admin-notice template (D4)
  interpolates a **visitor-supplied name** — untrusted input in an outbound message.
- Subjects go through `stripHeaderChars()` (CR/LF removed). A JSON API is not vulnerable to
  classic SMTP header injection, but the rule is cheap, and the provider is swappable.
- The text part is always produced and always sent; HTML is additive (D5).
- Footer states why the message was received and which deployment sent it — no tracking, no
  unsubscribe link (constraint 8).
- **Idempotency:** where the provider supports an idempotency key, pass a deterministic one
  (e.g. `invite:<code>`), so a double-clicked "Send" or a retried request cannot deliver two
  copies. Verify support at build time; if absent, the UI's disabled-while-busy state (the
  existing `busyRequestId` pattern) is the only guard, which is acceptable but worth knowing.

The invite-code email says: someone offered you a spot; here is the code; here is where to
enter it (`APP_BASE_URL/signup`); it expires at `<expiresAt>` and can be used once. Nothing
else — no marketing, no product tour.

### 4.8 The one wired trigger — invite-code delivery

`POST /api/settings/access-requests/[id]/generate-code`, exact new order of operations:

1. Admin auth (unchanged).
2. Create the invite code, bound to the request's email, with the configured expiry
   (unchanged).
3. Delete the access-request row (unchanged) — the code is the durable record from here on.
4. **Then** attempt the send: `sendEmail({ to: row.boundEmail, ...renderInviteCodeEmail(...) },
   { kind:'invite_code', relatedType:'invite_code', relatedId: row.code, triggeredBy: adminId })`.
5. Return **`201`** — always — with the existing body plus `emailStatus`
   (`'sent' | 'failed' | 'blocked' | 'not_configured' | 'disabled'`).

Steps 2–3 stay in their current transactional shape; step 4 is strictly after, outside it
(constraint 4). If the process dies between 3 and 4, the outcome is a created code that was
never emailed — visible in the codes table with no send status, recoverable with one click on
the manual send route. That is the correct failure mode: a lost email, never a lost code.

**Manual (re)send** — `POST /api/settings/invite-codes/[code]/send`, admin only:
- `404` if the code doesn't exist; `409` if it is already redeemed (sending a spent credential
  is never useful) or expired.
- Recipient = `boundEmail` if set, else an admin-supplied `to` in the body (constraint 5's
  single, authenticated exception). If neither → `400 no_recipient`.
- Returns `200 { emailStatus, logId }`. This route is the retry mechanism; §9 explains why
  there is no queue.

### 4.9 UI (admin Settings only)

Nothing about the workbench, the chat, or any non-admin surface changes.

| Change | Mockup first? |
|---|---|
| Two new rows in System settings (`liveEmailSends`, `maxEmailsPerHour`) | **No** — existing `bool`/`int` renderers, no new visual concept (standing rule 4 exists for iteration efficiency, and a trivial addition through an existing renderer doesn't need the detour). |
| Status line under the generated-code box: "Emailed to alice@example.com" / "Couldn't email this code — copy it and send it manually." | **Yes** — new visual element. |
| `Email` column + `Send`/`Resend` action in the invite-codes table | **Yes** — new column and new row action; prototype in `reference/layout/Layout-Workbench.html` first, **one concept per dispatch**, and waive the build-equivalent sanity check for that file (there is no compiler for it; a human looking at it in a browser is the gate). |
| Corrected copy in the Access requests + Invite codes sections | **No** — text only. |
| Email log pane (D6) | **Yes**, if built — mirror `ActivityLogPane.tsx`. |

The failure copy must always keep the code visible and copyable: the existing `setNewCode(...)`
box already does this, so the "email failed" state is a *label added next to a working
fallback*, not an error screen. That is what "Flag, don't block" looks like here.

### 4.10 Fitness function (`lib/email/__tests__/architecture.test.ts`)

Following the per-subsystem precedent (`lib/ai/`, `lib/mcp/` each carry their own), table-driven
so a second provider adds a row rather than an exception:

| Rule | Assertion |
|---|---|
| Transport isolation | The string `api.resend.com` appears in exactly `lib/email/resendProvider.ts`. |
| DB boundary | No file under `lib/email/` except `gateway.ts` imports from `lib/db/` (type-only imports excluded, same carve-out `lib/ai`'s test already documents). |
| Single choke point | `provider.send(` / a direct provider construction appears in no route, no component, and no file under `lib/` outside `lib/email/`. |
| No body persistence | `writeEmailLog(` is called only from `lib/email/gateway.ts`, and its input type has no body/html field at all — the constraint is enforced by the *type*, with the test as a second line. |
| Templates stay pure | No file under `lib/email/templates/` imports `lib/db/` or `lib/env.ts` (values are passed in). |

### 4.11 Phase 0 — the user-executed setup (no agent can do this)

Per the standing preference that the user performs console/browser/DNS steps themselves rather
than an agent doing them, this phase is **instructions to hand over**, not work to run:

1. Create the provider account (D1).
2. Add the sending domain (D2) and publish the DNS records it issues — SPF (`TXT`), DKIM
   (`CNAME`/`TXT`), and a DMARC record (`_dmarc`, start at `p=none` to observe, tighten later).
   Wait for verification to report green.
3. Disable open/click tracking in the provider dashboard (constraint 8).
4. Create an API key scoped to *sending only*, and put it plus `EMAIL_FROM`, `APP_BASE_URL` in
   the server's `.env.local`. Restart (`.env.local` is read at process start).
5. Note the free-tier ceilings and set `maxEmailsPerHour` below the daily cap.

Development does **not** depend on this phase: with no key set, everything builds, every test
passes, and the gateway returns `not_configured` — which is itself a tested path.

---

## 5. Testing approach

All of it mocked and free, mirroring the existing pattern where route suites `vi.mock` the
*provider module* and run the real gateway + real route (`chat-dryrun.test.ts`,
`import-dryrun.test.ts`, `tenancy.test.ts` do this for `lib/ai/anthropicProvider.js`). Here the
equivalent is `vi.mock('@/lib/email/resendProvider.js', …)`, plus a `createEmailGateway(fakeProvider)`
seam for direct gateway tests — the same testable-seam-plus-lazy-singleton shape
`createGateway()`/`getGateway()` uses.

### 5.1 Repository (`lib/db/repository/__tests__/emailLog.test.ts`, in-memory DB)
- Insert/read round trip for every `status` value.
- `countBillableEmailsInWindow` counts `sent` + `failed` and **excludes** `dry_run`,
  `blocked_cap`, `not_configured` — the assertion that keeps the cap from denying itself into a
  permanent lockout.
- Rolling-window boundary: a row exactly at the edge, one just outside.
- `getLastEmailForInviteCode` returns the newest row for that code and nothing for another.
- The module exports no `UPDATE`/`DELETE` (structural assertion, matching `llmCallLog`'s).

### 5.2 Provider (`lib/email/__tests__/resendProvider.test.ts`, mocked `fetch`)
- Request shape: endpoint, `Authorization` header present, `to` sent as a single-element array,
  `from`/`subject`/`text`/`html`/`reply_to` mapped; `reply_to` omitted when unset.
- 2xx → `providerMessageId` extracted; a 2xx with no id → `null`, not a throw.
- Non-2xx → throws `EmailProviderError`; **assert the thrown message contains neither the API
  key nor the word `Authorization`** (constraint 7 — the one test that guards a credential leak).
- Aborted signal → the original `AbortError` identity survives, so the gateway can classify a
  timeout separately from a rejection.

### 5.3 Gateway (`lib/email/__tests__/gateway.test.ts`, in-memory DB + fake provider)
- **Not configured** → `not_configured`, a log row with that status, provider never touched.
- **Kill switch off** → `dry_run_blocked`, one row, **zero network calls** (assert the fake's
  call count is 0 — the cheapest proof the choke point held).
- **Cap reached** → `blocked_cap` + `retryAfterSeconds`; a `dry_run` row in the window does not
  push it over.
- **Provider throws** → `{ ok:false, reason:'provider_error' }` and **the gateway does not
  throw** (`await expect(...).resolves` — this is constraint 2's regression test, and the one
  most likely to be broken by a later "let's just propagate the error" refactor).
- **Timeout** → classified as `timeout`, row written, no throw.
- **Log-write failure on the live path is swallowed** and still returns `ok:true`.
- The kill switch is re-read per call: flip the setting between two sends and see behavior
  change with no restart.

### 5.4 Templates (`lib/email/__tests__/templates.test.ts`, pure)
- Subject contains no CR/LF even when a field does.
- An interpolated value containing `<script>`/`&`/quotes is escaped in the HTML part and left
  literal in the text part.
- Both parts contain the invite code and the expiry; the link is built from the passed base URL
  with no double slash.
- **No keyword/phrase assertions on message wording** beyond these structural facts — this
  repo's rule is that content validation is quantitative, never keyword-matching, and copy will
  be reworded.

### 5.5 Routes (`app/api/settings/__tests__/…`, provider module mocked)
The behavioral core of the plan:
- Generate-code with the provider **throwing**: still `201`, still returns the code, the access
  request is still deleted, `emailStatus:'failed'`. *This is the test that proves "Flag, don't
  block".*
- Generate-code happy path: `201`, `emailStatus:'sent'`, exactly one provider call, addressed to
  the request's email — never to any address from the request body.
- Generate-code with email unconfigured: `201`, `emailStatus:'not_configured'` — i.e. the
  pre-email behavior is fully intact.
- Manual send: `404` unknown code, `409` redeemed, `409` expired, `400` no recipient, `200`
  otherwise; non-admin → `403`; unauthenticated → `401` (via the existing guard, no new auth
  code).
- D4 only: the access-request endpoint's response body and status are **byte-identical** across
  every branch — registered email, open request, brand-new request, and email-send failure. The
  anti-enumeration guarantee is not allowed to regress in exchange for an email.
- No route returns a different status code than it does today because of an email outcome
  (assert against the current suite's expectations).

### 5.6 Live verification — **requires an explicit user go-ahead; do not run automatically**

Everything above touches no network. Exactly one live pass is needed, after Phase 0 and after
the user says so:

- One real send to an address the user controls, triggered through the real admin UI.
- Confirm: it arrives, **lands in the inbox rather than spam**, `From`/reply-to render as
  intended, the link works, and one `email_log` row exists with `status:'sent'` and a
  `provider_message_id`.
- Then one deliberate failure (bad key or an invalid recipient) to confirm the flag path is
  real: code still created, still shown, still copyable, `status:'failed'` logged.
- Cost: effectively zero on a free tier — but sending reputation, unlike an LLM call, is spent
  on a domain the user owns and cannot be refunded. Ask regardless (constraint 10).
- **Not part of this plan's gate:** ongoing deliverability monitoring, or DMARC tightening past
  `p=none`.

---

## 6. Implementation sequence

| # | Step | Depends on | Notes / risk |
|---|---|---|---|
| 0 | **Answer D1–D6.** Then the user performs §4.11 Phase 0 (account, DNS, key). | — | Only D1/D2 need Phase 0; D3–D6 are code-shape decisions. **Blocks live verification only** — steps 1–7 are fully developable and testable with no provider account at all. |
| 1 | Schema + migration (whatever `drizzle-kit` generates next — `0009` is now taken by Plan 15) + `emailLog` repository + barrel export + §5.1 tests | — | Behavior-preserving on its own: a new table nothing reads yet. Verify the migration journal entry exists (a real Plan 13 bug). |
| 2 | `lib/email/` — `provider.ts`, `registry.ts`, `gateway.ts`, env getters, the two settings + §5.2/§5.3 tests | 1 | The subsystem, still with no caller. Ships and tests standalone. |
| 3 | Templates + §5.4 tests | — | **Parallelizable with 1–2** (pure functions, no dependencies). |
| 4 | Wire trigger 1: generate-code route change + the manual send route + §5.5 tests | 2, 3 | The first behavior change a user could notice. |
| 5 | Fitness function (§4.10) | 2 | Must land in the same batch as 2/4 or the boundaries are documented but unenforced — the exact gap Plan 11 found for `lib/ai`'s DB rule. |
| 6 | UI: mockup first for the two new visual concepts, then the pane changes + corrected copy | 4 | Standing rule 4; one concept per dispatch. |
| 7 | Docs: `lib/email/CLAUDE.md`, root `CLAUDE.md` folder map, `docs/system-about.md`, `docs/user-guide.md:45`, `docs/roadmap.md`, **`app/privacy/page.tsx` §4+§6**, `.env.example`, `README.md`, `CHANGELOG.md`, `plans/roadmap.md` | 1–6 | **The privacy edit is a correctness fix, not documentation polish** — the page currently asserts data goes to no third party besides the AI provider. Restate rules inline; never cite a bare section number (standing rule 6). |
| 8 | **Live verification — ask first** | 0, 7 | §5.6. |
| 9 | *Optional, D4:* admin notice on a new access request | 2, 3 | Parallelizable with 4–6. Keep the endpoint's response identical in every branch. |
| 10 | *Optional, D6:* Email log pane | 1, 6 | Purely additive read surface. |

**Rollback:** flip `liveEmailSends` off — one DB row, no deploy, no restart, and every code
flow returns to exactly the copy-and-paste behavior it has today. Removing the env vars is the
harder stop (needs a restart), which is why the setting exists at all.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **An email failure blocks or reverses an invite code.** | Constraints 2–3, enforced by §5.5's provider-throws test and by the gateway's no-throw return type. Ordering is code-first, send-last. |
| 2 | **Mail lands in spam** — the invisible failure, since the provider reports success. | Phase 0's SPF/DKIM/DMARC on a verified domain; §5.6 checks inbox placement explicitly, not just a 200 response. Residual: no ongoing monitoring in this plan. |
| 3 | **The app becomes an open relay / spam cannon.** | Constraint 5 (recipients come from stored values; only an authenticated admin may type one) + the hourly cap + the existing IP rate limiter on the one public endpoint involved. |
| 4 | **A loop or burst exhausts the free tier / burns reputation.** | `maxEmailsPerHour`, counted from the log, with a visible `blocked_cap` row rather than a silent drop. |
| 5 | **The API key leaks into a log line or an error body.** | Constraint 7 + the §5.2 assertion that a thrown provider error contains neither the key nor `Authorization`. Same rule Plan 11 set for the second LLM provider. |
| 6 | **A credential ends up in `email_log`.** Today's invite code is already stored plaintext by design, but a future reset token must not be. | The log's input type has no body field at all — the constraint is structural, not a habit. Set it now, before the password-reset plan arrives and finds a body column sitting there. |
| 7 | **The privacy policy silently becomes false.** | Step 7 is a hard part of the sequence, listed before live verification, not a follow-up. |
| 8 | **A slow provider hangs an admin request.** | 10s `AbortSignal.timeout()`, classified as its own `timeout` reason. |
| 9 | **Duplicate delivery from a double-click or a retry.** | Deterministic idempotency key where supported (§4.7) + the existing disabled-while-busy button pattern. Verify key support at build time. |
| 10 | **Anti-enumeration regresses via D4's trigger** — e.g. a timing or body difference that reveals whether an email is registered. | The notice is sent on the *new-request* branch only, after the response shape is already fixed; §5.5 asserts byte-identical responses across all branches. If this can't be kept clean, drop D4 — it is optional. |
| 11 | **`api.resend.com` gets a second caller later**, quietly re-opening the transport. | §4.10's sole-owner assertion, table-driven so a second provider is a row, not an exception. |
| 12 | **The provider's wire format or free tier moved since this was drafted.** | §4.2 says verify at build time — the same standing caution Plan 13 applied to the MCP spec. |

---

## 8. Decisions — **all OPEN as of 2026-08-27**

### D1 — Which email provider?

**Recommendation: Resend, called over plain `fetch`, behind the `EmailProvider` seam.** Not a
vendor lock — the seam means switching is one new file plus one registry branch, exactly as
`lib/auth/oauth/providers.ts` promises for a second OAuth provider.

| Option | Pros | Cons |
|---|---|---|
| **A. Resend over `fetch`** *(recommended)* | Single JSON endpoint, no npm dependency (matching Plan 11's zero-dep outcome); free tier comfortably covers a 5-user closed beta; domain verification is a guided DNS flow; developer-oriented docs | Another vendor account; free-tier daily/monthly ceilings (verify current numbers at build time); one more third-party processor to name in the privacy policy |
| **B. AWS SES** | Cheapest at any real volume; the deployment is already on AWS/EC2; no new vendor relationship | Sandbox by default — sending to unverified addresses needs a **support-ticket production-access request** with an approval delay; calling it means either the AWS SDK (a heavy dependency for one call) or hand-rolled SigV4 signing (crypto code this plan should not be writing). Highest friction for the smallest app in the roadmap. |
| **C. Postmark** | Best-in-class transactional deliverability; strict transactional-only stance fits constraint 8 | Smallest free allowance; paid sooner than the alternatives for a hobby-scale deployment |
| **D. SMTP via `nodemailer`** | Provider-agnostic; works with any relay including a personal mailbox | A new dependency *plus* still needing a relay; personal-mailbox relays (Gmail app passwords) have poor deliverability for app mail and are a credential-handling liability |
| **E. Do nothing / keep manual** | Zero cost, zero surface | Leaves the product actively promising an email it never sends, and keeps two roadmap items blocked |

**What the user must decide:** whether to open a third-party account and publish DNS records on
`myagentstudio.dev` at all, and if so, which of A–D. Everything downstream in this plan is
provider-shaped only inside `resendProvider.ts` and one string in the fitness table.

### D2 — Sender identity

Open sub-questions: the exact `From:` address (`noreply@myagentstudio.dev` recommended); whether
to send from the apex domain or a dedicated subdomain (`mail.myagentstudio.dev` — isolates
sending reputation from the main domain, at the cost of one more DNS zone to manage); whether a
`Reply-To` should point at a real monitored mailbox (recommended if one exists — a `noreply`
that silently discards a confused invitee's reply is a real support hole for a beta) and, if so,
which address; and the display name (`MyAgentStudio`).

### D3 — Which invite codes get emailed, and on whose click?

**Recommendation:** auto-send for a code generated **from an access request** (that visitor was
already told "we'll email your invite code soon" — an extra confirmation click adds a step and
a way to forget); explicit **"Send"** for a code created via the admin's plain "+ Generate
code", since that path has no recipient until the admin names one.

Open alternatives: make *both* explicit (safest, one more click, an unambiguous audit story of
"the admin chose to email this"); or add an optional `sendTo` field to the plain generate flow
so both paths can be one action. This is a product-feel call, not a technical one.

### D4 — Does the admin get an email when a new access request arrives?

**Recommendation: yes, small and useful** — otherwise a request sits unseen until the admin next
opens Settings, and the visitor's "we'll email you soon" ages badly. But it is the **only**
proposed trigger fired by an unauthenticated endpoint, so it needs: a fixed env-configured
recipient (never a request-supplied one), the hourly cap, the existing IP rate limiter, and
§5.5's identical-response assertion. **If the user prefers zero unauthenticated send paths in
v1, drop it** — the invite-code trigger alone fully exercises and verifies the subsystem.

Sub-question if yes: `ADMIN_NOTIFICATION_EMAIL` (recommended, stable across role changes) or the
admin user row's email (fewer vars, silently redirects if roles change).

### D5 — HTML + plain text, or plain text only?

**Recommendation: both.** A text-only email carrying a formatted code renders acceptably but
looks like a phishing attempt to a recipient who has never heard of the product — for an
invitation whose entire job is to be trusted enough to click, that matters. The HTML should be
minimal and inline-styled (a heading, the code in a monospace block, one button-ish link, a
footer), with the text part always present as the fallback. Alternative: text-only for v1 —
less code, nothing to escape, and honestly fine for a closed beta.

### D6 — Where do email failures surface?

**Recommendation for this plan: inline flags only** — a status line next to the generated code
and a status column with a "Resend" action on the codes table. That covers the actual recovery
need with no new pane. An **Email log pane** mirroring `ActivityLogPane.tsx` is a natural
follow-up and the reason `listEmailLog()` exists; the question is whether it belongs in this
plan or as its own roadmap item. Note the table is **not** write-only without it — it is the cap
counter and the per-code status source, so nothing is being logged "just in case."

---

## 9. Explicitly NOT in this plan

- **Password reset / forgot-password.** Roadmap item **Review user account management** —
  §10 lists exactly what it inherits.
- **Account deletion / disconnection notices.** Roadmap item **Delete or disconnect user
  (admin)** — same.
- **Welcome emails, digests, activity summaries, anything marketing.** Constraint 8.
- **A retry queue, a scheduler, or background jobs.** A send is attempted once, synchronously,
  and a failure is flagged with a one-click manual resend. A durable queue in a single-process
  Next.js app on one EC2 instance is a genuinely separate piece of infrastructure, and the
  recovery path here is a human clicking "Resend" — which is both simpler and more honest than
  a retry loop against a provider that may be rejecting for a permanent reason.
- **Inbound email / reply handling.** `Reply-To` (D2) may point at an existing mailbox; nothing
  in the app reads mail.
- **Bounce/complaint webhooks and suppression lists.** Meaningful at volumes this deployment
  will not see for a long time; `provider_message_id` is stored so a later plan can correlate.
- **Per-user email preferences or unsubscribe.** Every message in scope is transactional.
- **Email-based verification of a signup address.** Admission is already gated by invite codes
  and `maxUsers`; adding verification is a separate product decision.
- **A second email provider.** The registry makes it additive — one file, one branch.
- **Internationalization / localization of message copy.**
- **Collapsing `APP_BASE_URL` and `OAUTH_REDIRECT_BASE_URL`** into one variable (§4.6).

---

## 10. How this unblocks the two dependent roadmap items

Neither is built here. What each one gets, so its own plan starts from a wiring problem rather
than an infrastructure problem:

**Delete or disconnect user (admin)** — its description names "a notification email to the
affected user (depends on Email-sending provider for that email)". After this plan, that email
is: one new template file, one new `kind` string (no schema change — `email_log.kind` is plain
text precisely for this, §4.4), and one `sendEmail()` call placed *after* the deletion commits.
Constraints 2–3 already guarantee the part that matters most for a destructive action: **a
failed notification can never leave the account half-deleted**, because the send happens after
the write and cannot fail it. The recipient comes from the stored `user.email` — no new
recipient-source rule needed (constraint 5 already covers it).

**Review user account management** (password reset) — its description names an email transport
as the same blocker. After this plan, the transport, the kill switch, the cap, the log, the
sender identity and the template layer all exist; that plan then owns the parts that are
genuinely its own: a `password_reset_token` table (hashed token, short TTL, single use, bound to
a user), a public request endpoint that must return an identical response whether or not the
email exists (the same anti-enumeration posture `request-access` already implements), a reset
form, and an invalidation rule for existing sessions. Two rules set here matter directly to it:
**the log never stores a message body** (constraint 7), so a live reset token cannot leak into
the audit table; and **the gateway never throws**, so a mail failure surfaces as "we couldn't
send it, try again" rather than a 500 that tells an attacker something.

**Scope boundary, stated once:** this plan ships when invite-code delivery works end to end and
is verified. Both items above stay open in `plans/roadmap.md` afterward, with their descriptions
updated to say the transport now exists.
