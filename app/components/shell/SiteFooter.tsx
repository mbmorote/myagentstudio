/**
 * app/components/shell/SiteFooter.tsx
 *
 * One footer, one set of content — used by the logged-in workbench
 * (WorkbenchShell) and every logged-out page (WelcomePage, /privacy, /terms,
 * /guide) alike. Each host page may position/size it differently (a slim
 * bottom bar in the workbench vs. a roomier sticky footer on a marketing
 * page), but the content itself — author identity, copyright, version, and
 * the Guide/Terms/Privacy links — must not diverge between them.
 *
 * No 'use client' directive: pure presentational, reads only NEXT_PUBLIC_*
 * env vars (inlined at build time), so it renders identically whether its
 * host file is a client component (WorkbenchShell, WelcomePage) or a server
 * component (/privacy, /terms, /guide).
 */

const AUTHOR_NAME = process.env.NEXT_PUBLIC_AUTHOR_NAME || 'the user';
const AUTHOR_LINKEDIN = process.env.NEXT_PUBLIC_AUTHOR_LINKEDIN || '#';
const AUTHOR_GITHUB = process.env.NEXT_PUBLIC_AUTHOR_GITHUB || '#';
const AUTHOR_EMAIL = process.env.NEXT_PUBLIC_AUTHOR_EMAIL || '#';

export function SiteFooter({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-[19.8px] gap-y-1 ${className}`}>
      <span className="flex items-center gap-2 text-[var(--muted)] font-semibold">
        <span>Built by {AUTHOR_NAME}</span>
        <a href={AUTHOR_LINKEDIN} className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">LinkedIn</a>
        <a href={AUTHOR_GITHUB} className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">GitHub</a>
        <a href={AUTHOR_EMAIL} className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">Email</a>
      </span>
      <span className="flex-1 min-w-[242px] text-right">
        © {new Date().getFullYear()} ProcessMind Solutions. All rights reserved. · v{process.env.NEXT_PUBLIC_APP_VERSION}
        {' · '}
        <a href="/guide" className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">Guide</a>
        {' · '}
        <a href="/terms" className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">Terms</a>
        {' · '}
        <a href="/privacy" className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">Privacy</a>
      </span>
    </div>
  );
}
