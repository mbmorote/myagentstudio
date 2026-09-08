/**
 * app/api/settings/invite-codes/route.ts
 *
 * GET  /api/settings/invite-codes — list all invite codes (admin only)
 * POST /api/settings/invite-codes — generate a new invite code (admin only)
 *
 * POST accepts an optional `sendTo` (Plan 14, D3): a code generated here has no
 * known recipient until the admin names one, unlike the access-request flow
 * where the requester's email is already on file — so sending is opt-in per
 * call rather than automatic. Omitting `sendTo` keeps today's behavior exactly
 * unchanged, including the response shape (no `emailStatus` field at all).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/auth/guard';
import { generateInviteCode } from '@/lib/auth/inviteCode';
import { createInviteCode, listInviteCodes } from '@/lib/db/repository/users';
import { getLastEmailForInviteCode } from '@/lib/db/repository/emailLog';
import { getEmailGateway, emailStatusFromResult } from '@/lib/email/gateway';
import { renderInviteCodeEmail } from '@/lib/email/templates/inviteCode';
import { isEmailConfigured, getAppBaseUrl } from '@/lib/env';

// ── GET /api/settings/invite-codes ────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  try {
    const codes = listInviteCodes();
    return NextResponse.json({
      codes: codes.map((c) => {
        // Per-code send status (Plan 14, D6 inline flags) — derived from email_log,
        // not stored on invite_code itself (would create a second source of truth).
        const lastEmail = getLastEmailForInviteCode(c.code);
        return {
          code: c.code,
          note: c.note,
          createdAt: c.createdAt.toISOString(),
          redeemedBy: c.redeemedBy,
          redeemedAt: c.redeemedAt?.toISOString() ?? null,
          boundEmail: c.boundEmail,
          expiresAt: c.expiresAt?.toISOString() ?? null,
          lastEmailStatus: lastEmail?.status ?? null,
        };
      }),
    });
  } catch (err) {
    console.error('[invite-codes] GET error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

// ── POST /api/settings/invite-codes ───────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const note = (body as Record<string, unknown>)?.note;
  const noteStr = typeof note === 'string' && note.trim().length > 0 ? note.trim() : null;

  const sendToRaw = (body as Record<string, unknown>)?.sendTo;
  let sendTo: string | null = null;
  if (sendToRaw !== undefined && sendToRaw !== null) {
    if (typeof sendToRaw !== 'string' || !sendToRaw.trim().includes('@')) {
      return NextResponse.json({ error: 'invalid_send_to' }, { status: 400 });
    }
    sendTo = sendToRaw.trim().toLowerCase();
  }

  // Try to generate a unique code (up to 3 attempts per §4.2)
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = generateInviteCode();
    try {
      const row = createInviteCode({ code: candidate, note: noteStr, createdBy: auth.session.userId });

      // The code is already committed above — an email failure here can never
      // turn into this route's 500 (constraint 3), and emailStatus is only
      // present in the response at all when sendTo was actually supplied.
      let emailStatus: ReturnType<typeof emailStatusFromResult> | undefined;
      if (sendTo) {
        emailStatus = 'failed';
        try {
          const appBaseUrl = isEmailConfigured() ? getAppBaseUrl() : '';
          const rendered = renderInviteCodeEmail({ code: row.code, expiresAt: row.expiresAt, appBaseUrl });
          const sendResult = await getEmailGateway().sendEmail(
            { to: sendTo, subject: rendered.subject, text: rendered.text, html: rendered.html },
            { kind: 'invite_code', relatedType: 'invite_code', relatedId: row.code, triggeredBy: auth.session.userId },
          );
          emailStatus = emailStatusFromResult(sendResult);
        } catch (emailErr) {
          console.error('[invite-codes] POST: email send threw unexpectedly:', String(emailErr));
        }
      }

      return NextResponse.json(
        {
          code: row.code,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
          boundEmail: row.boundEmail,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          ...(emailStatus !== undefined ? { emailStatus } : {}),
        },
        { status: 201 },
      );
    } catch (err) {
      // PK collision — try again
      const msg = String(err);
      if (msg.includes('UNIQUE') || msg.includes('SQLITE_CONSTRAINT')) {
        continue;
      }
      console.error('[invite-codes] POST error:', msg);
      return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
  }

  console.error('[invite-codes] POST: code_generation_failed after 3 attempts');
  return NextResponse.json({ error: 'code_generation_failed' }, { status: 500 });
}
