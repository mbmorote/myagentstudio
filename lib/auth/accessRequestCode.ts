import 'server-only';

/**
 * lib/auth/accessRequestCode.ts
 *
 * Issues the invite code for an access request ("Request access" on the signup form) and
 * emails it. Shared by the two paths that approve a request:
 *   - the admin's "Generate code" button (app/api/settings/access-requests/[id]/generate-code)
 *   - auto-approval at submission time (app/api/auth/request-access), active while the user
 *     count is below the `autoApproveAccessRequestsBelowUsers` setting
 *
 * The code is bound to the requester's email (only that address can redeem it) and expires
 * after the `accessRequestCodeExpiryHours` setting.
 */

import { generateInviteCode } from './inviteCode.js';
import { REFERRAL_SOURCE_LABELS, type ReferralSource } from './referralSource.js';
import { getAccessRequestCodeExpiryHours } from '../settings.js';
import { createInviteCode, type InviteCodeRow } from '../db/repository/index.js';
import { getEmailGateway, emailStatusFromResult } from '../email/gateway.js';
import { renderInviteCodeEmail } from '../email/templates/inviteCode.js';
import { isEmailConfigured, getAppBaseUrl } from '../env.js';

export type AccessRequestCodeInput = {
  name: string;
  email: string; // already normalized (trim + lowercase)
  referralSource: ReferralSource | null;
};

export type InviteEmailStatus = ReturnType<typeof emailStatusFromResult>;

/**
 * Creates the bound, expiring invite code. Retries up to 3 times on a code collision
 * (same pattern as /api/settings/invite-codes), then throws. Any other DB error throws
 * immediately.
 */
export function createAccessRequestInviteCode(input: AccessRequestCodeInput): InviteCodeRow {
  const expiresAt = new Date(Date.now() + getAccessRequestCodeExpiryHours() * 60 * 60 * 1000);
  const note = input.referralSource
    ? `${input.name} · via ${REFERRAL_SOURCE_LABELS[input.referralSource]}`
    : input.name;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return createInviteCode({
        code: generateInviteCode(),
        note,
        createdBy: null, // self-requested — no admin authored this one
        boundEmail: input.email,
        expiresAt,
      });
    } catch (err) {
      const msg = String(err);
      if (msg.includes('UNIQUE') || msg.includes('SQLITE_CONSTRAINT')) continue;
      throw err;
    }
  }
  throw new Error('code_generation_failed');
}

/**
 * Emails an already-created code to its bound address. Never throws — the code is already
 * committed by the time this runs, so an email problem must never undo or fail that; any
 * unexpected error degrades to 'failed'.
 *
 * @param triggeredBy the admin's userId, or null for an auto-approved request.
 */
export async function sendAccessRequestInviteEmail(
  row: InviteCodeRow,
  triggeredBy: string | null,
): Promise<InviteEmailStatus> {
  try {
    // appBaseUrl is only ever '' on the not-configured path — the gateway returns before
    // ever touching the message content in that case, so the placeholder is never sent.
    const appBaseUrl = isEmailConfigured() ? getAppBaseUrl() : '';
    const rendered = renderInviteCodeEmail({ code: row.code, expiresAt: row.expiresAt, appBaseUrl });
    const sendResult = await getEmailGateway().sendEmail(
      { to: row.boundEmail!, subject: rendered.subject, text: rendered.text, html: rendered.html },
      { kind: 'invite_code', relatedType: 'invite_code', relatedId: row.code, triggeredBy },
    );
    return emailStatusFromResult(sendResult);
  } catch (err) {
    console.error('[access-request-code] email send threw unexpectedly:', String(err));
    return 'failed';
  }
}
