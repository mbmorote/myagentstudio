/**
 * app/api/agents/[id]/groups/route.ts
 *
 * Plan 03 Phase A, A.8 — Add agent to group.
 *
 * POST /api/agents/[id]/groups  → 201 { ok: true } (new membership)
 *                                  200 { ok: true } (already a member — idempotent)
 *
 * §4 route contract:
 *   POST request: { groupId: string }
 *   POST errors:  401 unauthorized; 400 invalid body; 404 agent or group not found or not owned
 *
 * Business rules (Plan 03 §5 rule 2):
 *   Many-to-many — an agent may belong to zero, one, or many groups.
 *   If the membership already exists, returns 200 (not 409).
 */

import { NextResponse } from 'next/server';
import { addMembership } from '@/lib/db/repository';
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
    typeof (body as Record<string, unknown>).groupId !== 'string' ||
    !(body as Record<string, unknown>).groupId
  ) {
    return NextResponse.json({ error: 'invalid_body', fields: ['groupId'] }, { status: 400 });
  }

  const { groupId } = body as { groupId: string };

  const result = addMembership(agentId, groupId, session.userId);
  if (result === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true }, { status: result.created ? 201 : 200 });
}
