# lib/ai — AI Callers, Gateway, and System Agents

This folder contains the single gateway through which every AI call in the app passes, the three AI callers, the Anthropic provider implementation, and the build-time prompt compilation output.

## Architecture (Plan 04)

```
route (app/api/…)
  └─ caller (importConverter.ts, structuralConverter.ts, chatMediator.ts)
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
3. **Dry-run path** (setting is off): writes a log row (`dryRun: true`, `responsePayload: null`), returns `{ ok: false, reason: 'dry_run_blocked', model, logId }`. The provider is never touched.
4. **Live path**: calls the provider, writes a log row, returns `{ ok: true, response, logId }` on success or re-throws the original error unchanged on failure.

Key exports:
- `createGateway(provider)` — testable seam; used in `gateway.test.ts`.
- `getGateway()` — lazy singleton used by all production callers.
- `LlmDryRunBlockedError` — thrown by callers when the gateway returns `ok: false`. Routes catch this first and return `409 { error: 'llm_dry_run', dryRun: true, kind, model, logId }`.

**Dry-run is a hard stop** — no synthetic response, no network traffic, no partial degradation. The blocked result is structurally distinct from a success; accessing `.response` on the blocked arm is a compile error.

**Log-write failures** on the live path are swallowed (the response is already there; discarding it for a logging failure is strictly worse). On the dry-run path, a failed log write still blocks the call (`logId: null`).

## The provider (`provider.ts`, `anthropicProvider.ts`)

`provider.ts` defines the `LLMProvider` interface and provider-agnostic types (`LlmRequest`, `LlmResponse`, `LlmMessage`, etc.). No implementation, no imports beyond types.

`anthropicProvider.ts` is the only implementation. It:
- Holds a module-private lazy `Anthropic` singleton (moved verbatim from the deleted `client.ts`).
- Reads `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` from `lib/env.ts` (unchanged).
- Maps `stop_reason` → `LlmStopReason`; maps usage fields.
- Exposes `complete()` (non-streaming) and `stream()` (awaits `finalMessage()`).

`stream()` returns a fully-accumulated `LlmResponse` — the same shape as `complete()`. The streaming *transport* is preserved (the SDK still uses its streaming path for large responses), but no delta-by-delta consumer is exposed here yet (deferred, see `TechDesign.md` Deferred Decisions).

## Callers — shape (§3.6, normative)

All three callers follow the same pattern so the dry-run check is never swallowed by their catch-all:

```ts
let res: LlmGatewayResult;
try {
  res = await getGateway().complete(req, ctx);
} catch (err) {
  if (err instanceof LlmDryRunBlockedError) throw err; // belt-and-braces
  // existing mapping: AbortError re-thrown, everything else → XUpstreamError
}
if (!res.ok) throw new LlmDryRunBlockedError(res.logId, ctx.kind, res.model);
// existing domain logic on res.response.text
```

## System agents: the source of truth

MyAgent uses two system agents — the import converter and the chat mediator. Their actual
rule-sets (Role, Behavior, Guardrails, Output) live in `lib/ai/prompts/system-agents/` —
source `.md` files, not documentation (moved out of `architecture/` 2026-07-29 for exactly
this reason: this content is compiled into the running app, so it sits next to the generated
output it produces, not in a folder meant for passive reference material):

```
lib/ai/prompts/system-agents/import-instructions.md          ← Strict Import prompt
lib/ai/prompts/system-agents/import-instructions-structural.md  ← Structural Import prompt
lib/ai/prompts/system-agents/chat-mediator.md                ← Chat mediator prompt
```

**These files are the one and only place those rules are ever reviewed or edited.** Never edit the generated files under `lib/ai/prompts/generated/` — they are regenerated on every `npm run dev` / `npm run build` and are gitignored.

## Build-time compilation

`scripts/build-prompts.ts` runs as a `predev` / `prebuild` npm hook. It reads each `lib/ai/prompts/system-agents/*.md` file and writes the content as a TypeScript string constant:

```
lib/ai/prompts/system-agents/import-instructions.md
  → lib/ai/prompts/generated/import-instructions.ts
     exports: IMPORT_CONVERTER_PROMPT

lib/ai/prompts/system-agents/import-instructions-structural.md
  → lib/ai/prompts/generated/import-instructions-structural.ts
     exports: STRUCTURAL_IMPORT_PROMPT

lib/ai/prompts/system-agents/chat-mediator.md
  → lib/ai/prompts/generated/chat-mediator.ts
     exports: CHAT_MEDIATOR_PROMPT
```

The running server never reads the source `.md` files at runtime — only the compiled output.

**To change a prompt:** edit the relevant `lib/ai/prompts/system-agents/*.md` file and restart the dev server.

## importConverter.ts — Strict Import caller

Sends each Stage-1 block's `blockId` and `heading` text (never the body content) to Claude via `getGateway().complete(req, { kind: 'import-strict' })`. Parses and validates the returned JSON label map. The AI only ever supplies labels; content bytes come from Stage-1 blocks.

## structuralConverter.ts — Structural Import caller

Sends the agent's **full raw markdown text** plus the Blueprint to Claude via `getGateway().stream(req, { kind: 'import-structural' })`. Returns the entire restructured agent body as one markdown string. Checks `stopReason === 'max_tokens'` (domain rule, stays in this caller) and throws `StructuralConverterTruncatedError` if the response was truncated.

## chatMediator.ts — Chat mediator caller

Sends the **full current content of every section** to Claude via `getGateway().complete(req, { kind: 'chat' })`. Forwards `request.signal` through `LlmRequest.signal` for cancellation support (Rules Index #23).

Key behaviors: agent-wide scope, no tools, split-level heading demotion, optimistic concurrency per section — all unchanged from before Plan 04. See the previous section-level detail for each; only the transport layer changed.

## Files in this folder

| File | Role |
|---|---|
| `provider.ts` | `LLMProvider` interface + provider-agnostic types (`LlmRequest`, `LlmResponse`, etc.) |
| `anthropicProvider.ts` | The ONLY `@anthropic-ai/sdk` importer. Lazy singleton, `complete()`, `stream()`. |
| `gateway.ts` | Gate check, audit log, `LlmDryRunBlockedError`. The choke point. |
| `importConverter.ts` | Strict Import Stage-2 caller (labels-only) |
| `structuralConverter.ts` | Structural Import Stage-2b caller (full content, streaming transport) |
| `chatMediator.ts` | Chat mediator caller (agent-wide, all sections, signal forwarded) |
| `prompts/generated/` | Auto-generated by `scripts/build-prompts.ts` — do not edit |
| `__tests__/gateway.test.ts` | 12 gateway behaviour cases via fake provider (no SDK) |
| `__tests__/architecture.test.ts` | Fitness function: one SDK importer only |
