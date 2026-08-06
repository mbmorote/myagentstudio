# lib/ai — AI Callers, Gateway, and System Agents

This folder contains the single gateway through which every AI call in the app passes, the three AI callers, the Anthropic provider implementation, and the build-time prompt compilation output.

## Architecture (Plan 04)

```
route (app/api/…)
  └─ caller (hermes.ts, daedalus.ts, prometheus.ts)
        ← knows the domain (prompts, JSON parsing, stop_reason rules, demotion)
        └─ gateway (gateway.ts)
              ← the single choke point. Gate check + audit log. The ONLY lib/ai file
                 allowed to import from lib/db.
              └─ provider (anthropicProvider.ts)
                    ← transport only. Never sees `kind`, agentId, or lib/db.
                    └─ @anthropic-ai/sdk
```

**One-SDK-importer rule (§1 constraint 1, Rules Index #41):** exactly one file in the entire codebase may import `@anthropic-ai/sdk` — `lib/ai/anthropicProvider.ts`. This is enforced by a fitness-function test (`lib/ai/__tests__/architecture.test.ts`) that scans every `.ts`/`.tsx` source file and asserts the import appears in exactly that one file. `client.ts` was deleted when Plan 04 landed.

## The gateway (`gateway.ts`)

The gateway is the single point through which every AI call attempt flows, live or dry-run. It:

1. Resolves the model (`req.model ?? provider.defaultModel()`).
2. Reads `liveLlmCalls` from the DB **fresh on every call** (no cache — §6).
3. **Dry-run path** (setting is off **or** `ctx.forceDryRun` is true): writes a log row (`dryRun: true`, `responsePayload: null`), returns `{ ok: false, reason: 'dry_run_blocked', model, logId }`. The provider is never touched.
4. **Cap gate** (Plan 05 §3.9 — runs only on the live path, after step 3): if `ctx.userId` is non-null and that user is not an admin, counts their non-dry-run `llm_call_log` rows in the trailing 60 minutes. At or over `maxLlmCallsPerUserPerHour` → returns `{ ok: false, reason: 'llm_cap_reached', limit, windowSeconds, retryAfterSeconds }` **with no log row written**. Admin users and `ctx.userId: null` (scripts/tests) skip this gate entirely.
5. **Live path**: calls the provider, writes a log row (including `userId` from ctx and `sharedWithAdmin` from `getUserPolicy(userId).shareLogsWithAdmin` — snapshotted at write time, never updated), returns `{ ok: true, response, logId }` on success or re-throws the original error unchanged on failure.

**`LlmCallContext`** (Plan 05 additions):

```ts
export type LlmCallContext = {
  kind: LlmCallKind;
  agentId?: string | null;
  agentLabel?: string | null;
  userId?: string | null;      // from the session — never from the request body
  forceDryRun?: boolean;       // from the request body — may only DOWNGRADE a live call
};
```

`forceDryRun` can only cause *less* spending. There is no field that can cause a real API call that would not otherwise have happened (Rules Index #61). It is set at the route layer from an explicit `{ dryRun: true }` body field and flows into step 3 unchanged.

**`LlmGatewayResult`** (three variants after Plan 05):

```ts
| { ok: true;  response: LlmResponse; logId: string | null }
| { ok: false; reason: 'dry_run_blocked'; model: string; logId: string | null }
| { ok: false; reason: 'llm_cap_reached'; model: string; logId: null;
    limit: number; windowSeconds: number; retryAfterSeconds: number }
```

Key exports:
- `createGateway(provider)` — testable seam; used in `gateway.test.ts` and `gateway-cap.test.ts`.
- `getGateway()` — lazy singleton used by all production callers.
- `LlmDryRunBlockedError` — thrown by callers when `reason === 'dry_run_blocked'`. Routes catch this and return `409 { error: 'llm_dry_run', dryRun: true, kind, model, logId }`.
- `LlmUserCapReachedError` — thrown by callers when `reason === 'llm_cap_reached'`. Routes catch this **first** (before `LlmDryRunBlockedError`) and return `429 { error: 'llm_cap_reached', limit, windowSeconds, retryAfterSeconds, canDryRun: true }` + `Retry-After` header.

**Dry-run is a hard stop** — no synthetic response, no network traffic, no partial degradation. The blocked result is structurally distinct from a success; accessing `.response` on the blocked arm is a compile error.

**Log-write failures** on the live path are swallowed (the response is already there; discarding it for a logging failure is strictly worse). On the dry-run path, a failed log write still blocks the call (`logId: null`).

**Cap-blocked calls write no log row** (Rules Index #60). The log table is the counter; letting denials append to it would inflate the count that produced them and push `retryAfterSeconds` forward on every retry. Cap events are `console.info`'d instead: `[llm-gateway] cap reached — user=<id> count=<n> limit=<n>`.

**Consent snapshot** — the gateway reads `getUserPolicy(userId)` (a narrow `{ role, shareLogsWithAdmin }` read from `users.ts`) and writes `sharedWithAdmin` onto the log row at call time. This is the only moment the value is ever written. Pre-auth rows (`userId: null`) and cap-blocked calls both skip this; the column defaults to `false`, and the redaction rule (Rules Index #59) keys off `userId IS NULL` specifically to avoid hiding the admin's own pre-auth history.

## The provider (`provider.ts`, `anthropicProvider.ts`)

`provider.ts` defines the `LLMProvider` interface and provider-agnostic types (`LlmRequest`, `LlmResponse`, `LlmMessage`, etc.). No implementation, no imports beyond types.

`anthropicProvider.ts` is the only implementation. It:
- Holds a module-private lazy `Anthropic` singleton (moved verbatim from the deleted `client.ts`).
- Reads `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` from `lib/env.ts` (unchanged).
- Maps `stop_reason` → `LlmStopReason`; maps usage fields.
- Exposes `complete()` (non-streaming) and `stream()` (awaits `finalMessage()`).

`stream()` returns a fully-accumulated `LlmResponse` — the same shape as `complete()`. The streaming *transport* is preserved (the SDK still uses its streaming path for large responses), but no delta-by-delta consumer is exposed here yet (deferred, see `TechDesign.md` Deferred Decisions).

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

MyAgent uses three platform agents — Hermes (Strict Import), Daedalus (Structural Import),
and Prometheus (chat). Their actual rule-sets live in `lib/ai/prompts/system-agents/` —
source `.md` files, not documentation (moved out of `architecture/` 2026-07-29 for exactly
this reason: this content is compiled into the running app, so it sits next to the generated
output it produces, not in a folder meant for passive reference material). Each is written
in **real-agent shape**: YAML frontmatter (`name`, `description`, `tools: []`) followed by
`#`-level body sections (`ROLE`, `BEHAVIOR`, `GUARDRAILS`, `OUTPUT FORMAT`, plus `INPUT` for
Daedalus) — the same split as a real Claude Code subagent file
(`architecture/Agent-Full-Reference.md`). `build-prompts.ts` strips the frontmatter block and
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

Sends the agent's name, description, sections (full or cited), and config values (full or cited) to Claude via `getGateway().complete(req, { kind: 'chat' })` and returns a `PrometheusProposal` (`{ message, modifications, warnings }`) via `callPrometheus()`. Forwards `request.signal` through `LlmRequest.signal` for cancellation support (Rules Index #23).

Key behaviors: agent-wide or cited scope, no tools, split-level heading demotion applied at propose time, the out-of-scope filter runs inside `parsePrometheusResponse()` (exported for unit tests). `POST /api/chat` performs zero writes — see `plans/07-prometheus-propose-apply.md` for the full output-contract and propose-then-apply design (Phases 0–2 built; the apply endpoint and lock are a future plan).

## Files in this folder

| File | Role |
|---|---|
| `provider.ts` | `LLMProvider` interface + provider-agnostic types (`LlmRequest`, `LlmResponse`, etc.) |
| `anthropicProvider.ts` | The ONLY `@anthropic-ai/sdk` importer. Lazy singleton, `complete()`, `stream()`. |
| `gateway.ts` | Gate check, audit log, `LlmDryRunBlockedError`. The choke point. |
| `hermes.ts` | Strict Import Stage-2 caller (labels-only) |
| `daedalus.ts` | Structural Import Stage-2b caller (full content, streaming transport) |
| `prometheus.ts` | Chat caller (agent-wide or cited scope, proposes — never writes, signal forwarded) |
| `prompts/generated/` | Auto-generated by `scripts/build-prompts.ts` — do not edit |
| `__tests__/gateway.test.ts` | Existing gateway behaviour cases via fake provider (no SDK) — **unmodified by Plan 05** (§10.6) |
| `__tests__/gateway-cap.test.ts` | Per-user LLM cap cases: under/at cap, admin exempt, `userId: null` skips, dry-run rows don't count, rolling-window boundary cases, `retryAfterSeconds` derivation, `forceDryRun` with live calls on |
| `__tests__/architecture.test.ts` | Fitness function: one SDK importer only |
