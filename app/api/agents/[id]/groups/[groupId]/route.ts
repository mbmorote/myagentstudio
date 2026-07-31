/**
 * app/api/agents/[id]/groups/[groupId]/route.ts
 *
 * Plan 03 Phase A, A.9 — Remove agent from group.
 *
 * DELETE /api/agents/[id]/groups/[groupId]  → 204
 *
 * §4 route contract:
 *   DELETE errors: 401 unauthorized; 404 if the membership doesn't exist or not owned
 */

import { NextResponse } from 'next/server';
import { removeMembership } from '@/lib/db/repository';
import { authenticate } from '@/lib/auth/guard';

type RouteContext = { params: Promise<{ id: string; groupId: string }> };

export async function DELETE(
  _request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id: agentId, groupId } = await params;

  const removed = removeMembership(agentId, groupId, session.userId);
  if (!removed) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
