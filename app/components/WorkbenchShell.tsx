'use client';

/**
 * app/components/WorkbenchShell.tsx
 *
 * Client component — the root of all interactive workbench state.
 *
 * Responsibilities:
 *   - Holds the current AgentDTO in React state (initialized from the Server Component).
 *   - Owns the interaction lock: 'chat' (a chat request is in flight) or 'edit'
 *     (a section raw-edit has unsaved changes) or null (idle). Chat and manual raw-edit
 *     are mutually exclusive per agent (Rules Index #22, §6 rule 12).
 *   - Provides onSectionsUpdated callback to ChatPanel so it can update the agent state
 *     after a successful /api/chat response.
 *   - Renders the 3-pane grid: Library placeholder · CustomViz · Chat.
 */

import { useState, useCallback } from 'react';
import type { AgentDTO } from '@/lib/db/repository';
import { AgentView } from '@/app/components/CustomViz/AgentView';
import { ChatPanel } from '@/app/components/Chat/ChatPanel';

export type InteractionLock = 'chat' | 'edit' | null;

export type SectionUpdateResult =
  | { content: string; version: number }
  | { conflict: true; current: number; content: string };

interface WorkbenchShellProps {
  initialAgent: AgentDTO | null;
}

export function WorkbenchShell({ initialAgent }: WorkbenchShellProps) {
  const [agent, setAgent] = useState<AgentDTO | null>(initialAgent);
  const [interactionLock, setInteractionLock] = useState<InteractionLock>(null);

  /**
   * Called by ChatPanel after a successful /api/chat response.
   * Updates each section in the agent state based on the server's result map.
   * Both success and conflict cases update the content (conflict carries the current
   * server content), so the viz always reflects the real DB state.
   */
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
              // Conflict: show the current server content; version is `current`
              return { ...s, content: update.content, version: update.current };
            }
            // Success
            return { ...s, content: update.content, version: update.version };
          }),
        };
      });
    },
    [],
  );

  return (
    <div className="grid h-screen overflow-hidden" style={{ gridTemplateColumns: '220px 1fr 380px' }}>
      {/* ── Left pane: Library placeholder ─────────────────────────────────── */}
      <aside className="flex flex-col gap-2 border-r border-border bg-muted/30 p-4 overflow-y-auto">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Library
        </p>
        <p className="text-xs text-muted-foreground">
          Agent library is coming in a later plan.
        </p>
        {agent && (
          <div className="mt-2 rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground ring-1 ring-border">
            {agent.name}
          </div>
        )}
      </aside>

      {/* ── Center pane: CustomViz ──────────────────────────────────────────── */}
      <main className="overflow-y-auto p-6">
        {agent ? (
          <AgentView
            agent={agent}
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
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-lg font-medium">No agent loaded</p>
              <p className="mt-1 text-sm">
                Import an agent via <code className="rounded bg-muted px-1 py-0.5 text-xs">POST /api/agents/import</code> to get started.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* ── Right pane: Chat ────────────────────────────────────────────────── */}
      <aside className="flex flex-col border-l border-border">
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
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            Import an agent to start chatting.
          </div>
        )}
      </aside>
    </div>
  );
}
