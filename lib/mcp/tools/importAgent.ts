import 'server-only';

/**
 * lib/mcp/tools/importAgent.ts
 *
 * MCP tool: push_agent (Plan 13 §4.4, write scope — the only write surface).
 * Named "push" (not the internal "import" vocabulary the web UI and repository
 * layer use) for the CLI/git mental model MCP clients live in: you're pushing a
 * local file's content up into MyAgentStudio. Renamed 2026-08-24 — see the
 * addendum note at the top of plans/archive/13-mcp-server-exposing-agents.md. Internal
 * file/function names (this file, upsertAgentFromImport, etc.) are unchanged —
 * only the name and description the MCP client sees changed.
 *
 * Composes the exact same building blocks app/api/agents/import/route.ts uses —
 * parse() → callDaedalus()/callHermes() → assembleStructural()/assemble() →
 * checkCoverage() → upsertAgentFromImport() — rather than forking a second, thinner
 * import path (constraint 4, §4.1). The byte-identical re-push short-circuit, the
 * coverage check, the truncation rejection, and the pre/post-import snapshot writes
 * all happen here for exactly the same reason they happen in the route: they live
 * inside upsertAgentFromImport() and the shared assemble* functions, not in either
 * caller.
 *
 * Three independent gates stand between an external model and a write (§4.7), all
 * checked here, all before any LLM call:
 *   1. Token scope — principal.scope must be 'write'.
 *   2. The mcpWrites admin kill switch (default OFF).
 *   3. The LLM gateway's own dry-run hard stop + per-user hourly cap (unchanged,
 *      reached via origin:'mcp' in the LlmCallContext — no MCP-specific limit, D7).
 *
 * Plan 15 (D8 resolved, §6 step 8c) made shared agents visible over MCP via the
 * three read tools and resources.ts — this file needed NO code change as a
 * result. upsertAgentFromImport(userId, data) always writes into `userId`'s OWN
 * namespace: it looks up an existing agent by (name, ownerId=userId), so a
 * share-holder "pushing" a document whose frontmatter name matches a shared
 * agent's name creates or updates their OWN separate agent under that name —
 * never the shared agent, never the actual owner's row. This is the exact same
 * protection app/api/agents/import/route.ts already has for two DIFFERENT
 * owners colliding on a name (§6.3 fix) — re-verified here for the
 * shared-agent case specifically in lib/mcp/__tests__/tools.test.ts, not just
 * assumed to carry over.
 */

import { z } from 'zod';
import { parse } from '../../serialize/index.js';
import { FrontmatterParseError } from '../../serialize/parseFrontmatter.js';
import {
  callHermes,
  HermesUpstreamError,
  HermesInvalidResponseError,
  HermesTruncatedError,
} from '../../ai/hermes.js';
import { callDaedalus, DaedalusTruncatedError, DaedalusUpstreamError } from '../../ai/daedalus.js';
import { LlmDryRunBlockedError, LlmUserCapReachedError } from '../../ai/gateway.js';
import { assemble } from '../../import/assemble.js';
import { assembleStructural } from '../../import/assembleStructural.js';
import { checkCoverage, type CoverageWarning } from '../../import/coverage.js';
import {
  upsertAgentFromImport,
  getAgentFull,
  getAgentSnapshotInfo,
  getSectionDefs,
  type AgentDTO,
} from '../../db/repository/index.js';
import { getMcpWrites } from '../../settings.js';
import type { McpPrincipal } from '../../auth/mcpGuard.js';

export const TOOL_NAME = 'push_agent';

export const TOOL_DESCRIPTION =
  "Pushes a local markdown agent document up into the authenticated user's " +
  "MyAgentStudio library, creating a new agent or updating an existing one with a " +
  "matching name (owner-scoped — never another user's). This is a full replace, " +
  "not a merge: any section present in the target agent but absent from the " +
  "pushed document is removed. Uses the same AI-assisted restructuring pipeline " +
  "as the web UI's import (mode 'structural', default) or a labels-only mode " +
  "that never sends section content to a model ('strict'). This is the ONLY " +
  "write this server exposes — there is no tool for editing a section or config " +
  "value directly; the natural round trip is pull_agent -> edit the file -> " +
  "push_agent. Requires a write-scoped token, and refuses with a named, typed " +
  "error if the server's MCP-writes switch is off or the account's hourly " +
  "LLM-call cap is reached — in both cases before any model call is made. Pass " +
  "dryRun:true to exercise the request without spending a live call. Pushing " +
  "byte-identical content is free (no LLM call, no write).";

export const TOOL_INPUT_SHAPE = {
  md: z.string().min(1, 'md is required'),
  mode: z.enum(['structural', 'strict']).optional(),
  dryRun: z.boolean().optional(),
};

export type ImportAgentArgs = {
  md: string;
  mode?: 'structural' | 'strict';
  dryRun?: boolean;
};

export type ImportAgentToolResult =
  | { ok: true; agent: AgentDTO; warnings: CoverageWarning[]; skipped?: undefined }
  | { ok: true; agent: AgentDTO; skipped: 'unchanged'; warnings?: undefined }
  | { ok: false; error: 'write_scope_required' }
  | { ok: false; error: 'mcp_writes_disabled' }
  | {
      ok: false;
      error: 'llm_cap_reached';
      limit: number;
      windowSeconds: number;
      retryAfterSeconds: number;
    }
  | { ok: false; error: 'llm_dry_run'; kind: string; model: string; logId: string | null }
  | { ok: false; error: 'structural_truncated' | 'strict_truncated' }
  | { ok: false; error: 'invalid_ai_labels' }
  | { ok: false; error: 'ai_upstream' }
  | { ok: false; error: 'missing_name' }
  | { ok: false; error: 'invalid_body' }
  | { ok: false; error: 'internal' };

export async function handleImportAgent(
  principal: McpPrincipal,
  args: ImportAgentArgs,
): Promise<ImportAgentToolResult> {
  // Gate 1: token scope (§4.7) — checked before anything else, including parsing.
  if (principal.scope !== 'write') {
    return { ok: false, error: 'write_scope_required' };
  }

  // Gate 2: admin kill switch (§4.7), default OFF — checked before any LLM call.
  if (!getMcpWrites()) {
    return { ok: false, error: 'mcp_writes_disabled' };
  }

  const mode: 'structural' | 'strict' = args.mode === 'strict' ? 'strict' : 'structural';
  const forceDryRun = args.dryRun === true;

  // ── Stage 1: deterministic parse (shared by both modes) ──────────────────
  let structured: ReturnType<typeof parse>;
  try {
    structured = parse(args.md);
  } catch (err) {
    if (err instanceof FrontmatterParseError) {
      console.error('[mcp/push_agent] Frontmatter parse error:', err.message);
    } else {
      console.error('[mcp/push_agent] Stage-1 parse failed:', err);
    }
    return { ok: false, error: 'invalid_body' };
  }

  if (structured.blocks.length === 0 && structured.frontmatter.length === 0) {
    return { ok: false, error: 'invalid_body' };
  }

  if (mode === 'structural') {
    return runStructuralPipeline(args.md, structured, principal.userId, forceDryRun);
  }
  return runStrictPipeline(args.md, structured, principal.userId, forceDryRun);
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural pipeline — mirrors app/api/agents/import/route.ts's runStructuralPipeline
// ─────────────────────────────────────────────────────────────────────────────

async function runStructuralPipeline(
  rawMd: string,
  structured: ReturnType<typeof parse>,
  userId: string,
  forceDryRun: boolean,
): Promise<ImportAgentToolResult> {
  const fmName = structured.frontmatter.find((e) => e.key === 'name');
  const rawName = fmName?.rawValue;
  const agentName =
    typeof rawName === 'string'
      ? rawName
      : Array.isArray(rawName) && typeof rawName[0] === 'string'
      ? rawName[0]
      : '';

  const snapshotInfo = agentName ? getAgentSnapshotInfo(agentName, userId) : null;
  if (snapshotInfo && snapshotInfo.rawSourceSnapshot === rawMd) {
    // Byte-identical — skip the AI call entirely (free, and stops a looping client
    // from spending — §5.5).
    const dto = getAgentFull(snapshotInfo.id, userId);
    if (dto) return { ok: true, agent: dto, skipped: 'unchanged' };
  }

  const agentId = snapshotInfo?.id ?? null;
  const sectionDefs = getSectionDefs('claude');

  let restructuredBody: string;
  try {
    restructuredBody = await callDaedalus(rawMd, sectionDefs, {
      kind: 'import-structural',
      agentId,
      agentLabel: agentName || null,
      userId,
      forceDryRun,
      origin: 'mcp',
    });
  } catch (err) {
    if (err instanceof LlmUserCapReachedError) {
      return {
        ok: false,
        error: 'llm_cap_reached',
        limit: err.limit,
        windowSeconds: err.windowSeconds,
        retryAfterSeconds: err.retryAfterSeconds,
      };
    }
    if (err instanceof LlmDryRunBlockedError) {
      console.info('[mcp/push_agent/structural] Dry-run blocked:', err.message);
      return { ok: false, error: 'llm_dry_run', kind: err.kind, model: err.model, logId: err.logId };
    }
    if (err instanceof DaedalusTruncatedError) {
      console.error('[mcp/push_agent/structural] Response truncated (max_tokens):', err.message);
      return { ok: false, error: 'structural_truncated' };
    }
    if (err instanceof DaedalusUpstreamError) {
      console.error('[mcp/push_agent/structural] Upstream failure:', err.message);
      return { ok: false, error: 'ai_upstream' };
    }
    console.error('[mcp/push_agent/structural] Unexpected error:', String(err));
    return { ok: false, error: 'internal' };
  }

  const warnings = checkCoverage(structured.blocks, restructuredBody);

  try {
    const importData = assembleStructural(structured, restructuredBody, rawMd, sectionDefs);
    const dto = upsertAgentFromImport(userId, importData);
    return { ok: true, agent: dto, warnings };
  } catch (err) {
    if (err instanceof Error && err.name === 'MissingNameError') {
      return { ok: false, error: 'missing_name' };
    }
    console.error('[mcp/push_agent/structural] Assemble/persist error:', err);
    return { ok: false, error: 'internal' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Strict pipeline — mirrors app/api/agents/import/route.ts's runStrictPipeline
// ─────────────────────────────────────────────────────────────────────────────

async function runStrictPipeline(
  rawMd: string,
  structured: ReturnType<typeof parse>,
  userId: string,
  forceDryRun: boolean,
): Promise<ImportAgentToolResult> {
  const blockRefs = structured.blocks.map((b) => ({ blockId: b.blockId, heading: b.heading }));

  const fmName = structured.frontmatter.find((e) => e.key === 'name');
  const rawName = fmName?.rawValue;
  const agentName =
    typeof rawName === 'string'
      ? rawName
      : Array.isArray(rawName) && typeof rawName[0] === 'string'
      ? rawName[0]
      : '';
  const agentId = agentName ? (getAgentSnapshotInfo(agentName, userId)?.id ?? null) : null;

  const sectionDefs = getSectionDefs('claude');

  let labels;
  try {
    labels = await callHermes(blockRefs, sectionDefs, {
      kind: 'import-strict',
      agentId,
      agentLabel: agentName || null,
      userId,
      forceDryRun,
      origin: 'mcp',
    });
  } catch (err) {
    if (err instanceof LlmUserCapReachedError) {
      return {
        ok: false,
        error: 'llm_cap_reached',
        limit: err.limit,
        windowSeconds: err.windowSeconds,
        retryAfterSeconds: err.retryAfterSeconds,
      };
    }
    if (err instanceof LlmDryRunBlockedError) {
      console.info('[mcp/push_agent/strict] Dry-run blocked:', err.message);
      return { ok: false, error: 'llm_dry_run', kind: err.kind, model: err.model, logId: err.logId };
    }
    if (err instanceof HermesTruncatedError) {
      console.error('[mcp/push_agent/strict] Stage-2 response truncated:', err.message);
      return { ok: false, error: 'strict_truncated' };
    }
    if (err instanceof HermesInvalidResponseError) {
      console.error('[mcp/push_agent/strict] Stage-2 invalid AI labels:', err.message);
      return { ok: false, error: 'invalid_ai_labels' };
    }
    if (err instanceof HermesUpstreamError) {
      console.error('[mcp/push_agent/strict] Stage-2 upstream failure:', err.message);
      return { ok: false, error: 'ai_upstream' };
    }
    console.error('[mcp/push_agent/strict] Unexpected Stage-2 error:', String(err));
    return { ok: false, error: 'internal' };
  }

  try {
    const importData = assemble(structured, labels, rawMd);
    const dto = upsertAgentFromImport(userId, importData);
    return { ok: true, agent: dto, warnings: [] };
  } catch (err) {
    if (err instanceof Error && err.name === 'MissingNameError') {
      return { ok: false, error: 'missing_name' };
    }
    console.error('[mcp/push_agent/strict] Assemble/persist error:', err);
    return { ok: false, error: 'internal' };
  }
}
