# Plan 07 — Prometheus: System-Agent Rework, New Output Contract, and Propose-then-Apply

> **Status: 🟢 Phases 0–2 built and gated 2026-08-05 by `@dev`. Phases 3–7 explicitly NOT
> built — see Progress Log below for exactly why and what's excluded. Nothing committed.**

## Progress Log

**2026-08-05 — §17 confirmation points answered** (by the user, in review, not all matching
the plan's own recommendations):

| # | Question | Answer |
|---|---|---|
| 1 | Rename through the `.ts` layer? | **Yes** — full rename, as recommended. |
| 2 | Model wiring now or deferred? | **Deferred.** |
| 3 | Section add/delete via chat? | **Both out of scope.** Logged to `plans/roadmap.md` **TODO item 13** (not FUTURE — deliberately kept visible for pre-launch review, not left to drift). |
| 4 | Dynamic system prompt now or deferred? | **Deferred**, after the tradeoff was walked through explicitly (no user-visible difference; theoretical prompt-caching upside only, unmeasured). |
| 5 | May Prometheus edit `description` in scoped mode? | **Superseded**, not just answered — the plan's own §5.4 rule ("description always kept, since it's always grounded") was replaced with a stricter rule: **only when the instruction is explicitly about the description**, regardless of citation state. Written directly into `prometheus.md` GUARDRAILS as rule #3. |
| 6 | Server-resolved `expectedVersion` (last-write-wins) — accept? | **Accepted**, tradeoff explicitly understood. Surfaced a new, separate FUTURE item: session/device management (view + remote-log-out other active sessions) — logged to `plans/roadmap.md` FUTURE, bucket not yet settled. |
| 7/8 | Apply mechanism (endpoint, atomicity, path) | **Cut from this plan entirely.** The user decided mid-review that Phase 3 (the apply endpoint + config-merge fix) and Phase 4 (the `localStorage` lock/store) are substantial enough to warrant their **own separate future plan**, not a continuation of this one. This plan stops at "Prometheus's answer is computed and returned correctly" — it does not build a way to apply it yet. |

**2026-08-05 — Phases 0, 1, 2 implemented by `@dev`, scope trimmed to match the table above:**

- **Phase 0** (trimmed): `architecture/layout/Layout-Workbench.html` — `✦ Mediator` → `✦ Prometheus`
  everywhere; added a simple, **read-only, non-interactive** proposal preview (no Apply/Discard,
  no lock banner — those belong to the deferred Phase 3/4/5). Not gated on user sign-off, unlike
  the original Phase 0 spec (that gate existed to protect Phase 5, which isn't happening here).
- **Phase 1**: built exactly as originally specified — mechanical rename only, `lib/ai/chatMediator.ts` → `lib/ai/prometheus.ts`, all symbols renamed per §3.2's table, `chat-mediator.md` kept alongside `prometheus.md` until Phase 2 flips over. Gate passed: `tsc` clean, 502/502 tests, zero `chatMediator`/`ChatMediator`/`CHAT_MEDIATOR` hits in any `.ts`/`.tsx` file.
- **Phase 2**: built exactly as originally specified, **including the transitional behavior in step 5** — sections still auto-apply to the DB exactly as before this plan; `description`/`config` are parsed, filtered, and returned in the response but **not written anywhere**. New 3-step parser + full §4.3 tolerance table implemented; `## Current config` block + `citedConfigKeys` scoping wired into the prompt. `chat-mediator.md` deleted. Gate passed: `tsc` clean, **541/541 tests** (39 new), zero deviations from spec.
- **Explicitly NOT built, still pending a future decision:** Phase 3 (apply endpoint + config-merge fix — the highest-risk item in the whole plan), Phase 4 (proposal store + interaction lock), Phase 5 (the full ChatPanel UI — ChatPanel.tsx itself is untouched; the browser still shows the old client-synthesized summary, not `message`), Phase 6 (live verification — needs a real Anthropic API call and its own explicit go-ahead per standing rule 2, not implied by anything said so far), Phase 7 (doc sync — can't be written honestly yet, since most of the planned doc changes describe the *finished* propose→apply flow, which doesn't exist).
- **No commits made.** No real API calls made. No dev server left running.
- **One thing flagged, not a code issue:** `PushNotification` reported mobile push is disabled in `/config`, despite Remote Control being connected — worth checking that toggle if pings to the phone matter going forward.

**2026-08-05 — `prometheus.md` reformatted to real-agent shape, reopening §3.1/§17 (user decision, overrides the earlier "not part of this plan" framing):**

- The user decided `prometheus.md` should look like an actual Claude Code subagent file —
  YAML frontmatter (`name`, `description`, `tools: []`) instead of a prose `## IDENTITY`
  section, and every top-level section (`ROLE`, `BEHAVIOR`, `GUARDRAILS`, `OUTPUT FORMAT`) at
  `#` instead of `##` — modeled on `architecture/Agent-Full-Reference.md`, the same canonical
  structure `Concept.md` documents as what the workbench itself mirrors.
- `scripts/build-prompts.ts`'s `extractPromptContent()` no longer assumes one shape: it now
  detects a leading `---` frontmatter block and, when present, strips it and returns
  everything after the closing `---` **verbatim** (no more "first `## ` heading" search for
  that file) — matching how a real subagent file's body becomes its system prompt. The
  legacy "strip to first `##`" path is kept, unchanged, for the two import-converter prompts,
  which were not touched and still use the old `# Title` + `## SECTION` shape.
- `model` stays unset in frontmatter, with a comment explaining why (§17.2 is still
  deferred). `tools: []` is written for schema parity with real agent files and documents
  GUARDRAILS #6 — it is not read by any code path (Prometheus is called directly via the
  Anthropic SDK, not through the Claude Code agent runtime).
- Regenerated and verified: `PROMETHEUS_PROMPT` now begins cleanly at `# ROLE`, frontmatter
  fully stripped; the two import prompts' generated output is byte-for-byte unaffected.
  `tsc --noEmit` clean, **541/541 tests** still pass unchanged (`prometheus.test.ts` mocks
  the generated module directly, so prompt-content changes don't touch it).
- This supersedes §3.1's description of the compiled prompt starting at `## IDENTITY` — that
  section no longer exists; IDENTITY's old Name/Description/Model prose is now frontmatter
  (name, description) plus the pre-existing `# ROLE` prose, which already restated identity
  in natural language for the model, matching how real subagent files work (frontmatter is
  metadata for tooling; the body re-establishes identity itself).
>
> **Origin.** `plans/roadmap.md` TODO item 2 — *"Section-scoped chat selection"* — and its
> **"Design session 2026-08-05 — mediator rework"** block, which is the authoritative
> decision record for everything here. It also closes TODO item 3 (*"Review the chat-mediator
> system agent"*) and **supersedes TODO item 6** (*"Propose-preview before applying a mediator
> rewrite"*, already marked superseded in the roadmap): propose-then-apply is built here as
> the sole, unconditional behavior, not as a per-user opt-in modal.
>
> **What this is, in one line.** The chat mediator becomes **Prometheus** — a real agent
> authored in MyAgent's own Agent pattern — its output contract grows from
> `{ sections }` to `{ message, modifications }`, its editable surface grows from sections to
> *everything except `name`*, and `POST /api/chat` stops writing to the database entirely:
> it proposes, and a separate explicit **Apply** writes.
>
> **Numbering:** `07` is correct. `01`–`06` are the existing numbered execution specs;
> `plans/roadmap.md` and `plans/Evaluation-260730.md` are deliberately unnumbered.
>
> **Standing project rules apply in full** (root `CLAUDE.md`):
> 1. **No commits without an explicit ask.** No phase in §14 ends with a commit instruction.
>    Report status and wait.
> 2. **No real Anthropic API call without an explicit ask.** Every test in this plan mocks the
>    AI layer, matching every existing suite (`vi.mock('.../ai/*.js', …)`). Exactly one phase
>    (§14 Phase 6) needs real calls, it is gated on an explicit go-ahead, and §14 Phase 4/5
>    show how to verify the whole propose→apply→lock flow **with zero LLM calls at all**.
> 3. **Dev server off** after any verification session.
> 4. **Layout prototyped in `architecture/layout/Layout-Workbench.html` first.** §9.6 rules
>    the ChatPanel work **non-trivial** — the prototype is Phase 0, not waived.

---

## 0. What this plan is, in one paragraph

Today `POST /api/chat` does four things in one request: load the agent, ask the model for
rewritten sections, write them to the database, and return what it wrote. The model can only
touch sections, its answer to the user is thrown away (the client synthesizes `"Updated: X."`
from the keys that came back), and the user finds out what changed only after it already
changed. This plan splits that apart. The system agent is renamed and re-authored as
**Prometheus** and returns a real chat `message` plus a `modifications` object covering
`description`, `sections`, and `config`. The chat route becomes **read-only against the
database** — it returns a *proposal*. A new endpoint, `POST /api/agents/[id]/apply-proposal`,
performs the write when the user clicks **Apply**, merging config changes onto the agent's
current full config set (without that merge, applying a one-key config change would wipe every
other config value — §6.4, the single highest-risk defect this plan exists to avoid). While a
proposal is pending, manual editing is locked; the proposal and the lock survive a reload via
`localStorage`. There is **no schema change and no migration** anywhere in this plan.

### Explicitly NOT in this plan

Each of these was raised and deliberately excluded. Re-scoping any of them mid-build is a
replan, not a judgment call.

| Excluded | Why / where it lives |
|---|---|
| Per-part apply (one section, one config key) | Decision **E** — apply-all only. Already logged to `plans/roadmap.md` FUTURE. |
| An instant/auto-apply option or per-user toggle | Decision **D**. Logged to FUTURE ("Instant auto-apply mode (revisit)"). |
| Any server-side validation of AI-proposed content | Decisions **J**/**P** — "never block" is project-wide. §6.5. |
| Version-conflict checking at apply time | Decision **G** — the lock replaces it. §6.6. |
| A DB table for pending proposals | Decision **H** — `localStorage` only. |
| Chat/prompt history persistence and replay | Decision **N** — `plans/roadmap.md` NEXT item 2. `llm_call_log` already stores every request/response; only UI replay is missing. |
| Real Anthropic tool-calling | Decision **M** — `LlmRequest` has no `tools` field anywhere in the chain. Prometheus's "no tools" guardrail is structurally true; nothing to build. |
| Multi-platform import/export agents | Decision **Q** — `plans/roadmap.md` FUTURE. |
| System agents becoming DB-backed, UI-editable agents | Decision **Q** — FUTURE ("far far away"). Prometheus stays a **build-time-compiled static prompt**; only its content and name change. |
| Server-enforced (non-cooperative) editing lock | Accepted gap, FUTURE. §8.6. |
| Cross-device awareness of a pending proposal | Accepted gap, FUTURE. §8.6. |
| Adding or deleting sections via chat | §17.3 — **open**, recommended out of scope. |
| Wiring a declared model for Prometheus | §17.2 — **open**, recommended deferred. |
| Building the system prompt dynamically per request | §17.4 — **open**, recommended deferred. |
| A manual description editor in the UI | §9.5 — description is read-only in the UI today and stays that way; chat becomes the only way to change it. |

---

## 1. Guiding constraints (locked — do not replan during build)

1. **`POST /api/chat` performs zero writes to `agent`, `agent_section`, `agent_config`, or
   `section_revision`.** It is a read + an LLM call + a response. The only row it may cause to
   be written is the `llm_call_log` row the gateway already writes. This is the load-bearing
   constraint of the whole plan and the easiest one to assert in a test.
2. **Full-value replacement, never diffs.** Every value in `modifications` is the complete new
   value. The model is never asked to reproduce a "before" value; any before/after display is
   assembled from state the server or client already holds (Decision **A**).
3. **`agent.name` is never chat-editable**, and that is enforced **server-side at apply**, not
   only by a prompt guardrail (Decision **B**).
4. **No new validation of AI-authored content.** An AI-proposed config value is written exactly
   like a manually-typed one. Shape errors (a section value that isn't a string) are handled by
   dropping that one entry with a recorded warning — never by rejecting the turn (Decisions
   **J**/**P**).
5. **The config write path always merges onto the current full config set** before calling
   `updateAgent()`, because `updateAgent()` full-replaces config rows (Decision **I**, §6.4).
6. **One pending proposal per (user, agent), and only the latest turn's is actionable**
   (Decision **F**).
7. **The pending-proposal lock is client-side and cooperative**, exactly as `interactionLock`
   already is. No route rejects a manual edit because a proposal is pending. This is a known,
   accepted limitation, not an oversight (Decision **H**, §8.6).
8. **No schema change, no migration, no `drizzle` change.** If a phase seems to need one, stop
   and re-plan.
9. **Ownership stays enforced in the repository**, in the same statement that touches the row
   (Plan 05 constraint 1, Rules Index #48–#50). The new apply endpoint adds no new ownership
   mechanism — it calls existing owner-scoped repository functions.
10. **The gateway stays the single choke point** (Rules Index #41). Prometheus's caller module
    keeps the exact caller shape from `lib/ai/CLAUDE.md` § "Callers — shape", including the
    dry-run / cap refusal ordering.
11. **Everything Prometheus is shown, the server chose.** No agent content ever comes from the
    request body into the LLM call (Rules Index #7). The *apply* request body is different and
    is client-supplied by necessity — see §12.2 for why that is not a privilege escalation.
12. **Tests never make a real API call.** Every new or rewritten suite mocks either the caller
    module or `anthropicProvider.js`, matching the existing pattern.

---

## 2. Architecture

### 2.1 What changes in the layering

Nothing moves between layers. The gateway, provider, and repository are untouched in shape.
Two things change:

```
BEFORE
  ChatPanel ──POST /api/chat──▶ route ──▶ callChatMediator ──▶ gateway ──▶ provider
                                  │
                                  └──▶ updateSectionContent()   ← the write, same request

AFTER
  ChatPanel ──POST /api/chat──▶ route ──▶ callPrometheus ──▶ gateway ──▶ provider
                                  │
                                  └──▶ (no writes — returns a proposal)

  ChatPanel ──POST /api/agents/[id]/apply-proposal──▶ apply route
                                  ├──▶ updateSectionContent()  (per changed section, author 'ai')
                                  └──▶ updateAgent()           (description + MERGED full config)
```

The second change is in the client: `WorkbenchShell` gains a persisted `pendingProposal` and a
fourth `interactionLock` state.

### 2.2 Files

| File | Change |
|---|---|
| `lib/ai/prompts/system-agents/prometheus.md` | **Exists (content draft).** Not edited by this plan except as §17 answers require. |
| `lib/ai/prompts/system-agents/chat-mediator.md` | **Deleted** in Phase 2, once nothing imports its compiled constant. |
| `scripts/build-prompts.ts` | `AGENTS[]` gains `{ file: 'prometheus', constName: 'PROMETHEUS_PROMPT' }` (Phase 1) and loses the `chat-mediator` entry (Phase 2). |
| `lib/ai/chatMediator.ts` | **Renamed** → `lib/ai/prometheus.ts` (§3.2, pending §17.1). Rewritten parser, new types, config + description in the request. |
| `app/api/chat/route.ts` | Stops writing. Returns a proposal. Gains `citedConfigKeys` handling. |
| `app/api/agents/[id]/apply-proposal/route.ts` | **New.** The only writer in this flow. |
| `lib/db/repository/agents.ts` | **Unchanged.** `updateAgent()` and `updateSectionContent()` are used as-is; the merge happens in the apply route (§6.4, §17.6). |
| `app/components/WorkbenchShell.tsx` | `InteractionLock` gains `'proposal'`; owns the pending proposal; passes it to `ChatPanel` and `AgentView`. |
| `app/components/Chat/ChatPanel.tsx` | Renders `message` as the bubble; renders the proposal card; Apply / Discard; label `✦ Mediator` → `✦ Prometheus`. |
| `app/components/CustomViz/AgentView.tsx` | `canEdit` accounts for `'proposal'`; **config editing gains a lock check it does not have today** (§8.5 — a real gap found during this design). |
| `app/components/CustomViz/SectionBlock.tsx` | `canEdit` accounts for `'proposal'`. |
| `lib/proposalStore.ts` | **New.** `localStorage`-backed store with a `useSyncExternalStore`-compatible surface (§8.3). |
| `architecture/layout/Layout-Workbench.html` | Phase 0 prototype: proposal card, Apply/Discard, lock banner, `✦ Prometheus` label. |
| `app/api/chat/__tests__/chat.test.ts` | Rewritten for propose-only. |
| `app/api/chat/__tests__/chat-dryrun.test.ts` | Minor update (import path); its assertions mostly survive. |
| `app/api/agents/[id]/__tests__/apply-proposal.test.ts` | **New.** Includes the config-merge regression test. |
| `lib/ai/__tests__/prometheus.test.ts` | **New.** Parser unit tests. |

**No schema files, no migrations, no `lib/db/schema.ts` change.**

---

## 3. The rename

### 3.1 The prompt-content layer (settled)

`chat-mediator.md` → `prometheus.md`, already drafted. `scripts/build-prompts.ts` compiles it
to `lib/ai/prompts/generated/prometheus.ts` exporting `PROMETHEUS_PROMPT`. `chat-mediator.md`
and its `AGENTS[]` entry are deleted once the caller has flipped over (Phase 2 — not Phase 1,
so the repo is never in a state where the app imports a constant that is no longer generated).

`build-prompts.ts`'s `extractPromptContent()` strips everything before the **first `## `
heading**. `prometheus.md`'s first `##` is `## IDENTITY`, so the compiled prompt begins at
IDENTITY and the `# Prometheus` title line is dropped — correct and consistent with the two
import prompts. **Verify this in Phase 1** by reading the generated file; it is a one-line
check that catches a whole class of silent breakage.

### 3.2 The `.ts` layer (recommended, needs confirmation — §17.1)

**Recommendation: rename all the way through.**

| Today | Recommended |
|---|---|
| `lib/ai/chatMediator.ts` | `lib/ai/prometheus.ts` |
| `callChatMediator()` | `callPrometheus()` |
| `MediatorInput` | `PrometheusInput` |
| `MediatorSection` | `PrometheusSection` |
| `MediatorResult` | `PrometheusProposal` |
| `ChatMediatorUpstreamError` | `PrometheusUpstreamError` |
| `ChatMediatorInvalidResponseError` | `PrometheusInvalidResponseError` |
| `parseMediatorResponse()` (private) | `parsePrometheusResponse()` (**exported**, for unit tests — same treatment `demoteSplitLevelHeadings` already gets) |

Rationale: the two sibling callers are already named after the system agent's role
(`importConverter.ts`, `structuralConverter.ts`), so a neutral technical name would be the odd
one out rather than the consistent choice; every one of these symbols is being rewritten in
this plan anyway, so the rename is close to free now and pure churn later; and leaving
"ChatMediator" in the module a developer reads first, while every doc and prompt says
"Prometheus", is exactly the kind of drift Rules Index #63 exists to punish.

Counter-argument, recorded honestly: `chatMediator` describes the *mechanism* (the thing that
mediates between chat and the agent), which survives any future re-branding of the agent's
persona. If the user prefers persona-independent module names, the alternative is: keep
`lib/ai/chatMediator.ts` and `callChatMediator()`, rename only the prompt file, the constant,
and the user-visible label. **Both are coherent; pick one in §17.1.** The rest of this plan is
written assuming the full rename and marks the affected lines with the new names.

### 3.3 What must NOT be renamed

Historical records — dated statements of what was actually built at the time, when "chat
mediator" was the real name. Rewriting them misrepresents history, the same principle that
keeps `CHANGELOG.md` from ever being retro-edited:

- `plans/01-core-loop-implementation-plan.md`
- `plans/04-llm-gateway-settings.md`
- `plans/05-multi-tenant-auth.md`
- `architecture/audits/Fable-Review-1.md`
- `CHANGELOG.md` (all existing entries)

Living docs that **do** get updated: root `CLAUDE.md` (1 ref), `lib/ai/CLAUDE.md` (7 refs),
`architecture/TechDesign.md` Rules Index + Deferred Decisions (§16), `docs/user-guide.md`.
`plans/roadmap.md`'s 2026-08-05 notes are already accurate — only the item status lines change.

---

## 4. The new output contract

### 4.1 Shape

Already written into `prometheus.md` § OUTPUT FORMAT. The TypeScript mirror:

```ts
export type PrometheusModifications = {
  description?: string;                      // whole new description
  sections?: Record<string, string>;         // sectionKey → whole new content
  config?: Record<string, unknown>;          // propKey → whole new value; null = delete the key
};

export type PrometheusProposal = {
  message: string;                           // the real chat answer, always shown
  modifications: PrometheusModifications;    // {} when nothing changed
  warnings: string[];                        // server-generated, never from the model (§4.3)
};
```

| Field | Rule |
|---|---|
| `message` | Always present. Becomes the assistant bubble text. Replaces the client-synthesized `"Updated: X."` summary. |
| `modifications.description` | Full replacement string. Present only if changed. |
| `modifications.sections` | One entry per **changed** section. Value is the complete new content. Absent keys are untouched. |
| `modifications.config` | One entry per **changed** config key. Value is the complete new value (a whole list for `tools`, not a delta). `null` means *delete this key*. |
| `warnings` | **Not part of the model's contract.** Added by the server's parser to record what it had to drop (§4.3). Always an array, usually empty. |

### 4.2 Parsing — extraction

Today's extraction is a single greedy `responseText.match(/\{[\s\S]*\}/)`. Replace with an
ordered three-step attempt, each falling through to the next:

1. `JSON.parse(responseText.trim())` — the normal case for a well-behaved model.
2. Strip a leading/trailing code fence (```` ```json ```` … ```` ``` ````), then parse.
3. The existing greedy first-`{`-to-last-`}` slice, then parse.

If all three fail → `PrometheusInvalidResponseError('response is not valid JSON')`. This is
strictly more robust than today and costs ~10 lines. It matters more now than before, because
`message` is free prose that can legitimately contain braces and backticks.

### 4.3 Parsing — validation, and the tolerance rule

The parser distinguishes **structural failure** (nothing usable — throw) from **one bad entry**
(drop it, record a warning, keep the rest). Dropping silently would be dishonest; that is what
`warnings` is for, and the UI surfaces it (§9.4).

| Condition | Behavior |
|---|---|
| Not valid JSON after all three extraction attempts | **Throw** `PrometheusInvalidResponseError` → route returns `502 ai_upstream` |
| Root is not a JSON object (array, string, number, `null`) | **Throw** |
| `message` missing, `null`, or not a string | **Tolerate**: use `''`, push warning `"Prometheus returned no message."` The UI shows a neutral placeholder. Discarding a good set of edits over a cosmetic field is the worse failure. |
| `modifications` missing or not a plain object | **Tolerate**: use `{}`, push a warning. (A model that answers a pure question may reasonably omit it, even though the prompt says to send `{}`.) |
| `modifications.description` present but not a string | **Drop** that key + warning |
| `modifications.sections` present but not a plain object | **Drop** the whole `sections` key + warning |
| A `sections[key]` value is not a string | **Drop that key** + warning; keep the other sections |
| `modifications.config` present but not a plain object | **Drop** the whole `config` key + warning |
| A `config[key]` value of any JSON type, including `null` | **Pass through unchanged.** No datatype, `allowedValues`, or `required` check — ever (constraint 4). |
| `modifications.name` present | **Drop** + warning `"Prometheus proposed a name change; agent names are not chat-editable."` (Constraint 3 — belt to the apply route's braces.) |
| A `sections[key]` value of `""` | **Keep.** Emptying a section's content is an edit, not a deletion. Section deletion is §17.3. |
| An unknown `sectionKey` or `propKey` | **Keep at parse time.** Resolution against the real agent happens at §5.4 (scope filter) and §6.3 (apply). Custom config keys are a real, supported concept. |

### 4.4 Split-level demotion — where it runs now

`demoteSplitLevelHeadings` (Rules Index #3) currently runs twice: inside the caller, and again
inline in `route.ts` immediately before the write. Under propose-then-apply it must run in
**three** logical places, which is two implementations:

1. **At propose time**, inside `callPrometheus()`, over every `modifications.sections` value —
   so the content the user reviews in the proposal card is byte-identical to what will be
   written. Unchanged code, new call site.
2. **At apply time**, inside the apply route, over every section value in the request body —
   because the body is client-supplied and the apply route is the authoritative write gate.
   This is `route.ts`'s existing inline `demoteHeadings()` helper, **moved** to the apply
   route. `app/api/chat/route.ts` no longer needs it (it no longer writes), but keeping the
   propose-time demotion in the caller means the two never disagree.

Do **not** delete the duplicated implementation in favor of importing the caller's version into
the route: the existing chat tests mock the whole caller module, so a route that relies on the
caller's demotion has no demotion at all under test. That reasoning is already recorded in
`app/api/chat/route.ts`'s comment and still holds for the apply route.

---

## 5. What the server attaches to the call

### 5.1 Always attached, regardless of citation

`agentName`, `agentDescription`, `splitLevel`. Unchanged from the 2026-07-31 first backend
pass, and it matters more now: because `description` is always attached, Prometheus is always
*grounded* on it, so a description edit is legitimate even in scoped mode (§5.4).

### 5.2 Unscoped (nothing cited) — Decision **C**

The **full agent**: every section's content **and every config key's current value**, plus the
blueprint catalog (`renderBlueprintForPrompt()`, default `includeConfig: true`, unchanged).

Config values have never been sent to the mediator before, cited or not. This is a **real, new,
deliberate default token cost** on every unscoped chat turn. §12.1 quantifies it.

`PrometheusInput` gains:

```ts
config: { propKey: string; value: unknown }[];   // current values, server-loaded from the DTO
citedConfigKeys?: string[];
```

Rendering in the user message: a `## Current config` block after `## Current sections`, one
line per key — `propKey: <JSON.stringify(value)>`. JSON, not YAML, so a list, a nested
`hooks`/`mcpServers` object, and a plain string are all unambiguous and round-trip cleanly into
the `config` map the model must return.

### 5.3 Scoped (something cited)

Citation narrows, exactly as it does today. `citedSectionKeys` filters sections;
**`citedConfigKeys` filters config** the same way — this is the wiring the roadmap flagged as
"config citation is still UI-only." Both arrive as separate arrays; `ChatPanel` derives them
from the existing `citedItems` by `type`.

The existing scoping note in `buildUserMessage()` is extended to name both kinds:

> The user has focused this instruction on: `<sections: role, output>` `<config: tools>`. Only
> those are shown below — you have not been given the agent's other sections or config values,
> so do not reference or attempt to change them.

Four combinations, all valid: sections only (config withheld), config only (sections withheld),
both, neither (= unscoped, §5.2).

### 5.4 The out-of-scope filter, and where it now lives

Today `route.ts` skips any returned `sectionKey` outside the cited set, at write time, because
the model was never shown that content so an edit to it cannot be a grounded diff. That rule
survives verbatim and gains two more subjects, but it **moves to propose time** — the filter
runs when the proposal is assembled, so the user never sees a proposed change that would then
be silently dropped on Apply.

| Part | Scoped-mode rule |
|---|---|
| `sections[key]` | Dropped unless `key ∈ citedSectionKeys`. Warning recorded. |
| `config[key]` | Dropped unless `key ∈ citedConfigKeys`. Warning recorded. |
| `description` | **Kept** — description is always attached (§5.1), so it is always grounded. |

The last row is a genuine judgment call; see §17.5.

Unscoped mode filters nothing here — but the apply route still skips a `sectionKey` that
matches no row on the agent (§6.3), which is a different check for a different reason.

---

## 6. Propose-then-apply

### 6.1 `POST /api/chat` — the propose call

Request body — unchanged except one new optional field:

```jsonc
{
  "agentId": "…",
  "instruction": "…",
  "dryRun": false,                       // optional, may only downgrade (Rules Index #61)
  "citedSectionKeys": ["role"],          // optional
  "citedConfigKeys": ["tools"]           // optional — NEW
}
```

`citedConfigKeys` is validated exactly like `citedSectionKeys` is today: an array of strings or
it is ignored entirely (falling back to unscoped) rather than rejecting the request.

Success response — **new shape, 200**:

```jsonc
{
  "proposal": {
    "message": "I tightened OUTPUT FORMAT and switched the model to opus.",
    "modifications": {
      "sections": { "output": "…complete new content…" },
      "config":   { "model": "claude-opus-5" }
    },
    "warnings": []
  },
  "meta": {
    "agentId": "…",
    "proposedAt": "2026-08-05T12:00:00.000Z",
    "scoped": false,
    "citedSectionKeys": [],
    "citedConfigKeys": []
  }
}
```

The old `{ sections: { key: {content, version} | {conflict…} } }` shape is **gone**. The only
consumer is `ChatPanel` in this repo, so no versioning or deprecation window is needed
(§12.4). Error responses (400/401/404/409 dry-run/429/499/502/500) are byte-identical to today
— see §11.

A **question-only turn** returns `modifications: {}`. That is a first-class case, not an error,
and it must not set the pending-proposal lock (§8.4).

### 6.2 `POST /api/agents/[id]/apply-proposal` — the write

**Path choice.** Under `/api/agents/[id]/…`, alongside `sections/[sectionId]`, `groups`, and
`export`. Two reasons: the action is "write to this agent," so it belongs under the agent
resource where ownership scoping is structurally obvious; and constraint 1 declares
`/api/chat` write-free, so putting a DB writer at `/api/chat/apply` would immediately muddy
the rule this plan is built on. (Alternative considered and rejected: `POST /api/chat/apply`,
which keeps the conversational flow in one namespace.)

Request body:

```jsonc
{
  "modifications": {
    "description": "…",                       // optional
    "sections": { "output": "…" },            // optional
    "config":   { "model": "claude-opus-5", "tools": null }   // optional; null = delete key
  }
}
```

Response `200`:

```jsonc
{
  "agent": { /* full AgentDTO, freshly re-read */ },
  "applied": { "description": true, "sectionKeys": ["output"], "configKeys": ["model"] },
  "skipped": [ { "part": "section", "key": "ghost", "reason": "no_such_section" } ]
}
```

Returning the whole `AgentDTO` lets the client swap state wholesale — exactly what
`AgentView.saveConfig()`'s `onAgentUpdated(dto)` already does — instead of merging partial
results client-side. One call, one state replacement, no drift.

### 6.3 Apply algorithm (order is normative)

1. `authenticate()` → 401.
2. Parse body; `modifications` must be a plain object; `sections` values must be strings;
   `config` must be a plain object → otherwise `400 invalid_body`. This is *shape* validation
   only, never *content* validation (constraint 4).
3. `const agent = getAgentFull(id, session.userId)` → `404 not_found` if null. This both
   enforces ownership and gives the current sections (id + version) and current config.
4. **Drop `modifications.name` if present** — record in `skipped`, never write it
   (constraint 3).
5. **Sections first.** For each `[sectionKey, content]`:
   - resolve the section row by `sectionKey` from the loaded agent. Unknown → push to
     `skipped` (`no_such_section`) and continue. (`sectionKey` is not unique across `custom`
     rows — last-in-order wins, the same documented MVP caveat as today's chat route.)
   - `const safe = demoteHeadings(content, agent.splitLevel)` (§4.4).
   - `updateSectionContent(id, section.id, session.userId, safe, 'ai', section.version)` —
     `expectedVersion` is the version just read from the DB in step 3, i.e. a deliberate
     force-write (§6.6).
6. **Description and config together, in one `updateAgent()` call**, and only if at least one
   of them changed:
   - `description`: included only if present and different from `agent.description`.
   - `config`: **merged** — see §6.4. Never the raw diff.
7. `return getAgentFull(id, session.userId)` — a fresh read, so the response reflects both the
   section writes and the agent-row write.

### 6.4 The config merge — Decision **I**, the highest-risk item in this plan

`updateAgent()` (`lib/db/repository/agents.ts` ~line 754) does this when `config` is supplied:

```ts
tx.delete(schema.agentConfig).where(eq(schema.agentConfig.agentId, agentId)).run();
if (updates.config.length > 0) { tx.insert(schema.agentConfig).values(/* only what was given */).run(); }
```

**A full replace.** Passing Prometheus's `{ model: 'claude-opus-5' }` straight through would
delete `tools`, `subagent_type`, `hooks`, and everything else on the agent. Silently. With no
error. This is the defect this section exists to prevent, and §13.3 makes it a named regression
test.

The apply route must build the **merged full set** first — the same pattern
`AgentView.saveConfigKey()` already uses client-side (`[...without, { propKey, value }]`),
generalized to N keys and extended with deletion:

```ts
// agent.config is the CURRENT full set, from step 3's getAgentFull()
const merged = new Map<string, unknown>(agent.config.map((c) => [c.propKey, c.value]));
for (const [propKey, value] of Object.entries(modifications.config ?? {})) {
  if (value === null) merged.delete(propKey);   // null = delete the key (§4.1)
  else merged.set(propKey, value);
}
const configRows = [...merged].map(([propKey, value]) => ({ propKey, value }));
// only now:
updateAgent(id, session.userId, { description?, config: configRows });
```

`undefined` is not reachable through JSON and is not a delete sentinel — only literal `null` is.

**Only pass `config` to `updateAgent()` when `modifications.config` is present and non-empty.**
Passing the merged set unconditionally would rewrite every config row on a description-only
apply — harmless in outcome, but it churns rows and would mask a merge bug in testing.

### 6.5 No validation — Decisions **J** and **P**

Confirmed during design and re-confirmed against the code while writing this plan:
`PATCH /api/agents/[id]` validates only that `config` is an *array*. It never checks a value
against `configDef.datatype`, `allowedValues`, or `required`, even for a manually typed value.
`agent.name` is stored verbatim ("flag-don't-block", Rules Index #1) and `AgentView`'s
`isBadListItem()` flags anomalies client-side only, never blocking a save.

Therefore: **an AI-proposed config value gets exactly the same treatment as a hand-typed one —
none.** The existing client-side flagging catches anomalies after the fact, on the next render,
identically for both. Adding datatype or `allowedValues` enforcement here — even "just for AI
values," even as a nice-to-have — would introduce precisely the asymmetric strictness the
project has now made a standing principle against. Do not add it.

### 6.6 No version-conflict check — Decision **G**

`updateSectionContent()` requires an `expectedVersion`, so a value must be supplied. Two
options existed:

- (a) the client sends the version it saw at propose time → a real optimistic-concurrency check
  that can fail at apply;
- (b) the apply route reads the current version in step 3 and passes that → a force-write.

**(b) is specified**, because Decision G replaces version checking with the lock: while a
proposal is pending, nothing in this browser can change the agent underneath it, so an
apply-time conflict can only originate from the already-accepted cross-device gap (§8.6). Under
(a), that rare case would surface as a hard failure the UI has no story for; under (b) it
overwrites, and `section_revision` (append-only, `author: 'ai'`) preserves what was overwritten,
which is the project's existing recovery model for exactly this. §17.6 records this as a
confirmable judgment call.

Consequence to state plainly in the docs: **Apply is last-write-wins.**

---

## 7. API surface

### 7.1 Endpoints

| Method | Path | Auth | Request | Response | Writes? |
|---|---|---|---|---|---|
| `POST` | `/api/chat` | session | `{ agentId, instruction, dryRun?, citedSectionKeys?, citedConfigKeys? }` | `200 { proposal: { message, modifications, warnings }, meta }` | **No** (only the gateway's `llm_call_log` row) |
| `POST` | `/api/agents/[id]/apply-proposal` | session, owner | `{ modifications: { description?, sections?, config? } }` | `200 { agent: AgentDTO, applied, skipped }` | Yes — `agent_section`, `section_revision`, `agent`, `agent_config` |

Unchanged and still used by the apply flow's neighbors: `PATCH /api/agents/[id]` (manual config
+ rename), `PATCH /api/agents/[id]/sections/[sectionId]` (manual section save, `author: 'user'`).

### 7.2 Backward compatibility

`POST /api/chat`'s success body changes shape with no versioning. Acceptable and preferred
because: the only consumer is `ChatPanel.tsx` in this same repo, changed in the same plan;
there is no public API, no second client, and no external integration (the MCP-server idea is
`plans/roadmap.md` NEXT item 17, not built). A `v2` path or a dual-shape response would be pure
ceremony. **Record it as a deliberate breaking change in `CHANGELOG.md` when this ships.**

---

## 8. Client state: the pending proposal and the lock

### 8.1 Where it lives

`WorkbenchShell` owns it, next to `interactionLock` and `citedItems`, and passes it down. It
must not live inside `ChatPanel`, because `AgentView`/`SectionBlock` need the lock too and
`ChatPanel` is a sibling.

```ts
export type InteractionLock = 'chat' | 'edit' | 'proposal' | null;

export interface PendingProposal {
  v: 1;                                  // schema version — a future shape change discards cleanly
  agentId: string;
  userId: string;
  proposedAt: string;                    // ISO
  message: string;
  modifications: PrometheusModifications;
  warnings: string[];
}
```

### 8.2 Storage key and scoping — Decision **H**

`myagent:proposal:<userId>:<agentId>` — `userId` from the `session` prop already threaded into
`WorkbenchShell` (`Session.userId` exists). Both parts are required: without `agentId` a stale
proposal bleeds across agents; without `userId` it bleeds across accounts sharing a browser.

`localStorage` only. **No DB table, no cookie, no server session state.**

### 8.3 Synchronous restore without a hydration mismatch

The requirement is: restored during initial state setup, **not** in a post-paint `useEffect`,
so there is no window where editing looks available before the lock reasserts.

A naive `useState(() => JSON.parse(localStorage.getItem(key)))` satisfies that on the client
but produces a **React hydration mismatch**, because `WorkbenchShell` is server-rendered (a
client component rendered from a server component) and the server has no `localStorage`. The
purpose-built answer is `useSyncExternalStore`, which takes a `getServerSnapshot` for exactly
this case and reconciles to the client value as part of hydration, without a mismatch warning
and before any event handler is attached — i.e. before a user can start an edit.

`lib/proposalStore.ts` (client-only module, no `server-only` import):

```ts
export function subscribe(cb: () => void): () => void;             // window 'storage' + a local emitter
export function getSnapshot(userId: string, agentId: string): PendingProposal | null;
export function getServerSnapshot(): null;
export function writeProposal(p: PendingProposal): void;           // notifies subscribers
export function clearProposal(userId: string, agentId: string): void;
```

Two implementation traps to state explicitly, because both cause infinite render loops or
silent breakage and both are easy to hit:

1. **`getSnapshot` must be referentially stable.** Parse once and cache the object per key;
   return the *same* reference until a write or a `storage` event invalidates it. Returning a
   freshly `JSON.parse`d object each call makes React re-render forever.
2. **Every read is wrapped in `try/catch`** and treats malformed JSON, a `v !== 1` payload, or a
   `userId`/`agentId` mismatch inside the payload as "no proposal" — and clears the key. A
   corrupted entry must never be able to permanently lock a user out of editing.

Because `subscribe` listens to the `storage` event, cross-tab behavior comes along for free:
applying or discarding in one tab clears the proposal in another open tab on the same agent.
That is a bonus, not a requirement; if it proves noisy, dropping the `storage` listener
degrades to "restored on load only," which is the stated requirement.

**Quota:** wrap `setItem` in `try/catch`. On `QuotaExceededError` (a proposal rewriting several
very large sections), keep the proposal in memory only, and push a warning into the card:
"This proposal is too large to survive a page reload." Never let a storage failure lose the
proposal or block Apply.

### 8.4 State machine

| Event | Proposal | `interactionLock` | `localStorage` |
|---|---|---|---|
| Idle | none | `null` | absent |
| Send message | cleared first (Decision **F**) | `'chat'` | cleared |
| Response, `modifications` non-empty | set | `'proposal'` | written |
| Response, `modifications` empty (question-only) | **none** | `null` | untouched/cleared |
| Response is an error / dry-run / cap-blocked | none | `null` | cleared |
| Cancel in flight | none | `null` | cleared |
| Apply → `200` | cleared; agent state replaced from `applied.agent` | `null` | cleared |
| Apply → error | **kept** | stays `'proposal'` | kept |
| Discard (explicit button) | cleared | `null` | cleared |
| Reload / new tab | restored from `localStorage` | `'proposal'` if restored | read |
| Switch agent | n/a — the page remounts `WorkbenchShell` with `key={agent.id}`, and the initializer reads the new agent's own key | | |

The **question-only** row is critical: if a turn with no modifications set the lock, asking
"what do you think of my tools list?" would lock manual editing with nothing to apply and no
obvious way out. It must not.

An explicit **Discard** affordance is required (not optional): without it, the only exit from
the lock is sending another chat message, which costs an API call to undo a UI state.

### 8.5 What the lock must actually block — a real gap found during this design

Today `canEdit = interactionLock !== 'chat'` appears in exactly two places:
`AgentView.tsx:249` (used only for the **name** editor) and `SectionBlock.tsx:208` (the section
**raw-edit** button). Both become:

```ts
const canEdit = interactionLock !== 'chat' && interactionLock !== 'proposal';
```

**But config editing is not gated by `interactionLock` at all today.** The model/effort
selects, list add/remove, the `datatype: 'json'` block editor, and the per-key remove `×` all
call `saveConfig()` with no lock check whatsoever. Under Decision **G**, config is now part of
the proposable surface, so manual config editing *must* be blocked while a proposal is pending
— otherwise the exact conflict the lock exists to prevent stays wide open on the one surface
this plan newly makes AI-editable.

**Phase 4 therefore extends the lock to the config zone**, gating every config mutation entry
point on the same `canEdit`. Two notes: (1) this incidentally closes a pre-existing hole where
config could be edited mid-chat-call, which is a small behavior change beyond this plan's
headline scope — desirable, and worth calling out in the changelog; (2) disabled controls need
the same `title` treatment the name editor already has, so the reason is visible on hover.

### 8.6 Accepted residual gaps (do not re-litigate — already in `plans/roadmap.md` FUTURE)

1. **The lock is client-side and cooperative.** No route rejects a manual edit because a
   proposal is pending. True of `interactionLock` generally since Plan 01 (Rules Index #22);
   this plan does not make it worse. Revisit trigger: a second official client, a public API,
   or adversarial use.
2. **`localStorage` does not sync across devices or browsers.** A pending proposal on a laptop
   does not block a manual edit from a phone on the same account. Accepted at the app's real
   scale. Revisit trigger: real usage producing actual overwrites.

---

## 9. ChatPanel UI

### 9.1 The message bubble

`ChatPanel.tsx` lines ~172–191 currently build `"Updated: role, output."` / `"No sections
changed."` from the response keys. **Delete that.** The assistant bubble renders
`proposal.message` verbatim. The `✦ Mediator` label (two occurrences, plus the mockup) becomes
`✦ Prometheus`.

The existing `changedSectionKeys` target chips (`◆ section · <key>`) stay useful as a
one-glance summary under the bubble, now sourced from `Object.keys(modifications.sections)` and
extended with `◆ config · <key>` and `◆ description` chips — the R13 note in the file header
("only section changes are chipped — never config, the real mediator doesn't edit config") is
now obsolete and must be rewritten, not left contradicting the code.

### 9.2 The proposal card

Rendered under the bubble of the **latest** turn only.

- **Header:** "Proposed changes" + a one-line summary — *"2 sections · 1 config key ·
  description"* — with the body **collapsed by default**. The chat panel is 240px tall by
  default; a card that expands a 60-line section rewrite by default makes the panel unusable.
- **One row per changed part:**
  - `Description` → the new value.
  - `Section · <sectionKey>` → the complete new content in a monospace / fenced block (the
    user asked for "a markdown code block per changed part").
  - `Config · <propKey>` → the new value as JSON; a `null` value renders as
    **"Remove this key"**, never as the literal `null`.
- **Before/after:** each row may offer a "show current" disclosure. The "before" value is read
  from the `AgentDTO` already in `WorkbenchShell` state — **never** from the model, and never
  from a new server field (constraint 2). This is safe because the lock guarantees the DTO is
  still the correct baseline while the proposal is pending.
- **Long values collapse** behind "show more" past ~12 lines.
- **Footer:** `[Apply]` `[Discard]`, plus the caption *"Editing is locked until you apply or
  discard."*

### 9.3 Card states

| State | Rendering |
|---|---|
| Pending | Full card, both buttons live |
| Applying | Buttons disabled, spinner on Apply, card content frozen |
| Applied | Card collapses to a muted "✓ Applied" line; buttons gone |
| Failed | Card stays pending; an inline error line above the buttons; Apply re-enabled |
| Superseded (a newer message was sent) | The older turn's card is not re-rendered at all — only the latest turn's proposal exists in state (Decision **F**) |
| Restored from `localStorage` after reload | Identical to Pending, with the caption *"Proposed <relative time> ago"* from `proposedAt`, so a day-old restored proposal is not mistaken for a fresh one |

### 9.4 Warnings

If `proposal.warnings` is non-empty, the card shows a muted line per warning above the footer
— e.g. *"Prometheus proposed a change to a section you didn't cite (`role`); it was not
included."* Silently dropping a proposed change is exactly the kind of thing that makes a tool
feel unpredictable.

### 9.5 Description is chat-only

`AgentView.tsx:1420` renders `agent.description` read-only; there is no manual description
editor anywhere in the UI. This plan does **not** add one — but it does mean chat becomes the
only way to change a description, which makes the description row in the proposal card the
first and only place a user ever sees a description edit. Worth one line in
`docs/user-guide.md`. (Adding a manual description editor is a reasonable, separate roadmap
item; it is not scoped here.)

### 9.6 Standing rule 4 — this **is** non-trivial; prototype first

A verdict is required, and it is: **prototype in `architecture/layout/Layout-Workbench.html`
before touching React.** This is not a one-line style tweak — it is a new composite component
(collapsible multi-part card, per-part code blocks, before/after disclosure, two actions, five
visual states) living inside a 240px-tall panel, plus a new lock signal, plus a label change.
The mockup already has a static chat transcript (`.chat`, `.msg`, `.bubble`, `.target` around
lines 320–340 and 438–450) to extend, and prototyping there costs no dev server, no DB, and no
LLM call.

**Prototype scope (Phase 0):** static markup + CSS only — the card in its Pending and Applied
states, the collapsed/expanded summary, the `[Apply]`/`[Discard]` footer, the "editing locked"
banner, and disabled-looking config/section controls. No fetch logic, no state machine. Sign-off
on the visuals is the phase gate.

---

## 10. Business rules

### Invariants (always true)

1. `POST /api/chat` never writes to `agent`, `agent_section`, `agent_config`, or
   `section_revision`.
2. `agent.name` is never changed by the chat flow — enforced in the apply route, not only by
   the prompt.
3. Every value in `modifications` is a complete replacement value; no diff or patch format ever
   crosses the wire.
4. The model is never asked for, and never trusted with, a "before" value.
5. A config apply always writes the **merged full set**; a partial config map never reaches
   `updateAgent()`.
6. AI-proposed content receives no validation the manual path does not also receive.
7. At most one pending proposal exists per `(userId, agentId)`, and only the most recent turn's
   is actionable.
8. Every section content written by the apply route has been split-level-demoted by the apply
   route itself, regardless of what the caller already did.
9. Prometheus only ever sees content the server chose to attach (Rules Index #7).
10. Every write in the apply route goes through an owner-scoped repository function; a
    cross-owner id yields `404`, never `403` (Rules Index #50).
11. Section revisions created by Apply carry `author: 'ai'`; manual saves keep `author: 'user'`.

### Policies (configurable / conventional)

1. `liveLlmCalls` (Settings) gates the propose call at the gateway, as today. **Apply is not an
   LLM call** and is unaffected by dry-run mode — a proposal produced before the toggle was
   turned off can still be applied.
2. The per-user hourly LLM cap (Plan 05 §3.9) applies to propose only, for the same reason.
3. Apply granularity is **all-or-nothing per turn** (Decision E).
4. Apply is **last-write-wins** (§6.6).
5. Prometheus is instructed to propose a concrete edit whenever an instruction reasonably calls
   for one, rather than holding back on vague instructions, because the human's Apply click is
   the safety gate (Decision **K** — already in `prometheus.md` § BEHAVIOR; no code impact).

### State transitions

1. `idle → chat` — user sends a message; any pending proposal is discarded first.
2. `chat → proposal` — a 200 with non-empty `modifications`.
3. `chat → idle` — a 200 with empty `modifications` (question-only), or any error / dry-run /
   cap-block / cancel.
4. `proposal → idle` — Apply succeeds, or Discard.
5. `proposal → proposal` — Apply fails; the proposal survives and remains applicable.
6. `proposal → chat` — a new message is sent; the previous proposal is discarded unapplied.
7. `edit ⇄ idle` — unchanged manual-edit lock behavior.
8. `proposal` and `edit` are mutually exclusive by construction: while `'proposal'` is set,
   every editor entry point is disabled, so `'edit'` can never be entered.

---

## 11. Error handling

| Scenario | Status | Response shape | Logged? |
|---|---|---|---|
| `/api/chat` malformed body | 400 | `{ error: 'invalid_body', fields }` | no |
| `/api/chat` unauthenticated | 401 | existing guard response | no |
| `/api/chat` unknown / non-owned `agentId` | 404 | `{ error: 'not_found' }` | no |
| `/api/chat` live calls off (dry run) | 409 | `{ error: 'llm_dry_run', dryRun, kind, model, logId, message }` | `console.info` — unchanged |
| `/api/chat` per-user cap reached | 429 + `Retry-After` | `{ error: 'llm_cap_reached', limit, windowSeconds, retryAfterSeconds, canDryRun }` | gateway `console.info` — unchanged |
| `/api/chat` client cancelled | 499 | `{ error: 'cancelled' }` | no |
| `/api/chat` upstream API failure | 502 | `{ error: 'ai_upstream' }` | `console.error`, message only, never the prompt or key |
| `/api/chat` unparseable model response | 502 | `{ error: 'ai_upstream' }` | `console.error` with the parse reason, **never the raw response text** (it contains agent content) |
| Model returned partially-bad `modifications` | 200 | `proposal.warnings[]` populated; the good parts survive | `console.warn` per dropped entry |
| Model returned an out-of-scope key in scoped mode | 200 | dropped + warning | `console.warn` — unchanged behavior, new location |
| Apply: malformed body | 400 | `{ error: 'invalid_body', field }` | no |
| Apply: unauthenticated | 401 | existing guard response | no |
| Apply: unknown / non-owned agent | 404 | `{ error: 'not_found' }` | no |
| Apply: unknown `sectionKey` | 200 | listed in `skipped[]`, other parts still applied | `console.warn` |
| Apply: `name` present in payload | 200 | listed in `skipped[]` | `console.warn` |
| Apply: unexpected write failure | 500 | `{ error: 'internal' }` | `console.error` |
| Client: `localStorage` unavailable / quota exceeded | n/a | proposal held in memory; card shows "won't survive reload" | `console.warn` |
| Client: corrupted `localStorage` entry | n/a | treated as "no proposal"; key cleared | `console.warn` |

**Partial-apply honesty.** The apply route is **not atomic across parts** (§17.7): sections are
written by N separate `updateSectionContent()` transactions, then description+config by one
`updateAgent()` transaction. If step 6 throws after step 5 succeeded, the sections are already
written. The response is a 500 and the client keeps the proposal, so re-applying is possible
and idempotent for sections (same content, new revision row) and for config (the merge is
computed from the then-current state each time). Re-applying is safe; that is the mitigation.

---

## 12. Non-functional requirements

### 12.1 Cost and performance

- **New default token cost:** every unscoped turn now sends all config values. Typical agents
  carry ~5–15 config keys of short scalars and small lists (a few hundred tokens), but
  `initialPrompt`, `hooks`, and `mcpServers` (`datatype: 'json'`) can each be large. Worst
  realistic case is low thousands of tokens added to a prompt that already carries every
  section plus the blueprint catalog. **Accepted deliberately** (Decision C); citation is the
  escape hatch for users who care, and it now narrows config too (§5.3).
- **`maxTokens: 8192`** on the chat request is unchanged. Note the output now also carries
  `message` prose; a turn rewriting several long sections is marginally closer to truncation
  than before. `stop_reason` is not currently checked in this caller (unlike
  `structuralConverter`) — leaving that as-is, but §18 flags it as cheap to add.
- **Apply latency:** one DB round trip, no network egress, no LLM call. Sub-10ms locally; the
  user-visible cost of propose-then-apply is one extra click, not one extra wait.
- **No new N+1:** `getAgentFull()` is already one composite read and is called twice in the
  apply flow (before and after) — acceptable and simpler than reconstructing the DTO by hand.

### 12.2 Security

- The apply endpoint accepts **client-supplied content**. This is **not** a privilege
  escalation: the same user can already write arbitrary content to their own sections via
  `PATCH /api/agents/[id]/sections/[sectionId]` and arbitrary config via
  `PATCH /api/agents/[id]`. Ownership is enforced identically, in the repository.
- **Honest consequence:** `section_revision.author: 'ai'` after this plan means "applied through
  the chat proposal flow," not a cryptographic claim that a model authored the bytes. Since
  Decision **H** forbids server-side proposal storage, the server has nothing to compare the
  payload against. Say this in `TechDesign.md` rather than letting the column imply more than it
  can.
- No new secret, no new external call, no new env var, no change to the API-key boundary.
- `console.error` on a parse failure must **not** include the raw model response — it contains
  the user's agent content, and the same reasoning that produced the §5.6 consent rules applies.

### 12.3 Data integrity

- Zero schema change. Zero migration. Existing agents are unaffected until a user applies
  something.
- `section_revision` remains the recovery net for any bad apply (Rules Index — the entity exists
  precisely because "one bad AI edit" must be recoverable).
- The config merge (§6.4) is the single point where data loss is possible; it gets a dedicated
  regression test (§13.3).

### 12.4 Scalability

Nothing here scales with user count. `localStorage` holds at most one proposal per agent per
browser. The one new endpoint is O(changed parts) DB writes.

### 12.5 Observability

- `llm_call_log` behavior is entirely unchanged — the full request and response are still stored
  per call, which means **every proposal is already durably logged even though proposals are not
  stored in the DB** (relevant to NEXT item 2, and worth stating so nobody thinks propose-only
  loses history).
- Apply writes no log row of its own. If "who applied what, when" becomes a real question,
  `section_revision` already answers it for sections; config has no history. Recorded as a
  deferred item (§16.3), not built.

---

## 13. Testing approach

### 13.1 The rule that shapes everything

Per root `CLAUDE.md` standing rule 2 and the 2026-07-30 audit recorded in
`plans/roadmap.md`'s stability snapshot: **no test in this suite may make a real Anthropic API
call.** Every new or rewritten suite here follows an existing pattern verbatim —
`vi.mock('.../lib/ai/prometheus.js', …)` for route tests, `vi.mock('.../anthropicProvider.js',
…)` for gateway-path tests, `createGateway(fakeProvider)` for gateway tests. No exceptions, and
no `getGateway()` anywhere under `__tests__/`.

Note on module loading: `lib/ai/prometheus.ts` imports the **generated** prompt constant, and
`lib/ai/prompts/generated/` is gitignored and only produced by `predev`/`prebuild` — `npm test`
has no such hook. `lib/ai/__tests__/prometheus.test.ts` must therefore
`vi.mock('../prompts/generated/prometheus.js', () => ({ PROMETHEUS_PROMPT: '<test prompt>' }))`
so the suite never depends on a build having run. (Route tests are unaffected: they mock the
whole caller module, so the real one is never loaded.)

### 13.2 `lib/ai/__tests__/prometheus.test.ts` — **new**

Unit tests over the exported `parsePrometheusResponse()`:

- bare JSON object; fenced ```` ```json ```` block; JSON preceded by stray prose → all parse.
- invalid JSON → throws `PrometheusInvalidResponseError`.
- root is an array / a string → throws.
- `message` missing → `''` + one warning, `modifications` still parsed (the tolerance rule).
- `modifications` missing → `{}` + one warning.
- a non-string `sections` value → that key dropped + warning; sibling keys survive.
- `config` values of every JSON type survive untouched: string, number, boolean, array, nested
  object, and **`null` preserved as the delete sentinel**.
- `modifications.name` present → dropped + warning.
- split-level demotion applied to every `sections` value at propose time.
- scoped mode: a `sections` key outside `citedSectionKeys` and a `config` key outside
  `citedConfigKeys` are both dropped with warnings; `description` is **kept** (§5.4/§17.5).

### 13.3 `app/api/agents/[id]/__tests__/apply-proposal.test.ts` — **new**

The headline test first:

1. **CONFIG MERGE REGRESSION (the reason this file exists).** Seed an agent with four config
   keys (`model`, `tools`, `subagent_type`, `color`). Apply `{ config: { model: 'x' } }`.
   Assert: `model === 'x'` **and all three other keys still present with their original
   values**. This is the test that fails loudly if anyone ever pipes the diff straight into
   `updateAgent()`.
2. **Config delete.** Apply `{ config: { tools: null } }` → `tools` row gone, the other three
   untouched.
3. **Config add.** A key absent from the agent is inserted; existing keys survive.
4. **Section apply** → content written, `version` bumped by exactly 1, one new
   `section_revision` row with `author: 'ai'`.
5. **Multi-part apply** — description + 2 sections + 1 config key in one call → all four land,
   `applied` reports all four.
6. **Description-only apply** does **not** touch `agent_config` rows at all (§6.4's
   "only pass config when present").
7. **Unknown `sectionKey`** → `skipped[]`, 200, other parts still applied.
8. **`name` in the payload** → ignored, listed in `skipped[]`, `agent.name` unchanged.
9. **Split-level demotion** applied at the apply route even when the payload contains a
   `#`-level heading (proving the route, not the caller, is the gate).
10. **Cross-owner agent id** → 404, zero writes.
11. **Unauthenticated** → 401, zero writes.
12. **Malformed body** (`sections` value is a number) → 400, zero writes.

### 13.4 `app/api/chat/__tests__/chat.test.ts` — rewritten

The existing 23 `chatMediator` references become `prometheus`, and the assertions invert:

- **ZERO WRITES.** The load-bearing test: a successful chat call with a non-empty
  `modifications` leaves `agent_section.content`, `.version`, `section_revision` count,
  `agent.description`, and `agent_config` rows **all byte-identical** to before. This single
  test enforces constraint 1.
- Response shape: `{ proposal: { message, modifications, warnings }, meta }`.
- The server loads sections from the DB and ignores client-supplied content (kept from today).
- Question-only turn (`modifications: {}`) → 200, no writes, `message` present.
- Scoped mode drops out-of-scope section **and config** keys from the proposal, with warnings.
- `citedConfigKeys` malformed (not an array of strings) → ignored, unscoped fallback, 200.
- Config values are present in the input handed to the mocked caller when unscoped, and absent
  when a citation excludes them (assert on the mock's call argument).
- Cancellation (`AbortError`) → 499. *This test gets simpler:* the old version had to prove
  "zero DB writes on cancel"; now zero writes is unconditional.
- 404 unknown agent, 401 unauthenticated — kept as-is.
- **Delete** the version-conflict test (`conflicted section reported individually`) — the
  conflict path no longer exists on this route (§6.6). Do not port it to the apply route; that
  route deliberately has no conflict path.

### 13.5 `app/api/chat/__tests__/chat-dryrun.test.ts` — light touch

It mocks `anthropicProvider.js`, so it exercises the real gateway path. Only the two
`chatMediator` references (import path / mock target) change. Its "zero agent writes" assertion
now holds trivially — keep it anyway, as a second witness for constraint 1.

### 13.6 What must not change

`lib/ai/__tests__/gateway.test.ts`, `gateway-cap.test.ts`, and `architecture.test.ts` are
untouched. If the one-SDK-importer fitness function starts failing, something is very wrong —
stop, do not "fix" the test.

### 13.7 Component tests — the same accepted gap, restated

`ChatPanel`, `WorkbenchShell`, `AgentView`, and the new proposal card have **no automated
coverage**, because the repo has no component-test infrastructure at all. That is
`plans/roadmap.md` NEXT item 1, explicitly scheduled after v1 launches. This plan does not open
that door. The proposal card, the lock, and the `localStorage` restore are therefore verified
**manually**, and §14 Phase 4/5 specify a way to do that with **zero LLM calls** (seed a
proposal into `localStorage` by hand from devtools). When NEXT item 1 lands, the proposal card
and the lock state machine should be near the top of its list.

### 13.8 Full-suite gate

Every phase ends with `npx tsc --noEmit` clean and `npm test` green. Current baseline is
**368/368**; expect roughly +25–35 tests by Phase 5 and a net −1 (the deleted conflict test).

---

## 14. Implementation sequence

Seven phases. Each leaves the repo type-clean, test-green, and functionally coherent — no
phase depends on a later one to stop the app being broken. **No phase ends with a commit
instruction**; report status and wait for the user (standing rule 1).

### Phase 0 — Layout prototype *(no code; parallel with Phases 1–3)*

1. In `architecture/layout/Layout-Workbench.html`: extend the static chat transcript with the
   proposal card (Pending + Applied), the collapsed/expanded summary, `[Apply]`/`[Discard]`,
   the "editing locked" banner, and disabled-looking section/config controls.
2. Rename the transcript's `✦ Mediator` labels to `✦ Prometheus`.
3. **Gate:** the user reviews the mockup in a browser and signs off on the visuals. Nothing in
   Phase 5 starts before this.

### Phase 1 — Rename, with no behavior change *(depends on: nothing)*

1. Add `{ file: 'prometheus', constName: 'PROMETHEUS_PROMPT' }` to `build-prompts.ts`'s
   `AGENTS[]`. **Keep the `chat-mediator` entry** — both compile.
2. Verify the generated `prometheus.ts` begins at `## IDENTITY` (§3.1).
3. Rename `lib/ai/chatMediator.ts` → `lib/ai/prometheus.ts` and every exported symbol per §3.2.
   **The caller still uses `CHAT_MEDIATOR_PROMPT` and still parses `{ sections }`.** Nothing
   about runtime behavior changes.
4. Update `app/api/chat/route.ts` imports and both chat test files' mock targets.
5. **Gate:** `npx tsc --noEmit` clean; `npm test` green at the current count;
   `rg 'chatMediator|ChatMediator|CHAT_MEDIATOR'` returns hits only in the §3.3 historical
   files and the not-yet-updated docs.
   **Risk:** low, purely mechanical. **Mitigation:** do it as one rename commit-shaped change;
   if the suite goes red, it is an import path, not logic.

### Phase 2 — The new output contract *(depends on: Phase 1)*

1. Flip the caller to `PROMETHEUS_PROMPT`; delete `chat-mediator.md` and its `AGENTS[]` entry.
2. New types (`PrometheusProposal`, `PrometheusModifications`), new
   `parsePrometheusResponse()` (§4.2–§4.3), exported for tests.
3. `PrometheusInput` gains `config` and `citedConfigKeys`; `buildUserMessage()` renders the
   `## Current config` block and the extended scoping note (§5.2–§5.3).
4. `app/api/chat/route.ts` passes config values through from `getAgentFull()`, validates
   `citedConfigKeys`, and moves the out-of-scope filter to propose time (§5.4).
5. **Transitional, deliberate:** the route still auto-applies `modifications.sections` exactly
   as today; `description` and `config` are parsed, filtered, and returned in the response but
   **not written**. This keeps the app coherent between phases; Phase 3 removes it.
6. Write `lib/ai/__tests__/prometheus.test.ts` (§13.2). Update chat route tests for the new
   caller return shape.
7. **Gate:** `tsc` clean; suite green; parser tests cover every §4.3 row.
   **Risk:** medium — this is where the prompt and the parser must agree. **Mitigation:** the
   parser tests are written against `prometheus.md`'s § OUTPUT FORMAT text read side-by-side;
   if the two disagree, the prompt is the spec and the parser follows it.

### Phase 3 — The propose/apply split, server side *(depends on: Phase 2)*

1. `app/api/chat/route.ts`: delete the entire apply loop (~lines 184–232) and the inline
   `demoteHeadings` helper; return `{ proposal, meta }`.
2. New `app/api/agents/[id]/apply-proposal/route.ts` implementing §6.3 in that exact order,
   including the §6.4 merge and the §6.6 server-resolved `expectedVersion`.
3. `app/api/agents/[id]/__tests__/apply-proposal.test.ts` (§13.3), config-merge test first.
4. Rewrite `chat.test.ts` around the zero-writes assertion (§13.4); touch `chat-dryrun.test.ts`.
5. **Gate:** `tsc` clean; suite green; the config-merge test demonstrably fails if the merge is
   removed — **prove this once by temporarily reverting the merge**, then restore it. A
   regression test nobody has watched fail is not yet a regression test.
   **Risk:** **highest in the plan** — silent config loss (§6.4). **Mitigation:** the merge is
   specified as literal code, the test is written before the route, and the failure is
   verified.

### Phase 4 — Client state: the proposal store and the lock *(depends on: Phase 3)*

1. `lib/proposalStore.ts` per §8.3, including the referential-stability cache, the `try/catch`
   reads, the `v: 1` guard, and the quota fallback.
2. `WorkbenchShell`: `InteractionLock` gains `'proposal'`; `useSyncExternalStore` wiring; the
   §8.4 state machine; pass the proposal + handlers into `ChatPanel`, pass the lock into
   `AgentView`.
3. `AgentView` and `SectionBlock`: `canEdit` accounts for `'proposal'`; **extend the lock to
   every config mutation entry point** (§8.5) — model/effort selects, list add/remove, JSON
   block editor, per-key remove `×` — each with a `title` explaining why it is disabled.
4. **Verification without a single LLM call:** with the dev server running, open devtools →
   Application → Local Storage, hand-write a `myagent:proposal:<userId>:<agentId>` entry
   matching the `PendingProposal` shape, reload, and confirm (a) the lock is asserted with no
   flash of editable UI, (b) every editor is disabled, (c) Discard clears both the key and the
   lock, (d) Apply calls the real apply endpoint and updates the panels, (e) a corrupted entry
   is discarded rather than locking the user out, (f) a second tab reflects the change.
5. **Gate:** `tsc` clean; suite green; the devtools checklist above passes. **Then shut the dev
   server down** (standing rule 3).
   **Risk:** medium — hydration and `useSyncExternalStore` misuse (infinite re-render).
   **Mitigation:** §8.3's two named traps; if `getSnapshot` stability proves fiddly, an
   acceptable fallback is a `useState` initializer plus `suppressHydrationWarning` on the
   lock-dependent subtree — but try the correct approach first.

### Phase 5 — ChatPanel UI *(depends on: Phase 0 sign-off + Phase 4)*

1. Migrate Phase 0's settled markup into `ChatPanel.tsx`: `message` as the bubble, the proposal
   card, the five states, warnings, chips, `✦ Prometheus`.
2. Delete the `"Updated: X."` summary logic and rewrite the now-false R13 header comment.
3. Wire `citedConfigKeys` into the request body from `citedItems`.
4. **Gate:** `tsc` clean; suite green; a manual browser pass using the same devtools-seeded
   proposal from Phase 4 — including a long section value (collapse behavior) and a
   `config: { tools: null }` entry (renders as "Remove this key"). **Dev server off after.**
   **Risk:** low-medium, and purely visual — the mockup already resolved the layout.

### Phase 6 — Live verification *(depends on: Phase 5; REQUIRES AN EXPLICIT USER GO-AHEAD)*

**This phase spends the user's money.** Per standing rule 2, `@dev` must stop here, state what
calls it intends to make and roughly what they cost, and wait. Do not turn the `/settings`
"Live LLM calls" toggle on unilaterally.

Once approved: enable the toggle, and run three instructions against one real agent —
(a) a section rewrite, (b) a config change (e.g. "switch this to opus"), (c) a pure question
("what do you think of my tools list?"). Confirm: `message` reads naturally; the proposal card
matches; Apply writes exactly the proposed parts; **other config keys survive a config apply**
(the §6.4 defect, verified end-to-end); the question-only turn produces no card and no lock.
Then a fourth run with a citation, confirming scoped narrowing of both sections and config.
Finally: **turn the toggle back off**, and **shut the dev server down**.

### Phase 7 — Documentation sync *(depends on: Phase 6)*

Update — see §15 for the full list and §16 for the exact Rules Index edits: root `CLAUDE.md`,
`lib/ai/CLAUDE.md`, `architecture/TechDesign.md` (Rules Index + Deferred Decisions),
`docs/user-guide.md`, `plans/roadmap.md` (TODO items 2/3/6 → "What's built"), and a
`CHANGELOG.md` entry recording the rename, the contract change, the propose/apply split, the
breaking `/api/chat` response change, and the incidental config-lock fix.

### 14.1 Dependencies and parallelization

```
Phase 0 (mockup) ──────────────────────────────┐
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 ┴→ Phase 6 → Phase 7
```

Phase 0 is fully parallel with 1–3 and only gates Phase 5. Phases 1→5 are strictly sequential:
each changes the shape the next one consumes. Within Phase 3, the apply route and the chat
route's gutting are independent enough for two people; within Phase 4, the store and the
lock-propagation are similarly separable.

### 14.2 Risk summary

| Phase | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Stale import / generated-file mismatch | Low | grep gate + read the generated file once |
| 2 | Prompt and parser disagree | Medium | Parser tests written against § OUTPUT FORMAT verbatim |
| 3 | **Config wipe on a one-key apply** | **High** | §6.4 merge specified as code; regression test written first *and watched to fail* |
| 3 | Chat route still writing somewhere | Medium | The zero-writes test asserts five different tables/columns |
| 4 | Hydration mismatch / render loop | Medium | `useSyncExternalStore` + stable snapshot cache; named fallback |
| 4 | A corrupted `localStorage` entry permanently locks editing | Medium | Every read is guarded; malformed → clear the key |
| 5 | Card overwhelms a 240px panel | Low | Collapsed by default; settled in Phase 0 |
| 6 | Real API spend | — | Explicit ask; three scripted instructions; toggle off after |

### 14.3 Complexity

Roughly comparable to Plan 04, smaller than Plan 05: one new route, one renamed+rewritten
caller, one new client store, one substantially rewritten component, two rewritten test suites,
two new ones — and **zero schema change**, which is what keeps it out of Plan 05 territory.

---

## 15. Documentation impact

**Update (living docs):**

| File | What changes |
|---|---|
| `CLAUDE.md` (root) | The `lib/ai/prompts/system-agents/` bullet: `chat-mediator.md` → `prometheus.md`, and its one-line description (server-scoped to the whole agent; proposes, never applies). |
| `lib/ai/CLAUDE.md` | 7 refs: the "System agents: the source of truth" file list, the build-time compilation table (`CHAT_MEDIATOR_PROMPT` → `PROMETHEUS_PROMPT`), the `chatMediator.ts` caller section (rewritten: config now sent, propose-only, new contract), and the files table. |
| `architecture/TechDesign.md` | Rules Index #3, #7, #22, #23, #24, #25 (§16.1) + new rules (§16.2) + Deferred Decisions table (§16.3). |
| `docs/user-guide.md` | The AI-chat-edit walkthrough: chat now *proposes*; review and Apply; editing is locked while a proposal is pending; description and config are chat-editable; the name is not; apply is last-write-wins. |
| `plans/roadmap.md` | TODO items 2 and 3 → "What's built"; item 6 already marked superseded → closed. FUTURE entries for anything §17 defers. |
| `CHANGELOG.md` | One new dated entry (append only — never edit existing entries). |
| `README.md` | Only if it names the chat mediator — check; likely a one-word change or none. |

**Do NOT touch (historical records — §3.3):** `plans/01`, `plans/04`, `plans/05`,
`architecture/audits/Fable-Review-1.md`, and every existing `CHANGELOG.md` entry.

---

## 16. `TechDesign.md` changes

### 16.1 Supersessions to existing rules

| # | Change |
|---|---|
| 3 | Location moves to `system-agents/prometheus.md` § Guardrails **#4**; add that the write-time guard now runs in the **apply** route, not the chat route. |
| 7 | Widen: the agent is scoped to one server-chosen agent and may now propose changes to its **description, sections, and config** — never its `name`. Add a supersession note in the same style as the 2026-07-26 one, pointing at `plans/roadmap.md`'s 2026-08-05 design session and this plan. |
| 22 | The interaction lock gains a third state, `'proposal'`; and its coverage is extended to config editing, which was never gated before. |
| 23 | Cancellation is now trivially safe: the chat route never writes at all, so "safe by construction (apply-then-history)" is replaced by "safe by construction (the propose call performs no writes)." |
| 24 | ⬜ Deferred → ✅ **Locked and built** — propose-preview is now the unconditional behavior, not a per-user setting. Remove the corresponding Deferred Decisions row. |
| 25 | Prompt-file source-of-truth list: `chat-mediator.md` → `prometheus.md`. |

### 16.2 New rules (#73 onward — last existing is #72)

| # | Rule | Type |
|---|---|---|
| 73 | **`POST /api/chat` never writes to the agent.** It reads, calls the model, and returns a proposal. The only row it can cause is the gateway's `llm_call_log` row. | Architecture |
| 74 | **A config write always merges onto the current full config set** before `updateAgent()`, which full-replaces. A partial config map must never reach it. | Data integrity |
| 75 | **`agent.name` is never chat-editable, enforced server-side at apply** — not only by a prompt guardrail. | Security / invariant |
| 76 | **AI-authored content receives no validation the manual path does not.** No datatype/`allowedValues`/`required` enforcement is added for AI-proposed values. "Never block" is project-wide. | Product/architecture |
| 77 | **Full-value replacement only.** No diff format; the model is never asked to echo a "before" value; before/after display is assembled from state already held. | AI guardrail |
| 78 | **The pending-proposal lock is client-side, cooperative, and `localStorage`-scoped per `userId`+`agentId`.** Not server-enforced; does not cross devices. Both gaps are reviewed and accepted. | Product/UX |
| 79 | **Only the latest turn's proposal is actionable**; sending a new message discards the previous one unapplied. | Product/UX |
| 80 | **The chat system agent is Prometheus**, authored in MyAgent's own Agent pattern; `lib/ai/prompts/system-agents/prometheus.md` is its single source, compiled at build time. It remains platform-owned and is never a DB-backed, user-editable agent. | Architecture |
| 81 | **`section_revision.author: 'ai'` means "applied through the chat proposal flow,"** not a verified claim of model authorship — the apply payload is client-supplied by design (no server-side proposal store). | Data integrity / honesty |

### 16.3 Deferred Decisions additions

| Item | Revisit trigger |
|---|---|
| Wiring a declared model for Prometheus (§17.2) | When a specific model is actually chosen for chat, or next time `build-prompts.ts` is touched (roadmap TODO 10) |
| Adding / deleting sections via chat (§17.3) | When a user actually asks Prometheus to add or remove a section and the refusal is a papercut |
| Building the system prompt dynamically per request (§17.4) | If prompt-cache economics or per-request rule variation ever justify it |
| Atomic (single-transaction) apply across sections + agent row (§17.7) | If a partial apply is ever observed in practice |
| An audit trail for config changes (§12.5) | If "who changed this config key, when" becomes a real question |
| Live cross-tab proposal sync beyond the `storage` listener | If multi-tab use produces real confusion |

---

## 17. Confirmation points — **needed before `@dev` starts**

Each of these is genuinely open. None is resolved silently in the plan above; where the plan
had to be written one way to stay concrete, the recommendation is marked and the alternative is
spelled out.

**1. Does the rename go all the way through the `.ts` layer?**
Raised during design, never explicitly answered. **Recommendation: yes** —
`lib/ai/prometheus.ts`, `callPrometheus()`, `PrometheusInput`/`PrometheusProposal`,
`Prometheus*Error`, per §3.2. Rationale: the sibling callers are already named after their
system agent's role, every symbol is being rewritten anyway, and a module named `chatMediator`
while every doc says Prometheus is exactly the drift Rules Index #63 exists to punish.
**Alternative:** keep neutral technical names and rename only the prompt file, the constant,
and the UI label. **Blocks:** Phase 1 in its entirety — this is the first thing built.

**2. Model wiring (Decision L) — in scope, or deferred?**
`LlmRequest.model?: string` is real and wireable (`req.model ?? provider.defaultModel()`), but
**no model was ever chosen**, and `prometheus.md` currently documents "uses the platform's
default model — no override configured," which is *true today* — so nothing is lying.
**Recommendation: defer.** Reasons: there is no decision to encode; parsing a value out of the
prompt body couples the build tool to prose inside the compiled prompt; and roadmap TODO item
10 will rewrite `build-prompts.ts` anyway, which is the natural moment to add a second export.
**If the user wants it in scope**, the mechanism is fully specified and small: a single-line
convention inside `## IDENTITY` (e.g. `Model: claude-opus-5`), matched by
`/^Model:\s*(\S+)\s*$/m` in `build-prompts.ts`, emitted as a second constant
`export const PROMETHEUS_MODEL: string | null` alongside the prompt, and passed as
`model: PROMETHEUS_MODEL ?? undefined` in the caller's `LlmRequest`. Explicitly **not** a YAML
frontmatter parser — ruled out as unnecessary complexity for one field. If in scope, this needs
the user to name the actual model ID, and it slots into Phase 2.
**Blocks:** Phase 2 (only if in scope).

**3. Section deletion — and creation — via chat (Decision O).**
Deletion was raised repeatedly during design and never answered. Writing this plan surfaced a
sibling question nobody has asked: **creation.** Today an unknown `sectionKey` from the model is
skipped, and no repository primitive exists to add a section outside import
(`updateSectionContent` only updates), so "add a GUARDRAILS section" is currently impossible
via chat and would be net-new work (`order` assignment, `heading`, `def` resolution, revision
#0 with `author: 'scaffold'` per Rules Index #21).
**Recommendation: both out of scope for this pass** — chat stays *edit-only* for sections; an
unknown `sectionKey` is skipped with a warning, and the user sees that warning in the proposal
card. Deletion and creation both become roadmap FUTURE items.
**If the user wants either**, it is a real addition (new repository functions, new contract
fields such as `sections: { key: string | null }` for deletion, and new prompt rules in
`prometheus.md` — which this plan is otherwise forbidden to edit).
**Blocks:** Phase 2 (the contract) and Phase 3 (the apply route).

**4. The dynamic system prompt.**
`plans/roadmap.md` records as a "confirmed next direction" that the **system** prompt should be
built per request (rules + name + description + cited content + catalog), shrinking the user
message to just the instruction. This plan does **not** do that — it keeps the static
`PROMETHEUS_PROMPT` as `system` and puts content in the user message, unchanged in shape.
**Recommendation: keep it deferred** — it changes nothing the user can observe, it doubles the
risk surface of a phase that is already changing the output contract, and no prompt-caching
measurement exists to justify it. But because the roadmap calls it confirmed, **not doing it is
a deviation that needs an explicit OK.**
**Blocks:** Phase 2.

**5. May Prometheus propose a description change in scoped mode?**
The description is always attached to the call (§5.1), so a description edit is always
*grounded* — the technical reason the out-of-scope filter exists does not apply to it. But a
user who cited exactly one section may reasonably read the citation as "only touch this."
**Recommendation: allow it** (the plan is written this way), on the grounds that grounding is
the actual rule and the user reviews everything before it lands anyway.
**Alternative:** in scoped mode, drop `description` too unless the description itself is somehow
cited — which would need a new citable target in the UI, since the description block is not
`data-citable` today. **Blocks:** Phase 2.

**6. Apply-time `expectedVersion`: server-resolved (force-write) — confirm.**
Decision G says the lock replaces version checking; §6.6 implements that as "the apply route
reads the current version and passes it," i.e. last-write-wins. The alternative (the client
sends the version it saw at propose time) would resurrect a conflict path Decision G removed,
and the UI has no story for a conflict. **Recommendation: server-resolved, as specified**, with
`section_revision` as the recovery net and the cross-device gap already accepted. Confirming
this is confirming that **Apply can silently overwrite a change made on another device**.
**Blocks:** Phase 3.

**7. Non-atomic apply — accept?**
Sections are written by N separate transactions, then description+config by one. A failure
part-way leaves a partially-applied agent (500 returned, proposal retained, re-apply safe and
idempotent). Making it atomic means a new repository primitive that threads one `tx` through
what are currently self-contained functions — real churn in `agents.ts`, which this plan
otherwise leaves untouched. **Recommendation: accept non-atomic**, ordered sections-first, with
a Deferred Decisions entry. **Blocks:** Phase 3 (cheap to change now, expensive later).

**8. Apply endpoint path.**
`POST /api/agents/[id]/apply-proposal` (recommended, §6.2) vs. `POST /api/chat/apply`.
**Blocks:** Phase 3. Trivial to change, but it appears in tests and docs, so pick it once.

---

## 18. Judgment calls — cheap to change now, less cheap later

Not blockers; flagged so the reviewer can overrule them while it is still free.

1. **Tolerant parsing** (§4.3): a missing `message` or one malformed entry degrades with a
   warning instead of failing the turn. The stricter alternative — throw on any deviation from
   the contract — makes model misbehavior loud rather than quiet. The plan chose "don't throw
   away good edits over a cosmetic field," consistent with "never block," but strictness here
   would be defensible.
2. **`warnings` surfaced in the UI** rather than logged only. Costs a little card real estate;
   buys the user an explanation for why a proposed change didn't appear.
3. **The proposal card is collapsed by default.** Reasonable at 240px, but it means the default
   view of a proposal is a summary line, not the content. Phase 0 is the moment to disagree.
4. **`stop_reason === 'max_tokens'` is still not checked** in this caller, unlike
   `structuralConverter`. With `message` prose now added to the output, truncation is slightly
   more likely, and a truncated JSON object surfaces as a parse error (502) rather than an
   informative "the response was cut off." Adding the check is ~5 lines in Phase 2.
5. **Cross-tab sync arrives for free** via the `storage` listener. If two tabs on the same agent
   proves confusing, drop the listener and degrade to restore-on-load, which is all the decision
   actually required.
6. **Config values are rendered as JSON in the prompt**, not YAML, so lists and nested
   `hooks`/`mcpServers` objects round-trip unambiguously into the `config` map the model must
   return. YAML would read more naturally to a model trained on agent files, but would make the
   return shape ambiguous.
7. **The lock extension to config editing (§8.5)** fixes a pre-existing hole (config was
   editable mid-chat-call) that is technically outside this plan's headline scope. Included
   because leaving it open would make the new lock only two-thirds real.
