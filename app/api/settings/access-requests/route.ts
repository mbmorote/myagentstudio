/**
 * app/api/settings/access-requests/route.ts
 *
 * GET /api/settings/access-requests — list all open access requests (admin only)
 *
 * Plan 12 (2026-08-14). A row here is an OPEN request the admin hasn't acted on
 * yet — see app/api/settings/access-requests/[id]/route.ts (dismiss) and
 * .../generate-code/route.ts (generate + remove).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/auth/guard';
import { listAccessRequests } from '@/lib/db/repository';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  try {
    const requests = listAccessRequests();
    return NextResponse.json({
      requests: requests.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        referralSource: r.referralSource,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[access-requests] GET error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
