# lib/email — Outbound Email Gateway (Plan 14)

The single choke point for every outbound email the app sends, built in the same shape as
the LLM gateway (`lib/ai/`): one provider interface, one transport implementation, one
gateway that gates and logs every attempt, and a small registry that hides "which provider
is active" from everything else.

## Architecture

```
route handler (app/api/…)
  └─ getEmailGateway().sendEmail(msg, ctx)
        ← the single choke point. Kill-switch gate → cap gate → provider call
           (10s AbortSignal.timeout) → log row → typed result. The ONLY file
           under lib/email/ allowed to import from lib/db/.
        └─ registry.ts
              ← the ONLY file that knows which providers exist. resolveEmailProvider()
                 reads isEmailConfigured() (lib/env.ts) fresh per call.
              └─ resendProvider.ts  ← plain fetch, zero new dependency. Sole
                                        owner of the string 'api.resend.com'.
```

**Provider seam (`provider.ts`)**: the `EmailProvider` interface, `EmailMessage`/
`ProviderSendResult` types, and the shared `EmailProviderError` class. One recipient per
`send()` call, no `cc`/`bcc` — every message in scope is addressed to exactly one person,
and a multi-recipient shape is the one that leaks one user's address to another by accident.

**The gateway never throws** — this is a *deliberate divergence* from `lib/ai/gateway.ts`,
which re-throws a provider error. An AI call is the user's requested action, so failing it
is correct; an email is a side effect of someone else's action (an invite code being
generated, an access request being filed), so failing that action would violate this
codebase's "Flag, don't block" principle. Every outcome — success, not-configured,
kill-switch-off, cap-reached, provider error, timeout — comes back as a discriminated
`EmailSendResult`, never a throw. **No caller's HTTP response status may change because an
email failed.** The triggering write is committed, and the response body is already
correct, before `sendEmail()` is ever called.

**Order of operations** (mirrors `lib/ai/gateway.ts` step-for-step, minus the re-throw):
0. Resolve the provider (`resolveEmailProvider()`, fresh per call). Not configured →
   `{ ok:false, reason:'not_configured' }` + one log row, so "why did nothing arrive?" is
   answerable from data.
1. Kill-switch gate — `getLiveEmailSends()` (`lib/settings.ts`), read fresh, no cache. Off →
   log row `status:'dry_run'`, `{ ok:false, reason:'dry_run_blocked' }`. No network traffic
   at all.
2. Cap gate — `countBillableEmailsInWindow()` counts `email_log` rows in the trailing
   60 minutes whose status is `'sent'` or `'failed'` (i.e. the ones that actually reached
   the provider) against `getMaxEmailsPerHour()`. At/over → log row `status:'blocked_cap'`,
   `{ ok:false, reason:'cap_reached', retryAfterSeconds }`. This is a **deliberate
   divergence** from the LLM cap, which writes *no* row on denial because its log table is
   its own unfiltered counter: here the counter is a *filtered* query, so a denial row
   cannot inflate the count that produced it — keeping the row is strictly more observable.
   `retryAfterSeconds` is the full window (not derived from the oldest in-window row's
   timestamp, unlike the LLM cap's precise §3.9 derivation) — there's no per-user identity
   to make that precise about for a deployment-wide cap, and a coarse hint is enough.
3. Live path — `provider.send(msg, { signal: AbortSignal.timeout(10_000) })`. Success → log
   row `status:'sent'` + `providerMessageId` + `durationMs`, `{ ok:true, providerMessageId,
   logId }`. On throw: log row `status:'failed'` + `error` (`'<Name>: <message>'`, ≤2000
   chars, credential-free), and the result's `reason` is `'timeout'` when the thrown error's
   `name` is `'TimeoutError'` or `'AbortError'`, else `'provider_error'` — **never a
   re-throw**. The `email_log.status` enum has no separate timeout value; only the
   *result*'s `reason` field distinguishes it.
4. Log-write failures are swallowed with a `console.error`, exactly as the AI gateway does
   on its live path — the mail is already sent or already failed; discarding that outcome
   because the audit write failed would be strictly worse.

## The log table (`email_log`, via `lib/db/repository/emailLog.ts`)

Append-only, one row per send *attempt* — same spirit as `llm_call_log`, but **the rendered
body is never stored**. `kind` and `provider` are plain `text` columns, not Drizzle enums —
unlike `llm_call_log.kind`, new email kinds are expected to be added by *other* plans later
(password reset, deletion notice) with no schema change; the union type lives in TypeScript
instead. `status` IS a Drizzle enum (`'sent' | 'failed' | 'dry_run' | 'blocked_cap' |
'not_configured'`) since that set is fixed by this plan's own state machine.

**Why the body is never stored, ever:** a future password-reset email's body will contain a
live reset token. `WriteEmailLogInput` (the repository's write type) has no `body`/`html`
field at all — the constraint is enforced by the type itself, not by a habit to remember,
with `lib/email/__tests__/architecture.test.ts` asserting it structurally as a second line
of defense.

No `UPDATE`/`DELETE` is exported from the repository — fully append-only, with no sanctioned
exception (unlike `llm_call_log`'s reserve/finalize pair: nothing here needs a reserved row,
since the cap counter is a filtered `COUNT` query over completed rows, not the raw row
count, so there's no race to close).

## Templates (`templates/`)

Plain TypeScript functions returning `{ subject, text, html }` — pure, no I/O, no `lib/db`
or `lib/env` import (values are always passed in by the caller; enforced by the fitness
function). **Deliberately not built like the system-agent prompts**
(`lib/ai/prompts/system-agents/*.md`, compiled at build time): a prompt is one continuous
AI-facing blob a human edits as prose, while an email is two parallel renderings (text +
HTML) with per-field escaping and a header-safe subject — a build step would buy
consistency of file location at the cost of losing the type checker on every interpolation.
Every interpolated value goes through `escapeHtml()` in the HTML part; every subject goes
through `stripHeaderChars()` (CR/LF stripped — a JSON API isn't vulnerable to classic SMTP
header injection, but the rule is cheap and the provider is swappable). `renderInviteCodeEmail`
is used by the one wired trigger (invite-code delivery); `renderAccessRequestNoticeEmail`
(D4) interpolates a **visitor-supplied name** — untrusted input in an outbound message —
so its escaping is load-bearing, not defensive boilerplate.

## Configuration

Two settings (`lib/settings.ts`): `liveEmailSends` (bool, default `true`, fail-open on an
absent row / fail-closed on garbage — same asymmetry as `liveLlmCalls`) and
`maxEmailsPerHour` (int, default `50`, min `1`). Both use the existing generic settings
UI — no new component.

Env vars (`lib/env.ts`), all-or-nothing like OAuth, validated by `_assertEmailEnv()` inside
`assertServerEnv()`: `RESEND_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL` (a **new** variable,
deliberately not reusing `OAUTH_REDIRECT_BASE_URL` — that one is optional and OAuth-scoped,
and overloading it would make disabling OAuth silently break email links). `EMAIL_REPLY_TO`
and `ADMIN_NOTIFICATION_EMAIL` are optional and read via their own getters, which return
`null` rather than throw when unset. **None of the required three set → email disabled,
app runs exactly as today. Some but not all → refuse to boot** (a partial config produces a
"we'll email you" promise that silently never fires).

## Files in this folder

| File | Role |
|---|---|
| `provider.ts` | `EmailProvider` interface + `EmailMessage`/`ProviderSendResult` types + shared `EmailProviderError` |
| `resendProvider.ts` | The ONLY `api.resend.com` caller. Plain `fetch`, zero new dependency, `server-only` |
| `registry.ts` | The ONLY file that knows which providers exist. `resolveEmailProvider()`, `isEmailProviderConfigured()` |
| `gateway.ts` | Gate checks, audit log, the choke point. The ONLY file under this folder allowed to import `lib/db/` |
| `templates/shared.ts` | `escapeHtml`, `stripHeaderChars`, `appUrl`, the shared HTML shell |
| `templates/inviteCode.ts` | The one wired trigger's email — code delivery |
| `templates/accessRequestNotice.ts` | Admin-facing new-request notice (D4) |
| `__tests__/resendProvider.test.ts` | Transport unit tests against mocked `fetch` |
| `__tests__/gateway.test.ts` | Gateway behavior via a fake provider (no real transport) |
| `__tests__/templates.test.ts` | Rendering + escaping, pure |
| `__tests__/architecture.test.ts` | Fitness function: transport isolation, DB boundary, choke point, no-body-persistence, template purity |
