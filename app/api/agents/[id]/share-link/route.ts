/**
 * app/api/agents/[id]/share-link/route.ts
 *
 * POST   /api/agents/[id]/share-link — owner-only: enable link sharing (idempotent-enable, D9)
 * DELETE /api/agents/[id]/share-link — owner-only: disable link sharing
 *
 * Plan 15 — Share agent, §4.5. POST is idempotent-enable, not rotate: if a code
 * already exists it is returned unchanged; only a DELETE then a fresh POST
 * produces a new one (D9). Because disable nulls the column, a re-enable never
 * resurrects the old code — a leaked link is dead the moment it is disabled,
 * permanently (§4.5).
 *
 * Collision handling: a UNIQUE failure on the 256-bit code regenerates, up to
 * 3 attempts, then throws — the exact retry shape
 * app/api/settings/invite-codes/route.ts uses for its own generated credential
 * (§4.3: this branch will not fire in practice at 256 bits of entropy).
 */

import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/guard';
import { getAgentFull, getPublicCodeInfo, setPublicCode, clearPublicCode } from '@/lib/db/repository';
import { generateShareCode } from '@/lib/auth/shareCode';

type RouteContext = { params: Promise<{ id: string }> };

// ── POST /api/agents/[id]/share-link ─────────────────────────────────────────

export async function POST(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;
  const agent = getAgentFull(id, session.userId);
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Idempotent-enable (D9) — a code already on this agent is returned unchanged.
  const existing = getPublicCodeInfo(id);
  if (existing?.publicCode) {
    return NextResponse.json(
      { publicCode: existing.publicCode, publicCodeCreatedAt: existing.publicCodeCreatedAt?.toISOString() ?? null },
      { status: 200 },
    );
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = generateShareCode();
    try {
      const result = setPublicCode(id, candidate);
      return NextResponse.json(
        { publicCode: result.publicCode, publicCodeCreatedAt: result.publicCodeCreatedAt.toISOString() },
        { status: 200 },
      );
    } catch (err) {
      const msg = String(err);
      if (msg.includes('UNIQUE') || msg.includes('SQLITE_CONSTRAINT')) {
        continue; // 256-bit collision — regenerate and retry
      }
      console.error('[POST /api/agents/[id]/share-link] Unexpected error:', msg);
      return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
  }

  console.error('[POST /api/agents/[id]/share-link]: code_generation_failed after 3 attempts');
  return NextResponse.json({ error: 'code_generation_failed' }, { status: 500 });
}

// ── DELETE /api/agents/[id]/share-link ───────────────────────────────────────

export async function DELETE(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;
  const agent = getAgentFull(id, session.userId);
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  clearPublicCode(id);
  return NextResponse.json({ publicCode: null }, { status: 200 });
}
