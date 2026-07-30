/**
 * app/api/llm-call-log/[id]/route.ts
 *
 * GET /api/llm-call-log/[id]
 *
 * Returns the full log row for a single entry, including requestPayload
 * and responsePayload. This is the detail view linked from the Settings page
 * via `?log=<id>` deep links (§5.4, §7.1).
 *
 * Response: CallLogFull (with createdAt serialized to ISO string)
 * 404 if not found.
 *
 * Security note (§9): this endpoint exposes full system prompts and agent
 * content — intentional for an audit log in a local single-user app, but
 * flagged for Plan B auth (§13).
 */

import { NextResponse } from 'next/server';
import { getCallLog } from '@/lib/db/repository';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  try {
    const { id } = await params;
    const row = getCallLog(id);

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
