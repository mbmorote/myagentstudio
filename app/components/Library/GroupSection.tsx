'use client';

/**
 * app/components/Library/GroupSection.tsx
 *
 * Plan 03 Phase C, C.5 — One collapsible group section in the Library panel.
 *
 * Wrapped as a useDroppable drop zone:
 *   - Dropping an AgentListItem here calls POST /api/agents/[id]/groups (R9 — add, not move).
 *   - Shown with accent border when a draggable is over it.
 *
 * "+ New group" affordance handled by LibraryPanel (C.3).
 * "Delete group" action: window.confirm, calls DELETE /api/groups/[id].
 * "All agents" and "Ungrouped" pseudo-groups are NOT drop targets (R9).
 *
 * Members are rendered via AgentListItem with groupId prop so the × remove button appears.
 */

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { AgentListItem } from '@/app/components/Library/AgentListItem';
import type { AgentLiteDTO, GroupDTO } from '@/lib/db/repository';

interface GroupSectionProps {
  group: GroupDTO;
  agents: AgentLiteDTO[];
  currentAgentId: string;
  onMembershipRemoved: (agentId: string, groupId: string) => void;
  onAgentDeleted: (agentId: string) => void;
  onGroupDeleted: (groupId: string) => void;
}

export function GroupSection({
  group,
  agents,
  currentAgentId,
  onMembershipRemoved,
  onAgentDeleted,
  onGroupDeleted,
}: GroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  const { isOver, setNodeRef } = useDroppable({
    id: `group-${group.id}`,
    data: { groupId: group.id },
  });

  const memberAgents = agents.filter((a) => group.memberAgentIds.includes(a.id));

  async function handleDeleteGroup(e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Delete group "${group.name}"? Agents will not be deleted.`)) return;

    try {
      const response = await fetch(`/api/groups/${group.id}`, { method: 'DELETE' });
      if (response.ok || response.status === 204) {
        onGroupDeleted(group.id);
      }
    } catch {
      // Silently ignore
    }
  }

  return (
    <div>
      {/* Group header — .lgroup style */}
      <div
        className="flex items-center px-2 py-[6px] cursor-pointer group/grp"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="text-[var(--faint)] text-[10px] font-bold tracking-[.08em] uppercase flex-1">
          {collapsed ? '▸' : '▾'} {group.name}
        </span>
        <button
          onClick={handleDeleteGroup}
          title={`Delete group "${group.name}"`}
          className="text-[10px] text-[var(--faint)] hover:text-[var(--err)] opacity-0 group-hover/grp:opacity-100 transition-opacity"
        >
          ×
        </button>
      </div>

      {/* Drop zone + member rows */}
      {!collapsed && (
        <div
          ref={setNodeRef}
          className={`min-h-[32px] rounded-[7px] mx-[6px] transition-colors ${
            isOver
              ? 'bg-[var(--accent-wash)] border border-[var(--accent)] border-dashed'
              : ''
          }`}
        >
          {memberAgents.length === 0 && (
            <div className="px-[10px] py-[6px] text-[11px] text-[var(--faint)] italic">
              {isOver ? 'Drop to add…' : 'Drag agents here'}
            </div>
          )}
          {memberAgents.map((agent) => (
            <AgentListItem
              key={agent.id}
              agent={agent}
              isCurrent={agent.id === currentAgentId}
              groupId={group.id}
              onRemoveFromGroup={onMembershipRemoved}
              onDeleted={onAgentDeleted}
            />
          ))}
          {isOver && memberAgents.length > 0 && (
            <div className="px-[10px] py-[4px] text-[10px] text-[var(--accent-ink)] italic">
              Drop to add…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
