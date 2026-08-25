# lib/mcp — MCP Server Exposing MyAgentStudio's Agents (Plan 13)

The tool/resource layer behind `POST /api/mcp` — a second front door onto a user's own
agents for console/CLI MCP clients (Claude Code and equivalents). See
`docs/system-about.md` §13 for the full design summary and `plans/archive/13-mcp-server-exposing-agents.md`
for the complete decision record. This file is the map of the folder itself.

**Naming note (2026-08-24):** the MCP-facing tool names are `pull_agent` and `push_agent`,
not `export_agent`/`import_agent` — renamed for the CLI/git mental model MCP clients live
in (you're pushing a local file up, pulling the current version down). Internal file names
(`tools/exportAgent.ts`, `tools/importAgent.ts`) and function names (`handleExportAgent`,
`handleImportAgent`) are unchanged on purpose — only what the external model sees changed.
The web UI's own "Import"/"Export" vocabulary is separate and also unchanged.

## Spec/SDK pin (revisit at build time if this drifts)

- **SDK:** `@modelcontextprotocol/sdk` `^1.30.0`.
- **Transport used:** `WebStandardStreamableHTTPServerTransport` (Fetch-API `Request`/`Response`
  in, `Request`/`Response` out — the only transport variant of the three the SDK ships that
  works inside a Next.js Route Handler without an adapter), in **stateless** mode
  (`sessionIdGenerator: undefined`) with `enableJsonResponse: true` (a single complete JSON
  response per POST — no long-lived SSE stream through a serverless/proxy host).
- If the MCP spec or SDK major version changes, re-verify: stateless-mode session handling
  still skips `Mcp-Session-Id` validation entirely (`WebStandardStreamableHTTPServerTransport
  .validateSession()` returns immediately when `sessionIdGenerator` is `undefined`); a bare
  `tools/list`/`tools/call` still works without a client having sent `initialize` first on the
  same transport instance (true today because each HTTP request gets a brand-new server +
  transport pair — there is no cross-request session to have "initialized").
- **Every POST must carry `Accept: application/json, text/event-stream`.** The transport
  rejects any request missing it with `406 Not Acceptable` — found the hard way while writing
  `app/api/__tests__/mcp.test.ts`, whose hand-built `Request` objects didn't set it. A real
  console client sets this automatically as part of speaking the protocol; only a raw
  `curl`/hand-crafted request (including a test) needs to set it explicitly.

## Architecture

```
app/api/mcp/route.ts                    ← authenticateMcpToken() → Origin check → hand off
      │                                     (session cookie NEVER read here)
      ▼
lib/mcp/server.ts                        ← the ONLY @modelcontextprotocol/sdk importer.
   buildServer(principal)                   Builds a fresh McpServer + transport per
      │                                     request, registers all 4 tools + the resource,
      │                                     closes both once the response is built.
      ├─ lib/mcp/tools/listAgents.ts     ← read. listAgents(ownerId)
      ├─ lib/mcp/tools/getAgent.ts       ← read. getAgentFull(id, ownerId)
      ├─ lib/mcp/tools/exportAgent.ts    ← read. pull_agent. exportAgentMarkdown(id, ownerId)
      ├─ lib/mcp/tools/importAgent.ts    ← WRITE. push_agent. composes the same pipeline
      │                                     app/api/agents/import/route.ts uses
      └─ lib/mcp/resources.ts            ← myagentstudio://agent/{id}, same 2 repo calls as above
```

Each `tools/*.ts` file exports a `TOOL_NAME`, a `TOOL_DESCRIPTION`, an optional
`TOOL_INPUT_SHAPE` (a Zod raw shape), and a handler `(principal, args) => result` that is
**pure of the SDK and of transport** — directly unit-testable with no protocol round trip
(`lib/mcp/__tests__/tools.test.ts`, `importAgent.test.ts`). `server.ts` is the only file that
touches the SDK's `registerTool`/`registerResource`/`CallToolResult` shapes; it wraps each
handler's plain result into the SDK's expected response, and is where the "user-authored
content, not instructions" wrapping (`get_agent`/`pull_agent`/`push_agent` results) lives.

## Guardrails this folder is built around — all test-enforced, not just documented

`lib/mcp/__tests__/architecture.test.ts` asserts, on every test run:

1. **One SDK importer.** `@modelcontextprotocol/sdk` appears in exactly `lib/mcp/server.ts`.
2. **Write-surface containment.** No file under `lib/mcp/` references `updateAgent(`,
   `updateSectionContent(`, `addSection(`, `deleteSection(`, `createAgent(`, or
   `deleteAgent(` — the only mutation any tool can cause is `upsertAgentFromImport(`. This is
   the assertion that stops a future session from quietly re-adding the structured-write
   surface Plan 13 deliberately dropped (D3) — landed while this folder genuinely had zero
   writers, not after the fact as a carve-out.
3. **Gateway is the only route to a model.** No file under `lib/mcp/` imports
   `@anthropic-ai/sdk`, `anthropicProvider.ts`, or `openaiCompatibleProvider.ts` directly —
   `push_agent` reaches a model only via `callDaedalus`/`callHermes` → `lib/ai/gateway.ts`,
   exactly like the web import route.
4. **Session/token isolation.** No file under `lib/mcp/` imports `next/headers` or reads the
   session cookie. The MCP principal (`{ userId, tokenId, scope }`, deliberately **no role**)
   comes from `lib/auth/mcpGuard.ts`'s bearer-token guard only.

`app/api/__tests__/route-guard.test.ts` separately enforces that `app/api/mcp/route.ts`
contains `authenticateMcpToken(` and does **not** contain `authenticate(` — the MCP endpoint
must never accept a browser session cookie by copy-paste from a neighboring route.

## The one write tool — `push_agent`

Three independent gates, all checked before any model call, in `lib/mcp/tools/importAgent.ts`:

1. `principal.scope !== 'write'` → refused (a `read` token cannot call it).
2. `getMcpWrites()` (`lib/settings.ts`, default **off**) → refused if off.
3. The gateway's own dry-run hard stop, then the *existing* per-user hourly LLM cap
   (`origin: 'mcp'` in `LlmCallContext` — no MCP-specific cap setting, D7).

It **composes** the same building blocks `app/api/agents/import/route.ts` uses — `parse()` →
`callDaedalus()`/`callHermes()` → `assembleStructural()`/`assemble()` → `checkCoverage()` →
`upsertAgentFromImport()` — rather than forking a thinner second import path. That is what
makes the byte-identical short-circuit, the coverage-warning surfacing, the truncation
rejection, and the pre/post-import snapshot trail all apply on the MCP path for free, and why
`lib/mcp/__tests__/importAgent.test.ts` asserts each of those behaviors on this path
specifically rather than trusting they carried over.

## Files in this folder

| File | Role |
|---|---|
| `server.ts` | The ONLY `@modelcontextprotocol/sdk` importer. Builds/closes a stateless server+transport pair per request; wraps each tool handler's plain result into a `CallToolResult`. |
| `resources.ts` | `myagentstudio://agent/{id}` list/read — same two repository calls `list_agents`/`pull_agent` use. |
| `tools/listAgents.ts` | Read. `list_agents` — `listAgents(ownerId)`. |
| `tools/getAgent.ts` | Read. `get_agent` — `getAgentFull(id, ownerId)`, the same `AgentDTO` the web UI gets. |
| `tools/exportAgent.ts` | Read. `pull_agent` (file/function names unchanged) — `exportAgentMarkdown(id, ownerId)`, deterministic. |
| `tools/importAgent.ts` | **Write.** `push_agent` (file/function names unchanged) — the only write tool; see above. |
| `__tests__/architecture.test.ts` | The four fitness assertions listed above. |
| `__tests__/tools.test.ts` | Tenancy, scope-independence, and flag-don't-block cases for the three read tools. |
| `__tests__/resources.test.ts` | Resource list/read tenancy + byte-identical parity with `pull_agent`. |
| `__tests__/importAgent.test.ts` | Gates, create-vs-update, snapshot trail, short-circuit, cross-owner safety, dry-run, truncation, coverage warnings — all on the MCP path specifically. |

## What deliberately isn't here

No `applyChanges.ts`, no structured field-level write tool, no `get_blueprint`, no
`create_agent` (covered by `push_agent`'s create-on-new-name semantic), no admin tools
(settings/invite-codes/other users' logs — an admin's MCP token is an ordinary user's
token), no OAuth 2.1 authorization server (out of scope per D6 — console/CLI clients only,
never Claude Desktop's GUI connector), no MCP-specific LLM spend cap (D7 — the existing
per-user hourly cap is shared). See `plans/archive/13-mcp-server-exposing-agents.md` §9 for the full
list and reasoning.
