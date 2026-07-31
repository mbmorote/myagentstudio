/**
 * app/api/agents/[id]/route.ts
 *
 * GET    /api/agents/[id]  → AgentDTO (full: includes sections, config, validation)
 * PATCH  /api/agents/[id]  → AgentDTO (updated)
 * DELETE /api/agents/[id]  → { ok: true }
 *
 * §5 route contract:
 *   GET:    no body; 404 if not found or not owned by caller
 *   PATCH:  { name?, description?, config?: {propKey, value}[] }; 404; 409 name_exists
 *   DELETE: no body; 404 if not found or not owned; SectionRevision + AgentSnapshot retained (§6 rule 4)
 */

import { NextResponse } from 'next/server';
import { getAgentFull, updateAgent, deleteAgent } from '@/lib/db/repository';
import { authenticate } from '@/lib/auth/guard';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;
  const dto = getAgentFull(id, session.userId);
  if (!dto) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(dto, { status: 200 });
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const patch = body as {
    name?: unknown;
    description?: unknown;
    config?: unknown;
  };

  // Validate field types when present
  if (patch.name !== undefined && typeof patch.name !== 'string') {
    return NextResponse.json({ error: 'invalid_body', field: 'name' }, { status: 400 });
  }
  if (patch.description !== undefined && typeof patch.description !== 'string') {
    return NextResponse.json({ error: 'invalid_body', field: 'description' }, { status: 400 });
  }
  if (patch.config !== undefined) {
    if (!Array.isArray(patch.config)) {
      return NextResponse.json({ error: 'invalid_body', field: 'config' }, { status: 400 });
    }
  }

  try {
    const dto = updateAgent(id, session.userId, {
      name: patch.name as string | undefined,
      description: patch.description as string | undefined,
      config: patch.config as { propKey: string; value: unknown }[] | undefined,
    });

    if (!dto) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(dto, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.name === 'NameExistsError') {
      return NextResponse.json({ error: 'name_exists' }, { status: 409 });
    }
    console.error('[PATCH /api/agents/[id]] Unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;
  // deleteAgent returns boolean — false means not found or owner mismatch (→ 404)
  const deleted = deleteAgent(id, session.userId);
  if (!deleted) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
