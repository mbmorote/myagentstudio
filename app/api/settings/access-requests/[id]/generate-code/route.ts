/**
 * app/api/settings/access-requests/[id]/generate-code/route.ts
 *
 * POST /api/settings/access-requests/[id]/generate-code — admin only.
 *
 * Generates an invite code bound to the request's email, valid for the configured
 * expiry window (Settings → "Access-request code expiry (hours)", default 120 = 5 days), labels it
 * with the requester's name + how they found us for context, then removes the request
 * (it's handled — the code above is the durable record from here on). Then attempts to
 * email the code to the requester (Plan 14, D3 — auto-send for a code generated from an
 * access request, since that visitor was already told "we'll email your invite code
 * soon"). The send happens strictly AFTER the code is created and the request row
 * deleted — an email failure can never affect what's already committed, and never
 * changes this route's response status (Plan 14 constraints 2–3). `emailStatus` reports
 * the outcome; the code itself is always returned so the admin can copy/send it by hand
 * if the email failed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/auth/guard';
import { createAccessRequestInviteCode, sendAccessRequestInviteEmail } from '@/lib/auth/accessRequestCode';
import { getAccessRequest, deleteAccessRequest } from '@/lib/db/repository';

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

  let row;
  try {
    row = createAccessRequestInviteCode(accessRequest);
  } catch (err) {
    const msg = String(err);
    console.error('[access-requests] generate-code error:', msg);
    const error = msg.includes('code_generation_failed') ? 'code_generation_failed' : 'internal';
    return NextResponse.json({ error }, { status: 500 });
  }

  deleteAccessRequest(id);

  // The code is already committed above — the email outcome only shows up in
  // emailStatus, never in this route's status (sendAccessRequestInviteEmail never throws).
  const emailStatus = await sendAccessRequestInviteEmail(row, auth.session.userId);

  return NextResponse.json(
    {
      code: row.code,
      note: row.note,
      boundEmail: row.boundEmail,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      emailStatus,
    },
    { status: 201 },
  );
}
