import 'server-only';

/**
 * lib/ai/providerRegistry.ts
 *
 * The ONLY file that knows both providers exist. Provides:
 *   - PROVIDER_IDS — the canonical list of valid provider id strings.
 *   - isProviderConfigured(id) — env-var check without instantiating anything.
 *   - getProviderById(id) — lazy per-id instance cache (one instance per process,
 *     same pattern as anthropicProvider's SDK singleton).
 *   - resolveActiveProvider() — reads the 'llmProvider' setting fresh on every
 *     call (no cache), returns the corresponding provider instance. Used by
 *     getGateway() so provider selection takes effect on the next call without
 *     a restart (Plan 11 constraint 4 / Plan 04 constraint 6).
 *
 * Imports from lib/db/ are NOT permitted here — that boundary belongs to
 * gateway.ts only (same constraint as every other lib/ai file). The setting
 * read is done via lib/settings.ts → lib/db/repository/settings.ts, not
 * directly against the DB from this file.
 */

import { isAnthropicConfigured, isOpenAICompatibleConfigured } from '../env.js';
import { getActiveProviderId } from '../settings.js';
import { createAnthropicProvider } from './anthropicProvider.js';
import { createOpenAICompatibleProvider } from './openaiCompatibleProvider.js';
import type { LLMProvider } from './provider.js';

// ─────────────────────────────  Registry  ─────────────────────────────────────

export const PROVIDER_IDS = ['anthropic', 'openaiCompatible'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

// Per-id instance cache — one provider object per id per process.
// Connection pooling and rate-limit state are preserved on the provider object,
// same as anthropicProvider's lazy SDK singleton.
const _instances = new Map<ProviderId, LLMProvider>();

/**
 * Returns true when the given provider id has the minimum required env vars set.
 * Does not instantiate the provider or make any network call.
 *
 * anthropic:           ANTHROPIC_API_KEY must be set.
 * openaiCompatible:    OPENAI_COMPATIBLE_API_KEY + OPENAI_COMPATIBLE_BASE_URL must be set.
 * unknown id:          false.
 */
export function isProviderConfigured(id: string): boolean {
  switch (id) {
    case 'anthropic':         return isAnthropicConfigured();
    case 'openaiCompatible':  return isOpenAICompatibleConfigured();
    default:                  return false;
  }
}

/**
 * Returns the LLMProvider instance for the given id.
 * Instantiates on first call; subsequent calls return the cached instance.
 *
 * Throws if:
 *   - id is not in PROVIDER_IDS.
 *   - The provider's required env vars are not set (guards against selecting an
 *     unconfigured provider at runtime — the PATCH route also enforces this at
 *     write time, so under normal operation this throw is a belt-and-braces check).
 */
export function getProviderById(id: string): LLMProvider {
  const knownId = PROVIDER_IDS.find((p) => p === id) as ProviderId | undefined;
  if (!knownId) {
    throw new Error(`[provider-registry] Unknown provider id: "${id}"`);
  }

  if (!isProviderConfigured(knownId)) {
    throw new Error(
      `[provider-registry] Provider "${knownId}" is not configured. ` +
      `Set the required env vars and restart the dev server.`,
    );
  }

  if (!_instances.has(knownId)) {
    switch (knownId) {
      case 'anthropic':
        _instances.set(knownId, createAnthropicProvider());
        break;
      case 'openaiCompatible':
        _instances.set(knownId, createOpenAICompatibleProvider());
        break;
    }
  }

  return _instances.get(knownId)!;
}

/**
 * Reads the 'llmProvider' setting from the DB fresh on every call and returns
 * the corresponding provider instance. This is the resolver passed to
 * createGateway() in getGateway() — by passing the function reference (not the
 * result), the gateway calls it on every AI invocation, so a setting change
 * takes effect on the next call without any restart or gateway re-creation.
 *
 * getActiveProviderId() applies its own fail-safe: an absent or corrupt setting
 * always returns 'anthropic', so this function inherits that guarantee.
 *
 * Throws if the resolved provider's env vars are not set — see getProviderById().
 */
export function resolveActiveProvider(): LLMProvider {
  return getProviderById(getActiveProviderId());
}
