'use client';

/**
 * app/components/shell/RightDockPanel.tsx
 *
 * Plan 15 — Share Agent. The right-side panel used to be a single-purpose Panel
 * wrapping RawAgentView. 2026-08-31 layout review moved the Access/Share UI here as a
 * second tab instead of a third zone inside AgentView.tsx (D1's original placement) or
 * a section folded into Raw's own identity — Raw and Share are sibling tabs on one dock.
 *
 * Deliberately its own component rather than a mode added to the generic `Panel` shell:
 * Panel's header (glyph + label + optional role) is shared by all four panes, and this
 * dock's header is a tab strip instead, not a variant worth threading through every
 * other caller.
 *
 * Tab state always starts on 'raw' and needs no explicit reset logic: WorkbenchShell
 * unmounts this component entirely when the panel is folded (swapped for <Rail>), so
 * folding and re-opening the panel remounts this component fresh — the initial
 * useState('raw') IS the "always reopen on Raw" behavior the mockup's setFold() had to
 * implement by hand.
 *
 * `access` (2026-08-31 feedback — "same view" for owner and shared, not two different
 * shells) hides the Share tab entirely for a shared viewer, same as the mockup's
 * dockShareTab.hidden = isSharedViewer — Share is owner-only by definition, but the Raw
 * tab (export, read reference) is identical for both, and WorkbenchShell renders this
 * whole dock for both access types now.
 */

import { useState } from 'react';
import type { AgentDTO } from '@/lib/db/repository';
import { RawAgentView } from '@/app/components/Raw/RawAgentView';
import { AccessZone } from '@/app/components/CustomViz/AccessZone';

type DockTab = 'raw' | 'share';

interface RightDockPanelProps {
  id?: string;
  agent: AgentDTO;
  /** 'owner' (default) or 'shared' — hides the Share tab when 'shared'. */
  access?: 'owner' | 'shared';
  /** Current panel width in px — forwarded to RawAgentView (its Download-label breakpoint) and used for the dock's own width style. */
  panelWidth: number;
  onFold: () => void;
  className?: string;
}

function FoldIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

export function RightDockPanel({ id, agent, access = 'owner', panelWidth, onFold, className = '' }: RightDockPanelProps) {
  const [tab, setTab] = useState<DockTab>('raw');
  const canShare = access === 'owner';

  const tabClass = (active: boolean) =>
    `font-semibold text-[12.5px] tracking-[.01em] border-r border-[var(--border)] rounded-t-[6px] px-[18px] py-[8px] cursor-pointer ${
      active
        ? 'text-[var(--text)] bg-[var(--panel)] shadow-[inset_0_3px_0_var(--accent)] border-b border-b-[var(--panel)] -mb-px'
        : 'text-[var(--faint)] bg-transparent hover:text-[var(--text)]'
    }`;

  return (
    <div
      id={id}
      className={`flex flex-col min-w-0 min-h-0 overflow-hidden rounded-[9px] border border-[var(--border)] bg-[var(--panel)] ${className}`}
      style={{ width: panelWidth }}
    >
      {/* Header — a tab strip, not the shared Panel glyph+label+role chrome. No filename
          shown here (that lived in the old header's `role` slot) — it's redundant once
          the Raw tab itself says what you're looking at, and Share has nothing to put
          there anyway. */}
      <div className="flex-none flex items-stretch bg-[var(--elev)] border-b border-[var(--border)]">
        <button type="button" onClick={() => setTab('raw')} className={tabClass(tab === 'raw')}>
          Raw
        </button>
        {canShare && (
          <button type="button" onClick={() => setTab('share')} className={tabClass(tab === 'share')}>
            Share
          </button>
        )}
        <button
          type="button"
          onClick={onFold}
          title="Collapse"
          className="ml-auto w-[38px] flex-none flex items-center justify-center border-l border-[var(--border)] text-[var(--faint)] cursor-pointer hover:bg-[var(--bg)] hover:text-[var(--text)]"
        >
          <FoldIcon />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'raw' ? (
          <RawAgentView agentId={agent.id} agentName={agent.name} agentUpdatedAt={agent.updatedAt} panelWidth={panelWidth} />
        ) : (
          <AccessZone agentId={agent.id} />
        )}
      </div>
    </div>
  );
}
