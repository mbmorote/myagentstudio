/**
 * lib/email/templates/inviteCode.ts
 *
 * The invite-code email — the one wired trigger this plan ships (§4.8). Pure
 * function, no I/O: someone offered you a spot, here is the code, here is
 * where to enter it, here is when it expires. Nothing else — no marketing,
 * no product tour (§4.7).
 */

import { escapeHtml, stripHeaderChars, appUrl, htmlShell } from './shared.js';
import type { RenderedEmail } from './shared.js';

export type RenderInviteCodeEmailInput = {
  code: string;
  /** null = never expires (a code created via the admin's plain "+ Generate code"). */
  expiresAt: Date | null;
  appBaseUrl: string;
};

const DEPLOYMENT_NAME = 'MyAgentStudio';

export function renderInviteCodeEmail(input: RenderInviteCodeEmailInput): RenderedEmail {
  const signupUrl = appUrl(input.appBaseUrl, '/signup');
  const expiryLine = input.expiresAt
    ? `It expires at ${input.expiresAt.toUTCString()} and can be used once.`
    : 'It can be used once and does not expire.';

  const subject = stripHeaderChars(`Your ${DEPLOYMENT_NAME} invite code`);

  const text = [
    `Someone offered you a spot on ${DEPLOYMENT_NAME}.`,
    '',
    `Your invite code: ${input.code}`,
    '',
    `Enter it here: ${signupUrl}`,
    '',
    expiryLine,
  ].join('\n');

  const bodyHtml = `
    <h2 style="margin:0 0 16px;color:#111111;">Someone offered you a spot on ${escapeHtml(DEPLOYMENT_NAME)}</h2>
    <p style="margin:0 0 16px;color:#333333;font-size:14px;">Your invite code:</p>
    <p style="margin:0 0 24px;font-family:monospace;font-size:20px;letter-spacing:1px;background:#f0f0f0;padding:12px 16px;border-radius:6px;color:#111111;">${escapeHtml(input.code)}</p>
    <p style="margin:0 0 24px;"><a href="${escapeHtml(signupUrl)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;">Enter your code</a></p>
    <p style="margin:0;color:#666666;font-size:13px;">${escapeHtml(expiryLine)}</p>
  `;

  const html = htmlShell(
    bodyHtml,
    `You're receiving this because someone requested access to ${DEPLOYMENT_NAME}. No action is needed if this wasn't you.`,
  );

  return { subject, text, html };
}
