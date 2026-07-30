import 'server-only';

/**
 * lib/ai/anthropicProvider.ts
 *
 * The ONLY file in the repo that imports @anthropic-ai/sdk (§3.2, constraint 1).
 * Enforced by lib/ai/__tests__/architecture.test.ts.
 *
 * createAnthropicProvider() returns an LLMProvider. Internally keeps a lazy
 * SDK singleton so connection-pool and rate-limit behavior is unchanged from
 * the old client.ts pattern — one Anthropic instance per process.
 *
 * Responsibilities:
 *   - Lazy SDK singleton (moved verbatim from client.ts — risk 8)
 *   - complete() → sdk.messages.create() with the resolved request
 *   - stream()   → sdk.messages.stream() + finalMessage()
 *   - Map Anthropic-specific stop_reason → LlmStopReason
 *   - Map usage → LlmUsage | null
 *   - No-text-block is a provider-level error (moved down from each caller)
 *   - import 'server-only' stays at the top
 *
 * Does NOT: log, gate, or know about kind/agentId/settings.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicApiKey, getAnthropicModel } from '../env.js';
import type { LLMProvider, LlmResponse, LlmStopReason, ResolvedLlmRequest } from './provider.js';

// ─────────────────────────────  Error  ────────────────────────────────────────

/** Thrown when the provider receives a structurally unexpected response. */
export class LlmProviderResponseError extends Error {
  constructor(reason: string) {
    super(`LLM provider response error: ${reason}`);
    this.name = 'LlmProviderResponseError';
  }
}

// ─────────────────────────────  Factory  ──────────────────────────────────────

/**
 * Creates and returns the Anthropic LLMProvider implementation.
 * Maintains one lazy SDK singleton internally.
 *
 * Call `createAnthropicProvider()` once at gateway init; the returned object is
 * safe to reuse across all calls (same connection pool).
 */
export function createAnthropicProvider(): LLMProvider {
  // Module-private lazy singleton — same pattern as client.ts (risk 8).
  let _sdk: Anthropic | null = null;

  function getSdk(): Anthropic {
    if (!_sdk) {
      _sdk = new Anthropic({ apiKey: getAnthropicApiKey() });
    }
    return _sdk;
  }

  function mapStopReason(raw: string | null | undefined): LlmStopReason {
    switch (raw) {
      case 'end_turn':      return 'end_turn';
      case 'max_tokens':    return 'max_tokens';
      case 'stop_sequence': return 'stop_sequence';
      case 'tool_use':      return 'tool_use';
      default:              return 'other';
    }
  }

  return {
    id: 'anthropic',

    defaultModel(): string {
      return getAnthropicModel();
    },

    async complete(req: ResolvedLlmRequest): Promise<LlmResponse> {
      const sdk = getSdk();
      const response = await sdk.messages.create(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages,
        },
        { signal: req.signal },
      );

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new LlmProviderResponseError('No text block in Anthropic response');
      }

      return {
        text: textBlock.text,
        stopReason: mapStopReason(response.stop_reason),
        model: response.model,
        usage: response.usage
          ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
          : null,
      };
    },

    async stream(req: ResolvedLlmRequest): Promise<LlmResponse> {
      const sdk = getSdk();
      const stream = sdk.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages,
        },
        { signal: req.signal },
      );

      const finalMessage = await stream.finalMessage();

      const textBlock = finalMessage.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new LlmProviderResponseError('No text block in Anthropic streaming response');
      }

      return {
        text: textBlock.text,
        stopReason: mapStopReason(finalMessage.stop_reason),
        model: finalMessage.model,
        usage: finalMessage.usage
          ? {
              inputTokens: finalMessage.usage.input_tokens,
              outputTokens: finalMessage.usage.output_tokens,
            }
          : null,
      };
    },
  };
}
