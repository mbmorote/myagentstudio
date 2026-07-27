/**
 * app/api/agents/import/route.ts
 *
 * POST /api/agents/import
 *
 * Orchestrates the two-stage import pipeline:
 *   Stage 1: parse(md) — deterministic, no AI (lib/serialize)
 *   Stage 2: callImportConverter(blockRefs) — labels-only AI call, blockId+heading only (lib/ai/importConverter)
 *   Assemble: assemble(structured, labels, rawMd) — bytes from Stage 1 only (lib/import/assemble)
 *   Persist:  upsertAgentFromImport(data) — creates/updates agent + writes revisions + snapshots
 *
 * Request:  { md: string }           — raw .md file text
 * Response: AgentDTO                 — the created or updated agent
 *
 * Error codes (§5 error table):
 *   400  bad .md (parse fails, or md field missing)
 *   422  Stage-2 returned content-bearing / invalid JSON (ImportConverterInvalidResponseError)
 *   502  Anthropic API failure (ImportConverterUpstreamError)
 *   500  unexpected server error (never includes the key or prompt text)
 *
 * Business rule §6 rule 7 (AgentSnapshot invariant):
 *   - First-time import  → post-import snapshot only
 *   - Re-import          → pre-import snapshot (current state BEFORE upsert) + post-import snapshot
 *   Both writes happen inside upsertAgentFromImport (repository layer).
 */

import { NextResponse } from 'next/server';
import { parse } from '@/lib/serialize';
import { callImportConverter, ImportConverterUpstreamError, ImportConverterInvalidResponseError } from '@/lib/ai/importConverter';
import { assemble } from '@/lib/import/assemble';
import { upsertAgentFromImport } from '@/lib/db/repository';

export async function POST(request: Request): Promise<NextResponse> {
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

  const rawMd = (body as { md: string }).md;

  // ── Stage 1: deterministic parse ─────────────────────────────────────────
  let structured;
  try {
    structured = parse(rawMd);
  } catch (err) {
    console.error('[import] Stage-1 parse failed:', err);
    return NextResponse.json({ error: 'invalid_body', field: 'md' }, { status: 400 });
  }

  if (structured.blocks.length === 0 && structured.frontmatter.length === 0) {
    return NextResponse.json({ error: 'invalid_body', field: 'md' }, { status: 400 });
  }

  // ── Stage 2: AI labels-only call ─────────────────────────────────────────
  // Only blockId + heading go to the model — never content (Rules Index #5).
  const blockRefs = structured.blocks.map((b) => ({ blockId: b.blockId, heading: b.heading }));
  let labels;
  try {
    labels = await callImportConverter(blockRefs);
  } catch (err) {
    if (err instanceof ImportConverterInvalidResponseError) {
      console.error('[import] Stage-2 invalid AI labels:', err.message);
      return NextResponse.json({ error: 'invalid_ai_labels' }, { status: 422 });
    }
    if (err instanceof ImportConverterUpstreamError) {
      console.error('[import] Stage-2 upstream failure:', err.message);
      return NextResponse.json({ error: 'ai_upstream' }, { status: 502 });
    }
    // Unexpected — log but never leak key or prompt text
    console.error('[import] Unexpected Stage-2 error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // ── Assemble + persist ───────────────────────────────────────────────────
  let dto;
  try {
    const importData = assemble(structured, labels, rawMd);
    dto = upsertAgentFromImport(importData);
  } catch (err) {
    console.error('[import] Assemble/persist error:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json(dto, { status: 200 });
}
