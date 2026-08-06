# Plan 08 — Prometheus Apply: Propose/Apply Split, Proposal Lock, and ChatPanel UI

> **Status: ⚪ Not started.**

## Progress Log

**2026-08-05 — plan created**, then **reorganized same day** after the user flagged that
having Plan 07's original Phase 3–7 write-ups sit alongside this plan's own Phase 0–5 was
confusing — two numbering schemes for the same continuum of work. This plan originally just
pointed back at Plan 07 §6–§13/§15–§16 for its technical spec; that content has now been
**moved here for real**, so this plan is self-contained and Plan 07 is trimmed to only what it
actually built (the rename and the new output contract). Nothing built yet under this plan.

**2026-08-06 — `@architect` reviewed this file (and Plan 07) for completeness; fixes applied.**
See Plan 07's Progress Log for the full account (this was a joint review of both files). What
changed here specifically: a stale "Plan 07 §10" reference fixed to §9; the `prometheus.md`
guardrail number in §12.2 row 3 corrected from #4 to #5; §12.2 row 25's description of the
`TechDesign.md` supersession corrected (it understated the edit — three system agents now
exist, not two, and the compilation mechanism changed); §5.4's state-machine table fixed to
match §3.2's actual response shape (`agent` at the top level, not `applied.agent`); §10.3
rewritten to name the four specific already-written `chat.test.ts` tests that must be inverted
or deleted, and to stop claiming a test scenario that isn't assertable in that suite; §3.1's
`citedConfigKeys` comment clarified (server-side filter is wired, `ChatPanel` doesn't send it
yet); and the full 16-row "Explicitly NOT in this plan" exclusions table — present in the
original single-file plan, dropped to 3 rows in Plan 07 during the split, never carried over
here — restored below.

---

## 0. Origin, and what this plan is

`plans/07-prometheus-propose-apply.md` renamed the chat mediator to **Prometheus** and gave it
a new output contract (`{ message, modifications, warnings }`), but stopped there deliberately:
Prometheus's answer is computed and returned correctly, but there is currently no way to apply
it. Sections still auto-apply to the DB exactly as before that plan; `description` and `config`
are parsed, filtered, and returned in the response but written nowhere. Plan 07 Phases 0–2 are
built and gated (2026-08-05). This plan is everything after that — originally scoped as Plan
07's Phases 3–7, split out mid-review because the user judged the apply endpoint (with its
config-merge fix, the single highest-risk item in the whole feature), the client proposal store
and editing lock, and the ChatPanel UI substantial enough to be their own plan.

**This plan is self-contained.** §3–§13 below hold the complete technical specification for
what's left to build. **What genuinely still lives only in Plan 07**, referenced by section
below rather than duplicated: the locked guiding constraints (Plan 07 §1 — shared invariants
for the whole Prometheus feature, binding on this plan too, not just Plan 07), the rename detail
(Plan 07 §3, already built), the output contract itself (Plan 07 §4, already built), what the
server attaches to a chat call (Plan 07 §5, already built), and the full confirmation-points
history (Plan 07 §8).

### Explicitly NOT in this plan

Carried forward from the original single-file plan's exclusions table, which was dropped when
the file split and never re-added — restored here since it's this plan's scope boundary, not
Plan 07's (Plan 07 kept only the three rows that shaped its own output-contract, in its own §0).
Each of these was raised and deliberately excluded during design. Re-scoping any of them
mid-build is a replan, not a judgment call.

| Excluded | Why / where it lives |
|---|---|
| Per-part apply (one section, one config key) | Decision E — apply-all only (§7 policy 3). Logged to `plans/roadmap.md` FUTURE. |
| An instant/auto-apply option or per-user toggle | Decision D. Logged to `plans/roadmap.md` FUTURE ("Instant auto-apply mode (revisit)"). |
| Any server-side validation of AI-proposed content | Decisions J/P — "never block" is project-wide. §3.5. |
| Version-conflict checking at apply time | Decision G — the lock replaces it. §3.6. |
| A DB table for pending proposals | Decision H — `localStorage` only. §5.2. |
| Chat/prompt history persistence and replay | Decision N — `plans/roadmap.md` NEXT item 2. `llm_call_log` already stores every request/response; only UI replay is missing. |
| Real Anthropic tool-calling | Decision M — `LlmRequest` has no `tools` field anywhere in the chain. Prometheus's "no tools" guardrail is structurally true; nothing to build. |
| Multi-platform import/export agents | Decision Q — `plans/roadmap.md` FUTURE. |
| System agents becoming DB-backed, UI-editable agents | Decision Q — FUTURE ("far far away"). Prometheus stays a **build-time-compiled static prompt**; only its content and name change (both already done, Plan 07). |
| Server-enforced (non-cooperative) editing lock | Accepted gap, FUTURE. §5.6. |
| Cross-device awareness of a pending proposal | Accepted gap, FUTURE. §5.6. |
| Adding or deleting sections via chat | Plan 07 §8 point 3 — out of scope, not just deferred. |
| Wiring a declared model for Prometheus | Plan 07 §8 point 2 — deferred. |
| Building the system prompt dynamically per request | Plan 07 §8 point 4 — deferred. |
| A manual description editor in the UI | §6.5 — description is read-only in the UI today and stays that way; chat is the only way to change it. |

Standing project rules apply in full, exactly as Plan 07 states them (root `CLAUDE.md`): no
commit without an explicit ask; no real Anthropic API call without an explicit ask (this plan's
only LLM-touching phase, §11 Phase 4, is gated on that go-ahead); dev server off after any
verification session; layout prototyped in `architecture/layout/Layout-Workbench.html` before
live UI code (§11 Phase 0 exists because of this rule — Plan 07's own Phase 0 was trimmed and
doesn't cover this plan's UI).

---

## 1. Confirmation points — needed before `@dev` starts

Plan 07's own §8 (confirmation points) raised eight questions. Six were answered when the user
reviewed Plan 07 and **stay answered — not reopened here**:

| Plan 07 §8 # | Question | Answer | Status here |
|---|---|---|---|
| 1 | Rename through the `.ts` layer? | Yes | Already built |
| 2 | Model wiring now or deferred? | Deferred | Carries forward unchanged |
| 3 | Section add/delete via chat? | Both out of scope | Carries forward — `plans/roadmap.md` TODO item 13 |
| 4 | Dynamic system prompt now or deferred? | Deferred | Carries forward unchanged |
| 5 | May Prometheus edit `description` in scoped mode? | Superseded — only when the instruction is explicitly about the description (`prometheus.md` GUARDRAILS #3) | Already built |
| 6 | Server-resolved `expectedVersion` (force-write, last-write-wins)? | **Accepted** | This plan's apply route (§3.6) implements it as accepted |

Two were bundled together as "the apply mechanism" and **cut from Plan 07 wholesale rather than
decided** — they are open again here:

**A. Non-atomic apply — accept? (was Plan 07 §8 point 7)**
Sections are written by N separate `updateSectionContent()` transactions, then
description+config by one `updateAgent()` transaction (§3.3). A failure part-way leaves a
partially-applied agent (500 returned, proposal retained client-side, re-apply safe and
idempotent for both sections and config — §8's "partial-apply honesty" note). Making it atomic
means threading one `tx` through repository functions that are currently self-contained — real
churn in `lib/db/repository/agents.ts`. **Recommendation: accept non-atomic**, ordered
sections-first, exactly as Plan 07 specified before this point was cut. **Blocks:** §11 Phase 1.

**B. Apply endpoint path — confirm (was Plan 07 §8 point 8)**
`POST /api/agents/[id]/apply-proposal` (§3.2's recommendation — ownership scoping is
structurally obvious under the agent resource, and keeps `/api/chat` write-free per Plan 07
constraint 1) vs. `POST /api/chat/apply` (keeps the conversational flow in one namespace).
**Recommendation: `/api/agents/[id]/apply-proposal`, as Plan 07 recommended.** Trivial to
change, but it appears in tests, docs, and the client fetch call, so pick it once. **Blocks:**
§11 Phase 1.

**C. New — Phase 0 mockup scope (not a Plan 07 §8 item; surfaced by the split itself)**
Plan 07's actual Phase 0 (built, 2026-08-05) was **trimmed**: it renamed `✦ Mediator` →
`✦ Prometheus` and added a read-only, non-interactive proposal preview, explicitly *without*
Apply/Discard buttons or a lock banner. The full interactive mockup §6.6 calls for (collapsible
card, per-part code blocks, before/after disclosure, `[Apply]`/`[Discard]`, the "editing
locked" banner, disabled-looking section/config controls, all five card states from §6.3) **was
never built.** This plan's own §11 Phase 0 finishes that mockup and gets sign-off before the
ChatPanel phase.

---

## 2. Architecture

### 2.1 What changes in the layering

Nothing moves between layers. The gateway, provider, and repository are untouched in shape
(unchanged from Plan 07 §2.1):

```
BEFORE THIS PLAN (Plan 07's built state)
  ChatPanel ──POST /api/chat──▶ route ──▶ callPrometheus ──▶ gateway ──▶ provider
                                  │
                                  └──▶ updateSectionContent()   ← sections still auto-apply (transitional)

AFTER THIS PLAN
  ChatPanel ──POST /api/chat──▶ route ──▶ callPrometheus ──▶ gateway ──▶ provider
                                  │
                                  └──▶ (no writes — returns a proposal)

  ChatPanel ──POST /api/agents/[id]/apply-proposal──▶ apply route
                                  ├──▶ updateSectionContent()  (per changed section, author 'ai')
                                  └──▶ updateAgent()           (description + MERGED full config)
```

The client-side change: `WorkbenchShell` gains a persisted `pendingProposal` and a fourth
`interactionLock` state.

### 2.2 Files

| File | Change |
|---|---|
| `app/api/chat/route.ts` | Stops writing entirely. Returns a proposal only (§3.1). |
| `app/api/agents/[id]/apply-proposal/route.ts` | **New.** The only writer in this flow (§3.2–§3.6). |
| `lib/db/repository/agents.ts` | **Unchanged.** `updateAgent()` and `updateSectionContent()` are used as-is; the merge happens in the apply route (§3.4). |
| `app/components/WorkbenchShell.tsx` | `InteractionLock` gains `'proposal'`; owns the pending proposal; passes it to `ChatPanel` and `AgentView` (§5). |
| `app/components/Chat/ChatPanel.tsx` | Renders `message` as the bubble; renders the proposal card; Apply / Discard; label `✦ Mediator` → `✦ Prometheus` (§6). |
| `app/components/CustomViz/AgentView.tsx` | `canEdit` accounts for `'proposal'`; **config editing gains a lock check it does not have today** (§5.5 — a real gap this plan closes). |
| `app/components/CustomViz/SectionBlock.tsx` | `canEdit` accounts for `'proposal'`. |
| `lib/proposalStore.ts` | **New.** `localStorage`-backed store with a `useSyncExternalStore`-compatible surface (§5.3). |
| `architecture/layout/Layout-Workbench.html` | This plan's own Phase 0: proposal card, Apply/Discard, lock banner, all five card states (§11 Phase 0). |
| `app/api/chat/__tests__/chat.test.ts` | Rewritten for propose-only (§10.3). |
| `app/api/chat/__tests__/chat-dryrun.test.ts` | Minor update (§10.4). |
| `app/api/agents/[id]/__tests__/apply-proposal.test.ts` | **New.** Includes the config-merge regression test (§10.2). |

**No schema files, no migrations, no `lib/db/schema.ts` change** — unchanged from Plan 07.

---

## 3. Propose-then-apply

### 3.1 `POST /api/chat` — the propose call

Request body — unchanged except one new optional field:

```jsonc
{
  "agentId": "…",
  "instruction": "…",
  "dryRun": false,                       // optional, may only downgrade (Rules Index #61)
  "citedSectionKeys": ["role"],          // optional
  "citedConfigKeys": ["tools"]           // optional — server-side filter already wired
                                          // (Plan 07 Phase 2); ChatPanel doesn't send it yet
}
```

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
consumer is `ChatPanel` in this repo, so no versioning or deprecation window is needed (§4.2).
Error responses (400/401/404/409 dry-run/429/499/502/500) are byte-identical to today — see §8.

A **question-only turn** returns `modifications: {}`. That is a first-class case, not an error,
and it must not set the pending-proposal lock (§5.4).

### 3.2 `POST /api/agents/[id]/apply-proposal` — the write

**Path choice.** Under `/api/agents/[id]/…`, alongside `sections/[sectionId]`, `groups`, and
`export`. Two reasons: the action is "write to this agent," so it belongs under the agent
resource where ownership scoping is structurally obvious; and Plan 07 constraint 1 declares
`/api/chat` write-free, so putting a DB writer at `/api/chat/apply` would immediately muddy the
rule that constraint is built on. (Alternative considered and rejected: `POST /api/chat/apply`,
which keeps the conversational flow in one namespace — see §1 confirmation point B.)

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

### 3.3 Apply algorithm (order is normative)

1. `authenticate()` → 401.
2. Parse body; `modifications` must be a plain object; `sections` values must be strings;
   `config` must be a plain object → otherwise `400 invalid_body`. This is *shape* validation
   only, never *content* validation (Plan 07 constraint 4).
3. `const agent = getAgentFull(id, session.userId)` → `404 not_found` if null. This both
   enforces ownership and gives the current sections (id + version) and current config.
4. **Drop `modifications.name` if present** — record in `skipped`, never write it (Plan 07
   constraint 3).
5. **Sections first.** For each `[sectionKey, content]`:
   - resolve the section row by `sectionKey` from the loaded agent. Unknown → push to
     `skipped` (`no_such_section`) and continue. (`sectionKey` is not unique across `custom`
     rows — last-in-order wins, the same documented MVP caveat as today's chat route.)
   - `const safe = demoteHeadings(content, agent.splitLevel)` (Plan 07 §4.4, split-level
     demotion).
   - `updateSectionContent(id, section.id, session.userId, safe, 'ai', section.version)` —
     `expectedVersion` is the version just read from the DB in step 3, i.e. a deliberate
     force-write (§3.6).
6. **Description and config together, in one `updateAgent()` call**, and only if at least one
   of them changed:
   - `description`: included only if present and different from `agent.description`.
   - `config`: **merged** — see §3.4. Never the raw diff.
7. `return getAgentFull(id, session.userId)` — a fresh read, so the response reflects both the
   section writes and the agent-row write.

### 3.4 The config merge — Decision I, the highest-risk item in this plan

`updateAgent()` (`lib/db/repository/agents.ts` ~line 754) does this when `config` is supplied:

```ts
tx.delete(schema.agentConfig).where(eq(schema.agentConfig.agentId, agentId)).run();
if (updates.config.length > 0) { tx.insert(schema.agentConfig).values(/* only what was given */).run(); }
```

**A full replace.** Passing Prometheus's `{ model: 'claude-opus-5' }` straight through would
delete `tools`, `subagent_type`, `hooks`, and everything else on the agent. Silently. With no
error. This is the defect this section exists to prevent, and §10.2 makes it a named regression
test.

The apply route must build the **merged full set** first — the same pattern
`AgentView.saveConfigKey()` already uses client-side (`[...without, { propKey, value }]`),
generalized to N keys and extended with deletion:

```ts
// agent.config is the CURRENT full set, from step 3's getAgentFull()
const merged = new Map<string, unknown>(agent.config.map((c) => [c.propKey, c.value]));
for (const [propKey, value] of Object.entries(modifications.config ?? {})) {
  if (value === null) merged.delete(propKey);   // null = delete the key (Plan 07 §4.1)
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

### 3.5 No validation — Decisions J and P

Confirmed during Plan 07's design and re-confirmed against the code while writing it:
`PATCH /api/agents/[id]` validates only that `config` is an *array*. It never checks a value
against `configDef.datatype`, `allowedValues`, or `required`, even for a manually typed value.
`agent.name` is stored verbatim ("flag-don't-block", Rules Index #1) and `AgentView`'s
`isBadListItem()` flags anomalies client-side only, never blocking a save.

Therefore: **an AI-proposed config value gets exactly the same treatment as a hand-typed one —
none.** The existing client-side flagging catches anomalies after the fact, on the next render,
identically for both. Adding datatype or `allowedValues` enforcement here — even "just for AI
values," even as a nice-to-have — would introduce precisely the asymmetric strictness the
project has now made a standing principle against. Do not add it.

### 3.6 No version-conflict check — Decision G

`updateSectionContent()` requires an `expectedVersion`, so a value must be supplied. Two
options existed:

- (a) the client sends the version it saw at propose time → a real optimistic-concurrency check
  that can fail at apply;
- (b) the apply route reads the current version in step 3 and passes that → a force-write.

**(b) is specified**, because Decision G replaces version checking with the lock: while a
proposal is pending, nothing in this browser can change the agent underneath it, so an
apply-time conflict can only originate from the already-accepted cross-device gap (§5.6). Under
(a), that rare case would surface as a hard failure the UI has no story for; under (b) it
overwrites, and `section_revision` (append-only, `author: 'ai'`) preserves what was overwritten,
which is the project's existing recovery model for exactly this. §1 confirmation table row 6
records this as accepted.

Consequence to state plainly in the docs: **Apply is last-write-wins.**

---

## 4. API surface

### 4.1 Endpoints

| Method | Path | Auth | Request | Response | Writes? |
|---|---|---|---|---|---|
| `POST` | `/api/chat` | session | `{ agentId, instruction, dryRun?, citedSectionKeys?, citedConfigKeys? }` | `200 { proposal: { message, modifications, warnings }, meta }` | **No** (only the gateway's `llm_call_log` row) |
| `POST` | `/api/agents/[id]/apply-proposal` | session, owner | `{ modifications: { description?, sections?, config? } }` | `200 { agent: AgentDTO, applied, skipped }` | Yes — `agent_section`, `section_revision`, `agent`, `agent_config` |

Unchanged and still used by the apply flow's neighbors: `PATCH /api/agents/[id]` (manual config
+ rename), `PATCH /api/agents/[id]/sections/[sectionId]` (manual section save, `author: 'user'`).

### 4.2 Backward compatibility

`POST /api/chat`'s success body changes shape with no versioning. Acceptable and preferred
because: the only consumer is `ChatPanel.tsx` in this same repo, changed in the same plan;
there is no public API, no second client, and no external integration (the MCP-server idea is
`plans/roadmap.md` NEXT item 17, not built). A `v2` path or a dual-shape response would be pure
ceremony. **Record it as a deliberate breaking change in `CHANGELOG.md` when this ships.**

---

## 5. Client state: the pending proposal and the lock

### 5.1 Where it lives

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

### 5.2 Storage key and scoping — Decision H

`myagent:proposal:<userId>:<agentId>` — `userId` from the `session` prop already threaded into
`WorkbenchShell` (`Session.userId` exists). Both parts are required: without `agentId` a stale
proposal bleeds across agents; without `userId` it bleeds across accounts sharing a browser.

`localStorage` only. **No DB table, no cookie, no server session state.**

### 5.3 Synchronous restore without a hydration mismatch

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

### 5.4 State machine

| Event | Proposal | `interactionLock` | `localStorage` |
|---|---|---|---|
| Idle | none | `null` | absent |
| Send message | cleared first (Decision F) | `'chat'` | cleared |
| Response, `modifications` non-empty | set | `'proposal'` | written |
| Response, `modifications` empty (question-only) | **none** | `null` | untouched/cleared |
| Response is an error / dry-run / cap-blocked | none | `null` | cleared |
| Cancel in flight | none | `null` | cleared |
| Apply → `200` | cleared; agent state replaced from the response's top-level `agent` field (§3.2) | `null` | cleared |
| Apply → error | **kept** | stays `'proposal'` | kept |
| Discard (explicit button) | cleared | `null` | cleared |
| Reload / new tab | restored from `localStorage` | `'proposal'` if restored | read |
| Switch agent | n/a — the page remounts `WorkbenchShell` with `key={agent.id}`, and the initializer reads the new agent's own key | | |

The **question-only** row is critical: if a turn with no modifications set the lock, asking
"what do you think of my tools list?" would lock manual editing with nothing to apply and no
obvious way out. It must not.

An explicit **Discard** affordance is required (not optional): without it, the only exit from
the lock is sending another chat message, which costs an API call to undo a UI state.

### 5.5 What the lock must actually block — a real gap found during design

Today `canEdit = interactionLock !== 'chat'` appears in exactly two places:
`AgentView.tsx:249` (used only for the **name** editor) and `SectionBlock.tsx:208` (the section
**raw-edit** button). Both become:

```ts
const canEdit = interactionLock !== 'chat' && interactionLock !== 'proposal';
```

**But config editing is not gated by `interactionLock` at all today.** The model/effort
selects, list add/remove, the `datatype: 'json'` block editor, and the per-key remove `×` all
call `saveConfig()` with no lock check whatsoever. Under Decision G, config is now part of the
proposable surface, so manual config editing *must* be blocked while a proposal is pending —
otherwise the exact conflict the lock exists to prevent stays wide open on the one surface this
plan newly makes AI-editable.

**§11 Phase 2 therefore extends the lock to the config zone**, gating every config mutation
entry point on the same `canEdit`. Two notes: (1) this incidentally closes a pre-existing hole
where config could be edited mid-chat-call, which is a small behavior change beyond this plan's
headline scope — desirable, and worth calling out in the changelog; (2) disabled controls need
the same `title` treatment the name editor already has, so the reason is visible on hover.

### 5.6 Accepted residual gaps (do not re-litigate — already in `plans/roadmap.md` FUTURE)

1. **The lock is client-side and cooperative.** No route rejects a manual edit because a
   proposal is pending. True of `interactionLock` generally since Plan 01 (Rules Index #22);
   this plan does not make it worse. Revisit trigger: a second official client, a public API,
   or adversarial use.
2. **`localStorage` does not sync across devices or browsers.** A pending proposal on a laptop
   does not block a manual edit from a phone on the same account. Accepted at the app's real
   scale. Revisit trigger: real usage producing actual overwrites.

---

## 6. ChatPanel UI

### 6.1 The message bubble

`ChatPanel.tsx` lines ~172–191 currently build `"Updated: role, output."` / `"No sections
changed."` from the response keys. **Delete that.** The assistant bubble renders
`proposal.message` verbatim. The `✦ Mediator` label (two occurrences, plus the mockup) becomes
`✦ Prometheus`.

The existing `changedSectionKeys` target chips (`◆ section · <key>`) stay useful as a
one-glance summary under the bubble, now sourced from `Object.keys(modifications.sections)` and
extended with `◆ config · <key>` and `◆ description` chips — the R13 note in the file header
("only section changes are chipped — never config, the real mediator doesn't edit config") is
now obsolete and must be rewritten, not left contradicting the code.

### 6.2 The proposal card

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
  from a new server field (Plan 07 constraint 2). This is safe because the lock guarantees the
  DTO is still the correct baseline while the proposal is pending.
- **Long values collapse** behind "show more" past ~12 lines.
- **Footer:** `[Apply]` `[Discard]`, plus the caption *"Editing is locked until you apply or
  discard."*

### 6.3 Card states

| State | Rendering |
|---|---|
| Pending | Full card, both buttons live |
| Applying | Buttons disabled, spinner on Apply, card content frozen |
| Applied | Card collapses to a muted "✓ Applied" line; buttons gone |
| Failed | Card stays pending; an inline error line above the buttons; Apply re-enabled |
| Superseded (a newer message was sent) | The older turn's card is not re-rendered at all — only the latest turn's proposal exists in state (Decision F) |
| Restored from `localStorage` after reload | Identical to Pending, with the caption *"Proposed <relative time> ago"* from `proposedAt`, so a day-old restored proposal is not mistaken for a fresh one |

### 6.4 Warnings

If `proposal.warnings` is non-empty, the card shows a muted line per warning above the footer
— e.g. *"Prometheus proposed a change to a section you didn't cite (`role`); it was not
included."* Silently dropping a proposed change is exactly the kind of thing that makes a tool
feel unpredictable.

### 6.5 Description is chat-only

`AgentView.tsx:1420` renders `agent.description` read-only; there is no manual description
editor anywhere in the UI. This plan does **not** add one — but it does mean chat becomes the
only way to change a description, which makes the description row in the proposal card the
first and only place a user ever sees a description edit. Worth one line in
`docs/user-guide.md`. (Adding a manual description editor is a reasonable, separate roadmap
item; it is not scoped here.)

### 6.6 Standing rule 4 — this **is** non-trivial; prototype first

A verdict is required, and it is: **prototype in `architecture/layout/Layout-Workbench.html`
before touching React.** This is not a one-line style tweak — it is a new composite component
(collapsible multi-part card, per-part code blocks, before/after disclosure, two actions, five
visual states) living inside a 240px-tall panel, plus a new lock signal, plus a label change.
Plan 07's Phase 0 already has a static chat transcript to extend (it added the renamed label and
a trimmed, non-interactive preview) — this plan's own §11 Phase 0 extends that further, and
prototyping there costs no dev server, no DB, and no LLM call.

**Prototype scope (§11 Phase 0):** static markup + CSS only — the card in its Pending and
Applied states, the collapsed/expanded summary, the `[Apply]`/`[Discard]` footer, the "editing
locked" banner, and disabled-looking config/section controls. No fetch logic, no state machine.
Sign-off on the visuals is the phase gate.

---

## 7. Business rules

### Invariants (always true once this plan ships)

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
4. Apply is **last-write-wins** (§3.6).
5. Prometheus is instructed to propose a concrete edit whenever an instruction reasonably calls
   for one, rather than holding back on vague instructions, because the human's Apply click is
   the safety gate (Decision K — already in `prometheus.md` § BEHAVIOR; no code impact).

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

## 8. Error handling

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

**Partial-apply honesty.** The apply route is **not atomic across parts** (§1 confirmation
point A): sections are written by N separate `updateSectionContent()` transactions, then
description+config by one `updateAgent()` transaction. If step 6 throws after step 5 succeeded,
the sections are already written. The response is a 500 and the client keeps the proposal, so
re-applying is possible and idempotent for sections (same content, new revision row) and for
config (the merge is computed from the then-current state each time). Re-applying is safe; that
is the mitigation.

---

## 9. Non-functional requirements

### 9.1 Cost and performance

- **Default token cost:** every unscoped turn sends all config values (already true since Plan
  07 Phase 2). Typical agents carry ~5–15 config keys of short scalars and small lists (a few
  hundred tokens), but `initialPrompt`, `hooks`, and `mcpServers` (`datatype: 'json'`) can each
  be large. Worst realistic case is low thousands of tokens added to a prompt that already
  carries every section plus the blueprint catalog. **Accepted deliberately** (Decision C);
  citation is the escape hatch for users who care, and it narrows config too (Plan 07 §5.3).
- **`maxTokens: 8192`** on the chat request is unchanged. The output carries `message` prose;
  a turn rewriting several long sections is marginally closer to truncation than before.
  `stop_reason` is not currently checked in this caller (unlike `structuralConverter`) —
  Plan 07 §9 (Judgment calls) flags this as a still-open, cheap-to-add nice-to-have on
  already-built code, not part of this plan's scope.
- **Apply latency:** one DB round trip, no network egress, no LLM call. Sub-10ms locally; the
  user-visible cost of propose-then-apply is one extra click, not one extra wait.
- **No new N+1:** `getAgentFull()` is already one composite read and is called twice in the
  apply flow (before and after) — acceptable and simpler than reconstructing the DTO by hand.

### 9.2 Security

- The apply endpoint accepts **client-supplied content**. This is **not** a privilege
  escalation: the same user can already write arbitrary content to their own sections via
  `PATCH /api/agents/[id]/sections/[sectionId]` and arbitrary config via
  `PATCH /api/agents/[id]`. Ownership is enforced identically, in the repository.
- **Honest consequence:** `section_revision.author: 'ai'` after this plan means "applied through
  the chat proposal flow," not a cryptographic claim that a model authored the bytes. Since
  Decision H forbids server-side proposal storage, the server has nothing to compare the
  payload against. Say this in `TechDesign.md` rather than letting the column imply more than
  it can.
- No new secret, no new external call, no new env var, no change to the API-key boundary.
- `console.error` on a parse failure must **not** include the raw model response — it contains
  the user's agent content, and the same reasoning that produced Plan 05 §5.6's consent rules
  applies.

### 9.3 Data integrity

- Zero schema change. Zero migration. Existing agents are unaffected until a user applies
  something.
- `section_revision` remains the recovery net for any bad apply (Rules Index — the entity exists
  precisely because "one bad AI edit" must be recoverable).
- The config merge (§3.4) is the single point where data loss is possible; it gets a dedicated
  regression test (§10.2).

### 9.4 Scalability

Nothing here scales with user count. `localStorage` holds at most one proposal per agent per
browser. The one new endpoint is O(changed parts) DB writes.

### 9.5 Observability

- `llm_call_log` behavior is entirely unchanged — the full request and response are still stored
  per call, which means **every proposal is already durably logged even though proposals are not
  stored in the DB** (relevant to `plans/roadmap.md` NEXT item 2, and worth stating so nobody
  thinks propose-only loses history).
- Apply writes no log row of its own. If "who applied what, when" becomes a real question,
  `section_revision` already answers it for sections; config has no history. Recorded as a
  deferred item (§12.4), not built.

---

## 10. Testing approach

### 10.1 The rule that shapes everything

Per root `CLAUDE.md` standing rule 2 and the 2026-07-30 audit recorded in
`plans/roadmap.md`'s stability snapshot: **no test in this suite may make a real Anthropic API
call.** Every new or rewritten suite here follows the existing pattern verbatim —
`vi.mock('.../lib/ai/prometheus.js', …)` for route tests, `vi.mock('.../anthropicProvider.js',
…)` for gateway-path tests, `createGateway(fakeProvider)` for gateway tests. No exceptions, and
no `getGateway()` anywhere under `__tests__/`. `lib/ai/__tests__/prometheus.test.ts` (parser
unit tests) is already built, from Plan 07 Phase 2 — nothing here touches it.

### 10.2 `app/api/agents/[id]/__tests__/apply-proposal.test.ts` — new

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
6. **Description-only apply** does **not** touch `agent_config` rows at all (§3.4's
   "only pass config when present").
7. **Unknown `sectionKey`** → `skipped[]`, 200, other parts still applied.
8. **`name` in the payload** → ignored, listed in `skipped[]`, `agent.name` unchanged.
9. **Split-level demotion** applied at the apply route even when the payload contains a
   `#`-level heading (proving the route, not the caller, is the gate).
10. **Cross-owner agent id** → 404, zero writes.
11. **Unauthenticated** → 401, zero writes.
12. **Malformed body** (`sections` value is a number) → 400, zero writes.

### 10.3 `app/api/chat/__tests__/chat.test.ts` — rewritten

As of Plan 07 Phase 2, this file (`describe('POST /api/chat — Phase 2', …)`) still asserts the
**transitional** behavior this plan removes. Four tests specifically assert the opposite of
this plan's zero-writes invariant and must be inverted or deleted, not just "have their
assertions flipped" in the abstract:

- `'two-section proposal → both versions bumped, two ai revisions written'` — currently asserts
  sections auto-apply. **Invert**: assert `agent_section.content`/`.version` and
  `section_revision` count are unchanged after the call.
- `'demotes split-level headings in section content before writing to DB'` — currently asserts
  a DB write happens at all. **Invert or delete**: split-level demotion at propose time is
  already covered by `prometheus.test.ts` (Plan 07 §6.2); this route no longer writes, so there
  is nothing left for this test to assert about the DB.
- `'description … present in the response but not written to any DB row'` and `'config … but no
  agent_config row is written'` — these already assert "not written" for description/config,
  consistent with this plan's target state; keep them, but note they currently coexist with the
  section-writing behavior above, which is the actual gap this plan closes.

Beyond those four, the full rewritten suite:

- **ZERO WRITES, unconditionally.** The load-bearing test: a successful chat call with a
  non-empty `modifications` leaves `agent_section.content`, `.version`, `section_revision`
  count, `agent.description`, and `agent_config` rows **all byte-identical** to before — for
  sections too, not just description/config. This single test enforces Plan 07 constraint 1 and
  supersedes the two inverted tests above.
- Response shape: `{ proposal: { message, modifications, warnings }, meta }`.
- The server loads sections from the DB and ignores client-supplied content (kept from today).
- Question-only turn (`modifications: {}`) → 200, no writes, `message` present.
- **Cited keys are forwarded to the mocked caller correctly** — `citedSectionKeys` and
  `citedConfigKeys` reach `callPrometheus()`'s input unchanged in scoped mode, and config values
  are present in that input when unscoped, absent when a citation excludes them (assert on the
  mock's call argument). **Not assertable here:** that an out-of-scope key gets *dropped from
  the proposal* — that filtering happens inside `parsePrometheusResponse()`
  (`lib/ai/prometheus.ts`), which this suite mocks wholesale per §10.1; that behavior is already
  covered by `prometheus.test.ts` (Plan 07 §6.2), not re-tested here.
- `citedConfigKeys` malformed (not an array of strings) → ignored, unscoped fallback, 200.
- Cancellation (`AbortError`) → 499. *This test gets simpler:* the old version had to prove
  "zero DB writes on cancel"; now zero writes is unconditional.
- 404 unknown agent, 401 unauthenticated — kept as-is.
- **Delete** any remaining version-conflict test (`conflicted section reported individually`) —
  the conflict path no longer exists on this route (§3.6). Do not port it to the apply route;
  that route deliberately has no conflict path.

### 10.4 `app/api/chat/__tests__/chat-dryrun.test.ts` — light touch

It mocks `anthropicProvider.js`, so it exercises the real gateway path. Its "zero agent writes"
assertion now holds trivially — keep it anyway, as a second witness for Plan 07 constraint 1.

### 10.5 What must not change

`lib/ai/__tests__/gateway.test.ts`, `gateway-cap.test.ts`, and `architecture.test.ts` are
untouched. If the one-SDK-importer fitness function starts failing, something is very wrong —
stop, do not "fix" the test.

### 10.6 Component tests — the same accepted gap, restated

`ChatPanel`, `WorkbenchShell`, `AgentView`, and the new proposal card have **no automated
coverage**, because the repo has no component-test infrastructure at all. That is
`plans/roadmap.md` NEXT item 1, explicitly scheduled after v1 launches. This plan does not open
that door. The proposal card, the lock, and the `localStorage` restore are therefore verified
**manually**, and §11 Phase 2/3 specify a way to do that with **zero LLM calls** (seed a
proposal into `localStorage` by hand from devtools). When NEXT item 1 lands, the proposal card
and the lock state machine should be near the top of its list.

### 10.7 Full-suite gate

Every phase ends with `npx tsc --noEmit` clean and `npm test` green. Current baseline (post
Plan 07) is **541/541**; expect further growth from `apply-proposal.test.ts` and the
`chat.test.ts` rewrite, with a net reduction if any remaining version-conflict test is deleted.

---

## 11. Implementation sequence

Six phases (0–5), continuing conceptually from Plan 07 but with this plan's own numbering. Each
leaves the repo type-clean, test-green, and functionally coherent. **No phase ends with a
commit instruction**; report status and wait for the user (standing rule 1).

### Phase 0 — Finish the layout prototype *(depends on: nothing)*

Extend `architecture/layout/Layout-Workbench.html`'s existing Plan 07 Phase 0 work (already has
the renamed label and a static read-only preview) with the parts deliberately deferred there:
the full proposal card per §6.2 (header + collapsed-by-default summary, one row per changed
part, before/after disclosure, long-value collapse past ~12 lines), all five states per §6.3
(Pending / Applying / Applied / Failed / Restored), the `[Apply]`/`[Discard]` footer, the
"editing is locked" banner, and disabled-looking section/config controls. **Gate:** the user
reviews the mockup in a browser and signs off on the visuals — nothing in Phase 3 starts before
this, per standing rule 4 and §6.6's own reasoning (a new composite component, not a one-line
tweak).

### Phase 1 — The propose/apply split, server side *(depends on: confirmation points A/B; §3)*

Gut `app/api/chat/route.ts`'s apply loop (and its inline `demoteHeadings` helper) so the route
returns `{ proposal, meta }` only, per §3.1; build
`app/api/agents/[id]/apply-proposal/route.ts` implementing §3.3's algorithm in that exact order,
including the §3.4 config merge and the §3.6 server-resolved `expectedVersion`; write
`app/api/agents/[id]/__tests__/apply-proposal.test.ts` per §10.2, with the config-merge
regression test first; rewrite `app/api/chat/__tests__/chat.test.ts` around the zero-writes
assertion per §10.3; light-touch `chat-dryrun.test.ts` per §10.4. **Gate:** `tsc` clean, suite
green, and the config-merge regression test proven to fail when the merge is temporarily
reverted (a regression test nobody has watched fail is not yet a regression test). **Risk:
highest in this plan** — silent config loss if the merge is skipped or bypassed (§3.4).

### Phase 2 — Client state: the proposal store and the lock *(depends on: Phase 1; §5)*

`lib/proposalStore.ts` per §5.3 (referential-stability snapshot cache, every read wrapped in
`try/catch`, the `v: 1` guard, the `QuotaExceededError` fallback); `WorkbenchShell`'s
`InteractionLock` gains `'proposal'`, wired via `useSyncExternalStore` per §5.3, implementing
the §5.4 state machine; `AgentView`/`SectionBlock` extend `canEdit` to also exclude
`'proposal'`, **and extend the lock to every config mutation entry point** per §5.5
(model/effort selects, list add/remove, the `datatype: 'json'` block editor, the per-key remove
`×` — a pre-existing gap this plan closes, not new scope creep); verify with a six-point
devtools-seeded-`localStorage` checklist — with the dev server running, hand-write a
`myagent:proposal:<userId>:<agentId>` entry matching the `PendingProposal` shape, reload, and
confirm (a) the lock is asserted with no flash of editable UI, (b) every editor is disabled,
(c) Discard clears both the key and the lock, (d) Apply calls the real apply endpoint and
updates the panels, (e) a corrupted entry is discarded rather than locking the user out, (f) a
second tab reflects the change. Zero LLM calls needed for this whole phase. **Gate:** `tsc`
clean, suite green, the devtools checklist passes, dev server shut down after. **Risk:**
hydration mismatch / `useSyncExternalStore` misuse (infinite re-render) — §5.3's two named
traps are the mitigation; the named fallback (`useState` initializer +
`suppressHydrationWarning`) is acceptable if the correct approach proves fiddly, but try it
first.

### Phase 3 — ChatPanel UI *(depends on: Phase 0 sign-off + Phase 2; §6)*

Migrate Phase 0's settled markup into `ChatPanel.tsx` — `message` as the bubble (replacing the
client-synthesized `"Updated: X."` logic), the proposal card, all five states, warnings, the
target chips (now including `◆ config · <key>` and `◆ description`, not just `◆ section ·`),
`✦ Prometheus` everywhere `✦ Mediator` still appears; rewrite the now-false R13 header comment
("only section changes are chipped — never config"); wire `citedConfigKeys` into the
`POST /api/chat` request body, derived from `citedItems` by `type`, alongside the existing
`citedSectionKeys`. **Gate:** `tsc` clean, suite green, a manual browser pass using the same
devtools-seeded proposal from Phase 2 — including a long section value (collapse behavior) and
a `config: { tools: null }` entry (must render as "Remove this key", never the literal `null`).
Dev server off after. **Risk:** low–medium, purely visual — the mockup (Phase 0) already
resolves the layout questions.

### Phase 4 — Live verification *(depends on: Phase 3; REQUIRES AN EXPLICIT USER GO-AHEAD)*

**This phase spends the user's money.** Stop here, state what calls are intended and roughly
what they cost, and wait — do not turn the `/settings` "Live LLM calls" toggle on unilaterally
(standing rule 2). Once approved: run three scripted instructions against one real agent —
(a) a section rewrite, (b) a config change (e.g. "switch this to opus"), (c) a pure question
("what do you think of my tools list?") — confirming `message` reads naturally, the proposal
card matches, Apply writes exactly the proposed parts, **other config keys survive a config
apply** (the §3.4 defect, now verified end-to-end rather than only unit-tested), and the
question-only turn produces no card and no lock. Then a fourth run with a citation, confirming
scoped narrowing of both sections and config. Finally: turn the toggle back off, and shut the
dev server down.

### Phase 5 — Documentation sync *(depends on: Phase 4; §12)*

Update root `CLAUDE.md`, `lib/ai/CLAUDE.md`, `architecture/TechDesign.md` (Rules Index
supersessions §12.2, new rules #73–81 §12.3, Deferred Decisions additions §12.4),
`docs/user-guide.md` (chat now proposes; review and Apply; editing locked while pending;
description and config are chat-editable, name is not; apply is last-write-wins),
`plans/roadmap.md` (TODO items 2/3/6 → "What's built"; this plan's own entry closed out), and a
`CHANGELOG.md` entry — covering **both** Plan 07's and this plan's combined scope in one dated
entry, since nothing shipped to users until this plan's Phase 4 verifies it live. Fold in the
loose thread Plan 07's Progress Log already logged mid-flight: session/device management
(→ `plans/roadmap.md` FUTURE, bucket still unsettled).

### 11.1 Dependencies

```
Phase 0 (mockup) ──────────────────────────────┐
Phase 1 → Phase 2 → Phase 3                     ┴→ Phase 4 → Phase 5
```

Phase 0 is fully parallel with Phase 1 and only gates Phase 3. Phases 1→3 are strictly
sequential: each changes the shape the next one consumes.

### 11.2 Risk summary

| Phase | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Config wipe on a one-key apply** | **High** | §3.4 merge specified as code; regression test written first *and watched to fail* |
| 1 | Chat route still writing somewhere | Medium | The zero-writes test asserts five different tables/columns |
| 2 | Hydration mismatch / render loop | Medium | `useSyncExternalStore` + stable snapshot cache; named fallback |
| 2 | A corrupted `localStorage` entry permanently locks editing | Medium | Every read is guarded; malformed → clear the key |
| 3 | Card overwhelms a 240px panel | Low | Collapsed by default; settled in Phase 0 |
| 4 | Real API spend | — | Explicit ask; three scripted instructions; toggle off after |

---

## 12. Documentation impact

### 12.1 Files to update (living docs)

| File | What changes |
|---|---|
| `CLAUDE.md` (root) | Confirm the `lib/ai/prompts/system-agents/` bullet already reflects `prometheus.md` (Plan 07); add a note that chat now proposes rather than applies directly. |
| `lib/ai/CLAUDE.md` | The `chatMediator.ts` caller section: propose-only, new contract, config now sent — reflect the finished state. |
| `architecture/TechDesign.md` | Rules Index supersessions (§12.2) + new rules #73–81 (§12.3) + Deferred Decisions table (§12.4). |
| `docs/user-guide.md` | The AI-chat-edit walkthrough: chat now *proposes*; review and Apply; editing is locked while a proposal is pending; description and config are chat-editable; the name is not; apply is last-write-wins. |
| `plans/roadmap.md` | TODO items 2 and 3 → "What's built"; item 6 already marked superseded → closed. This plan's own entry closed out. |
| `CHANGELOG.md` | One new dated entry (append only — never edit existing entries), covering both Plan 07's and this plan's combined scope. |
| `README.md` | Only if it names the chat mediator — check; likely a one-word change or none. |

**Do NOT touch (historical records):** `plans/01`, `plans/04`, `plans/05`,
`architecture/audits/Fable-Review-1.md`, `plans/07-prometheus-propose-apply.md`'s own Progress
Log, and every existing `CHANGELOG.md` entry.

### 12.2 `TechDesign.md` — supersessions to existing rules

| # | Change |
|---|---|
| 3 | Location moves to `system-agents/prometheus.md` § Guardrails **#5** (the split-level-heading rule — shifted from #4 to #5 once the description-scoping guardrail was inserted as #3 per Plan 07 §8 point 5); add that the write-time guard now runs in the **apply** route, not just at propose time. |
| 7 | Widen: the agent is scoped to one server-chosen agent and may now propose changes to its **description, sections, and config** — never its `name`. Add a supersession note pointing at `plans/roadmap.md`'s 2026-08-05 design session and Plans 07/08. |
| 22 | The interaction lock gains a third state, `'proposal'`; and its coverage is extended to config editing, which was never gated before. |
| 23 | Cancellation is now trivially safe: the chat route never writes at all, so "safe by construction (apply-then-history)" is replaced by "safe by construction (the propose call performs no writes)." |
| 24 | ⬜ Deferred → ✅ **Locked and built** — propose-preview is now the unconditional behavior, not a per-user setting. Remove the corresponding Deferred Decisions row. |
| 25 | Two things need fixing, not just the name: **(a)** the "compiles both into plain string constants" wording is stale — there are three system agents now (Hermes, Daedalus, Prometheus), not two; **(b)** "strips title/blockquote" no longer describes the mechanism — all three source files are now frontmatter-shaped, and `build-prompts.ts` strips the leading `---` block, not a title/blockquote (the old strip-to-first-`##` path is now the unused fallback, per `lib/ai/CLAUDE.md`'s build-time-compilation section). Rule #3's Location column is the one that names `chat-mediator.md` → `prometheus.md`; this row needs its own independent update. |

### 12.3 `TechDesign.md` — new rules (#73 onward — last existing is #72)

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

### 12.4 `TechDesign.md` — Deferred Decisions additions

| Item | Revisit trigger |
|---|---|
| Wiring a declared model for Prometheus (Plan 07 §8 point 2) | When a specific model is actually chosen for chat, or next time `build-prompts.ts` is touched (roadmap TODO 10) |
| Adding / deleting sections via chat (Plan 07 §8 point 3) | When a user actually asks Prometheus to add or remove a section and the refusal is a papercut |
| Building the system prompt dynamically per request (Plan 07 §8 point 4) | If prompt-cache economics or per-request rule variation ever justify it |
| Atomic (single-transaction) apply across sections + agent row (§1 confirmation point A) | If a partial apply is ever observed in practice |
| An audit trail for config changes (§9.5) | If "who changed this config key, when" becomes a real question |
| Live cross-tab proposal sync beyond the `storage` listener | If multi-tab use produces real confusion |

---

## 13. Judgment calls — cheap to change now, less cheap later

Carried forward from Plan 07's own judgment-calls list; these five pertain to apply/UI/lock
behavior, not yet built, so they live here rather than in Plan 07 (which keeps the three that
describe already-built parser/contract behavior). Not blockers; flagged so the reviewer can
overrule them while it is still free.

1. **`warnings` surfaced in the UI** rather than logged only. Costs a little card real estate;
   buys the user an explanation for why a proposed change didn't appear.
2. **The proposal card is collapsed by default.** Reasonable at 240px, but it means the default
   view of a proposal is a summary line, not the content. §11 Phase 0 is the moment to disagree.
3. **Cross-tab sync arrives for free** via the `storage` listener. If two tabs on the same agent
   proves confusing, drop the listener and degrade to restore-on-load, which is all the decision
   actually required.
4. **The lock extension to config editing (§5.5)** fixes a pre-existing hole (config was
   editable mid-chat-call) that is technically outside this plan's headline scope. Included
   because leaving it open would make the new lock only two-thirds real.
5. **Non-atomic apply, ordered sections-first (§1 confirmation point A).** Cheap to accept now;
   revisit only if a partial apply is ever actually observed in practice.
