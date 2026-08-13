# Plan 11 — Second LLM Provider

> **Status: ✅ Reviewed and confirmed 2026-08-13 — ready for `@dev`.** See §8 for the
> confirmed answers.
>
> - **D1 (vendor):** Option A confirmed — one OpenAI-compatible provider (`fetch`, no new
>   dependency), **not** vendor-locked in code. **NVIDIA (NIM's OpenAI-compatible endpoint)**
>   is the confirmed target for configuration and §5.5's live verification. File named
>   `lib/ai/openaiCompatibleProvider.ts`, not `nvidiaProvider.ts` — the implementation stays
>   generic per the recommendation; NVIDIA is the base URL it's pointed at, not the file's
>   identity. Flag if you actually want it named/scoped to NVIDIA specifically instead.
> - **D2 (admin-only vs. user-selectable):** admin-only confirmed, exactly like `chatMaxTokens`.
> - **D3 (defaults/fresh-install):** all three sub-points confirmed as recommended —
>   per-provider env vars/model, `'anthropic'` fail-safe default, and an unconfigured
>   provider is hard-rejected (`400 provider_not_configured`), not silently allowed.
>
> **Scale note:** this is a vendor swap behind an interface that already exists, not a new
> subsystem. Plan 04 built the gateway from nothing and is ten times this length for that
> reason; this file is deliberately short.
>
> Standing project rules apply in full: **no commit without an explicit ask**, **no real
> billed API call without an explicit ask** (§7.3 marks exactly where one would be needed),
> **dev server off after any verification session**, and **ask before running any
> test/build/tsc check** (`CLAUDE.md` standing rules 1, 2, 3, 5).
>
> Closes `plans/roadmap.md` TODO item **Second LLM provider**. `plans/12-ui-batch-launch-polish.md`
> is deliberately independent of this file and can run in parallel.

---

## 1. What this plan is, in one paragraph

`lib/ai/provider.ts` already defines a provider-agnostic `LLMProvider` interface, and
`lib/ai/gateway.ts` already wraps *whatever* provider it is handed with dry-run blocking,
the per-user hourly cap, and `llm_call_log` writes. Only one implementation exists
(`anthropicProvider.ts`), and `getGateway()` hardcodes it. This plan adds a **second
implementation**, a **one-setting selector** for which one is live, and closes two latent
gaps found while auditing (below) — with **no change to chat or import behavior** other
than which vendor answers.

**Two real gaps found in the audit** (not in the original task framing, both must be fixed
here or the second provider ships broken):

1. **`llm_call_log.provider` is never written.** The column exists
   (`lib/db/schema.ts`, `text('provider').notNull().default('anthropic')`) and is selected
   into both log DTOs, but neither `writeCallLog()` nor `reserveCallSlot()` sets it. Today
   that's harmless — everything *is* Anthropic. The moment a second provider exists, every
   row silently claims `'anthropic'`, and the audit log becomes actively wrong. `LLMProvider.id`
   exists precisely for this and is currently referenced by nothing in production code.
2. **The Settings UI cannot render a non-`bool`/non-`int` setting.**
   `app/components/Settings/SettingsView.tsx` branches on `datatype === 'bool'` and
   `datatype === 'int'` only. A `string` setting added to `SETTING_DEFS` today would render
   as a label and hint with **no control at all** — no error, just an unusable row. A
   provider selector needs a third renderer.

---

## 2. Current state (verified by reading the code this session, 2026-08-13)

| Fact | Where | Note |
|---|---|---|
| `LLMProvider` = `{ id, defaultModel(), complete(req), stream(req) }` | `lib/ai/provider.ts` | Already vendor-neutral. `system` is a separate field precisely so an OpenAI-shaped provider can map it to `role:'system'` — that comment is already in the file. |
| `anthropicProvider.ts` is the only implementation and only SDK importer | `lib/ai/anthropicProvider.ts` | Lazy per-process SDK singleton; maps `stop_reason` and usage; throws `LlmProviderResponseError` on a missing text block. |
| The one-SDK-importer rule is test-enforced | `lib/ai/__tests__/architecture.test.ts` | Four assertions: `@anthropic-ai/sdk` importers must equal exactly `['lib/ai/anthropicProvider.ts']`; and `getClient(`, `.messages.create(`, `.messages.stream(` must appear in no other file. Scans `lib/`, `app/`, `scripts/`, skipping `node_modules`, `.next`, `generated`, `__tests__`. |
| `getGateway()` hardcodes the provider | `lib/ai/gateway.ts:330` | `_gateway = createGateway(createAnthropicProvider())` — a lazy module-level singleton, built once per process. |
| `createGateway(provider)` is the test seam | `gateway.test.ts`, `gateway-cap.test.ts` | ~20 call sites pass a fake provider object. **This signature must keep working unchanged.** |
| Four route suites mock the provider *module* | `chat-dryrun.test.ts`, `import-dryrun.test.ts`, `import-structural-truncation.test.ts`, `tenancy.test.ts` | They `vi.mock('lib/ai/anthropicProvider.js')` and run the real gateway + real caller + real route. They also each re-declare `LlmProviderResponseError` in the mock factory. |
| Callers are provider-blind | `hermes.ts`, `daedalus.ts`, `prometheus.ts` | None import a provider. Hermes `maxTokens: 4096`, Daedalus `maxTokens: 32000`, Prometheus `maxTokens: getChatMaxTokens()` (default 8192, live value 30000). |
| Settings are a generic, end-to-end catalog | `lib/settings.ts`, `app/api/settings/route.ts` | `SETTING_DEFS` drives storage parsing, the PATCH allowlist, and the UI. `PATCH` already validates `string` datatype (accepts any string). Fail-safe pattern: row absent → def default; unparseable → safest value + `console.warn`. |
| Settings read fresh on every call, never cached | Plan 04 guiding constraint 6 | `getLiveLlmCalls()` does a fresh `SELECT` per call, by design — a cached toggle "appears unreliable". Provider selection must follow the same rule. |
| Model comes from env, per vendor | `lib/env.ts` | `getAnthropicModel()` → `ANTHROPIC_MODEL ?? 'claude-opus-4-8'`. `assertServerEnv()` deliberately does **not** require `ANTHROPIC_API_KEY` at boot (dry-run deployments are legitimate). |
| Activity log shows Model but not Provider | `SettingsView.tsx` (Timestamp/Kind/Agent/Status/Model/Duration) | The DTO already carries `provider`; nothing renders it. |

---

## 3. Guiding constraints (locked — do not replan during build)

1. **The choke point stays single.** Every call still goes `caller → gateway → provider`.
   Nothing new may call a provider directly, and no provider may import from `lib/db/`.
2. **Per-provider SDK isolation.** Each provider file is the *only* file allowed to import
   its own transport dependency. The fitness function generalizes from "one importer" to
   "one importer **per package**" — a table, not a second hardcoded exception (§5.5).
3. **Dry-run, cap, and logging behave identically per provider.** No provider-specific
   branch may appear in `gateway.ts` beyond *which* provider object is used.
4. **Provider selection is resolved fresh per call**, like every other setting (constraint
   above). The provider *instance* stays cached per id so connection pooling is unchanged.
5. **Default is Anthropic.** An existing install that never touches the new setting behaves
   byte-for-byte as it does today. Same principle as Plan 04's "default is on".
6. **No user-visible feature surface.** Chat and import UI, request/response shapes, error
   codes, and status codes are unchanged. The only new surface is one admin Settings row
   (plus, optionally, a Provider column in the existing Activity log).
7. **No credential ever enters a log row, payload, response body, or console line**
   (Design Principle #8). Includes the new provider's key and any error body that echoes
   an `Authorization` header.
8. **No automatic failover between providers.** One provider is live at a time. A retry on
   another vendor would double-spend and muddy the audit log — explicitly out of scope (§9).

---

## 4. Implementation shape

### 4.1 Files

| File | New/Mod | Role |
|---|---|---|
| `lib/ai/openaiCompatibleProvider.ts` | **new** | The second `LLMProvider` — generic OpenAI-compatible transport, configured (not hardcoded) to point at NVIDIA NIM per D1. `import 'server-only'` at the top. |
| `lib/ai/providerRegistry.ts` | **new** | `PROVIDER_IDS`, `getProviderById(id)` (lazy per-id instance cache), `resolveActiveProvider()` (reads the setting fresh, falls back safely), `isProviderConfigured(id)`. The only file that knows both providers exist. |
| `lib/ai/provider.ts` | mod | Move `LlmProviderResponseError` here from `anthropicProvider.ts` so both providers share one error type (the alternative — provider B importing provider A — would drag the Anthropic SDK into a non-Anthropic call path). Optionally add `readonly label: string` for the Settings dropdown. |
| `lib/ai/gateway.ts` | mod | `createGateway()` accepts `LLMProvider \| (() => LLMProvider)` and normalizes to a resolver internally; `run()` resolves once at the top of each call. Passes `provider: provider.id` into both log-write paths. `getGateway()` builds with `resolveActiveProvider`. |
| `lib/db/repository/llmCallLog.ts` | mod | Add required `provider: string` to `WriteCallLogInput` and `ReserveCallSlotInput`; write it in both inserts. **No migration** — the column already exists with a default. |
| `lib/settings.ts` | mod | New `llmProvider` setting def + `getActiveProviderId()` accessor with the standard fail-safe (row absent → `'anthropic'`; unknown/unparseable value → `'anthropic'` + `console.warn`). Requires an enum-ish datatype (§4.3). |
| `app/api/settings/route.ts` | mod | Validate the new datatype (value must be a member of `options`). Per D3, possibly reject selecting an unconfigured provider. |
| `app/components/Settings/SettingsView.tsx` | mod | Third renderer: a `<select>` for the new datatype. Small; still worth a Layout-Workbench glance per standing rule 4 only if it turns into more than a plain select. |
| `lib/env.ts` | mod | Getters + `isXConfigured()` for the new provider's env vars. Follows the existing `isOAuthConfigured()` / `getAnthropicApiKey()` pattern: throw at call time, never at boot. |
| `lib/ai/__tests__/architecture.test.ts` | mod | Generalize to a package→owner table (§5.5). |
| `lib/ai/__tests__/openaiCompatibleProvider.test.ts` | **new** | Mapping/transport unit tests against a mocked `fetch`. |
| `lib/ai/__tests__/providerRegistry.test.ts` | **new** | Selection, fail-safe, instance caching, live setting change. |
| `.env.example`, `README.md` | mod | Document the new vars, all-or-nothing if applicable. |
| `lib/ai/CLAUDE.md`, `docs/system-about.md` | mod | The architecture diagram gains a second leaf; document selection + fail-safe. Restate rules inline, never cite by number (standing rule 6). |
| `plans/roadmap.md`, `CHANGELOG.md` | mod | Drop the closed TODO item; record what happened. |

### 4.2 Gateway change, precisely

Two edits inside `gateway.ts`, nothing else:

- `createGateway(providerOrResolver: LLMProvider | (() => LLMProvider))` — normalize once:
  a plain object becomes `() => object`. Every existing `createGateway(fakeProvider)` call
  site in the two gateway test suites keeps compiling and passing untouched.
- Inside `run()`, `const provider = resolve()` as the first statement (before model
  resolution, since `defaultModel()` is provider-specific), and add `provider: provider.id`
  to the `writeCallLog(...)` (dry-run path) and `reserveCallSlot(...)` (live path) inputs.

Everything else — order of operations, the dry-run hard stop, the cap gate, the
reserve/finalize race fix, the swallow-log-failures rule — is untouched. That is the whole
point: the second provider inherits all of it by construction.

Note the ordering consequence, deliberate: a dry-run row now records the model *the
currently-selected provider* would have used, which is the accurate thing to log.

### 4.3 The setting

```
key:      'llmProvider'
datatype: 'enum'            (new — or 'string' + an `options` array; see D2/D3 discussion)
options:  ['anthropic', 'openaiCompatible']
default:  'anthropic'
label:    'LLM provider'
hint:     'Which vendor answers every AI call (import and chat). Changing this takes effect
           on the next call — no restart. Each provider reads its own API key and model from
           the server environment.'
```

`SettingDef` gains `options?: readonly string[]`. `parseSettingValue` needs no new branch if
the datatype is `'string'`-backed; membership is enforced in the PATCH validator and again,
fail-safe, in `getActiveProviderId()`.

### 4.4 What the second provider file must handle

Vendor-independent list — each item is a real cross-vendor difference, not boilerplate:

- **System prompt placement** — `LlmRequest.system` becomes `messages[0] = {role:'system'}`
  for an OpenAI-shaped API. Already anticipated in `provider.ts`'s header comment.
- **Stop-reason mapping** → `LlmStopReason`. OpenAI-shaped: `stop`→`end_turn`,
  `length`→`max_tokens`, `tool_calls`→`tool_use`, anything else (`content_filter`, null)
  →`other`. **`max_tokens` must map correctly or Daedalus's and Prometheus's truncation
  guards silently stop firing** — that mapping is the single highest-value line in the file.
- **Usage mapping** — `prompt_tokens`/`completion_tokens` → `inputTokens`/`outputTokens`;
  `null` when the vendor omits usage (the type already allows null).
- **Output-token ceiling.** Daedalus asks for `maxTokens: 32000`. Many non-Anthropic models
  cap output far lower and return a `400` for an over-limit request. The provider should
  clamp to a per-provider `maxOutputTokens` — a transport concern, so it belongs here, not
  in the caller. A clamp that causes truncation surfaces through the existing
  `stopReason === 'max_tokens'` path, which already errors cleanly rather than silently
  losing content.
- **`stream()`** — Daedalus uses it for large responses. Implement real streaming
  accumulation (SSE) and return the same fully-accumulated `LlmResponse`; a 32k-token
  non-streaming request is exactly the shape that hits proxy/idle timeouts.
- **`signal` passthrough** — `fetch(url, { signal })`, so a cancelled chat still cancels
  upstream. `prometheus.ts` depends on this.
- **Errors** — throw on non-2xx with status + a truncated body, and **never** include the
  request headers. Missing/empty content → `LlmProviderResponseError`, same as Anthropic's
  no-text-block case.

---

## 5. Testing approach

### 5.1 Unit — the new provider (mocked transport, zero cost)
- Request shape: system mapped correctly, messages in order, model/max-tokens forwarded, clamp applied.
- Each stop-reason value maps to the right `LlmStopReason`, unknown → `'other'`.
- Usage mapped; usage absent → `null`.
- Empty/missing content → `LlmProviderResponseError`.
- Non-2xx → throws; assert the thrown message contains **no** API key (guard for constraint 7).
- Abort: an aborted signal propagates and the original `AbortError` identity survives
  (the gateway re-throws the original object; `prometheus.ts` and the routes key off it).
- `stream()` accumulates a multi-chunk response into the same shape as `complete()`.

### 5.2 Unit — the registry
- Setting row absent → `'anthropic'`.
- Setting = unknown string → `'anthropic'` + `console.warn` (assert the warn fired).
- Setting = second provider id → that provider.
- Two calls return the **same instance** (connection pooling preserved).
- Changing the setting between two calls switches provider **without a restart** (this is
  the test that proves constraint 4 and that the old `_gateway` singleton isn't stale).

### 5.3 Gateway + routes (in-memory DB, fake providers, zero cost)
- Log rows carry the correct `provider` on both the dry-run and live paths, for both
  providers. **New regression coverage** — the column is currently always `'anthropic'`.
- With the second provider selected and `liveLlmCalls: false`, the call is still a hard
  stop: `409 llm_dry_run`, one log row, provider never invoked. Cheapest possible proof
  that the choke point stayed single.
- Cap gate still returns `429` with the second provider selected.
- The existing `createGateway(fakeProvider)` suites pass unmodified (signature compatibility).
- The four route suites that mock `anthropicProvider.js` pass unmodified — they exercise the
  default path, and the default must not have moved.

### 5.4 Fitness function (`architecture.test.ts`) — generalize, don't special-case
Replace the hardcoded assertion with a table:

| Package / string | Sole permitted file |
|---|---|
| `@anthropic-ai/sdk` | `lib/ai/anthropicProvider.ts` |
| `getClient(`, `.messages.create(`, `.messages.stream(` | `lib/ai/anthropicProvider.ts` |
| the endpoint path literal (e.g. `/chat/completions`) | `lib/ai/openaiCompatibleProvider.ts` |

If the second provider is `fetch`-based there is no package to guard, so guard the **endpoint
path literal** (e.g. `/chat/completions`) instead — the assertion has to bite on something,
or the rule quietly stops being enforced for provider B while still being enforced for A.

**Recommended additional assertion, same pass, cheap:** no file under `lib/ai/` except
`gateway.ts` imports from `lib/db/`. That rule is documented in `lib/ai/CLAUDE.md` and in
Plan 04's constraints but has never been test-enforced — and a second provider is exactly the
moment someone might reach for a setting read inside a provider file.

### 5.5 Live verification — **requires an explicit user go-ahead, do not run automatically**
Everything above is mocked and free. Exactly one live pass is needed, and only after the
user says so (standing rule 2). The plan is to *ask*, stating the calls and the cost:

- One real call per kind against the second vendor: **Strict import** (Hermes), **Structural
  import** (Daedalus — the 32k-token/output-ceiling case, the likeliest to fail), **chat**
  (Prometheus — the likeliest to return a non-JSON envelope on a weaker model).
- Confirm each produced a `llm_call_log` row with the correct `provider`, `model`, and usage.
- Cost: near zero on a free tier, non-zero otherwise. Ask regardless.
- **Not part of this plan's completion gate**: re-running the roadmap's "Big flow test"
  against the second vendor. That's its own TODO item and its own spend decision.

**Quality is a separate judgment from correctness.** These three calls prove the transport
works. Whether the second vendor's model is *good enough* to be the default for Prometheus's
JSON envelope and Daedalus's full restructure is a decision to make after seeing the output —
not something this plan should presume.

---

## 6. Implementation sequence

| # | Step | Depends on | Notes / risk |
|---|---|---|---|
| 1 | Log-provider fidelity: `provider` into both write paths + gateway passes `provider.id` | — | Behavior-preserving on its own (still writes `'anthropic'`, now explicitly). Ships and tests standalone. Do this **first** — it's the fix that stops the audit log from lying the moment step 3 lands. |
| 2 | `providerRegistry.ts` + `createGateway` resolver + `llmProvider` setting + `getActiveProviderId()` | 1 | Registry initially contains one provider. Still zero behavior change. |
| 3 | `lib/ai/openaiCompatibleProvider.ts` + env getters + unit tests | — | The only step with real vendor risk. Parallelizable with step 4. |
| 4 | Settings UI select renderer + PATCH validation (+ optional Activity-log Provider column) | 2 | Parallelizable with step 3. |
| 5 | Fitness-function generalization + the `lib/db`-importer assertion | 3 | Cheap; must land in the same batch as 3 or the rule is unenforced for provider B. |
| 6 | Docs: `lib/ai/CLAUDE.md`, `docs/system-about.md`, `.env.example`, `README.md`, `CHANGELOG.md`, drop the roadmap item | 1–5 | Standing rule 6: restate rules inline, never cite a section number bare. |
| 7 | **Live verification — ask first** | 6 | §5.5. |

**Rollback:** flip the `llmProvider` setting back to `anthropic`. One DB row, no deploy, no
restart. That property is the reason the selector is a setting rather than an env var.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | A weaker model breaks Prometheus's JSON envelope or Daedalus's full restructure | Both already have guards (Prometheus's non-JSON fallback and `chat_truncated`; Daedalus's `DaedalusTruncatedError`). Don't make the second provider the default until §5.5 shows real output. |
| 2 | Daedalus's `maxTokens: 32000` exceeds the second model's output cap → hard `400` | Per-provider clamp inside the provider file (§4.4). |
| 3 | Context window: full agent markdown + Blueprint may not fit a smaller model | Discovered in §5.5's structural-import call. If it fails, that vendor/model is disqualified — a config change, not a code change, which is the whole benefit of the D1 recommendation below. |
| 4 | Gateway singleton makes the setting appear not to work | Resolve per call (constraint 4), instance-cache per id. Explicitly tested (§5.2). |
| 5 | Selected provider has no API key configured | D3. Whatever the answer, it must fail *loudly* — a silent vendor switch is the exact class of invisible behavior this codebase rejects. |
| 6 | Provider misattribution in the audit log | Step 1 lands before step 3, on purpose. |
| 7 | A future session adds a third provider and re-opens a direct transport path | §5.4's table-driven fitness function makes the rule scale instead of being a one-off exception. |
| 8 | A new npm dependency adds supply-chain and bundle surface | Prefer a `fetch`-based provider (zero new deps) — see D1. |

---

## 8. Decisions — **confirmed by the user 2026-08-13**

### D1 — Which vendor? ✅ Option A confirmed; target = NVIDIA

**Confirmed: don't pick a vendor in code. Implement one OpenAI-compatible provider
(`/v1/chat/completions`) using plain `fetch`, configured by base URL + key + model.**

That single file covers OpenAI itself, NVIDIA NIM, Groq, Together, OpenRouter, DeepSeek,
Mistral, vLLM, and local Ollama/LM Studio — all of which speak that wire format. The vendor
question then stops being a code question and becomes three env vars, which is precisely the
"switching vendors is still cheap" outcome the roadmap item asks for. Zero new npm
dependencies; the whole file is roughly the size of `anthropicProvider.ts`.

| Option | Pros | Cons |
|---|---|---|
| **A. OpenAI-compatible over `fetch`** *(recommended)* | One implementation, N vendors; no new dependency; vendor swap = env change; the endpoint literal is easy to fitness-guard | Must hand-map response shapes; per-vendor quirks (`max_tokens` vs `max_completion_tokens` on newer OpenAI models, missing `usage`, reasoning models rejecting some params) surface as runtime surprises |
| **B. The `openai` npm SDK** | Typed responses, built-in retries/streaming helpers | A new dependency for a ~5-method surface; its param surface drifts across versions; still only covers OpenAI-compatible endpoints, i.e. no more reach than A |
| **C. A vendor-specific non-OpenAI API** (Gemini native, Bedrock, …) | Best fidelity to that one vendor | Second bespoke mapping layer; locks the choice into code; highest effort for the least optionality |
| **D. Ollama / local model** | Free, no key, no data leaves the machine | Needs a host with a GPU or acceptance of small-model quality; the realistic deployment target for v1 is a hosted app; small models are the worst case for both Prometheus's JSON envelope and Daedalus's 32k restructure |

**Confirmed target for §5.5's live verification: NVIDIA NIM's OpenAI-compatible endpoint.**
Still needed before that step can actually run: a real NVIDIA API key, and your explicit
go-ahead on the spend (standing rule 2) — naming the vendor isn't the same as approving the
live calls.

### D2 — Admin-only platform setting, or user-selectable? ✅ Admin-only confirmed

**Confirmed: admin-only, exactly like `liveLlmCalls` and `chatMaxTokens`.**

- Matches the existing settings precedent end-to-end (`SETTING_DEFS` → PATCH allowlist → UI),
  so the whole selector is one array entry plus one `<select>` renderer.
- **Zero schema change.** User-selectable needs a `user.llmProvider` column, a migration, a
  user-facing control in `AccountView`, and a per-user → platform-default resolution chain.
- The stated "why" is to compare vendors and de-risk the swap before launch — that is a
  platform-level A/B, not a per-user preference.
- With `maxUsers` defaulting to 5 in a closed beta, a per-user vendor choice multiplies the
  support surface (different models, different failure shapes) for almost no user value.
- **It stays additive.** `resolveActiveProvider()` is a single seam; adding a per-user
  override later means changing one function to check the user first — no rework of anything
  built here.

### D3 — Per-provider defaults, and what a fresh install does with only one key ✅ Confirmed as recommended

Three sub-questions, all confirmed as recommended:

1. **Each provider owns its own env vars and its own `defaultModel()`.** Anthropic keeps
   `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` unchanged; the second gets its own trio (key,
   model, and — for option A — base URL). *Not* one shared `LLM_MODEL`: a model id is
   meaningless across vendors, and one shared var would break every existing `.env.local`.
2. **The `llmProvider` setting defaults to `'anthropic'`**, and an unknown/corrupt stored
   value falls back to `'anthropic'` with a `console.warn` — the same asymmetric fail-safe
   `getLiveLlmCalls()` already uses. A fresh install therefore behaves exactly as today.
3. **A provider with no key configured cannot be selected** — `PATCH /api/settings` rejects
   it with `400 provider_not_configured`, and the Settings dropdown shows the option
   greyed/annotated "not configured". The alternative — auto-detecting "only provider B has
   a key, so use B" — is rejected: a silent vendor switch based on which env var happens to
   be set is the opposite of this codebase's posture that a blocked call is a hard, visible
   stop rather than a quiet degradation.

---

## 9. Explicitly NOT in this plan

- **A third provider**, or any per-caller routing (e.g. cheap model for Hermes, strong model
  for Daedalus). The registry makes both additive later.
- **Automatic failover/retry across providers** (constraint 8) — double-spends and muddies
  the audit log.
- **Model choice as a setting.** Model stays per-provider env config here. `plans/roadmap.md`
  already carries "Wiring a declared model for Prometheus" and "Display-label lookup for
  `model`" as separate NEXT items.
- **Per-user or per-tenant API keys**, and any BYO-key flow.
- **Cost estimation in currency** on log rows (existing NEXT item) — this plan only makes
  `provider` accurate enough for a future cost calculation to be possible.
- **Incremental streaming to the client.** `stream()` still returns a fully-accumulated
  response, same as today (existing FUTURE item).
- **Prompt tuning per vendor**, structured outputs, or tool use.
- **Log retention/pruning/pagination** (existing NEXT item).
- **Re-running the "Big flow test"** against the second vendor — its own TODO item, its own
  spend decision.
