/**
 * lib/email/provider.ts
 *
 * Provider-agnostic contract for email transport (Plan 14, §4.2).
 *
 * Rules:
 *   - Types, interface, and the one shared error class only. No provider-specific
 *     imports, no lib/db imports (fitness function, §4.10).
 *   - One recipient per send, no cc/bcc — every message in scope is addressed to
 *     exactly one person; a multi-recipient shape is the one that leaks one
 *     user's address to another by accident. A future bulk need can add a
 *     field; it cannot be un-leaked.
 */

export type EmailMessage = {
  to: string;
  subject: string;            // CR/LF stripped by the template layer (stripHeaderChars)
  text: string;                // always present
  html?: string;                // D5
  replyTo?: string | null;
  /** Deterministic key (e.g. "invite:<code>") where the provider supports one — §4.7. */
  idempotencyKey?: string;
};

export type ProviderSendResult = { providerMessageId: string | null };

export interface EmailProvider {
  /** Stable identifier for this provider. Written to email_log.provider. */
  readonly id: string;
  send(msg: EmailMessage, opts: { signal: AbortSignal }): Promise<ProviderSendResult>;
}

/**
 * Thrown by a provider when the transport call fails (a non-2xx response, most
 * commonly). Lives here — not in a specific provider file — so a second
 * provider never has to import the first one just to share this type.
 *
 * Constraint 7: the message MUST NEVER contain the API key, an Authorization
 * header value, or any other request header.
 */
export class EmailProviderError extends Error {
  readonly status: number | null;
  override name = 'EmailProviderError';

  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}
