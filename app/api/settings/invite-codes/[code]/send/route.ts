/**
 * app/api/settings/invite-codes/[code]/send/route.ts
 *
 * POST /api/settings/invite-codes/[code]/send — admin-only manual (re)send of an
 * existing invite code's email (Plan 14, §4.8). This is the recovery path for a
 * failed automatic send, and the entire reason this plan needs no retry queue (§9):
 * a lost email is recoverable with one click here.
 *
 * Errors:
 *   404 not_found        — the code doesn't exist
 *   409 already_redeemed — sending a spent credential is never useful
 *   409 expired
 *   400 no_recipient     — boundEmail is unset and no `to` was supplied in the body
 *                          (constraint 5's one authenticated exception: an admin may
 *                          type a recipient address here)
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/auth/guard';
import { getInviteCode } from '@/lib/db/repository/users';
import { getEmailGateway, emailStatusFromResult } from '@/lib/email/gateway';
import { renderInviteCodeEmail } from '@/lib/email/templates/inviteCode';
import { isEmailConfigured, getAppBaseUrl } from '@/lib/env';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  const { code } = await params;

  const row = getInviteCode(code);
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (row.redeemedBy !== null) {
    return NextResponse.json({ error: 'already_redeemed' }, { status: 409 });
  }
  if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }
  const toRaw = (body as Record<string, unknown>)?.to;
  const bodyTo = typeof toRaw === 'string' && toRaw.trim().includes('@') ? toRaw.trim().toLowerCase() : null;

  const recipient = row.boundEmail ?? bodyTo;
  if (!recipient) {
    return NextResponse.json({ error: 'no_recipient' }, { status: 400 });
  }

  let emailStatus: ReturnType<typeof emailStatusFromResult> = 'failed';
  let logId: string | null = null;
  try {
    const appBaseUrl = isEmailConfigured() ? getAppBaseUrl() : '';
    const rendered = renderInviteCodeEmail({ code: row.code, expiresAt: row.expiresAt, appBaseUrl });
    const sendResult = await getEmailGateway().sendEmail(
      { to: recipient, subject: rendered.subject, text: rendered.text, html: rendered.html },
      { kind: 'invite_code', relatedType: 'invite_code', relatedId: row.code, triggeredBy: auth.session.userId },
    );
    emailStatus = emailStatusFromResult(sendResult);
    logId = sendResult.logId;
  } catch (err) {
    console.error('[invite-codes] send: email send threw unexpectedly:', String(err));
  }

  return NextResponse.json({ emailStatus, logId }, { status: 200 });
}
