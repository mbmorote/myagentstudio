# Agent Workbench — Technical Design

> The **how**. Companion to `Concept.md` (the what/why). This doc evolves as we build;
> the concept doc stays stable. Start here for data model, stack, and implementation.

## Design principles

These constrain every decision below.

1. **Platform is master.** The structured data in the platform is the source of truth.
   `.md` files are an *export target*, not the storage format.
2. **Structured-first, serialize on export.** Agents are stored as structured data
   (typed frontmatter + ordered body sections), and rendered to `.md` only when
   exporting. Importing an `.md` parses it back into structure.
3. **Lossless round-trip.** Import → edit → export must not silently drop anything.
   Unknown frontmatter keys and unrecognized body sections are preserved verbatim.
4. **Spec-clean export.** Exported Claude agents contain only official frontmatter
   fields. Platform-only concepts (groups, internal ids) never leak into the file.
5. **Two zones** (from Concept): **Config** = frontmatter (official, typed, enumerable);
   **Sections** = body (opinionated section template over a free-form system prompt).
   Both zones use the **same pattern**: a predefined catalog + per-agent values, with
   custom/unknown always allowed (no FK).
6. **Ship the MVP small, keep doors open.** Model for what's coming (nesting, going online)
   without building it yet.
7. **AI key — single local key for dev.** The MVP uses **one API key in a local config /
   `.env`, read server-side, on my machine only** — not online, no key-entry UI, no
   billing. This is neither "hosted" nor "BYOK" (Bring Your Own Key) as a feature; both of
   those are *later* choices for when the app goes online, and both grow from the same core
   (server makes an AI call with a key), so deciding later costs nothing.
8. **🔒 Never leak the key (permanent rule).** The AI key stays **server-side only** — never
   in frontend/browser code, never in an artifact, never committed to git (`.env` is
   git-ignored). **Before every commit / share / deploy, check the key isn't exposed** (not
   hardcoded, not in client bundles, not in logs, not in committed config). This rule holds
   from day one, while it's just me, so it's already habit the day the app goes online.
9. **Import is AI-assisted; export is deterministic.** Messy real-world input needs
   intelligence to map onto the model; clean structured data needs only rules to write out.
   See *The Agent Blueprint* and Drafts A/B.
10. **🛟 Safe conversion (permanent rule).** Import **never deletes or changes content** —
    it only *maps* content onto the Blueprint. If a piece can't be mapped, it becomes
    `custom`, verbatim. Loss/rewording is impossible by construction, so Principle #3
    (lossless) holds even though an AI is in the loop.

## Rules Index

One level more concrete than the 10 Design Principles above: every specific rule that came
out of the pre-build review (`architecture/audits/DesignReview.md`), in one scannable ledger — what it
is, where it actually lives, and whether it's settled. **Check this table before building
the Blueprint** — that's exactly what it's for. Keep it updated every time a new finding is
folded in or a new rule is added.

**Type** tells you where a rule *should* live: **Schema/Parsing/Infra** facts belong in this
doc; **AI guardrail** rules belong in the relevant `lib/ai/prompts/system-agents/*.md` file (see
*System agents vs. user agents* below for why).

| # | Rule | Type | Lives in | Status | Source |
|---|------|------|----------|--------|--------|
| 1 | `Agent.name`: flag-don't-block, never silently rewritten on import | Schema/validation | `TechDesign.md` § Entity `Agent` | ✅ Locked | Review 1c |
| 2 | `AgentSection.heading` nullable — represents the headingless preamble | Schema | `TechDesign.md` § Entity `AgentSection` | ✅ Locked | Review 1b |
| 3 | Section content must never contain a heading at the agent's split level | AI guardrail (Prometheus) | `system-agents/prometheus.md` § Guardrails #5 (moved from `chat-mediator.md` § Guardrails #2 — shifted #4→#5 once the description-scoping guardrail was inserted as #3, Plan 07 §8 point 5) | ✅ Locked — **now also re-enforced at write time**, not only at propose time: `POST /api/agents/[id]/apply-proposal` re-runs `demoteHeadings()` on every section it writes regardless of what produced the payload (Plan 08 §3.3 step 5, §7 invariant 8) | Review 1a; write-time guard added 2026-08-06 (Plan 08) |
| 4 | Frontmatter parsed string-preserving (no YAML scalar coercion); comments explicitly lost | Parsing (deterministic) | `TechDesign.md` § Draft B | ✅ Locked | Review 1d |
| 5 | Stage 2 AI output = labels only, `{blockId → sectionKey}` — never content | AI guardrail (converter) | `system-agents/import-instructions.md` § Guardrails #1 | ✅ Locked | Review 2 |
| 6 | Merges are `{blockIds → label}`, never rewritten text | AI guardrail (converter) | `system-agents/import-instructions.md` § Guardrails #2 | ✅ Locked | Review 2 |
| 7 | **Prometheus** (renamed from "the chat mediator", Plan 07) is scoped to one server-chosen **agent** and may propose changes to its **description, sections, and config in one turn — never its `name`**; no tools | AI guardrail (Prometheus) | `system-agents/prometheus.md` § Guardrails | ✅ Locked (superseded 2026-07-26 — was scoped to one `sectionId`; widened again 2026-08-05/06 — was sections-only; see below) | Review 7; re-scoped Plan 01 review, 2026-07-26; widened per `plans/roadmap.md`'s 2026-08-05 design session, built Plans 07/08 |
| 8a | All DB access goes through a repository layer, conservative column types | Infra/stack | `TechDesign.md` § Draft C | ✅ Locked | Review 3 |
| 8b | Storage target dialect (Postgres vs. Azure SQL) | Infra/stack | `TechDesign.md` § Draft C | 🟡 Deferred — no code impact until migration is real | Review 3 |
| 9 | Blueprint = one module exporting data **and** rule functions (name validation, heading render) | Architecture | `TechDesign.md` § Blueprint | 🟢 No debate — apply when `lib/blueprint` is written | Review 4 |
| 10 | `SectionRevision`: append-only history from **import onward** (not just AI edits) — `import`/`user`/`ai` authorship | Schema | `TechDesign.md` § Entity `SectionRevision` | ✅ Locked | Review 5 (extended) |
| 11a | Re-import collision = always update-in-place, never duplicate/error; new revision tagged `author: "reimport"` | Schema/product | `TechDesign.md` § `SectionRevision` + § Draft A | ✅ Locked | Review 6 |
| 11b | Section removed from the incoming file on re-import → **just delete it**, no confirm — `SectionRevision` isn't cascade-deleted, so history survives regardless | Schema/product | `TechDesign.md` § `SectionRevision` + § Draft A | ✅ Locked | Review 6 |
| 14 | Does every manual save append a `SectionRevision`, or debounce to meaningful edit boundaries only | Product/UX | *(not yet added)* | ⬜ Deferred — decide when building the manual-edit save flow | New (not from review) |
| 12 | Missing `description` on import = placeholder + validation flag | Schema/validation | `TechDesign.md` § Entity `Agent` | ✅ Locked | Review 7 |
| 13 | Catalog evolution: distinguish "never known" vs. "was known, catalog changed" | Validation | *(not yet added)* | ⬜ Deferred — needs catalog versioning, doesn't exist yet | Review 7 |
| 15 | `AgentSnapshot`: whole-agent (not per-section) exported-markdown capture on import — `pre-import`/`post-import`, soft-ref to `agentId`, never cascade-deleted | Schema | `TechDesign.md` § Entity `AgentSnapshot`; `plans/01-core-loop-implementation-plan.md` § 3 | ✅ Locked | Plan 01 review, 2026-07-26 |
| 16 | `AgentSnapshot(kind:'export')` capture point + the diff-view UI that reads pre/post snapshots | Product/UX | *(not yet added)* | ⬜ Deferred — needs the export route (later plan); schema already supports it, no migration needed | Plan 01 review, 2026-07-26 |
| 17 | `Agent.platform`: open catalog (`PlatformDefs`), not a DB enum; only `'claude'` exists now | Schema | `TechDesign.md` § Entity `Agent`; `plans/01-core-loop-implementation-plan.md` § 3/§4 | ✅ Locked | Plan 01 review, 2026-07-26 |
| 18 | `ConfigDef` platform-scoping (a `model`/`tools` catalog per platform, not one global catalog) | Schema | *(not yet added)* | ⬜ Deferred — `ConfigDef` stays implicitly Claude-shaped until a second platform's import/create is actually built | Plan 01 review, 2026-07-26 |
| 19 | ~~`model.allowedValues` = full model IDs only, no short aliases~~ — **SUPERSEDED by #37**: the real Claude Code subagent schema documents short aliases (`sonnet`/`opus`/`haiku`/`fable`) as the primary form, `'inherit'` as the actual default, not just "kept for now" | Schema/seed | `plans/01-core-loop-implementation-plan.md` § 4 (D4); corrected by #37 | ❌ Superseded — see #37 | Plan 01 review, 2026-07-26; corrected 2026-07-28 |
| 20 | UI displays a short label ("Opus") instead of the raw full model ID — display-only, storage stays the full ID | Product/UX | *(not yet added)* | ⬜ Deferred — not built in this plan; UI renders the full ID verbatim until this lands | Plan 01 review, 2026-07-26 |
| 21 | `SectionRevision.author` gets a fifth value, `'scaffold'`, for platform-created (not imported) section revision #0 — distinct from `import`/`reimport`/`user`/`ai` | Schema | `TechDesign.md` § Entity `SectionRevision`; `plans/01-core-loop-implementation-plan.md` § 3/§4 (D5) | ✅ Locked | Plan 01 review, 2026-07-26 |
| 22 | Chat, manual raw-edit, and **a pending chat proposal** are mutually exclusive per agent, client-enforced (interaction lock: `'chat'` / `'edit'` / `'proposal'`) — UI-level prevention only; no server-side enforcement | Product/UX | `plans/01-core-loop-implementation-plan.md` § 6 rule 12, § 7; `plans/08-prometheus-apply.md` §5 (the `'proposal'` state) | ✅ Locked — **extended 2026-08-06 to config editing**, which had no lock check at all before Plan 08 Phase 2 (a real pre-existing gap this closed, not new scope) | Plan 01 review, 2026-07-26; extended Plan 08, 2026-08-06 |
| 23 | Cancellation token for an in-flight Prometheus call: client `AbortController`, `request.signal` propagated to the Anthropic SDK call. **Safe by construction because `POST /api/chat` performs zero writes on any path** (Plan 08 §7 invariant 1) — a cancelled call has nothing to undo, superseding the earlier apply-then-history reasoning (nothing was ever written until a separate Apply anyway) | Product/UX | `plans/01-core-loop-implementation-plan.md` § 7, Phase 4.4/4.7; `plans/08-prometheus-apply.md` §7 invariant 1 | ✅ Locked | Plan 01 review, 2026-07-26; supersession 2026-08-06 (Plan 08) |
| 24 | Propose-preview: show Prometheus's proposed changes (description/sections/config) and require explicit "Apply" before anything lands — **unconditional, the only mode, not a per-user setting** (formalizes D1's original "addable later" note) | Product/UX | `plans/08-prometheus-apply.md` §6 (the ChatPanel proposal card), §3 (the propose/apply split) | ✅ **Locked and built** | Plan 01 review, 2026-07-26; built Plan 08, 2026-08-06 |
| 25 | Prompt-file source of truth: `lib/ai/prompts/system-agents/*.md` is the only copy of a system agent's rules, ever — **three files now (Hermes, Daedalus, Prometheus), not two**. `scripts/build-prompts.ts` compiles each into a plain string constant at **build time** (`predev`/`prebuild`); **for a file with a leading `---` frontmatter block (all three, since the 2026-08-05 real-agent reformat), everything after the closing `---` is used verbatim as the compiled prompt** — the old strip-to-first-`##` logic is now an unused fallback for a shape no current source file has; the running server never reads the source `.md` files at all — no `.txt` duplicate, no runtime filesystem access, output gitignored and always regenerated | Architecture | `plans/01-core-loop-implementation-plan.md` § 9 (D6), Phase 0.1/0.3/0.7; `scripts/build-prompts.ts` | ✅ Locked | Plan 01 review, 2026-07-26; mechanism corrected 2026-08-06 (real-agent reformat, 2026-08-05) |
| 26 | **[HIGH PRIORITY]** `lib/ai/prompts/generated/*.ts` should be human-readable, not a single-line escaped string. Confirmed as a real problem in the built Phase 0 output (2026-07-26): `scripts/build-prompts.ts` currently emits `export const X = "## ROLE\n\nYou are...";` — one giant line, unreadable if anyone opens the generated file to sanity-check what actually compiled. Fix: emit a template literal (backticks) with the source's real line breaks preserved, so the generated `.ts` reads like the original `.md`'s Role/Behavior/Guardrails/Output structure, not an escaped blob. Still auto-generated/gitignored — this is a formatting fix to the generator, not a reversal of #25's compile-time approach | Architecture | `scripts/build-prompts.ts` | ⬜ Deferred — not fixed yet, tracked as a high-priority backlog item, not built into the initial Phase 0 pass | Found during Phase 2 kickoff, 2026-07-26 |
| 27 | **Structural Import (Stage 2b)** — a second import mode alongside Strict Import: Stage 1 (deterministic split) is shared, but instead of labels-only Stage 2, the AI receives the full blueprint catalog + the complete raw agent text and returns the **entire restructured agent body** as one document — not a `{blockId → sectionKey}` mapping. As of the Fable Review 1 hardening pass (2026-07-28), **Structural Import is designated the PRIMARY/default import mode** once built; Strict Import remains the secondary "verbatim, no AI restructuring" option, lightly hardened but not further invested in. The standard (Strict) importer stays two-stage, content-never-touches-AI, deterministic-round-trip-provable (Rules Index #5/#6) | Product/Architecture | `lib/ai/prompts/system-agents/import-instructions-structural.md` | ✅ Locked and built — `lib/ai/structuralConverter.ts`, `app/api/agents/import/route.ts` `mode` field (default `'structural'`) shipped as `plans/02-import-hardening-structural.md` Phase B | Raised during live Stage-2 testing prep, 2026-07-26; designed 2026-07-28; hardening plan written 2026-07-28 (Fable Review 1) |
| 31 | Structural Import's safety model is **prompt-enforced restructure, to be paired with a deterministic code-enforced coverage check** — unlike Strict Import (#5/#6, where the server deterministically copies content and the AI never sees or emits it), Stage 2b's guardrails (no meaning rewrite, no content loss, verbatim movement, no hallucination) live in `import-instructions-structural.md` and are trusted the same way the chat-mediator's rewrite guardrails are trusted, with no span/byte verification. Planned code-enforced layer: `lib/import/coverage.ts` will normalize each Stage-1 source block and check what fraction of its lines survive (as substrings) in the model's output document — low coverage produces a `warnings[]` entry on the response, never a hard block (recovery already exists via `rawSourceSnapshot` + `AgentSnapshot` + `SectionRevision`). Separately, a planned **hard fail**: if the model's response is truncated (`stop_reason === 'max_tokens'`), that is content loss by definition and will be rejected outright (422 `structural_truncated`), never stored | AI guardrail (converter, structural mode) | `system-agents/import-instructions-structural.md` § Guardrails; `lib/import/coverage.ts` (not yet built); `lib/ai/structuralConverter.ts` (not yet built) | ✅ Locked and built — `lib/import/coverage.ts` (coverage check → `warnings[]`) and the `stop_reason === 'max_tokens'` truncation guard (422 `structural_truncated`) both shipped, `plans/02-import-hardening-structural.md` Phase B5/B2 | Designed 2026-07-28; hardening plan written 2026-07-28 |
| 32 | Structural Import's ambiguity fallback: **last resort only.** The AI must genuinely try every canonical/optional section first; only when content fits none of them may it invent a new, clearly named custom block. This is a deliberate loosening of Strict Import's "never guess, leave unmapped" rule — Strict Import's `unmapped` bucket is unaffected | AI guardrail (converter, structural mode) | `system-agents/import-instructions-structural.md` § Behavior #10, § Guardrails #5 | ✅ Locked and built — rule-set text adopted, pipeline shipped (Plan 02 Phase B) | Designed 2026-07-28 |
| 33 | **A1 — re-import section reconciliation must become identity-based, not sectionKey-based.** `sectionKey` is not unique per agent (multiple `custom` rows are routine — headingless preamble + every unmapped/last-resort block). The current `upsertAgentFromImport` reconciles via a `sectionKey`-only `Map`, which silently collapses distinct `custom` rows onto one on re-import (confirmed live in the code, not just theoretical). Fix: match incoming sections to db sections by `(sectionKey, heading)` in document order (first-unmatched-pop) | Schema/product | `lib/db/repository/agents.ts` `upsertAgentFromImport` | ✅ Fixed — reconciliation now matches by `(sectionKey, heading)` in document order, `plans/02-import-hardening-structural.md` Phase A1 | Fable Review 1 finding 1 (most severe), 2026-07-28 |
| 34 | **A2 — malformed frontmatter must fail loudly, not silently.** Today `parseFrontmatter` catches a `yaml.load` failure and returns `[]`, silently discarding the entire frontmatter block (confirmed live: `parseFrontmatter.ts:38-41`) — the agent then imports with `name: ''` and a second malformed file overwrites it. Fix: throw a typed `FrontmatterParseError` on a matched-but-unparseable block (no frontmatter at all stays a valid `[]` case); `POST /api/agents/import` maps this to `400 { error: 'invalid_frontmatter' }`. Independently, `upsertAgentFromImport` must reject an empty/whitespace-only `name` (`400 { error: 'missing_name' }`) — flag-don't-block (#1) covers name *format*, not name *absence* | Schema/validation | `lib/serialize/parseFrontmatter.ts`; `app/api/agents/import/route.ts`; `lib/db/repository/agents.ts` | ✅ Fixed — `FrontmatterParseError` thrown on malformed frontmatter, empty/whitespace names rejected 400, `plans/02-import-hardening-structural.md` Phase A2 | Fable Review 1 finding 3, 2026-07-28 |
| 35 | **A3 — non-scalar frontmatter values must be preserved, not destroyed.** Today `parseFrontmatter.ts:49` does `String(value)`: a YAML block-list becomes a comma-joined string and a nested mapping becomes the literal `"[object Object]"` (confirmed live). Fix: `FrontmatterEntry.rawValue` becomes `string \| string[]` — a scalar array survives as `string[]`; anything else non-scalar throws `FrontmatterParseError('unsupported_frontmatter', key)` → `400`, naming the key (a stated limitation until a deferred `__raw` escape hatch exists for genuinely nested frontmatter, e.g. `mcpServers` maps) — loud beats silently destroyed. Note: the golden round-trip invariant (§ Draft B) proves parse∘export **idempotence**, not md→structure losslessness — this class of parser-internal loss is invisible to it; a dedicated block-list fixture is needed to cover it directly | Parsing (deterministic) | `lib/serialize/types.ts`, `lib/serialize/parseFrontmatter.ts`, `lib/serialize/export.ts`, `lib/db/repository/agents.ts` (`serializeAgentSnapshot`), `lib/blueprint/rules.ts` (`computeValidation`), `lib/import/assemble.ts` | ✅ Fixed, then **superseded 2026-07-31** (roadmap TODO item 2): `FrontmatterEntry.rawValue` is now `string \| string[] \| Record<string, unknown> \| unknown[]` — a nested mapping/list is preserved verbatim instead of throwing `unsupported_frontmatter`. The `__raw` escape hatch this row deferred to was retired in favor of a real `datatype: 'json'` on the catalog side (see #39/#40) — same "loud beats silently destroyed" spirit, but the loud case is now genuinely unparseable YAML only (A2), not "nested at all" | Fable Review 1 finding 4, 2026-07-28; superseded 2026-07-31 |
| 36 | **B3 — re-import short-circuit on identical raw bytes (planned).** If an agent with the incoming `name` already exists and its stored `rawSourceSnapshot` is byte-for-byte identical to the incoming raw markdown, the import route should skip the AI call entirely and return the current `AgentDTO` with `{ skipped: 'unchanged' }` — avoids paying Structural Import's latency/cost on a no-op re-import | Product/Architecture | `app/api/agents/import/route.ts` (not yet built) | ✅ Built — the unchanged-`rawSourceSnapshot` short-circuit returns `{ skipped: 'unchanged' }` without an AI call, `plans/02-import-hardening-structural.md` Phase B3 | `plans/02-import-hardening-structural.md`, 2026-07-28 |
| 37 | **`model.allowedValues` corrected: short aliases (`sonnet`/`opus`/`haiku`/`fable`) + full model IDs + `'inherit'`.** Real Claude Code subagent docs (`code.claude.com/docs/en/sub-agents`) document the alias as the primary form and `'inherit'` as the actual default when `model` is omitted — not just a value "kept for now." Supersedes #19. Confirms MyAgent's target format (`.claude/agents/*.md`) is the right one: this is the Claude Code CLI's own subagent schema, also loaded identically by a self-hosted Claude Agent SDK runtime — distinct from and *not* Anthropic's separately-billed, hosted Managed Agents product (`platform.claude.com/docs/en/managed-agents/*`), which was evaluated and explicitly ruled out as a target in the same discussion | Schema/seed | `lib/blueprint/catalog.ts` `CONFIG_DEFS.model` | ✅ Locked | Blueprint research session, 2026-07-28 |
| 38 | **`tools.allowedValues` refreshed to the real, current 43-tool Claude Code catalog** (`code.claude.com/docs/en/tools-reference`), replacing a stale 10-entry list. Two of the ten were actually wrong: `Create` was never a real Claude Code tool name (confirmed absent from the current docs — an artifact of whatever real agent file seeded this catalog; the `dev.md` golden fixture still has it, and `computeValidation` was already correctly flagging it as unrecognized), and `Task` was renamed to `Agent` in Claude Code v2.1.63 (kept only as a backward-compat alias in real files, not a current tool name). `permissionMode.allowedValues` also gained `'manual'` (documented alias for `'default'`, v2.1.200+) | Schema/seed | `lib/blueprint/catalog.ts` `CONFIG_DEFS.tools`/`.permissionMode` | ✅ Locked | Blueprint research session, 2026-07-28 |
| 39 | **Four `CONFIG_DEFS` fields added that exist in the real subagent frontmatter schema but were never modeled: `hooks`, `isolation`, `color`, `initialPrompt`.** `isolation` (enum, only real value `'worktree'`), `color` (enum, 8 named values), and `initialPrompt` (string) are straightforward. `hooks` is a nested object (`PreToolUse`/`PostToolUse`/`Stop` matchers) with no fit in the `string`/`enum`/`int`/`bool`/`list` datatypes — modeled as `datatype: 'any'`, and it will hit A3's `unsupported_frontmatter` loud-reject on import today (same nested-object limitation as #40), not silently supported | Schema/seed | `lib/blueprint/catalog.ts` `CONFIG_DEFS` | ✅ Locked (fields added); `hooks` import support resolved 2026-07-31 (roadmap TODO item 2) — moved from `datatype: 'any'` to a real `datatype: 'json'`, imports end-to-end now (was tracked under #40) | Blueprint research session, 2026-07-28; resolved 2026-07-31 |
| 40 | **`mcpServers` inline nested-object gap confirmed real, not hypothetical.** A3's stated limitation (Rules Index #35) was "revisit if real files with nested `mcpServers` maps actually appear" — the real subagent schema documents exactly this: an `mcpServers` entry may be an inline MCP server config object (`type`/`command`/`args`/...), not only a flat server-name string. Importing such a file today correctly fails loudly (`400 unsupported_frontmatter`) rather than silently destroying the config, per A3's design — but it does fail, which real files can now trigger. Still deferred pending the `__raw` escape hatch (Plan 02 Phase D); status promoted from speculative to confirmed | Parsing (deterministic) | `lib/serialize/parseFrontmatter.ts` (A3); `plans/02-import-hardening-structural.md` Phase D | 🔴 Confirmed real gap → ✅ **Resolved 2026-07-31** (roadmap TODO item 2): `mcpServers` moved from `datatype: 'list'` to a real `datatype: 'json'`; `parseFrontmatter` preserves the inline nested object verbatim instead of rejecting it. The `__raw` hatch this row was deferred to was retired, not built, in favor of this | Blueprint research session, 2026-07-28; resolved 2026-07-31 |
| 41 | **Single-choke-point rule (Plan 04), extended to a second library (Plan 06).** Exactly one file in the entire codebase may import `@anthropic-ai/sdk`: `lib/ai/anthropicProvider.ts`. `lib/ai/client.ts` was deleted. `lib/ai/gateway.ts` is the only file in `lib/ai/` allowed to import from `lib/db/`. The same pattern applies to `arctic`, the OAuth client library: exactly one file, `lib/auth/oauth/google.ts`, may import it, and no test may import it or contact a real provider (Plan 06 constraint 9/11). Both SDK's one-importer rules are enforced by fitness-function tests, not convention. No future session should add a second import path for either library without first deleting or failing the relevant fitness test | Architecture | `lib/ai/provider.ts`, `lib/ai/anthropicProvider.ts`, `lib/ai/gateway.ts`, `lib/ai/__tests__/architecture.test.ts`; `lib/auth/oauth/google.ts`, `app/api/__tests__/route-guard.test.ts` | ✅ Locked | Plan 04, 2026-07-29; extended Plan 06, 2026-07-31 (Phase 1, commit ea2867f) |
| 42 | **Dry-run hard-stop semantics.** When `liveLlmCalls` is effectively false, zero network bytes leave the process. No synthetic response is constructed. The would-be request is written to `llm_call_log` (`dryRun: true`, full `requestPayload`, `responsePayload: null`). The gateway returns `{ ok: false, reason: 'dry_run_blocked' }`; callers throw `LlmDryRunBlockedError`; routes return `409 { error: 'llm_dry_run', dryRun: true, kind, model, logId }`. The 409 is checked by `ImportDialog` and `ChatPanel` **before** their generic `!response.ok` branch, so an unhandled dry-run cannot silently render as a no-op (which was the reason 200+discriminant was rejected) | Architecture | `lib/ai/gateway.ts`, `app/api/agents/import/route.ts`, `app/api/chat/route.ts`, `app/components/Library/ImportDialog.tsx`, `app/components/Chat/ChatPanel.tsx` | ✅ Locked | Plan 04, 2026-07-29 |
| 43 | **Log-write placement and failure policy.** `lib/ai/gateway.ts` writes every `llm_call_log` row — not the callers, not the routes. This is the only location that sees the dry-run path, the real wall-clock duration, the raw `usage`, and every possible failure (network, auth, abort). On live calls, a log-write failure is swallowed and `logId: null` is returned — the money was already spent, discarding the response would be strictly worse. On dry-run calls, a log-write failure still blocks the call (`logId: null`) — a failed log write must never be a path to a live network call. No DB transaction spans a network call | Architecture | `lib/ai/gateway.ts`, `lib/db/repository/llmCallLog.ts` | ✅ Locked | Plan 04, 2026-07-29 |
| 44 | **Settings default-on / garbage-off asymmetry.** `getLiveLlmCalls()` in `lib/settings.ts`: row absent → `true` (fail-open, preserves today's behavior, missing row = never configured = default on); `'true'` → `true`; `'false'` → `false`; anything else → `false` + `console.warn` (fail-closed on garbage — money-spending defaults may only come from the *absence* of config, never from *unparseable* config). No cache — fresh `SELECT` on every gateway call | Architecture | `lib/settings.ts` | ✅ Locked | Plan 04, 2026-07-29 |
| 45 | **`agentId` in `llm_call_log` is never backfilled.** Import log rows frequently have `agentId: null` because the agent does not exist at call time (it is created from the AI's response). The `agentLabel` column stores the frontmatter name for display. No `UPDATE` is ever run on the log table to fill the id in after the fact — that would violate the append-only invariant (same rule as `sectionRevision`/`agentSnapshot`). A first-time-import row keeps `agentId: null` permanently; that is factually correct | Data integrity | `lib/db/repository/llmCallLog.ts`, `app/api/agents/import/route.ts` | ✅ Locked | Plan 04, 2026-07-29 |
| 46 | **`llm_call_log` is append-only.** No `UPDATE` or `DELETE` is exported from `lib/db/repository/llmCallLog.ts`. Deleting an agent leaves its log rows intact (soft `agentId` ref, matching `sectionRevision`/`agentSnapshot`). Log rows are diagnostic, not business-invariant — they may not be compliance-grade (see Deferred Decisions) | Data integrity | `lib/db/repository/llmCallLog.ts` | ✅ Locked | Plan 04, 2026-07-29 |
| 47 | **`setting` seeded with `onConflictDoNothing`.** `lib/db/seed.ts` inserts `{ key: 'liveLlmCalls', value: 'true' }` using `onConflictDoNothing()`. Using `onConflictDoUpdate` here would silently reset the switch to on every `npm run dev` (because the seed runs via `predev`) — a money-spending regression disguised as a seed. This is the opposite of the `configDef`/`sectionDef` rows (which use `DoUpdate` because the catalog is code-owned and must heal). The comment at the call site names this explicitly. Extended to `maxUsers` and `maxLlmCallsPerUserPerHour` (Plan 05). | Data integrity | `lib/db/seed.ts` | ✅ Locked | Plan 04, 2026-07-29; extended Plan 05, 2026-07-30 |
| 48 | **Ownership is enforced in the repository, in the same statement that touches the row.** Every exported repository function that reads or writes an `agent` or `group` takes an `ownerId` and applies it in the `WHERE` clause. A route cannot fetch someone else's agent even if the author forgets to check, because there is no function that will return it. (`lib/db/repository/agents.ts`, `groups.ts`) | Architecture | `lib/db/repository/agents.ts`, `lib/db/repository/groups.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 49 | **`ownerId` is never optional and never defaulted in any function signature.** An optional parameter is an opt-out, and an opt-out will eventually be taken by accident. | Architecture | All repository functions in `agents.ts` and `groups.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 50 | **Cross-owner denial returns `404`, never `403`.** A `403` confirms the resource exists. The only `403` in this plan is the admin-only gate on `/settings`, where the resource's existence is not a secret. Cross-owner access is also logged server-side (`[auth] cross-owner access attempt`). | Architecture | Route handlers; `lib/db/repository/` | ✅ Locked | Plan 05, 2026-07-30 |
| 51 | **`middleware.ts` is never the authorization boundary and never reads the DB.** Next.js CVE-2025-29927 (patched in 15.2.3; this repo runs 15.5.22+) demonstrated that a design in which middleware is the sole gate is one framework CVE away from full data exposure. Every route handler and server component independently establishes its own session via `authenticate()` / `requirePageSession()`. | Architecture | `middleware.ts`, `lib/auth/guard.ts`, `lib/auth/session.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 52 | **Password hashing never happens inside a `db.transaction()` callback.** `better-sqlite3` transaction callbacks must be synchronous; `bcryptjs`'s async API inside one would either throw or silently commit outside the transaction. Enforced structurally: `createUserWithInvite()` accepts a `passwordHash`, never a plaintext password. The bootstrap admin is created by SQL with the `''` sentinel; login explicitly rejects the sentinel before ever calling `verifyPassword`. | Architecture | `lib/db/repository/users.ts`, `lib/auth/password.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 53 | **Signup cannot mint an admin; no request field influences `role`.** `createUserWithInvite()` always writes `role: 'user'`. There is no promotion endpoint or promotion UI — promoting a second admin is `UPDATE user SET role='admin' WHERE email=?`, documented in `docs/user-guide.md`. | Data integrity | `lib/db/repository/users.ts`, `app/api/auth/signup/route.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 54 | **Role is read fresh from the DB on every request, never from a token claim.** The JWT carries `sub`, `email`, and `exp` only — no `role` claim. `getSession()` does one indexed PK lookup on `user` after verifying the token. A demotion takes effect on the next request, not the next login. | Architecture | `lib/auth/jwt.ts`, `lib/auth/session.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 55 | **Invite codes are single-use and stored in plaintext, deliberately.** Hashing would make them unreadable to the admin, who needs to re-send a code. A code is single-use, worthless once redeemed, worthless once `maxUsers` is reached, and only readable by someone who already has admin access. Revisit trigger in Deferred Decisions (P05e). | Data integrity | `lib/db/repository/users.ts`, `app/api/settings/invite-codes/route.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 56 | **`maxUsers` is checked inside the signup transaction, not only before it.** Two friends redeeming the same code in the same second must produce exactly one account. The `user.email` unique index is the backstop for the email race; `UPDATE … WHERE redeemed_by IS NULL` is the backstop for the code race; the in-transaction count is the backstop for the cap race. | Data integrity | `lib/db/repository/users.ts` `createUserWithInvite()` | ✅ Locked | Plan 05, 2026-07-30 |
| 57 | **`llm_call_log.shared_with_admin` is written once at write time and never updated.** Changing the preference at `/account` affects future rows only. Retroactively hiding past shared rows would break an admin's audit trail; retroactively exposing past private rows would be a privacy violation. Both directions are stated to the user at `/account`. | Data integrity | `lib/ai/gateway.ts`, `lib/db/repository/llmCallLog.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 58 | **Consent is never inferred from the absence of a refusal.** At signup, only a request body carrying literally `shareLogsWithAdmin: true` grants consent. Absent, null, `"true"`, `1`, or malformed → `false`. A malformed body can never silently mean "shared." | Data integrity | `app/api/auth/signup/route.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 59 | **Redaction of another user's payloads happens in the repository, not the view.** `getCallLog(id, viewerUserId)` nulls `requestPayload` and `responsePayload` for non-consented rows. An unredacted payload is not merely *not rendered* — it is never loaded into the response object. `viewerUserId` is a required, non-defaulted parameter for the same reason `ownerId` is (#49). | Architecture | `lib/db/repository/llmCallLog.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 60 | **The per-user LLM cap (15 calls/hour, rolling window, admin-exempt) is enforced in `lib/ai/gateway.ts`, never in a route handler.** The gateway is already the single choke point every AI call must pass (#41). The cap sits *after* the dry-run branch (so dry-run mode is still available when capped) and *before* the provider call (so a capped call never spends money). A capped call writes no log row (the log table is the counter; denials would inflate it and push `retryAfterSeconds` forward). | Architecture | `lib/ai/gateway.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 61 | **`forceDryRun` may only downgrade a live call to a dry run; no request field can cause a real API call that would not otherwise have happened.** Accepted from the request body because it can only cause *less* spending. `ctx.forceDryRun` is set from the body; the body cannot unset the global `liveLlmCalls = false`. | Architecture | `lib/ai/gateway.ts`, `app/api/chat/route.ts`, `app/api/agents/import/route.ts` | ✅ Locked | Plan 05, 2026-07-30 |
| 62 | **`/api/account` and `/account` operate only on `session.userId`; no user id is accepted from a body, query string, or path segment.** There is no cross-user variant of these endpoints to get wrong. | Architecture | `app/api/account/route.ts`, `app/account/page.tsx` | ✅ Locked | Plan 05, 2026-07-30 |
| 63 | **There is exactly one JWT verification implementation.** `middleware.ts` calls `verifySessionToken()` from `lib/auth/jwt.ts`; no other file imports `jwtVerify`/`SignJWT` from `jose` for session tokens. Fixes a prior drift where `middleware.ts` carried its own inline `verifyToken()` (no algorithm restriction, a silent-`false` secret check instead of `lib/env.ts`'s length-validated one) | Architecture | `middleware.ts`, `lib/auth/jwt.ts`, `app/api/__tests__/route-guard.test.ts` | ✅ Locked | Plan 06 §3.1, constraint 1 — built Phase 0, commit 1d77019 |
| 64 | **Nothing in `middleware.ts`'s transitive import graph may reach `lib/db/`, `next/headers`, `bcryptjs`, or `node:*`.** The Edge runtime cannot open `better-sqlite3`. Rule 63's fix is what first opens the door (middleware now imports from `lib/auth/`) — this fitness test is what keeps it from widening into a DB import | Architecture | `middleware.ts`, `app/api/__tests__/route-guard.test.ts` | ✅ Locked | Plan 06 constraint 3 — built Phase 0, commit 1d77019 |
| 65 | **The JWT `exp` and the session cookie `maxAge` always derive from the same `getSessionTtlSeconds()` call.** `SESSION_TTL_SECONDS` is an optional env var (default 7 days, bounds 60s–90d); an invalid value throws at boot rather than falling back to the default | Data integrity | `lib/auth/constants.ts`, `lib/env.ts` | ✅ Locked | Plan 06 §3.2, constraint 4 — built Phase 0, commit 1d77019 |
| 66 | **OAuth is a login mechanism, never an admission mechanism.** Creating a user from an OAuth callback redeems an invite code and re-checks `maxUsers` inside the same transaction `createUserWithInvite()` already uses for password signup — one primitive, extended, not duplicated | Data integrity | `lib/db/repository/users.ts` | ✅ Locked | Plan 06 constraint 5 — built Phase 2/3, commits a937297, 9aee4bf |
| 67 | **An account is created only from a flow that started on `/signup`** (`tx.mode === 'signup'`), because the invite code and the §5.6 consent answer are collected there and nowhere else. A `mode: 'login'` callback that finds no match redirects to `/signup?error=oauth_no_account`, never creates | Data integrity | `app/api/auth/oauth/[provider]/callback/route.ts` | ✅ Locked | Plan 06 constraint 6 — built Phase 3, commit 9aee4bf |
| 68 | **Provider identity is `(provider, providerAccountId)`, never the email.** A later sign-in never rewrites `user.email` from a provider claim; `providerEmail` on `oauth_account` is audit/display only | Data integrity | `lib/db/schema.ts`, callback route | ✅ Locked | Plan 06 constraint 7 — built Phase 2/3, commits a937297, 9aee4bf |
| 69 | **No OAuth provider token — access, refresh, or `id_token` — is ever persisted, logged, or returned to a client.** There is deliberately nowhere in the schema to put one; failure logs record the `OAuthError` code only | Security | `lib/auth/oauth/*`, `lib/db/schema.ts` | ✅ Locked | Plan 06 constraint 8 — built Phase 1/3, commits ea2867f, 9aee4bf |
| 70 | **An OAuth profile is trusted only when the `id_token`'s signature, `iss`, `aud`, `exp`, and `nonce` all validate and `email_verified === true`** (the boolean, never coerced) | Security | `lib/auth/oauth/google.ts` | ✅ Locked | Plan 06 §3.6 — built Phase 1, commit ea2867f |
| 71 | **The OAuth transaction cookie is single-use and cleared on every exit path from the callback**, with an identical `path` on clear and set | Security | `lib/auth/oauth/tx.ts`, callback route | ✅ Locked | Plan 06 constraint 10 — built Phase 1/3, commits ea2867f, 9aee4bf |
| 72 | **Auto-linking a Google identity to an existing account on a verified email is unconditional — every domain, no toggle — and its residual risk is a reviewed, accepted decision, not a default.** The Google Workspace domain-takeover vector (a domain's Workspace admin can mint an identity for any address on it) was written out in full and accepted 2026-07-31; the `hd`-claim restriction, the never-auto-link posture, and an admin kill switch were each offered and declined. **Do not silently "harden" or "loosen" this — it is a decision with a stated revisit trigger** (Deferred Decisions row P06a). The `[auth] oauth account auto-linked` log line is the audit trail it relies on | Security | `app/api/auth/oauth/[provider]/callback/route.ts` | ✅ Locked | Plan 06 §3.7, §16.5 — built Phase 3, commit 9aee4bf |
| 73 | **`POST /api/chat` never writes to the agent.** It reads, calls Prometheus, and returns a proposal. The only row it can cause is the gateway's `llm_call_log` row | Architecture | `app/api/chat/route.ts` | ✅ Locked and built | Plan 08 §7 invariant 1, 2026-08-06 |
| 74 | **A config write always merges onto the current full config set** before `updateAgent()`, which full-replaces. A partial config map must never reach it — the defect this rule exists to prevent, with a dedicated regression test that was watched to fail before the fix | Data integrity | `app/api/agents/[id]/apply-proposal/route.ts` | ✅ Locked and built | Plan 08 §3.4, §7 invariant 5, 2026-08-06 |
| 75 | **`agent.name` is never chat-editable, enforced server-side at apply** — not only by a prompt guardrail. A `name` key in the apply payload is dropped and listed in `skipped[]` | Security / invariant | `app/api/agents/[id]/apply-proposal/route.ts` | ✅ Locked and built | Plan 08 §3.3 step 4, §7 invariant 2, 2026-08-06 |
| 76 | **AI-authored content receives no validation the manual path does not.** No datatype/`allowedValues`/`required` enforcement is added for AI-proposed values — "never block" is project-wide (same principle as Rule #1) | Product/architecture | `app/api/agents/[id]/apply-proposal/route.ts` | ✅ Locked and built | Plan 08 §3.5, §7 invariant 6, 2026-08-06 |
| 77 | **Full-value replacement only.** No diff format ever crosses the wire; Prometheus is never asked to echo a "before" value; before/after display in the proposal card is assembled entirely from state already held client-side | AI guardrail (Prometheus) | `system-agents/prometheus.md`; `app/components/Chat/ChatPanel.tsx` | ✅ Locked and built | Plan 08 §7 invariant 3/4, 2026-08-06 |
| 78 | **The pending-proposal lock is client-side, cooperative, and `localStorage`-scoped per `userId`+`agentId`.** Not server-enforced; does not sync across devices. Both gaps are reviewed and accepted, not oversights (`plans/roadmap.md` FUTURE) | Product/UX | `lib/proposalStore.ts` | ✅ Locked and built | Plan 08 §5.6, 2026-08-06 |
| 79 | **Only the latest turn's proposal is actionable**; sending a new message discards the previous one unapplied (Decision F) | Product/UX | `app/components/Chat/ChatPanel.tsx` `handleSend` | ✅ Locked and built | Plan 08 §5.4, §7 invariant 7, 2026-08-06 |
| 80 | **The chat system agent is Prometheus**, authored in MyAgent's own Agent pattern (real-agent shape: YAML frontmatter + `#`-level Role/Behavior/Guardrails/Output sections); `lib/ai/prompts/system-agents/prometheus.md` is its single source, compiled at build time (#25). It remains platform-owned and is never a DB-backed, user-editable agent (`plans/roadmap.md` FUTURE) | Architecture | `lib/ai/prompts/system-agents/prometheus.md`, `lib/ai/prometheus.ts` | ✅ Locked and built | Plan 07 Phase 1; Plan 08, 2026-08-06 |
| 81 | **`section_revision.author: 'ai'` means "applied through the chat proposal flow,"** not a verified claim of model authorship — the apply payload is client-supplied by design (no server-side proposal store to compare it against, per #78) | Data integrity / honesty | `app/api/agents/[id]/apply-proposal/route.ts` | ✅ Locked and built | Plan 08 §9.2, §7 invariant 11, 2026-08-06 |
| 28 | **Removed** — Stage 2 never classifies config/frontmatter data, only body-block sectionKey. The `propKey` mapping capability (`{blockId, propKey}`) was found to be dead code: `assemble.ts` never read it, config values were already 100% deterministic from Stage 1's frontmatter parse. Frontmatter keys are already exact, unambiguous strings — there was never a genuine classification problem there for AI to solve, unlike section headings (which vary unpredictably across real agent files). Removed from `Stage2Mapping`'s type, `importConverter.ts`'s validation, `assemble.ts`'s handling, and `import-instructions.md`'s OUTPUT FORMAT | Schema/Architecture | `lib/ai/importConverter.ts`, `lib/import/assemble.ts`, `lib/ai/prompts/system-agents/import-instructions.md` | ✅ Locked (removal) | Live Stage-2 testing prep, 2026-07-26 |
| 29 | `renderBlueprintForPrompt()` takes `{ includeConfig?: boolean }`, default `true`. The import converter now calls it with `includeConfig: false` — following #28, sending the config-fields catalog to Stage 2 was pure dead-weight tokens for a decision it's never asked to make. The chat mediator (Phase 4, not yet built) keeps the default `true` — it needs full agent context, config included | Architecture | `lib/blueprint/prompt.ts`, `lib/ai/importConverter.ts` | ✅ Locked | Live Stage-2 testing, 2026-07-26 |
| 30 | **Future flag — reconsider AI-assisted config-key mapping.** #28 removed `propKey` because it was dead code, not because the underlying idea (a messy/nonstandard frontmatter key like `tool_list` getting recognized as the canonical `tools`) is necessarily wrong forever. Today an unrecognized key just stores openly as unknown — safe, but a human still has to notice and manually fix it. A "middle way" was discussed and set aside 2026-07-26 (same safe pattern as section classification — AI labels the *key*, never touches the *value*) — worth revisiting if messy frontmatter keys turn out to be a real recurring papercut once real imports are happening | Product | *(not yet added)* | ⬜ Deferred — revisit only if real-world imports show this is an actual recurring problem, not speculative | Live Stage-2 testing, 2026-07-26 |
| 82 | **New optional section: `boundaries`** (`# BOUNDARIES`, label "Boundaries"). Distinct from Guardrails: Guardrails covers *actions* the agent must not take (`# RULES`); Boundaries covers *assumptions/inferences* the agent must not make when context is incomplete (e.g. "do not infer missing configuration," "do not guess credentials," "do not hallucinate file paths"). `helpText` states this distinction explicitly since Daedalus's own merge rule (Behavior #6, "merge when meaning clearly matches") would otherwise likely fold this into Guardrails — both read as "must not" statements to a model without the differentiation spelled out. `daedalus.md`'s INPUT section prose (which hardcodes the optional-section list — unlike the blueprint attachment itself, which is generated live from `SECTION_DEFS`, `lib/blueprint/prompt.ts`) and Behavior #9's mapping-example list were both updated to match | Schema/seed | `lib/blueprint/catalog.ts` `SECTION_DEFS`; `lib/ai/prompts/system-agents/daedalus.md` § INPUT, § BEHAVIOR #9 | ✅ Locked | User request, 2026-08-07, following the `0708 Copilot Roadmap.md` cross-check session's real-import testing |
| 83 | **Catalog evolution methodology, refined.** `Concept.md`'s original `SECTION_DEFS`/`CONFIG_DEFS` were derived strictly from auditing the real local 15-agent `~/.claude/agents/` library — locked, historical, not revised. Going forward, new catalog entries no longer require re-auditing that same local sample; they may come from **informed refinement** — patterns recognized from broader agent-design experience/other sources — but still never from unexamined guessing. The bar stays "does this reflect a real, recurring pattern," it's just no longer limited to what the original 15 files happened to contain. Practical consequence: a refinement-sourced entry defaults to **optional**, never core — core status is reserved for what the original audit found near-universal (12+/15 real agents) | Process | `architecture/Concept.md` § Real-library audit | ✅ Locked | User request, 2026-08-07 |
| 84 | **Structural Import section order is deterministically re-sorted server-side, not trusted to Daedalus's own document order.** Guardrail #8 (#82) asks the model for canonical-core → optional-used → last-resort-custom ordering, but three real test runs against byte-identical input produced three different orderings — the model doesn't reliably follow it. Since ordering is purely mechanical once `sectionKey` is known (no judgment call, unlike the merge-vs-keep-separate decision Guardrail #6 governs), `assembleStructural.ts` now re-sorts classified blocks itself by `SECTION_DEFS.defaultOrder` (core, then optional-used, then named custom last, stable within the custom group) before assigning final `order` indices — a headingless preamble block is exempted and always stays first, per Behavior #4, despite sharing `sectionKey: 'custom'` with a named-but-unmatched heading. Same "don't leave a deterministic decision to the model" principle as #3 (heading fabrication, re-enforced at write time) and the `sectionKey` exact-match itself | Schema/Architecture | `lib/import/assembleStructural.ts` | ✅ Locked and built | User request, 2026-08-07, found via real-import testing after #82 |
| 85 | **A section's display label prefers its catalog label, then its own heading text, and only falls back to the raw `sectionKey` when neither exists.** Found live: every `custom` section rendered as the generic word "CUSTOM" regardless of what Daedalus actually named it (e.g. `# MISSION` showed as "CUSTOM", not "MISSION") — the stored `heading` field was already on the DTO and simply never consulted for display. `sectionDisplayLabel()` fixes this in one place, used both for the section header and the citation-chip label, which had the identical bug independently | UI/data | `app/components/CustomViz/SectionBlock.tsx` (`sectionDisplayLabel`), `AgentView.tsx` | ✅ Locked and built | User request, 2026-08-07, found via real-import testing |
| 86 | **A past chat turn's proposal is reopenable read-only after it's resolved (applied or discarded), not just summarized by its chips.** `ChatMessage` now stores the full `modifications` object alongside the existing summary-key fields, rendered as a "View proposed changes" `<details>` — skipped only while that exact message is still the live, actionable pending proposal (avoids two toggles for the same thing). Deliberately **no** "show current" comparison here, unlike the live card: the agent may have changed since that turn, so today's live value isn't a trustworthy "before" for an old proposal — showing it would misrepresent history. In-memory only, same lifetime as the rest of `messages` (no chat persistence yet, NEXT item 2) — this does not survive a reload, and applies to discarded turns too, not only applied ones | Product/UX | `app/components/Chat/ChatPanel.tsx` | ✅ Locked and built | User request, 2026-08-07 |
| 87 | **Chat calls now carry real dialogue history, not just the current instruction.** Each `/api/chat` call sends prior turns (`{role, message}`) — client-side notices (dry-run/error/network-error/cancelled) excluded — prepended to the Anthropic `messages` array before the current turn's full self-contained payload (§5.1–§5.3, unchanged). Server caps how many prior turns are actually used to `settings.chatHistoryTurns` (new `SETTING_DEFS` entry, admin-configurable, default 10, 0 disables history) regardless of how much the client sends — client-supplied history is never trusted at face value (same posture as #7). History carries only the natural-language `message`, never the raw `modifications` JSON: an applied proposal's content reaches the next turn automatically via the fresh per-call agent load, so it needs no special-casing; an unapplied one is only knowable to the model via what it previously *said*, which is an accepted, deliberate simplification, not an oversight | Architecture / AI guardrail (Prometheus) | `lib/ai/prometheus.ts`, `app/api/chat/route.ts`, `app/components/Chat/ChatPanel.tsx`, `lib/settings.ts` | ✅ Locked and built | User request, 2026-08-07 |

**Note on #7's supersession:** the original rule (Review 7, `architecture/audits/DesignReview.md` finding 7,
"Injection surface") scoped the mediator to exactly one `sectionId` chosen by the server.
Rereading that finding's own reasoning: the rule was never about section-level granularity
being correct — it's blast-radius containment, and the finding's own words already accept
"worst case, the model corrupts the user's own agent" as tolerable for local single-user,
recoverable via `SectionRevision`. Widening the scope from one section to the whole agent
(so `SectionRevision` stays purely a per-section *log*, not the edit *boundary* — see D2,
Plan 01 review) doesn't cross a line that finding didn't already accept; the two guardrails
that actually bound the risk — **no tools**, **never fabricate a split-level heading** —
are unchanged. `architecture/audits/DesignReview.md` itself is left untouched as the historical record of the
original, narrower reasoning; re-audit still applies when sharing/forking (build-order #5)
makes imported foreign agents untrusted input to system prompts.

**Second supersession, 2026-08-05/06:** the agent-wide-scope widening above was about *which
sections* could be rewritten, not *what kind* of edit. Sections-only was itself widened at
`plans/roadmap.md`'s 2026-08-05 design session — Prometheus (renamed from "the chat mediator")
may now also propose `description` and `config` edits, with `name` as the one stated exception
(#75). This did **not** reopen the blast-radius reasoning above; it's covered by the same two
guardrails (no tools, never fabricate a heading) plus the new propose-then-apply gate (#24) —
nothing a proposal contains is ever written without an explicit human Apply click. Built as
Plans 07 (the rename + output contract) and 08 (the apply mechanism, the lock, the UI).

## Data model

### Overview

```
Group ──< Membership >── Agent ──< AgentConfig >·· ConfigDef    (·· = soft lookup by key, NO FK)
  │                        │
  │                        └──< AgentSection >·· SectionDef  (·· = soft lookup by key, NO FK)
  └─ parentId (self, nullable)
```

**Symmetric by design.** An agent has two zones, each modeled the same way:

| | **Config** (frontmatter) | **Sections** (body) |
|---|---|---|
| Predefined catalog | `ConfigDef` | `SectionDef` |
| Per-agent values | `AgentConfig` | `AgentSection` |
| User action | **picks** from `allowedValues` | **writes** from a `template` |
| Custom/unknown | any `propKey`, no FK | any `sectionKey`, no FK |

Both use **EAV** (Entity-Attribute-Value): rather than a column per field, each value is a
row (`AgentConfig` / `AgentSection`) softly linked to a catalog def by key. The two
spec-**required** fields (`name`, `description`) stay as real columns on `Agent` for
constraints + fast queries; everything else lives in the value tables.

### Entity: `Agent`

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | uuid | PK | internal — **never exported** |
| `ownerId` | text | not null | Soft reference → `user.id`. All reads and writes are owner-scoped at the repository layer — the same statement that fetches or mutates the row applies `WHERE owner_id = ?`. A cross-owner attempt returns `null`/`false`/throws, never a forbidden status visible to the caller (Rules Index #48–#50). The standalone `.unique()` on `name` is replaced by a composite unique index `(owner_id, name)` — two users may each own an agent named `dev`. |
| `name` | string | not null, unique per owner | Config `name`. Stored verbatim regardless of casing/format (e.g. imported `Zara`) — never blocked or silently rewritten on import (Principles #3/#10). **Not validated at all**: the lowercase-hyphen name-spec check and its `nameSpecViolation` flag were removed entirely per explicit user decision (`lib/blueprint/rules.ts`, `ValidationResult`, `AgentDTO.validation`) — see `CHANGELOG.md`. |
| `description` | text | not null | Config `description`. **Missing on import → placeholder + a `descriptionMissing` validation flag** (review finding 12) — same flag-don't-block pattern as `name`, never a hard block. |
| `createdAt` / `updatedAt` | timestamp | not null | |
| `source` | enum | not null | `created` / `imported` — provenance |
| `platform` | string | not null, default `'claude'` | **Not a closed enum** — its allowed values live in the `PlatformDefs` catalog (plan §4), the same openness pattern as `propKey`/`sectionKey`. Only `'claude'` exists as a catalog entry today; Copilot/other platforms are added later as a catalog entry + export serializer, not a migration. Exists so "which platform is this agent's canonical shape modeled on" is queryable, distinct from *export* (translating to a different platform at export time — see Deferred: Export adapters, below). |
| `rawSourceSnapshot` | text \| null | | The **entire original `.md`** (frontmatter + body), byte-for-byte, captured once at import — independent of how Stage 2 sliced/labeled it into sections. This is the concrete home for Draft A's "the raw original is retained with the import" — previously a sentence with no schema behind it. Lets you always see literally what was imported, even if a Stage-2 mapping decision turns out wrong. `null` for agents created directly in the platform (no import to snapshot). |

---

## Zone 1 — Config (frontmatter)

### Entity: `ConfigDef` (the config catalog)

Defines *what* config props exist and how to render/validate each. Seed data from the
Anthropic spec; updatable as Anthropic evolves (so validation stays current without code
changes). **A lookup, not a gate** — see the no-FK rule below.

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | PK |
| `key` | string | unique — the frontmatter key, e.g. `model`, `tools` |
| `label` | string | UI label |
| `datatype` | enum | `string` / `enum` / `int` / `bool` / `list` / **`any`** (freeform, no validation) |
| `allowedValues` | json \| null | options for `enum` / `list` (the dropdown source) |
| `required` | bool | |
| `isCore` | bool | show by default vs. "advanced" |
| `exportable` | bool default true | **deferred lever** — for a future known-but-platform-only prop. Today every def is `true`; unknown props default `true` too. Added now only if/when the first non-exporting prop appears. |

Seed excerpt: `model`(enum), `tools`(list), `permissionMode`(enum), `maxTurns`(int),
`skills`(list), `background`(bool), `effort`(enum). The `any` datatype backs deliberately
freeform slots.

### Entity: `AgentConfig` (per-agent config values — EAV)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `agentId` | uuid → Agent | not null | |
| `propKey` | string | not null | **free text — NO foreign key to `ConfigDef`** |
| `value` | json | not null | scalar **or** list: `"opus"` · `["Read","Edit"]` · `8` · `true` |

PK `(agentId, propKey)` — one value per prop per agent. The **JSON `value`** column is why
lists and scalars share one table and why there's no separate "bucket".

**Openness rules (the "never block me" guarantee):**
- **No FK on `propKey`.** Any invented key stores fine. The catalog only *enriches* a known
  key (label, dropdown, validation); it never rejects an unknown one.
- **Unknown `propKey` → treated as `datatype: any`** — generic input, no validation, still
  stored, still exported. This is the "add a config prop that isn't in the list" case,
  working automatically.
- **Deliberate freeform slot** — seed a `ConfigDef` with `datatype: any` when you want a
  known-but-unvalidated field to appear in the UI on purpose.
- ~~**Deferred escape hatch:** a reserved `propKey = "__raw"` holding a verbatim YAML/text
  blob, appended untouched on export, for anything too messy to parse into key-value.~~
  **Retired 2026-07-31** (roadmap TODO item 2) in favor of a real `datatype: 'json'` —
  `parseFrontmatter` now preserves a genuinely nested mapping/list verbatim instead of
  rejecting it, so no separate raw-blob mechanism is needed. See Rules Index #35/#40.

**Worked example — the real `dev` agent:**

`Agent`: `{ id: a-01, name: "dev", description: "Use AFTER @architect…", source: imported }`

`AgentConfig`:
| agentId | propKey | value (JSON) |
|---|---|---|
| a-01 | `model` | `"claude-sonnet-4-6"` |
| a-01 | `tools` | `["Read","Edit","Write","Create","Bash","Grep","Glob","mcp", …]` |

Both surface the review feature for free: `"claude-sonnet-4-6"` isn't in `model`'s
`allowedValues` → flagged as outdated; `"Create"` isn't a standard tool → flagged as
unknown.

---

## Zone 2 — Sections (body)

Same pattern as Config, with one honest difference: config values are **picked** from a
closed set (`allowedValues` → a dropdown), but section content is **written** freeform
markdown. So `SectionDef`'s equivalent of "pre-defined options" isn't a value list — it's a
**`template`** (a pre-filled scaffold) plus **`helpText`** (what belongs here). That
scaffold is the "easy for non-experts" lever: never a blank box.

### Entity: `SectionDef` (the section catalog)

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | PK |
| `key` | string | unique — `role`, `behavior`, `guardrails`, `output`, `sources`, `lifecycle`, `handoffs`, `tone`, `modes` |
| `label` | string | UI label |
| `defaultHeading` | string | the rendered `# HEADING`, e.g. `# ROLE` |
| `isCore` | bool | seeded into every new agent vs. opt-in |
| `defaultOrder` | int | suggested position in the body |
| `template` | text (markdown) | **the pre-filled scaffold** — the "pre-defined option" for a section |
| `helpText` | text | editor guidance: what goes here, common traps |

Seed (core = ✅): `role`(✅,1), `behavior`(✅,2), `guardrails`(✅,3 → `# RULES`),
`output`(✅,4 → `# OUTPUT FORMAT`), then optional `sources`(5), `lifecycle`(6),
`handoffs`(7), `tone`(8), `modes`(9). Example `role.template`:
`"You are a [senior X] specializing in:\n- …\n\nYour job is to …"`

### Entity: `AgentSection` (per-agent section values — EAV)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | uuid | PK | |
| `agentId` | uuid → Agent | not null | |
| `sectionKey` | string | not null | **free text — NO foreign key to `SectionDef`** |
| `heading` | string | **nullable** (review finding 1b) | rendered `# HEADING`; for custom, the original text (lossless). `null` = a headingless block (e.g. Stage 1's pre-heading preamble) — export renders it as bare content, no invented heading. An invented heading would re-parse as a real section on next import, breaking the round-trip. |
| `content` | text (markdown) | | the section body |
| `order` | int | not null | render + export order |

**Openness rules — identical to Config:**
- **No FK on `sectionKey`.** A known key gets the def's template + helpText; an unknown one
  (`sectionKey = "custom"`, or the raw heading) still stores, renders, and exports.
- **New agent** → seed a `AgentSection` per `SectionDef` where `isCore = true`, in
  `defaultOrder`, pre-filled with `template`. No blank page.
- **Add optional section** → "+ Add section" menu populated from non-core `SectionDef`
  rows; picked section drops in with its template + helpText.
- **Custom section** → any heading the user types → `custom`, never blocked, lossless.
- **AI edits a section in place** → chat targets a `AgentSection.id` and rewrites its `content`;
  the structured view re-renders that one block. *This is why the body is rows, not a blob.*
- The full `.md` body = `AgentSection` rows by `order`, each as `# {heading}` + content.

### Entity: `SectionRevision` (append-only edit history — review finding 5, extended)

**Why it exists:** the mediator rewrites `AgentSection.content` in place, and chat is
ephemeral in the MVP. Without history, one bad AI edit ("tighten the guardrails" replaces
80 good lines with 12 mediocre ones) is an **unrecoverable loss** — fatal to trust in a tool
whose whole pitch is *trustworthy* AI editing.

**Scope — logged from import onward, not just from the first AI edit:** every section's
history starts the moment it's *created*, whichever way that happens, and every edit after
that appends a new row. Nothing about a section's content ever changes without a row here.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | uuid | PK | |
| `sectionId` | uuid | not null | **references `AgentSection.id`, but not as a cascading FK.** If the section is later deleted (e.g. removed on re-import, below), its revision rows are *not* deleted with it — the log outlives the live row on purpose. Same "soft reference" pattern already used for `propKey`/`sectionKey` elsewhere in this doc. |
| `content` | text (markdown) | not null | the section's **full content** at this point in time — always the whole text, never a diff. This is what makes the log self-sufficient: no row depends on any other row to be readable. |
| `author` | enum | not null | `import` \| `reimport` \| `scaffold` \| `user` \| `ai` — who produced this revision |
| `createdAt` | timestamp | not null | |

**How the five authors populate it:**
- **`import`** — the moment Stage 2 labels a block and the server creates the
  `AgentSection` row (see Draft A), it also writes revision #0 for that section:
  `author: "import"`, content = exactly what Stage 1 captured. This is the anchor every
  later diff/revert compares against — "what did this look like on day one."
- **`scaffold`** — a section created directly in the platform (not imported) gets its
  revision #0 written with `author: "scaffold"`, content = the `SectionDef.template` text.
  Kept distinct from `import` (no file was involved) and from `user` (no human typed this —
  it's platform-generated starter text) — Rules Index #21.
- **`user`** — every manual save from the structured view appends a row, `author: "user"`.
- **`ai`** — every mediator rewrite appends a row, `author: "ai"`, *before* (or atomically
  with) overwriting `AgentSection.content`.
- **`reimport`** — see the re-import policy below (Draft A). Kept as its own author value,
  distinct from `import`, so the log visually distinguishes "day one" from "an externally
  diverged file landed back in."

**Why "before" never needs a special step:** because every mutation already appends a row,
the "before" state for *any* future overwrite — a re-import included — is simply **the
section's last-existing revision**. Nothing extra has to be written to capture it; it's
already there.

**Append-only, no delete/update.** `AgentSection.content` always holds the current state
(the latest revision, denormalized for fast reads); `SectionRevision` is the log. Revert =
copy an old revision's content back into `AgentSection.content` — which itself appends a
new `user`-authored revision (a revert is just an edit whose new content happens to match
an old one; no special "revert" author needed for the MVP). No revert UI required yet —
the table existing is what matters; "restore this version" is a thin read + write on top,
addable anytime without a schema change.

### Entity: `AgentSnapshot` (whole-agent import/export capture — Rules Index #15/#16)

**Why it exists — separate from `SectionRevision`:** `SectionRevision` is per-section and
answers "what did this one section look like before." It doesn't cheaply answer "what did
the *whole agent* look like right before this re-import landed, vs. right after" — that
would mean reconstructing every section's state at two points in time from an interleaved
per-section log. `AgentSnapshot` answers that directly: one row, one point in time, the
whole agent as exported markdown text.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | uuid | PK | |
| `agentId` | uuid | not null | **soft reference, not a cascading FK** — same pattern as `SectionRevision.sectionId`. Deleting the agent does not delete its snapshots. |
| `kind` | enum | not null | `pre-import` \| `post-import` \| `export` |
| `content` | text (markdown) | not null | the **full exported `.md`** for the whole agent at this point in time (reuses the existing deterministic `export()` function — not a separate serialization) |
| `createdAt` | timestamp | not null | |

**When it's written (Plan 01 scope):**
- **Re-import of an existing agent** — `export()` the agent's *current* state, write
  `kind: "pre-import"`, **before** applying any change from the incoming file.
- **Every import (first-time or re-import)** — after `repository.upsertAgentFromImport`
  completes, `export()` the *new* state, write `kind: "post-import"`.
- First-time import of a brand-new agent has no prior state, so it only ever gets a
  `post-import` snapshot.

**Deferred (Rules Index #16):** `kind: "export"` — written when a user explicitly exports
an agent to a file — has no capture point yet because Plan 01 has no export route (export
is currently only an internal function used for the round-trip test). The enum value
already exists so wiring this in later is one write call, not a migration. Likewise, a
diff view that reads a `pre-import`/`post-import` (or future `export`) pair and shows what
changed is an explicitly future feature — out of scope for Plan 01.

### Entity: `Group`

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | |
| `ownerId` | text | Soft reference → `user.id`. Same owner-scoped repository enforcement as `Agent` (Rules Index #48–#50). Composite unique index `(owner_id, name)`. |
| `name` | string | user-defined, unique per owner |
| `parentId` | uuid → Group \| null | **nullable; always null in flat MVP.** Present now so flat→nested is additive with zero data migration |
| `createdAt` | timestamp | |

### Entity: `Membership` (Agent ↔ Group, many-to-many)

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | uuid → Agent | |
| `groupId` | uuid → Group | |

Composite key `(agentId, groupId)`. This join is what lets one agent live in many groups.
Untagging deletes a membership row only — never the agent. Nesting later does not touch
this table.

### Entity: `User` (Plan 05)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | text uuid | PK | |
| `email` | text | not null, unique | Normalized to lowercase + trimmed before both storage and lookup. |
| `passwordHash` | text | not null | bcrypt hash (cost 10), or `''` for the un-activated bootstrap row. Login explicitly rejects an empty hash before ever calling `verifyPassword` (Rules Index #52; §3.7). |
| `role` | text | not null, default `'user'` | Values `'admin' \| 'user'`. Drizzle's `enum` on SQLite text is TypeScript-only — no `CHECK` constraint is generated, so adding a third role later needs no migration. Signup always writes `'user'`, unconditionally (Rules Index #53). |
| `shareLogsWithAdmin` | int boolean | not null, default `false` | The user's standing consent for the admin to read their prompt/response content in the activity log (§5.6). **Default-false is the whole point**: consent must be an action, never an omission. Read at LLM-call time and *copied onto each log row* — the row's copy, not this column, governs what the admin sees (append-only invariant, Rules Index #57). |
| `createdAt` | int timestamp | not null, default now | |

The bootstrap admin (`id: BOOTSTRAP_USER_ID`) is created by the migration only when legacy data exists (existing agents/groups that need an owner), with `passwordHash: ''`. `npm run auth:bootstrap` sets the real credentials — it never runs automatically (§5.1, Rules Index #52). All existing agents and groups are migrated to the bootstrap admin's `ownerId`.

### Entity: `InviteCode` (Plan 05)

| Field | Type | Notes |
|-------|------|-------|
| `code` | text | PK — canonical `XXXX-XXXX-XXXX-XXXX`, 31-char alphabet (no `I`/`L`/`O`/`0`/`1`), ~79 bits of entropy. Stored **plaintext** so the admin can re-read it from the Settings panel. Single-use enforced by the PK + the `redeemed_by IS NULL` check inside the signup transaction. |
| `note` | text \| null | Optional admin label ("for Alice"). |
| `createdBy` | text | Soft ref → `user.id`. |
| `createdAt` | int timestamp | |
| `redeemedBy` | text \| null | Soft ref → `user.id`. Null = unused. |
| `redeemedAt` | int timestamp \| null | Both null or both set, atomically. |

### Entity: `OAuthAccount` (Plan 06)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `provider` | text | PK part 1 | Lowercase registry key (`'google'`). Not a Drizzle enum — an open catalog, same precedent as `agent.platform` — so a second provider is a code change, no migration. |
| `providerAccountId` | text | PK part 2 | The provider's stable subject id (Google's `sub`). **Never the email** (Rules Index #68). Opaque, never parsed or displayed. |
| `userId` | text | not null, indexed (`oauth_account_user_idx`) | Soft ref → `user.id`, matching every other cross-table link in this schema. |
| `providerEmail` | text \| null | | The email as the provider asserted it *at link time*. Audit/display only — never authoritative, never used to look up a user. |
| `createdAt` | int timestamp | not null, default now | Insert-only. No `lastLoginAt` (Deferred Decisions, table below) — nothing reads it yet and it would turn an insert-only table into one with an `UPDATE` on the login hot path. |

Composite PK on `(provider, providerAccountId)` — in SQLite this **is** the unique index the identity relies on, strictly stronger than a surrogate `id` + a separate unique constraint (no second identifier to drift out of agreement). A second unique index, `oauth_account_user_provider_unique` on `(userId, provider)`, caps a user at one linked account per provider — more than one *provider* per user is fine, two Google accounts on one MyAgent user is not. No token columns of any kind (Rules Index #69) — there is deliberately nowhere to put one. Never updated, never deleted by the application (manual `DELETE` only, documented in `docs/user-guide.md`).

### `llm_call_log` additions (Plan 05)

Two columns added to the existing table (see Rules Index #45/#46 for the append-only invariant, extended here):

| Column | Type | Notes |
|-------|------|-------|
| `userId` | text \| null | Soft ref → `user.id`. Null for pre-auth rows (before multi-tenancy existed) — **never backfilled**, same policy as `agentId` (Rules Index #45). |
| `sharedWithAdmin` | int boolean | not null, default `0`. Written by the gateway at call time from `getUserPolicy(userId).shareLogsWithAdmin`. **Never updated after write** (Rules Index #57). For redaction rule: the admin sees full payloads only when this is `true`. Pre-auth rows (`userId IS NULL`) are never redacted regardless of this flag. |

New composite index `llm_call_log_user_created_idx` on `(user_id, created_at)` serves the per-user hourly cap count query (Rules Index #60).

### Note on catalogs

The valid model/tool values are **not** separate `ModelCatalog`/`ToolCatalog` tables —
they're absorbed into `ConfigDef.allowedValues` (the `model` def's list of models, the
`tools` def's list of tools). One catalog drives every dropdown and every validation.
`Agent.platform`'s allowed values are the one exception: a small standalone `PlatformDefs`
array (Rules Index #17), not folded into `ConfigDef`, since it describes the agent record
itself rather than a config/section value on it.

### Deferred (not in the data model yet, noted so we don't design them out)

- **AI chat persistence** — a `Conversation` / `Message` per agent, if we decide chats
  should persist. MVP can keep chat ephemeral (in-memory per session).
- **Export adapters** — Copilot/others live as serializers over the same model, not new
  storage.
- **Sharing / forking agents between users** — Concept build-order #5. `ownerId` is the prerequisite it was waiting for. A share would be a new join table, not a change to `ownerId`.
- **Organizations / teams** — `ownerId` currently means "a user". Making it "a principal" is a real remodel; see Deferred Decisions (P05i).
- **`OAuthAccount`** — a table linking `user.id` to `(provider, providerAccountId)`, so a user can sign in with an identity provider instead of (or as well as) a password. **Designed but not built**: `plans/06-auth-review-google-oauth.md` §4.1 has the full definition, pending that plan's review. Noted here so nobody re-derives it or assumes Plan 05 §0's "no OAuth / social login" exclusion still stands — it was deliberately reopened on 2026-07-31.

## The Agent Blueprint

The **Agent Blueprint** is the platform's canonical, authoritative definition of a valid
agent — it holds *all possibilities*: every config prop, every section type, their allowed
values / templates, and the rules. It is the target the AI import converts *toward*, and
the basis of validation.

- **Derived from the catalogs, not hand-maintained.** The Blueprint is generated from
  `ConfigDef` + `SectionDef` (+ the design rules). Those seed tables already enumerate
  "all possibilities", so **the Blueprint exists as soon as the catalog seeds are done.**
- **One source, three consumers.** The same Blueprint drives the **UI** (dropdowns,
  templates), the **AI import** (conversion target), and **validation**. No drift between
  them because they read one definition.
- **Versioned + updatable** as Anthropic's spec evolves — same as the catalogs it comes
  from.
- Naming note: "Blueprint" is deliberately distinct from *data model* (tables) and *AI
  model* (the LLM). Three different things — don't call any of the others "the model".

## System agents vs. user agents

Two AI behaviors are **infrastructure**, not user content:
- **the import converter** — maps a raw `.md` onto the Blueprint (Draft A). Has **two
  user-chosen modes**: Strict Import (Stage 2, labels-only, content never touches the AI —
  Rules Index #5/#6) and Structural Import (Stage 2b, the AI sees full content and returns
  a complete restructured document — Rules Index #27/#31/#32). Two rule-set files, one
  system-agent role.
- **the chat mediator** — the agent-aware chat that edits the agent in place (any of its
  sections, per instruction — see Rules Index #7).

These are **system agents**: owned by the platform, seeded at startup, never editable by
end users. They are distinct from **user agents** (the user's own `dev`, `Zara`, … — fully
editable). Same Blueprint format, different ownership/scope.

**Who is who (the mental model):**
- **The waiter = the platform, acting through its system agent** (converter / mediator).
  The platform is the actor; the system agent is how that behavior is *defined*.
- **The meal = the user's agent** — the content being converted or edited.
- **The customer = the user.**

The platform never hands the customer the raw kitchen (the LLM directly) — every AI action
goes *through* the platform's own waiter. That's why the waiter must be platform-owned.

| | System agents | User agents |
|---|---|---|
| Examples | import-converter, chat-mediator | `dev`, `Zara`, `Ada` |
| Owned by | the platform (code/config, versioned in migrations) | the user |
| End-user editable | ❌ no | ✅ yes |
| Breaks the app if wrong | yes → protected | no |
| Format | Agent Blueprint | Agent Blueprint |

**Precedent:** Claude Code itself does this — built-in subagents (Explore, Plan) are
system-owned and non-editable, alongside user subagents (fully editable). Two scopes, one
format.

**MVP call:**
- Write the converter + mediator as **code/config-owned prompt templates** — simplest,
  safest, and it sidesteps the bootstrap problem (import can't depend on an agent that
  itself must be imported first).
- **Author them in the Blueprint shape** so they can graduate to formal system-scope agents
  later (dogfooding; tuned by an admin, never the end user) without a rewrite.
- **Never** put the mediator in the user's editable library — reliability + prompt-injection
  + tool-access control all demand it stay platform-owned.

**Why `lib/ai/prompts/system-agents/*.md` use a Role/Behavior/Guardrails/Output structure:** same
reason any user agent gets that shape — rules you (a human) can read, test, and adapt
without re-deriving them from paragraphs of prose. These files are reviewable and testable
on their own, not buried in this document.

**Policy, locked 2026-07-26 (applies to every file under `lib/ai/prompts/system-agents/`, present
and future):** these files are **compiled ~1:1 into the actual system prompt** sent to the
model (`scripts/build-prompts.ts` strips only the leading title/blockquote before the first
`##` — everything else goes verbatim). Because of that, **every sentence in the compiled
portion must be a literal, model-facing instruction or fact about what the model actually
receives — never a note addressed to a human reader.** Concretely:
- No design rationale ("this exists because…", "same reason as…") — that belongs here, in
  `TechDesign.md`, not in the prompt the model reads.
- No cross-references to other files ("see `chat-mediator.md`", "see `TechDesign.md` →
  Draft A") — the model cannot open another file; a sentence that only makes sense to a
  human holding the repo open doesn't belong in a prompt.
- No claims about what's provided that aren't literally true of that exact request — e.g.
  don't say "you are given the blocks" when only a `blockId` + heading are actually sent;
  say precisely what's sent.
- The **only** place human-readable framing belongs in these files is the file's own
  structural formatting (the `## ROLE` / `## BEHAVIOR` / `## GUARDRAILS` / `## OUTPUT
  FORMAT` headings themselves) — not explanatory prose layered on top of it.
- Rationale that used to live inline in these files (why the split-level guardrail matters,
  why a corrupted agent is recoverable, why import and mediator divide the split-level
  concern the way they do) now lives here: split-level policy is in Draft A above; the
  recoverability/blast-radius reasoning is in Rules Index #7's supersession note below.

## Serialization contract (import ↔ export)

- **Export (Claude):** `name` + `description` (columns) and every `AgentConfig` row →
  YAML frontmatter; `AgentSection` rows by `order` → body. **Platform internals never export**
  (`Agent.id`, `Membership` group links — they aren't frontmatter). **Custom/unknown props
  always export** — they're the agent's own, kept losslessly. (`exportable = false` is the
  future lever if a known platform-only prop ever exists.)
- **Import (Claude):** the two-stage, AI-assisted, always-safe conversion — see **Draft A**.
  Stage 1 captures frontmatter + body blocks losslessly; Stage 2 maps them onto the
  Blueprint (`name`/`description` → columns, other keys → `AgentConfig`, blocks →
  `AgentSection` by type), content verbatim, unmappable → `custom`.
- **Round-trip test** (must hold): import an existing agent, export it, and the result is
  semantically identical to the original (props + sections preserved in order).

**Export rule, refined:** "spec-clean" means *don't leak our internals* (ids, groups) —
not *forbid your custom keys*. Your own frontmatter, spec or not, round-trips.

## Decision drafts

Three downstream decisions. A + B are drafted below; C (stack) is a placeholder for the
real debate.

### Draft A — Import: two-stage, AI-assisted, always safe

Import is **AI-assisted conversion toward the Agent Blueprint**, not a dumb parser — but
built so loss/rewording is impossible (Principles #3, #10). Two stages:

> **The system agent's actual rule-set (Stage 2's exact behavior/guardrails/output schema)
> lives in `lib/ai/prompts/system-agents/import-instructions.md`** — a reviewable, testable file, not
> prose buried in this doc. This section covers only what belongs here: the *architecture*
> (the two-stage split, what data each stage owns). The write-time guard that keeps section
> *content* from breaking the split-level rule lives in
> `lib/ai/prompts/system-agents/chat-mediator.md`, since the mediator (and manual edits) — not
> import — is where that risk actually originates.

**Stage 1 — deterministic lossless capture (the safety net).**
Split the raw `.md` into frontmatter + raw body blocks, byte-for-byte. No intelligence, no
loss. Implemented in `lib/serialize/splitBody.ts`; the exact algorithm, precisely (moved
here 2026-07-26 — this is documentation for humans reviewing how the platform works, not
model-facing prompt content, so it doesn't belong inside the import-instructions rule-set
the AI actually receives):

- **A heading** is any line matching one to six `#` characters followed by a space (e.g.
  `# ROLE`, `## Mode A`) — **except** a line inside a fenced code block (opened by 3+
  backticks or 3+ tildes, closed by a matching-or-longer fence of the same character). A
  `#` inside a fence is never a heading. **An unclosed fence** means everything from the
  fence-open to end-of-body is content — no further headings are detected past that point
  (a stated rule, not an edge case that falls out by accident).
- **The split level is chosen per file, dynamically.** Stage 1 scans the whole body first,
  collects every heading level actually present, and splits on the **shallowest** one.
  Most agents split on `#` (level 1). A file whose shallowest heading is `##` (e.g.
  `orchestrator`, which never uses a bare `#`) splits on `##` instead — and in that case a
  `###` inside one of those sections is **not** a further split, it's just content inside
  that block, exactly like a bullet list or a code block would be.
- **Only headings at that one split level become block boundaries.** A block's content is
  everything from just after its heading line up to (but not including) the next
  split-level heading — anything nested deeper, however it's formatted, is part of that
  block's content, not a separate block.
- **Pre-heading prose** → a block at `order: 0`, **`heading: null`** (see `AgentSection`) —
  but only if it has real (non-whitespace) content; a purely blank preamble produces no
  block at all.
- **No headings anywhere in the body** → the entire body is one block (`heading: null`), or
  zero blocks if the body is itself empty/whitespace-only.
- Every block carries a stable **`blockId`** (`"block-0"`, `"block-1"`, … assigned in
  document order) and its heading text (or `null`) — the heading is structural metadata,
  distinct from the block's body content.
- The **raw original is retained** with the import, so Stage 2 is reviewable + reversible.
- **Split-level policy (review finding 1a) — the rule, briefly:** each agent has one
  shallowest-heading-level used for splitting (`#` normally, `##` for `orchestrator`-style
  agents), and section *content* must never contain a heading at that same level, or
  export→re-import silently fabricates an extra section. The write-time enforcement (who
  checks it, when, how a violation is handled) is the mediator's concern — see
  `lib/ai/prompts/system-agents/chat-mediator.md` § Guardrails #2.

**Stage 2 — AI labels blocks; the server reassembles content.** The full rule-set (exact
response schema, guardrails, output format) lives in
`lib/ai/prompts/system-agents/import-instructions.md`. That file is deliberately kept concise and
model-facing only — it tells the AI *what it receives and what to do with it*, not a
human-oriented explanation of Stage 1's internals (that's the bullet list above). The one
architectural fact that belongs here:
**content never enters the AI's output.** The AI classifies each Stage-1 block by id
against the Blueprint; the server — deterministic code, not the model — copies `content`
byte-for-byte from Stage 1's capture into the row the AI labeled. This is what makes
"verbatim" a property of the code path instead of a prompt promise a long or busy response
can quietly violate.

Trade-off: richer, cleaner import than a pure parser, with zero loss risk. The AI mapping
can be improved over time without schema changes; until then, anything uncertain simply
lands as `custom`.

**Two import modes (Rules Index #27/#31/#32).** Everything above (Stage 1 + Stage 2) is
**Strict Import** — code-enforced-safe, kept as the secondary "verbatim, no AI
restructuring" path. **Structural Import** is the **primary/default** mode (flipped from
Strict 2026-07-28, Fable Review 1 hardening pass), for agents too malformed/drifted for
Strict Import's classification to handle well. It shares Stage 1 (the deterministic split
is still the safety net for knowing what content existed), but replaces labels-only Stage 2
with **Stage 2b**: the AI receives the blueprint catalog + the complete raw agent text, and
returns the entire restructured agent **body** as one document (no frontmatter — the server
handles that deterministically in both modes), not a mapping. Its rule-set lives in
`lib/ai/prompts/system-agents/import-instructions-structural.md`. The safety model is different by
necessity — Strict Import's guarantee is code-enforced (content literally never reaches the
model's output); Structural Import's guarantee is prompt-enforced (verbatim movement, no
meaning rewrite, no hallucination, last-resort-only custom naming for genuinely unmappable
content) **plus a deterministic coverage check** (`lib/import/coverage.ts`, planned — Rules
Index #31) that turns undetected loss into a `warnings[]` entry, never a hard block. The
returned document is persisted by re-running Stage-1 `parse()` on it and mapping headings →
sectionKeys deterministically via `SECTION_DEFS.defaultHeading` — no second AI call. A
re-import whose raw bytes exactly match the stored `rawSourceSnapshot` short-circuits before
any AI call (Rules Index #36). **Rule-set is finalized (merged best-of-both draft, adopted
2026-07-28); the code path (API route `mode` field, `structuralConverter.ts`, coverage
check, UI mode picker) is not yet built** — execution spec is
`plans/02-import-hardening-structural.md` Phase B.

**Re-import policy (review finding 11 — locked, the collision-behavior half):** importing
a `.md` whose `name` matches an existing `Agent.name` is **always an update-in-place** —
never a duplicate, never a hard error, never a prompt asking what to do in the moment.
Same "never block me" openness as every other collision in this design. Concretely, per
section the incoming file maps to:
- **Changed content** → the section's `content` is overwritten, and a new `SectionRevision`
  is appended with `author: "reimport"`. The "before" state needs no special handling — it's
  simply the section's prior last revision, already in the log (see `SectionRevision` above).
- **A section present in the file but not previously in the platform** → created fresh,
  revision #0 tagged `author: "reimport"` (distinct from `import`, since it arrived via a
  re-import event, not the agent's original import).
- **A section previously in the platform but absent from the incoming file → deleted,
  no confirmation needed.** Because `SectionRevision` already retains the section's full
  content history independent of the live row (see `sectionId`'s no-cascade note above),
  deleting the `AgentSection` row loses nothing — the log still has everything that was
  ever in it. There's no reason to keep a row alive just to avoid data loss that isn't
  actually at risk.

### Draft B — Round-trip fidelity (semantic, NOT byte-exact)

Storage is structured, so export *regenerates* the file from data — it emits the tool's
formatting, never the original's bytes. Byte-exact would force storing the raw original
text alongside the structure (defeats "structured is master") **and would fight the
mission** — normalizing the drift we found (quoting, outdated models, tool bloat) is a
*feature*, not data loss.

- **Preserve:** every frontmatter key + value (incl. unknowns), every section in order,
  heading + content.
- **Normalize:** YAML/quote/heading/list formatting → the tool's clean canonical output.
- **Hard line:** normalize structure + frontmatter formatting, but leave **section body
  content byte-for-byte untouched** — user prose/tables/code are never reflowed.
- **Testable invariant — structural idempotency, not textual equality:**
  `parse(export(parse(md))) === parse(md)`. Import → export → re-import yields identical
  structured data. This is the real data-loss guard. Note (Rules Index #35, A3): the
  invariant proves parse∘export **idempotence**, not md→structure losslessness —
  parser-internal loss (e.g. `String(value)` silently destroying a list) is invisible
  to it because both sides of the comparison are equally wrong. That class of loss
  requires a dedicated fixture that asserts the parsed intermediate directly (e.g.
  confirming a block-list `tools:` survives `parse → export → parse` as a `string[]`,
  not a comma-joined string).
- **YAML parsing (review finding 1d):** parse frontmatter with a **string-preserving**
  mode (failsafe schema — scalars stay strings, no `4.6` → float / `no` → bool coercion).
  **Comments are explicitly accepted as lost** — they aren't keys, so there's no `custom`
  slot to hold them; this is a stated exception to losslessness, not a silent gap.
- **Golden-file test (review blind spot #3):** before building the UI, write `lib/serialize`
  and run import → export → re-import over all real agents in `~/.claude/agents/`, asserting
  structural equality. This exercises the split-level rule, the headingless preamble, and
  the `Zara`-style naming case against real data — proving the invariant where it matters.

### Draft C — Stack (SETTLED)

**Decision: a single Next.js full-stack app.** Local-first, single-user, one app that
holds the AI key server-side, talks to SQLite, and serves the 4-pane UI — one process, one
deploy unit. The data model + Drafts A/B are storage-engine-agnostic, so this choice
touches only *how* we build, not *what* we store.

| Layer | Pick | Why |
|-------|------|-----|
| **Shell** | Local web app (`localhost:3000`) | Same codebase goes online later (Vercel/Azure) with no rewrite — just add auth. No native packaging. |
| **Frontend** | **Next.js (React) + App Router** | The 4-pane workbench. React comes with Next; no separate Vite. |
| **Backend** | **Same Next app** — Route Handlers (`app/api/…`) + Server Actions | Run **server-side**, so they hold the key. No second service, no CORS, shared TS types end-to-end. |
| **Styling** | **Tailwind CSS + shadcn/ui** | Fast, polished, accessible components; the mainstream pairing. |
| **Storage** | **Drizzle ORM + SQLite** (`better-sqlite3`), behind a **repository layer** | SQL-first, strong TS types for the EAV tables, simple migrations for the `ConfigDef`/`SectionDef` seeds. **Correction (review finding 3):** this is *not* a driver swap later — Drizzle schemas are dialect-specific (`sqliteTable` vs `pgTable`), and SQLite/Postgres/Azure SQL differ on booleans, timestamps, and JSON storage. Locked now: all DB access goes through a thin **repository layer** (conservative column types — text/integer/JSON-as-text) so a future migration is a schema-file rewrite behind that boundary, not an app-wide rewrite. **Deferred:** the actual target dialect (Postgres vs. Azure SQL) — no code impact today, decide when the migration is real. |
| **AI** | **`@anthropic-ai/sdk`** (official TS SDK) | Called only from Route Handlers. Default model `claude-opus-4-8`. The converter + mediator are server-side prompt templates. |

**Why Next over Vite (the real fork):** the hard constraint is 🔒 *the key must never
reach the browser* (Principle #8). That needs a server. **Vite is client-only** — using it
would force a second backend service (the earlier "Vite + Hono" shape). **Next bundles the
server into the same app**, so the key lives in the server half of one project. Next isn't
simpler in the abstract; it's the simplest way to get **one app that safely holds a
secret.** SSR/SEO (Next's other selling point) is irrelevant for an app-shell tool — we
pick Next purely for the built-in server.

**Key safety, concretely:** the AI key sits in `.env.local` (git-ignored), read only inside
Route Handlers / Server Actions. The browser calls our own `/api/*` endpoints; it never sees
the key or calls Anthropic directly. Matches Principle #8 from day one.

### Project layout (sketch)

```
myagent/
├── app/
│   ├── page.tsx                 # the 4-pane workbench shell (Example A layout)
│   ├── layout.tsx               # root layout, Tailwind + theme
│   ├── components/              # panels: Library · CustomViz · Chat · Raw
│   └── api/
│       ├── agents/route.ts      # CRUD over Agent + zones (server-side)
│       ├── chat/route.ts        # chat-mediator: edits sections in place (holds key)
│       └── agents/import/route.ts  # import-converter: .md → Blueprint (Draft A)
├── lib/
│   ├── db/                      # Drizzle schema (Agent, ConfigDef/AgentConfig,
│   │   │                        #   SectionDef/AgentSection, Group/Membership) + seeds
│   │   └── migrations/          # catalog seeds = the Blueprint source
│   ├── blueprint/               # Blueprint derived from ConfigDef + SectionDef
│   ├── serialize/               # export (deterministic) + import (Stage 1 capture)
│   └── ai/                      # Anthropic client + system-agent prompt templates
├── .env.local                   # AI key — git-ignored, server-only
└── drizzle.config.ts
```

`app/api/*` is the server tier (holds the key); `app/components/*` is the client tier
(never touches it). The two system agents (converter, mediator) live in `lib/ai` as
code-owned prompt templates — not in the user's editable library (see *System agents vs.
user agents*).

### Learning-goals roadmap (staged, non-blocking)

The user is using this project to build production-engineering skills. These are **layered on
after** the core loop works — none gate the MVP:

1. **JWT auth** — ✅ **Built (Plan 05, 2026-07-30).** Custom `jose`-based HS256 JWT with `httpOnly` cookie sessions; `bcryptjs` password hashing; invite-code signup; admin/user roles; `middleware.ts` + `lib/auth/` subsystem.
2. **Unit tests** — Vitest for `lib/` (serialize, blueprint, db) from early on.
3. **Docker** — containerize the Next app once it runs end-to-end.
4. **CI/CD** — GitHub Actions: test → build → (later) deploy.
5. **Azure** — App Service first; AKS/Kubernetes when K8s is the goal. **This is also when
   #8b below gets decided** — the storage target dialect, informed by whatever Drizzle's
   Postgres/Azure SQL maturity looks like at the time, built on the repository layer
   already in place (§ Draft C).

All are stack-agnostic infra skills, fully learnable on the single Next.js app.

## Deferred decisions (roadmap)

Items from the **Rules Index** above that are intentionally left open — not forgotten,
just correctly sequenced to when their trigger actually arrives. Check this list, not just
memory, before assuming something was decided.

| # | Deferred item | Revisit when |
|---|---|---|
| 8b | Storage target dialect (Postgres vs. Azure SQL) | The Azure step of the learning-goals roadmap (above), when the migration is actually happening |
| 13 | Catalog evolution: distinguish "never known" vs. "was known, catalog changed" | Catalog versioning infrastructure exists (post-MVP) |
| 14 | Manual-edit save frequency: every save logs a `SectionRevision`, or debounced to meaningful edit boundaries | Building the structured-view manual-edit save flow |
| 16 | `AgentSnapshot(kind:'export')` capture + the import/export diff-view UI | The export route is built (later plan) |
| 18 | `ConfigDef` platform-scoping (per-platform `model`/`tools`/etc. catalogs, since fields/allowedValues differ by platform) | A second platform's import/create support is actually being built |
| 19 | ~~Whether `'inherit'` should be an `allowedValues` member of `model` at all~~ — **Resolved 2026-07-28**: real docs confirm `'inherit'` is the actual default when `model` is omitted, so it stays. See #37. | — (resolved, kept here only as a pointer for anyone still holding the old memory) |
| 20 | Display-label lookup for `model` (short name in UI, full ID in storage) | Building any UI surface that renders `model` (later plan) |
| — | ~~Propose-preview before applying a mediator rewrite~~ — **Resolved 2026-08-06**: built as Rule #24, unconditional (not a per-user setting). See Plan 08. | — (resolved) |
| 26 | **[HIGH PRIORITY]** `scripts/build-prompts.ts` should emit readable template-literal output, not an escaped single-line string | Next time anyone touches `scripts/build-prompts.ts`, or before relying heavily on chat-mediator/import-converter debugging |
| 27 | ~~Structural Import (Stage 2b) implementation~~ — **Resolved 2026-07-28**: built in full (`lib/ai/structuralConverter.ts`, `POST /api/agents/import`'s `mode` field, `ImportDialog.tsx`'s mode picker) as Plan 02 Phase B. Kept here only as a pointer for anyone still holding the old memory. | — (resolved) |
| 30 | AI-assisted config-key mapping (labels a messy frontmatter key to its canonical propKey, same content-never-touched pattern as sections) — removed as dead code in #28, not ruled out forever | Real-world imports show messy/nonstandard frontmatter keys are an actual recurring problem, not speculative |
| 40 | ~~`__raw` frontmatter escape hatch for genuinely nested values (`mcpServers` inline server configs, `hooks`) that A3 currently rejects loudly~~ — **Resolved 2026-07-31** (roadmap TODO item 2): built as a real `datatype: 'json'` instead of a raw-blob hatch — see Rules Index #35/#39/#40. | — (resolved) |
| — | **Skill module** — a sibling entity to `Agent`, mirroring its props/config/import/export, for `SKILL.md` files (`.claude/skills/<name>/SKILL.md`). Real `SKILL.md` frontmatter (`name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell`) is a genuinely different shape from an Agent's Role/Behavior/Guardrails/Output Blueprint — no sections, just a name/description header plus procedural instruction content, sometimes with supporting files in the skill's directory (not necessarily one file, unlike an Agent's single `.md`). Would need its own `SectionDef`-equivalent (or no section concept at all — closer to one big body field), its own `ConfigDef` catalog from the field list above, and its own import/export pipeline — a real second Library-panel entity type, not a small addition | Concept.md's build-order list (currently items 1-5) picks this up as a "later plan" once Agent-side Library/groups (build-order #2, `plans/03-*`) and this Blueprint refresh have both landed and proven out |
| P04a | **Second provider implementation (NVIDIA / OpenAI-compatible).** The `LLMProvider` interface (`lib/ai/provider.ts`) is designed to accept a second implementation; `getGateway()` would gain a factory switch (e.g. `LLM_PROVIDER` env var). Not built now because a second implementation without a real target model, key handling, and its own prompt-compatibility testing is speculation | An actual second provider is chosen, with a key and a model to test against |
| P04b | **Incremental streaming (`streamChunks(): AsyncIterable<string>`)** for token-by-token UI chat responses. Adding it is purely additive to `LLMProvider` — no existing signature changes. The `stream()` method already uses the SDK's streaming transport, so no architectural shift is needed | Streaming chat responses become a real UX requirement (Plan 01 D1 deferred streaming for the same reason) |
| P04c | **Log retention / pruning / pagination.** A local single-user DB will not notice a few thousand rows; trigger set at > 5,000 rows or `myagent.db` exceeding ~200 MB. The list endpoint is already capped at 500 server-side; pagination beyond that is also deferred | Either trigger |
| P04d | **Cost estimation in currency on log rows.** `usage` (inputTokens/outputTokens) is already stored; a per-model price table would go stale silently | Token counts stop being sufficient to answer "what did that cost" |
| P04e | **"Replay this request" from a dry-run log row.** The stored `requestPayload` already contains everything needed (system, messages, model, maxTokens) — the data model supports it, the UI does not | Dry-run is used enough that re-running a recorded request by hand becomes a papercut |
| P04f | **Settings modal instead of full-page navigation.** Full navigation discards `ChatPanel`'s local message history (same as agent-switch remount) | Losing chat history when opening Settings turns out to be an actual annoyance in real use |
| P04g | **Component/UI tests for `ImportDialog` / `ChatPanel`.** The dry-run branches added in Plan 04 have no unit tests — consistent with the project-wide gap (roadmap Tier 5). Adding RTL + jsdom + a split vitest config is genuinely separate infrastructure work | Taken up as its own roadmap Tier 5 item |
| P04h | **Compliance-grade (non-droppable) logging.** §5.5 deliberately treats the log as diagnostics: a failed log write on a live call is swallowed. If the log ever needs to be an evidence ledger rather than a debugging aid, the failure policy must change | The log is ever needed as evidence rather than as a debugging aid |
| P05a | ~~**🔶 OPEN — login/signup rate limiter: keep it or drop it?** (§3.8, plan 05)~~ — **Resolved 2026-07-31: keep it**, as built (`lib/auth/rateLimit.ts`, 10 attempts / 15 min / (route, IP)). Decided by the user during the Plan 06 auth review; see `plans/06-auth-review-google-oauth.md` §14.4. Its stated limitations (per-process, resets on restart, spoofable `x-forwarded-for`) are **accepted**, not engineered around — P05n still tracks the distributed version. Plan 06 gives it a third caller (`oauth_start`). | — (resolved) |
| P05b | ~~**🔶 OPEN — whether to disclose the rate limit in the login UI.**~~ — **Resolved 2026-07-31: do not disclose.** The existing `429 { error: 'rate_limited', retryAfterSeconds }` body, which `/login` already renders as "Too many attempts. Try again in N seconds.", is sufficient; no proactive "you get N attempts" messaging is added, because stating the budget up front helps a prober plan around it and helps nobody else. See `plans/06-auth-review-google-oauth.md` §14.5. | — (resolved) |
| P05c | **In-place re-login modal preserving unsaved client state.** Today a `401` hard-navigates to `/login`, discarding a half-typed chat instruction. A modal that re-authenticates in place and resumes the original request needs a request-replay path and a decision about what happens if the replay also fails. `lib/apiFetch.ts` is the single place it will be implemented. | Any beta user loses work to an expired session |
| P05d | **Per-individual LLM quotas** (a per-user override of `maxLlmCallsPerUserPerHour`). The cap is one global number by decision. A per-user override cannot live in `setting` (constraint 8) and would need a column on `user` or a small table, plus UI. | Someone legitimately needs a different ceiling and raising it globally is the wrong answer |
| P05e | **Per-user LLM spend/cost caps rather than call-count caps.** `llm_call_log.usage` already records tokens; a cost-based cap is the same query with a `SUM` instead of a `COUNT`. | The call-count proxy visibly misbehaves — the bill is high while nobody is near the call cap |
| P05f | **Server-side session revocation** (a token version column or session table). A 7-day JWT among ≤10 friends does not justify it. **Still deferred after the Plan 06 auth review** (`plans/06-auth-review-google-oauth.md` §3.2): making the session TTL configurable is explicitly **not** revocation — a JWT's `exp` is baked in at signing time, so shortening the TTL affects only tokens issued afterwards and does nothing to a live session. The only immediate kill switches today remain deleting/altering the `user` row (`getSession()` re-reads it every request) or rotating `JWT_SECRET` (kills every session at once). | A password reset flow exists, a user must be removable immediately, or the beta stops being closed |
| P05g | **Sliding session refresh / "remember me".** A fixed 7-day window is one state to reason about; a refresh path is three. **Unaffected by Plan 06**, which made the TTL configurable (`SESSION_TTL_SECONDS`, default 7 days — see `plans/06-auth-review-google-oauth.md` §3.2): configurability changes the number baked into new tokens; refresh changes *when* tokens are reissued. Different decisions. | Users complain about re-logging-in, or the TTL is shortened for security reasons |
| P05h | **Password reset / forgot-password.** Needs an email transport, which the app does not have. Admin-side reset via `npm run auth:bootstrap --force` is the interim answer. | Any beta user actually forgets a password |
| P05i | **Organizations / teams** (a group of users owning agents jointly). `ownerId` currently means "a user". Making it "a principal" is a real remodel. | More than one household of friends needs shared agents |
| P05j | **User self-service: change email, change password, delete account.** `/account` is the page these grow into; they are deferred on content, not on placement. Changing a password should invalidate other sessions (which P05f says we cannot do yet); deleting an account raises the orphaned-agent question. **Plan 06 adds a third case:** a Google-only account has `passwordHash = ''` (the `NO_PASSWORD_SENTINEL`) and therefore has no password to change — "set a password for a Google-only account" is the same surface with the same blockers (`plans/06-auth-review-google-oauth.md` §13). | Someone actually needs one of these |
| P05k | **Per-user view of the activity log** (users see their own calls). `llm_call_log.userId` makes this a filter argument; `/account` is the natural page. Users who consent to sharing have a fair claim to see what they shared. | A user asks "what did my imports cost?" or asks to see what they consented to share |
| P05l | **Retention / purge policy for `llm_call_log`.** The log is append-only and unbounded. With prompt content in it — some consented, some not — "keep everything forever" should be a choice, not a default. | The table gets large enough to notice, or the consent model raises the question of how long non-consented content is retained |
| P05m | **Constant-time login** (dummy bcrypt compare for unknown emails). The timing difference reveals only whether an email is registered, in a beta where the admin knows every user. | The app opens to self-service signup without invite codes |
| P05n | **Distributed / persistent rate limiting** (§3.8 login limiter only — the §3.9 LLM cap is already DB-backed). The in-process limiter is per-instance and resets on restart. | The deploy runs more than one instance, or brute-force attempts appear in the logs |
| P05o | **Hashing invite codes at rest.** Would prevent the admin from re-reading a code to re-send it. | Codes become long-lived, high-value, or numerous |
| P05p | **Invite-code expiry (`expiresAt`).** `maxUsers` plus single-use already bounds the damage. | Codes are handed out far enough ahead of use that staleness matters |
| P05q | **CSRF tokens.** `sameSite=lax` + JSON-only mutating verbs covers the realistic surface. | Any mutating `GET` appears, or the app is ever embedded / consumed cross-origin |
| P05r | **Agent ownership transfer UI.** One `UPDATE`; a UI for it is premature. Documented as a manual SQL operation in `docs/user-guide.md`. | Users start handing agents to each other regularly |
| P05s | **GDPR-style data export / deletion workflow.** No legal obligation for a private closed beta among friends. | The app has users who are not friends |
| P05t | **Argon2id instead of bcrypt.** bcrypt's 72-byte cap and pure-JS slowness are real but adequate here; argon2 needs a native build (node-gyp). The hash format is prefix-tagged, so a lazy rehash-on-login migration is straightforward when the time comes. | The native-dependency constraint disappears (Docker image, Linux-only host) |
| P06a | **📝 OAuth 2.0 / OpenID Connect sign-in (Google) — Phases 0–4 built, Phase 5 (live verification) and Phase 6 (docs sync) remaining.** `plans/06-auth-review-google-oauth.md`. This row exists so the table does not read as "OAuth was decided against": Plan 05 §0 excluded it, and that exclusion was **deliberately reopened on 2026-07-31** at the user's request. Scope: Google only, `arctic` behind this repo's own provider seam (`lib/auth/oauth/`), `id_token` verified with `jose` against Google's JWKS, a new `oauth_account` table (Rules Index / Entity above), and **the invite-code gate still applying to OAuth signups** — OAuth is a second login mechanism, not a bypass of admission control. Password auth stays, unchanged. A *second* provider (GitHub etc.) stays deferred; the seam makes it a registry entry plus one provider file. **Built:** Phase 0 (commit 1d77019), Phase 1 — OAuth foundations (commit ea2867f), Phase 2 — schema/repository (commit a937297), Phase 3 — start/callback routes (commit 9aee4bf), Phase 4 — UI (commit d1a29cc). **Remaining:** Phase 5 — creating the real Google Cloud OAuth client, setting the three env vars, and the live manual-checklist pass against real Google endpoints (explicitly gated on the user's go-ahead per §10.6 and the standing no-real-external-call rule — not yet started); Phase 6 — the rest of the documentation sync beyond this row (in progress). One reviewed-and-accepted residual risk to know about before anyone touches the callback: a first-time Google sign-in whose `email_verified` email matches an existing account **auto-links to that account unconditionally, for every domain including Google Workspace** (no invite code, no password, no runtime toggle — the toggle was proposed and declined). The Google Workspace domain-takeover vector is knowingly accepted for a ≤ `maxUsers`, invite-gated beta whose email domains the admin personally knows. Full statement, costed alternatives, and revisit trigger: Plan 06 §3.7 "Accepted risk", §16.5, and Rules Index #72. | Phase 5: whenever the user gives the go-ahead for the live Google pass · **auto-link risk: revisit before the beta opens beyond people the admin personally knows, or if a user signs up on a domain the admin doesn't control indefinitely, or on any compromise/near-miss in the `[auth]` log** |
| P06b | ~~**📝 `middleware.ts` duplicates JWT verification instead of reusing `lib/auth/jwt.ts`**~~ — **Resolved 2026-07-31, Phase 0, commit 1d77019.** `middleware.ts` now calls `verifySessionToken()` from `lib/auth/jwt.ts` directly; the local `verifyToken()` (no algorithm restriction, silent-`false` secret check) is deleted. See Rules Index #63/#64. | — (resolved) |
| P06c | **A second OAuth provider (GitHub, Microsoft, Apple).** The seam (`OAuthProvider` interface + registry) exists and the cost is known: one provider file, one registry line, two env vars, one button — no new route, no schema change, no migration. Not built now because a second provider without anyone actually wanting to sign in with it is speculation | Somebody actually wants to sign in with a provider other than Google |
| P06d | **Manual link/unlink of an OAuth provider from `/account`.** Auto-linking (Rules Index #72) already covers the realistic "I already have a password account with this email" case. A manual surface needs a re-authentication step, and unlink needs a "this is your only way in" guard that depends on the still-deferred set-a-password flow (P05j) | Auto-linking is ever restricted, or a user has two linked providers and wants one gone |
| P06e | **An admin toggle for auto-linking** (`oauthAutoLinkVerifiedEmail`). Proposed and declined at Plan 06's review (§16.4) — "don't want to overcomplicate." No `SETTING_DEFS` row, no seed line, no System Settings control exists for this; reverting auto-linking today is a code change, not a flip | Only alongside restricting auto-linking (P06a's revisit trigger) — a switch is the cheaper half of that change if it ever happens |
| P06f | **Storing OAuth provider tokens to call the provider's API later** (e.g. reading a Google profile picture or contacts). Rules Index #69 forbids it and no feature needs it today — adding token columns is the point at which this app becomes a holder of other people's credentials | A feature genuinely needs to act at the provider on the user's behalf, and that decision deserves its own review, not a column |
| P06g | **Restricting sign-in to an email domain** (an `hd`-based allowlist) or **rate-limiting the OAuth callback specifically.** `maxUsers` + invite codes are already the admission control, and the callback's tx-cookie check already gates it before any expensive work runs (§3.8) — a domain allowlist or a second limiter would be a third control layered on working ones | The beta opens beyond invite codes (domain restriction), or callback abuse actually appears in the `[auth]` log (rate limiting) |
| P08a | **Wiring a declared model for Prometheus.** `LlmRequest.model` is a real, already-supported field; Prometheus's frontmatter `model` stays unset for now (Plan 07 §8 point 2) | A specific model is actually chosen for chat, or next time `scripts/build-prompts.ts` is touched (roadmap TODO item — `build-prompts.ts` readable output) |
| P08b | **Adding or deleting sections via chat.** Neither is possible today — an unknown `sectionKey` from a proposal is skipped, no repository primitive exists to add a section outside import (Plan 07 §8 point 3) | A user actually asks Prometheus to add or remove a section and the refusal is a real papercut (roadmap TODO — "Section add/delete via chat — review") |
| P08c | **Building the Prometheus system prompt dynamically per request** (today's static `prometheus.md` compiled once at build time) | If prompt-cache economics or per-request rule variation ever justify it |
| P08d | **Atomic (single-transaction) apply across sections + the agent row.** Today's apply is non-atomic, ordered sections-first — a failure part-way leaves a partial write (500 returned, proposal retained, re-apply safe and idempotent) | A partial apply is ever actually observed in practice, not just theoretically possible |
| P08e | **An audit trail for config changes.** `section_revision` already answers "who changed this section, when" (#81); config has no equivalent history | "Who changed this config key, when" becomes a real question |
| P08f | **Live cross-tab proposal sync beyond the `storage`-event listener** (already free today — applying/discarding in one tab clears the proposal in another open tab on the same agent) | Multi-tab use ever produces real confusion beyond what the free `storage` listener already covers |

**8a is final, not deferred:** the repository layer over Drizzle is locked and needed
starting now (it's how the app talks to the DB from day one, independent of which future
dialect #8b eventually picks).

## Next step

*(Superseded 2026-07-29 — this section originally said "Design is complete — start
building," written before Plan 01 existed. Left as a historical marker; the actual current
next-work plan now lives in `plans/roadmap.md`, which consolidates this table with
`CLAUDE.md`'s session narrative and `Concept.md`'s Build order into one prioritized list —
check there, not here, for what's next.)*