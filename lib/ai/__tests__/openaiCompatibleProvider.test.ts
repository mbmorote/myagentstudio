/**
 * lib/ai/__tests__/openaiCompatibleProvider.test.ts
 *
 * Unit tests for the OpenAI-compatible provider (Plan 11 §5.1).
 * All network calls are intercepted via vi.stubGlobal('fetch', ...) — zero cost,
 * no real NVIDIA or OpenAI API calls are made.
 *
 * Assertions:
 *   - System prompt placed as role:'system' messages[0]
 *   - Messages forwarded in order after the system message
 *   - model and max_tokens forwarded; max_tokens clamped to MAX_OUTPUT_TOKENS (4096)
 *   - Each stop-reason value maps to the correct LlmStopReason
 *   - Unknown stop reason → 'other'
 *   - Usage mapped; usage absent → null
 *   - Empty/missing content → LlmProviderResponseError
 *   - Non-2xx → throws; error message must NOT contain the API key (constraint 7)
 *   - AbortError propagates and preserves identity (prometheus.ts depends on this)
 *   - stream() accumulates SSE chunks into the same shape as complete()
 *   - stream() empty accumulation → LlmProviderResponseError
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProvider } from '../openaiCompatibleProvider.js';
import { LlmProviderResponseError } from '../provider.js';
import type { LLMProvider, ResolvedLlmRequest } from '../provider.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE_REQ: ResolvedLlmRequest = {
  system: 'You are a test assistant.',
  messages: [{ role: 'user', content: 'Hello' }],
  maxTokens: 512,
  model: 'test-model',
};

/** Build a Response-like object for a successful non-streaming reply. */
function makeOkResponse(overrides: {
  content?: string;
  finish_reason?: string | null;
  model?: string;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}): Response {
  const body = {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: overrides.model ?? 'test-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: overrides.content ?? 'Test response' },
        // !== undefined (not ??): a test case passing finish_reason: null must keep
    // that null, not fall back to 'stop' — ?? treats null and undefined alike.
    finish_reason: overrides.finish_reason !== undefined ? overrides.finish_reason : 'stop',
      },
    ],
    usage: overrides.usage !== undefined
      ? overrides.usage
      : { prompt_tokens: 10, completion_tokens: 20 },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Build a ReadableStream of SSE lines for streaming tests.
 * Each content string becomes one 'content' delta chunk, then [DONE].
 */
function makeSseStream(
  chunks: string[],
  finishReason = 'stop',
  model = 'stream-model',
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        const chunk = JSON.stringify({
          choices: [{ delta: { content: c }, finish_reason: null }],
          model,
        });
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }
      // Final chunk with finish_reason and optional usage
      const finalChunk = JSON.stringify({
        choices: [{ delta: {}, finish_reason: finishReason }],
        model,
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      });
      controller.enqueue(encoder.encode(`data: ${finalChunk}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

let provider: LLMProvider;

beforeEach(() => {
  vi.stubEnv('OPENAI_COMPATIBLE_API_KEY', 'test-api-key-do-not-log');
  vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', 'https://api.test.example.com');
  vi.stubEnv('OPENAI_COMPATIBLE_MODEL', 'test-model');
  provider = createOpenAICompatibleProvider();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ── complete() ────────────────────────────────────────────────────────────────

describe('complete()', () => {
  it('places system prompt as role:system first message', async () => {
    let captured: unknown;
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => {
      captured = JSON.parse(init.body as string);
      return Promise.resolve(makeOkResponse({}));
    }));

    await provider.complete(BASE_REQ);

    const body = captured as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a test assistant.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('forwards model and clamps max_tokens to 4096', async () => {
    let captured: unknown;
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => {
      captured = JSON.parse(init.body as string);
      return Promise.resolve(makeOkResponse({}));
    }));

    await provider.complete({ ...BASE_REQ, maxTokens: 99999, model: 'my-model' });

    const body = captured as { model: string; max_tokens: number };
    expect(body.model).toBe('my-model');
    expect(body.max_tokens).toBe(4096); // MAX_OUTPUT_TOKENS clamp
  });

  it('request under 4096 is not clamped upward', async () => {
    let captured: unknown;
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => {
      captured = JSON.parse(init.body as string);
      return Promise.resolve(makeOkResponse({}));
    }));

    await provider.complete({ ...BASE_REQ, maxTokens: 512 });
    const body = captured as { max_tokens: number };
    expect(body.max_tokens).toBe(512);
  });

  it.each([
    ['stop',           'end_turn'],
    ['length',         'max_tokens'],  // highest-value mapping — drives truncation guards
    ['tool_calls',     'tool_use'],
    ['content_filter', 'other'],
    [null,             'other'],
    ['unknown_value',  'other'],
  ] as const)('stop-reason %s → %s', async (raw, expected) => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(makeOkResponse({ finish_reason: raw as string | null })),
    ));
    const result = await provider.complete(BASE_REQ);
    expect(result.stopReason).toBe(expected);
  });

  it('maps usage fields', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(makeOkResponse({ usage: { prompt_tokens: 42, completion_tokens: 88 } })),
    ));
    const result = await provider.complete(BASE_REQ);
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 88 });
  });

  it('usage absent → null', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(makeOkResponse({ usage: null })),
    ));
    const result = await provider.complete(BASE_REQ);
    expect(result.usage).toBeNull();
  });

  it('empty content → LlmProviderResponseError', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(makeOkResponse({ content: '' })),
    ));
    await expect(provider.complete(BASE_REQ)).rejects.toBeInstanceOf(LlmProviderResponseError);
  });

  it('non-2xx → throws; error message does NOT contain the API key', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response('Unauthorized — invalid key', { status: 401 })),
    ));
    let thrown: unknown;
    try {
      await provider.complete(BASE_REQ);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    // The API key must never appear in any error message (constraint 7 — Design Principle #8)
    expect((thrown as Error).message).not.toContain('test-api-key-do-not-log');
    expect((thrown as Error).message).toContain('401');
  });

  it('AbortError propagates and preserves identity', async () => {
    const controller = new AbortController();
    const abortErr = new DOMException('Aborted', 'AbortError');

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(abortErr)));

    let thrown: unknown;
    try {
      await provider.complete({ ...BASE_REQ, signal: controller.signal });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBe(abortErr);           // identity preserved
    expect((thrown as DOMException).name).toBe('AbortError');
  });

  it('passes signal through to fetch', async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | null | undefined;

    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return Promise.resolve(makeOkResponse({}));
    }));

    await provider.complete({ ...BASE_REQ, signal: controller.signal });
    expect(capturedSignal).toBe(controller.signal);
  });
});

// ── stream() ──────────────────────────────────────────────────────────────────

describe('stream()', () => {
  it('accumulates multi-chunk SSE into same shape as complete()', async () => {
    const stream = makeSseStream(['Hello', ' world', '!'], 'stop', 'stream-model');

    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })),
    ));

    const result = await provider.stream(BASE_REQ);
    expect(result.text).toBe('Hello world!');
    expect(result.stopReason).toBe('end_turn');  // 'stop' → 'end_turn'
    expect(result.model).toBe('stream-model');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 10 });
  });

  it('length finish_reason maps to max_tokens', async () => {
    const stream = makeSseStream(['truncated content'], 'length');
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(stream, { status: 200 })),
    ));
    const result = await provider.stream(BASE_REQ);
    expect(result.stopReason).toBe('max_tokens');
  });

  it('empty accumulated content → LlmProviderResponseError', async () => {
    // A stream with no content deltas at all
    const encoder = new TextEncoder();
    const emptyStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const final = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        ctrl.enqueue(encoder.encode(`data: ${final}\n\n`));
        ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
        ctrl.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(emptyStream, { status: 200 })),
    ));

    await expect(provider.stream(BASE_REQ)).rejects.toBeInstanceOf(LlmProviderResponseError);
  });

  it('non-2xx on stream → throws before reading body', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response('Service unavailable', { status: 503 })),
    ));
    await expect(provider.stream(BASE_REQ)).rejects.toThrow('503');
  });
});
