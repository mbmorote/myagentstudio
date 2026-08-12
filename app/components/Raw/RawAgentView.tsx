'use client';

/**
 * app/components/Raw/RawAgentView.tsx
 *
 * Plan 03 Phase B, B.9 — Raw markdown view of the current agent.
 *
 * Fetches GET /api/agents/[id]/export (A.10 / R11) and renders line-numbered
 * monospace text — always the literal exported bytes (matches Download exactly), only
 * the per-line coloring is stylized. Mirrors the mockup's buildRaw() classifier:
 *   - The two `---` delimiter lines → dimmed (.fm) — the ONLY thing dimmed.
 *   - A top-level (unindented) `key: value` frontmatter line → key in `--raw-key` (a
 *     pinned teal, independent of the theme's `--accent` — see app/globals.css), value
 *     plain (2026-08-06 — was: the whole frontmatter block uniformly dimmed).
 *   - Indented/continuation frontmatter lines (list items, folded/block-scalar body
 *     text) → plain, same as everything else (2026-08-06 fix — these were dimmed too,
 *     which made a wrapped multi-line `description:` look grayed-out next to
 *     single-line fields; there's no dim tier anymore except the delimiters).
 *   - Lines starting with `# ` → heading color (.h1)
 *   - Everything else → plain text
 *
 * No full markdown parsing — a simple per-line classifier is enough (R11).
 * Re-fetches whenever the agentId prop changes (switching agents), and — 2026-08-11,
 * found live: adding a section via chat didn't show up here — whenever agentUpdatedAt
 * changes (any edit to the same agent: manual save, chat apply, section add/remove).
 * Before this fix the effect only depended on agentId, so this panel kept showing
 * whatever it fetched on first mount until the agent itself was switched.
 *
 * Download (2026-07-29, roadmap Tier 3 item 4) — client-side Blob + <a download> of the
 * already-fetched markdown, no new API route. Download-only was the explicit choice over
 * direct write-to-disk (no filesystem-path assumptions) or copy-to-clipboard (marginal
 * extra value) — the user drags the saved file into .claude/agents/ themselves.
 *
 * Zoom modal (2026-08-06) — 🔍 in the band opens a Dialog with the same `lines`
 * rendered larger (RawLines, shared between panel and modal so they can't drift).
 * Read-only, no controls beyond closing — the panel is the narrow side rail, the modal
 * is just that same content at a size you can actually read.
 */

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface RawAgentViewProps {
  agentId: string;
  agentName: string;
  /** AgentDTO.updatedAt (ISO 8601) — included in the re-fetch effect's dependency array
   *  so any edit to the agent, not just switching to a different one, triggers a
   *  re-fetch (2026-08-11). */
  agentUpdatedAt: string;
  /** Current panel width in px (WorkbenchShell's rightWidth) — below DOWNLOAD_LABEL_MIN_WIDTH
   *  the Download button drops its "Download" text and shows just the arrow (2026-08-06). */
  panelWidth?: number;
}

/** Below this panel width, the Download button shows ⇩ only — "Download" stopped fitting
 *  alongside the band text and 🔍 once the panel could go down to 200px. */
const DOWNLOAD_LABEL_MIN_WIDTH = 260;

// A top-level (unindented) `key: value` frontmatter line — nested/continuation lines
// (list items, folded-scalar bodies) are indented and never match this, so they still
// fall back to the uniform 'fm' treatment below.
const FM_FIELD_RE = /^([A-Za-z_][\w-]*:)(\s?)(.*)$/;

type Line =
  | { kind: 'fm' | 'h1' | 'plain'; text: string }
  | { kind: 'fm-field'; key: string; value: string };

function classifyLines(md: string): Line[] {
  const rawLines = md.split('\n');
  const result: Line[] = [];
  let inFrontmatter = false;
  let frontmatterClosed = false;
  let frontmatterDelimiters = 0;

  for (const line of rawLines) {
    if (!frontmatterClosed && line.trim() === '---') {
      frontmatterDelimiters++;
      if (frontmatterDelimiters === 1) {
        inFrontmatter = true;
      } else if (frontmatterDelimiters === 2) {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      result.push({ kind: 'fm', text: line });
      continue;
    }

    if (inFrontmatter) {
      const fieldMatch = FM_FIELD_RE.exec(line);
      if (fieldMatch) {
        result.push({ kind: 'fm-field', key: fieldMatch[1] + fieldMatch[2], value: fieldMatch[3] });
      } else {
        // Continuation lines (list items, folded/block-scalar body text) — same plain
        // color as everything else (2026-08-06: only the `---` delimiters stay dimmed;
        // dimming these too made a wrapped multi-line description read as grayed-out
        // compared to single-line fields, which was the actual color mismatch).
        result.push({ kind: 'plain', text: line });
      }
    } else if (line.startsWith('# ')) {
      result.push({ kind: 'h1', text: line });
    } else {
      result.push({ kind: 'plain', text: line });
    }
  }

  return result;
}

/** Shared line renderer — used by both the compact panel and the zoom modal (2026-08-06),
 *  so the two never drift on coloring/format; only the size scales. */
function RawLines({ lines, size }: { lines: Line[]; size: 'compact' | 'zoom' }) {
  const fontSize = size === 'zoom' ? 'text-[15px]' : 'text-[12px]';
  const lineHeight = size === 'zoom' ? 'leading-[1.8]' : 'leading-[1.65]';
  const numWidth = size === 'zoom' ? 'w-[48px]' : 'w-[40px]';
  return (
    <div className={`font-mono ${fontSize} ${lineHeight} py-[10px]`}>
      {lines.map((line, i) => (
        <div key={i} className="flex">
          {/* Line number — .rn */}
          <span
            className={`flex-none ${numWidth} text-right pr-[14px] text-[var(--faint)] opacity-70 select-none tabular-nums`}
          >
            {i + 1}
          </span>
          {/* Line content — .rc */}
          <span className="whitespace-pre-wrap pr-[14px] text-[var(--text)]">
            {line.kind === 'fm' && (
              <span className="text-[var(--faint)]">{line.text}</span>
            )}
            {line.kind === 'fm-field' && (
              <>
                <span className="text-[var(--raw-key)]">{line.key}</span>
                {line.value}
              </>
            )}
            {line.kind === 'h1' && (
              <span className="text-[var(--warn)] font-semibold">{line.text}</span>
            )}
            {line.kind === 'plain' && line.text}
          </span>
        </div>
      ))}
    </div>
  );
}

export function RawAgentView({ agentId, agentName, agentUpdatedAt, panelWidth }: RawAgentViewProps) {
  const showDownloadLabel = panelWidth === undefined || panelWidth >= DOWNLOAD_LABEL_MIN_WIDTH;
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoomOpen, setZoomOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setMarkdown(null);

    apiFetch(`/api/agents/${agentId}/export`)
      .then(async (res) => {
        if (!res.ok) {
          setError(`Failed to load (${res.status})`);
          return;
        }
        const text = await res.text();
        setMarkdown(text);
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [agentId, agentUpdatedAt]);

  if (loading) {
    return (
      <div className="px-4 py-3 text-[12px] text-[var(--faint)]">Loading…</div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 text-[12px] text-[var(--err)]">{error}</div>
    );
  }

  if (!markdown) return null;

  const lines = classifyLines(markdown);

  function handleDownload() {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agentName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Band showing file info — matches mockup's .rband. No filename here (2026-08-06,
          removed) — the panel header (WorkbenchShell's Panel `role` prop) already shows
          "{agentName}.md · export preview" right above this, so repeating it here was
          redundant and, at panel widths ~340px, wrapped the name onto its own line.
          sticky + explicit bg (2026-08-11): Panel's own body div (app/components/shell/
          Panel.tsx) is the actual overflow-auto scroll container, this band is just a
          normal child inside it — without position:sticky it scrolled away with the
          line-numbered content below instead of staying pinned at the top. */}
      <div
        className="sticky top-0 z-10 bg-[var(--panel)] px-[14px] py-[6px] text-[var(--faint)] text-[10.5px] border-b border-[var(--border)] font-mono flex items-center gap-[10px]"
      >
        <span className="min-w-0 truncate" title="Markdown · UTF-8 · read reference">Markdown · UTF-8 · read reference</span>
        <button
          type="button"
          onClick={() => setZoomOpen(true)}
          title="Open a larger view"
          className="ml-auto flex-none font-sans text-[12px] text-[var(--faint)] bg-transparent border-none cursor-pointer hover:text-[var(--text)]"
        >
          🔍
        </button>
        <button
          type="button"
          onClick={handleDownload}
          title={`Download ${agentName}.md`}
          className="flex-none font-sans text-[10.5px] font-semibold text-[var(--accent-ink)] bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[6px] px-[8px] py-[2px] cursor-pointer hover:opacity-90"
        >
          {showDownloadLabel ? '⇩ Download' : '⇩'}
        </button>
      </div>

      {/* Line-numbered monospace output — matches mockup's .raw */}
      <RawLines lines={lines} size="compact" />

      {/* Zoom modal — same content/format, just bigger (2026-08-06). Read-only: no
          controls beyond closing, nothing here can diverge from the panel above. */}
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="bg-[var(--panel)] border-[var(--border)] text-[var(--text)] max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogTitle className="text-[var(--text)] font-semibold text-[14px] font-mono">
            {agentName}.md
          </DialogTitle>
          <DialogDescription className="text-[var(--faint)] text-[11px] font-mono">
            Markdown · UTF-8 · read reference
          </DialogDescription>
          <RawLines lines={lines} size="zoom" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
