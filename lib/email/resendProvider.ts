import 'server-only';

/**
 * lib/email/resendProvider.ts
 *
 * The one email transport implementation — plain fetch, zero new npm dependency.
 * Sole owner of the string 'api.resend.com' (fitness function, §4.10) — a second
 * provider must never re-open this transport from anywhere else.
 *
 * Reads its env vars at CALL time, never at module load — the same rule
 * getAnthropicApiKey() follows, so a deployment with no email configured still
 * boots and still runs everything else.
 */

import { getResendApiKey, getEmailFrom } from '../env.js';
import { EmailProviderError } from './provider.js';
import type { EmailProvider, EmailMessage, ProviderSendResult } from './provider.js';

const RESEND_API_URL = 'https://api.resend.com/emails';

// Never let an unbounded upstream error body reach a log line or a caller —
// same ≤2000-char cap the log column itself enforces (constraint 7).
const MAX_ERROR_BODY_LENGTH = 2000;

export function createResendProvider(): EmailProvider {
  return {
    id: 'resend',

    async send(msg: EmailMessage, opts: { signal: AbortSignal }): Promise<ProviderSendResult> {
      const apiKey = getResendApiKey();
      const from = getEmailFrom();

      const body: Record<string, unknown> = {
        from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
      };
      if (msg.html) body.html = msg.html;
      if (msg.replyTo) body.reply_to = msg.replyTo;

      // Network/abort errors (including the caller's AbortSignal.timeout firing)
      // propagate with their original identity unchanged — the gateway classifies
      // a timeout distinctly from a provider rejection using err.name.
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!response.ok) {
        // Never include request headers (constraint 7) — only the response
        // body, truncated, and never the Authorization header's value.
        const rawBody = await response.text().catch(() => '');
        const truncated = rawBody.slice(0, MAX_ERROR_BODY_LENGTH);
        throw new EmailProviderError(
          `Resend responded ${response.status}: ${truncated}`,
          response.status,
        );
      }

      const json = (await response.json().catch(() => null)) as { id?: string } | null;
      return { providerMessageId: json?.id ?? null };
    },
  };
}
