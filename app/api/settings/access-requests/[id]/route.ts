/**
 * app/api/settings/access-requests/[id]/route.ts
 *
 * DELETE /api/settings/access-requests/[id] — dismiss an open request (admin only)
 *
 * No code is generated; the row is just removed (e.g. spam, duplicate, or the admin
 * decided not to offer a spot). See .../generate-code/route.ts for the other outcome.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/auth/guard';
import { deleteAccessRequest } from '@/lib/db/repository';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const deleted = deleteAccessRequest(id);
    if (!deleted) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[access-requests] DELETE error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
