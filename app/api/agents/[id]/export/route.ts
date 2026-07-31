/**
 * app/api/agents/[id]/export/route.ts
 *
 * Plan 03 Phase A, A.10 — Read-only agent export as markdown text.
 *
 * GET /api/agents/[id]/export  → 200 text/plain — the agent's current exported .md
 *
 * §4 route contract:
 *   GET errors: 401 unauthorized; 404 if the agent doesn't exist or is not owned by caller
 *
 * Business rules (Plan 03 §5 rule 8, R11):
 *   This route is read-only — no AgentSnapshot row is written (Rules Index #16,
 *   still deferred to a later export-UX plan). exportAgentMarkdown() is compute-on-read.
 */

import { NextResponse } from 'next/server';
import { exportAgentMarkdown } from '@/lib/db/repository';
import { authenticate } from '@/lib/auth/guard';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;

  const markdown = exportAgentMarkdown(id, session.userId);
  if (markdown === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
