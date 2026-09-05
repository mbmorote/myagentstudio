/**
 * scripts/test-live-access-request-notice.ts
 *
 * One-off live verification harness for the D4 admin-notification email
 * (Plan 14, §5.6) — SIMULATES an access request and sends the real notice.
 *
 * This is a simulation, not an end-to-end test of the real flow: D4 is not
 * yet wired into app/api/auth/request-access/route.ts (§6 step 9, optional,
 * still unbuilt). Submitting the real "Request access" form today creates an
 * access_request row and sends NOTHING — this script exercises the template +
 * gateway path directly, standing in for that not-yet-built trigger.
 *
 * USAGE (sends a REAL email through Resend — see test-live-email-send.ts's
 * header for the same "ask first" reasoning, which applies here too):
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/test-live-access-request-notice.ts
 *
 * Sends to ADMIN_NOTIFICATION_EMAIL (falls back to EMAIL_REPLY_TO if unset —
 * both are the same address in this deployment's current env).
 */

import { execSync } from 'child_process';

if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.APP_BASE_URL) {
  console.error('[live-notice] RESEND_API_KEY / EMAIL_FROM / APP_BASE_URL must all be set.');
  process.exit(1);
}

// Ensure this worktree's local DB is migrated (same as test-live-email-send.ts).
try {
  execSync('npx tsx lib/db/seed.ts', { stdio: 'inherit' });
} catch (err) {
  console.error('[live-notice] db:seed failed:', err);
  process.exit(1);
}

async function main() {
  const { getEmailGateway } = await import('../lib/email/gateway.js');
  const { renderAccessRequestNoticeEmail } = await import('../lib/email/templates/accessRequestNotice.js');
  const { getAppBaseUrl, getAdminNotificationEmail, getEmailReplyTo } = await import('../lib/env.js');

  const adminTo = getAdminNotificationEmail() ?? getEmailReplyTo();
  if (!adminTo) {
    console.error('[live-notice] Neither ADMIN_NOTIFICATION_EMAIL nor EMAIL_REPLY_TO is set — no recipient to send to.');
    process.exit(1);
  }

  const rendered = renderAccessRequestNoticeEmail({
    requesterName: 'Ada Lovelace (simulated)',
    requesterEmail: 'ada-simulated-request@example.com',
    appBaseUrl: getAppBaseUrl(),
  });

  console.log(`[live-notice] Sending a REAL simulated access-request notice to ${adminTo} via Resend...`);

  const result = await getEmailGateway().sendEmail(
    { to: adminTo, subject: rendered.subject, text: rendered.text, html: rendered.html },
    { kind: 'access_request_notice', relatedType: 'access_request', relatedId: 'SIMULATED-REQUEST', triggeredBy: null },
  );

  console.log('[live-notice] Result:', JSON.stringify(result, null, 2));

  if (result.ok) {
    console.log(`[live-notice] Sent. providerMessageId=${result.providerMessageId}. Check the inbox at ${adminTo} (and spam folder).`);
  } else {
    console.log(`[live-notice] NOT sent — reason=${result.reason}. See email_log row (logId=${result.logId}) for details.`);
  }

  process.exit(result.ok ? 0 : 1);
}

main();
