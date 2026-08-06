/**
 * app/api/chat/route.ts
 *
 * POST /api/chat
 *
 * Phase 2 (transitional) — the agent-aware chat endpoint.
 *
 * Contract:
 *   Request:  { agentId, instruction, dryRun?, citedSectionKeys?, citedConfigKeys? }
 *   Response: { proposal: { message, modifications, warnings }, meta }
 *
 * TRANSITIONAL BEHAVIOR (Phase 2 only — plans/08-prometheus-apply.md Phase 1 removes the write loop):
 *   modifications.sections are still auto-applied to the database (same write loop as
 *   before). modifications.description and modifications.config are parsed, filtered,
 *   and included in the response but NOT written anywhere — they are proposals only.
 *
 * Key invariants (Rules Index #3/#7/#22/#23):
 *   - Server ALWAYS loads the full agent from DB (never trusts client-supplied content).
 *   - callPrometheus is cancelled via request.signal if the client disconnects (Rules
 *     Index #23). Nothing is written before callPrometheus resolves.
 *   - The out-of-scope filter runs inside parsePrometheusResponse (§5.4) — the sections
 *     in proposal.modifications are already filtered by the time the route gets them.
 *   - Split-level demotion double-check is inlined below and runs even when
 *     callPrometheus is mocked in tests (§4.4). prometheus.ts also demotes internally.
 *   - The API key is never in the response body or any log statement.
 *
 * Error codes (plans/08-prometheus-apply.md §8):
 *   400  malformed request body
 *   401  unauthorized
 *   404  agentId not found or not owned by caller
 *   429  per-user LLM cap reached (§3.9)
 *   499  client cancelled (request.signal fired before callPrometheus resolved)
 *   502  Anthropic API upstream failure or unparseable model response
 *   500  unexpected server error (never includes key or prompt text)
 */

import { NextResponse } from 'next/server';
import { getAgentFull, updateSectionContent, VersionConflictError, SectionNotFoundError } from '@/lib/db/repository';
import {
  callPrometheus,
  PrometheusUpstreamError,
  PrometheusInvalidResponseError,
} from '@/lib/ai/prometheus';
import { LlmDryRunBlockedError, LlmUserCapReachedError } from '@/lib/ai/gateway';
import { authenticate } from '@/lib/auth/guard';

// ── Split-level heading demotion (Rules Index #3, defense-in-depth) ──────────
// Inlined in the route so it runs even when callPrometheus is mocked in tests.
// prometheus.ts also demotes at parse time (§4.4); two implementations are
// intentional — the apply route is the authoritative write gate.
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
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

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
  // forceDryRun: client may request dry-run mode explicitly (may only downgrade, Rules Index #61)
  const forceDryRun = (body as { dryRun?: unknown }).dryRun === true;

  // citedSectionKeys: optional, validated defensively — array of strings or ignored (unscoped fallback).
  const rawCited = (body as { citedSectionKeys?: unknown }).citedSectionKeys;
  const citedSectionKeys =
    Array.isArray(rawCited) &&
    rawCited.every((k) => typeof k === 'string') &&
    rawCited.length > 0
      ? (rawCited as string[])
      : undefined;

  // citedConfigKeys: same defensive validation as citedSectionKeys — array of strings or
  // ignored entirely, falling back to unscoped (plans/08-prometheus-apply.md §3.1)
  const rawCitedConfig = (body as { citedConfigKeys?: unknown }).citedConfigKeys;
  const citedConfigKeys =
    Array.isArray(rawCitedConfig) &&
    rawCitedConfig.every((k) => typeof k === 'string') &&
    rawCitedConfig.length > 0
      ? (rawCitedConfig as string[])
      : undefined;

  // ── Load whole agent server-side (Rules Index #7 — never trust client content) ──
  const agent = getAgentFull(agentId, session.userId);
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

  // ── Call Prometheus (signal passthrough for cancellation — Rules Index #23) ──
  let proposal;
  try {
    proposal = await callPrometheus(
      {
        agentName: agent.name,
        agentDescription: agent.description,
        splitLevel: agent.splitLevel,
        sections: agent.sections.map((s) => ({
          sectionKey: s.sectionKey,
          heading: s.heading,
          content: s.content,
        })),
        // Map AgentDTO config entries to the { propKey, value } shape prometheus.ts expects
        config: agent.config.map((c) => ({ propKey: c.propKey, value: c.value })),
        instruction,
        citedSectionKeys,
        citedConfigKeys,
        signal: request.signal,
      },
      // agentId always known for chat (§5.2); userId from the session (§3.9)
      { kind: 'chat', agentId, agentLabel: agent.name, userId: session.userId, forceDryRun },
    );
  } catch (err) {
    // Cap reached — checked FIRST (§3.9)
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
    // Dry-run block — SECOND
    if (err instanceof LlmDryRunBlockedError) {
      console.info('[chat] Dry-run blocked:', err.message);
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
    if (err instanceof PrometheusUpstreamError) {
      console.error('[chat] Prometheus upstream error:', err.message);
      return NextResponse.json({ error: 'ai_upstream' }, { status: 502 });
    }
    if (err instanceof PrometheusInvalidResponseError) {
      // Log reason (not the raw response — it contains agent content, Rules Index #59 reasoning)
      console.error('[chat] Prometheus response parse failure:', err.message);
      return NextResponse.json({ error: 'ai_upstream' }, { status: 502 });
    }
    // AbortError: client cancelled — callPrometheus resolved early with AbortError.
    // Nothing has been written yet (callPrometheus performs no writes), so simply return.
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'cancelled' }, { status: 499 });
    }
    console.error('[chat] Unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // ── TRANSITIONAL: auto-apply sections (Phase 2 only — plans/08-prometheus-apply.md Phase 1 removes this) ──
  // modifications.sections from parsePrometheusResponse are already:
  //   - out-of-scope filtered (§5.4)
  //   - split-level demoted (§4.4)
  // The route's demoteHeadings below is a second pass (idempotent, defense-in-depth).
  const appliedSections: Record<string, string> = {};
  const sectionWarnings: string[] = [];

  for (const [sectionKey, newContent] of Object.entries(
    proposal.modifications.sections ?? {},
  )) {
    const base = baseline.get(sectionKey);
    if (!base) {
      // Prometheus returned a sectionKey that doesn't exist on this agent — skip.
      console.warn(
        `[chat] Prometheus returned unknown sectionKey "${sectionKey}" for agent ${agentId} — skipped`,
      );
      sectionWarnings.push(`Unknown section "${sectionKey}" was dropped.`);
      continue;
    }

    // Route-level demotion double-check (§4.4 — runs even when callPrometheus is mocked).
    const safeContent = demoteHeadings(newContent, agent.splitLevel);

    try {
      updateSectionContent(agentId, base.id, session.userId, safeContent, 'ai', base.version);
      appliedSections[sectionKey] = safeContent;
    } catch (err) {
      if (err instanceof VersionConflictError) {
        // Concurrent edit mid-turn — log and skip. The new response shape has no
        // per-section conflict report; this path is transitional (removed in Plan 08 Phase 1).
        console.warn(
          `[chat] Version conflict for sectionKey "${sectionKey}" — section not applied`,
        );
        sectionWarnings.push(
          `Section "${sectionKey}" had a version conflict and was not applied.`,
        );
      } else if (err instanceof SectionNotFoundError) {
        console.error(
          `[chat] Section not found for sectionKey "${sectionKey}":`,
          String(err),
        );
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      } else {
        console.error(`[chat] Unexpected write failure for section "${sectionKey}":`, String(err));
        return NextResponse.json({ error: 'internal' }, { status: 500 });
      }
    }
  }

  // Build the response modifications: applied sections + proposed (not written) description/config
  const responseModifications = {
    ...(Object.keys(appliedSections).length > 0 ? { sections: appliedSections } : {}),
    ...(proposal.modifications.description !== undefined
      ? { description: proposal.modifications.description }
      : {}),
    ...(proposal.modifications.config !== undefined
      ? { config: proposal.modifications.config }
      : {}),
  };

  const allWarnings = [...proposal.warnings, ...sectionWarnings];

  return NextResponse.json(
    {
      proposal: {
        message: proposal.message,
        modifications: responseModifications,
        warnings: allWarnings,
      },
      meta: {
        agentId,
        proposedAt: new Date().toISOString(),
        scoped: !!(citedSectionKeys?.length || citedConfigKeys?.length),
        citedSectionKeys: citedSectionKeys ?? [],
        citedConfigKeys: citedConfigKeys ?? [],
      },
    },
    { status: 200 },
  );
}
