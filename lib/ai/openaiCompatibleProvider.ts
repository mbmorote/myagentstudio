import 'server-only';

/**
 * lib/ai/openaiCompatibleProvider.ts
 *
 * LLMProvider implementation for any OpenAI-compatible endpoint (the
 * .../chat/completions wire format, appended to a caller-supplied base URL
 * that already carries the vendor's version segment — see COMPLETIONS_PATH
 * below). Configured entirely by environment
 * variables — the file has no vendor identity. Pointing it at NVIDIA NIM
 * is three env vars, not a code change.
 *
 * Per-provider responsibility list (Plan 11 §4.4):
 *   - System prompt placement: OpenAI-compatible APIs take system as
 *     messages[0] with role:'system' (Anthropic takes it as a top-level param).
 *   - Stop-reason mapping: 'stop'→'end_turn', 'length'→'max_tokens',
 *     'tool_calls'→'tool_use', anything else→'other'. The 'length'→'max_tokens'
 *     mapping is the single highest-value line — without it Daedalus's and
 *     Prometheus's truncation guards silently stop firing.
 *   - Usage mapping: prompt_tokens/completion_tokens → inputTokens/outputTokens.
 *   - Output-token ceiling clamp: Daedalus requests maxTokens:32000 but many
 *     models cap far lower. The clamp (MAX_OUTPUT_TOKENS) avoids hard 400s and
 *     surfaces truncation through the existing max_tokens → DaedalusTruncatedError
 *     path instead of an opaque HTTP error.
 *   - stream(): accumulates SSE into a fully-resolved LlmResponse (same shape as
 *     complete()) — SSE transport avoids proxy/idle timeouts on 32k responses.
 *   - signal passthrough: fetch(..., { signal }) so a cancelled chat still
 *     cancels the upstream request. prometheus.ts depends on this.
 *   - Errors: non-2xx → throws with status + truncated body snippet, NEVER
 *     including request headers (constraint 7 — no credential in any log line).
 *
 * This file is the ONLY file permitted to construct requests against the
 * chat-completions path. Enforced by the architecture fitness function
 * (lib/ai/__tests__/architecture.test.ts).
 *
 * Does NOT: log, gate, or know about kind/agentId/settings/lib/db.
 */

import {
  getOpenAICompatibleApiKey,
  getOpenAICompatibleBaseUrl,
  getOpenAICompatibleModel,
} from '../env.js';
import { LlmProviderResponseError } from './provider.js';
import type { LLMProvider, LlmResponse, LlmStopReason, ResolvedLlmRequest } from './provider.js';

// ─────────────────────────────  Constants  ────────────────────────────────────

/**
 * Per-provider output-token ceiling. Many non-Anthropic models cap output
 * below 32000 and return a hard 400 for over-limit requests. Daedalus asks for
 * maxTokens:32000 — clamping here avoids the 400 and lets any truncation surface
 * through the standard stopReason:'max_tokens' → DaedalusTruncatedError path.
 *
 * Set this to the actual max your model supports if it is higher.
 */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * The URL path that uniquely identifies this transport, appended to
 * OPENAI_COMPATIBLE_BASE_URL as-is. The base URL is expected to already carry
 * the vendor's version segment, matching how every real OpenAI-compatible
 * vendor documents its own base_url (e.g. NVIDIA NIM:
 * https://integrate.api.nvidia.com/v1, OpenAI: https://api.openai.com/v1,
 * Groq: https://api.groq.com/openai/v1) — appending '/v1/chat/completions'
 * here on top of an already-versioned base URL doubles the segment into
 * '/v1/v1/chat/completions' and 404s (found live, 2026-08-20).
 *
 * Guarded by the architecture fitness function so this is the sole file
 * that ever constructs an OpenAI-compatible chat completion request.
 */
const COMPLETIONS_PATH = '/chat/completions';

// ─────────────────────────────  Helpers  ──────────────────────────────────────

function mapStopReason(raw: string | null | undefined): LlmStopReason {
  switch (raw) {
    case 'stop':       return 'end_turn';
    case 'length':     return 'max_tokens';   // ← highest-value line — must map correctly
    case 'tool_calls': return 'tool_use';
    default:           return 'other';         // content_filter, null, unknown
  }
}

function buildMessages(req: ResolvedLlmRequest): Array<{ role: string; content: string }> {
  const msgs: Array<{ role: string; content: string }> = [];
  // System prompt → role:'system' first message (OpenAI wire format; Anthropic
  // takes system as a separate top-level param — this is the key structural difference).
  if (req.system) {
    msgs.push({ role: 'system', content: req.system });
  }
  msgs.push(...req.messages);
  return msgs;
}

// ─────────────────────────────  Factory  ──────────────────────────────────────

/**
 * Creates and returns the OpenAI-compatible LLMProvider.
 * The provider object is safe to reuse across calls — it holds no connection
 * state (fetch is stateless). The instance cache in providerRegistry.ts keeps
 * one instance per process, same as anthropicProvider's SDK singleton pattern.
 */
export function createOpenAICompatibleProvider(): LLMProvider {
  return {
    id: 'openaiCompatible',

    defaultModel(): string {
      return getOpenAICompatibleModel();
    },

    async complete(req: ResolvedLlmRequest): Promise<LlmResponse> {
      const baseUrl = getOpenAICompatibleBaseUrl().replace(/\/$/, '');
      const url = `${baseUrl}${COMPLETIONS_PATH}`;
      const maxTokens = Math.min(req.maxTokens, MAX_OUTPUT_TOKENS);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // API key sent as Bearer token — never logged or included in error messages
          'Authorization': `Bearer ${getOpenAICompatibleApiKey()}`,
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: maxTokens,
          messages: buildMessages(req),
          stream: false,
        }),
        signal: req.signal,
      });

      if (!res.ok) {
        // Read a small body snippet for context. NEVER read or include request
        // headers — they carry the Authorization key (constraint 7 / DP#8).
        const snippet = await res.text().then((t) => t.slice(0, 400)).catch(() => '');
        throw new Error(
          `OpenAI-compatible provider HTTP ${res.status} from ${url}: ${snippet}`,
        );
      }

      const json = await res.json() as {
        choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      };

      const choice = json.choices?.[0];
      const text = choice?.message?.content ?? '';
      if (!text) {
        throw new LlmProviderResponseError('No content in OpenAI-compatible response');
      }

      return {
        text,
        stopReason: mapStopReason(choice?.finish_reason),
        model: json.model ?? req.model,
        usage: json.usage
          ? {
              inputTokens: json.usage.prompt_tokens ?? 0,
              outputTokens: json.usage.completion_tokens ?? 0,
            }
          : null,
      };
    },

    async stream(req: ResolvedLlmRequest): Promise<LlmResponse> {
      const baseUrl = getOpenAICompatibleBaseUrl().replace(/\/$/, '');
      const url = `${baseUrl}${COMPLETIONS_PATH}`;
      const maxTokens = Math.min(req.maxTokens, MAX_OUTPUT_TOKENS);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getOpenAICompatibleApiKey()}`,
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: maxTokens,
          messages: buildMessages(req),
          stream: true,
        }),
        signal: req.signal,
      });

      if (!res.ok) {
        const snippet = await res.text().then((t) => t.slice(0, 400)).catch(() => '');
        throw new Error(
          `OpenAI-compatible provider HTTP ${res.status} from ${url}: ${snippet}`,
        );
      }

      if (!res.body) {
        throw new LlmProviderResponseError('No response body for streaming request');
      }

      // Accumulate SSE chunks into a complete response. The streaming transport
      // avoids proxy/idle timeouts on large responses (Daedalus's 32k case) while
      // still returning the same fully-resolved LlmResponse shape as complete().
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let finishReason: string | null = null;
      let model: string | undefined;
      let promptTokens: number | undefined;
      let completionTokens: number | undefined;
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep the last (possibly incomplete) line in the buffer
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') break;

            let parsed: {
              choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
              model?: string;
              usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
            };
            try {
              parsed = JSON.parse(data);
            } catch {
              continue; // malformed SSE line — skip
            }

            if (parsed.model && !model) model = parsed.model;

            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) accumulated += delta;

            const fr = parsed.choices?.[0]?.finish_reason;
            if (fr !== undefined && fr !== null) finishReason = fr;

            // Some providers (e.g. NVIDIA NIM) send usage in the final chunk
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens;
              completionTokens = parsed.usage.completion_tokens;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!accumulated) {
        throw new LlmProviderResponseError(
          'No content in OpenAI-compatible streaming response',
        );
      }

      return {
        text: accumulated,
        stopReason: mapStopReason(finishReason),
        model: model ?? req.model,
        usage: promptTokens !== undefined && completionTokens !== undefined
          ? { inputTokens: promptTokens, outputTokens: completionTokens }
          : null,
      };
    },
  };
}
