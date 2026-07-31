/**
 * app/login/page.tsx
 *
 * Server component wrapper for the /login page (Plan 06 Phase 4.1, §5.4).
 *
 * Reads isOAuthConfigured() server-side and passes it as a prop to the
 * LoginForm client component — one source of truth, no client-side fetch, no
 * NEXT_PUBLIC_ env var, no render flash (§5.4 chosen design).
 *
 * The <Suspense> boundary is required because LoginForm uses useSearchParams(),
 * which in Next 15 must sit inside a <Suspense> when the route is statically
 * rendered. This is the pre-existing build failure Phase 0 noted
 * ("app/login/page.tsx calls useSearchParams() without a Suspense boundary");
 * Phase 4's page split is explicitly where the plan expects it to be fixed.
 */

import { Suspense } from 'react';
import { isOAuthConfigured } from '@/lib/env';
import { LoginForm } from '@/app/components/Auth/LoginForm';

export default function LoginPage() {
  const oauthConfigured = isOAuthConfigured();
  return (
    <Suspense>
      <LoginForm oauthConfigured={oauthConfigured} />
    </Suspense>
  );
}
