/**
 * app/api/settings/invite-codes/route.ts
 *
 * GET  /api/settings/invite-codes — list all invite codes (admin only)
 * POST /api/settings/invite-codes — generate a new invite code (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/auth/guard';
import { generateInviteCode } from '@/lib/auth/inviteCode';
import { createInviteCode, listInviteCodes } from '@/lib/db/repository/users';

// ── GET /api/settings/invite-codes ────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  try {
    const codes = listInviteCodes();
    return NextResponse.json({
      codes: codes.map((c) => ({
        code: c.code,
        note: c.note,
        createdAt: c.createdAt.toISOString(),
        redeemedBy: c.redeemedBy,
        redeemedAt: c.redeemedAt?.toISOString() ?? null,
        boundEmail: c.boundEmail,
        expiresAt: c.expiresAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error('[invite-codes] GET error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

// ── POST /api/settings/invite-codes ───────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const note = (body as Record<string, unknown>)?.note;
  const noteStr = typeof note === 'string' && note.trim().length > 0 ? note.trim() : null;

  // Try to generate a unique code (up to 3 attempts per §4.2)
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = generateInviteCode();
    try {
      const row = createInviteCode({ code: candidate, note: noteStr, createdBy: auth.session.userId });
      return NextResponse.json(
        {
          code: row.code,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
          boundEmail: row.boundEmail,
          expiresAt: row.expiresAt?.toISOString() ?? null,
        },
        { status: 201 },
      );
    } catch (err) {
      // PK collision — try again
      const msg = String(err);
      if (msg.includes('UNIQUE') || msg.includes('SQLITE_CONSTRAINT')) {
        continue;
      }
      console.error('[invite-codes] POST error:', msg);
      return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
  }

  console.error('[invite-codes] POST: code_generation_failed after 3 attempts');
  return NextResponse.json({ error: 'code_generation_failed' }, { status: 500 });
}
