/**
 * app/api/account/tokens/[id]/route.ts
 *
 * DELETE /api/account/tokens/{id} — revoke a token
 *
 * Access: session-authenticated with authenticate().
 * Only the caller's own token may be revoked — the revokeApiToken() repository
 * function requires both id and ownerId to match, so even a valid id for another
 * user's token produces a 404 (same non-disclosure posture: confirming that a
 * token id exists but belongs to a different user leaks information).
 *
 * Plan 13 (2026-08-15) — MCP server exposing MyAgentStudio's agents.
 */

import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/guard';
import { revokeApiToken } from '@/lib/db/repository';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  try {
    const revoked = revokeApiToken(id, session.userId);
    if (!revoked) {
      // Not found or wrong owner — same 404 response either way
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ revoked: true }, { status: 200 });
  } catch (err) {
    console.error('[account/tokens/revoke] DELETE error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
