/**
 * lib/email/__tests__/resendProvider.test.ts
 *
 * Transport unit tests against a mocked global fetch (Plan 14, §5.2). No real
 * network call — api.resend.com is never actually reached.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResendProvider } from '../resendProvider.js';
import { EmailProviderError } from '../provider.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-key-abc123';
  process.env.EMAIL_FROM = 'MyAgentStudio <noreply@myagentstudio.dev>';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

function stubFetch(impl: typeof fetch) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('resendProvider', () => {
  it('sends the expected request shape', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    stubFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ id: 'msg_abc' }), { status: 200 });
    });

    const provider = createResendProvider();
    const result = await provider.send(
      { to: 'alice@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>', replyTo: 'support@myagentstudio.dev' },
      { signal: new AbortController().signal },
    );

    expect(capturedUrl).toBe('https://api.resend.com/emails');
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key-abc123');

    const body = JSON.parse(String(capturedInit?.body));
    expect(body.to).toEqual(['alice@example.com']); // single-element array, never a bare string
    expect(body.from).toBe('MyAgentStudio <noreply@myagentstudio.dev>');
    expect(body.subject).toBe('Hi');
    expect(body.text).toBe('Hello');
    expect(body.html).toBe('<p>Hello</p>');
    expect(body.reply_to).toBe('support@myagentstudio.dev');

    expect(result.providerMessageId).toBe('msg_abc');
  });

  it('omits reply_to when unset', async () => {
    let capturedBody: string | undefined;
    stubFetch(async (_url, init) => {
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
    });

    const provider = createResendProvider();
    await provider.send(
      { to: 'alice@example.com', subject: 'Hi', text: 'Hello' },
      { signal: new AbortController().signal },
    );

    const body = JSON.parse(capturedBody!);
    expect('reply_to' in body).toBe(false);
  });

  it('a 2xx response with no id returns providerMessageId: null, not a throw', async () => {
    stubFetch(async () => new Response(JSON.stringify({}), { status: 200 }));

    const provider = createResendProvider();
    const result = await provider.send(
      { to: 'alice@example.com', subject: 'Hi', text: 'Hello' },
      { signal: new AbortController().signal },
    );
    expect(result.providerMessageId).toBeNull();
  });

  it('a non-2xx response throws EmailProviderError with no key or Authorization leak', async () => {
    stubFetch(async () => new Response('{"message":"Invalid API key"}', { status: 401 }));

    const provider = createResendProvider();
    let thrown: unknown;
    try {
      await provider.send(
        { to: 'alice@example.com', subject: 'Hi', text: 'Hello' },
        { signal: new AbortController().signal },
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(EmailProviderError);
    const err = thrown as EmailProviderError;
    expect(err.status).toBe(401);
    // Constraint 7 — the one test that guards a credential leak.
    expect(err.message).not.toContain('test-key-abc123');
    expect(err.message).not.toContain('Authorization');
  });

  it('an aborted signal propagates the original AbortError identity', async () => {
    const abortErr = new Error('This operation was aborted');
    abortErr.name = 'AbortError';
    stubFetch(async () => { throw abortErr; });

    const provider = createResendProvider();
    let thrown: unknown;
    try {
      await provider.send(
        { to: 'alice@example.com', subject: 'Hi', text: 'Hello' },
        { signal: new AbortController().signal },
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(abortErr); // identity preserved
    expect((thrown as Error).name).toBe('AbortError');
  });
});
