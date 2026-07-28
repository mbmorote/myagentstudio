/**
 * app/api/chat/route.ts
 *
 * POST /api/chat
 *
 * Implements Draft D (§7) — the agent-aware chat endpoint.
 *
 * Contract (§5):
 *   Request:  { agentId: string, instruction: string }
 *   Response: { sections: { [sectionKey]: {content, version} | {conflict:true, current, content} } }
 *
 * Key invariants (§6, §7, Rules Index #3/#7/#22/#23):
 *   - Server ALWAYS loads the full agent from DB (never trusts client-supplied content).
 *   - apply-then-history: updateSectionContent writes the revision BEFORE this response
 *     returns. If the client disconnects (cancellation), the mediator call is also
 *     cancelled via request.signal, and nothing is written (safe by construction).
 *   - Per-section optimistic concurrency: each section carries its baseline version
 *     (read at the start of this handler). A VersionConflictError on one section does
 *     NOT block the others — it is reported as {conflict:true, current, content} in the
 *     response while the other sections still apply.
 *   - Split-level demotion double-check runs inside chatMediator (Rules Index #3).
 *   - The API key is never in the response body or any log statement.
 *
 * Error codes (§5 error table):
 *   400  malformed request body
 *   404  agentId not found
 *   499  client cancelled (request.signal fired before the mediator resolved)
 *   502  Anthropic API upstream failure
 *   500  unexpected server error (never includes key or prompt text)
 */

import { NextResponse } from 'next/server';
import { getAgentFull, updateSectionContent, VersionConflictError } from '@/lib/db/repository';
import {
  callChatMediator,
  ChatMediatorUpstreamError,
} from '@/lib/ai/chatMediator';

// ── Split-level heading demotion (Rules Index #3, defense-in-depth) ──────────
// Inlined in the route so it runs even in tests where callChatMediator is mocked.
// callChatMediator also does this internally; the route is the authoritative gate.
//
// A heading at `splitLevel` means exactly that many `#` followed by a space:
//   splitLevel=1 → `# ` (never appears inside section content)
//   splitLevel=2 → `## ` etc.
// Demotion: prepend one additional `#` to bring it one level deeper.
function demoteHeadings(content: string, splitLevel: number): string {
  const exactPrefix = '#'.repeat(splitLevel) + ' ';
  const nextLevelPrefix = '#'.repeat(splitLevel + 1);
  return content
    .split('\n')
    .map((line) => {
      if (line.startsWith(exactPrefix) && !line.startsWith(nextLevelPrefix)) {
        return '#' + line;
      }
      return line;
    })
    .join('\n');
}

export async function POST(request: Request): Promise<NextResponse> {
  // ── Parse + validate request body ─────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as Record<string, unknown>).agentId !== 'string' ||
    typeof (body as Record<string, unknown>).instruction !== 'string'
  ) {
    return NextResponse.json(
      { error: 'invalid_body', fields: ['agentId', 'instruction'] },
      { status: 400 },
    );
  }

  const { agentId, instruction } = body as { agentId: string; instruction: string };

  // ── Load whole agent server-side (Rules Index #7 — never trust client content) ──
  const agent = getAgentFull(agentId);
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Record each section's baseline version for per-section optimistic conflict check.
  // Key = sectionKey; if sectionKey is not unique (multiple 'custom' rows), last-in-order
  // wins — acceptable for MVP where all real agents have distinct section keys.
  const baseline = new Map<string, { id: string; version: number }>();
  for (const section of agent.sections) {
    baseline.set(section.sectionKey, { id: section.id, version: section.version });
  }

  // ── Call the mediator (signal passthrough for cancellation — Rules Index #23) ───
  let mediatorResult;
  try {
    mediatorResult = await callChatMediator({
      agentName: agent.name,
      splitLevel: agent.splitLevel,
      sections: agent.sections.map((s) => ({
        sectionKey: s.sectionKey,
        heading: s.heading,
        content: s.content,
      })),
      instruction,
      signal: request.signal,
    });
  } catch (err) {
    if (err instanceof ChatMediatorUpstreamError) {
      console.error('[chat] Mediator upstream error:', err.message);
      return NextResponse.json({ error: 'ai_upstream' }, { status: 502 });
    }
    // AbortError: client cancelled — nothing has been written yet (apply-then-history
    // guarantees no writes before the mediator fully resolves), so we simply return.
    // Status 499 is the de-facto convention for client-closed-request.
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'cancelled' }, { status: 499 });
    }
    console.error('[chat] Unexpected mediator error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // ── Apply each changed section — per-section conflict handling (§7 Draft D) ──
  const resultSections: Record<
    string,
    | { content: string; version: number }
    | { conflict: true; current: number; content: string }
  > = {};

  for (const [sectionKey, newContent] of Object.entries(mediatorResult.sections)) {
    const base = baseline.get(sectionKey);
    if (!base) {
      // Mediator returned a sectionKey that doesn't exist on this agent — skip.
      // (Shouldn't happen with a well-behaved model; logged for visibility.)
      console.warn(`[chat] Mediator returned unknown sectionKey "${sectionKey}" for agent ${agentId} — skipped`);
      continue;
    }

    // Route-level demotion double-check (§4.7, Rules Index #3 — runs even when
    // callChatMediator is mocked in tests; chatMediator also demotes internally).
    const safeContent = demoteHeadings(newContent, agent.splitLevel);

    try {
      const { version } = updateSectionContent(base.id, safeContent, 'ai', base.version);
      resultSections[sectionKey] = { content: safeContent, version };
    } catch (err) {
      if (err instanceof VersionConflictError) {
        // This section's version moved since our baseline read (e.g. a concurrent
        // manual edit landed mid-turn). Report it individually; other sections still
        // applied above. The currentContent is carried by the error (§5, Draft D).
        resultSections[sectionKey] = {
          conflict: true,
          current: err.current,
          content: err.currentContent,
        };
      } else {
        // Unexpected write failure — surface as 500
        console.error(`[chat] Unexpected write failure for section "${sectionKey}":`, String(err));
        return NextResponse.json({ error: 'internal' }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ sections: resultSections }, { status: 200 });
}
