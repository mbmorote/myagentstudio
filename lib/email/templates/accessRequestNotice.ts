/**
 * lib/email/templates/accessRequestNotice.ts
 *
 * Admin-facing "someone requested access" notice (D4). Pure function, no I/O.
 *
 * Interpolates a VISITOR-SUPPLIED name — untrusted input in an outbound message
 * — so escapeHtml() on requesterName/requesterEmail is not optional here (§4.7),
 * unlike inviteCode.ts where the only interpolated value is the app's own code.
 */

import { escapeHtml, stripHeaderChars, appUrl, htmlShell } from './shared.js';
import type { RenderedEmail } from './shared.js';

export type RenderAccessRequestNoticeInput = {
  requesterName: string;
  requesterEmail: string;
  appBaseUrl: string;
};

const DEPLOYMENT_NAME = 'MyAgentStudio';

export function renderAccessRequestNoticeEmail(input: RenderAccessRequestNoticeInput): RenderedEmail {
  const settingsUrl = appUrl(input.appBaseUrl, '/settings');
  const subject = stripHeaderChars(`New ${DEPLOYMENT_NAME} access request`);

  const text = [
    `${input.requesterName} <${input.requesterEmail}> requested access to ${DEPLOYMENT_NAME}.`,
    '',
    `Review it here: ${settingsUrl}`,
  ].join('\n');

  const bodyHtml = `
    <h2 style="margin:0 0 16px;color:#111111;">New access request</h2>
    <p style="margin:0 0 16px;color:#333333;font-size:14px;">
      <strong>${escapeHtml(input.requesterName)}</strong> (${escapeHtml(input.requesterEmail)})
      requested access to ${escapeHtml(DEPLOYMENT_NAME)}.
    </p>
    <p style="margin:0;"><a href="${escapeHtml(settingsUrl)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;">Review in Settings</a></p>
  `;

  const html = htmlShell(
    bodyHtml,
    `You're receiving this because you're the admin of this ${DEPLOYMENT_NAME} deployment.`,
  );

  return { subject, text, html };
}
