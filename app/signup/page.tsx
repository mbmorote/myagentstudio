/**
 * app/signup/page.tsx
 *
 * Server component wrapper for the /signup page (Plan 06 Phase 4.2, §5.4).
 *
 * Reads isOAuthConfigured() server-side and passes it as a prop to the
 * SignupForm client component — one source of truth, no client-side fetch, no
 * NEXT_PUBLIC_ env var, no render flash (§5.4 chosen design).
 *
 * The <Suspense> boundary is required because SignupForm uses useSearchParams()
 * to read the ?error= vocabulary from OAuth callback redirects, and Next 15
 * requires a Suspense boundary for useSearchParams() in statically rendered
 * routes.
 */

import { Suspense } from 'react';
import { isOAuthConfigured } from '@/lib/env';
import { SignupForm } from '@/app/components/Auth/SignupForm';

export default function SignupPage() {
  const oauthConfigured = isOAuthConfigured();
  return (
    <Suspense>
      <SignupForm oauthConfigured={oauthConfigured} />
    </Suspense>
  );
}
