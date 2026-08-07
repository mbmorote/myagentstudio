'use client';

/**
 * app/components/CustomViz/SectionBlock.tsx
 *
 * Plan 03 Phase B, B.8 — Added chevron expand/collapse (R14).
 * 2026-07-29 — Editable zone redesign additions:
 *   - Click body text to enter edit mode (item 15).
 *   - Outside-click-confirm: silently exits if unchanged; confirm-dialog if
 *     changed (item 15). Uses a stable handler ref so the effect never goes stale.
 *   - Cross-editor coordination via resolveEditorRef (item 16): before opening,
 *     resolves whichever editor is currently registered in the shared ref.
 *     Registers its own resolve function when entering edit mode; unregisters on exit.
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

import { useState, useEffect, useRef } from 'react';
import type { AgentDTO } from '@/lib/db/repository';
import type { InteractionLock } from '@/app/components/WorkbenchShell';
import { apiFetch } from '@/lib/apiFetch';

type SectionDTO = AgentDTO['sections'][number];

/** Catalog label when one exists; otherwise the section's own heading text (custom
 *  sections have no catalog def), stripped of its leading '#'s — e.g. a Daedalus-named
 *  custom block "# MISSION" displays as "MISSION" instead of the generic sectionKey
 *  "custom". Falls back to sectionKey only for a headingless preamble block, where
 *  there's genuinely no name to show. */
export function sectionDisplayLabel(section: SectionDTO): string {
  return section.def?.label ?? section.heading?.replace(/^#+\s*/, '') ?? section.sectionKey;
}

interface SectionBlockProps {
  agentId: string;
  section: SectionDTO;
  interactionLock: InteractionLock;
  onEditStart: () => void;
  onEditEnd: () => void;
  onSaved: (content: string, newVersion: number) => void;
  /** Shared mutable ref for cross-editor coordination (item 16).
   *  AgentView creates one ref and passes it to all SectionBlocks and the config
   *  zone. Before opening its own editor, each block calls whatever is currently
   *  stored here (to resolve the previously open editor), then stores its own
   *  resolve function so the next caller can do the same. */
  resolveEditorRef: React.MutableRefObject<(() => void) | null>;
  /** Whether this section is currently cited for the chat (2026-07-31, frontend-only). */
  isCited: boolean;
  /** Click (replace-select) / Ctrl-click (add-to-selection) toggles citation. */
  onToggleCite: (additive: boolean) => void;
}

export function SectionBlock({
  agentId,
  section,
  interactionLock,
  onEditStart,
  onEditEnd,
  onSaved,
  resolveEditorRef,
  isCited,
  onToggleCite,
}: SectionBlockProps) {
  // R14: chevron expand/collapse, default expanded, local state only (R15)
  const [expanded, setExpanded] = useState(true);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(section.content);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);

  const sectionLabel = sectionDisplayLabel(section);
  const isCore = section.def?.isCore ?? false;

  // ── Stable "resolve" function (item 16) ─────────────────────────────────────
  // Stable handler ref: updated every render with the latest state values, but the
  // Effect and resolveEditorRef.current always call a single stable wrapper that
  // delegates to the latest version, avoiding stale-closure issues.
  const resolveHandlerRef = useRef<() => void>(() => {});
  resolveHandlerRef.current = () => {
    if (!isEditing) return;
    if (!hasUnsavedChanges) {
      setIsEditing(false);
      return;
    }
    if (window.confirm(`Save changes to ${sectionLabel.toUpperCase()}?`)) {
      // Fire-and-forget: the save completes in the background
      void doSave(editContent);
    } else {
      doCancel();
    }
  };

  // ── Outside-click-confirm handler (item 15) ────────────────────────────────
  // Also a stable handler ref: always uses the latest state values.
  const outsideClickHandlerRef = useRef<(e: MouseEvent) => void>(() => {});
  outsideClickHandlerRef.current = (e: MouseEvent) => {
    if (!isEditing) return;
    if (blockRef.current?.contains(e.target as Node)) return;
    resolveHandlerRef.current();
  };

  // Register the mousedown listener only while this block is in edit mode.
  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: MouseEvent) => outsideClickHandlerRef.current(e);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isEditing]);

  function handleChevronClick() {
    if (isEditing) return; // don't collapse while editing
    setExpanded((v) => !v);
  }

  function handleEditToggle() {
    if (isEditing) return;
    // Item 16: resolve whichever other editor is currently open.
    if (resolveEditorRef.current) {
      resolveEditorRef.current();
    }
    // Register our own resolve so the next editor can resolve us.
    resolveEditorRef.current = () => resolveHandlerRef.current();
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

  function doCancel() {
    setIsEditing(false);
    setEditContent(section.content);
    setHasUnsavedChanges(false);
    setConflictNotice(null);
    if (hasUnsavedChanges) {
      onEditEnd();
    }
    // Unregister from resolveEditorRef if we're still the registered resolver.
    // (Check by value is unreliable, so always null it — the next editor will
    // overwrite it anyway, and if no editor is open null is the correct state.)
    resolveEditorRef.current = null;
  }

  function handleCancel() {
    doCancel();
  }

  async function doSave(content: string) {
    if (isSaving) return;
    setIsSaving(true);
    setConflictNotice(null);

    try {
      const response = await apiFetch(
        `/api/agents/${agentId}/sections/${section.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
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
        resolveEditorRef.current = null;
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

  async function handleSave() {
    await doSave(editContent);
  }

  const canEdit = interactionLock !== 'chat' && interactionLock !== 'proposal';

  return (
    /* .sec — matches mockup's section block */
    <div
      ref={blockRef}
      data-citable
      className={`border rounded-[9px] mb-[9px] bg-[var(--elev)] overflow-hidden ${
        isCited ? 'border-[var(--accent)]' : 'border-[var(--border)]'
      }`}
    >
      {/* .sec-h — header with chevron. cursor-pointer + hover bg (2026-08-06): a
          structural/toggle zone, distinct from the cite zone below (cursor-alias). */}
      <div
        className="flex items-center gap-2 px-3 py-[9px] cursor-pointer hover:bg-[var(--bg)]"
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
        {/* Edit / Save+Cancel — shown top-right of the header, same slot either way
            (2026-07-31: matches the custom JSON block's top-right Save/Cancel). */}
        {isEditing ? (
          <span
            onClick={(e) => e.stopPropagation()}
            className="ml-2 flex items-center gap-[6px]"
          >
            <button
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges}
              className="rounded px-2 py-0.5 text-[11px] font-semibold bg-[var(--accent)] text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="rounded px-2 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!expanded) setExpanded(true);
              handleEditToggle();
            }}
            disabled={!canEdit}
            title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress — raw edit disabled') : 'Edit raw content'}
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
            </div>
          ) : (
            /* 2026-07-31: click cites this section for the chat; double-click edits
               (was: click to edit — that's now the Edit button or a double-click). */
            <pre
              onClick={(e) => {
                e.stopPropagation();
                onToggleCite(e.ctrlKey || e.metaKey);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!canEdit) return;
                if (!expanded) setExpanded(true);
                handleEditToggle();
              }}
              title="Click to cite in chat · double-click to edit"
              className="whitespace-pre-wrap px-3 pb-3 pl-[30px] font-mono text-[12px] leading-[1.5] text-[var(--muted)] cursor-alias hover:text-[var(--text)] hover:bg-[var(--accent-wash)]"
            >
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
