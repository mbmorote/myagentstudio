/**
 * app/api/agents/[id]/groups/[groupId]/route.ts
 *
 * Plan 03 Phase A, A.9 — Remove agent from group.
 *
 * DELETE /api/agents/[id]/groups/[groupId]  → 204
 *
 * §4 route contract:
 *   DELETE errors: 404 if the membership doesn't exist
 */

import { NextResponse } from 'next/server';
import { removeMembership } from '@/lib/db/repository';

type RouteContext = { params: Promise<{ id: string; groupId: string }> };

export async function DELETE(
  _request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id: agentId, groupId } = await params;

  const removed = removeMembership(agentId, groupId);
  if (!removed) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
