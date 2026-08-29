/**
 * app/api/agents/[id]/shares/route.ts
 *
 * GET  /api/agents/[id]/shares — owner-only: link state + list of email-granted shares
 * POST /api/agents/[id]/shares — owner-only: grant access by email (idempotent-grant)
 *
 * Plan 15 — Share agent, §4.5. Ownership is checked via getAgentFull(id,
 * session.userId) before any agentShares.ts call, since agent_share rows carry
 * no ownerId of their own — ownership lives on the agent row (§4.2).
 *
 * POST is idempotent-grant: re-adding an address that already has a row
 * returns 200 with the existing row, not 409 — createShare() already does
 * this. No cap on shares per agent (D7 resolved: no cap).
 */

import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/guard';
import { getAgentFull, getPublicCodeInfo, listSharesForAgent, createShare, getUserById } from '@/lib/db/repository';

type RouteContext = { params: Promise<{ id: string }> };

// ── GET /api/agents/[id]/shares ──────────────────────────────────────────────

export async function GET(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;
  const agent = getAgentFull(id, session.userId);
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const linkInfo = getPublicCodeInfo(id);
  const shares = listSharesForAgent(id);

  return NextResponse.json(
    {
      publicCode: linkInfo?.publicCode ?? null,
      publicCodeCreatedAt: linkInfo?.publicCodeCreatedAt?.toISOString() ?? null,
      shares: shares.map((s) => ({
        id: s.id,
        recipientEmail: s.recipientEmail,
        grantedVia: s.grantedVia,
        createdAt: s.createdAt.toISOString(),
      })),
    },
    { status: 200 },
  );
}

// ── POST /api/agents/[id]/shares ─────────────────────────────────────────────

export async function POST(request: Request, { params }: RouteContext): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;
  const agent = getAgentFull(id, session.userId);
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { recipientEmail } = body as Record<string, unknown>;
  if (typeof recipientEmail !== 'string') {
    return NextResponse.json({ error: 'invalid_body', field: 'recipientEmail' }, { status: 400 });
  }

  // Same minimal check every other email route in this codebase uses (not a
  // stricter regex on purpose — §4.5: a valid-looking-but-wrong address is the
  // owner's problem to notice in the visible list, not the server's to guess at).
  const normalizedEmail = recipientEmail.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  // Resolved from the DB by userId, not session.email — constraint 4
  // (plans/15-share-agent.md §3): no authorization/validation decision here
  // trusts the session's own, display-only email claim.
  const caller = getUserById(session.userId);
  if (caller && normalizedEmail === caller.email) {
    return NextResponse.json({ error: 'cannot_share_with_self' }, { status: 400 });
  }

  try {
    const share = createShare(id, normalizedEmail, 'email');
    return NextResponse.json(
      {
        id: share.id,
        recipientEmail: share.recipientEmail,
        grantedVia: share.grantedVia,
        createdAt: share.createdAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/agents/[id]/shares] Unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
