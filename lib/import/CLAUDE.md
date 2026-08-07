# lib/import — Import Pipeline

This folder holds the server-side assembly layer that sits between the AI callers (`lib/ai/`) and the repository (`lib/db/repository/`). It does not touch the database directly.

## Pipeline overview

Every import runs two stages. Stage 1 is shared by both modes; Stage 2 branches.

```
rawMd
  │
  ▼
Stage 1: parse(rawMd)               ← lib/serialize/importParse.ts
  → StructuredAgent
      .frontmatter  [{key, rawValue}]   (YAML, no coercion)
      .splitLevel   (shallowest heading level in the body)
      .blocks       [{blockId, heading, content, order}]
  │
  ├── mode='structural' ──────────────────────────────────────────┐
  │                                                               │
  ▼                                                               ▼
Stage 2 Strict                                       Stage 2b Structural
callHermes(blockRefs)                                callDaedalus(rawMd)
  ← lib/ai/hermes.ts                                   ← lib/ai/daedalus.ts
  → Stage2Labels {mappings, unmapped}                  → restructuredBody (markdown string)
  │                                                               │
  ▼                                                               ▼
assemble(structured, labels, rawMd)          assembleStructural(structured, body, rawMd)
  ← lib/import/assemble.ts                    ← lib/import/assembleStructural.ts
  → ImportedAgentData                          → ImportedAgentData
                                                        (after checkCoverage())
  │                                                               │
  └──────────────────────────┬────────────────────────────────────┘
                             ▼
                   upsertAgentFromImport(data)
                     ← lib/db/repository
                     → AgentDTO
```

The route (`app/api/agents/import/route.ts`) orchestrates this and handles all HTTP error mapping.

---

## Stage 1 — Deterministic parse (`lib/serialize/`)

Three files compose the Stage 1 parse:

**`parseFrontmatter.ts`** — extracts the YAML block between the `---` delimiters using `js-yaml` with `FAILSAFE_SCHEMA`. All scalar values come out as strings (no coercion of `claude-sonnet-4-6` into a float, no `no` into `false`). Flat lists (`string[]`) are preserved. A genuine nested mapping or a list containing non-scalars (e.g. an inline `mcpServers` server-config object, or `hooks`) is preserved verbatim as `Record<string, unknown> | unknown[]` — supported end-to-end for any catalog key declaring `datatype: 'json'` (`lib/blueprint/catalog.ts`), not rejected. Only genuinely unparseable YAML still throws `FrontmatterParseError` (loud 400, never silently discarded).

**`splitBody.ts`** — splits the body at the shallowest heading level actually present. Tracks fenced code blocks (`` ``` `` and `~~~`) so a `#` line inside a code fence is not treated as a heading. Returns `{splitLevel, blocks}` where each block has a stable `blockId` ("block-0", "block-1", …), heading text (or `null` for a headingless preamble), content bytes, and order.

**`importParse.ts`** — composes the two above into `parse(md): StructuredAgent`. This is the only public entry point for Stage 1.

---

## Stage 2 Strict — Labels only (`assemble.ts`)

The AI in Strict mode receives only `blockId` and `heading` text — **never the body content**. It returns a JSON label map:

```json
{
  "mappings": [
    { "blockId": "block-1", "sectionKey": "role" },
    { "blockIds": ["block-2", "block-3"], "sectionKey": "behavior" }
  ],
  "unmapped": ["block-4"]
}
```

`assemble.ts` takes that label map plus the original `StructuredAgent` and builds `ImportedAgentData`:

- Content bytes are **always copied from Stage-1 blocks by blockId**. The AI supplies only labels.
- `blockIds` (merge group) → blocks are sorted by order, the primary block's heading is used, and all bodies are concatenated.
- Unmapped blocks → `sectionKey: 'custom'`.
- The headingless preamble block (`heading: null`, `order: 0`) is always `sectionKey: 'custom'` — the AI never assigns it a key.
- `name` and `description` come from frontmatter only. A missing description gets a placeholder string and a `descriptionMissing` flag on the DTO.
- All other frontmatter entries become `config` entries (propKey, value) verbatim.
- `rawSourceSnapshot: rawMd` stores the original bytes before any processing.

---

## Stage 2b Structural — Full content (`assembleStructural.ts`)

The structural converter receives the **complete raw text** of the agent file and the Blueprint catalog. It returns a full restructured markdown body (no frontmatter). The server then:

1. Runs `splitBody()` on the returned document.
2. Maps each block's `heading` against the platform's section catalog's `defaultHeading` (fetched by the route via `getSectionDefs(platform)`, passed into both `callDaedalus()` and `assembleStructural()` — DB-owned as of 2026-08-07, no longer `lib/blueprint/catalog.ts`'s static `SECTION_DEFS`) — exact string match → canonical `sectionKey`; null or no match → `'custom'`.
3. Runs `checkCoverage()` (see below) to detect content loss.
4. Builds `ImportedAgentData` with frontmatter (name, description, config) taken from the **original** Stage-1 parse, never from the model's output.

**Why frontmatter comes from Stage 1 and not the model's output:** the structural converter's output is a body-only document (no `---` block). Even if the model were to emit frontmatter, the server would ignore it. Config values like `model` and `tools` are exact YAML strings — there is no classification problem for AI to solve there.

**Truncation is a hard fail.** If the Anthropic API returns `stop_reason: 'max_tokens'`, the import is rejected with 422 `structural_truncated`. A truncated document is silent content loss by definition and is never stored.

**Section order is deterministically enforced, not trusted to the model.** `daedalus.md`'s own Guardrail #8 asks for canonical-core → optional-used → last-resort-custom ordering, but real runs against identical input have produced different orderings — the model doesn't reliably follow it. Since ordering is purely mechanical once each block's `sectionKey` is known (no judgment call, unlike the merge-vs-keep-separate decision), `assembleStructural.ts` re-sorts the classified blocks itself: canonical core first (by the passed-in section catalog's `defaultOrder`), then optional sections used, then named custom blocks last (stable — keeps their relative order among themselves). The one exception is a headingless preamble block, which stays first per Daedalus's Behavior #4, even though it shares `sectionKey: 'custom'` with a named-but-unmatched heading. Same "don't leave a deterministic decision to the model" principle already applied to `sectionKey` classification itself (exact heading match) and to heading fabrication (`TechDesign.md` Rules Index #3, re-enforced at write time).

---

## Coverage check (`coverage.ts`)

After a structural conversion, `checkCoverage(sourceBlocks, restructuredBody)` compares each Stage-1 source block against what survived in the output.

Both sides are normalized the same way: lowercase, strip Markdown decoration characters (`# * _ > | -`), collapse whitespace. The source is compared line-by-line against the flattened output string.

Coverage for a block = fraction of its non-empty normalized lines that appear as substrings in the normalized output. A block below 0.8 (80%) coverage produces a `CoverageWarning` on the response. Warnings are informational — the import still succeeds and the agent is persisted.

---

## Re-import semantics

Importing a file whose `name` matches an agent already in the platform is always an **update-in-place**, never a duplicate or an error.

- Sections present in the incoming file are upserted (created or updated, matched by
  `(sectionKey, heading)` identity in document order — not `sectionKey` alone, which would
  collapse distinct `custom` rows onto each other; fixed in Plan 02 Phase A1).
- Sections that existed before but are absent from the incoming file are **deleted**. Their `SectionRevision` rows are not cascade-deleted — the history survives.
- Before the upsert, a `pre-import` `AgentSnapshot` is written capturing the agent's full exported markdown. After the upsert, a `post-import` snapshot is written. First-time imports get only the post-import snapshot.

**Short-circuit for unchanged files:** in Structural mode, if the incoming raw bytes exactly match the `rawSourceSnapshot` of the most recent import, the AI call is skipped entirely and the current `AgentDTO` is returned with `skipped: 'unchanged'`.

---

## Files in this folder

| File | Role |
|---|---|
| `assemble.ts` | Strict mode: Stage-1 blocks + Stage-2 labels → `ImportedAgentData` |
| `assembleStructural.ts` | Structural mode: Stage-1 parse + restructured body → `ImportedAgentData` |
| `coverage.ts` | Post-structural content-loss check; produces `CoverageWarning[]` |
| `__tests__/import.test.ts` | Strict pipeline unit tests (mocked AI) |
| `__tests__/structural.test.ts` | Structural pipeline unit tests (mocked AI) |
| `__tests__/coverage.test.ts` | Coverage check unit tests |
