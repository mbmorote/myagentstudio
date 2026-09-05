/**
 * lib/email/__tests__/templates.test.ts
 *
 * Pure rendering + escaping tests (Plan 14, §5.4). No I/O, no DB, no mocks needed.
 *
 * No keyword/phrase assertions on message wording beyond structural facts — this
 * repo's rule is that content validation is quantitative, never keyword-matching,
 * since copy will be reworded.
 */

import { describe, expect, it } from 'vitest';
import { escapeHtml, stripHeaderChars, appUrl } from '../templates/shared.js';
import { renderInviteCodeEmail } from '../templates/inviteCode.js';
import { renderAccessRequestNoticeEmail } from '../templates/accessRequestNotice.js';

const APP_BASE_URL = 'https://myagentstudio.dev';

describe('shared template helpers', () => {
  it('escapeHtml escapes <script>, &, and quotes', () => {
    const escaped = escapeHtml(`<script>alert("x")</script> & 'quoted'`);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).toContain('&amp;');
    expect(escaped).toContain('&quot;');
    expect(escaped).toContain('&#39;');
  });

  it('stripHeaderChars removes CR/LF', () => {
    const stripped = stripHeaderChars('Subject line\r\nBcc: evil@example.com');
    expect(stripped).not.toContain('\r');
    expect(stripped).not.toContain('\n');
  });

  it('appUrl joins base and path with exactly one slash', () => {
    expect(appUrl('https://myagentstudio.dev', '/signup')).toBe('https://myagentstudio.dev/signup');
    expect(appUrl('https://myagentstudio.dev/', '/signup')).toBe('https://myagentstudio.dev/signup');
    expect(appUrl('https://myagentstudio.dev', 'signup')).toBe('https://myagentstudio.dev/signup');
  });
});

describe('renderInviteCodeEmail', () => {
  it('subject has no CR/LF even if inputs did', () => {
    const { subject } = renderInviteCodeEmail({ code: 'ABCD-1234', expiresAt: null, appBaseUrl: APP_BASE_URL });
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('both text and html contain the code and the expiry', () => {
    const expiresAt = new Date('2026-09-10T12:00:00Z');
    const { text, html } = renderInviteCodeEmail({ code: 'ABCD-1234', expiresAt, appBaseUrl: APP_BASE_URL });
    expect(text).toContain('ABCD-1234');
    expect(html).toContain('ABCD-1234');
    expect(text).toContain(expiresAt.toUTCString());
    expect(html).toContain(expiresAt.toUTCString());
  });

  it('the signup link has no double slash', () => {
    const { html } = renderInviteCodeEmail({ code: 'ABCD-1234', expiresAt: null, appBaseUrl: 'https://myagentstudio.dev/' });
    expect(html).not.toContain('.dev//signup');
    expect(html).toContain('https://myagentstudio.dev/signup');
  });

  it('a code containing HTML-significant characters is escaped in html but literal in text', () => {
    const dangerousCode = '<b>ABCD</b>';
    const { text, html } = renderInviteCodeEmail({ code: dangerousCode, expiresAt: null, appBaseUrl: APP_BASE_URL });
    expect(text).toContain(dangerousCode); // literal in the text part
    expect(html).not.toContain('<b>ABCD</b>');
    expect(html).toContain('&lt;b&gt;ABCD&lt;/b&gt;');
  });
});

describe('renderAccessRequestNoticeEmail', () => {
  it('subject has no CR/LF', () => {
    const { subject } = renderAccessRequestNoticeEmail({
      requesterName: 'Alice',
      requesterEmail: 'alice@example.com',
      appBaseUrl: APP_BASE_URL,
    });
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('an untrusted requester name containing a script tag is escaped in html but literal in text', () => {
    const maliciousName = '<script>alert(1)</script>';
    const { text, html } = renderAccessRequestNoticeEmail({
      requesterName: maliciousName,
      requesterEmail: 'alice@example.com',
      appBaseUrl: APP_BASE_URL,
    });
    expect(text).toContain(maliciousName); // literal in the text part
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('both parts contain the requester email and a link back to settings', () => {
    const { text, html } = renderAccessRequestNoticeEmail({
      requesterName: 'Alice',
      requesterEmail: 'alice@example.com',
      appBaseUrl: APP_BASE_URL,
    });
    expect(text).toContain('alice@example.com');
    expect(html).toContain('alice@example.com');
    expect(html).toContain(`${APP_BASE_URL}/settings`);
  });
});
