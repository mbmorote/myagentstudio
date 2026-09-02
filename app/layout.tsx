import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import { isOAuthConfigured } from '@/lib/env';
import { ReauthModal } from '@/app/components/Auth/ReauthModal';

const description =
  'A guided AI-agent workbench for Claude Code and Copilot agent files — review-before-apply AI editing, lossless import, and MCP console access.';

export const metadata: Metadata = {
  metadataBase: new URL('https://myagentstudio.dev'),
  title: 'MyAgentStudio',
  description,
  icons: {
    icon: '/processmind-mark.png',
  },
  openGraph: {
    title: 'MyAgentStudio — AI-Agent Workbench',
    description,
    url: 'https://myagentstudio.dev',
    siteName: 'MyAgentStudio',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MyAgentStudio — AI-Agent Workbench',
    description,
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
        {/* Cloudflare Web Analytics — site-wide pageview beacon, no cookies. */}
        <Script
          strategy="afterInteractive"
          type="module"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "06bd6290b055439e91d14610589402f3"}'
        />
      </body>
    </html>
  );
}
