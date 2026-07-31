/**
 * app/api/account/route.ts
 *
 * GET  /api/account — returns the caller's own email, role, and consent setting
 * PATCH /api/account — updates the caller's log-sharing consent
 *
 * Access: any authenticated session (§7.1, §5.7).
 * No user id is accepted from the body, URL, or query string — only session.userId
 * is ever operated on (§8 invariant 17).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth/guard';
import { getUserById, setUserLogSharing } from '@/lib/db/repository/users';
import { listOAuthAccountsForUser } from '@/lib/db/repository/oauthAccounts';

// ── GET /api/account ──────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const user = getUserById(session.userId);
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    // linkedProviders: read-only, session user's own rows only (§7.1, invariant 17)
    const oauthAccounts = listOAuthAccountsForUser(session.userId);
    const linkedProviders = oauthAccounts.map((a) => a.provider);

    return NextResponse.json({
      email: user.email,
      role: user.role,
      shareLogsWithAdmin: user.shareLogsWithAdmin,
      linkedProviders,
    });
  } catch (err) {
    console.error('[account] GET error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

// ── PATCH /api/account ────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest): Promise<NextResponse> {
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

  const { shareLogsWithAdmin } = body as Record<string, unknown>;

  // Strict boolean check — §8 invariant 15 applies here too: only a literal
  // boolean is accepted; a malformed body is rejected, not silently coerced.
  if (typeof shareLogsWithAdmin !== 'boolean') {
    return NextResponse.json(
      { error: 'invalid_body', field: 'shareLogsWithAdmin' },
      { status: 400 },
    );
  }

  try {
    // Only session.userId's row is ever touched (§8 invariant 17)
    const updated = setUserLogSharing(session.userId, shareLogsWithAdmin);
    if (!updated) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    return NextResponse.json({ shareLogsWithAdmin });
  } catch (err) {
    console.error('[account] PATCH error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
