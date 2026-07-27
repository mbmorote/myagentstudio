import 'server-only';

/**
 * lib/ai/client.ts
 *
 * @anthropic-ai/sdk singleton. Server-only (import 'server-only' at the top).
 * All AI callers obtain the client through getClient() — never instantiate directly.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicApiKey, getAnthropicModel } from '../env.js';

let _client: Anthropic | null = null;

/**
 * Returns the shared Anthropic client singleton.
 * Initialised lazily on first call so that import-time errors are avoided.
 */
export function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: getAnthropicApiKey() });
  }
  return _client;
}

/**
 * Returns the configured model ID (from ANTHROPIC_MODEL env, defaulting to claude-opus-4-8).
 */
export function getModel(): string {
  return getAnthropicModel();
}
