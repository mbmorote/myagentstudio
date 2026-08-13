# Plan 04 — LLM Provider Gateway, Dry-Run Mode, Settings Page

> **Status: ✅ Reviewed and confirmed 2026-07-29 — ready for `@dev`.**
> This file followed the Plan 01 precedent: walked with the user section by section before
> any code was written (see `CHANGELOG.md`'s 2026-07-26 entry for that review).
>
> **§16's five confirmation points, resolved** (all match the architect's own
> recommendation — no plan text needed to change):
> 1. Table name: `setting` (singular, matches codebase convention).
> 2. Dry-run response: `409 Conflict` (§7.2) — `200`+discriminant was considered and
>    explicitly rejected: an unhandled `200` would let a dry-run render as silent success
>    (no error, no visible effect), which is the one failure mode this feature exists to
>    prevent.
> 3. Settings fail-safe: asymmetric — missing row ⇒ on/fail-open (preserves today's real
>    behavior), unreadable/garbage value ⇒ off/fail-closed (money-spending defaults never
>    come from corrupt config).
> 4. No new component tests for `ImportDialog.tsx`/`ChatPanel.tsx` — consistent with
>    `plans/roadmap.md` Tier 5's already-documented project-wide gap; the manual Gate 5
>    checklist (§10.6) is the compensating control.
> 5. `requestPayload`/`responsePayload` stored unbounded, no size cap — this is what makes
>    the log a real audit trail rather than a counter.
>
> **Origin:** `@analyst` validated + split this task out of a larger bundled request;
> `@impact` scanned the codebase (8 modified files, 8 new files, 1 migration, 13 risks,
> 5 unknowns). This plan resolves all 5 unknowns and responds to all 13 risks explicitly
> (§12 maps each one to where it is answered).
>
> **Numbering:** `04` is correct — `01` (core loop), `02` (import hardening + structural),
> `03` (library/groups/import UI) are the existing numbered execution specs.
> `roadmap.md` and `layout-prototype-todo.md` are deliberately unnumbered living docs.
>
> Standing project rules apply in full: **no commits without an explicit ask**, **no real
> Anthropic API call without an explicit ask**, **dev server off after any verification
> session**.

---

## 0. What this plan is, in one paragraph

Three AI callers (`importConverter.ts`, `structuralConverter.ts`, `chatMediator.ts`) each
reach the Anthropic SDK independently through `lib/ai/client.ts`. There is no single point
where an AI call can be paused, audited, or re-pointed at another provider. This plan
introduces exactly one choke point — a **provider-agnostic `LLMProvider` interface**, one
**`AnthropicProvider`** implementation, and a **gateway** that wraps it — plus two new
tables (`setting`, `llm_call_log`), a **Settings page** with a "Live LLM calls" toggle and
an activity log, and end-to-end plumbing so a blocked (dry-run) call surfaces in
`ImportDialog` and `ChatPanel` as an explicit, linked, non-silent result.

**The one behavior that matters most:** when "Live LLM calls" is off, a call is a **hard
stop** — no network traffic, no mocked/synthetic response, no partial degradation. The
would-be request is recorded and a typed "blocked" signal is returned. When on (the
default), behavior is byte-for-byte what it is today plus a log row.

### Explicitly NOT in this plan

- **Plan B** (multi-tenant schema, JWT auth, invite-code beta signup) is held. No auth,
  no ownership, no user concept appears anywhere here. Only two Plan-B-shaped
  constraints are honored (§13): `setting` is genuinely generic EAV so `maxUsers` is a
  data row later, and `llm_call_log` is shaped so
  `ALTER TABLE llm_call_log ADD COLUMN user_id TEXT` is a one-line additive change.
- A second provider implementation (NVIDIA / OpenAI-compatible). The *interface* is
  designed to accept one; the implementation is not built (§14).
- Per-tenant / per-caller API keys; log retention, pruning, or pagination beyond a simple
  capped ordered list; cost estimation in currency.

---

## 1. Guiding constraints (locked — do not replan during build)

1. **Exactly one file may import `@anthropic-ai/sdk`** — `lib/ai/anthropicProvider.ts`.
   `lib/ai/client.ts` is **deleted**, not kept as a helper (§3.4). This is enforced by a
   test, not by convention (§10.2).
2. **Every AI call attempt goes through the gateway.** Including
   `scripts/test-structural-import.ts`, the manual live harness — it is the single largest
   spender in the repo and is exactly the thing the switch exists to protect (§7.6).
3. **The gateway is the only file in `lib/ai/` allowed to import from `lib/db/`.** Providers
   are pure transport and know nothing about agents, kinds, or logging (§2.1, risk 4).
4. **Dry-run is a hard stop, never a soft degradation.** No synthetic response object is
   ever constructed. The blocked result is structurally distinct from a success and cannot
   be `.text`-ed by accident (compile error).
5. **Default is on.** Today's behavior is preserved for anyone who never opens Settings.
6. **Settings are read fresh on every call.** No in-process cache (§6, risk 9).
7. **`llm_call_log` is append-only**, matching `sectionRevision` / `agentSnapshot`: soft
   `agentId` reference, no cascade delete, no `UPDATE`, no `DELETE` exported from the
   repository.
8. **The API key never enters a request payload, response payload, log row, response body,
   or console line** (Design Principle #8, non-negotiable).

---

## 2. Architecture

### 2.1 Layering

```
route (app/api/…)            ← knows HTTP, maps LlmDryRunBlockedError → 409
  └─ caller (lib/ai/*Converter.ts, chatMediator.ts)
        ← knows the domain (prompts, JSON parsing, stop_reason rules, demotion)
        └─ gateway (lib/ai/gateway.ts)
              ← knows the setting + the log. THE choke point. May import lib/db.
              └─ provider (lib/ai/anthropicProvider.ts)
                    ← knows only transport. Never imports lib/db, never sees `kind`.
                    └─ @anthropic-ai/sdk
```

**On the new `lib/ai/` → `lib/db/` dependency (risk 4):** this is deliberate and confined
to one file. `lib/ai/gateway.ts` is an application-domain object by definition — it makes
policy decisions (is this call allowed?) and writes an audit record. Pushing that into the
route layer would triplicate it and lose duration/usage fidelity (§3.3). There is **no
cycle risk**: `lib/db/` imports nothing from `lib/ai/` today and must not start
(verified by grep, 2026-07-29). Testability is unaffected — every existing test that
touches the DB already swaps `lib/db/client.js` for the in-memory instance.

**On app-domain metadata polluting a provider-agnostic type (risk 5a's objection):** it
does not, because the two concerns are two separate arguments. The gateway signature is
`complete(req: LlmRequest, ctx: LlmCallContext)`. `LlmRequest` is pure transport
(system / messages / maxTokens / model / signal) and is the *only* thing the provider ever
receives. `LlmCallContext` (`kind`, `agentId`, `agentLabel`) never crosses into the
provider. The objection that killed placement (a) in the impact report is answered by
separating the types rather than merging them.

### 2.2 Files

| File | New/Modified | Role |
|---|---|---|
| `lib/ai/provider.ts` | **new** | `LLMProvider` interface + provider-agnostic request/response types. No implementation, no imports beyond types. |
| `lib/ai/anthropicProvider.ts` | **new** | `createAnthropicProvider(): LLMProvider`. Owns the lazy `Anthropic` SDK singleton (moved from `client.ts`). The only SDK importer. |
| `lib/ai/gateway.ts` | **new** | `createGateway(provider)`, `getGateway()`, `LlmDryRunBlockedError`. Gate check → log → forward. |
| `lib/ai/client.ts` | **deleted** | Contents absorbed into `anthropicProvider.ts` (§3.4). |
| `lib/ai/importConverter.ts` | modified | Uses `getGateway().complete(...)`, `kind: 'import-strict'`. |
| `lib/ai/structuralConverter.ts` | modified | Uses `getGateway().stream(...)`, `kind: 'import-structural'`. Keeps its own `stopReason === 'max_tokens'` domain check. |
| `lib/ai/chatMediator.ts` | modified | Uses `getGateway().complete(...)`, `kind: 'chat'`, `signal` passthrough preserved. |
| `lib/settings.ts` | **new** | `SETTING_DEFS` catalog + typed accessors (`getLiveLlmCalls()`), defaults, parsing. |
| `lib/db/schema.ts` | modified | `setting`, `llmCallLog` tables. |
| `lib/db/migrations/0002_*.sql` + `meta/` | **new** | Generated, never hand-written (§4.3). |
| `lib/db/repository/settings.ts` | **new** | `getSetting`, `setSetting`, `getAllSettings` (raw string I/O only). |
| `lib/db/repository/llmCallLog.ts` | **new** | `writeCallLog`, `listCallLogs`, `getCallLog`. No update/delete. |
| `lib/db/repository/index.ts` | modified | Barrel exports. |
| `lib/db/seed.ts` | modified | Seeds the `liveLlmCalls` row with **`onConflictDoNothing`** (§4.4 — this is load-bearing). |
| `app/api/agents/import/route.ts` | modified | Both pipelines: pass `ctx`, catch `LlmDryRunBlockedError` → 409. |
| `app/api/chat/route.ts` | modified | Same, ordered before the AbortError branch. |
| `app/api/settings/route.ts` | **new** | `GET` (all known settings, defaults applied) + `PATCH` (allowlisted key). |
| `app/api/llm-call-log/route.ts` | **new** | `GET` list (no payloads). |
| `app/api/llm-call-log/[id]/route.ts` | **new** | `GET` one full row (with payloads). |
| `app/settings/page.tsx` | **new** | Server component: loads setting + log server-side, renders `<Topbar />` + `<SettingsView>`. |
| `app/components/Settings/SettingsView.tsx` | **new** | Client component: toggle, Dry-run/Live filter, log table, `?log=<id>` highlight. |
| `app/components/shell/Topbar.tsx` | modified | `⚙ Settings` link. |
| `app/components/Library/ImportDialog.tsx` | modified | Dry-run branch (checked **before** `!response.ok`). |
| `app/components/Chat/ChatPanel.tsx` | modified | Dry-run branch, lock released. |
| `scripts/test-structural-import.ts` | modified | Pre-flight check on the switch (§7.6). |
| `lib/ai/CLAUDE.md` | modified | Becomes factually wrong the moment `client.ts` dies — rewritten in Phase 6. |

---

## 3. The interface, provider, and gateway

### 3.1 `lib/ai/provider.ts` — provider-agnostic contract

```ts
export type LlmRole = 'user' | 'assistant';
export type LlmMessage = { role: LlmRole; content: string };

/** Normalized across providers. Anything a provider returns that isn't in this set → 'other'. */
export type LlmStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'other';

export type LlmUsage = { inputTokens: number; outputTokens: number };

/** What a CALL SITE builds. System prompt and messages are separate — no provider-specific shape. */
export type LlmRequest = {
  system: string;                 // system prompt, carried separately (OpenAI-compatible
                                  // providers map this to messages[0].role='system')
  messages: LlmMessage[];
  maxTokens: number;
  model?: string;                 // omitted ⇒ provider default; the GATEWAY resolves it
  signal?: AbortSignal;           // Rules Index #23 — must survive the abstraction
};

/** What the PROVIDER receives — identical, except `model` is always resolved. */
export type ResolvedLlmRequest = LlmRequest & { model: string };

export type LlmResponse = {
  text: string;                   // concatenated text blocks
  stopReason: LlmStopReason;
  model: string;
  usage: LlmUsage | null;
};

export interface LLMProvider {
  readonly id: string;            // 'anthropic'
  defaultModel(): string;
  /** Non-streaming transport. */
  complete(req: ResolvedLlmRequest): Promise<LlmResponse>;
  /** Streaming transport, awaited to completion. Same return shape — see §3.5. */
  stream(req: ResolvedLlmRequest): Promise<LlmResponse>;
}
```

**Why `system` is a separate field and not `messages[0]`:** Anthropic takes `system` as a
top-level parameter; OpenAI-compatible APIs (the likely NVIDIA target) take it as a
`role: 'system'` message. Carrying it separately lets each provider map it natively and
keeps every call site free of both shapes.

### 3.2 `lib/ai/anthropicProvider.ts`

- Module-private lazy singleton `let _sdk: Anthropic | null` — **the exact lazy-singleton
  behavior `client.ts` has today**, moved, not changed (risk 8). One `Anthropic` instance
  per process means unchanged connection-pool / rate-limit behavior; constructing a new
  instance per call would be a silent behavioral change for no benefit.
- `defaultModel()` → `getAnthropicModel()` from `lib/env.ts` (unchanged, still the
  `ANTHROPIC_MODEL` env var, still defaulting to `claude-opus-4-8`).
- `complete()` → `sdk.messages.create({ model, max_tokens, system, messages }, { signal })`,
  then joins `content` blocks of type `text`. **No text block at all is a provider-level
  error** (`LlmProviderResponseError`) — today each caller re-implements that check; it is
  a transport concern and moves down one layer. Callers keep their *domain* checks.
- `stream()` → `sdk.messages.stream({...}, { signal })` then `await .finalMessage()`, mapped
  into the same `LlmResponse`.
- `stop_reason` mapped into `LlmStopReason`; unknown/`null` → `'other'`.
- `usage` mapped from `input_tokens`/`output_tokens` when present, else `null`.
- **`import 'server-only'` stays at the top**, as on every current `lib/ai/` module.

### 3.3 `lib/ai/gateway.ts` — the choke point

```ts
export type LlmCallKind = 'import-strict' | 'import-structural' | 'chat';

export type LlmCallContext = {
  kind: LlmCallKind;
  agentId?: string | null;      // best-effort, may be null forever (§5.2)
  agentLabel?: string | null;   // display fallback when agentId is null
};

export type LlmGatewayResult =
  | { ok: true;  response: LlmResponse; logId: string | null }
  | { ok: false; reason: 'dry_run_blocked'; model: string; logId: string | null };

export interface LlmGateway {
  complete(req: LlmRequest, ctx: LlmCallContext): Promise<LlmGatewayResult>;
  stream(req: LlmRequest, ctx: LlmCallContext): Promise<LlmGatewayResult>;
}

export function createGateway(provider: LLMProvider): LlmGateway;   // testable seam
export function getGateway(): LlmGateway;                           // lazy singleton

export class LlmDryRunBlockedError extends Error {
  readonly logId: string | null;
  readonly kind: LlmCallKind;
  readonly model: string;
  name = 'LlmDryRunBlockedError';
}
```

**Execution order inside `complete()` / `stream()` — this order is normative:**

1. `const model = req.model ?? provider.defaultModel()` — **resolved before the gate**, so a
   dry-run row records the model that *would* have been used.
2. `const live = getLiveLlmCalls()` — a **fresh** synchronous read (§6).
3. **If not live** → build the log entry (`dryRun: true`, full `requestPayload`,
   `responsePayload: null`, `error: null`, measured `durationMs`), write it, and return
   `{ ok: false, reason: 'dry_run_blocked', model, logId }`. **The provider is never
   touched.** No `Anthropic` instance is even constructed (lazy singleton, never called).
4. **If live** → `const t0 = Date.now()`; `await provider.complete(resolved)`.
   - Success → write log (`dryRun: false`, `responsePayload`, `usage`, `durationMs`) →
     return `{ ok: true, response, logId }`.
   - Throw → write log (`error: <class name>: <message, truncated 2000 chars>`,
     `responsePayload: null`, `durationMs`) → **re-throw the original error object
     unchanged** (identity preserved — `err.name === 'AbortError'` must keep working
     downstream, risk 6).
5. No DB transaction is ever open across the network call (§9, data integrity).

**Why the gateway writes the log — resolution of unknown 1 / risk 5.** Placement (a),
chosen:

| | Sees dry-run path | Real wall-clock duration | Raw `usage` | Catches network/auth/abort | Written once |
|---|---|---|---|---|---|
| **(a) gateway** | ✅ (it *is* the dry-run path) | ✅ | ✅ | ✅ | ✅ one impl |
| (b) each caller | ✅ | ~ (includes parsing) | ✅ | ~ (abort re-throw needs bespoke handling ×3) | ❌ ×3, drifts |
| (c) route | ✅ | ❌ reconstructed | ❌ lost on error paths | ❌ only sees the caller's mapped error | ❌ ×3 |

The single objection to (a) — that it drags `kind`/`agentId` into a provider-agnostic
request type — is dissolved by the two-argument signature (§2.1). The second objection,
that `agentId` may be unknown at that point, is real but applies identically to (b) and is
answered on its own terms in §5.2.

### 3.4 Resolution of unknown 3 — `lib/ai/client.ts` is **deleted**

Not merged-and-kept, not retained as a thin helper. Its 12 lines of substance
(`_client` singleton + `getModel()`) move verbatim into `anthropicProvider.ts` as
module-private functions. Rationale:

- Only three consumers exist (grep-confirmed), and all three are being retrofitted in the
  same phase. There is no external consumer to strand.
- Keeping `client.ts` alive leaves a **second, unmonitored door to the SDK**. The entire
  value of this plan is that there is exactly one. A file whose only purpose is to hand out
  a raw SDK client is precisely the thing a future session would reach for by accident.
- Deletion makes constraint 1 mechanically checkable: one grep, one test (§10.2).

### 3.5 Resolution of risk 7 and risk 13 — streaming

`stream()` returns `Promise<LlmResponse>`, i.e. it awaits the SDK's `finalMessage()`. This
is **exactly what `structuralConverter.ts` does today** — it never consumes deltas; it uses
the streaming transport because a 32,000-token non-streaming request is not viable against
the SDK's long-request handling. So:

- **No buffering layer is added.** The accumulation is the SDK's own `finalMessage()`, the
  same call that runs today. The streaming *transport* is preserved end-to-end (risk 13).
- **The domain rule stays in the caller** (risk 7): the gateway records `stopReason` in the
  log and returns it on `LlmResponse`, but never interprets it.
  `structuralConverter.ts` keeps `if (res.response.stopReason === 'max_tokens') throw new
  StructuralConverterTruncatedError()`. Truncation is a content-loss rule (Rules Index #31),
  not a transport condition, and it does not move.
- Incremental delta exposure (a future `streamChunks()` returning an `AsyncIterable<string>`
  for real token-by-token UI streaming) is **deliberately deferred** (§14). Adding it later
  is purely additive to the interface — no existing signature changes.

### 3.6 Caller shape (all three, normative)

The dry-run check sits **outside** the existing catch-all, so it can never be swallowed and
re-labelled as `ai_upstream`:

```
let res: LlmGatewayResult;
try {
  res = await getGateway().complete(req, { kind: 'chat', agentId, agentLabel: null });
} catch (err) {
  // existing mapping: AbortError re-thrown as-is, everything else → XUpstreamError
}
if (!res.ok) throw new LlmDryRunBlockedError(res.logId, 'chat', res.model);  // ← outside
// …existing parsing/validation on res.response.text…
```

Belt-and-braces: each caller's catch-all also re-throws `LlmDryRunBlockedError` unchanged
(three lines total), so a future restructuring that moves the check back inside the `try`
still cannot misclassify it as a 502.

**Why a union return from the gateway but a thrown error from the caller.** The union makes
it a *compile error* to ignore the blocked case at the one place that must not ignore it
(`res.response` does not exist on the blocked arm). Once handled, throwing is the right
propagation mechanism upward because every caller already has a typed-error protocol with
its route, and changing three `Promise<Stage2Labels>`-style return types into unions would
ripple through routes and every existing test for no safety gain.

---

## 4. Data model

### 4.1 `setting` — generic EAV, operator-level

```ts
export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),          // always stringified; typing lives in SETTING_DEFS
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull().default(sql`(unixepoch())`),
});
```

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `key` | text | PK | e.g. `liveLlmCalls`. Plan B adds `maxUsers` as a **row**, not a column. |
| `value` | text | not null | `'true'` / `'false'` / `'12'`. Parsed per `SETTING_DEFS[key].datatype`. |
| `updatedAt` | int (timestamp) | not null, default now | Shown in the Settings UI. |

- **Genuinely generic** (Plan B constraint 1): no `liveLlmCalls` column, no `maxUsers`
  column, ever. Mirrors the existing `agentConfig` EAV pattern, and the `ConfigDef`
  catalog pattern is mirrored in code by `SETTING_DEFS`.
- Global/operator scope. Not per-agent, not per-user. When Plan B lands, a *user*-scoped
  setting would be a different table — this one stays global.
- Lifecycle: rows are created on first write (upsert). A missing row is a valid,
  fully-supported state meaning "never configured" (§6, risk 1).
- **Existing data:** none. Nothing to migrate or backfill.

`lib/settings.ts` (the in-code catalog):

```ts
export const SETTING_DEFS = [
  { key: 'liveLlmCalls', datatype: 'bool', default: true,
    label: 'Live LLM calls',
    hint: 'When off, AI calls are recorded and blocked before any network request is made. No response is produced.' },
] as const;
```

Plan B's `maxUsers` = one appended entry with `datatype: 'int', default: <n>`. No schema
change, no migration, no route change (the `PATCH` allowlist is derived from this array).

### 4.2 `llm_call_log` — append-only audit log

```ts
export const llmCallLog = sqliteTable('llm_call_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  kind: text('kind', { enum: ['import-strict', 'import-structural', 'chat'] }).notNull(),
  provider: text('provider').notNull().default('anthropic'),
  agentId: text('agent_id'),                       // SOFT ref, nullable — never cascade-deleted
  agentLabel: text('agent_label'),                 // display fallback (§5.2)
  dryRun: integer('dry_run', { mode: 'boolean' }).notNull(),
  model: text('model').notNull(),
  requestPayload: text('request_payload', { mode: 'json' }).notNull().$type<LoggedRequest>(),
  responsePayload: text('response_payload', { mode: 'json' }).$type<LoggedResponse | null>(),
  error: text('error'),                            // '<ErrorName>: <message>', ≤2000 chars
  durationMs: integer('duration_ms').notNull(),
  usage: text('usage', { mode: 'json' }).$type<LlmUsage | null>(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull().default(sql`(unixepoch())`),
}, (t) => ({
  byCreated: index('llm_call_log_created_idx').on(t.createdAt),
  byKind:    index('llm_call_log_kind_idx').on(t.kind),
}));
```

| Field | Type | Null? | Notes |
|---|---|---|---|
| `id` | text uuid | no | PK. Also the deep-link target: `/settings?log=<id>`. |
| `kind` | text | no | Drizzle `enum` is TS-level only for SQLite text — **no CHECK constraint is generated**, so adding a 4th kind later needs no migration. |
| `provider` | text | no, default `'anthropic'` | Present from day one so a second provider is a data value, not a schema change. |
| `agentId` | text | **yes** | Soft reference. Permanently null for most import rows (§5.2). Never cascade-deleted with the agent — same rule as `sectionRevision`/`agentSnapshot`. |
| `agentLabel` | text | yes | The frontmatter `name` at call time, for import rows that have no id. Display only. |
| `dryRun` | int bool | no | The primary filter on the Settings page. |
| `model` | text | no | Resolved **before** the gate, so dry-run rows are accurate. |
| `requestPayload` | json text | no | `{ system, messages, maxTokens, model }`. The full prompt — this is the "audit what was sent" deliverable and, for dry-run, the only artifact. Contains no credential by construction. |
| `responsePayload` | json text | yes | `{ text, stopReason }`. **Always `null` for dry-run** (spec) and for errored calls. |
| `error` | text | yes | Non-null ⇒ status "Error" in the UI. |
| `durationMs` | int | no | Measured, always ≥ 0. Dry-run rows will read ~0–2ms (gate + log only). |
| `usage` | json text | yes | `{ inputTokens, outputTokens }` when the provider reports it. |
| `createdAt` | int timestamp | no | Indexed; list order is `createdAt DESC, id DESC`. |

- **Append-only:** the repository exports no update and no delete. Deleting an agent does
  not touch this table (soft ref).
- **Sizing:** a structural-import row's `requestPayload` is the blueprint + full agent
  file — roughly 30–60 KB. 1,000 imports ≈ 60 MB in a local SQLite file. Acceptable now;
  pruning is deferred with an explicit trigger (§14).
- **Plan B readiness (constraint 2):** `ALTER TABLE llm_call_log ADD COLUMN user_id TEXT;`
  is trivially applicable — the PK is a single column, nothing is composite, no NOT NULL
  default is needed, and (deliberately) `listCallLogs` selects **explicit columns rather
  than `select *`**, so a later column cannot silently leak into the list DTO.

### 4.3 Migration approach (risk 3)

1. Stop the dev server first (standing rule 3 — the SQLite-lock incident of 2026-07-28).
2. `npx drizzle-kit generate` → writes `lib/db/migrations/0002_<random_name>.sql`,
   `meta/0002_snapshot.json`, and a new `_journal.json` entry (idx 2). All three are
   committed together.
3. **Never hand-edit the SQL or the journal.** `lib/db/__tests__/test-db.ts` runs
   `migrate()` eagerly at module load for *every* test file — a journal/snapshot mismatch
   breaks all 132 existing tests at once, and the failure reads as a schema error, not a
   migration error. Verification gate: `npm test` immediately after generating, before
   writing any other code.
4. Apply to the real DB via the already-wired `npm run db:seed` (its `migrate()` call runs
   first), or `npx drizzle-kit migrate`.
5. Two `CREATE TABLE`s + two `CREATE INDEX`es, no `ALTER`, no data touched. **Zero existing
   rows are affected; no backfill exists to get wrong.**

### 4.4 Seed (`lib/db/seed.ts`) — `onConflictDoNothing`, not `DoUpdate`

```
insert(setting).values({ key: 'liveLlmCalls', value: 'true' }).onConflictDoNothing()
```

**This is load-bearing and the opposite of the catalog pattern in the same file.**
`configDef`/`sectionDef` use `onConflictDoUpdate` because the catalog is *code-owned* and
must heal from `catalog.ts`. `setting` is *operator-owned runtime state*. Since
`npm run db:seed` is wired into **`predev` and `prebuild`**, a `DoUpdate` here would silently
flip "Live LLM calls" back to on every single `npm run dev` — a money-spending regression
disguised as a seed. Write the comment in the file saying exactly that.

The gateway must not depend on this row existing (§6).

---

## 5. Resolutions of the remaining open unknowns

### 5.1 Unknown 1 — log-write location → **the gateway** (§3.3, table above)

### 5.2 Unknown 2 / risk 2 — `agentId` for import calls → **best-effort at write time, never backfilled**

- **`chat` kind:** `agentId` is always known (the route loaded the agent). Always set.
- **Import kinds:** the agent frequently does not exist yet — it is created *from* the AI's
  response. Resolution:
  - Both pipelines already need the incoming frontmatter `name` (the structural pipeline
    already calls `getAgentSnapshotInfo(name)` for the unchanged short-circuit). Use it:
    `agentId = existing?.id ?? null`. The strict pipeline gains the same one indexed lookup.
  - `agentLabel = <frontmatter name>` always (or `null` if the file has none), so a
    first-time-import row still reads `dev` in the log instead of `—`.
- **No backfill, ever.** Backfilling would require an `UPDATE` on an append-only table,
  contradicting invariant 4 and the precedent this codebase set with `sectionRevision` /
  `agentSnapshot`. A first-time-import row keeps `agentId: null` permanently; that is
  factually correct — no agent existed at call time.
- The Settings UI's "Agent" column renders `agentLabel ?? '—'`, linking to
  `/agents/<agentId>` only when `agentId` is non-null.

### 5.3 Unknown 3 — `lib/ai/client.ts` → **deleted** (§3.4)

### 5.4 Unknown 4 — Settings page routing/layout → **`/settings/page.tsx` renders `<Topbar />` itself**

Options weighed:

| Option | Verdict |
|---|---|
| Move `<Topbar />` into `app/layout.tsx` | **Rejected.** `WorkbenchShell.tsx` is a `h-screen` flex column whose first child is `<Topbar />` and whose remaining height feeds the 4-pane grid and the resize hooks. Hoisting it means re-deriving those heights and risking a regression in the layout that three prior plans converged on — wildly disproportionate to adding one page. |
| A `(shell)` route group with a shared layout | **Rejected.** Real infrastructure for exactly one new page. Revisit if a third top-level route appears. |
| `/settings/page.tsx` renders `<Topbar />` + its own container | **Chosen.** `Topbar` is a self-contained client component with zero props. Smallest possible diff, zero risk to the workbench, visually identical chrome. |

- `Topbar` gains a `⚙ Settings` `<Link href="/settings">` beside the theme toggle. It renders
  on `/settings` too (harmless), and the Settings page adds a `← Back` link to `/`.
- Navigating to `/settings` is a full navigation and therefore discards `ChatPanel`'s local
  message history — the same thing that already happens when switching agents (`key={agent.id}`
  remount, R5/R15). Acceptable; a modal variant is deferred (§14).
- Data loading follows `app/agents/[id]/page.tsx` exactly: the **server component** calls
  `getAllSettings()` + `listCallLogs({ limit: 200 })` (and, when `?log=<id>` is present,
  `getCallLog(id)`) directly through the repository and passes plain data to the client
  component. No client-side fetch is needed for first paint.

### 5.5 Unknown 5 — log-write failure → **never blocks the call; dry-run still blocks**

| Situation | Behavior | Why |
|---|---|---|
| Live call, log write throws (disk full, schema mismatch) | Swallow, `console.error('[llm-log] …')`, return the response normally with `logId: null` | The money is already spent and the response already exists. Discarding real work because an observability row failed is strictly worse than a missing audit row. The log is diagnostics, not a business invariant. |
| Dry-run, log write throws | **Still blocked.** Return `{ ok:false, logId: null }`, `console.error` | Non-negotiable: a failed log write must never be a path to making a live call. The UI shows the block message and omits the "view log entry" link, with "(log entry could not be written)". |
| Log write throws *after* the provider threw | Swallow; re-throw the **original provider error** | The caller must see the real failure, not a logging failure. |

Asserted as an invariant and covered by test §10.1 case 7. Revisit only if this log ever
becomes compliance-grade rather than diagnostic (§14).

---

## 6. Settings semantics (risk 1, risk 9)

| Stored state | Effective value | Rationale |
|---|---|---|
| Row absent (post-migration / pre-seed / fresh clone) | **`true` — fail-open** | The requirement is "defaults to on, preserving today's behavior unless the user explicitly turns it off." A missing row is indistinguishable from "never configured", and the documented default for never-configured is on. Fail-closed would make a freshly migrated DB silently break every AI feature with no visible cause. |
| `'true'` | `true` | — |
| `'false'` | `false` | — |
| Anything else (`''`, `'yes'`, `'1'`, garbage from a manual DB edit) | **`false` — fail-closed** + `console.warn` | Asymmetric on purpose. Money-spending defaults may only come from the *absence* of configuration, never from *unparseable* configuration. A garbage value means the operator configured something whose intent we cannot read; the safe reading is "off". The Settings page surfaces the raw invalid value so it is fixable in one click. |

**No caching (risk 9).** `getLiveLlmCalls()` performs a fresh `SELECT` on every gateway
call. `better-sqlite3` is synchronous and this is a single-row primary-key lookup —
sub-millisecond against an operation that costs seconds and real money. A cached value
would mean flipping the toggle appears to do nothing until a process restart, which reads
as a bug and, worse, as an *unreliable* safety switch. The switch must be trustworthy the
instant it is flipped.

---

## 7. API surface

### 7.1 Endpoints

| Method | Path | Auth | Request | Response | Errors | Side effects |
|---|---|---|---|---|---|---|
| `GET` | `/api/settings` | none (local) | – | `{ settings: [{ key, label, hint, datatype, value, isDefault, updatedAt }] }` — one entry per `SETTING_DEFS` key, defaults applied | `500 internal` | none |
| `PATCH` | `/api/settings` | none | `{ key: string, value: boolean \| number \| string }` | `{ key, value, isDefault: false, updatedAt }` | `400 invalid_body`; `400 unknown_setting_key`; `400 invalid_setting_value` | Upserts one `setting` row |
| `GET` | `/api/llm-call-log` | none | query: `limit` (1–500, default 200), `dryRun` (`true`\|`false`), `kind` | `{ entries: CallLogListItem[] }` — **no payloads** | `400 invalid_query` | none |
| `GET` | `/api/llm-call-log/[id]` | none | – | `CallLogFull` — includes `requestPayload`/`responsePayload` | `404 not_found` | none |
| `POST` | `/api/agents/import` | none | *(unchanged)* `{ md, mode? }` | *(unchanged)* | **+ `409 llm_dry_run`** (§7.2) | Unchanged, except: one `llm_call_log` row per AI call; **on dry-run, no agent is created or modified and no snapshot/revision is written** |
| `POST` | `/api/chat` | none | *(unchanged)* `{ agentId, instruction }` | *(unchanged)* | **+ `409 llm_dry_run`** | Unchanged, except: one `llm_call_log` row per AI call; **on dry-run, zero DB writes to the agent** |

`PATCH /api/settings` writes only keys present in `SETTING_DEFS` — an allowlist, not a
free-form EAV write endpoint. The table is generic; the *API* is not. Values are validated
against the key's `datatype` before storage.

### 7.2 The dry-run response — `409 Conflict`

Identical body from both routes:

```json
{
  "error": "llm_dry_run",
  "dryRun": true,
  "kind": "import-structural",
  "model": "claude-opus-4-8",
  "logId": "8f0e…",
  "message": "Live LLM calls are turned off in Settings. The request was recorded but never sent."
}
```

**Why 409 and why a dual-shaped body.** Two alternatives were considered:

- *200 + discriminant* (the precedent set by `{ skipped: 'unchanged' }`) — **rejected.** An
  unhandled 200 means `ImportDialog` finds no `body.id`, navigates nowhere, clears nothing,
  and shows **nothing at all**. A silent no-op is the single worst outcome for a feature
  whose entire purpose is being a loud, trustworthy stop.
- *503 Service Unavailable* — **rejected.** Implies transience and invites retries; this is
  a deliberate operator configuration, not an outage.

`409 Conflict` ("the request conflicts with the current state of the server") is a
defensible reading, is already an established status in this codebase (name collisions,
version conflicts), and — decisively — makes an *unhandled* dry-run render as a visible
error rather than as silence. The body carries both `error` (so any generic handler shows
something) and `dryRun`/`logId` (so an informed handler shows the good UI). Clients must
check `body.dryRun` **before** their `!response.ok` branch.

### 7.3 Error handling

| Scenario | HTTP | Response shape | Logged? |
|---|---|---|---|
| Dry-run blocked (`/api/chat`, `/api/agents/import`) | **409** | `{ error:'llm_dry_run', dryRun:true, kind, model, logId, message }` | `console.info('[llm-gateway] blocked …')` — informational, not an error |
| Unknown settings key on `PATCH` | 400 | `{ error:'unknown_setting_key', key }` | no |
| Value fails the key's datatype | 400 | `{ error:'invalid_setting_value', key, datatype }` | no |
| Bad `limit`/`dryRun`/`kind` query | 400 | `{ error:'invalid_query', field }` | no |
| Log entry id not found | 404 | `{ error:'not_found' }` | no |
| Log write failed | *(no HTTP effect)* | call proceeds; `logId: null` | **yes** `[llm-log]` |
| Provider/network/auth failure | 502 *(unchanged)* | `{ error:'ai_upstream' }` | **yes** — plus one `llm_call_log` row with `error` set |
| Client cancelled mid-call | 499 *(unchanged)* | `{ error:'cancelled' }` | **yes** — plus one `llm_call_log` row with `error:'AbortError: …'` (a cancelled call may still have been billed; that must be visible) |
| Truncated structural response | 422 *(unchanged)* | `{ error:'structural_truncated' }` | **yes** — the log row exists with `stopReason:'max_tokens'` in `responsePayload` |
| Unexpected server error | 500 *(unchanged)* | `{ error:'internal' }` | **yes**, never including the key or prompt text |

**Backward compatibility:** every existing status code, error code, and success shape is
unchanged. The only new outcome on existing endpoints is `409 llm_dry_run`, which is
unreachable unless an operator explicitly turns the switch off. No versioning is needed.
The only consumers are this app's own two components.

---

## 8. Business rules

### Invariants (always true)

1. Exactly one source file imports `@anthropic-ai/sdk` (`lib/ai/anthropicProvider.ts`).
2. Every AI call attempt — live or dry-run, success or failure — produces exactly one
   `llm_call_log` row, unless the log write itself fails (then zero rows, one console
   error, and the call outcome is unaffected).
3. When `liveLlmCalls` is effectively false, **zero bytes leave the process** for that call:
   the provider is not invoked, no SDK client is constructed, and **no synthetic response is
   ever fabricated**.
4. A dry-run block is never converted into `ai_upstream` (502) or `internal` (500) by any
   caller's catch-all (structurally guaranteed by §3.6).
5. `llm_call_log` is append-only; no `UPDATE`/`DELETE` is exported. Deleting an agent leaves
   its log rows intact (soft ref, matching `sectionRevision`/`agentSnapshot`).
6. The API key never appears in `requestPayload`, `responsePayload`, any response body, or
   any console line — by construction, since `LlmRequest` has no credential field and the
   key lives only in the SDK client's constructor options.
7. `model` in a log row is the model that would have been / was actually used, because it is
   resolved before the gate.
8. On a dry-run block, no agent is created, updated, or deleted, and no
   `SectionRevision` / `AgentSnapshot` row is written — the block occurs strictly before
   any persistence step in both pipelines.
9. No DB transaction is held open across a network call.

### Policies (configurable / catalog-driven)

10. `liveLlmCalls` defaults to **true** when the row is absent; an unparseable stored value
    is treated as **false** (§6).
11. `SETTING_DEFS` in `lib/settings.ts` is the single source of known keys, datatypes,
    defaults, labels, and hints — it drives storage parsing, the `PATCH` allowlist, and the
    Settings UI, exactly as `CONFIG_DEFS` drives the agent config zone.
12. Seeding never overwrites an existing `setting` row (`onConflictDoNothing`).
13. Log retention is unbounded; the list view is capped (default 200, max 500). Pruning is
    deferred (§14).
14. Settings are read fresh on every gateway call; no cache, no restart required.

### State transitions (sequences)

15. **Gate:** resolve model → read setting → *(blocked)* write log → return blocked
    → caller throws `LlmDryRunBlockedError` → route returns 409 → UI shows inline notice +
    link. **No network, no writes, no partial state.**
16. **Live:** resolve model → read setting → start timer → provider call → write log →
    return response → caller performs its domain validation → route proceeds unchanged.
17. **Failure:** provider throws → write log with `error` → re-throw the original object →
    caller maps to its typed error → route maps to 502/499/422 exactly as today.
18. **Toggle:** `PATCH /api/settings` upserts the row → the *next* gateway call observes it,
    with no restart and no cache invalidation step.

---

## 9. Non-functional requirements

- **Performance.** Gateway overhead per call = one indexed single-row `SELECT` + one
  `INSERT` on synchronous `better-sqlite3`, target **< 5 ms combined**, against an operation
  that takes 2 s (chat) to minutes (structural import) — under 0.1 % of call duration.
  Dry-run round trip target: **< 50 ms** end-to-end from HTTP request to 409, since no
  network call occurs.
- **Storage.** ~1–5 KB per chat row, ~30–60 KB per structural-import row. Prune trigger
  defined in §14 (> 5,000 rows or the DB file exceeding ~200 MB).
- **Concurrency / locking.** The log `INSERT` runs *after* the network call completes and is
  never inside a transaction spanning that call, so a 3-minute structural import never holds
  a write lock. WAL is already enabled. This matters given the 2026-07-28 SQLite-lock
  incident — do not regress it by wrapping the provider call in `db.transaction`.
- **Security.**
  - `PATCH /api/settings` is allowlisted by key and datatype-validated; the browser cannot
    write arbitrary EAV rows.
  - `GET /api/llm-call-log/[id]` exposes **full system prompts and full agent content**.
    That is the point of an audit log, and it is consistent with every other route in this
    local-only single-user app (all unauthenticated today). **It is also the single most
    sensitive endpoint added by this plan**, and is flagged in §13 as one that must gain
    auth on day one of Plan B.
  - `agentLabel` and error strings come from untrusted file content; both are rendered as
    React text nodes (escaped), never `dangerouslySetInnerHTML`.
  - No credential reaches storage or the wire (invariant 6).
- **Scalability at 10×.** 10× current usage is a few thousand rows — trivially served by the
  `created_at` index with a `LIMIT`. The one thing that would degrade is an unbounded list
  query, which is why `limit` is capped server-side rather than trusted from the client.
- **Data integrity.** The log write is intentionally *not* transactional with surrounding
  business writes: a rolled-back import must not erase the evidence that an API call really
  happened, and a failed log write must not roll back a successful import.
- **Observability.** Console prefixes: `[llm-gateway]` (gate decisions, blocks),
  `[llm-log]` (log-write failures only). No prompt text and no key in any console line.
  Existing route-level logging is unchanged.

---

## 10. Testing approach

The gap being closed (risk 10): today all three AI callers are mocked at the caller level in
every test, so **no existing test can reach gateway code at all**. Everything below is new
unless stated.

### 10.1 `lib/ai/__tests__/gateway.test.ts` — the core suite

Setup: `vi.mock('lib/db/client.js')` → in-memory test DB (existing pattern), plus a
**fake `LLMProvider`** whose `complete`/`stream` are `vi.fn()`s, injected via
`createGateway(fake)`. The SDK is never involved.

| # | Case | Key assertions |
|---|---|---|
| 1 | Setting row absent | Live path taken (fail-open default-on); `fake.complete` called once; one row, `dryRun:false`, `responsePayload` non-null, `durationMs >= 0`, `usage` recorded |
| 2 | `liveLlmCalls = 'false'` | **`expect(fake.complete).not.toHaveBeenCalled()`** ← *the assertion that actually matters* — one row with `dryRun:true`, `responsePayload:null`, `error:null`, `model` populated; returns `{ ok:false, reason:'dry_run_blocked', logId }` |
| 3 | `liveLlmCalls = 'true'` | Live path, one row |
| 4 | `liveLlmCalls = 'banana'` | Treated as off → blocked (fail-closed on garbage) |
| 5 | Provider throws a generic error | One row with `error` set, `responsePayload:null`; the **same error object** is re-thrown (`toBe` identity) |
| 6 | Provider throws `AbortError` | One row, `error` contains `AbortError`; re-thrown object still has `name === 'AbortError'` (protects Rules Index #23) |
| 7 | `writeCallLog` throws | Live: response still returned, `logId:null`. Dry-run: still blocked, `logId:null`, provider still never called |
| 8 | Setting flipped between two calls in one process | Second call observes the new value — proves no caching |
| 9 | Payload hygiene | `JSON.stringify(row.requestPayload)` contains neither `sk-ant` nor the value of `ANTHROPIC_API_KEY`; contains `system` and `messages` |
| 10 | `stream()` with `stopReason:'max_tokens'` | Gateway logs and returns it unchanged; gateway itself throws nothing (the domain rule belongs to the caller) |
| 11 | Model resolution | `req.model` omitted → row's `model` equals `provider.defaultModel()`; provider received the resolved value |
| 12 | Signal passthrough | The exact `AbortSignal` instance passed in reaches `fake.complete`'s argument (`toBe`) |

### 10.2 `lib/ai/__tests__/architecture.test.ts` — fitness function

Reads every `.ts`/`.tsx` under `lib/`, `app/`, and `scripts/` and asserts:
- `@anthropic-ai/sdk` is imported by **exactly one** file: `lib/ai/anthropicProvider.ts`.
- The strings `getClient(` and `.messages.create(` / `.messages.stream(` appear nowhere
  outside that file.

~15 lines, no new dependency, and it is the only durable defense against a future session
quietly re-opening a direct SDK path. This project has no ESLint config (roadmap Tier 5), so
a test is the available enforcement mechanism. **Sequencing note: it fails until Phase 2.4
deletes `client.ts` — it is added at the end of Phase 2, not in Phase 1.**

### 10.3 Repository tests

- `lib/db/repository/__tests__/settings.test.ts` — insert/upsert semantics, `updatedAt`
  bump, `getAllSettings` shape, missing key returns `null` (not a throw).
- `lib/db/repository/__tests__/llmCallLog.test.ts` — write returns an id; list ordering
  (`createdAt DESC, id DESC`); `dryRun`/`kind`/`limit` filters; list rows **omit** payloads;
  `getCallLog` returns them; module exports no update/delete.

### 10.4 Route tests

- `app/api/settings/__tests__/settings.test.ts` — `GET` returns defaults with
  `isDefault:true` when unset; `PATCH` valid → persisted and `isDefault:false`;
  unknown key → 400; wrong datatype → 400.
- `app/api/llm-call-log/__tests__/llm-call-log.test.ts` — list shape/filters; detail
  includes payloads; unknown id → 404; `limit` above cap → 400.
- **Dry-run end-to-end (the strongest test in the plan)** — new
  `app/api/agents/__tests__/import-dryrun.test.ts` and a new case in the existing
  `app/api/chat/__tests__/chat.test.ts`. These mock **the provider module**
  (`vi.mock('lib/ai/anthropicProvider.js', () => ({ createAnthropicProvider: () => fake }))`)
  rather than the caller, so the *real* caller, the *real* gateway, and the *real* route all
  execute. With `liveLlmCalls = 'false'`:
  - response is `409` with `error:'llm_dry_run'`, `dryRun:true`, a non-null `logId`, and the
    correct `kind` for each of the three call sites (`import-strict`, `import-structural`,
    `chat`);
  - `fake.complete` / `fake.stream` were never called;
  - exactly one `llm_call_log` row exists, with `dryRun:true`;
  - **zero agent-side writes** — no new/changed `agent`, `agentSection`, `sectionRevision`,
    or `agentSnapshot` rows (this is what proves invariant 8).

### 10.5 Existing tests

All 132 must remain green **without modification**. They mock at the caller level, so the
retrofit is invisible to them — which is itself a useful regression signal: if an existing
test needs editing, something about the caller contract changed that this plan did not
intend. `chat.test.ts` gains one new case (above) rather than edits to old ones.

### 10.6 Component tests — explicitly accepted gap (risk 12)

`ImportDialog.tsx` and `ChatPanel.tsx` get new dry-run branches with **no unit tests**, and
this plan does not add any. That is consistent with `plans/roadmap.md` Tier 5, which already
names "no component/UI tests" as a known, accepted gap — adding React Testing Library, a
jsdom environment, and a split vitest config is genuinely separate infrastructure work and
does not belong inside this plan.

Two things make the risk smaller than it looks, and both should be stated when this is
reviewed rather than glossed over:

1. **This feature makes its own UI verification free and safe.** With "Live LLM calls" off,
   clicking Import or sending a chat instruction exercises the entire UI path — including
   the new inline notice and the log deep link — while spending **$0** and making **zero**
   API calls. That is the only UI change in this repo's history that can be manually
   verified without either mocking or spending money, and it directly serves standing
   rule 2.
2. The logic added to each component is a single early-return branch on an explicit
   discriminant, not new stateful behavior.

Mitigation: a written manual verification checklist in Phase 5's gate, run against a live
dev server with the switch **off**, then the server shut down (standing rule 3).
Recommendation logged separately for the roadmap: add component-test infrastructure as its
own Tier 5 item.

---

## 11. Implementation sequence

Phases are gated: do not start the next until the current gate passes. Every gate includes
`npx tsc --noEmit` clean and `npm test` green.

### Phase 0 — Schema, repositories, settings catalog *(no behavior change anywhere)*

| Step | File | Depends on |
|---|---|---|
| 0.1 | `lib/db/schema.ts` — add `setting`, `llmCallLog` (§4.1, §4.2) | — |
| 0.2 | Generate migration `0002_*` (§4.3). **Dev server must be stopped.** | 0.1 |
| 0.3 | `lib/db/repository/settings.ts` (`getSetting`/`setSetting`/`getAllSettings`) | 0.2 |
| 0.4 | `lib/db/repository/llmCallLog.ts` (`writeCallLog`/`listCallLogs`/`getCallLog`) | 0.2 |
| 0.5 | `lib/db/repository/index.ts` barrel exports | 0.3, 0.4 |
| 0.6 | `lib/settings.ts` — `SETTING_DEFS` + `getLiveLlmCalls()` incl. the §6 truth table | 0.3 |
| 0.7 | `lib/db/seed.ts` — `liveLlmCalls` row, **`onConflictDoNothing`** (§4.4) | 0.6 |
| 0.8 | Repository tests (§10.3) | 0.5 |

**Gate 0:** 132 existing + new repo tests green; `tsc` clean; the app behaves *identically*
(nothing reads the new tables yet). Immediately after 0.2, run `npm test` alone — that is
the risk-3 tripwire.

### Phase 1 — Provider + gateway *(built, tested, still unused by the app)*

| Step | File | Depends on |
|---|---|---|
| 1.1 | `lib/ai/provider.ts` — types + interface (§3.1) | — |
| 1.2 | `lib/ai/anthropicProvider.ts` — SDK singleton moved from `client.ts` (§3.2). `client.ts` still exists and still works. | 1.1 |
| 1.3 | `lib/ai/gateway.ts` — gate/log/forward, `LlmDryRunBlockedError` (§3.3) | 1.2, Phase 0 |
| 1.4 | `lib/ai/__tests__/gateway.test.ts` (§10.1) | 1.3 |

**Gate 1:** gateway suite green. Zero production call sites changed — the app is still on
`client.ts`, so this phase is fully revertable by deleting three files.

### Phase 2 — Retrofit the three callers *(behavior-preserving except the new dry-run path)*

| Step | File | Notes |
|---|---|---|
| 2.1 | `importConverter.ts` | `gateway.complete`, `kind:'import-strict'`, `maxTokens: 4096`. Caller keeps all JSON/label validation. |
| 2.2 | `structuralConverter.ts` | `gateway.stream`, `kind:'import-structural'`, `maxTokens: 32000`. **Keeps its own `stopReason === 'max_tokens'` check** (risk 7). |
| 2.3 | `chatMediator.ts` | `gateway.complete`, `kind:'chat'`, `maxTokens: 8192`, `signal` forwarded (risk 6). Split-level demotion untouched. |
| 2.4 | **Delete `lib/ai/client.ts`**; add `lib/ai/__tests__/architecture.test.ts` (§10.2) | Only now can the fitness test pass. |
| 2.5 | `scripts/test-structural-import.ts` pre-flight (§7.6 below) | |

All three follow the §3.6 shape exactly. Each caller keeps its existing error classes and
its existing route contract; only the transport underneath changes.

**Gate 2:** all 132 existing tests green **with no edits** (§10.5) + gateway + architecture
tests. `tsc` clean.

**§7.6 — the live harness.** After 2.1–2.3, `scripts/test-structural-import.ts` goes through
the gateway like everything else. Two consequences, both deliberate:
- It now respects the switch — correct, since it is the largest single spender in the repo
  and running it against 15 fixtures is exactly what the switch is for. It also becomes
  auditable (15 log rows per run, with coverage-tuning history).
- It now transitively imports `lib/db/client.ts`, so it opens `myagent.db`. **The dev server
  must be stopped before running it** (standing rule 3 already requires this).
- Add a startup pre-flight: print the resolved `liveLlmCalls` value and **exit immediately
  with a clear message if it is off**, rather than emitting 15 dry-run-blocked rows and
  looking broken.
- *Pre-existing concern, not caused by this plan, flag during 2.5:* the harness dynamically
  imports `server-only`-marked modules under plain `tsx`, and the installed `server-only@0.0.1`
  throws from its default export condition. Confirm the harness still starts; if it does
  not, that is a pre-existing break to fix or log separately, not a regression from
  this plan.

### Phase 3 — Routes: propagate the dry-run signal

| Step | File |
|---|---|
| 3.1 | `app/api/agents/import/route.ts` — resolve `agentId`/`agentLabel` (§5.2) for both pipelines, pass `ctx`, catch `LlmDryRunBlockedError` **first** → 409 (§7.2) |
| 3.2 | `app/api/chat/route.ts` — same; the catch order must be `LlmDryRunBlockedError` → `ChatMediatorUpstreamError` → `AbortError` → generic |
| 3.3 | Dry-run end-to-end route tests (§10.4) |

**Gate 3:** all three call sites return 409 with a valid `logId` when the switch is off;
live paths provably unchanged (existing tests). `tsc` clean.

### Phase 4 — Settings API + page + Topbar *(parallelizable — see §11.1)*

| Step | File |
|---|---|
| 4.1 | `app/api/settings/route.ts` (GET + PATCH) + tests |
| 4.2 | `app/api/llm-call-log/route.ts` + `[id]/route.ts` + tests |
| 4.3 | `app/settings/page.tsx` (server component, §5.4) |
| 4.4 | `app/components/Settings/SettingsView.tsx` — toggle; Dry-run/Live/All filter; table (timestamp, kind, agent, status, model, duration); row expand for payloads; `?log=<id>` highlight + scroll |
| 4.5 | `app/components/shell/Topbar.tsx` — `⚙ Settings` link |

Status column is **derived**, not stored: `dryRun → "Dry-run"`, `error → "Error"`,
else `"OK"`.

**Gate 4:** routes tested; page renders with real data; toggle round-trips to the DB and the
*next* AI call observes it without a restart (verify with the switch off — costs nothing).

### Phase 5 — UI dry-run handling

| Step | File |
|---|---|
| 5.1 | `ImportDialog.tsx` — check `body.dryRun` **before** `!response.ok`; neutral (not red) inline panel: message + `View log entry →` link to `/settings?log=<id>`; dialog stays open, pasted text preserved; link omitted with "(log entry could not be written)" when `logId` is null |
| 5.2 | `ChatPanel.tsx` — same check; render as an assistant-role notice bubble with the link; the existing `finally` already releases the interaction lock — **verify it does** on this path |

**Gate 5 (manual, dev server + browser, switch OFF so it is free):** import a `.md` →
blocked notice + working link; send a chat instruction → blocked bubble + working link,
input re-enabled, lock released; the linked log row is highlighted on `/settings` and shows
the full request payload; flip the switch on in the UI and confirm the *next* call is live
(**stop here and ask the user before actually making that live call** — standing rule 2);
**shut the dev server down** (standing rule 3).

### Phase 6 — Documentation sync

| Step | File |
|---|---|
| 6.1 | `lib/ai/CLAUDE.md` — rewrite: `client.ts` is gone, the gateway is the choke point, the one-SDK-importer rule, the dry-run contract |
| 6.2 | `design/TechDesign.md` — new Rules Index entries (continue at #41): the single-choke-point rule, dry-run hard-stop semantics, log-write placement + failure policy, settings default-on/garbage-off, `agentId`-never-backfilled, append-only log. Add the §14 rows to Deferred Decisions |
| 6.3 | `plans/roadmap.md` — move this work into "What's built"; add the deferred items; add the component-test-infrastructure recommendation |
| 6.4 | `docs/user-guide.md` — a short "Settings: dry-run mode and the activity log" section |
| 6.5 | `CLAUDE.md` — a pointer entry, in the same shape as the Plan 01/02 pointers |

### 11.1 Dependencies and parallelization

```
Phase 0 ──┬─► Phase 1 ──► Phase 2 ──► Phase 3 ──┐
          │                                     ├─► Phase 5 ──► Phase 6
          └─► Phase 4 ─────────────────────────-┘
```

- **Phase 0 blocks everything.**
- **Phase 4 depends only on Phase 0** (it needs the tables and repositories, not the
  gateway) and can be built in parallel with 1–3 by a second worker. Its only coupling to
  Phase 3 is the `?log=<id>` deep-link target, which is a URL contract fixed in this
  document.
- **Phase 5 needs both 3 (response shape) and 4 (link target).**
- Phase 6 is last so the docs describe what actually shipped.

### 11.2 Risk per phase

| Phase | Risk | Mitigation |
|---|---|---|
| 0 | A malformed migration silently breaks all 132 tests (risk 3) | Generate, never hand-edit; run `npm test` immediately after 0.2 and nothing else; commit `.sql` + snapshot + journal together |
| 0 | `DoUpdate` in the seed silently re-enables live calls every `npm run dev` | `onConflictDoNothing`, with the reason written in a comment at the call site (§4.4) |
| 1 | Provider abstraction subtly changes SDK behavior | Move `client.ts`'s singleton verbatim; Phase 1 changes zero call sites, so any difference surfaces in Phase 2 against unchanged tests |
| 2 | Cancellation silently regresses to "cancelled client-side, still billed" (risk 6) | `signal` is a first-class `LlmRequest` field; gateway re-throws the original error object; tests §10.1 #6 and #12 assert both halves |
| 2 | Structural truncation check drifts to the wrong layer (risk 7) | `stopReason` is on the normalized response; the check stays in `structuralConverter.ts`; existing `structural.test.ts` truncation test still passes unmodified |
| 2 | The live harness starts spending money or hits a DB lock | Pre-flight print + early exit; dev server off (§7.6) |
| 3 | A caller's catch-all misclassifies a block as 502 | The check lives outside the `try` (§3.6) + a redundant re-throw guard + the §10.4 end-to-end test |
| 4 | Settings page navigation breaks the workbench layout | The page renders `<Topbar />` itself; `WorkbenchShell` and `app/layout.tsx` are untouched (§5.4) |
| 5 | New UI branches have no unit tests (risk 12) | Accepted gap, consistent with roadmap Tier 5; manual checklist at Gate 5, free to run because dry-run costs nothing (§10.6) |
| all | An accidental real API call during build/verification | Standing rule 2. All tests mock the provider module; the only live path requires an explicit ask |

---

## 12. Impact-report risk → resolution map

| # | Risk | Resolved in |
|---|---|---|
| 1 | Settings row absent between migration and seed | §6 — fail-open (default on); §4.4 seed is `DoNothing` |
| 2 | `agentId` unknown at import call time | §5.2 — best-effort + `agentLabel`, never backfilled |
| 3 | Migration/test-db coupling | §4.3, Gate 0 tripwire, §11.2 |
| 4 | New `lib/ai/` → `lib/db/` dependency | §2.1 — confined to `gateway.ts`, no cycle, stated as a design principle |
| 5 | Log-write location (must pick one) | §3.3 — **gateway**, with the comparison table and the type-separation answer to its objection |
| 6 | `AbortSignal` must survive the abstraction | §3.1 (`LlmRequest.signal`), §3.3 step 4 (original error re-thrown), §10.1 #6/#12 |
| 7 | `stream()` differs structurally; `stop_reason` is a domain rule | §3.5 — normalized `stopReason`, check stays in the caller |
| 8 | Lazy SDK singleton reuse | §3.2 — moved verbatim into the provider, one instance per process |
| 9 | Toggle caching | §6 — fresh read every call, with the "unreliable switch" rationale |
| 10 | No test reaches the gateway | §10.1 (12 cases incl. `not.toHaveBeenCalled()`), §10.2 fitness test, §10.4 end-to-end |
| 11 | No test precedent for Settings pages/routes | §10.4 — route tests follow the existing `app/api/**/__tests__` pattern; the page is a server component whose logic is the (tested) repository |
| 12 | `ImportDialog`/`ChatPanel` have no tests | §10.6 — explicitly accepted, consistent with roadmap Tier 5, with a manual checklist and the "free to verify" argument |
| 13 | Streaming surface must stay unbuffered | §3.5 — SDK's own `finalMessage()`, no added layer, incremental access deferred |

---

## 13. Plan B interaction (strictly the two allowed constraints)

**Deliberately set up for Plan B:**

| Plan B need | How this plan accommodates it | Cost when Plan B lands |
|---|---|---|
| `settings.maxUsers` | `setting` is genuine EAV (`key`/`value` PK+text, no per-setting columns); `SETTING_DEFS` is an array driving parsing, the API allowlist, and the UI | One appended `SETTING_DEFS` entry. No migration, no route change, no UI change |
| `llm_call_log.userId` | Single-column PK, no composite keys, no `NOT NULL` that would need a default, and `listCallLogs` selects **explicit columns** so a new column cannot leak into the list DTO unnoticed | `ALTER TABLE llm_call_log ADD COLUMN user_id TEXT;` + one field in the insert. Nullable rows from before Plan B stay valid and mean "pre-auth" |

**Deliberately NOT accommodating Plan B** (called out so it is a choice, not an oversight):

- **No auth on `/api/settings` or `/api/llm-call-log`.** Consistent with every existing route
  in this local-only app. `GET /api/llm-call-log/[id]` returns full system prompts and full
  agent content — when Plan B ships, **these two route files must be in its first auth
  pass**, and the log list must gain ownership filtering. Recorded here so Plan B inherits
  the obligation explicitly.
- **No ownership on log rows or settings.** `setting` stays *global/operator* scope; a
  per-user setting in Plan B is a different table, not a column added to this one.
- **No per-user or per-tenant API keys.** One server-side key, per Design Principle #7.
- **No user concept anywhere** — not in `LlmCallContext`, not in the DTOs, not in the UI.

---

## 14. Deferred decisions (this plan's additions to the `TechDesign.md` table)

| Item | Why deferred | Revisit when |
|---|---|---|
| Second provider implementation (NVIDIA / OpenAI-compatible) | The interface is the deliverable; a second implementation without a real target model, key handling, and its own prompt-compatibility testing is speculation | An actual second provider is chosen, with a key and a model to test against |
| Runtime provider selection (`LLM_PROVIDER` env, a real factory switch) | With one provider, an env var is unused config surface that must still be validated and documented. `getGateway()` constructing `createAnthropicProvider()` directly is the honest state | The second provider exists (same trigger as above) |
| Incremental streaming (`streamChunks(): AsyncIterable<string>`) for token-by-token UI | Nothing consumes deltas today — `structuralConverter` awaits `finalMessage()`. Adding it is purely additive to `LLMProvider` | Streaming chat responses become a real UX requirement (Plan 01 D1 deferred streaming for the same reason) |
| Log retention / pruning / pagination | A local single-user DB will not notice a few thousand rows; a retention policy needs a real answer about what may be discarded | `llm_call_log` exceeds ~5,000 rows or `myagent.db` exceeds ~200 MB |
| Cost estimation in currency on log rows | Needs a per-model price table that goes stale silently and would be wrong in a way that matters | Token usage stops being sufficient to answer "what did that cost" |
| "Replay this request" from a dry-run log row | The stored `requestPayload` already contains everything needed (system, messages, model, maxTokens) — the data model supports it, the UI does not | Dry-run is used enough that re-running a recorded request by hand becomes a papercut |
| Per-caller dry-run granularity (block imports, allow chat) | One global switch is the requirement; per-kind switches multiply the states to reason about and to test | A real workflow needs one kind live while another is blocked |
| A Settings modal instead of a full-page navigation | Full navigation discards `ChatPanel`'s message history | Losing chat history when opening Settings turns out to be an actual annoyance in use |
| Component/UI tests for `ImportDialog` / `ChatPanel` | New test infrastructure (RTL + jsdom + split vitest config); separate work | Taken up as its own roadmap Tier 5 item |
| Alerting / thresholds on repeated `error` rows | There is no alerting channel in a local app | The app goes online (learning-goals roadmap) |
| Compliance-grade (non-droppable) logging | §5.5 deliberately treats the log as diagnostics, not a ledger | The log is ever needed as evidence rather than as a debugging aid |

---

## 15. Deviations from the approved `@analyst` task description

Small, deliberate, and each one revertable during review:

1. **Table named `setting`, not `settings`.** Every table in `schema.ts` is singular
   (`agent`, `config_def`, `group`, `membership`, `section_revision`). Consistency wins;
   say the word and it becomes `settings`.
2. **`llm_call_log` has two columns beyond the analyst's list:** `provider` (so a second
   provider is a value, not a migration) and `agentLabel` (without it, every first-time
   import row shows "—" in the log's Agent column, which guts the page's usefulness — see
   §5.2).
3. **A third new API file:** `app/api/llm-call-log/[id]/route.ts`, so the list response can
   stay lean while a single row can still be expanded to show full payloads.
4. **A ninth new lib file:** `lib/settings.ts` (the `SETTING_DEFS` catalog + typed
   accessors), keeping the repository as pure storage and the catalog in code — mirroring
   how `CONFIG_DEFS` relates to `configDef`.
5. **Dry-run HTTP status chosen as `409`** with a dual-shaped body (the analyst left the
   status open) — reasoned in §7.2, including why 200 and 503 were rejected.
6. **One extra test file** (`architecture.test.ts`, §10.2) that is a fitness function rather
   than a behavior test.

---

## 16. Decisions needed before build starts

Everything the impact report flagged is resolved above; nothing is left open by omission.
What remains is **confirmation**, not discovery — these are the points where a different
call is defensible and the user's preference should decide:

1. **§15.1 — `setting` vs. `settings` as the table name.** Codebase convention vs. the
   analyst's wording.
2. **§7.2 — `409` for the dry-run response.** If you would rather it be `200` + discriminant
   (matching `skipped:'unchanged'`), say so now: it changes both UI branches and all three
   route mappings, and it is cheap now and annoying later.
3. **§6 — "garbage value ⇒ off" (fail-closed) alongside "missing row ⇒ on" (fail-open).**
   The asymmetry is intentional; if you would rather have one uniform rule, the alternative
   is "anything that isn't exactly `'false'` means on", which is simpler but lets a corrupt
   value spend money.
4. **§10.6 — accepting no component tests for the two modified UI components**, with the
   manual Gate 5 checklist as the compensating control.
5. **§4.2 — storing full prompts in `requestPayload` with no size cap or truncation.** This
   is what makes the log an audit log rather than a counter, at ~30–60 KB per structural row.
   If unbounded local growth is unwelcome, the alternative is a cap (e.g. 64 KB with a
   `truncated: true` marker), decided now rather than after rows exist.
