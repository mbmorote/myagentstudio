/**
 * app/api/groups/route.ts
 *
 * Plan 03 Phase A, A.6 — Group list + create.
 *
 * GET  /api/groups  → GroupDTO[] (each with memberAgentIds)
 * POST /api/groups  → 201 GroupDTO (new group, memberAgentIds: [])
 *
 * §4 route contract:
 *   POST request:  { name: string }
 *   POST response: 201 { id, name, memberAgentIds: [] }
 *   POST errors:   401 unauthorized; 400 invalid body; 409 { error: 'name_exists' }
 *
 * Business rules (Plan 03 §5):
 *   - Group name is unique per owner (§6.3 — composite unique index).
 *   - parentId is always null (R1 — flat MVP).
 */

import { NextResponse } from 'next/server';
import { listGroups, createGroup } from '@/lib/db/repository';
import { authenticate } from '@/lib/auth/guard';

export async function GET(): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const groups = listGroups(session.userId);
  return NextResponse.json(groups, { status: 200 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as Record<string, unknown>).name !== 'string' ||
    !(body as Record<string, unknown>).name
  ) {
    return NextResponse.json(
      { error: 'invalid_body', fields: ['name'] },
      { status: 400 },
    );
  }

  const { name } = body as { name: string };

  try {
    const dto = createGroup(session.userId, name.trim());
    return NextResponse.json(dto, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === 'NameExistsError') {
      return NextResponse.json({ error: 'name_exists' }, { status: 409 });
    }
    console.error('[POST /api/groups] Unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
