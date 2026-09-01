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
 *
 * Read-only variant (Plan 15, §4.9 surface A, 2026-08-31) — pass `sharedOwnerEmail`
 * for a "Shared with me" row: no delete button, no group ×, no drag handle, and the
 * source tag is replaced by the owner's email. The row is still a plain `Link` to
 * `/agents/[id]` — nothing here enforces read-only, that's structural on the server
 * (constraint 1, plans/archive/15-share-agent.md §3); this only hides affordances that would
 * 404 anyway.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDraggable } from '@dnd-kit/core';
import type { AgentLiteDTO } from '@/lib/db/repository';
import { apiFetch } from '@/lib/apiFetch';

// Drag-to-group deferred 2026-08-07 at the user's request (pre-launch scope cut, alongside
// group creation and the Grouped view toggle) — the drag handle is hidden and dnd-kit's own
// `disabled` option stops a drag from starting even if something else still triggers it.
// Flip to true to re-enable.
const DRAG_ENABLED = false;

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
  /** Present for a "Shared with me" row — switches to the read-only variant (no
   *  delete, no drag handle, no group ×) and shows this address instead of the
   *  source tag. `onDeleted`/`groupId`/`onRemoveFromGroup` are ignored when set. */
  sharedOwnerEmail?: string;
}

export function AgentListItem({
  agent,
  isCurrent,
  groupId,
  onRemoveFromGroup,
  onDeleted,
  sharedOwnerEmail,
}: AgentListItemProps) {
  const router = useRouter();
  const isShared = sharedOwnerEmail !== undefined;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: agent.id,
    data: { agentId: agent.id },
    disabled: !DRAG_ENABLED || isShared,
  });

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;

    try {
      const response = await apiFetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
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
      const response = await apiFetch(`/api/agents/${agent.id}/groups/${groupId}`, {
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
      {/* Drag handle — hidden while DRAG_ENABLED is false, see top of file, or for a
          shared row (nothing to drag into a group you don't own membership of) */}
      {DRAG_ENABLED && !isShared && (
        <span
          {...listeners}
          {...attributes}
          className="cursor-grab active:cursor-grabbing text-[var(--faint)] text-[10px] flex-none select-none"
          title="Drag to add to group"
        >
          ⠿
        </span>
      )}

      {/* Avatar + name + source tag — ONE Link covering the whole flexible middle of
          the row (2026-08-31 live-testing feedback: clicking the tag or the empty
          space between name and tag did nothing — those weren't part of either of
          the two separate Links this used to be, so a click there could land on a
          bare text node and trigger the browser's/an extension's text-selection UI
          instead of navigating). Merged into one Link so every pixel of this middle
          section — avatar, name, empty flex space, tag — navigates the same way. */}
      <Link href={`/agents/${agent.id}`} className="flex-1 min-w-0 flex items-center gap-2">
        <span
          className={`w-5 h-5 rounded-[5px] grid place-items-center text-[10px] font-bold flex-none border border-[var(--border)] ${
            isCurrent
              ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
              : 'bg-[var(--elev)] text-[var(--muted)]'
          }`}
        >
          {monogram(agent.name)}
        </span>
        <span className="font-medium text-[var(--text)] truncate text-[13px]">{agent.name}</span>
        {/* Source tag — omitted entirely for a shared row (2026-08-31 live-testing
            feedback: the "shared · email" tag truncated badly in the narrow Library
            panel and was removed; the "SHARED WITH ME" section header already gives
            that context, and the owner's email is shown in full once the agent is
            open — §4.9 surface A still applies there, just not here). */}
        {!isShared && (
          <span className="ml-auto text-[9px] text-[var(--faint)] flex-none">{agent.source}</span>
        )}
      </Link>

      {/* Remove from group (×) — only shown inside a GroupSection, never for a shared row */}
      {!isShared && groupId && onRemoveFromGroup && (
        <button
          onClick={handleRemoveFromGroup}
          title={`Remove from group`}
          className="flex-none text-[10px] text-[var(--faint)] hover:text-[var(--err)] opacity-0 group-hover/row:opacity-100 transition-opacity ml-1"
        >
          ×
        </button>
      )}

      {/* Delete button — never shown for a shared row (a recipient cannot delete the owner's agent) */}
      {!isShared && (
        <button
          onClick={handleDelete}
          title={`Delete ${agent.name}`}
          className="flex-none text-[10px] text-[var(--faint)] hover:text-[var(--err)] opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          🗑
        </button>
      )}
    </div>
  );
}
