/**
 * app/api/agents/import/route.ts
 *
 * POST /api/agents/import
 *
 * Supports two import modes (Rules Index #27, A1–A4, B2–B3):
 *   - 'structural' (default): AI receives the full raw text + blueprint, returns a
 *     restructured body document; headings are deterministically mapped → sectionKeys.
 *   - 'strict': two-stage labels-only pipeline (Stage 2 classifies blockId→sectionKey,
 *     server reassembles content from Stage-1 bytes — Rules Index #5/#6).
 *
 * Both modes share Stage 1 (deterministic parse) and upsertAgentFromImport.
 *
 * Request:  { md: string, mode?: 'structural' | 'strict', dryRun?: boolean }
 * Response: AgentDTO (+ warnings[] for structural mode)
 *
 * Error codes (§5 error table):
 *   400  bad .md (parse fails, malformed YAML, missing name, or md field missing)
 *   401  unauthorized
 *   422  Stage-2 returned invalid JSON / overlapping groups (strict) or truncated (structural)
 *   429  per-user LLM cap reached (§3.9)
 *   502  Anthropic API failure
 *   500  unexpected server error (never includes the key or prompt text)
 *
 * Business rule §6 rule 7 (AgentSnapshot invariant):
 *   - First-time import  → post-import snapshot only
 *   - Re-import          → pre-import snapshot (current state BEFORE upsert) + post-import snapshot
 *   Both writes happen inside upsertAgentFromImport (repository layer).
 */

import { NextResponse } from 'next/server';
import { parse } from '@/lib/serialize';
import { FrontmatterParseError } from '@/lib/serialize/parseFrontmatter';
import { callImportConverter, ImportConverterUpstreamError, ImportConverterInvalidResponseError } from '@/lib/ai/importConverter';
import { callStructuralConverter, StructuralConverterTruncatedError, StructuralConverterUpstreamError } from '@/lib/ai/structuralConverter';
import { LlmDryRunBlockedError, LlmUserCapReachedError } from '@/lib/ai/gateway';
import { assemble } from '@/lib/import/assemble';
import { assembleStructural } from '@/lib/import/assembleStructural';
import { checkCoverage } from '@/lib/import/coverage';
import { upsertAgentFromImport, getAgentFull, getAgentSnapshotInfo } from '@/lib/db/repository';
import { authenticate } from '@/lib/auth/guard';

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  // ── Parse request body ────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body', field: 'md' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('md' in (body as object)) ||
    typeof (body as { md: unknown }).md !== 'string'
  ) {
    return NextResponse.json({ error: 'invalid_body', field: 'md' }, { status: 400 });
  }

  const rawMd = (body as { md: string; mode?: string; dryRun?: unknown }).md;
  const modeRaw = (body as { md: string; mode?: string }).mode;
  const mode: 'structural' | 'strict' =
    modeRaw === 'strict' ? 'strict' : 'structural';
  // forceDryRun: client may request dry-run mode explicitly (§8.16 — can only downgrade, never upgrade)
  const forceDryRun = (body as { dryRun?: unknown }).dryRun === true;

  // ── Stage 1: deterministic parse (shared by both modes) ──────────────────
  let structured;
  try {
    structured = parse(rawMd);
  } catch (err) {
    if (err instanceof FrontmatterParseError) {
      // A2: malformed YAML frontmatter — loud 400 (never silently discard). Nested
      // values no longer reach this branch (#35/#40, superseded) — only truly
      // unparseable YAML does.
      console.error('[import] Frontmatter parse error:', err.message);
      return NextResponse.json({ error: 'invalid_frontmatter' }, { status: 400 });
    }
    console.error('[import] Stage-1 parse failed:', err);
    return NextResponse.json({ error: 'invalid_body', field: 'md' }, { status: 400 });
  }

  if (structured.blocks.length === 0 && structured.frontmatter.length === 0) {
    return NextResponse.json({ error: 'invalid_body', field: 'md' }, { status: 400 });
  }

  // ── Route by mode ─────────────────────────────────────────────────────────
  if (mode === 'structural') {
    return runStructuralPipeline(rawMd, structured, session.userId, forceDryRun);
  } else {
    return runStrictPipeline(rawMd, structured, session.userId, forceDryRun);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural pipeline (B3)
// ─────────────────────────────────────────────────────────────────────────────

async function runStructuralPipeline(
  rawMd: string,
  structured: ReturnType<typeof parse>,
  userId: string,
  forceDryRun: boolean,
): Promise<NextResponse> {
  // ── Short-circuit: identical raw bytes (Rules Index #36 — B3) ────────────
  // Extract name from Stage-1 frontmatter to look up the existing agent.
  // name is always a scalar string in a well-formed agent file; the frontmatter type
  // now also allows nested object/array values for datatype:'json' keys (#35/#40),
  // so narrow explicitly rather than assuming the found entry is a string.
  const fmName = structured.frontmatter.find((e) => e.key === 'name');
  const rawName = fmName?.rawValue;
  const agentName =
    typeof rawName === 'string'
      ? rawName
      : Array.isArray(rawName) && typeof rawName[0] === 'string'
      ? rawName[0]
      : '';

  if (agentName) {
    const snapshotInfo = getAgentSnapshotInfo(agentName, userId);
    if (snapshotInfo && snapshotInfo.rawSourceSnapshot === rawMd) {
      // Unchanged — skip AI call entirely, return current agent DTO.
      const dto = getAgentFull(snapshotInfo.id, userId);
      return NextResponse.json({ ...dto, skipped: 'unchanged' }, { status: 200 });
    }
  }

  // ── Stage 2b: structural converter ───────────────────────────────────────
  // §5.2: agentId best-effort at call time — the agent may not exist yet.
  const agentId = agentName ? (getAgentSnapshotInfo(agentName, userId)?.id ?? null) : null;

  let restructuredBody: string;
  try {
    restructuredBody = await callStructuralConverter(rawMd, {
      kind: 'import-structural',
      agentId,
      agentLabel: agentName || null,
      userId,
      forceDryRun,
    });
  } catch (err) {
    // Cap reached — checked first (§3.9)
    if (err instanceof LlmUserCapReachedError) {
      return NextResponse.json(
        {
          error: 'llm_cap_reached',
          limit: err.limit,
          windowSeconds: err.windowSeconds,
          retryAfterSeconds: err.retryAfterSeconds,
          canDryRun: true,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(err.retryAfterSeconds) },
        },
      );
    }
    // Dry-run block — checked BEFORE other error types (§7.2, §3.6)
    if (err instanceof LlmDryRunBlockedError) {
      console.info('[import/structural] Dry-run blocked:', err.message);
      return NextResponse.json(
        {
          error: 'llm_dry_run',
          dryRun: true,
          kind: err.kind,
          model: err.model,
          logId: err.logId,
          message: 'Live LLM calls are turned off in Settings. The request was recorded but never sent.',
        },
        { status: 409 },
      );
    }
    if (err instanceof StructuralConverterTruncatedError) {
      console.error('[import/structural] Response truncated (max_tokens):', err.message);
      return NextResponse.json({ error: 'structural_truncated' }, { status: 422 });
    }
    if (err instanceof StructuralConverterUpstreamError) {
      console.error('[import/structural] Upstream failure:', err.message);
      return NextResponse.json({ error: 'ai_upstream' }, { status: 502 });
    }
    console.error('[import/structural] Unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // ── Coverage check (B5) ──────────────────────────────────────────────────
  const warnings = checkCoverage(structured.blocks, restructuredBody);

  // ── Assemble from original frontmatter + restructured body ───────────────
  let dto;
  try {
    const importData = assembleStructural(structured, restructuredBody, rawMd);
    dto = upsertAgentFromImport(userId, importData);
  } catch (err) {
    if (err instanceof Error && err.name === 'MissingNameError') {
      return NextResponse.json({ error: 'missing_name' }, { status: 400 });
    }
    console.error('[import/structural] Assemble/persist error:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json({ ...dto, warnings }, { status: 200 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Strict pipeline (existing, plus A4 hardening already applied in repository)
// ─────────────────────────────────────────────────────────────────────────────

async function runStrictPipeline(
  rawMd: string,
  structured: ReturnType<typeof parse>,
  userId: string,
  forceDryRun: boolean,
): Promise<NextResponse> {
  // ── Stage 2: AI labels-only call ─────────────────────────────────────────
  // Only blockId + heading go to the model — never content (Rules Index #5).
  const blockRefs = structured.blocks.map((b) => ({ blockId: b.blockId, heading: b.heading }));

  // §5.2: agentId best-effort at call time — the agent may not exist yet.
  // name is always a scalar string in a well-formed agent file — see the matching
  // narrowing comment in runStructuralPipeline above.
  const fmNameStrict = structured.frontmatter.find((e) => e.key === 'name');
  const rawNameStrict = fmNameStrict?.rawValue;
  const agentNameStrict =
    typeof rawNameStrict === 'string'
      ? rawNameStrict
      : Array.isArray(rawNameStrict) && typeof rawNameStrict[0] === 'string'
      ? rawNameStrict[0]
      : '';
  const agentIdStrict = agentNameStrict ? (getAgentSnapshotInfo(agentNameStrict, userId)?.id ?? null) : null;

  let labels;
  try {
    labels = await callImportConverter(blockRefs, {
      kind: 'import-strict',
      agentId: agentIdStrict,
      agentLabel: agentNameStrict || null,
      userId,
      forceDryRun,
    });
  } catch (err) {
    // Cap reached — checked first (§3.9)
    if (err instanceof LlmUserCapReachedError) {
      return NextResponse.json(
        {
          error: 'llm_cap_reached',
          limit: err.limit,
          windowSeconds: err.windowSeconds,
          retryAfterSeconds: err.retryAfterSeconds,
          canDryRun: true,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(err.retryAfterSeconds) },
        },
      );
    }
    // Dry-run block — checked BEFORE other error types (§7.2, §3.6)
    if (err instanceof LlmDryRunBlockedError) {
      console.info('[import/strict] Dry-run blocked:', err.message);
      return NextResponse.json(
        {
          error: 'llm_dry_run',
          dryRun: true,
          kind: err.kind,
          model: err.model,
          logId: err.logId,
          message: 'Live LLM calls are turned off in Settings. The request was recorded but never sent.',
        },
        { status: 409 },
      );
    }
    if (err instanceof ImportConverterInvalidResponseError) {
      console.error('[import/strict] Stage-2 invalid AI labels:', err.message);
      return NextResponse.json({ error: 'invalid_ai_labels' }, { status: 422 });
    }
    if (err instanceof ImportConverterUpstreamError) {
      console.error('[import/strict] Stage-2 upstream failure:', err.message);
      return NextResponse.json({ error: 'ai_upstream' }, { status: 502 });
    }
    // Unexpected — log but never leak key or prompt text
    console.error('[import/strict] Unexpected Stage-2 error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // ── Assemble + persist ───────────────────────────────────────────────────
  let dto;
  try {
    const importData = assemble(structured, labels, rawMd);
    dto = upsertAgentFromImport(userId, importData);
  } catch (err) {
    if (err instanceof Error && err.name === 'MissingNameError') {
      return NextResponse.json({ error: 'missing_name' }, { status: 400 });
    }
    console.error('[import/strict] Assemble/persist error:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json(dto, { status: 200 });
}
