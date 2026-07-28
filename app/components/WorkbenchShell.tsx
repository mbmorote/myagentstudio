'use client';

/**
 * app/components/WorkbenchShell.tsx
 *
 * Plan 03 Phase B, B.6 — Rewritten around the fixed Example-A grid.
 *
 * Layout (Example A — the only layout, R10):
 *   Topbar on top.
 *   Below: Left=Library (Panel, foldable+resizable) · gutter ·
 *          Center (col: Viz Panel over gutter over Chat Panel) · gutter ·
 *          Right=Raw (Panel, foldable+resizable)
 *
 * Fold/resize state is local useState only (R15 — no persistence).
 * key={agent.id} is set by the parent page so switching agents resets all local
 * state (fold positions, resize sizes, chat history) on route navigation.
 *
 * Library panel body is empty in Phase B — filled by Phase C's LibraryPanel.
 *
 * Interaction lock invariants (§6 rule 12, Rules Index #22):
 *   - 'chat' lock: a /api/chat request is in flight
 *   - 'edit' lock: a section raw-edit has unsaved changes
 *   - null: idle
 */

import { useState, useCallback } from 'react';
import type { AgentDTO, AgentLiteDTO, GroupDTO } from '@/lib/db/repository';
import { AgentView } from '@/app/components/CustomViz/AgentView';
import { ChatPanel } from '@/app/components/Chat/ChatPanel';
import { Topbar } from '@/app/components/shell/Topbar';
import { Panel } from '@/app/components/shell/Panel';
import { Rail } from '@/app/components/shell/Rail';
import { Gutter } from '@/app/components/shell/Gutter';
import { RawAgentView } from '@/app/components/Raw/RawAgentView';

export type InteractionLock = 'chat' | 'edit' | null;

export type SectionUpdateResult =
  | { content: string; version: number }
  | { conflict: true; current: number; content: string };

interface WorkbenchShellProps {
  initialAgent: AgentDTO | null;
  /** Flat list of all agents for the Library panel */
  agents?: AgentLiteDTO[];
  /** All groups (for Library panel and config pills) */
  groups?: GroupDTO[];
  /** Body content to render inside the Library panel (Phase C provides LibraryPanel) */
  libraryContent?: React.ReactNode;
}

export function WorkbenchShell({
  initialAgent,
  agents = [],
  groups = [],
  libraryContent,
}: WorkbenchShellProps) {
  const [agent, setAgent] = useState<AgentDTO | null>(initialAgent);
  const [interactionLock, setInteractionLock] = useState<InteractionLock>(null);

  // ── Fold state (R15 — local only) ──────────────────────────────────────────
  const [leftFolded, setLeftFolded] = useState(false);
  const [rightFolded, setRightFolded] = useState(false);

  // ── Resize state (R15 — local only, same initial values as mockup) ─────────
  const [leftWidth, setLeftWidth] = useState(218);    // matches mockup .left { flex: 0 0 218px }
  const [rightWidth, setRightWidth] = useState(340);  // matches mockup .right { flex: 0 0 340px }
  const [chatHeight, setChatHeight] = useState(240);  // matches mockup .center-bottom { flex: 0 0 240px }

  // ── Section update callback (from ChatPanel) ───────────────────────────────
  const onSectionsUpdated = useCallback(
    (updates: Record<string, SectionUpdateResult>) => {
      setAgent((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map((s) => {
            const update = updates[s.sectionKey];
            if (!update) return s;
            if ('conflict' in update) {
              return { ...s, content: update.content, version: update.current };
            }
            return { ...s, content: update.content, version: update.version };
          }),
        };
      });
    },
    [],
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg)]">
      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <Topbar />

      {/* ── Workbench grid ──────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 p-[9px] gap-0">

        {/* ── Left: Library panel (foldable + resizable) ───────────────── */}
        {leftFolded ? (
          <Rail glyph="▤" label="Library ▸" onUnfold={() => setLeftFolded(false)} />
        ) : (
          <>
            <Panel
              glyph="▤"
              label="Library"
              role="agents · groups"
              foldable
              foldDirection="left"
              onFold={() => setLeftFolded(true)}
              className="flex-none"
              style={{ width: leftWidth }}
            >
              {libraryContent ?? (
                <div className="p-4 text-[12px] text-[var(--faint)]">
                  Library coming in Phase C…
                </div>
              )}
            </Panel>
            <Gutter
              orientation="vertical"
              size={leftWidth}
              setSize={setLeftWidth}
              invert={false}
            />
          </>
        )}

        {/* ── Center: Viz (top) + Gutter + Chat (bottom) ───────────────── */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Custom Viz — center-top */}
          <Panel
            glyph="◈"
            label="Custom Visualization"
            role="platform main view"
            className="flex-1 min-h-0"
          >
            <div className="overflow-auto h-full">
              {agent ? (
                <AgentView
                  agent={agent}
                  groups={groups}
                  interactionLock={interactionLock}
                  onEditStart={() => setInteractionLock('edit')}
                  onEditEnd={() => setInteractionLock(null)}
                  onSectionSaved={(sectionId, content, newVersion) => {
                    setAgent((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        sections: prev.sections.map((s) =>
                          s.id === sectionId ? { ...s, content, version: newVersion } : s,
                        ),
                      };
                    });
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[var(--faint)] p-6">
                  <div className="text-center">
                    <p className="text-[16px] font-medium text-[var(--muted)]">No agent loaded</p>
                    <p className="mt-1 text-[12px]">
                      Import an agent via <code className="font-mono text-[var(--accent-ink)]">⇪ Import .md</code> to get started.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {/* Horizontal gutter between Viz and Chat */}
          <Gutter
            orientation="horizontal"
            size={chatHeight}
            setSize={setChatHeight}
            invert={true}
          />

          {/* Chat panel — center-bottom */}
          <Panel
            glyph="✦"
            label="AI Chat"
            role="agent-aware · edits sections in place"
            className="flex-none"
            style={{ height: chatHeight }}
          >
            {agent ? (
              <ChatPanel
                agentId={agent.id}
                agentName={agent.name}
                interactionLock={interactionLock}
                onChatStart={() => setInteractionLock('chat')}
                onChatEnd={() => setInteractionLock(null)}
                onSectionsUpdated={onSectionsUpdated}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-[var(--faint)]">
                Import an agent to start chatting.
              </div>
            )}
          </Panel>
        </div>

        {/* ── Right: Raw panel (foldable + resizable) ──────────────────── */}
        {rightFolded ? (
          <Rail glyph="≡" label="◂ Raw" onUnfold={() => setRightFolded(false)} />
        ) : (
          <>
            <Gutter
              orientation="vertical"
              size={rightWidth}
              setSize={setRightWidth}
              invert={true}
            />
            <Panel
              glyph="≡"
              label="Raw agent"
              role={agent ? `${agent.name}.md · export preview` : 'export preview'}
              foldable
              foldDirection="right"
              onFold={() => setRightFolded(true)}
              className="flex-none"
              style={{ width: rightWidth }}
            >
              {agent ? (
                <RawAgentView agentId={agent.id} agentName={agent.name} />
              ) : (
                <div className="p-4 text-[12px] text-[var(--faint)]">
                  No agent loaded.
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
