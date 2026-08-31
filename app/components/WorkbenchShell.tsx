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
 *          Right=RightDockPanel (foldable+resizable) — a two-tab dock, Raw | Share
 *          (Plan 15, 2026-08-31), not a single-purpose Panel any more.
 *
 * Fold/resize state is local useState only (R15 — no persistence).
 * key={agent.id} is set by the parent page so switching agents resets all local
 * state (fold positions, resize sizes, chat history) on route navigation.
 *
 * Library panel body is empty in Phase B — filled by Phase C's LibraryPanel.
 *
 * Interaction lock invariants (chat / manual edit / a pending proposal are mutually
 * exclusive per agent, client-enforced only — no server-side enforcement):
 *   - 'chat' lock: a /api/chat request is in flight
 *   - 'edit' lock: a section raw-edit has unsaved changes
 *   - 'proposal' lock: a pending proposal exists in localStorage (Plan 08 Phase 2)
 *   - null: idle
 */

import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { AgentDTO, AgentLiteDTO, GroupDTO, ConfigDefLite, SectionDefLite, SharedAgentLiteDTO } from '@/lib/db/repository';
import type { Session } from '@/lib/auth/session';
import { AgentView } from '@/app/components/CustomViz/AgentView';
import { SharedAgentView } from '@/app/components/CustomViz/SharedAgentView';
import { SharedAgentActions } from '@/app/components/CustomViz/SharedAgentActions';
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
import { GuidedTour, type GuidedTourHandle } from '@/app/components/shell/GuidedTour';
import { RightDockPanel } from '@/app/components/shell/RightDockPanel';
import { LibraryPanel } from '@/app/components/Library/LibraryPanel';
import { SiteFooter } from '@/app/components/shell/SiteFooter';
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
  /** Full section catalog for the agent's platform, same purpose/freshness as configCatalog
   *  above — powers AgentView's "+ Add section" menu (roadmap TODO item 1's non-chat half). */
  sectionCatalog?: SectionDefLite[];
  /** Authenticated session — threaded to Topbar for email display and role-gated links. */
  session: Session;
  /**
   * Plan 15 — 'owner' (default, every pre-Plan-15 caller) or 'shared' when
   * `initialAgent` is a share-holder's read-only view, resolved server-side by
   * getAgentFullForViewer (never a client toggle — see SharedAgentView.tsx's own
   * doc comment on D1). 'shared' swaps the center panel to SharedAgentView and
   * removes the Chat panel and the right-panel dock entirely (chat would only ever
   * 404; Export is a self-contained action in SharedAgentView instead of routed
   * through a Raw panel).
   */
  access?: 'owner' | 'shared';
  /** Only meaningful when access === 'shared' — the agent's owner, for SharedAgentView's banner. */
  ownerEmail?: string;
  /** Agents shared WITH this viewer (Plan 15) — always relevant regardless of which
   *  agent, if any, is currently open: the Library shows the viewer's whole world,
   *  owned agents and shared-with-them agents alike. */
  sharedAgents?: SharedAgentLiteDTO[];
}

export function WorkbenchShell({
  initialAgent,
  agents = [],
  groups = [],
  configCatalog = [],
  sectionCatalog = [],
  session,
  access = 'owner',
  ownerEmail,
  sharedAgents = [],
}: WorkbenchShellProps) {
  const isShared = access === 'shared';
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
  // GuidedTour only mounts (and can autostart) once this is true, so the two
  // first-run overlays never stack (#5) — consent popup first, tour from its
  // onClose; if there's no popup to show, unblock the tour immediately.
  const [tourReady, setTourReady] = useState(false);
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
      return;
    }
    setTourReady(true);
  }, []);

  // ── Fold state (R15 — local only) ──────────────────────────────────────────
  const [leftFolded, setLeftFolded] = useState(false);
  const [rightFolded, setRightFolded] = useState(false);

  // ── Guided tour (Plan 12, ported from Layout-Workbench.html 2026-08-14) ─────
  const tourRef = useRef<GuidedTourHandle>(null);

  // ── Library Agents/Grouped toggle (prototyped 2026-07-29) ───────────────────
  // Lives here (not inside LibraryPanel) because the toggle control itself sits in
  // the Panel header's `role` slot, which only WorkbenchShell renders — LibraryPanel
  // only owns the panel body. Default is "Agents" (flat); independent of selection —
  // picking an agent never force-switches the view to Grouped.
  // Group behavior deferred 2026-08-07 at the user's request (pre-launch scope cut,
  // alongside LibraryPanel's "+ New group" and AgentListItem's drag-and-drop) — the
  // toggle is inert while this is false; flip to true to re-enable switching to Grouped.
  const GROUPS_ENABLED = false;
  const [libraryMode, setLibraryMode] = useState<'flat' | 'grouped'>('flat');

  // ── Resize state (R15 — local only, same initial values as mockup) ─────────
  const [leftWidth, setLeftWidth] = useState(218);    // matches mockup .left { flex: 0 0 218px }
  const [rightWidth, setRightWidth] = useState(400);  // matches mockup .right { flex: 0 0 400px } (2026-08-06, was 340)
  const [chatHeight, setChatHeight] = useState(320);  // matches mockup .center-bottom { flex: 0 0 320px }
  // Design review 2026-08-06 (plans/Design-Review-260806.md item 3): was 240 — chat
  // is the primary way you act on an agent, but at 240px it read as a footnote under
  // the Config zone. Taller default gives it visual weight closer to a peer panel.

  // onSectionsUpdated removed in Plan 08 Phase 3: sections no longer auto-apply
  // via chat — they come through Apply only, which already calls setAgent(data.agent)
  // with the full refreshed DTO from the apply endpoint response.

  return (
    <>
      {/* ── Mobile block ─────────────────────────────────────────────────
          The workbench is a fixed multi-pane grid (Library | Viz/Chat | Raw/Share)
          with no responsive breakpoints of its own — it doesn't degrade below
          tablet width, it just breaks. Rather than attempt a real mobile layout
          pre-launch, show a friendly notice instead below 768px and hide the
          workbench itself (CSS-only via max-[767px]: — no resize listener, no
          hydration flicker). */}
      <div className="hidden max-[767px]:flex h-screen flex-col items-center justify-center gap-3 bg-[var(--bg)] px-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/processmind-mark.png" alt="" className="w-10 h-10 object-contain opacity-80" />
        <p className="text-[15px] font-medium text-[var(--text)]">Best on a larger screen</p>
        <p className="text-[13px] text-[var(--muted)] max-w-[280px]">
          MyAgentStudio&apos;s workbench is a multi-panel layout that needs more room than a
          phone screen gives it. Please reopen this on a tablet, laptop, or desktop.
        </p>
      </div>

      <div className="max-[767px]:hidden flex flex-col h-screen overflow-hidden bg-[var(--bg)]">
      {showConsentPopup && (
        <ConsentPopup
          onClose={() => {
            setShowConsentPopup(false);
            setTourReady(true);
          }}
        />
      )}

      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <Topbar session={session} onReplayTour={() => tourRef.current?.start()} />

      {tourReady && (
        <GuidedTour
          ref={tourRef}
          onUnfoldLeft={() => setLeftFolded(false)}
          onUnfoldRight={() => setRightFolded(false)}
        />
      )}

      {/* ── Workbench grid ──────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 p-[9px] gap-0">

        {/* ── Left: Library panel (foldable + resizable) ───────────────── */}
        {leftFolded ? (
          <Rail glyph="▤" label="Library ▸" onUnfold={() => setLeftFolded(false)} className="mr-[9px]" />
        ) : (
          <>
            <Panel
              id="tourLibrary"
              glyph="▤"
              label="Library"
              role={
                GROUPS_ENABLED ? (
                  <span
                    onClick={() => setLibraryMode((m) => (m === 'flat' ? 'grouped' : 'flat'))}
                    title="Click to switch between Agents (flat) and Grouped view"
                    className="cursor-pointer font-bold text-[var(--accent-ink)] hover:underline"
                  >
                    {libraryMode === 'flat' ? 'Agents' : 'Grouped'}
                  </span>
                ) : (
                  <span className="font-bold text-[var(--accent-ink)]">Agents</span>
                )
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
                sharedAgents={sharedAgents}
                mode={libraryMode}
                isAdmin={session.role === 'admin'}
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
          {/* Custom Viz — center-top. No label for the owner's own view (2026-08-31
              feedback: didn't want an "owner" status shown at all) — only a shared
              viewer sees anything here: who shared it, plus the Copy-to-me/Export
              actions right after it (moved out of SharedAgentView's now-removed
              banner — same feedback round, "no alert... should not exist"). */}
          <Panel
            id="tourCustomViz"
            glyph="◈"
            label="Custom Visualization"
            role={
              isShared && agent ? (
                <span className="flex items-center gap-[10px]">
                  <span className="truncate">shared by {ownerEmail}</span>
                  <SharedAgentActions agent={agent} />
                </span>
              ) : undefined
            }
            className="flex-1 min-h-0"
          >
            <div className="overflow-auto h-full">
              {agent ? (
                isShared ? (
                  <SharedAgentView agent={agent} />
                ) : (
                  <AgentView
                    agent={agent}
                    groups={groups}
                    configCatalog={configCatalog}
                    sectionCatalog={sectionCatalog}
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
                )
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

          {/* Chat panel — center-bottom. Rendered for both owner and shared viewers
              (2026-08-31 feedback: "should be same view" — the shared/owner distinction
              is the small role label on the Custom Visualization panel above, not a
              different shell). A shared viewer's /api/chat request still 404s
              server-side (no new gate needed, §4.4) — unchanged from the plan's original
              stance, just no longer hidden client-side on top of it. Design review
              2026-08-06 (item 3): accent border marks it as the primary action surface,
              not a subordinate one — distinct from the Config panel's agent-color border
              above (identity vs. "this is where you act"). */}
          <Gutter
            orientation="horizontal"
            size={chatHeight}
            setSize={setChatHeight}
            invert={true}
          />
          <Panel
            id="tourChat"
            glyph="✦"
            label="AI Chat"
            role="agent-aware · edits sections in place"
            className="flex-none"
            style={{ height: chatHeight, borderColor: 'var(--accent)' }}
          >
            {agent ? (
              <ChatPanel
                agentId={agent.id}
                agentName={agent.name}
                agent={agent}
                isAdmin={session.role === 'admin'}
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

        {/* ── Right: Raw/Share dock (foldable + resizable) ──────────────── */}
        {/* Rendered for both owner and shared viewers (2026-08-31 feedback: "same
            view") — RightDockPanel itself hides the Share tab (owner-only) when
            access === 'shared'; the Raw tab (export, read reference) is identical
            either way, per D2's own resolution that a share-holder may export. */}
        {rightFolded ? (
          <Rail
            glyph="≡"
            // Matches RightDockPanel's own tab visibility: owner sees both tabs once
            // unfolded, a shared viewer only ever sees Raw (2026-08-31 — this rail
            // used to say "Raw" unconditionally, which undersold what's behind it for
            // an owner now that the dock also holds Share).
            label={access === 'owner' ? '◂ Raw / Share' : '◂ Raw'}
            onUnfold={() => setRightFolded(false)}
            className="ml-[9px]"
          />
        ) : (
          <>
            <Gutter
              orientation="vertical"
              size={rightWidth}
              setSize={setRightWidth}
              invert={true}
              min={200}
            />
            {/* Design review 2026-08-06 (item 4): a touch of opacity so this panel reads
                as secondary/reference next to the Config panel's full-contrast chrome —
                it's the "read reference" copy of the same data, not a second primary view.
                Theme-agnostic (unlike hand-picking a lighter border color per theme).
                2026-08-31: this pane became a two-tab dock (Raw | Share, Plan 15) —
                RightDockPanel owns the tab strip; the plain Panel fallback below only
                covers the no-agent-loaded case, which has nothing to tab between. */}
            {agent ? (
              <RightDockPanel
                id="tourRaw"
                agent={agent}
                access={access}
                panelWidth={rightWidth}
                onFold={() => setRightFolded(true)}
                className="flex-none opacity-[.92]"
              />
            ) : (
              <Panel
                id="tourRaw"
                glyph="≡"
                label="Raw agent"
                role="export preview"
                foldable
                foldDirection="right"
                onFold={() => setRightFolded(true)}
                className="flex-none opacity-[.92]"
                style={{ width: rightWidth }}
              >
                <div className="p-4 text-[12px] text-[var(--faint)]">
                  No agent loaded.
                </div>
              </Panel>
            )}
          </>
        )}
      </div>

      {/* ── Branding footer ─────────────────────────────────────────────
          Ported from Layout-Workbench.html's .foot-brand (2026-08-14). The mockup
          folded this into a chip-legend footer bar explaining panel color-coding —
          that legend was mockup-only explanatory UI for design review, never a real
          product feature, so it wasn't ported. This bar carries just the branding
          line the legend used to host. Content is SiteFooter — same author/copyright/
          version/Guide-Terms-Privacy links as every logged-out page, just laid out
          into this slim bottom bar instead of a roomier centered footer. */}
      <div className="flex-none flex items-center px-4 py-[6px] bg-[var(--panel)] border-t border-[var(--border)] text-[11px] text-[var(--faint)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/processmind-mark.png" alt="" className="w-4 h-4 object-contain mr-2" />
        <SiteFooter className="flex-1" />
      </div>
      </div>
    </>
  );
}
