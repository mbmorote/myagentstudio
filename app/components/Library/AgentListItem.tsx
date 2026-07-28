'use client';

/**
 * app/components/Library/AgentListItem.tsx
 *
 * Plan 03 Phase C, C.4 — One agent row in the Library panel.
 *
 * Renders:
 *   - Monogram avatar (first two chars — same rule as AgentView header)
 *   - Agent name + source tag (imported / created)
 *   - Drag handle (useDraggable from @dnd-kit/core)
 *   - Delete button (window.confirm, calls DELETE /api/agents/[id])
 *   - When inside a GroupSection: also shows "×" to remove from that group
 *
 * Selected/current agent gets the .sel highlight.
 * R9: dragging adds membership; it never removes existing ones.
 * R4: deleting an agent deletes its membership rows (A.1 fix — regression tested).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDraggable } from '@dnd-kit/core';
import type { AgentLiteDTO } from '@/lib/db/repository';

function monogram(name: string): string {
  const parts = name.trim().split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toLowerCase();
  }
  return name.slice(0, 2).toLowerCase();
}

interface AgentListItemProps {
  agent: AgentLiteDTO;
  isCurrent: boolean;
  /** If provided, shows the × remove-from-group button */
  groupId?: string;
  onRemoveFromGroup?: (agentId: string, groupId: string) => void;
  onDeleted: (agentId: string) => void;
}

export function AgentListItem({
  agent,
  isCurrent,
  groupId,
  onRemoveFromGroup,
  onDeleted,
}: AgentListItemProps) {
  const router = useRouter();

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: agent.id,
    data: { agentId: agent.id },
  });

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
      if (response.ok) {
        onDeleted(agent.id);
        // If we just deleted the current agent, navigate to root
        if (isCurrent) {
          router.push('/');
        }
      }
    } catch {
      // Silently ignore — user can retry
    }
  }

  async function handleRemoveFromGroup(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!groupId || !onRemoveFromGroup) return;

    try {
      const response = await fetch(`/api/agents/${agent.id}/groups/${groupId}`, {
        method: 'DELETE',
      });
      if (response.ok || response.status === 404) {
        onRemoveFromGroup(agent.id, groupId);
      }
    } catch {
      // Silently ignore
    }
  }

  return (
    /* .arow */
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-[10px] py-[6px] mx-[6px] my-[1px] rounded-[7px] cursor-pointer text-[var(--muted)] group/row ${
        isCurrent
          ? 'bg-[var(--accent-wash)] text-[var(--text)]'
          : 'hover:bg-[var(--bg)]'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Drag handle */}
      <span
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing text-[var(--faint)] text-[10px] flex-none select-none"
        title="Drag to add to group"
      >
        ⠿
      </span>

      {/* Monogram avatar — .av */}
      <Link href={`/agents/${agent.id}`} className="contents">
        <span
          className={`w-5 h-5 rounded-[5px] grid place-items-center text-[10px] font-bold flex-none border border-[var(--border)] ${
            isCurrent
              ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
              : 'bg-[var(--elev)] text-[var(--muted)]'
          }`}
        >
          {monogram(agent.name)}
        </span>
      </Link>

      {/* Name */}
      <Link href={`/agents/${agent.id}`} className="flex-1 min-w-0 flex items-center gap-2">
        <span className="font-medium text-[var(--text)] truncate text-[13px]">{agent.name}</span>
      </Link>

      {/* Source tag */}
      <span className="ml-auto text-[9px] text-[var(--faint)] flex-none">{agent.source}</span>

      {/* Remove from group (×) — only shown inside a GroupSection */}
      {groupId && onRemoveFromGroup && (
        <button
          onClick={handleRemoveFromGroup}
          title={`Remove from group`}
          className="flex-none text-[10px] text-[var(--faint)] hover:text-[var(--err)] opacity-0 group-hover/row:opacity-100 transition-opacity ml-1"
        >
          ×
        </button>
      )}

      {/* Delete button */}
      <button
        onClick={handleDelete}
        title={`Delete ${agent.name}`}
        className="flex-none text-[10px] text-[var(--faint)] hover:text-[var(--err)] opacity-0 group-hover/row:opacity-100 transition-opacity"
      >
        🗑
      </button>
    </div>
  );
}
