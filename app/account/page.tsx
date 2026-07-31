/**
 * app/account/page.tsx
 *
 * User Settings page — Plan 05 Phase 4.6, §5.7.
 *
 * Accessible to any authenticated session, including the admin.
 * Middleware and requirePageSession() both guard. Non-authenticated visitors
 * are redirected to /login?next=/account.
 *
 * Loads the caller's own row via GET /api/account and passes it to the
 * AccountView client component. Only session.userId's row is ever read
 * or written — no id is accepted from the URL (§8 invariant 17).
 *
 * Rendering note (§5.7): renders <Topbar /> itself, following the same
 * pattern as /settings (Plan 04 §5.4). WorkbenchShell and app/layout.tsx
 * stay untouched — this is a top-level standalone page.
 */

import { redirect } from 'next/navigation';
import { requirePageSession } from '@/lib/auth/session';
import { getUserById } from '@/lib/db/repository/users';
import { Topbar } from '@/app/components/shell/Topbar';
import { AccountView } from '@/app/components/Account/AccountView';

export default async function AccountPage() {
  const session = await requirePageSession('/account');

  // Load a fresh user row for the consent preference (§3.4 — not cached in the session)
  const user = getUserById(session.userId);
  if (!user) {
    // Session references a deleted user — this should be impossible because
    // middleware already rejected a bad token, but be safe.
    redirect('/login');
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--bg)]">
      <Topbar session={session} />
      <AccountView
        email={user.email}
        role={user.role}
        shareLogsWithAdmin={user.shareLogsWithAdmin}
      />
    </div>
  );
}
