/**
 * app/api/agents/redeem/route.ts
 *
 * POST /api/agents/redeem — any authenticated session: redeem a share-link code.
 *
 * Plan 15 — Share agent, §4.5. Deliberately NOT app/api/agents/[id]/redeem —
 * the caller has no id to supply, only the code, which the server resolves via
 * findAgentIdByPublicCode(). Accepting both an id AND a code would be a
 * confused-deputy hole.
 *
 * Constraint 6 (non-disclosure): unknown code, well-formed-but-nonexistent
 * code, and a code whose agent has since disabled its link all collapse to the
 * exact same 404 { error: 'invalid_code' } — there is only one lookup path
 * (findAgentIdByPublicCode), so this falls out for free rather than needing
 * three branches to agree.
 *
 * D4 resolved: no rate limit on this route — 256 bits of entropy is the sole
 * defense (constraint 7), nothing added on top.
 */

import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/guard';
import {
  findAgentIdByPublicCode,
  getAgentOwnerAndName,
  getUserById,
  findShare,
  createShare,
} from '@/lib/db/repository';

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

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { code } = body as Record<string, unknown>;
  if (typeof code !== 'string' || code.trim().length === 0) {
    return NextResponse.json({ error: 'invalid_body', field: 'code' }, { status: 400 });
  }

  const agentId = findAgentIdByPublicCode(code.trim());
  if (!agentId) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 404 });
  }

  const info = getAgentOwnerAndName(agentId);
  if (!info) {
    // Defensive only — findAgentIdByPublicCode just found this exact row.
    return NextResponse.json({ error: 'invalid_code' }, { status: 404 });
  }

  // Redeeming your own agent's code writes no row — you already own it.
  if (info.ownerId === session.userId) {
    return NextResponse.json(
      { agentId, agentName: info.name, access: 'owner', alreadyHadAccess: true },
      { status: 200 },
    );
  }

  const caller = getUserById(session.userId);
  if (!caller) {
    console.error('[POST /api/agents/redeem] Authenticated session has no matching user row:', session.userId);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  // alreadyHadAccess is resolved BEFORE the (idempotent) grant — createShare()
  // alone can't distinguish "already had it" from "just got it."
  const alreadyHadAccess = findShare(agentId, caller.email) !== null;
  createShare(agentId, caller.email, 'code');

  return NextResponse.json(
    { agentId, agentName: info.name, access: 'shared', alreadyHadAccess },
    { status: 200 },
  );
}
