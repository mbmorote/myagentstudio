/**
 * app/api/agents/[id]/shares/[shareId]/route.ts
 *
 * DELETE /api/agents/[id]/shares/[shareId] — owner-only: revoke one person's access
 *
 * Plan 15 — Share agent, §4.5. Disabling the link and removing a person are two
 * separate actions that never imply each other (constraint 5) — this route only
 * ever touches one agent_share row and never agent.publicCode.
 */

import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/guard';
import { getAgentFull, deleteShare } from '@/lib/db/repository';

type RouteContext = { params: Promise<{ id: string; shareId: string }> };

export async function DELETE(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id, shareId } = await params;
  const agent = getAgentFull(id, session.userId);
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const deleted = deleteShare(shareId, id);
  if (!deleted) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
