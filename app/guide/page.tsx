/**
 * app/guide/page.tsx
 *
 * Public User Guide page — renders docs/user-guide.md live, server-side, via
 * `marked`. docs/user-guide.md stays the single source of truth (it's also what
 * gets edited directly, same as any other doc in docs/); this page has no
 * content of its own to drift out of sync with it, unlike a hand-transcribed
 * copy would.
 *
 * Public route — added to middleware.ts's PUBLIC_PATHS, same tier as /privacy
 * and /terms, since it's meant to be readable by someone who received a share
 * link before they have an account.
 *
 * Server component — no interactivity; rendered once on the server, no 'use client'.
 * Uses h-screen + overflow-y-auto (not min-h-screen) for the same reason
 * WelcomePage/PrivacyPage/TermsPage do: app/globals.css sets body{overflow:hidden}
 * for the Workbench shell's fixed-viewport layout, which would block scroll on a
 * normal page. The root div is its own scroll container.
 *
 * Markdown → HTML via `marked.parse()`, injected with dangerouslySetInnerHTML.
 * Safe here specifically because the source is a repo-tracked file this server
 * controls (docs/user-guide.md), never user input — not a pattern to reuse for
 * anything reader-supplied.
 *
 * HIDDEN_SECTIONS (2026-08-31, temporary): "System Settings: dry-run mode and
 * the activity log" is stripped from this public render only — admin/dry-run
 * internals aren't ready for a cold-visitor-facing doc yet. docs/user-guide.md
 * itself is untouched (still the accurate source for anyone reading the repo
 * directly); this is a render-time filter, not a content edit. See the note in
 * Plans/04-README-Polish.md (6.2 - MyAgent Aux) — revisit before wider launch.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { marked } from 'marked';
import { SiteFooter } from '@/app/components/shell/SiteFooter';

/** Exact `## `-level heading text of each section to omit from the public page. */
const HIDDEN_SECTIONS = [
  'System Settings: dry-run mode and the activity log',
  'Manual admin operations',
];

function stripHiddenSections(markdown: string): string {
  return HIDDEN_SECTIONS.reduce((text, heading) => {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // From this section's own '## Heading' line up to (not including) the next
    // top-level '## ' heading, or end of doc if it was the last section.
    // (?![\s\S]) is a true end-of-string assertion — plain `$` would match
    // end-of-*line* under the 'm' flag `^` needs, firing on the very next blank
    // line instead of the next top-level heading (or the real end of the doc).
    const pattern = new RegExp(`^## ${escaped}\\r?\\n[\\s\\S]*?(?=\\r?\\n## |(?![\\s\\S]))`, 'm');
    return text.replace(pattern, '');
  }, markdown);
}

function getGuideHtml(): string {
  const raw = readFileSync(join(process.cwd(), 'docs', 'user-guide.md'), 'utf-8');
  // The doc's own H1 ("# MyAgentStudio User Guide") is redundant with this page's
  // own <h1> below — drop the first line so the doc isn't titled twice.
  const withoutTitle = raw.replace(/^#.*\r?\n/, '');
  const filtered = stripHiddenSections(withoutTitle);
  return marked.parse(filtered, { async: false }) as string;
}

export default function GuidePage() {
  const html = getGuideHtml();

  return (
    <div className="flex flex-col h-screen overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-[5] border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center gap-4 max-w-[820px] mx-auto px-7 py-3">
          <a
            href="/"
            className="flex items-center gap-[9px] font-bold tracking-[-0.01em] text-[15px] text-[var(--text)] no-underline hover:opacity-80"
          >
            <span
              className="w-[9px] h-[9px] rounded-[2px] bg-[var(--accent)]"
              style={{ boxShadow: '0 0 0 3px var(--accent-wash)' }}
            />
            MyAgentStudio
          </a>
          <div className="flex-1" />
          <a
            href="/"
            className="text-[13px] text-[var(--muted)] no-underline hover:text-[var(--text)]"
          >
            ← Back
          </a>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="max-w-[820px] mx-auto px-7 py-10 w-full flex-1">
        <h1 className="text-[28px] tracking-[-0.02em] mb-8">User Guide</h1>
        <div className="guide-content" dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-[5] border-t border-[var(--border)] bg-[var(--panel)] text-[11.5px] text-[var(--faint)]">
        <SiteFooter className="max-w-[820px] mx-auto px-7 py-[10px]" />
      </div>
    </div>
  );
}
