/**
 * app/api/settings/access-requests/[id]/generate-code/route.ts
 *
 * POST /api/settings/access-requests/[id]/generate-code — admin only.
 *
 * Generates an invite code bound to the request's email, valid for the configured
 * expiry window (Settings → "Access-request code expiry (hours)", default 5), labels it
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
import { generateInviteCode } from '@/lib/auth/inviteCode';
import { REFERRAL_SOURCE_LABELS } from '@/lib/auth/referralSource';
import { getAccessRequestCodeExpiryHours } from '@/lib/settings';
import { getAccessRequest, deleteAccessRequest, createInviteCode } from '@/lib/db/repository';
import { getEmailGateway, emailStatusFromResult } from '@/lib/email/gateway';
import { renderInviteCodeEmail } from '@/lib/email/templates/inviteCode';
import { isEmailConfigured, getAppBaseUrl } from '@/lib/env';

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

      // The code is already committed above — nothing past this point may ever
      // turn into this route's 500 (constraint 3). The gateway itself never
      // throws (constraint 2); this try/catch guards only against a genuinely
      // unexpected failure in this block (e.g. a template bug), which degrades
      // to emailStatus:'failed' rather than corrupting the whole response.
      let emailStatus: ReturnType<typeof emailStatusFromResult> = 'failed';
      try {
        // appBaseUrl is only ever '' on the not-configured path — the gateway's
        // step 0 returns before ever touching the message content in that case,
        // so this placeholder is never actually used to build a real send.
        const appBaseUrl = isEmailConfigured() ? getAppBaseUrl() : '';
        const rendered = renderInviteCodeEmail({ code: row.code, expiresAt: row.expiresAt, appBaseUrl });
        const sendResult = await getEmailGateway().sendEmail(
          { to: row.boundEmail!, subject: rendered.subject, text: rendered.text, html: rendered.html },
          { kind: 'invite_code', relatedType: 'invite_code', relatedId: row.code, triggeredBy: auth.session.userId },
        );
        emailStatus = emailStatusFromResult(sendResult);
      } catch (emailErr) {
        console.error('[access-requests] generate-code: email send threw unexpectedly:', String(emailErr));
      }

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
