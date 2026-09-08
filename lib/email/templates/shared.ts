/**
 * lib/email/templates/shared.ts
 *
 * Shared helpers for every email template (Plan 14, §4.7). Pure functions, no
 * I/O, no lib/db or lib/env import (fitness function, §4.10 — templates stay
 * pure; values are always passed in by the caller).
 */

/** Shape every template returns. Text is always present; HTML is additive (D5). */
export type RenderedEmail = { subject: string; text: string; html: string };

/** Escapes a value for safe interpolation into an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strips CR/LF from a value before it's used as an email subject (header-injection guard). */
export function stripHeaderChars(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

/** Joins a base URL and a path with exactly one slash between them — no double slash. */
export function appUrl(appBaseUrl: string, path: string): string {
  const base = appBaseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * Wraps inner HTML in a minimal, inline-styled shell shared by every template —
 * one content area and a footer. No tracking, no unsubscribe link (constraint 8
 * — every message in scope is transactional).
 */
export function htmlShell(bodyHtml: string, footerNote: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;">
            <tr><td>${bodyHtml}</td></tr>
            <tr><td style="padding-top:24px;border-top:1px solid #e5e5e5;margin-top:24px;color:#888888;font-size:12px;">${escapeHtml(footerNote)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
