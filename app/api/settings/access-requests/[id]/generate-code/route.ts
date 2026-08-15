/**
 * app/api/settings/access-requests/[id]/generate-code/route.ts
 *
 * POST /api/settings/access-requests/[id]/generate-code — admin only.
 *
 * Generates an invite code bound to the request's email, valid for the configured
 * expiry window (Settings → "Access-request code expiry (hours)", default 5), labels it
 * with the requester's name + how they found us for context, then removes the request
 * (it's handled — the code above is the durable record from here on). Nothing is
 * emailed automatically yet (roadmap item, Plan 12) — the admin copies the code and
 * sends it themselves.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/auth/guard';
import { generateInviteCode } from '@/lib/auth/inviteCode';
import { REFERRAL_SOURCE_LABELS } from '@/lib/auth/referralSource';
import { getAccessRequestCodeExpiryHours } from '@/lib/settings';
import { getAccessRequest, deleteAccessRequest, createInviteCode } from '@/lib/db/repository';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const accessRequest = getAccessRequest(id);
  if (!accessRequest) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const expiresAt = new Date(Date.now() + getAccessRequestCodeExpiryHours() * 60 * 60 * 1000);
  const note = accessRequest.referralSource
    ? `${accessRequest.name} · via ${REFERRAL_SOURCE_LABELS[accessRequest.referralSource]}`
    : accessRequest.name;

  // Try to generate a unique code (up to 3 attempts, same pattern as
  // /api/settings/invite-codes).
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = generateInviteCode();
    try {
      const row = createInviteCode({
        code: candidate,
        note,
        createdBy: null, // self-requested — no admin authored this one
        boundEmail: accessRequest.email,
        expiresAt,
      });

      deleteAccessRequest(id);

      return NextResponse.json(
        {
          code: row.code,
          note: row.note,
          boundEmail: row.boundEmail,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        },
        { status: 201 },
      );
    } catch (err) {
      const msg = String(err);
      if (msg.includes('UNIQUE') || msg.includes('SQLITE_CONSTRAINT')) {
        continue;
      }
      console.error('[access-requests] generate-code error:', msg);
      return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
  }

  console.error('[access-requests] generate-code: code_generation_failed after 3 attempts');
  return NextResponse.json({ error: 'code_generation_failed' }, { status: 500 });
}
