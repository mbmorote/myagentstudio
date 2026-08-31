'use client';

/**
 * app/components/CustomViz/SharedAgentActions.tsx
 *
 * Plan 15 — Share Agent, §4.9 surface C. Copy-to-me for a shared viewer. Originally
 * lived inside a "You're viewing X — shared by Y. Read-only…" banner atop
 * SharedAgentView; moved here 2026-08-31 (live-testing feedback: no banner — the
 * Custom Visualization panel's own title bar already says "shared by <owner>", so a
 * separate alert-styled box repeating that was redundant chrome). WorkbenchShell
 * renders this directly in the Panel's `role` slot, right after that "shared by …"
 * text: title · shared by X · [Copy to me].
 *
 * No Export button here (dropped same day, second round of feedback): the right-panel
 * dock's Raw tab already has a Download button doing the exact same
 * exportAgentMarkdownForViewer() call — a second Export button in the title bar was
 * pure duplication, not a second real feature, once the dock came back for shared
 * viewers too ("same view" — see WorkbenchShell.tsx).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AgentDTO } from '@/lib/db/repository';
import { apiFetch } from '@/lib/apiFetch';

interface SharedAgentActionsProps {
  agent: AgentDTO;
}

export function SharedAgentActions({ agent }: SharedAgentActionsProps) {
  const router = useRouter();
  const [copying, setCopying] = useState(false);

  async function handleCopyToMe(nameOverride?: string) {
    setCopying(true);
    try {
      const res = await apiFetch(`/api/agents/${agent.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nameOverride ? { name: nameOverride } : {}),
      });
      if (res.status === 201) {
        const dto = await res.json();
        router.push(`/agents/${dto.id}`);
        router.refresh();
        return;
      }
      if (res.status === 409) {
        // Name collision with something the copier already owns — prompt for a
        // different name and resubmit (§4.6: no auto-suffixing, ever).
        const newName = window.prompt(
          `You already have an agent named "${agent.name}". Enter a different name for the copy:`,
        );
        if (newName && newName.trim()) {
          await handleCopyToMe(newName.trim());
        }
      }
      // Any other failure is rare enough (network error, unexpected 500) that a plain
      // silent no-op here is fine — this is a title-bar button, not a form with a
      // dedicated error slot; the user can just try again.
    } finally {
      setCopying(false);
    }
  }

  return (
    <button
      type="button"
      disabled={copying}
      onClick={() => void handleCopyToMe()}
      className="flex-none text-[10.5px] font-semibold text-white bg-[var(--accent)] border border-[var(--accent)] rounded-[6px] px-[9px] py-[3px] cursor-pointer whitespace-nowrap hover:brightness-[1.08] disabled:opacity-50"
    >
      {copying ? 'Copying…' : 'Copy to me'}
    </button>
  );
}
