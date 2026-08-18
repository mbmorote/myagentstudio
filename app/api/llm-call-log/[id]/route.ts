/**
 * app/api/llm-call-log/[id]/route.ts
 *
 * GET /api/llm-call-log/[id] (any authenticated user — scoped by role, 2026-08-18)
 *
 * Returns the full log row for a single entry, including requestPayload
 * and responsePayload (subject to §5.6 redaction). This is the detail view
 * linked from the Settings page via `?log=<id>` deep links (§5.4, §7.1) —
 * that permalink target stays admin-only (`/settings` is still an admin-gated
 * full page), so it's only ever surfaced to admin viewers in the UI.
 *
 * The admin is the viewer for their own requests: rows from users who have not
 * consented (sharedWithAdmin=false) have both payloads returned as null and
 * redacted:true; metadata fields are intact.
 *
 * Non-admin (2026-08-18): may only ever fetch their OWN row. A row belonging to
 * someone else returns 404 — not 403, so a non-admin can't distinguish "not
 * yours" from "doesn't exist" and probe which ids are valid. A non-admin's own
 * row is never redacted (§5.6's userId === viewerUserId short-circuit).
 *
 * Response: CallLogFull (with createdAt serialized to ISO string)
 * 404 if not found, or found but not the caller's row and the caller isn't admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCallLog } from '@/lib/db/repository';
import { authenticate } from '@/lib/auth/guard';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const { id } = await params;
    // Pass the caller's userId as viewerUserId for §5.6 redaction computation
    const row = getCallLog(id, session.userId);

    if (!row) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // Non-admin: only their own row is ever visible — hide existence of anyone else's.
    if (session.role !== 'admin' && row.userId !== session.userId) {
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
