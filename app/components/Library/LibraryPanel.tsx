'use client';

/**
 * app/components/Library/LibraryPanel.tsx
 *
 * Plan 03 Phase C, C.3 — Real grouped agent list with drag-and-drop.
 * Revised 2026-07-29 — Agents/Grouped toggle migrated from the mockup (replaces the old
 * always-on named-groups + redundant flat "All agents" + "Ungrouped" stack).
 *
 * Fills the Phase B left Panel's body. The `mode` prop ('flat' = "Agents", 'grouped')
 * is owned by WorkbenchShell — the toggle control itself is the Panel header's role
 * slot, which only WorkbenchShell renders, so the mode state has to live there too.
 *
 * Structure:
 *   mode 'flat': every agent, no group headers at all.
 *   mode 'grouped': real groups (each a GroupSection drop zone — drag adds, × removes)
 *     + a trailing synthetic "Ungrouped" bucket for agents with no membership.
 *   Then always: a "Manage" zone-label separator + action rows, in this order:
 *     "+ New agent" (C.6), "+ New group", "⇪ Import agent" (Phase D's ImportButton).
 *
 * Drag-and-drop (@dnd-kit/core, R8/R9):
 *   - DragOverlay: shows the agent name while dragging.
 *   - onDragEnd: dropping onto a GroupSection drop zone calls POST /api/agents/[id]/groups.
 *     The add is add-not-move (R9): existing memberships are never removed by a drag.
 *
 * State: agent list + groups are loaded server-side (passed as props), then mutated
 * client-side via optimistic updates on membership/group/agent actions.
 */

import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { AgentListItem } from '@/app/components/Library/AgentListItem';
import { GroupSection } from '@/app/components/Library/GroupSection';
import { CreateAgentButton } from '@/app/components/Library/CreateAgentButton';
import { ImportButton } from '@/app/components/Library/ImportButton';
import type { AgentLiteDTO, GroupDTO } from '@/lib/db/repository';

interface LibraryPanelProps {
  currentAgentId: string;
  agents: AgentLiteDTO[];
  groups: GroupDTO[];
  /**
   * Agents (flat, no group headers) vs. Grouped (real groups + trailing synthetic
   * "Ungrouped" bucket). Prototyped 2026-07-29 — replaces the old always-on stack of
   * named groups + a redundant flat "All agents" + "Ungrouped". Owned/toggled by
   * WorkbenchShell (the Panel header's role slot is the toggle control itself);
   * passed down here read-only.
   */
  mode: 'flat' | 'grouped';
}

export function LibraryPanel({
  currentAgentId,
  agents: initialAgents,
  groups: initialGroups,
  mode,
}: LibraryPanelProps) {
  const [agents, setAgents] = useState<AgentLiteDTO[]>(initialAgents);
  const [groups, setGroups] = useState<GroupDTO[]>(initialGroups);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [newGroupError, setNewGroupError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // 5px minimum drag before activate
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const agentId = active.id as string;
    const overId = over.id as string;

    // The drop zone id format is `group-{groupId}`
    if (!overId.startsWith('group-')) return;
    const groupId = overId.replace('group-', '');

    try {
      const response = await fetch(`/api/agents/${agentId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      });

      if (response.ok) {
        // Optimistic update: add agentId to the group's memberAgentIds
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId && !g.memberAgentIds.includes(agentId)
              ? { ...g, memberAgentIds: [...g.memberAgentIds, agentId] }
              : g,
          ),
        );
        // Update agent's groupIds
        setAgents((prev) =>
          prev.map((a) =>
            a.id === agentId && !a.groupIds.includes(groupId)
              ? { ...a, groupIds: [...a.groupIds, groupId] }
              : a,
          ),
        );
      }
    } catch {
      // Silently ignore — state already reflects server before optimism
    }
  }

  const handleMembershipRemoved = useCallback((agentId: string, groupId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, memberAgentIds: g.memberAgentIds.filter((id) => id !== agentId) }
          : g,
      ),
    );
    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? { ...a, groupIds: a.groupIds.filter((id) => id !== groupId) }
          : a,
      ),
    );
  }, []);

  const handleAgentDeleted = useCallback((agentId: string) => {
    setAgents((prev) => prev.filter((a) => a.id !== agentId));
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        memberAgentIds: g.memberAgentIds.filter((id) => id !== agentId),
      })),
    );
  }, []);

  const handleGroupDeleted = useCallback((groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    setAgents((prev) =>
      prev.map((a) => ({
        ...a,
        groupIds: a.groupIds.filter((id) => id !== groupId),
      })),
    );
  }, []);

  async function handleCreateGroup() {
    if (!newGroupName.trim()) { setNewGroupError('Name is required.'); return; }
    setCreatingGroup(true);
    setNewGroupError(null);

    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim() }),
      });

      if (response.status === 409) {
        setNewGroupError('A group with that name already exists.');
        return;
      }
      if (!response.ok) {
        setNewGroupError('Failed to create group.');
        return;
      }

      const dto = await response.json() as GroupDTO;
      setGroups((prev) => [...prev, dto]);
      setNewGroupName('');
      setShowNewGroup(false);
    } catch {
      setNewGroupError('Network error.');
    } finally {
      setCreatingGroup(false);
    }
  }

  const activeDragAgent = activeDragId ? agents.find((a) => a.id === activeDragId) : null;
  const ungroupedAgents = agents.filter((a) => a.groupIds.length === 0);

  function monogram(name: string): string {
    const parts = name.trim().split(/[\s_-]+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toLowerCase();
    }
    return name.slice(0, 2).toLowerCase();
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="pb-2">
        {mode === 'flat' ? (
          /* Agents (flat) — every agent, no group headers at all */
          agents.map((agent) => (
            <AgentListItem
              key={agent.id}
              agent={agent}
              isCurrent={agent.id === currentAgentId}
              onDeleted={handleAgentDeleted}
            />
          ))
        ) : (
          <>
            {/* Real groups */}
            {groups.map((group) => (
              <GroupSection
                key={group.id}
                group={group}
                agents={agents}
                currentAgentId={currentAgentId}
                onMembershipRemoved={handleMembershipRemoved}
                onAgentDeleted={handleAgentDeleted}
                onGroupDeleted={handleGroupDeleted}
              />
            ))}

            {/* Pseudo-group: Ungrouped */}
            <div
              onClick={() => setUngroupedCollapsed((v) => !v)}
              className="px-2 pt-[6px] pb-[2px] text-[var(--faint)] text-[10px] font-bold tracking-[.08em] uppercase cursor-pointer"
            >
              {ungroupedCollapsed ? '▸' : '▾'} Ungrouped
            </div>
            {!ungroupedCollapsed && (
              ungroupedAgents.length === 0 ? (
                <div className="px-[10px] py-[4px] text-[11px] text-[var(--faint)] italic">
                  — all agents are in groups
                </div>
              ) : (
                ungroupedAgents.map((agent) => (
                  <AgentListItem
                    key={`ung-${agent.id}`}
                    agent={agent}
                    isCurrent={agent.id === currentAgentId}
                    onDeleted={handleAgentDeleted}
                  />
                ))
              )
            )}
          </>
        )}

        {/* "Manage" zone-label separator — same visual pattern as AgentView's Config/
            Sections zone labels, tighter margins to match the list's own indent. */}
        <div className="flex items-center gap-2 mt-[14px] mb-[6px] mx-[10px] text-[var(--faint)] text-[10px] font-bold tracking-[.09em] uppercase">
          Manage
          <span className="flex-1 h-px bg-[var(--border)]" />
        </div>

        {/* Action rows, in this order: New agent, New group, Import agent */}
        <CreateAgentButton />

        {showNewGroup ? (
          <div className="px-3 py-2 space-y-2">
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateGroup();
                if (e.key === 'Escape') { setShowNewGroup(false); setNewGroupError(null); }
              }}
              placeholder="Group name"
              className="w-full border border-[var(--border)] rounded-[6px] px-2 py-1 text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            {newGroupError && (
              <p className="text-[11px] text-[var(--err)]">{newGroupError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleCreateGroup}
                disabled={creatingGroup}
                className="flex-1 text-[11px] bg-[var(--accent)] text-white rounded-[6px] py-1 font-medium hover:opacity-90 disabled:opacity-50"
              >
                {creatingGroup ? 'Creating…' : 'Create group'}
              </button>
              <button
                onClick={() => { setShowNewGroup(false); setNewGroupError(null); }}
                className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] px-2"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => setShowNewGroup(true)}
            className="flex items-center gap-[7px] px-3 py-[7px] text-[var(--muted)] cursor-pointer text-[12px] hover:text-[var(--text)]"
          >
            ＋ New group
          </div>
        )}

        <ImportButton />
      </div>

      {/* Drag overlay — shows agent name while dragging */}
      <DragOverlay>
        {activeDragAgent && (
          <div className="flex items-center gap-2 px-[10px] py-[6px] rounded-[7px] bg-[var(--elev)] border border-[var(--accent)] shadow-lg text-[13px] text-[var(--text)]">
            <span className="w-5 h-5 rounded-[5px] grid place-items-center text-[10px] font-bold bg-[var(--accent)] text-white flex-none">
              {monogram(activeDragAgent.name)}
            </span>
            {activeDragAgent.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
