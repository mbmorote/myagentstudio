# lib/ai — AI Callers, Gateway, and System Agents

This folder contains the single gateway through which every AI call in the app passes, the three AI callers, the Anthropic provider implementation, and the build-time prompt compilation output.

## Architecture (Plan 04, extended Plan 11)

```
route (app/api/…)
  └─ caller (hermes.ts, daedalus.ts, prometheus.ts)
        ← knows the domain (prompts, JSON parsing, stop_reason rules, demotion)
        └─ gateway (gateway.ts)
              ← the single choke point. Gate check + audit log. The ONLY lib/ai file
                 allowed to import from lib/db. Resolves the active provider fresh on
                 every call via resolveActiveProvider() from providerRegistry.ts.
              └─ providerRegistry.ts
                    ← the ONLY file that knows both providers exist. Lazy per-id
                       instance cache. resolveActiveProvider() reads the 'llmProvider'
                       setting fresh per call so a setting flip takes effect immediately
                       without a restart (Plan 11 constraint 4).
                    ├─ anthropicProvider.ts  ← @anthropic-ai/sdk (sole SDK importer)
                    └─ openaiCompatibleProvider.ts  ← fetch + /chat/completions
```

**Per-provider transport isolation:** each provider file is the only file permitted
to import its own transport dependency. `@anthropic-ai/sdk` may only be imported by
`lib/ai/anthropicProvider.ts`. The OpenAI-compatible endpoint path (`/chat/completions`,
appended to a caller-supplied base URL that already carries the vendor's own `/v1`
segment — fixed 2026-08-20, previously double-appended `/v1` and 404'd on every live
call) may only appear in `lib/ai/openaiCompatibleProvider.ts`. Both rules are enforced by a
table-driven fitness function (`lib/ai/__tests__/architecture.test.ts`) that fails if
any other file contains the guarded string. Adding a third provider means adding one
row to each applicable table, not special-casing any assertion.

**DB-import boundary (test-enforced, Plan 11):** no file under `lib/ai/` except
`gateway.ts` may import from `lib/db/`. Providers and callers are pure transport or
domain logic — they must never reach the database directly. Enforced by the same
architecture test.

`client.ts` was deleted when Plan 04 landed.

## The gateway (`gateway.ts`)

The gateway is the single point through which every AI call attempt flows, live or dry-run. It:

0. **Resolves the active provider** by calling `resolve()` — a zero-argument function injected at construction time. In production `getGateway()` passes `resolveActiveProvider` (from `providerRegistry.ts`) so the provider is resolved fresh on every call from the current 'llmProvider' DB setting. In tests `createGateway(fakeProvider)` normalizes the plain object to `() => fakeProvider` internally — all existing test call sites keep compiling and working unchanged.
1. Resolves the model (`req.model ?? provider.defaultModel()`) using the just-resolved provider (after step 0, not before, since `defaultModel()` is provider-specific).
2. Reads `liveLlmCalls` from the DB **fresh on every call** (no cache). A cached toggle would appear unreliable — the same principle applies to provider selection.
3. **Dry-run path** (setting is off **or** `ctx.forceDryRun` is true): writes a log row (`dryRun: true`, `responsePayload: null`, `provider: provider.id`), returns `{ ok: false, reason: 'dry_run_blocked', model, logId }`. The provider is never touched beyond step 0's resolution.
4. **Cap gate** (runs only on the live path, after step 3): if `ctx.userId` is non-null and that user is not an admin, counts their non-dry-run `llm_call_log` rows in the trailing 60 minutes. At or over `maxLlmCallsPerUserPerHour` → returns `{ ok: false, reason: 'llm_cap_reached', limit, windowSeconds, retryAfterSeconds }` **with no log row written**. Admin users and `ctx.userId: null` (scripts/tests) skip this gate entirely.
5. **Live path**: calls the provider, writes a log row (including `provider: provider.id`, `userId` from ctx, and `sharedWithAdmin` from `getUserPolicy(userId).shareLogsWithAdmin` — snapshotted at write time, never updated), returns `{ ok: true, response, logId }` on success or re-throws the original error unchanged on failure.

**`LlmCallContext`** (Plan 05 additions, exact shape in `gateway.ts`) carries `kind`, `agentId`/`agentLabel`, `userId` (from the session — never the request body), and `forceDryRun`.

`forceDryRun` can only cause *less* spending. There is no field that can cause a real API call that would not otherwise have happened. It is set at the route layer from an explicit `{ dryRun: true }` body field and flows into step 3 unchanged.

**`LlmGatewayResult`** (three variants after Plan 05, exact shape in `gateway.ts`): a success arm, a `dry_run_blocked` arm, and an `llm_cap_reached` arm carrying `limit`/`windowSeconds`/`retryAfterSeconds`.

Key exports:
- `createGateway(provider)` — testable seam; used in `gateway.test.ts` and `gateway-cap.test.ts`.
- `getGateway()` — lazy singleton used by all production callers.
- `LlmDryRunBlockedError` — thrown by callers when `reason === 'dry_run_blocked'`. Routes catch this and return `409 { error: 'llm_dry_run', dryRun: true, kind, model, logId }`.
- `LlmUserCapReachedError` — thrown by callers when `reason === 'llm_cap_reached'`. Routes catch this **first** (before `LlmDryRunBlockedError`) and return `429 { error: 'llm_cap_reached', limit, windowSeconds, retryAfterSeconds, canDryRun: true }` + `Retry-After` header.

**Dry-run is a hard stop** — no synthetic response, no network traffic, no partial degradation. The blocked result is structurally distinct from a success; accessing `.response` on the blocked arm is a compile error.

**Log-write failures** on the live path are swallowed (the response is already there; discarding it for a logging failure is strictly worse). On the dry-run path, a failed log write still blocks the call (`logId: null`).

**Cap-blocked calls write no log row.** The log table is the counter; letting denials append to it would inflate the count that produced them and push `retryAfterSeconds` forward on every retry. Cap events are `console.info`'d instead: `[llm-gateway] cap reached — user=<id> count=<n> limit=<n>`.

**Consent snapshot** — the gateway reads `getUserPolicy(userId)` (a narrow `{ role, shareLogsWithAdmin }` read from `users.ts`) and writes `sharedWithAdmin` onto the log row at call time. This is the only moment the value is ever written. Pre-auth rows (`userId: null`) and cap-blocked calls both skip this; the column defaults to `false`, and the redaction rule keys off `userId IS NULL` specifically to avoid hiding the admin's own pre-auth history.

## The providers (`provider.ts`, `anthropicProvider.ts`, `openaiCompatibleProvider.ts`)

`provider.ts` defines the `LLMProvider` interface, provider-agnostic types (`LlmRequest`, `LlmResponse`, `LlmMessage`, etc.), and the shared `LlmProviderResponseError` class. The error class lives here (not in a specific provider file) so both implementations can import it without either one importing the other.

`anthropicProvider.ts` is the Anthropic implementation. It:
- Is the **sole** `@anthropic-ai/sdk` importer in the entire codebase (enforced by the architecture fitness function — see "Per-provider transport isolation" above).
- Holds a module-private lazy `Anthropic` singleton (moved verbatim from the deleted `client.ts`).
- Reads `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` from `lib/env.ts`.
- Maps `stop_reason` → `LlmStopReason`; maps usage fields.
- Exposes `complete()` (non-streaming) and `stream()` (awaits `finalMessage()`).

`openaiCompatibleProvider.ts` is the second implementation (Plan 11). It:
- Uses plain `fetch` with no new npm dependency — a vendor swap is three env vars, not a code change.
- Is the **sole** file permitted to construct requests against the chat-completions path (enforced by the architecture fitness function). `OPENAI_COMPATIBLE_BASE_URL` is expected to already carry the vendor's own `/v1` segment (matching real vendor convention — NVIDIA/OpenAI/Groq all document `base_url` ending in `/v1`); this file appends `/chat/completions` only, never `/v1/chat/completions` (a real double-`/v1` bug, found and fixed 2026-08-20 against a live NVIDIA NIM call).
- Places `system` as `messages[0]` with `role:'system'` (the OpenAI wire format, as opposed to Anthropic's top-level param).
- Maps stop reasons: `stop`→`end_turn`, `length`→`max_tokens` (the critical mapping — without it Daedalus's truncation guard stops firing), `tool_calls`→`tool_use`, anything else→`other`.
- Clamps `maxTokens` to `MAX_OUTPUT_TOKENS` (4096) to avoid hard 400s when Daedalus requests 32k from a model with a lower ceiling. Truncation surfaces through the existing `stopReason:'max_tokens'` path rather than as an opaque HTTP error.
- Implements `stream()` with real SSE accumulation (the streaming transport avoids proxy/idle timeouts on large responses).
- Forwards the request's `signal` so a cancelled chat still cancels the upstream call.
- Reads `OPENAI_COMPATIBLE_API_KEY` / `OPENAI_COMPATIBLE_BASE_URL` / `OPENAI_COMPATIBLE_MODEL` from `lib/env.ts`. Default model: `nvidia/llama-3.1-nemotron-70b-instruct`.
- Never includes request headers in error messages (constraint 7 — credentials must never reach any log line).

`stream()` on both providers returns a fully-accumulated `LlmResponse` — the same shape as `complete()`. The streaming *transport* is preserved, but no delta-by-delta consumer is exposed here yet (deferred — FUTURE, "Incremental streaming").

## Provider selection (`providerRegistry.ts`)

`providerRegistry.ts` is the only file that knows both providers exist. It exposes:
- `isProviderConfigured(id)` — checks the required env vars without instantiating anything. Used by the PATCH `/api/settings` route to reject selecting an unconfigured provider (Plan 11 D3: an unconfigured provider must fail loudly, not silently auto-select a different vendor based on which env var happens to be set).
- `getProviderById(id)` — lazy per-id instance cache. Two calls with the same id return the same object (connection pooling preserved).
- `resolveActiveProvider()` — reads the `'llmProvider'` setting from the DB fresh on every call via `getActiveProviderId()` (from `lib/settings.ts`), then delegates to `getProviderById`. This is the resolver passed to `createGateway()` in `getGateway()`. Because `getGateway()` passes the function reference (not a call result), the gateway calls `resolveActiveProvider()` on every AI invocation — a setting change takes effect on the very next call with no restart.

**Fail-safe chain (Plan 11 D3):**
- An absent `llmProvider` DB row → `getActiveProviderId()` returns `'anthropic'` (fail-safe default).
- An unknown/corrupt stored value → `getActiveProviderId()` returns `'anthropic'` + `console.warn`.
- A configured but env-var-less provider cannot be stored in the first place — the PATCH route rejects it with `400 provider_not_configured`. If env vars are removed after the setting was stored, the NEXT *live* AI call throws a clear error — but only when the provider's own `complete()`/`stream()` actually needs the key (`getAnthropicApiKey()` / `getOpenAICompatibleApiKey()`), not at resolution time. `getProviderById()` itself deliberately does not check `isProviderConfigured()` (fixed 2026-08-18) — constructing a provider object or reading its `defaultModel()` needs no credential, and an eager throw there ran on every call including dry-run (gateway.ts resolves the provider before its dry-run gate, to log the model that would have been used), which broke the Plan 04-documented no-API-key dry-run deployment mode. The live-path throw is caught by `gateway.ts`'s existing try/catch, which logs it properly before re-throwing.

## Callers — shape (§3.6, normative; updated Plan 05 §3.9)

All three callers follow the same pattern so neither policy refusal is swallowed by their catch-all:

```ts
let res: LlmGatewayResult;
try {
  res = await getGateway().complete(req, ctx);
} catch (err) {
  if (err instanceof LlmDryRunBlockedError) throw err; // belt-and-braces
  if (err instanceof LlmUserCapReachedError) throw err; // belt-and-braces
  // existing mapping: AbortError re-thrown, everything else → XUpstreamError
}
if (!res.ok) {
  if (res.reason === 'llm_cap_reached') throw new LlmUserCapReachedError(res);
  throw new LlmDryRunBlockedError(res.logId, ctx.kind, res.model);
}
// existing domain logic on res.response.text
```

The `llm_cap_reached` branch is checked first because it is a different refusal from a different source; conflating it with dry-run would send `409` when `429` is correct.

## System agents: the source of truth

MyAgentStudio uses three platform agents — Hermes (Strict Import), Daedalus (Structural Import),
and Prometheus (chat). Their actual rule-sets live in `lib/ai/prompts/system-agents/` —
source `.md` files, not documentation (moved out of `architecture/` 2026-07-29 for exactly
this reason: this content is compiled into the running app, so it sits next to the generated
output it produces, not in a folder meant for passive reference material). Each is written
in **real-agent shape**: YAML frontmatter (`name`, `description`, `tools: []`) followed by
`#`-level body sections (`ROLE`, `BEHAVIOR`, `GUARDRAILS`, `OUTPUT FORMAT`, plus `INPUT` for
Daedalus) — the same split as a real Claude Code subagent file
(`reference/Agent-Full-Reference.md`). `build-prompts.ts` strips the frontmatter block and
compiles the body verbatim as the prompt.

```
lib/ai/prompts/system-agents/hermes.md      ← Strict Import prompt
lib/ai/prompts/system-agents/daedalus.md    ← Structural Import prompt
lib/ai/prompts/system-agents/prometheus.md  ← Chat prompt
```

**These files are the one and only place those rules are ever reviewed or edited.** Never edit the generated files under `lib/ai/prompts/generated/` — they are regenerated on every `npm run dev` / `npm run build` and are gitignored.

## Build-time compilation

`scripts/build-prompts.ts` runs as a `predev` / `prebuild` npm hook. It reads each `lib/ai/prompts/system-agents/*.md` file and writes the content as a TypeScript string constant. For a file with a leading `---` frontmatter block, everything after the closing `---` is used verbatim; otherwise (no source file currently uses this) it falls back to stripping everything before the first `##` heading.

```
lib/ai/prompts/system-agents/hermes.md
  → lib/ai/prompts/generated/hermes.ts
     exports: HERMES_PROMPT

lib/ai/prompts/system-agents/daedalus.md
  → lib/ai/prompts/generated/daedalus.ts
     exports: DAEDALUS_PROMPT

lib/ai/prompts/system-agents/prometheus.md
  → lib/ai/prompts/generated/prometheus.ts
     exports: PROMETHEUS_PROMPT
```

The running server never reads the source `.md` files at runtime — only the compiled output.

**To change a prompt:** edit the relevant `lib/ai/prompts/system-agents/*.md` file and restart the dev server.

## hermes.ts — Strict Import caller

Sends each Stage-1 block's `blockId` and `heading` text (never the body content) to Claude via `getGateway().complete(req, { kind: 'import-strict' })`. Parses and validates the returned JSON label map (`callHermes()`, throws `HermesUpstreamError` / `HermesInvalidResponseError`). The AI only ever supplies labels; content bytes come from Stage-1 blocks.

## daedalus.ts — Structural Import caller

Sends the agent's **full raw markdown text** plus the Blueprint to Claude via `getGateway().stream(req, { kind: 'import-structural' })`. Returns the entire restructured agent body as one markdown string (`callDaedalus()`). Checks `stopReason === 'max_tokens'` (domain rule, stays in this caller) and throws `DaedalusTruncatedError` if the response was truncated.

## prometheus.ts — Chat caller

Sends the agent's name, description, sections (full or cited), and config values (full or cited) to Claude via `getGateway().complete(req, { kind: 'chat' })` and returns a `PrometheusProposal` (`{ message, modifications, warnings }`) via `callPrometheus()`. Forwards `request.signal` through `LlmRequest.signal` for cancellation support.

Key behaviors: agent-wide or cited scope, no tools, split-level heading demotion applied at propose time, the out-of-scope filter runs inside `parsePrometheusResponse()` (exported for unit tests). **Truncation** (2026-08-12, found live): `callPrometheus()` checks `stopReason === 'max_tokens'` right after the gateway call and throws `PrometheusTruncatedError` (→ `422 chat_truncated`) before `responseText` ever reaches the parser — the same domain rule `daedalus.ts` already enforces for imports, previously missing here. The request's `maxTokens` is now the admin-configurable `chatMaxTokens` setting (`lib/settings.ts`, `getChatMaxTokens()` — default 8192, live value raised to 30000 the same session at the user's request) instead of a hardcoded literal, so a recurring truncation can be raised without a code change. **Non-JSON fallback** (2026-08-12, found live): if none of `parsePrometheusResponse()`'s three JSON-extraction attempts find a parseable object (e.g. an advisory/opinion reply in plain prose with no envelope at all), it no longer throws `PrometheusInvalidResponseError` — it returns a fallback proposal with the raw text as `message`, `modifications: {}`, and a warning, so an already-paid-for answer is never silently discarded as an opaque `ai_upstream` 502. Only a response that parses to the wrong root shape (array/string/null) still throws as a hard failure. **Near-miss JSON repair + recovery warning** (issue #12, 2026-08-28, found live: a stray backslash in a Prometheus reply — e.g. an unescaped Windows path or regex fragment — made all three extraction attempts fail, dumping the raw JSON envelope into the chat bubble as if it were the answer): `repairNearMissJson()` runs once, upfront, before the three extraction attempts — a pure, deterministic pass (no text-pattern/keyword matching, same style as `isDrasticShrink()`) that walks the text tracking JSON-string boundaries and fixes, only inside strings, invalid backslash escapes (escaped to a literal `\\`) and raw control characters (replaced with their proper JSON escape). No-op on already-valid JSON, so it's always safe to run unconditionally. Whenever the response needed anything past a clean first-try parse — repair, code-fence stripping, or the greedy slice — `parsePrometheusResponse()` now pushes a recovery warning, previously only surfaced for the full raw-dump fallback. **`ChatPanel.tsx` renders that warning inline under the message bubble** for a modifications-less turn specifically — today's proposal card already renders `warnings` for any turn WITH modifications, but a modifications-less turn (`modifications: {}`, e.g. exactly this fallback case) never gets a card at all, so its warnings were silently dropped before this fix; `ChatMessage.warnings` is only ever set in that complementary case to avoid double-rendering. **Drastic-shrink guard** (2026-08-20, found live against the NVIDIA provider): `parsePrometheusResponse()` takes an optional 5th arg, `currentSections`, and for each proposed section that already existed, warns (never drops) when the new content is under 30% of the old content's length and the old content was non-trivial (`isDrasticShrink()`, thresholds as named constants). Deliberately a pure character-count comparison, no text-pattern/keyword matching — this app's own agents are themselves about agents, so real content can legitimately contain any phrasing a keyword heuristic might flag, and a small model (`meta/llama-3.1-8b-instruct` via NVIDIA NIM) was observed live truncating a ~5,000-character section to a 127-character placeholder stub, which this check exists to catch before Apply. `callPrometheus()` passes `input.sections` as that 5th arg; the parameter is optional and appended last so it's a no-op, backward-compatible addition. **Conversation history**: the client sends prior turns (`{ role, message }[]`) from the session's real dialogue (client-side notices like dry-run/error/cancelled are excluded); `callPrometheus` caps how many are actually used to `settings.chatHistoryTurns` (admin-configurable, default 10) and prepends them to the Anthropic `messages` array as alternating `user`/`assistant` entries — only the `message` text, never the `modifications` JSON, since current section/config content always comes fresh from the per-call agent load, not from history. **`POST /api/chat` performs zero writes** (Plan 08 Phase 1, built and verified 2026-08-06) — `modifications` (`description`/`sections`/`config`) is computed and returned, never written by this route. The only writer is `POST /api/agents/[id]/apply-proposal`, which merges `config` onto the agent's current full config set (a partial edit never wipes untouched keys), writes existing sections via `updateSectionContent`, writes a `sectionKey` with no existing match via `addSection()` instead of silently skipping it (2026-08-11, closes roadmap TODO item 1's add half) — deriving the new section's heading server-side (`deriveHeadingForNewSection()`, prefers a catalog match, else formats the key) since the `sections` contract carries content only — and, 2026-08-12, closes roadmap TODO item 1's remaining half: a `sectionKey` mapped to `null` deletes the matching section via `deleteSection()`, mirroring `config`'s existing null-to-delete convention (`PrometheusModifications.sections` is `Record<string, string | null>`); a `null` for a `sectionKey` that doesn't exist on the agent is a no-op, recorded in the response's `skipped[]`, not an error. Chat-driven section add/edit/delete are all implemented now. See `plans/archive/07-prometheus-propose-apply.md` for the rename + output-contract design (Phases 0–2), and `plans/archive/08-prometheus-apply.md` for the propose/apply split, config-merge fix, client `'proposal'` lock, and ChatPanel UI (Phases 0–3, 5 built and verified; Phase 4's live-LLM verification is deferred — folded into `plans/roadmap.md`'s pre-deploy "big flow test" TODO item).

## Files in this folder

| File | Role |
|---|---|
| `provider.ts` | `LLMProvider` interface + provider-agnostic types + shared `LlmProviderResponseError` |
| `anthropicProvider.ts` | The ONLY `@anthropic-ai/sdk` importer. Lazy singleton, `complete()`, `stream()`. |
| `openaiCompatibleProvider.ts` | OpenAI-compatible `fetch`-based provider (`/chat/completions`, appended to a `/v1`-carrying base URL). Zero new deps. |
| `providerRegistry.ts` | The ONLY file that knows both providers. Lazy per-id cache, `resolveActiveProvider()`. |
| `gateway.ts` | Gate check, audit log, `LlmDryRunBlockedError`. The choke point. |
| `hermes.ts` | Strict Import Stage-2 caller (labels-only) |
| `daedalus.ts` | Structural Import Stage-2b caller (full content, streaming transport) |
| `prometheus.ts` | Chat caller (agent-wide or cited scope, proposes — never writes, signal forwarded) |
| `prompts/generated/` | Auto-generated by `scripts/build-prompts.ts` — do not edit |
| `__tests__/gateway.test.ts` | Gateway behaviour cases via fake provider (no SDK); includes provider-column regression coverage |
| `__tests__/gateway-cap.test.ts` | Per-user LLM cap cases: under/at cap, admin exempt, `userId: null` skips, dry-run rows don't count, rolling-window boundary cases, `retryAfterSeconds` derivation, `forceDryRun` with live calls on |
| `__tests__/architecture.test.ts` | Fitness function: per-provider transport isolation (table-driven); DB-import boundary |
| `__tests__/openaiCompatibleProvider.test.ts` | OpenAI-compatible provider unit tests against mocked `fetch` |
| `__tests__/providerRegistry.test.ts` | Registry: selection, fail-safe, instance caching, live setting change |
| `__tests__/prometheus.test.ts` | Chat caller: proposal parsing (incl. non-JSON fallback, truncation), scope, null-to-delete for sections/config |
