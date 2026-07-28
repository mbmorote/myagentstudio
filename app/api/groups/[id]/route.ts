/**
 * app/api/groups/[id]/route.ts
 *
 * Plan 03 Phase A, A.7 — Single group delete.
 *
 * DELETE /api/groups/[id]  → 204
 *
 * §4 route contract:
 *   DELETE errors: 404 if the group doesn't exist
 *
 * Business rules (Plan 03 §5 rule 3):
 *   Deleting a group deletes only its membership rows — member agents are untouched (R4).
 */

import { NextResponse } from 'next/server';
import { deleteGroup } from '@/lib/db/repository';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;

  const deleted = deleteGroup(id);
  if (!deleted) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
