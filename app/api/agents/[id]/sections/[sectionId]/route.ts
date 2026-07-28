/**
 * app/api/agents/[id]/sections/[sectionId]/route.ts
 *
 * Phase 4.8 — Section-level manual content edit.
 *
 * PATCH /api/agents/[id]/sections/[sectionId]
 *   → { content: string, version: number }
 *
 * §5 route contract:
 *   Request:  { content: string, expectedVersion: number }
 *   Response: { content: string, version: number }
 *   Errors:   400 invalid body; 404 section not found; 409 version_conflict (R4)
 *
 * Business rules (§6):
 *   - author:'user' for manual edits (interaction-lock client-enforcement means
 *     chat is not in flight; the per-section version check is the real backstop — R4).
 *   - Appends exactly one SectionRevision (rule 3).
 *   - Split-level demotion for manual edits (rule 6) is NOT enforced server-side here
 *     (the interaction lock ensures this is a human choice, not a mediator output);
 *     the client is responsible for the heading guardrail in raw-edit mode.
 */

import { NextResponse } from 'next/server';
import { updateSectionContent, VersionConflictError } from '@/lib/db/repository';

type RouteContext = { params: Promise<{ id: string; sectionId: string }> };

export async function PATCH(request: Request, { params }: RouteContext): Promise<NextResponse> {
  const { sectionId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as Record<string, unknown>).content !== 'string' ||
    typeof (body as Record<string, unknown>).expectedVersion !== 'number'
  ) {
    return NextResponse.json(
      { error: 'invalid_body', fields: ['content', 'expectedVersion'] },
      { status: 400 },
    );
  }

  const { content, expectedVersion } = body as { content: string; expectedVersion: number };

  try {
    const result = updateSectionContent(sectionId, content, 'user', expectedVersion);
    return NextResponse.json({ content, version: result.version }, { status: 200 });
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return NextResponse.json(
        { error: 'version_conflict', current: err.current },
        { status: 409 },
      );
    }
    if (err instanceof Error && err.message.includes('Section not found')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    console.error('[PATCH /api/agents/[id]/sections/[sectionId]] Unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
