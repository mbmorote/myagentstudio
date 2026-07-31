/**
 * app/api/llm-call-log/route.ts
 *
 * GET /api/llm-call-log (admin only)
 *
 * Returns a capped, ordered list of log entries without payloads.
 *
 * Query parameters (§7.1):
 *   limit   — 1–500, default 200
 *   dryRun  — 'true' | 'false' — filter by dry-run status when present
 *   kind    — 'import-strict' | 'import-structural' | 'chat' — filter by kind when present
 *
 * Response: { entries: CallLogListItem[] }
 *
 * The `redacted` flag on each entry is computed against the admin's userId:
 * rows where userId !== admin && sharedWithAdmin === false have redacted:true.
 * Payloads are NOT included — see GET /api/llm-call-log/[id] for the full row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listCallLogs } from '@/lib/db/repository';
import type { LlmCallKind } from '@/lib/db/repository';
import { authenticateAdmin } from '@/lib/auth/guard';

const VALID_KINDS = new Set<string>(['import-strict', 'import-structural', 'chat']);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const dryRunParam = url.searchParams.get('dryRun');
    const kindParam = url.searchParams.get('kind');

    // Validate limit
    let limit: number | undefined;
    if (limitParam !== null) {
      const n = Number(limitParam);
      if (!Number.isInteger(n) || n < 1 || n > 500) {
        return NextResponse.json(
          { error: 'invalid_query', field: 'limit' },
          { status: 400 },
        );
      }
      limit = n;
    }

    // Validate dryRun
    let dryRun: boolean | undefined;
    if (dryRunParam !== null) {
      if (dryRunParam !== 'true' && dryRunParam !== 'false') {
        return NextResponse.json(
          { error: 'invalid_query', field: 'dryRun' },
          { status: 400 },
        );
      }
      dryRun = dryRunParam === 'true';
    }

    // Validate kind
    let kind: LlmCallKind | undefined;
    if (kindParam !== null) {
      if (!VALID_KINDS.has(kindParam)) {
        return NextResponse.json(
          { error: 'invalid_query', field: 'kind' },
          { status: 400 },
        );
      }
      kind = kindParam as LlmCallKind;
    }

    // Pass the admin's userId as viewerUserId so redaction is computed correctly (§5.6)
    const entries = listCallLogs({ limit, dryRun, kind, viewerUserId: session.userId });

    // Serialize Date fields for JSON transport
    const serialized = entries.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    }));

    return NextResponse.json({ entries: serialized }, { status: 200 });
  } catch (err) {
    console.error('[llm-call-log] GET unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
