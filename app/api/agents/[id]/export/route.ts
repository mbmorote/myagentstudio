/**
 * app/api/agents/[id]/export/route.ts
 *
 * Plan 03 Phase A, A.10 — Read-only agent export as markdown text.
 *
 * GET /api/agents/[id]/export  → 200 text/plain — the agent's current exported .md
 *
 * §4 route contract:
 *   GET errors: 401 unauthorized; 404 if the agent doesn't exist, or the caller
 *   is neither its owner nor a share-holder
 *
 * Business rules:
 *   This route is read-only — no AgentSnapshot row is written. The `kind: 'export'`
 *   snapshot capture point (and a diff view over it) is a real, still-deferred feature —
 *   see `plans/roadmap.md` — not built here. exportAgentMarkdownForViewer() is compute-on-read.
 *
 *   Plan 15 (D2 resolved, 2026-08-29): a share-holder may also export — "Copy to me"
 *   already gives them the full content in a form they fully control, so withholding a
 *   download would be an arbitrary hole rather than a protection. Switched from the
 *   owner-scoped exportAgentMarkdown() to its viewer-scoped sibling; exportAgentMarkdown()
 *   itself is untouched (constraint 1/2 of plans/archive/15-share-agent.md).
 */

import { NextResponse } from 'next/server';
import { exportAgentMarkdownForViewer } from '@/lib/db/repository';
import { authenticate } from '@/lib/auth/guard';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;

  const markdown = exportAgentMarkdownForViewer(id, session.userId);
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
