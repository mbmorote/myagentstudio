/**
 * app/api/agents/route.ts
 *
 * GET  /api/agents  → AgentDTO[] (lite: no sections; includes id, name, description,
 *                     source, platform, splitLevel)
 * POST /api/agents  → AgentDTO (new agent with core sections seeded from templates)
 *
 * §5 route contract:
 *   POST request:  { name: string, description: string }
 *   POST response: AgentDTO (full, with 4 core sections pre-seeded, author:'scaffold')
 *   POST errors:   409 name_exists; 400 invalid body; 401 unauthorized
 *
 * Business rules (§6):
 *   - New agent: source:'created', platform:'claude', splitLevel:1
 *   - Core sections seeded from SectionDef.isCore templates
 *   - Revision #0 per section, author:'scaffold' (D5 — platform-created, not user-typed)
 */

import { NextResponse } from 'next/server';
import { listAgents, createAgent } from '@/lib/db/repository';
import { authenticate } from '@/lib/auth/guard';

export async function GET(): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const agents = listAgents(session.userId);
  return NextResponse.json(agents, { status: 200 });
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
    typeof (body as Record<string, unknown>).description !== 'string'
  ) {
    return NextResponse.json(
      { error: 'invalid_body', fields: ['name', 'description'] },
      { status: 400 },
    );
  }

  const { name, description } = body as { name: string; description: string };

  try {
    const dto = createAgent(session.userId, name, description);
    return NextResponse.json(dto, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === 'NameExistsError') {
      return NextResponse.json({ error: 'name_exists' }, { status: 409 });
    }
    console.error('[POST /api/agents] Unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
