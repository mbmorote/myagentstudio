# Import Hardening + Structural-First Import — Execution Plan

> **Origin:** Fable 5 audit (2026-07-28, prompt in `Fable-Review-1.md`) + follow-up strategy
> discussion with the user. The audit findings have been converted into this ordered,
> dev-ready plan. **This file is the spec for `@dev` — execute phases in order.**
> Companion deliverables already written (same audit pass):
> - `system-agents/import-instructions-structural-merged.md` — final Structural rule-set
> - `system-agents/import-instructions-merged.md` — final Strict rule-set
>
> Do not commit anything unless the user explicitly says to.

---

## Decisions already made — do NOT re-litigate

These were settled with the user on 2026-07-28. Implement them as stated.

1. **Structural Import becomes the PRIMARY import mode.** Strict Import stays in the
   codebase as a secondary "verbatim, no AI restructuring" option — kept, lightly
   hardened (Phase A4), but no further investment in its merge machinery.
2. **Structural I/O contract:** the model receives (a) the blueprint catalog
   (`renderBlueprintForPrompt({ includeConfig: false })`) and (b) the agent's **full raw
   text as-is**. The model returns the **body only** as one markdown document — no YAML
   frontmatter in the output. Frontmatter is handled 100% deterministically by the
   server in both modes (consistent with Rules Index #28/#29).
3. **The returned document is persisted by re-running Stage-1 `parse()` on it** and
   mapping headings → sectionKeys deterministically via `SECTION_DEFS.defaultHeading`
   (exact match → that key; no match → `custom`). No second AI call, no new parser.
4. **Safety model = prompt-enforced restructure + code-enforced coverage check** (Phase
   B5). Loss becomes *detectable* (warnings), never a hard block. Recovery already
   exists via `rawSourceSnapshot` + `AgentSnapshot` + `SectionRevision`.
5. **Re-import short-circuit:** if the incoming raw bytes equal the stored
   `rawSourceSnapshot`, skip the AI call entirely and return the current agent.
6. **Model:** keep `claude-opus-4-8` default via existing `ANTHROPIC_MODEL` env. Cost is
   a non-issue (~$0.19/import at ~8k in / ~6k out). Latency is the real UX factor
   (minutes, not seconds) — stream the response.
7. **Rule-set files remain the only place rules live** (Rules Index #25). Refining
   import behavior later = edit the `.md`, restart dev server. No code change.

---

## Phase A — Shared correctness fixes (do FIRST — both import modes sit on these)

### A1. Fix re-import section reconciliation (audit finding 1 — most severe)

**Bug:** `upsertAgentFromImport` (`lib/db/repository/agents.ts:397`) reconciles by
`dbSectionsByKey = new Map(dbSections.map(s => [s.sectionKey, s]))`. `sectionKey` is not
unique per agent — the pipeline routinely produces multiple `custom` rows (headingless
preamble + every unmapped/last-resort block). On re-import, all incoming `custom`
sections collapse onto one db row (updated repeatedly, last write wins, phantom
`reimport` revisions on the wrong section) while the other `custom` rows survive stale
and are never deleted (`importKeys.has('custom')` is true). Re-importing an *unchanged*
file corrupts the agent.

**Fix — reconcile by identity, not key:**
- Build a multimap of db sections keyed by `(sectionKey, heading)` (heading `null`
  allowed as a key part).
- Walk incoming sections in document order; for each, pop the first unmatched db section
  with the same `(sectionKey, heading)`. Match → update `content`/`heading`/`order`,
  bump `version`, append one `reimport` revision. No match → create fresh (revision #0,
  `author: 'reimport'`).
- Db sections never matched by any incoming section → delete (revisions retained, rule 4
  unchanged).

**Tests (extend `lib/import/__tests__/import.test.ts`):**
- Agent with ≥2 `custom` sections (preamble + one unmapped block) re-imported with the
  identical file → sections unchanged, exactly one `reimport` revision per section, no
  stale rows, no cross-contaminated content.
- Same agent re-imported with one `custom` block's content changed → only that section's
  content changes; the other `custom` section untouched.

### A2. Malformed YAML frontmatter must fail loudly (audit finding 3)

**Bug:** `parseFrontmatter` (`lib/serialize/parseFrontmatter.ts:38-41`) returns `[]`
when `yaml.load` throws, but `bodyStartOf` still skips the frontmatter region — the
entire frontmatter silently vanishes. The agent imports with `name: ''`; a *second*
malformed file then upserts onto the same `''`-named row, silently overwriting the
first. Worst silent-loss bug in the codebase.

**Fix:**
- `parseFrontmatter` throws a typed error (e.g. `FrontmatterParseError`) when the
  regex matches but `yaml.load` throws. (No frontmatter block at all — regex no match —
  stays a valid `[]` case.)
- `POST /api/agents/import` catches it → `400 { error: 'invalid_frontmatter' }`.
- Independently, `upsertAgentFromImport` rejects `name` that is empty/whitespace-only
  (throw; route maps to 400 `{ error: 'missing_name' }`). Flag-don't-block (Rules #1)
  applies to *format*, not to *absence* — an empty name breaks the upsert identity.

**Tests:** duplicate-key YAML and tab-indented YAML fixtures → 400, nothing written;
file with no `name` key → 400 `missing_name`.

### A3. Stop destroying non-scalar frontmatter values (audit finding 4)

**Bug:** `parseFrontmatter.ts:49` does `String(value)`: a YAML block list becomes a
comma-joined string (structure lost; comma-containing items later mis-split by
`computeValidation`), and a nested mapping becomes the literal `"[object Object]"`.
The golden invariant can't see it — the destruction happens inside the first `parse()`,
so both sides of `parse(export(parse(md)))` are equally wrong.

**Fix:**
- `FrontmatterEntry.rawValue` becomes `string | string[]`.
- Array of scalars → `string[]` (each item `String()`d — scalars are already strings
  under FAILSAFE_SCHEMA).
- Anything else (nested map, array containing non-scalars) → throw
  `FrontmatterParseError('unsupported_frontmatter', key)` → route 400 naming the key.
  This is a stated, loud limitation until the deferred `__raw` escape hatch exists —
  loud beats destroyed.
- Ripple updates: `exportAgent` (yaml.dump handles arrays natively — verify round-trip),
  `serializeAgentSnapshot` in `repository/agents.ts` (pass arrays through, don't
  `JSON.stringify`), `computeValidation` (array path already exists), `assemble`
  (config value can now be `string[]`).
- Add one golden fixture using block-list `tools:` and assert list-ness survives
  `parse → export → parse`.
- Update `TechDesign.md` Draft B with one sentence: the invariant proves
  parse∘export **idempotence**, not md→structure losslessness — parser-internal loss is
  invisible to it (that is what A3's targeted fixture is for).

### A4. Small hardening (cheap, do in the same pass)

- **Transaction scope:** wrap the entire `upsertAgentFromImport` update path (pre-import
  snapshot, agent update, config replace, section reconcile) in one `db.transaction` —
  today only the section reconcile is inside (`agents.ts:362-398`).
- **Strict-mode validator:** in `parseAndValidateLabels` (`lib/ai/importConverter.ts`),
  reject any response where a blockId appears in more than one mapping entry (audit
  finding 2 — overlapping merge groups silently drop a block in `assemble`). Also add a
  belt-and-braces pass at the end of `assemble`: any input block that was never emitted
  into a section → `custom`.
- **`max_tokens`:** bump the strict Stage-2 call from 1024 to 4096.
- Test: overlapping-mappings response → `ImportConverterInvalidResponseError` (422).

---

## Phase B — Structural Import (the new primary mode)

### B1. Adopt the merged rule-sets

- Replace the content of `design/system-agents/import-instructions-structural.md` with
  the content of `import-instructions-structural-merged.md`, then delete the `-merged`
  file. (The leading title/blockquote is stripped at compile time — keep the file's
  compiled portion strictly model-facing, per the locked prompt-file policy.)
- Same for `import-instructions.md` ← `import-instructions-merged.md`.
- Delete the two `-copilot` draft files (superseded; git history keeps them if needed).
- Add to `scripts/build-prompts.ts` `AGENTS`:
  `{ file: 'import-instructions-structural', constName: 'STRUCTURAL_IMPORT_PROMPT' }`.

### B2. `lib/ai/structuralConverter.ts` — the Stage-2b caller

- `callStructuralConverter(rawMd: string): Promise<string>`:
  - System prompt: `STRUCTURAL_IMPORT_PROMPT` (compiled).
  - User message: the blueprint block (`renderBlueprintForPrompt({ includeConfig:
    false })`) + the agent's full raw text, clearly delimited as the two attachments the
    rule-set's INPUT section describes.
  - **Streaming** (`client.messages.stream(...)` + `finalMessage()`), `max_tokens:
    32000`, model from `getModel()`.
  - If `stop_reason === 'max_tokens'` → throw `StructuralConverterTruncatedError`
    (a truncated document is silent content loss by definition — never store it).
    Route maps to 422 `{ error: 'structural_truncated' }`.
  - Reuse the existing Upstream/InvalidResponse error pattern from `importConverter.ts`.

### B3. Structural pipeline in the route

`POST /api/agents/import` gains a mode field: `{ md: string, mode?: 'structural' |
'strict' }`, **default `'structural'`**. Flow for structural:

1. Stage 1: `parse(rawMd)` (shared; A2/A3 failures 400 here).
2. **Short-circuit:** if an agent with this `name` exists and `rawSourceSnapshot ===
   rawMd` byte-for-byte → skip the AI call, return the current `AgentDTO` with
   `{ skipped: 'unchanged' }`.
3. `callStructuralConverter(rawMd)` → returned body document.
4. `splitBody(returnedDoc)` (Stage 1 again, on the output). Map each block:
   heading exactly equals a `SECTION_DEFS.defaultHeading` → that def's key; heading
   `null` or no match → `custom`. Deterministic, no AI.
5. **Coverage check** (B5) against the original Stage-1 blocks → `warnings[]`.
6. Build `ImportedAgentData`: `name`/`description`/`config` from the **original**
   Stage-1 frontmatter (never from the model), `splitLevel` = the *output* document's
   split level (will be 1 — canonical headings are `#`), sections from step 4,
   `rawSourceSnapshot: rawMd`.
7. `upsertAgentFromImport` (fixed in A1) → response `{ ...AgentDTO, warnings }`.

Strict mode keeps the existing pipeline unchanged (plus A4 hardening).

### B4. Do NOT build yet

No UI mode picker (Phase 4 concern), no propose-preview, no per-block span
verification — only the coverage warnings.

### B5. Coverage check — `lib/import/coverage.ts`

Pure function: `checkCoverage(sourceBlocks: BodyBlock[], outputDoc: string):
CoverageWarning[]`.

- Normalize both sides: lowercase, collapse all whitespace runs to single spaces, strip
  markdown decoration chars (`#*_>|`-`) — keep it simple.
- For each source block: split its normalized content into non-empty lines; coverage =
  fraction of those lines that appear as substrings of the normalized output.
- Coverage < 0.8 → warning `{ blockId, heading, coverage }` ("content from this block
  appears missing or heavily altered").
- Unit tests: verbatim move across sections → no warning; a dropped block → warning; a
  paraphrased block → warning; content moved inside a merged section → no warning.
- This is a *warning*, never a block — the response still succeeds and the user can
  inspect `rawSourceSnapshot` / snapshots.

### B6. Tests + the rules-refinement harness

- **Mocked pipeline test** (`lib/import/__tests__/structural.test.ts`): mock
  `callStructuralConverter` with a hand-written canonical restructure of `dev.md` →
  assert sections land under canonical keys, config comes from original frontmatter,
  snapshots/revisions behave per §6 rule 7, coverage warnings empty.
- Short-circuit test: re-import identical bytes → no converter call (assert mock not
  called), no new snapshots/revisions.
- Truncation test: mock returns with `stop_reason max_tokens` → 422, nothing written.
- **Live harness for rule refinement** (`scripts/test-structural-import.ts`, run
  manually, real API): loops the 15 golden fixtures through the structural pipeline,
  prints per-fixture coverage results + the restructured output to a scratch folder for
  eyeballing. This is the user's "test a lot with my agents until the rules are good"
  loop — rules iterate in `import-instructions-structural.md`, restart, re-run.

---

## Phase C — Documentation sync (after A+B pass)

Update `TechDesign.md`:
- **#27:** Structural Import is implemented and is the **default** import mode; Strict
  is the secondary verbatim option. Update the Draft A "Two import modes" paragraph
  accordingly (flip the "default" language).
- **#31:** amend — prompt-enforced restructure now paired with a deterministic
  **coverage check** (code-enforced loss detection, warning-level). Note the
  `max_tokens`-truncation hard-fail.
- **New Rules Index entries** (continue numbering): A1 identity-based reconciliation;
  A2 loud frontmatter failure + empty-name rejection; A3 `rawValue: string | string[]`
  + unsupported-nested-map 400 (stated limitation until `__raw`); B3 re-import
  short-circuit on identical raw bytes; B5 coverage check.
- Fix the two stale references found in the audit: #27/#32 cite `design/AI behavior.txt`
  (file does not exist — repoint to `import-instructions-structural.md`), and the
  project-layout sketch still shows `api/import/route.ts` (actual:
  `api/agents/import`).
- Update `CLAUDE.md`'s "Where things stand" to reflect structural-first.

---

## Phase D — Known, deliberately deferred (do NOT do now; tracked so they aren't lost)

| Item | From audit | Revisit when |
|---|---|---|
| Catalog seed is insert-only: in-code `CONFIG_DEFS` and DB `configDef` rows diverge after a catalog edit (validation uses code, DTO `def` uses DB) | Finding 6 | Before Phase 4 renders its first dropdown — either make seed upsert, or have `buildAgentDTO` read defs from `catalog.ts` |
| Strict-mode merges embed split-level headings in merged content (unstable across export→re-import; mediator demote-guardrail would silently alter them) | Finding 7 | Only if Strict Import gets real continued use — option: sibling rows sharing a sectionKey (A1's identity fix already supports that shape) |
| UI mode picker + import warnings surface | — | Phase 4 (core loop UI) |
| Adversarial-file re-audit (foreign/shared agents as untrusted input) | Finding 5 residual | When sharing/forking (build-order #5) arrives — coverage check is the MVP answer for own-files use |
| `__raw` frontmatter escape hatch for nested maps | A3 limitation | If real files with nested frontmatter (e.g. `mcpServers` maps) actually appear |

---

## Acceptance checklist (whole plan)

- [ ] Re-importing an unchanged multi-`custom` agent is a no-op on section content
      (and, via the B3 short-circuit, makes no AI call at all).
- [ ] Malformed-YAML and empty-name files 400 loudly; nothing is written.
- [ ] Block-list `tools:` survives import → export → re-import as a list.
- [ ] Structural import of `dev.md` (mocked) lands canonical sections, zero warnings.
- [ ] A dropped/paraphrased block in a mocked structural response produces a coverage
      warning but still imports.
- [ ] Truncated structural response (`max_tokens`) is rejected, nothing written.
- [ ] All existing tests still green (57+ at last count); golden 15-fixture suite green.
- [ ] `npm run dev` compiles three prompts (strict, structural, mediator) from
      `design/system-agents/*.md`; server never reads `design/` at runtime.
- [ ] `TechDesign.md` Rules Index + Draft A reflect structural-first; stale references
      fixed.

## Audit findings → plan map (for traceability)

| Audit finding (severity order) | Resolved by |
|---|---|
| 1. Reconciliation-by-sectionKey corrupts re-imports | A1 |
| 2. Overlapping merge groups silently drop a block | A4 (validator + assemble fallback) |
| 3. Malformed YAML silently discarded; `''`-name collision | A2 |
| 4. Non-scalar frontmatter destroyed by `String(value)` | A3 |
| 5. Structural safety prompt-only → add deterministic loss detection | B5 (+ Phase D re-audit note) |
| 6. Insert-only seed vs in-code catalog drift | Phase D (pre-Phase-4 trigger) |
| 7. Merged sections embed split-level headings | Phase D (strict demoted; A1 enables sibling-row option) |
| 8. Minor: partial transaction, stale doc refs, `max_tokens` | A4 + Phase C |
