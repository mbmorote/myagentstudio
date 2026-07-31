/**
 * app/api/settings/invite-codes/[code]/route.ts
 *
 * DELETE /api/settings/invite-codes/[code] — revoke an unredeemed invite code (admin only)
 *
 * Errors:
 *   404 not_found        — the code doesn't exist
 *   409 already_redeemed — the code has already been used
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/auth/guard';
import { revokeInviteCode } from '@/lib/db/repository/users';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  const { code } = await params;

  try {
    const result = revokeInviteCode(code);
    switch (result) {
      case 'deleted':
        return new NextResponse(null, { status: 204 });
      case 'not_found':
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      case 'already_redeemed':
        return NextResponse.json({ error: 'already_redeemed' }, { status: 409 });
    }
  } catch (err) {
    console.error('[invite-codes] DELETE error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
