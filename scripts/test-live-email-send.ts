/**
 * scripts/test-live-email-send.ts
 *
 * One-off live verification harness for the Plan 14 email gateway (§5.6).
 *
 * USAGE (sends a REAL email through Resend — costs nothing on the free tier,
 * but spends a little of your domain's sending reputation; run only when you
 * mean to):
 *   npx tsx --env-file=.env.local scripts/test-live-email-send.ts you@example.com
 *
 * DO NOT run this without an explicit decision to make a real send — this is
 * exactly the "ask first" case CLAUDE.md standing rule 2 (no real billed/
 * reputation-spending API call without asking) and Plan 14 constraint 10
 * describe, applied to email.
 *
 * What it does:
 *   1. Confirms RESEND_API_KEY / EMAIL_FROM / APP_BASE_URL are all set.
 *   2. Migrates this worktree's own local myagent.db if needed (a fresh
 *      worktree has no email_log table yet).
 *   3. Renders the real invite-code template and sends it through the real
 *      gateway (getEmailGateway().sendEmail(...)) — the same code path
 *      production uses, no test doubles, no bypassed gates (kill-switch and
 *      hourly cap both apply exactly as they would from a real route).
 *   4. Prints the EmailSendResult.
 *
 * Uses THIS worktree's own myagent.db — never the main checkout's.
 */

import { execSync } from 'child_process';

const to = process.argv[2];
if (!to) {
  console.error('Usage: npx tsx --env-file=.env.local scripts/test-live-email-send.ts you@example.com');
  process.exit(1);
}

if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.APP_BASE_URL) {
  console.error('[live-email] RESEND_API_KEY / EMAIL_FROM / APP_BASE_URL must all be set.');
  console.error('Run with: npx tsx --env-file=.env.local scripts/test-live-email-send.ts you@example.com');
  process.exit(1);
}

// Ensure this worktree's local DB is migrated (a fresh worktree's myagent.db
// may not have the email_log table yet) — same step `npm run db:seed` performs.
try {
  execSync('npx tsx lib/db/seed.ts', { stdio: 'inherit' });
} catch (err) {
  console.error('[live-email] db:seed failed:', err);
  process.exit(1);
}

async function main() {
  const { getEmailGateway } = await import('../lib/email/gateway.js');
  const { renderInviteCodeEmail } = await import('../lib/email/templates/inviteCode.js');
  const { getAppBaseUrl } = await import('../lib/env.js');

  const TEST_CODE = 'TEST-0000-LIVE-CHECK';

  const rendered = renderInviteCodeEmail({
    code: TEST_CODE,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    appBaseUrl: getAppBaseUrl(),
  });

  console.log(`[live-email] Sending a REAL test email to ${to} via Resend...`);

  const result = await getEmailGateway().sendEmail(
    { to: to as string, subject: rendered.subject, text: rendered.text, html: rendered.html },
    { kind: 'invite_code', relatedType: 'invite_code', relatedId: TEST_CODE, triggeredBy: null },
  );

  console.log('[live-email] Result:', JSON.stringify(result, null, 2));

  if (result.ok) {
    console.log(`[live-email] Sent. providerMessageId=${result.providerMessageId}. Check the inbox at ${to} (and spam folder).`);
  } else {
    console.log(`[live-email] NOT sent — reason=${result.reason}. See email_log row (logId=${result.logId}) for details.`);
  }

  process.exit(result.ok ? 0 : 1);
}

main();
