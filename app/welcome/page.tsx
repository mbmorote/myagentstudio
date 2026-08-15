/**
 * app/welcome/page.tsx
 *
 * Plan 12 — public pre-login landing page (2026-08-14). Added to middleware.ts's
 * PUBLIC_PATHS so it renders for unauthenticated visitors instead of redirecting to
 * /login — see WelcomePage.tsx for the actual content.
 *
 * isOAuthConfigured() read server-side and passed down, same pattern as
 * app/login/page.tsx — one source of truth, no client-side fetch, no render flash. The
 * nav's "Log in" opens LoginForm in a modal (embedded prop) instead of navigating to
 * /login, matching the mock's .loginback pattern — /login itself is unchanged and still
 * what middleware.ts redirects unauthenticated visitors to elsewhere in the app.
 */

import { isOAuthConfigured } from '@/lib/env';
import { WelcomePage } from '@/app/components/Welcome/WelcomePage';

export default function Welcome() {
  const oauthConfigured = isOAuthConfigured();
  return <WelcomePage oauthConfigured={oauthConfigured} />;
}
