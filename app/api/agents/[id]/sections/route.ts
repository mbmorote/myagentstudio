/**
 * app/api/agents/[id]/sections/route.ts
 *
 * POST /api/agents/[id]/sections
 *
 * Adds a new section to an agent — manual add via the structured view
 * (roadmap TODO item 1's non-chat half; chat-driven add/delete stays deferred).
 *
 * Request:  { sectionKey: string, heading: string | null, content: string }
 * Response: { agent: AgentDTO, sectionId: string }
 *
 * No validation against the blueprint catalog here — sectionKey/heading are accepted
 * as given (flag-don't-block, Rules Index #76/#1); the client is expected to offer
 * sensible choices (a blueprint section not yet present, or a custom name).
 *
 * Errors: 401 unauthorized; 400 invalid body; 404 agent not found or not owned.
 */

import { NextResponse } from 'next/server';
import { addSection, getAgentFull, SectionNotFoundError } from '@/lib/db/repository';
import { authenticate } from '@/lib/auth/guard';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id: agentId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as Record<string, unknown>).sectionKey !== 'string' ||
    (body as Record<string, unknown>).sectionKey === '' ||
    typeof (body as Record<string, unknown>).content !== 'string'
  ) {
    return NextResponse.json(
      { error: 'invalid_body', fields: ['sectionKey', 'content'] },
      { status: 400 },
    );
  }

  const rawHeading = (body as Record<string, unknown>).heading;
  if (rawHeading !== undefined && rawHeading !== null && typeof rawHeading !== 'string') {
    return NextResponse.json({ error: 'invalid_body', field: 'heading' }, { status: 400 });
  }

  const { sectionKey, content } = body as { sectionKey: string; content: string };
  const heading: string | null = typeof rawHeading === 'string' ? rawHeading : null;

  try {
    const { id: sectionId } = addSection(agentId, session.userId, { sectionKey, heading, content });

    const agent = getAgentFull(agentId, session.userId);
    if (!agent) {
      // Unreachable in practice — we just wrote to this agent — but handle cleanly.
      console.error(`[POST /api/agents/[id]/sections] agent ${agentId}: getAgentFull returned null after write`);
      return NextResponse.json({ error: 'internal' }, { status: 500 });
    }

    return NextResponse.json({ agent, sectionId }, { status: 201 });
  } catch (err) {
    if (err instanceof SectionNotFoundError) {
      // addSection throws this for "agent not found or not owned" too (same
      // not-found-vs-not-owned non-disclosure convention used throughout this repo).
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    console.error('[POST /api/agents/[id]/sections] Unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
