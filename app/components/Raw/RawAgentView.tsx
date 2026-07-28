'use client';

/**
 * app/components/Raw/RawAgentView.tsx
 *
 * Plan 03 Phase B, B.9 — Raw markdown view of the current agent.
 *
 * Fetches GET /api/agents/[id]/export (A.10 / R11) and renders line-numbered
 * monospace text. Mirrors the mockup's buildRaw() classifier:
 *   - Lines between the two `---` delimiters → dimmed (.fm)
 *   - Lines starting with `# ` → heading color (.h1)
 *   - Everything else → plain text
 *
 * No full markdown parsing — a simple per-line classifier is enough (R11).
 * Re-fetches whenever the agentId prop changes (e.g. after a chat edit).
 */

import { useState, useEffect } from 'react';

interface RawAgentViewProps {
  agentId: string;
  agentName: string;
}

type LineKind = 'fm' | 'h1' | 'plain';

function classifyLines(md: string): { kind: LineKind; text: string }[] {
  const rawLines = md.split('\n');
  const result: { kind: LineKind; text: string }[] = [];
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
      result.push({ kind: 'fm', text: line });
    } else if (line.startsWith('# ')) {
      result.push({ kind: 'h1', text: line });
    } else {
      result.push({ kind: 'plain', text: line });
    }
  }

  return result;
}

export function RawAgentView({ agentId, agentName }: RawAgentViewProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setMarkdown(null);

    fetch(`/api/agents/${agentId}/export`)
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
  }, [agentId]);

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

  return (
    <div>
      {/* Band showing file info — matches mockup's .rband */}
      <div
        className="px-[14px] py-[6px] text-[var(--faint)] text-[10.5px] border-b border-[var(--border)] font-mono flex gap-[10px]"
      >
        <span>{agentName}.md</span>
        <span>·</span>
        <span>Markdown · UTF-8 · read reference</span>
      </div>

      {/* Line-numbered monospace output — matches mockup's .raw */}
      <div className="font-mono text-[12px] leading-[1.65] py-[10px]">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            {/* Line number — .rn */}
            <span
              className="flex-none w-[40px] text-right pr-[14px] text-[var(--faint)] opacity-70 select-none tabular-nums"
            >
              {i + 1}
            </span>
            {/* Line content — .rc */}
            <span className="whitespace-pre-wrap pr-[14px] text-[var(--text)]">
              {line.kind === 'fm' && (
                <span className="text-[var(--faint)]">{line.text}</span>
              )}
              {line.kind === 'h1' && (
                <span className="text-[var(--warn)] font-semibold">{line.text}</span>
              )}
              {line.kind === 'plain' && line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
