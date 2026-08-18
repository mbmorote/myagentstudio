/**
 * app/api/llm-call-log/route.ts
 *
 * GET /api/llm-call-log (any authenticated user — scoped by role, 2026-08-18)
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
 * Scoping (2026-08-18, "Per-user view of the activity log" — Settings/Account
 * merge): a non-admin is FORCED to userId: session.userId regardless of any
 * query override, so they can only ever see their own calls — there is no way
 * to request another user's rows. Admin keeps the original unrestricted view
 * (every user's calls).
 *
 * The `redacted` flag on each entry is computed against the viewer's userId:
 * rows where userId !== viewer && sharedWithAdmin === false have redacted:true.
 * A non-admin's own rows are never redacted (userId === viewerUserId short-
 * circuits the rule) — payloads are NOT included in this list view regardless;
 * see GET /api/llm-call-log/[id] for the full row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listCallLogs } from '@/lib/db/repository';
import type { LlmCallKind } from '@/lib/db/repository';
import { authenticate } from '@/lib/auth/guard';

const VALID_KINDS = new Set<string>(['import-strict', 'import-structural', 'chat']);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const isAdmin = session.role === 'admin';

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

    // Non-admin: force userId so only their own rows are ever returned (2026-08-18).
    // viewerUserId is always the caller — for a non-admin that's the same id as the
    // forced userId filter, so their own rows are never redacted (§5.6).
    const entries = listCallLogs({
      limit,
      dryRun,
      kind,
      userId: isAdmin ? undefined : session.userId,
      viewerUserId: session.userId,
    });

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
