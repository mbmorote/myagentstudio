# lib/serialize — Serialization Contract

This folder is the single place where markdown agent files are parsed into structured data and serialized back out. Nothing in the rest of the codebase reads or writes markdown directly — it all goes through here.

## The round-trip invariant

```
parse(exportAgent(parse(md))) deep-equals parse(md)
```

This is structural fidelity, not byte identity. The exported file may normalize YAML quoting or whitespace, but the parsed result of the export equals the parsed result of the original input — same frontmatter entries, same blocks, same content bytes. The golden-file test suite (`lib/serialize/__tests__/golden.test.ts`) asserts this for all 15 real agent fixtures from the real `~/.claude/agents/` library.

## parse(md) → StructuredAgent

Entry point: `importParse.ts`'s `parse()` function. Composes two lower-level functions:

**`parseFrontmatter(md)`** (`parseFrontmatter.ts`)

Extracts the YAML block between `---` delimiters using `js-yaml` with `FAILSAFE_SCHEMA`. This schema treats all plain scalars as strings — `claude-sonnet-4-6` stays a string (not a float), `no` stays a string (not false), `true` stays a string (not boolean). This is intentional: the workbench stores and re-emits frontmatter values verbatim.

Returns an ordered `{key, rawValue}[]` array. `rawValue` is `string` for scalar values, `string[]` for flat YAML lists, and `Record<string, unknown> | unknown[]` for a genuine nested mapping or a list containing non-scalars (e.g. an inline `mcpServers` server-config object, or `hooks`) — preserved verbatim, not rejected. This supersedes the original A3 hard-reject (Rules Index #35/#40); the deferred `__raw` escape hatch was retired in favor of catalog keys declaring `datatype: 'json'` (`lib/blueprint/catalog.ts`), which controls how such a value renders in the UI (a raw-JSON editor block) — the parser itself no longer distinguishes "supported" from "unsupported" shapes.

A matched-but-unparseable frontmatter block (malformed YAML) throws `FrontmatterParseError` — the only remaining failure mode now that nested values no longer throw. A file with no frontmatter block at all returns `[]` without error.

**`splitBody(body)`** (`splitBody.ts`)

Splits the body text at the **shallowest heading level actually present** in the document.

- Respects fenced code blocks: a `#` line inside a `` ``` `` or `~~~` fence is treated as code, not a heading.
- An unclosed fence causes everything from the fence-open to end-of-body to be treated as one block.
- A headingless preamble (prose before the first heading at the split level) becomes a block with `heading: null` and `order: 0`, provided it contains at least one non-whitespace character.
- `blockId` values are `"block-0"`, `"block-1"`, etc. — deterministic and stable per parse, based on order of appearance.

Returns `{splitLevel, blocks}`.

The composed result is a `StructuredAgent`:

```ts
{
  frontmatter: { key: string; rawValue: string | string[] }[];
  splitLevel: number;
  blocks: { blockId: string; heading: string | null; content: string; order: number }[];
}
```

## exportAgent(structured) → string

Entry point: `export.ts`'s `exportAgent()` function.

Serializes a `StructuredAgent` back to a markdown string:

1. **Frontmatter** — reconstructs a YAML block from `frontmatter` entries using `yaml.dump` with `sortKeys: false` (insertion order preserved) and `lineWidth: -1` (no line wrapping). The dump schema is `DEFAULT_SCHEMA` (not `FAILSAFE_SCHEMA`) so scalars that need quoting for round-trip safety get quoted, but string-typed values that need no quoting are emitted bare.

2. **Body blocks** — sorted by `order`, each emitted as `heading + '\n' + content`. Headingless blocks (`heading: null`) emit bare content with no invented heading.

**Why semantic-not-byte fidelity:** the exporter normalizes YAML formatting (e.g. it may add or remove quotes around values that look like YAML booleans or numbers) but it does not sort keys and does not wrap long lines. The round-trip invariant holds at the `parse()` level, not the raw string level. This is documented and tested as the intended behavior.

**Section body bytes are stored and emitted verbatim** (Rules Index #2). The exporter never reformats, rewraps, or alters body content.

## Golden-file tests

`lib/serialize/__tests__/golden.test.ts` runs against 15 real agent fixtures in `__tests__/fixtures/`. These are snapshots of the actual `~/.claude/agents/` library used to design the schema.

The test suite asserts:

1. The round-trip invariant holds for all 15 fixtures.
2. `orchestrator.md` splits at `##` level (the file's top-level headings are `##`, not `#`).
3. `scribe.md` and `ux.md` each have a headingless preamble block (`heading: null`, `order: 0`).
4. `zara.md`'s `name` field is stored verbatim as `"Zara"` (capital Z — the workbench never normalizes names).
5. Any `model:` value is stored as a string, not a float or boolean.

These six assertions directly cover Rules Index #1–#6 and constitute Gate 1 for the build sequence.

## Files in this folder

| File | Role |
|---|---|
| `importParse.ts` | `parse(md)` — the Stage-1 entry point |
| `parseFrontmatter.ts` | YAML frontmatter extraction with FAILSAFE_SCHEMA |
| `splitBody.ts` | Fence-aware body splitter; produces `BodyBlock[]` |
| `export.ts` | `exportAgent(structured)` — deterministic markdown writer |
| `types.ts` | Shared types: `StructuredAgent`, `FrontmatterEntry`, `BodyBlock` |
| `index.ts` | Barrel re-exporting `parse` and `exportAgent` |
| `__tests__/golden.test.ts` | Round-trip test suite (15 real agent fixtures) |
| `__tests__/fixtures/*.md` | The real agent files used as golden inputs |
