/**
 * app/api/account/tokens/route.ts
 *
 * GET  /api/account/tokens — list the caller's own tokens
 *                             prefix/name/scope/dates only — never the hash or plaintext
 * POST /api/account/tokens — create a new token
 *                             ONLY response that ever contains the plaintext
 *
 * Access: session-authenticated with authenticate().
 * Only the caller's own tokens are ever read or created — the ownerId is always
 * session.userId, never from the request body (same pattern as every route using
 * the repository's ownerId parameter).
 *
 * Plan 13 (2026-08-15) — MCP server exposing MyAgent's agents.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/guard';
import { generateApiToken } from '@/lib/auth/apiToken';
import {
  listApiTokensForUser,
  createApiToken,
  TooManyTokensError,
} from '@/lib/db/repository';

// ── GET /api/account/tokens ────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const tokens = listApiTokensForUser(session.userId);
    // Strip ownerId from the response — the client already knows who they are
    const sanitized = tokens.map(({ id, name, prefix, scope, createdAt, lastUsedAt, expiresAt, revokedAt }) => ({
      id, name, prefix, scope, createdAt, lastUsedAt, expiresAt, revokedAt,
    }));
    return NextResponse.json(sanitized, { status: 200 });
  } catch (err) {
    console.error('[account/tokens] GET error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

// ── POST /api/account/tokens ───────────────────────��───────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  const { name, scope } = body as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'invalid_body', field: 'name' }, { status: 400 });
  }
  if (scope !== 'read' && scope !== 'write') {
    return NextResponse.json({ error: 'invalid_body', field: 'scope' }, { status: 400 });
  }

  try {
    const { plaintext, hash, prefix } = generateApiToken();

    const token = createApiToken({
      ownerId: session.userId,
      name: name.trim(),
      tokenHash: hash,
      prefix,
      scope: scope as 'read' | 'write',
      expiresAt: null, // optional — not exposed in the UI today
    });

    // The plaintext is returned EXACTLY ONCE in this 201 response.
    // It is never stored and can never be retrieved again.
    return NextResponse.json(
      {
        token: {
          id: token.id,
          name: token.name,
          prefix: token.prefix,
          scope: token.scope,
          createdAt: token.createdAt,
          lastUsedAt: token.lastUsedAt,
          expiresAt: token.expiresAt,
          revokedAt: token.revokedAt,
        },
        // The plaintext value — show to the user once, with a copy button.
        // This field ONLY appears in the 201 creation response, never again.
        plaintext,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof TooManyTokensError) {
      return NextResponse.json({ error: 'too_many_tokens', message: err.message }, { status: 422 });
    }
    console.error('[account/tokens] POST error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
