# Plan 07 — Prometheus: System-Agent Rename and New Output Contract

> **Status: 🟢 Built and gated 2026-08-05 by `@dev`. Closed at this scope.** This plan covers
> the Prometheus rename and the new `{ message, modifications, warnings }` output contract
> only. Everything about actually *applying* a proposal — the apply endpoint, the config-merge
> fix, the client proposal store and editing lock, the ChatPanel UI, live verification, and doc
> sync — was split out into **`plans/08-prometheus-apply.md`** mid-review (see Progress Log
> below for exactly why) and is fully specified there, not here. Phases 0–2 are committed
> (`4e97f92`); Plan 08's work is not.

## Progress Log

**2026-08-05 — §8 confirmation points answered** (by the user, in review, not all matching the
plan's own recommendations):

| # | Question | Answer |
|---|---|---|
| 1 | Rename through the `.ts` layer? | **Yes** — full rename, as recommended. |
| 2 | Model wiring now or deferred? | **Deferred.** |
| 3 | Section add/delete via chat? | **Both out of scope.** Logged to `plans/roadmap.md` **TODO item 13** (not FUTURE — deliberately kept visible for pre-launch review, not left to drift). |
| 4 | Dynamic system prompt now or deferred? | **Deferred**, after the tradeoff was walked through explicitly (no user-visible difference; theoretical prompt-caching upside only, unmeasured). |
| 5 | May Prometheus edit `description` in scoped mode? | **Superseded**, not just answered — the plan's own §5.4 rule ("description always kept, since it's always grounded") was replaced with a stricter rule: **only when the instruction is explicitly about the description**, regardless of citation state. Written directly into `prometheus.md` GUARDRAILS as rule #3. |
| 6 | Server-resolved `expectedVersion` (last-write-wins) — accept? | **Accepted**, tradeoff explicitly understood. Surfaced a new, separate FUTURE item: session/device management (view + remote-log-out other active sessions) — logged to `plans/roadmap.md` FUTURE, bucket not yet settled. |
| 7/8 | Apply mechanism (endpoint, atomicity, path) | **Cut from this plan entirely.** The user decided mid-review that the apply endpoint + config-merge fix, and the `localStorage` lock/store, are substantial enough to warrant their **own separate future plan**, not a continuation of this one. This plan stops at "Prometheus's answer is computed and returned correctly" — it does not build a way to apply it yet. |

**2026-08-05 — Phases 0, 1, 2 implemented by `@dev`, scope trimmed to match the table above:**

- **Phase 0** (trimmed): `architecture/layout/Layout-Workbench.html` — `✦ Mediator` → `✦ Prometheus`
  everywhere; added a simple, **read-only, non-interactive** proposal preview (no Apply/Discard,
  no lock banner — those belong to the deferred apply/UI work). Not gated on user sign-off,
  unlike the original Phase 0 spec (that gate existed to protect the ChatPanel UI phase, which
  isn't happening here).
- **Phase 1**: built exactly as originally specified — mechanical rename only, `lib/ai/chatMediator.ts` → `lib/ai/prometheus.ts`, all symbols renamed per §3.2's table, `chat-mediator.md` kept alongside `prometheus.md` until Phase 2 flips over. Gate passed: `tsc` clean, 502/502 tests, zero `chatMediator`/`ChatMediator`/`CHAT_MEDIATOR` hits in any `.ts`/`.tsx` file.
- **Phase 2**: built exactly as originally specified, **including the transitional behavior in step 5** — sections still auto-apply to the DB exactly as before this plan; `description`/`config` are parsed, filtered, and returned in the response but **not written anywhere**. New 3-step parser + full §4.3 tolerance table implemented; `## Current config` block + `citedConfigKeys` scoping wired into the prompt. `chat-mediator.md` deleted. Gate passed: `tsc` clean, **541/541 tests** (39 new), zero deviations from spec.
- **Explicitly NOT built, moved to `plans/08-prometheus-apply.md`:** the apply endpoint + config-merge fix (the highest-risk item in the whole feature), the proposal store + interaction lock, the full ChatPanel UI (`ChatPanel.tsx` itself is untouched; the browser still shows the old client-synthesized summary, not `message`), live verification (needs a real Anthropic API call and its own explicit go-ahead per standing rule 2), and doc sync (can't be written honestly yet, since most of the planned doc changes describe the *finished* propose→apply flow, which doesn't exist).
- **No commits made.** No real API calls made. No dev server left running.
- **One thing flagged, not a code issue:** `PushNotification` reported mobile push is disabled in `/config`, despite Remote Control being connected — worth checking that toggle if pings to the phone matter going forward.

**2026-08-05 — `prometheus.md` reformatted to real-agent shape, reopening §3.1/§8 (user decision, overrides the earlier "not part of this plan" framing):**

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
- `model` stays unset in frontmatter, with a comment explaining why (§8 point 2 is still
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

**2026-08-05 — Phases 3–7 split into `plans/08-prometheus-apply.md`; this plan closed at
Phases 0–2, and the file physically trimmed to match:**

- Formalizing what the "§8 confirmation points answered" table already recorded above (row
  7/8: apply mechanism "cut from this plan entirely"). The apply endpoint + config-merge fix,
  the client proposal store + lock, the ChatPanel UI, live verification, and doc sync now live
  in `plans/08-prometheus-apply.md`, fully specified there — not as pointers back here.
- **First pass** of this split kept the full original Phase 3–7 write-up in this file
  (§6–§13/§15–§16, and §14's Phase 3–7 detail) with a note that it was "historical spec, no
  longer tracked." **Reworked same day**, after the user flagged that having two
  differently-numbered phase lists for the same continuum of work (this file's dormant
  Phase 3–7 next to Plan 08's own Phase 0–5) was confusing rather than clarifying. That content
  has now been **moved for real** into Plan 08 (renumbered there as its own §3–§13), and removed
  from this file. This file now contains only what it actually built: the rename (§3) and the
  new output contract (§4–§5), plus the shared foundational material (§1 constraints, §2
  architecture) both plans are built on.
- Two of the original §8 confirmation points were never actually decided, only bundled into the
  "cut" — non-atomic apply (point 7) and the apply endpoint path (point 8). Both are reopened
  as Plan 08 §1 confirmation points A/B, carrying this plan's original recommendations forward
  (accept non-atomic; `/api/agents/[id]/apply-proposal`) as the still-live recommendation, not
  as an already-settled answer.

**2026-08-06 — `@architect` reviewed the 07/08 split for completeness; fixes applied:**

- Independent review (not the same session that did the split) read both files in full,
  diffed against the pre-split original via `git show`, and spot-checked claims against the
  real code (`lib/ai/prometheus.ts`, `app/api/chat/route.ts`, `prometheus.md`,
  `TechDesign.md`). Verdict: the split itself was substantively sound — no technical spec
  content was silently dropped from the apply/merge/lock/UI material moved into Plan 08.
- Found and fixed in this file: two stale "§6" section refs in the standing-rules block (should
  be §7); three "§4's Phase 2 note" refs that pointed at a section with no such note (the real
  location is §7 Phase 2 step 5); §5.4 mis-described the out-of-scope filter as living in "the
  chat route" when it's actually inside `parsePrometheusResponse()` in `lib/ai/prometheus.ts`
  (`lib/ai/CLAUDE.md` already said this correctly); the header's "Nothing committed" claim was
  stale (Phases 0–2 are committed as `4e97f92`).
- Found and fixed in `plans/08-prometheus-apply.md`: a "Plan 07 §10" reference to a section that
  doesn't exist (judgment calls are §9); a `prometheus.md` guardrail number that shifted from
  #4 to #5 once the description-scoping rule was inserted as #3; an inaccurate description of
  what `TechDesign.md` rule #25 actually needs updated to; a response-shape mismatch between the
  apply endpoint's documented response (§3.2, `agent` at the top level) and the client state
  machine (§5.4, which said `applied.agent`); `§10.3`'s chat-route test list named a scenario
  ("scoped mode drops out-of-scope keys") that isn't assertable in that suite, since the
  dropping happens inside the mocked caller — rewritten to name the four specific
  already-written tests in `chat.test.ts` that must be inverted or deleted, and to redirect that
  assertion to where it actually belongs (`prometheus.test.ts`, already built).
- **Restored a full exclusions table to Plan 08 §0** — the original single-file plan's
  16-row "Explicitly NOT in this plan" table got trimmed to 3 rows when the file split (Plan 07
  kept only the rows shaping its own output contract) and the other 13 were never re-added to
  Plan 08, where they actually belong. Fixed.
- Also fixed, as fallout from the renumbering, in files outside these two plans:
  `lib/ai/prompts/system-agents/prometheus.md`, `plans/roadmap.md`, `lib/ai/__tests__/prometheus.test.ts`,
  `lib/ai/prometheus.ts`, `app/api/chat/route.ts` (five stale section-number comments), and
  `lib/ai/CLAUDE.md` (was asserting "`POST /api/chat` performs zero writes" as already true,
  which it isn't yet).
>
> **Origin.** `plans/roadmap.md` TODO item 2 — *"Section-scoped chat selection"* — and its
> **"Design session 2026-08-05 — mediator rework"** block, which is the authoritative
> decision record for everything here. It also closes TODO item 3 (*"Review the chat-mediator
> system agent"*) and **supersedes TODO item 6** (*"Propose-preview before applying a mediator
> rewrite"*, already marked superseded in the roadmap): propose-then-apply is built as
> the sole, unconditional behavior, not as a per-user opt-in modal — the propose *call* (this
> plan) and the apply *write* (Plan 08) together.
>
> **What this is, in one line.** The chat mediator becomes **Prometheus** — a real agent
> authored in MyAgent's own Agent pattern — and its output contract grows from `{ sections }`
> to `{ message, modifications }`. (The editable surface growing to *everything except `name`*,
> and `POST /api/chat` actually stopping writes, is Plan 08's job — this plan lays the contract
> groundwork but keeps the old auto-apply-sections behavior transitionally, per §4's Phase 2
> note.)
>
> **Numbering:** `07` is correct. `01`–`06` are the existing numbered execution specs;
> `plans/roadmap.md` and `plans/Evaluation-260730.md` are deliberately unnumbered.
>
> **Standing project rules apply in full** (root `CLAUDE.md`):
> 1. **No commits without an explicit ask.** No phase in §7 ends with a commit instruction.
>    Report status and wait.
> 2. **No real Anthropic API call without an explicit ask.** Every test in this plan mocks the
>    AI layer, matching every existing suite (`vi.mock('.../ai/*.js', …)`).
> 3. **Dev server off** after any verification session.
> 4. **Layout prototyped in `architecture/layout/Layout-Workbench.html` first.** This plan's own
>    Phase 0 (trimmed, §7) satisfies this for what it built; Plan 08 has its own Phase 0 for the
>    interactive apply/lock UI this plan didn't touch.

---

## 0. What this plan is, in one paragraph

Today `POST /api/chat` does four things in one request: load the agent, ask the model for
rewritten sections, write them to the database, and return what it wrote. The model can only
touch sections, its answer to the user is thrown away (the client synthesizes `"Updated: X."`
from the keys that came back), and the user finds out what changed only after it already
changed. This plan is the first half of splitting that apart: the system agent is renamed and
re-authored as **Prometheus**, and it returns a real chat `message` plus a `modifications`
object covering `description`, `sections`, and `config` — but the chat route keeps writing
sections transitionally (§7 Phase 2, step 5), and `description`/`config` are computed but not
yet written anywhere. Making the chat route fully read-only, building the apply endpoint (with
its config-merge fix), the client lock, and the ChatPanel UI that surfaces all of this is
**`plans/08-prometheus-apply.md`**, not this plan. There is **no schema change and no
migration** anywhere in this plan.

### What this plan deliberately does not decide (contract-shape items only)

Three confirmation points (§8, points 2/3/4) bear directly on the shape of the output contract
this plan built, so they're recorded here as the reasons the contract looks the way it does:

| Deferred | Why / where it lives |
|---|---|
| Wiring a declared model for Prometheus | §8 point 2 — **open**, recommended deferred. `model` stays unset in `prometheus.md` frontmatter. |
| Adding or deleting sections via chat | §8 point 3 — **open**, recommended out of scope. The contract stays edit-only for sections; an unknown `sectionKey` is skipped with a warning. |
| Building the system prompt dynamically per request | §8 point 4 — **open**, recommended deferred. `PROMETHEUS_PROMPT` stays static `system`; content goes in the user message, unchanged in shape. |

Everything else that was originally scoped as an exclusion for the whole propose-then-apply
feature (per-part apply, an auto-apply toggle, AI-content validation, version-conflict
checking, a DB table for proposals, chat history persistence, real tool-calling,
multi-platform agents, DB-backed system agents, the server-side lock gap, the cross-device gap,
a manual description editor) is Plan 08's concern, not this plan's — see that file's own §0
(restored exclusions table) and §7 (Business rules).

---

## 1. Guiding constraints (locked — do not replan during build)

These are the locked design constraints for the **whole Prometheus feature** — binding on this
plan and on Plan 08, not just this one. Some (constraint 1, most visibly) describe the fully
built target state and are not yet completely true after this plan alone: sections still
auto-apply transitionally until Plan 08 ships. They're recorded here, where they were first
established, rather than duplicated.

1. **`POST /api/chat` performs zero writes to `agent`, `agent_section`, `agent_config`, or
   `section_revision`.** It is a read + an LLM call + a response. The only row it may cause to
   be written is the `llm_call_log` row the gateway already writes. This is the load-bearing
   constraint of the whole feature and the easiest one to assert in a test. **Not yet fully
   true** — sections still auto-apply until Plan 08 Phase 1.
2. **Full-value replacement, never diffs.** Every value in `modifications` is the complete new
   value. The model is never asked to reproduce a "before" value; any before/after display is
   assembled from state the server or client already holds (Decision A).
3. **`agent.name` is never chat-editable**, and that is enforced **server-side at apply**, not
   only by a prompt guardrail (Decision B). The parser already drops a proposed `name` change
   (§4.3); the server-side enforcement point is Plan 08's apply route.
4. **No new validation of AI-authored content.** An AI-proposed config value is written exactly
   like a manually-typed one. Shape errors (a section value that isn't a string) are handled by
   dropping that one entry with a recorded warning — never by rejecting the turn (Decisions
   J/P).
5. **The config write path always merges onto the current full config set** before calling
   `updateAgent()`, because `updateAgent()` full-replaces config rows (Decision I — Plan 08 §3.4).
6. **One pending proposal per (user, agent), and only the latest turn's is actionable**
   (Decision F — Plan 08 §5).
7. **The pending-proposal lock is client-side and cooperative**, exactly as `interactionLock`
   already is. No route rejects a manual edit because a proposal is pending. This is a known,
   accepted limitation, not an oversight (Decision H — Plan 08 §5.6).
8. **No schema change, no migration, no `drizzle` change.** If a phase seems to need one, stop
   and re-plan.
9. **Ownership stays enforced in the repository**, in the same statement that touches the row
   (Plan 05 constraint 1, Rules Index #48–#50). Plan 08's apply endpoint adds no new ownership
   mechanism — it calls existing owner-scoped repository functions.
10. **The gateway stays the single choke point** (Rules Index #41). Prometheus's caller module
    keeps the exact caller shape from `lib/ai/CLAUDE.md` § "Callers — shape", including the
    dry-run / cap refusal ordering.
11. **Everything Prometheus is shown, the server chose.** No agent content ever comes from the
    request body into the LLM call (Rules Index #7). The *apply* request body (Plan 08) is
    different and is client-supplied by necessity — see that plan's §9.2 for why that is not a
    privilege escalation.
12. **Tests never make a real API call.** Every new or rewritten suite mocks either the caller
    module or `anthropicProvider.js`, matching the existing pattern.

---

## 2. Architecture

### 2.1 What changes in the layering

Nothing moves between layers. The gateway, provider, and repository are untouched in shape.
This diagram shows the **full target state** spanning both this plan and Plan 08 — the middle
state (this plan's actual output) is transitional, described in §7 Phase 2, step 5:

```
BEFORE (pre-Plan 07)
  ChatPanel ──POST /api/chat──▶ route ──▶ callChatMediator ──▶ gateway ──▶ provider
                                  │
                                  └──▶ updateSectionContent()   ← the write, same request

AFTER (this plan + Plan 08, fully built)
  ChatPanel ──POST /api/chat──▶ route ──▶ callPrometheus ──▶ gateway ──▶ provider
                                  │
                                  └──▶ (no writes — returns a proposal)

  ChatPanel ──POST /api/agents/[id]/apply-proposal──▶ apply route      [Plan 08]
                                  ├──▶ updateSectionContent()  (per changed section, author 'ai')
                                  └──▶ updateAgent()           (description + MERGED full config)
```

Plan 08 covers the client-side change too: `WorkbenchShell` gaining a persisted
`pendingProposal` and a fourth `interactionLock` state.

### 2.2 Files touched by this plan

| File | Change |
|---|---|
| `lib/ai/prompts/system-agents/prometheus.md` | **New**, real-agent shape (YAML frontmatter + `#`-level sections). |
| `lib/ai/prompts/system-agents/chat-mediator.md` | **Deleted** in Phase 2, once nothing imports its compiled constant. |
| `scripts/build-prompts.ts` | `AGENTS[]` gains `{ file: 'prometheus', constName: 'PROMETHEUS_PROMPT' }` (Phase 1) and loses the `chat-mediator` entry (Phase 2); `extractPromptContent()` gains frontmatter-stripping support. |
| `lib/ai/chatMediator.ts` | **Renamed** → `lib/ai/prometheus.ts` (§3.2). New parser, new types, config + description now in the request. |
| `app/api/chat/route.ts` | Imports/mock targets updated (Phase 1); passes config through, validates `citedConfigKeys`, moves the out-of-scope filter to propose time (Phase 2) — **still auto-applies sections transitionally**; Plan 08 finishes gutting it. |
| `architecture/layout/Layout-Workbench.html` | Phase 0 (trimmed): `✦ Prometheus` label, a static read-only proposal preview. |
| `app/api/chat/__tests__/chat.test.ts` | Import path / mock target updated for the rename and new caller return shape. |
| `app/api/chat/__tests__/chat-dryrun.test.ts` | Import path / mock target updated. |
| `lib/ai/__tests__/prometheus.test.ts` | **New.** Parser unit tests (§6.2). |

Files Plan 08 touches instead — the apply route, `WorkbenchShell.tsx`, `ChatPanel.tsx`,
`AgentView.tsx`, `SectionBlock.tsx`, `lib/proposalStore.ts`, `apply-proposal.test.ts` — are
listed in that plan's own §2.2, not here.

**No schema files, no migrations, no `lib/db/schema.ts` change.**

---

## 3. The rename

### 3.1 The prompt-content layer (settled)

`chat-mediator.md` → `prometheus.md`. `scripts/build-prompts.ts` compiles it to
`lib/ai/prompts/generated/prometheus.ts` exporting `PROMETHEUS_PROMPT`. `chat-mediator.md`
and its `AGENTS[]` entry were deleted once the caller flipped over (Phase 2 — not Phase 1,
so the repo was never in a state where the app imports a constant that is no longer generated).

`prometheus.md` was later reformatted to real-agent shape (YAML frontmatter + `#`-level
sections) — see the Progress Log entry above. `build-prompts.ts`'s `extractPromptContent()`
now detects a leading `---` frontmatter block and strips it, returning everything after the
closing `---` verbatim; the legacy "strip to first `## ` heading" path is kept for the two
import-converter prompts, unchanged.

### 3.2 The `.ts` layer (built)

Renamed all the way through, per §8 point 1's confirmed answer:

| Before | After |
|---|---|
| `lib/ai/chatMediator.ts` | `lib/ai/prometheus.ts` |
| `callChatMediator()` | `callPrometheus()` |
| `MediatorInput` | `PrometheusInput` |
| `MediatorSection` | `PrometheusSection` |
| `MediatorResult` | `PrometheusProposal` |
| `ChatMediatorUpstreamError` | `PrometheusUpstreamError` |
| `ChatMediatorInvalidResponseError` | `PrometheusInvalidResponseError` |
| `parseMediatorResponse()` (private) | `parsePrometheusResponse()` (**exported**, for unit tests — same treatment `demoteSplitLevelHeadings` already gets) |

### 3.3 What must NOT be renamed

Historical records — dated statements of what was actually built at the time, when "chat
mediator" was the real name. Rewriting them misrepresents history, the same principle that
keeps `CHANGELOG.md` from ever being retro-edited:

- `plans/01-core-loop-implementation-plan.md`
- `plans/04-llm-gateway-settings.md`
- `plans/05-multi-tenant-auth.md`
- `architecture/audits/Fable-Review-1.md`
- `CHANGELOG.md` (all existing entries)

Living docs that get updated when Plan 08's doc-sync phase runs: root `CLAUDE.md`,
`lib/ai/CLAUDE.md`, `architecture/TechDesign.md` Rules Index + Deferred Decisions,
`docs/user-guide.md`. `plans/roadmap.md`'s 2026-08-05 notes are already accurate.

---

## 4. The new output contract

### 4.1 Shape

Written into `prometheus.md` § OUTPUT FORMAT. The TypeScript mirror:

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
| `message` | Always present. Becomes the assistant bubble text once Plan 08's ChatPanel work lands. Today the client still synthesizes its own summary and ignores this field. |
| `modifications.description` | Full replacement string. Present only if changed. Parsed and returned; **not yet written** (Plan 08). |
| `modifications.sections` | One entry per **changed** section. Value is the complete new content. Absent keys are untouched. **Still auto-applied directly by this plan's route** (§7 Phase 2, step 5), not through Plan 08's apply endpoint. |
| `modifications.config` | One entry per **changed** config key. Value is the complete new value (a whole list for `tools`, not a delta). `null` means *delete this key*. Parsed and returned; **not yet written** (Plan 08). |
| `warnings` | **Not part of the model's contract.** Added by the server's parser to record what it had to drop (§4.3). Always an array, usually empty. |

### 4.2 Parsing — extraction

Replaced the old single greedy `responseText.match(/\{[\s\S]*\}/)` with an ordered three-step
attempt, each falling through to the next:

1. `JSON.parse(responseText.trim())` — the normal case for a well-behaved model.
2. Strip a leading/trailing code fence (```` ```json ```` … ```` ``` ````), then parse.
3. The existing greedy first-`{`-to-last-`}` slice, then parse.

If all three fail → `PrometheusInvalidResponseError('response is not valid JSON')`. This
matters more than the old single-shot match because `message` is free prose that can
legitimately contain braces and backticks.

### 4.3 Parsing — validation, and the tolerance rule

The parser distinguishes **structural failure** (nothing usable — throw) from **one bad entry**
(drop it, record a warning, keep the rest). Dropping silently would be dishonest; that is what
`warnings` is for.

| Condition | Behavior |
|---|---|
| Not valid JSON after all three extraction attempts | **Throw** `PrometheusInvalidResponseError` → route returns `502 ai_upstream` |
| Root is not a JSON object (array, string, number, `null`) | **Throw** |
| `message` missing, `null`, or not a string | **Tolerate**: use `''`, push warning `"Prometheus returned no message."` Discarding a good set of edits over a cosmetic field is the worse failure. |
| `modifications` missing or not a plain object | **Tolerate**: use `{}`, push a warning. (A model that answers a pure question may reasonably omit it, even though the prompt says to send `{}`.) |
| `modifications.description` present but not a string | **Drop** that key + warning |
| `modifications.sections` present but not a plain object | **Drop** the whole `sections` key + warning |
| A `sections[key]` value is not a string | **Drop that key** + warning; keep the other sections |
| `modifications.config` present but not a plain object | **Drop** the whole `config` key + warning |
| A `config[key]` value of any JSON type, including `null` | **Pass through unchanged.** No datatype, `allowedValues`, or `required` check — ever (constraint 4). |
| `modifications.name` present | **Drop** + warning `"Prometheus proposed a name change; agent names are not chat-editable."` (Constraint 3.) |
| A `sections[key]` value of `""` | **Keep.** Emptying a section's content is an edit, not a deletion. Section deletion is §8 point 3. |
| An unknown `sectionKey` or `propKey` | **Keep at parse time.** Resolution against the real agent happens against §5.4's scope filter, and (once Plan 08 ships) at apply time. Custom config keys are a real, supported concept. |

### 4.4 Split-level demotion — where it runs

`demoteSplitLevelHeadings` (Rules Index #3) runs inside `callPrometheus()`, over every
`modifications.sections` value, so the content the parser returns is already safe. Plan 08's
apply route will run it a second time over client-supplied section values at apply time
(defense in depth, since that request body is client-supplied) — see that plan's §3.3 step 5.

---

## 5. What the server attaches to the call

### 5.1 Always attached, regardless of citation

`agentName`, `agentDescription`, `splitLevel`. Because `description` is always attached,
Prometheus is always *grounded* on it — relevant once Plan 08 makes description actually
chat-editable.

### 5.2 Unscoped (nothing cited) — Decision C

The **full agent**: every section's content **and every config key's current value**, plus the
blueprint catalog (`renderBlueprintForPrompt()`, default `includeConfig: true`, unchanged).

Config values had never been sent to the mediator before this plan, cited or not — this is a
real, new, deliberate default token cost on every unscoped chat turn (Plan 08 §9.1 quantifies
it).

`PrometheusInput` gained:

```ts
config: { propKey: string; value: unknown }[];   // current values, server-loaded from the DTO
citedConfigKeys?: string[];
```

Rendered in the user message as a `## Current config` block after `## Current sections`, one
line per key — `propKey: <JSON.stringify(value)>`. JSON, not YAML, so a list, a nested
`hooks`/`mcpServers` object, and a plain string are all unambiguous and round-trip cleanly into
the `config` map the model must return.

### 5.3 Scoped (something cited)

Citation narrows, exactly as it did before this plan. `citedSectionKeys` filters sections;
**`citedConfigKeys` filters config** the same way — the wiring the roadmap flagged as "config
citation is still UI-only." Both arrive as separate arrays; `ChatPanel` derives them from the
existing `citedItems` by `type` (the server-side filter is built — see below — but nothing in
`ChatPanel` sends `citedConfigKeys` yet; that wiring is Plan 08 §11 Phase 3).

The scoping note in `buildUserMessage()` was extended to name both kinds:

> The user has focused this instruction on: `<sections: role, output>` `<config: tools>`. Only
> those are shown below — you have not been given the agent's other sections or config values,
> so do not reference or attempt to change them.

Four combinations, all valid: sections only (config withheld), config only (sections withheld),
both, neither (= unscoped, §5.2).

### 5.4 The out-of-scope filter

Prometheus's parser (`parsePrometheusResponse()`, `lib/ai/prometheus.ts`) skips any returned
`sectionKey`/`propKey` outside the cited set, at propose time, because the model was never shown
that content so an edit to it cannot be a grounded diff:

| Part | Scoped-mode rule |
|---|---|
| `sections[key]` | Dropped unless `key ∈ citedSectionKeys`. Warning recorded. |
| `config[key]` | Dropped unless `key ∈ citedConfigKeys`. Warning recorded. |
| `description` | **Kept** — description is always attached (§5.1), so it is always grounded. *(Superseded by the §8 point 5 answer: description is only proposed when the instruction is explicitly about the description, regardless of citation state — see `prometheus.md` GUARDRAILS #3.)* |

Once Plan 08 ships, the apply route additionally skips a `sectionKey` that matches no row on
the agent — a different check, for a different reason (that plan's §3.3 step 5).

---

## 6. Testing approach for what this plan built

### 6.1 The rule that shapes everything

Per root `CLAUDE.md` standing rule 2 and the 2026-07-30 audit recorded in
`plans/roadmap.md`'s stability snapshot: **no test in this suite may make a real Anthropic API
call.** Every new or rewritten suite here follows an existing pattern verbatim —
`vi.mock('.../lib/ai/prometheus.js', …)` for route tests, `vi.mock('.../anthropicProvider.js',
…)` for gateway-path tests, `createGateway(fakeProvider)` for gateway tests. No exceptions, and
no `getGateway()` anywhere under `__tests__/`.

Note on module loading: `lib/ai/prometheus.ts` imports the **generated** prompt constant, and
`lib/ai/prompts/generated/` is gitignored and only produced by `predev`/`prebuild` —
`npm test` has no such hook. `lib/ai/__tests__/prometheus.test.ts` therefore
`vi.mock('../prompts/generated/prometheus.js', () => ({ PROMETHEUS_PROMPT: '<test prompt>' }))`
so the suite never depends on a build having run.

### 6.2 `lib/ai/__tests__/prometheus.test.ts` — built

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
  `citedConfigKeys` are both dropped with warnings.

### 6.3 Full-suite gate

`npx tsc --noEmit` clean and `npm test` green after every phase. Final state after Phase 2:
**541/541 tests** (39 new).

---

## 7. Implementation sequence — Phases 0–2 (built)

Two phases plus a mockup step, all built and gated 2026-08-05. Phases 3–7 of the original
seven-phase sequence are **not tracked here** — they execute as `plans/08-prometheus-apply.md`
Phases 1–5, fully specified in that file's own §11.

### Phase 0 — Layout prototype (trimmed) — built

In `architecture/layout/Layout-Workbench.html`: renamed the transcript's `✦ Mediator` labels to
`✦ Prometheus`; added a simple, **read-only, non-interactive** proposal preview. No
Apply/Discard, no lock banner — those are Plan 08's Phase 0. Not gated on user sign-off, unlike
the original spec (that gate existed to protect the ChatPanel UI phase, which is Plan 08's job
now).

### Phase 1 — Rename, with no behavior change — built

1. Added `{ file: 'prometheus', constName: 'PROMETHEUS_PROMPT' }` to `build-prompts.ts`'s
   `AGENTS[]`, keeping the `chat-mediator` entry so both compiled.
2. Verified the generated `prometheus.ts` begins cleanly.
3. Renamed `lib/ai/chatMediator.ts` → `lib/ai/prometheus.ts` and every exported symbol per
   §3.2. The caller still used `CHAT_MEDIATOR_PROMPT` and still parsed `{ sections }` —
   nothing about runtime behavior changed in this phase.
4. Updated `app/api/chat/route.ts` imports and both chat test files' mock targets.
5. **Gate passed:** `tsc` clean; 502/502 tests; `rg 'chatMediator|ChatMediator|CHAT_MEDIATOR'`
   returns hits only in the §3.3 historical files and not-yet-updated docs.

### Phase 2 — The new output contract — built

1. Flipped the caller to `PROMETHEUS_PROMPT`; deleted `chat-mediator.md` and its `AGENTS[]`
   entry.
2. New types (`PrometheusProposal`, `PrometheusModifications`), new
   `parsePrometheusResponse()` (§4.2–§4.3), exported for tests.
3. `PrometheusInput` gained `config` and `citedConfigKeys`; `buildUserMessage()` renders the
   `## Current config` block and the extended scoping note (§5.2–§5.3).
4. `app/api/chat/route.ts` passes config values through from `getAgentFull()`, validates
   `citedConfigKeys`, and moves the out-of-scope filter to propose time (§5.4).
5. **Transitional, deliberate:** the route still auto-applies `modifications.sections` exactly
   as before this plan; `description` and `config` are parsed, filtered, and returned in the
   response but **not written**. This kept the app coherent between phases; Plan 08's Phase 1
   removes this transitional behavior for good.
6. Wrote `lib/ai/__tests__/prometheus.test.ts` (§6.2). Updated chat route tests for the new
   caller return shape.
7. **Gate passed:** `tsc` clean; 541/541 tests (39 new); parser tests cover every §4.3 row.

---

## 8. Confirmation points — history of what was decided before `@dev` started

Each of these was genuinely open at plan-review time. Recorded here as the historical decision
record; the Progress Log above shows how each was actually answered.

**1. Does the rename go all the way through the `.ts` layer?**
Raised during design, never explicitly answered until review. **Recommendation: yes** —
`lib/ai/prometheus.ts`, `callPrometheus()`, `PrometheusInput`/`PrometheusProposal`,
`Prometheus*Error`, per §3.2. Rationale: the sibling callers are already named after their
system agent's role, every symbol is being rewritten anyway, and a module named `chatMediator`
while every doc says Prometheus is exactly the drift Rules Index #63 exists to punish.
**Alternative:** keep neutral technical names and rename only the prompt file, the constant,
and the UI label. **Answered: yes, full rename** (Progress Log).

**2. Model wiring (Decision L) — in scope, or deferred?**
`LlmRequest.model?: string` is real and wireable (`req.model ?? provider.defaultModel()`), but
**no model was ever chosen**, and `prometheus.md` currently documents "uses the platform's
default model — no override configured," which is *true today* — so nothing is lying.
**Recommendation: defer.** Reasons: there is no decision to encode; parsing a value out of the
prompt body couples the build tool to prose inside the compiled prompt; and roadmap TODO item
10 will rewrite `build-prompts.ts` anyway, which is the natural moment to add a second export.
If wanted, the mechanism is fully specified and small: a single-line convention inside the
prompt (e.g. `Model: claude-opus-5`), matched by regex in `build-prompts.ts`, emitted as a
second constant `PROMETHEUS_MODEL: string | null`. Explicitly **not** a YAML frontmatter parser
— ruled out as unnecessary complexity for one field. **Answered: deferred** (Progress Log).

**3. Section deletion — and creation — via chat (Decision O).**
Deletion was raised repeatedly during design and never answered. Writing this plan surfaced a
sibling question: **creation.** Today an unknown `sectionKey` from the model is skipped, and no
repository primitive exists to add a section outside import (`updateSectionContent` only
updates), so "add a GUARDRAILS section" is impossible via chat and would be net-new work
(`order` assignment, `heading`, `def` resolution, revision #0 with `author: 'scaffold'` per
Rules Index #21). **Recommendation: both out of scope for this pass** — chat stays *edit-only*
for sections; an unknown `sectionKey` is skipped with a warning, visible in the proposal card.
Deletion and creation both become roadmap FUTURE items. **Answered: both out of scope**
(Progress Log; `plans/roadmap.md` TODO item 13).

**4. The dynamic system prompt.**
`plans/roadmap.md` records as a "confirmed next direction" that the **system** prompt should be
built per request (rules + name + description + cited content + catalog), shrinking the user
message to just the instruction. This plan does **not** do that — it keeps the static
`PROMETHEUS_PROMPT` as `system` and puts content in the user message, unchanged in shape.
**Recommendation: keep it deferred** — it changes nothing the user can observe, it doubles the
risk surface of a phase that is already changing the output contract, and no prompt-caching
measurement exists to justify it. **Answered: deferred**, after the tradeoff was walked through
explicitly (Progress Log).

**5. May Prometheus propose a description change in scoped mode?**
The description is always attached to the call (§5.1), so a description edit is always
*grounded* — the technical reason the out-of-scope filter exists does not apply to it. But a
user who cited exactly one section may reasonably read the citation as "only touch this."
**Recommendation: allow it** (description always kept regardless of citation), on the grounds
that grounding is the actual rule and the user reviews everything before it lands anyway.
**Answered: superseded** — a stricter rule was adopted instead: only propose a description
change when the instruction is explicitly about the description, regardless of citation state.
Written into `prometheus.md` GUARDRAILS #3 (Progress Log).

**6. Apply-time `expectedVersion`: server-resolved (force-write) — confirm.**
Decision G says the lock replaces version checking; the apply route (Plan 08 §3.6) reads the
current version and passes it, i.e. last-write-wins. The alternative (the client sends the
version it saw at propose time) would resurrect a conflict path Decision G removed, and the UI
has no story for a conflict. **Recommendation: server-resolved**, with `section_revision` as
the recovery net and the cross-device gap already accepted. Confirming this is confirming that
**Apply can silently overwrite a change made on another device**. **Answered: accepted**
(Progress Log) — surfaced a new FUTURE item (session/device management).

**7. Non-atomic apply — accept?**
Sections would be written by N separate transactions, then description+config by one. A
failure part-way would leave a partially-applied agent. Making it atomic means a new repository
primitive that threads one `tx` through what are currently self-contained functions — real
churn in `agents.ts`. **Recommendation: accept non-atomic**, ordered sections-first, with a
Deferred Decisions entry. **Not actually decided** — bundled into "cut from this plan entirely"
along with point 8 (Progress Log). **Reopened as Plan 08 §1 confirmation point A.**

**8. Apply endpoint path.**
`POST /api/agents/[id]/apply-proposal` (recommended) vs. `POST /api/chat/apply`. **Not actually
decided** — bundled into "cut from this plan entirely" (Progress Log). **Reopened as Plan 08 §1
confirmation point B.**

---

## 9. Judgment calls — cheap to change now, less cheap later

Only the calls that describe this plan's already-built parser/contract behavior. The apply/UI
judgment calls (warnings-in-UI, card-collapsed-by-default, cross-tab sync, the config-lock
extension, non-atomic apply) live in `plans/08-prometheus-apply.md` §13 instead.

1. **Tolerant parsing** (§4.3): a missing `message` or one malformed entry degrades with a
   warning instead of failing the turn. The stricter alternative — throw on any deviation from
   the contract — makes model misbehavior loud rather than quiet. The plan chose "don't throw
   away good edits over a cosmetic field," consistent with "never block," but strictness here
   would be defensible.
2. **`stop_reason === 'max_tokens'` is still not checked** in this caller, unlike
   `structuralConverter`. With `message` prose now added to the output, truncation is slightly
   more likely, and a truncated JSON object surfaces as a parse error (502) rather than an
   informative "the response was cut off." Adding the check is ~5 lines; still not done.
3. **Config values are rendered as JSON in the prompt**, not YAML, so lists and nested
   `hooks`/`mcpServers` objects round-trip unambiguously into the `config` map the model must
   return. YAML would read more naturally to a model trained on agent files, but would make the
   return shape ambiguous.
