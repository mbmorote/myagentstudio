/**
 * app/api/chat/route.ts
 *
 * POST /api/chat
 *
 * Contract:
 *   Request:  { agentId, instruction, dryRun?, citedSectionKeys?, citedConfigKeys? }
 *   Response: { proposal: { message, modifications, warnings }, meta }
 *
 * Invariants (Rules Index #73/#7/#22/#23):
 *   - POST /api/chat NEVER writes to agent, agent_section, agent_config, or
 *     section_revision. The only row it can produce is the gateway's llm_call_log row.
 *   - Server ALWAYS loads the full agent from DB (never trusts client-supplied content).
 *   - callPrometheus is cancelled via request.signal if the client disconnects
 *     (Rules Index #23).
 *   - The out-of-scope filter runs inside parsePrometheusResponse — sections in
 *     proposal.modifications are already filtered by the time the route gets them.
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
import { getAgentFull } from '@/lib/db/repository';
import {
  callPrometheus,
  PrometheusUpstreamError,
  PrometheusInvalidResponseError,
} from '@/lib/ai/prometheus';
import { LlmDryRunBlockedError, LlmUserCapReachedError } from '@/lib/ai/gateway';
import { authenticate } from '@/lib/auth/guard';

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
    // POST /api/chat performs no writes, so nothing was written. Simply return.
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'cancelled' }, { status: 499 });
    }
    console.error('[chat] Unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // POST /api/chat never writes — return the proposal as-is (Rules Index #73).
  return NextResponse.json(
    {
      proposal: {
        message: proposal.message,
        modifications: proposal.modifications,
        warnings: proposal.warnings,
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
