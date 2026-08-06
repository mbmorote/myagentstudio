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
 *   - 'proposal' lock: a pending proposal exists in localStorage (Plan 08 Phase 2)
 *   - null: idle
 */

import { useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import type { AgentDTO, AgentLiteDTO, GroupDTO, ConfigDefLite } from '@/lib/db/repository';
import type { Session } from '@/lib/auth/session';
import { AgentView } from '@/app/components/CustomViz/AgentView';
import { ChatPanel } from '@/app/components/Chat/ChatPanel';
import {
  subscribe as subscribeProposal,
  getSnapshot as getProposalSnapshot,
  getServerSnapshot as getProposalServerSnapshot,
  clearProposal,
  writeProposal,
} from '@/lib/proposalStore';
import type { PendingProposal } from '@/lib/proposalStore';
import { apiFetch } from '@/lib/apiFetch';
import { Topbar } from '@/app/components/shell/Topbar';
import { Panel } from '@/app/components/shell/Panel';
import { Rail } from '@/app/components/shell/Rail';
import { Gutter } from '@/app/components/shell/Gutter';
import { RawAgentView } from '@/app/components/Raw/RawAgentView';
import { LibraryPanel } from '@/app/components/Library/LibraryPanel';
import { ConsentPopup } from '@/app/components/Auth/ConsentPopup';
import { SIGNUP_CONSENT_FLAG_KEY, NEW_ACCOUNT_QUERY_PARAM } from '@/lib/auth/consentPopupFlag';

export type InteractionLock = 'chat' | 'edit' | 'proposal' | null;
export type { PendingProposal };

/**
 * A section or config block "cited" for the chat — frontend-only for now
 * (2026-07-31): purely a UI citation, shown as a chip near the chat input.
 * The chat request still sends the whole agent as context, unchanged; whether
 * a citation should actually narrow what's sent to the LLM is a deferred
 * follow-up (plans/roadmap.md TODO item 2).
 */
export interface CitedItem {
  type: 'section' | 'config';
  key: string;
  label: string;
}

interface WorkbenchShellProps {
  initialAgent: AgentDTO | null;
  /** Flat list of all agents for the Library panel */
  agents?: AgentLiteDTO[];
  /** All groups (for Library panel and config pills) */
  groups?: GroupDTO[];
  /**
   * Full config catalog, loaded fresh from the DB per page request (2026-07-29 — closes
   * catalog seed drift). Passed through to AgentView instead of it statically importing
   * CONFIG_DEFS, so a catalog.ts edit + `npm run db:seed` + reload updates the UI with no
   * rebuild/redeploy.
   */
  configCatalog?: ConfigDefLite[];
  /** Authenticated session — threaded to Topbar for email display and role-gated links. */
  session: Session;
}

export function WorkbenchShell({
  initialAgent,
  agents = [],
  groups = [],
  configCatalog = [],
  session,
}: WorkbenchShellProps) {
  const [agent, setAgent] = useState<AgentDTO | null>(initialAgent);
  const [interactionLock, setInteractionLock] = useState<'chat' | 'edit' | null>(null);

  // ── Pending proposal store (Plan 08 Phase 2) ───────────────────────────────
  // useSyncExternalStore gives us a synchronous, hydration-safe restore of any
  // pending proposal from localStorage — no useEffect, no flash of editable UI
  // before the lock reasserts (§5.3).
  const pendingProposal = useSyncExternalStore(
    subscribeProposal,
    () => (agent?.id ? getProposalSnapshot(session.userId, agent.id) : null),
    getProposalServerSnapshot,
  );

  // 'proposal' lock is derived from pendingProposal — no setState needed.
  // Children receive effectiveLock, not interactionLock, so the lock is correct
  // from the very first render (prevents the flash the plan explicitly guards against).
  const effectiveLock: InteractionLock = pendingProposal !== null ? 'proposal' : interactionLock;

  const [isApplying, setIsApplying] = useState(false);

  const applyProposal = useCallback(async () => {
    if (!pendingProposal || !agent) return;
    setIsApplying(true);
    try {
      const res = await apiFetch(`/api/agents/${agent.id}/apply-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifications: pendingProposal.modifications }),
      });
      if (res.ok) {
        const data = (await res.json()) as { agent: AgentDTO };
        setAgent(data.agent);
        clearProposal(session.userId, agent.id);
        // effectiveLock automatically returns to null (pendingProposal becomes null)
      }
      // On error: keep proposal and lock (§5.4 row "Apply → error")
    } catch {
      // Network error: keep proposal and lock
    } finally {
      setIsApplying(false);
    }
  }, [pendingProposal, agent, session.userId]);

  const discardProposal = useCallback(() => {
    if (!agent) return;
    clearProposal(session.userId, agent.id);
    // effectiveLock automatically returns to null (pendingProposal becomes null)
  }, [agent, session.userId]);

  /**
   * Called by ChatPanel when a 200 response with non-empty modifications arrives.
   * Builds the full PendingProposal object and writes it to proposalStore.
   * Keeps storage ownership in WorkbenchShell alongside Apply/Discard (§6.2).
   */
  const onProposalReceived = useCallback(
    (
      message: string,
      modifications: PendingProposal['modifications'],
      warnings: string[],
    ) => {
      if (!agent) return;
      writeProposal({
        v: 1,
        agentId: agent.id,
        userId: session.userId,
        proposedAt: new Date().toISOString(),
        message,
        modifications,
        warnings,
      });
    },
    [agent, session.userId],
  );

  // ── Chat citation selection (frontend-only, 2026-07-31 — see CitedItem) ─────
  const [citedItems, setCitedItems] = useState<CitedItem[]>([]);

  const toggleCite = useCallback((item: CitedItem, additive: boolean) => {
    setCitedItems((prev) => {
      const idx = prev.findIndex((c) => c.type === item.type && c.key === item.key);
      if (additive) {
        // Ctrl/Cmd-click: add to the selection, or remove if already selected.
        return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, item];
      }
      // Plain click: clicking the only selected item deselects it; otherwise
      // replace the whole selection with just this one.
      if (idx >= 0 && prev.length === 1) return [];
      return [item];
    });
  }, []);

  const removeCite = useCallback((item: CitedItem) => {
    setCitedItems((prev) => prev.filter((c) => !(c.type === item.type && c.key === item.key)));
  }, []);

  const clearAllCited = useCallback(() => setCitedItems([]), []);

  // Clicking outside every citable block AND outside the chat panel clears the
  // selection. Citable blocks manage their own toggle in their click handler
  // (which fires after this mousedown handler) — this only needs to ignore them,
  // not clear them itself, or the two would fight over the next click.
  useEffect(() => {
    if (citedItems.length === 0) return;
    function handler(e: MouseEvent) {
      const target = e.target as Element | null;
      if (target?.closest?.('[data-citable]')) return;
      if (target?.closest?.('[data-chat-panel]')) return;
      setCitedItems([]);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [citedItems.length]);

  // ── Post-signup activity-log-sharing popup (SignupForm.tsx header comment) ──
  // Fires once per fresh signup: password path leaves a sessionStorage flag,
  // Google path leaves a one-time ?newAccount=1 query param. Whichever is
  // present is consumed and cleared immediately so a page refresh never re-shows it.
  const [showConsentPopup, setShowConsentPopup] = useState(false);
  useEffect(() => {
    const fromPassword = sessionStorage.getItem(SIGNUP_CONSENT_FLAG_KEY);
    if (fromPassword) {
      sessionStorage.removeItem(SIGNUP_CONSENT_FLAG_KEY);
      setShowConsentPopup(true);
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has(NEW_ACCOUNT_QUERY_PARAM)) {
      url.searchParams.delete(NEW_ACCOUNT_QUERY_PARAM);
      window.history.replaceState({}, '', url.toString());
      setShowConsentPopup(true);
    }
  }, []);

  // ── Fold state (R15 — local only) ──────────────────────────────────────────
  const [leftFolded, setLeftFolded] = useState(false);
  const [rightFolded, setRightFolded] = useState(false);

  // ── Library Agents/Grouped toggle (prototyped 2026-07-29) ───────────────────
  // Lives here (not inside LibraryPanel) because the toggle control itself sits in
  // the Panel header's `role` slot, which only WorkbenchShell renders — LibraryPanel
  // only owns the panel body. Default is "Agents" (flat); independent of selection —
  // picking an agent never force-switches the view to Grouped.
  const [libraryMode, setLibraryMode] = useState<'flat' | 'grouped'>('flat');

  // ── Resize state (R15 — local only, same initial values as mockup) ─────────
  const [leftWidth, setLeftWidth] = useState(218);    // matches mockup .left { flex: 0 0 218px }
  const [rightWidth, setRightWidth] = useState(400);  // matches mockup .right { flex: 0 0 400px } (2026-08-06, was 340)
  const [chatHeight, setChatHeight] = useState(240);  // matches mockup .center-bottom { flex: 0 0 240px }

  // onSectionsUpdated removed in Plan 08 Phase 3: sections no longer auto-apply
  // via chat — they come through Apply only, which already calls setAgent(data.agent)
  // with the full refreshed DTO from the apply endpoint response.

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg)]">
      {showConsentPopup && <ConsentPopup onClose={() => setShowConsentPopup(false)} />}

      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <Topbar session={session} />

      {/* ── Workbench grid ──────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 p-[9px] gap-0">

        {/* ── Left: Library panel (foldable + resizable) ───────────────── */}
        {leftFolded ? (
          <Rail glyph="▤" label="Library ▸" onUnfold={() => setLeftFolded(false)} className="mr-[9px]" />
        ) : (
          <>
            <Panel
              glyph="▤"
              label="Library"
              role={
                <span
                  onClick={() => setLibraryMode((m) => (m === 'flat' ? 'grouped' : 'flat'))}
                  title="Click to switch between Agents (flat) and Grouped view"
                  className="cursor-pointer font-bold text-[var(--accent-ink)] hover:underline"
                >
                  {libraryMode === 'flat' ? 'Agents' : 'Grouped'}
                </span>
              }
              foldable
              foldDirection="left"
              onFold={() => setLeftFolded(true)}
              className="flex-none"
              style={{ width: leftWidth }}
            >
              <LibraryPanel
                currentAgentId={agent?.id}
                agents={agents}
                groups={groups}
                mode={libraryMode}
              />
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
                  configCatalog={configCatalog}
                  interactionLock={effectiveLock}
                  citedItems={citedItems}
                  onToggleCite={toggleCite}
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
                  onNameSaved={(name) => {
                    setAgent((prev) => (prev ? { ...prev, name } : prev));
                  }}
                  onAgentUpdated={(newAgent) => {
                    setAgent(newAgent);
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[var(--faint)] p-6">
                  <div className="text-center">
                    <p className="text-[16px] font-medium text-[var(--muted)]">No agent loaded</p>
                    <p className="mt-1 text-[12px]">
                      Import an agent via <code className="font-mono text-[var(--accent-ink)]">⇪ Import agent</code> to get started.
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
                agent={agent}
                interactionLock={effectiveLock}
                citedItems={citedItems}
                onRemoveCite={removeCite}
                onClearCited={clearAllCited}
                onChatStart={() => setInteractionLock('chat')}
                onChatEnd={() => setInteractionLock(null)}
                onProposalReceived={onProposalReceived}
                pendingProposal={pendingProposal}
                isApplying={isApplying}
                onApplyProposal={applyProposal}
                onDiscardProposal={discardProposal}
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
          <Rail glyph="≡" label="◂ Raw" onUnfold={() => setRightFolded(false)} className="ml-[9px]" />
        ) : (
          <>
            <Gutter
              orientation="vertical"
              size={rightWidth}
              setSize={setRightWidth}
              invert={true}
              min={200}
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
                <RawAgentView agentId={agent.id} agentName={agent.name} panelWidth={rightWidth} />
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
