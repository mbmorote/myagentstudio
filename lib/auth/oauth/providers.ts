/**
 * lib/auth/oauth/providers.ts
 *
 * The OAuth provider registry — THE SEAM THAT TESTS MOCK (constraint 11, §10.1).
 *
 * `getOAuthProvider(name)` and `listConfiguredProviders()` are the two exports.
 * Tests that exercise route handlers mock this module:
 *
 *   vi.mock('@/lib/auth/oauth/providers.js', () => ({
 *     getOAuthProvider: vi.fn(() => fakeProvider),
 *     listConfiguredProviders: vi.fn(() => ['google']),
 *   }));
 *
 * This file is intentionally small (~20 lines). All provider-specific logic —
 * arctic usage, JWKS verification — lives in the provider's own file (google.ts).
 * Adding GitHub later means one new file + one new `if (name === 'github')` branch.
 * Nothing in the routes changes.
 */

import { getOAuthConfig, isOAuthConfigured } from '../../env.js';
import { createGoogleProvider } from './google.js';
import type { OAuthProvider } from './types.js';

/**
 * Returns the OAuthProvider for the given registry key, or `null` when:
 *   - OAuth is not configured (`isOAuthConfigured()` is false), or
 *   - `name` is not a registered provider.
 *
 * Route handlers treat `null` as a 404 `unknown_provider` or 503 `oauth_not_configured`.
 */
export function getOAuthProvider(name: string): OAuthProvider | null {
  if (!isOAuthConfigured()) return null;
  if (name === 'google') return createGoogleProvider(getOAuthConfig());
  return null;
}

/**
 * Returns the list of currently registered provider names, or `[]` when
 * OAuth is not configured. Used by server components to decide whether to
 * render the "Continue with Google" button (§5.4).
 */
export function listConfiguredProviders(): string[] {
  if (!isOAuthConfigured()) return [];
  return ['google'];
}
