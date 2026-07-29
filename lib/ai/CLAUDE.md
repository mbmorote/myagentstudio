# lib/ai — AI Callers and System Agents

This folder contains the three AI callers used by the server, the Anthropic client singleton, and the build-time prompt compilation output.

## System agents: the source of truth

MyAgent uses two system agents — the import converter and the chat mediator. Their actual rule-sets (Role, Behavior, Guardrails, Output) live in:

```
design/system-agents/import-instructions.md          ← Strict Import prompt
design/system-agents/import-instructions-structural.md  ← Structural Import prompt
design/system-agents/chat-mediator.md                ← Chat mediator prompt
```

**These files are the one and only place those rules are ever reviewed or edited.** Never edit the generated files under `lib/ai/prompts/generated/` — they are regenerated on every `npm run dev` / `npm run build` and are gitignored.

## Build-time compilation

`scripts/build-prompts.ts` runs as a `predev` / `prebuild` npm hook. It reads each `design/system-agents/*.md` file, strips the human-facing `# Title` line and any leading prose before the first `##` heading, and writes the remaining content as a TypeScript string constant:

```
design/system-agents/import-instructions.md
  → lib/ai/prompts/generated/import-instructions.ts
     exports: IMPORT_CONVERTER_PROMPT

design/system-agents/import-instructions-structural.md
  → lib/ai/prompts/generated/import-instructions-structural.ts
     exports: STRUCTURAL_IMPORT_PROMPT

design/system-agents/chat-mediator.md
  → lib/ai/prompts/generated/chat-mediator.ts
     exports: CHAT_MEDIATOR_PROMPT
```

The running server never reads `design/` at runtime. The prompt text is already compiled into the JS bundle by the time any request arrives.

**To change a prompt:** edit the relevant `design/system-agents/*.md` file and restart the dev server. The `predev` hook recompiles automatically.

## client.ts

A lazy singleton that holds one `Anthropic` instance shared across all callers. Reads `ANTHROPIC_API_KEY` from the environment at first call (throws immediately if unset). Reads `ANTHROPIC_MODEL` for the model ID (defaults to `claude-opus-4-8`). Both functions are imported by every AI caller — never instantiate `Anthropic` directly.

The module is `server-only`, so Next.js will produce a build error if any client component tree imports it.

## importConverter.ts — Strict Import caller

Sends each Stage-1 block's `blockId` and `heading` text (never the body content) to Claude, along with the Agent Blueprint (sections only — config omitted, per Rules Index #28) and `IMPORT_CONVERTER_PROMPT`. Parses and validates the returned JSON label map.

**Hard invariant:** the AI response must never contain a `content` or `text` field at the top level or inside any mapping entry. The validation layer checks this explicitly and throws `ImportConverterInvalidResponseError` if found. The server always copies content bytes from Stage-1 blocks; the AI only ever supplies labels.

Additional validation catches overlapping `blockId` references (a `blockId` appearing in more than one mapping entry) — these would silently drop a block in assembly, so they are rejected at the caller level.

## structuralConverter.ts — Structural Import caller

Sends the agent's **full raw markdown text** plus the Blueprint to Claude and returns the entire restructured agent body as one markdown string. Unlike the Strict caller, the structural converter's job requires reading and reorganizing content, so full content is intentionally provided.

Uses streaming (`client.messages.stream`) because the response can be large (up to 32,000 tokens). The final message is checked for `stop_reason === 'max_tokens'` before the text is extracted — a truncated document is rejected immediately with `StructuralConverterTruncatedError` and never stored.

The agent file may contain fenced code blocks (`` ``` `` or `~~~`), so the user message wraps the raw content in XML-style delimiters (`<agent-source>...</agent-source>`) rather than a code fence — a literal `` ``` `` inside the agent would prematurely close a code fence wrapper, which happens in real agent files.

## chatMediator.ts — Chat mediator caller

Sends the **full current content of every section** (loaded from the database by the route, never from the client), the Agent Blueprint, and `CHAT_MEDIATOR_PROMPT` to Claude. Returns a map of `sectionKey → new content` for only the sections that changed.

**Key design decisions:**

**Agent-wide scope.** The mediator sees all sections and may rewrite any number of them that a single instruction genuinely requires. There is no per-section isolation at the AI call level. The `SectionRevision` table is the per-section audit log; it is not the edit boundary.

**No tools.** The mediator has no tools — it cannot read files, call agents, or reach outside the agent's content.

**Split-level demotion.** The agent's `splitLevel` (the shallowest heading level in the file — usually `1`) is passed to the mediator. Any heading at exactly that level inside a section's content would collide with the file-level section heading on export. The mediator's prompt instructs it not to emit these; `chatMediator.ts` also scans every returned section line-by-line and demotes any such heading by one level (`# Foo` → `## Foo` when `splitLevel=1`). The chat route applies this check a second time as the authoritative gate.

**Cancellation.** The route passes `request.signal` through to the mediator caller, which forwards it to the Anthropic SDK's `RequestOptions.signal`. If the client disconnects, the upstream API call is also cancelled. Because the server writes changes only after the mediator returns (apply-then-history), a cancelled request leaves the agent unchanged — nothing partial is ever written.

**Optimistic concurrency.** The route reads each section's current `version` at the start of the handler. After the mediator responds, each changed section is written with `expectedVersion`. A version conflict on one section does not block the others — it is reported as `{conflict: true, current, content}` in the response while the remaining sections still apply.

## Files in this folder

| File | Role |
|---|---|
| `client.ts` | Anthropic SDK singleton; `getClient()` and `getModel()` |
| `importConverter.ts` | Strict Import Stage-2 caller (labels-only) |
| `structuralConverter.ts` | Structural Import Stage-2b caller (full content, streaming) |
| `chatMediator.ts` | Chat mediator caller (agent-wide, all sections) |
| `prompts/generated/` | Auto-generated by `scripts/build-prompts.ts` — do not edit |
