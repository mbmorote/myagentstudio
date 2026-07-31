/**
 * app/api/llm-call-log/[id]/route.ts
 *
 * GET /api/llm-call-log/[id] (admin only)
 *
 * Returns the full log row for a single entry, including requestPayload
 * and responsePayload (subject to §5.6 redaction). This is the detail view
 * linked from the Settings page via `?log=<id>` deep links (§5.4, §7.1).
 *
 * The admin is the viewer: rows from users who have not consented (sharedWithAdmin=false)
 * have both payloads returned as null and redacted:true; metadata fields are intact.
 *
 * Response: CallLogFull (with createdAt serialized to ISO string)
 * 404 if not found.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCallLog } from '@/lib/db/repository';
import { authenticateAdmin } from '@/lib/auth/guard';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const { id } = await params;
    // Pass the admin's userId as viewerUserId for §5.6 redaction computation
    const row = getCallLog(id, session.userId);

    if (!row) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(
      { ...row, createdAt: row.createdAt.toISOString() },
      { status: 200 },
    );
  } catch (err) {
    console.error('[llm-call-log] GET [id] unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
