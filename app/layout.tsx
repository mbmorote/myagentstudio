import type { Metadata } from 'next';
import './globals.css';
import { isOAuthConfigured } from '@/lib/env';
import { ReauthModal } from '@/app/components/Auth/ReauthModal';

export const metadata: Metadata = {
  title: 'MyAgentStudio',
  description: 'Agent workbench',
  icons: {
    icon: '/processmind-mark.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Mounted once, app-wide (issue #14) — apiFetch()'s 401 handler shows this
            in place of a hard navigate to /login. Renders nothing until needed;
            harmless on /login and /signup themselves since those pages' forms use
            bare fetch, never apiFetch (route-guard.test.ts asserts this), so the
            re-auth state this modal reacts to can never be triggered there. */}
        <ReauthModal oauthConfigured={isOAuthConfigured()} />
      </body>
    </html>
  );
}
