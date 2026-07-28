'use client';

/**
 * app/components/CustomViz/SectionBlock.tsx
 *
 * Plan 03 Phase B, B.8 — Added chevron expand/collapse (R14).
 *
 * Renders one section in the CustomViz pane. Matches the mockup's .sec/.sec-h/.sec-b:
 *   - Chevron (▾ expanded / ▸ collapsed) wrapping the existing content.
 *   - Collapse state is local useState, default expanded, resets on navigation (R15).
 *   - Existing raw-edit/interaction-lock behavior is unchanged — just gated behind expanded.
 *
 * Save path: PATCH /api/agents/[id]/sections/[sectionId] with {content, expectedVersion}.
 *   On 409 version_conflict: inline conflict notice, edit mode stays open.
 *   On success: onSaved(content, newVersion) propagates the new version up.
 *
 * Interaction lock (§6 rule 12, Rules Index #22):
 *   - Opening raw-edit with any change calls onEditStart() → lock='edit', chat disabled.
 *   - Saving or cancelling calls onEditEnd() → lock released.
 *   - While lock='chat', the "Edit" button is disabled.
 */

import { useState, useRef } from 'react';
import type { AgentDTO } from '@/lib/db/repository';
import type { InteractionLock } from '@/app/components/WorkbenchShell';

type SectionDTO = AgentDTO['sections'][number];

interface SectionBlockProps {
  agentId: string;
  section: SectionDTO;
  interactionLock: InteractionLock;
  onEditStart: () => void;
  onEditEnd: () => void;
  onSaved: (content: string, newVersion: number) => void;
}

export function SectionBlock({
  agentId,
  section,
  interactionLock,
  onEditStart,
  onEditEnd,
  onSaved,
}: SectionBlockProps) {
  // R14: chevron expand/collapse, default expanded, local state only (R15)
  const [expanded, setExpanded] = useState(true);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(section.content);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const displayHeading = section.heading ?? `# ${section.sectionKey.toUpperCase()}`;
  const sectionLabel = section.def?.label ?? section.sectionKey;
  const isCore = section.def?.isCore ?? false;

  function handleChevronClick() {
    if (isEditing) return; // don't collapse while editing
    setExpanded((v) => !v);
  }

  function handleEditToggle() {
    if (isEditing) return;
    setEditContent(section.content);
    setHasUnsavedChanges(false);
    setConflictNotice(null);
    setIsEditing(true);
  }

  function handleContentChange(value: string) {
    setEditContent(value);
    if (!hasUnsavedChanges) {
      setHasUnsavedChanges(true);
      onEditStart();
    }
  }

  function handleCancel() {
    setIsEditing(false);
    setEditContent(section.content);
    setHasUnsavedChanges(false);
    setConflictNotice(null);
    if (hasUnsavedChanges) {
      onEditEnd();
    }
  }

  async function handleSave() {
    if (isSaving) return;
    setIsSaving(true);
    setConflictNotice(null);

    try {
      const response = await fetch(
        `/api/agents/${agentId}/sections/${section.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: editContent,
            expectedVersion: section.version,
          }),
        },
      );

      if (response.ok) {
        const result = (await response.json()) as { content: string; version: number };
        onSaved(result.content, result.version);
        setIsEditing(false);
        setHasUnsavedChanges(false);
        onEditEnd();
      } else if (response.status === 409) {
        const err = (await response.json()) as { error: string; current: number };
        setConflictNotice(
          `Version conflict (current version: ${err.current}). ` +
            'Another edit was saved while you were editing. Reload and try again.',
        );
      } else {
        setConflictNotice('Save failed. Please try again.');
      }
    } catch {
      setConflictNotice('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  const canEdit = interactionLock !== 'chat';

  return (
    /* .sec — matches mockup's section block */
    <div className="border border-[var(--border)] rounded-[9px] mb-[9px] bg-[var(--elev)] overflow-hidden">
      {/* .sec-h — header with chevron */}
      <div
        className="flex items-center gap-2 px-3 py-[9px] cursor-pointer"
        onClick={handleChevronClick}
      >
        <span className="text-[var(--faint)] text-[10px]">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="font-semibold text-[12px] tracking-[.02em] text-[var(--text)]">
          {sectionLabel.toUpperCase()}
        </span>
        {isCore && (
          <span className="ml-auto text-[9px] text-[var(--faint)] uppercase tracking-[.06em]">
            core
          </span>
        )}
        {hasUnsavedChanges && (
          <span className="ml-auto text-[9.5px] text-[var(--accent-ink)] bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[5px] px-[7px] py-[1px] tracking-[.02em]">
            edited
          </span>
        )}
        {/* Edit button — shown in header when collapsed or when not editing */}
        {!isEditing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!expanded) setExpanded(true);
              handleEditToggle();
            }}
            disabled={!canEdit}
            title={!canEdit ? 'Chat is in progress — raw edit disabled' : 'Edit raw content'}
            className="ml-2 rounded px-2 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Edit
          </button>
        )}
      </div>

      {/* .sec-b — body, shown only when expanded */}
      {expanded && (
        <div>
          {isEditing ? (
            <div className="px-3 pb-3 pl-[30px]">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => handleContentChange(e.target.value)}
                rows={Math.max(6, editContent.split('\n').length + 2)}
                className="w-full resize-y rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[12px] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                placeholder="Section content…"
              />
              {conflictNotice && (
                <p className="mt-1 rounded px-2 py-1 text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)]">
                  {conflictNotice}
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !hasUnsavedChanges}
                  className="rounded bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="rounded px-3 py-1 text-[12px] text-[var(--muted)] hover:bg-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap px-3 pb-3 pl-[30px] font-mono text-[12px] leading-[1.5] text-[var(--muted)]">
              {section.content || (
                <span className="italic text-[var(--faint)]">(empty)</span>
              )}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
