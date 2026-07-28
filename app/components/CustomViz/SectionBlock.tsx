'use client';

/**
 * app/components/CustomViz/SectionBlock.tsx
 *
 * Phase 4.3 — One section in the CustomViz pane.
 *
 * Renders:
 *   - Heading (from section.heading, or the sectionKey as a fallback)
 *   - Content in read mode (pre-formatted markdown text)
 *   - Raw-edit toggle button (disabled when interaction lock is 'chat')
 *   - In edit mode: a <textarea> with the current content + Save / Cancel buttons
 *
 * Interaction lock (§6 rule 12, §7, Rules Index #22):
 *   - Opening raw-edit with any change in the textarea calls onEditStart() →
 *     WorkbenchShell sets interactionLock to 'edit', disabling chat.
 *   - Saving or cancelling raw-edit calls onEditEnd() → lock released.
 *   - While interactionLock === 'chat', the "Edit" button is disabled.
 *
 * Save path: PATCH /api/agents/[id]/sections/[sectionId] with {content, expectedVersion}.
 *   On 409 version_conflict, shows an inline conflict notice without losing the user's edit.
 *   On success, calls onSaved(content, newVersion) to propagate the new version up.
 *
 * No section-selection for chat (D2 removed that — chat is agent-scoped, §4.3 spec).
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
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(section.content);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const displayHeading =
    section.heading ?? `# ${section.sectionKey.toUpperCase()}`;

  // The section key label from the def, or a formatted fallback
  const sectionLabel = section.def?.label ?? section.sectionKey;

  function handleEditToggle() {
    if (isEditing) return; // already editing
    setEditContent(section.content);
    setHasUnsavedChanges(false);
    setConflictNotice(null);
    setIsEditing(true);
    // Lock is engaged only when the user actually makes a change (below)
  }

  function handleContentChange(value: string) {
    setEditContent(value);
    if (!hasUnsavedChanges) {
      setHasUnsavedChanges(true);
      onEditStart(); // Engage interaction lock (Rules Index #22)
    }
  }

  function handleCancel() {
    setIsEditing(false);
    setEditContent(section.content);
    setHasUnsavedChanges(false);
    setConflictNotice(null);
    if (hasUnsavedChanges) {
      onEditEnd(); // Release lock only if we had engaged it
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
        onEditEnd(); // Release interaction lock
      } else if (response.status === 409) {
        const err = (await response.json()) as { error: string; current: number };
        setConflictNotice(
          `Version conflict (current version: ${err.current}). ` +
            'Another edit was saved while you were editing. Reload and try again.',
        );
        // Keep edit mode open so the user can decide
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
    <div className="rounded-md border border-border bg-background">
      {/* ── Section header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs font-semibold uppercase text-muted-foreground">
            {sectionLabel}
          </span>
          <span className="text-xs text-muted-foreground/60">{displayHeading}</span>
          <span className="text-xs text-muted-foreground/40">v{section.version}</span>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <button
              onClick={handleEditToggle}
              disabled={!canEdit}
              title={
                !canEdit ? 'Chat is in progress — raw edit disabled' : 'Edit raw content'
              }
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* ── Content area ───────────────────────────────────────────────── */}
      {isEditing ? (
        <div className="p-3">
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => handleContentChange(e.target.value)}
            rows={Math.max(6, editContent.split('\n').length + 2)}
            className="w-full resize-y rounded border border-border bg-muted/20 p-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Section content…"
          />
          {conflictNotice && (
            <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
              {conflictNotice}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges}
              className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="rounded px-3 py-1 text-xs text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <pre className="whitespace-pre-wrap px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
          {section.content || (
            <span className="text-muted-foreground italic">(empty)</span>
          )}
        </pre>
      )}
    </div>
  );
}
