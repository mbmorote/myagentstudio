/**
 * lib/email/registry.ts
 *
 * The email provider registry — modelled on lib/auth/oauth/providers.ts. THE
 * SEAM ANY ROUTE-LEVEL TEST MOCKS for behavior that goes through sendEmail()
 * (gateway tests use createEmailGateway(fakeProvider) directly instead — see
 * gateway.ts).
 *
 * Intentionally small (~15 lines). All provider-specific logic lives in the
 * provider's own file (resendProvider.ts). Adding a second provider later is
 * one new file plus one new branch here — no changes to the gateway or any route.
 */

import { isEmailConfigured } from '../env.js';
import { createResendProvider } from './resendProvider.js';
import type { EmailProvider } from './provider.js';

/** Returns true when the required email env-var group is fully set (§4.6). */
export function isEmailProviderConfigured(): boolean {
  return isEmailConfigured();
}

/**
 * Returns the active EmailProvider, or null when email is not configured.
 * The gateway treats null as its 'not_configured' result — it never throws here.
 */
export function resolveEmailProvider(): EmailProvider | null {
  if (!isEmailConfigured()) return null;
  return createResendProvider();
}
