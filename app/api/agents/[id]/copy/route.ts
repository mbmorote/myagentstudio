/**
 * app/api/agents/[id]/copy/route.ts
 *
 * POST /api/agents/[id]/copy — share-holder only in practice: fork an
 * independent copy of a shared agent into the caller's own library
 * ("Copy to me"). The owner of the source agent gets 400
 * cannot_copy_own_agent — see copyAgentForOwner()'s doc comment for why this
 * is blocked rather than left to fall through to a name collision.
 *
 * Plan 15 — Share agent, §4.5/§4.6. Zero AI calls on this path — see the
 * fitness assertion in app/api/__tests__/route-guard.test.ts (§4.10, added in
 * a later step). copyAgentForOwner() already resolves access via
 * getAgentFullForViewer(); this route does no ownership check of its own.
 */

import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/guard';
import { copyAgentForOwner, CannotCopyOwnAgentError } from '@/lib/db/repository';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const { name } = body;
  if (name !== undefined && typeof name !== 'string') {
    return NextResponse.json({ error: 'invalid_body', field: 'name' }, { status: 400 });
  }

  try {
    const dto = copyAgentForOwner(id, session.userId, name as string | undefined);
    if (!dto) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(dto, { status: 201 });
  } catch (err) {
    if (err instanceof CannotCopyOwnAgentError) {
      return NextResponse.json({ error: 'cannot_copy_own_agent' }, { status: 400 });
    }
    if (err instanceof Error && err.name === 'NameExistsError') {
      return NextResponse.json({ error: 'name_exists' }, { status: 409 });
    }
    console.error('[POST /api/agents/[id]/copy] Unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
