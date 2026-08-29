'use client';

/**
 * app/components/CustomViz/SectionsZone.tsx
 *
 * Plan 15 (D1, §6 step 8.5) — extracted from AgentView.tsx's Zone 2 ("[Sections]
 * Body"). Behavior-preserving extraction: this zone was already nearly
 * self-contained in the monolith (3 state vars, ~50 render lines, delegating the
 * real per-section work to the already-separate SectionBlock) — pulling it out is
 * mechanical, not a redesign.
 *
 * Cross-zone editor coordination stays exactly as it was: `resolveEditorRef` is a
 * single shared ref AgentView creates once and passes to both this zone (which
 * threads it into every SectionBlock) and ConfigZone. Coordination is
 * one-directional today (Config-zone editors resolve an open SectionBlock editor
 * via this ref; a SectionBlock opening does NOT resolve an open Config-zone
 * editor) — that asymmetry is pre-existing behavior from the monolith, not
 * something this extraction changes.
 */

import { useState } from 'react';
import type { AgentDTO, SectionDefLite } from '@/lib/db/repository';
import type { InteractionLock, CitedItem } from '@/app/components/WorkbenchShell';
import { SectionBlock, sectionDisplayLabel } from '@/app/components/CustomViz/SectionBlock';
import { apiFetch } from '@/lib/apiFetch';
import { useOutsideClick } from '@/app/hooks/useOutsideClick';

interface SectionsZoneProps {
  agent: AgentDTO;
  sectionCatalog: SectionDefLite[];
  interactionLock: InteractionLock;
  canEdit: boolean;
  citedItems: CitedItem[];
  onToggleCite: (item: CitedItem, additive: boolean) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  onSectionSaved: (sectionId: string, content: string, newVersion: number) => void;
  onAgentUpdated: (agent: AgentDTO) => void;
  resolveEditorRef: React.MutableRefObject<(() => void) | null>;
}

export function SectionsZone({
  agent,
  sectionCatalog,
  interactionLock,
  canEdit,
  citedItems,
  onToggleCite,
  onEditStart,
  onEditEnd,
  onSectionSaved,
  onAgentUpdated,
  resolveEditorRef,
}: SectionsZoneProps) {
  const setSectionKeys = new Set(agent.sections.map((s) => s.sectionKey));
  const unsetSectionCatalog = sectionCatalog.filter((d) => !setSectionKeys.has(d.key));

  const [sectionsCollapsed, setSectionsCollapsed] = useState(false);
  const [addSectionMenuOpen, setAddSectionMenuOpen] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);

  useOutsideClick(addSectionMenuOpen, '[data-addsection-anchor]', () => setAddSectionMenuOpen(false));

  // ── Add / remove section (roadmap TODO item 1's non-chat half, 2026-08-07) ──
  // Chat-driven section add/delete stays deferred; this is the manual, structured-
  // view path only — POST/DELETE /api/agents/[id]/sections[/[sectionId]].

  async function addSectionFromCatalog(def: SectionDefLite): Promise<void> {
    if (!canEdit) return;
    setAddSectionMenuOpen(false);
    setSectionError(null);
    try {
      const res = await apiFetch(`/api/agents/${agent.id}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKey: def.key, heading: def.defaultHeading, content: def.template }),
      });
      if (res.ok) {
        const { agent: updated } = (await res.json()) as { agent: AgentDTO };
        onAgentUpdated(updated);
      } else {
        setSectionError('Could not add the section. Please try again.');
      }
    } catch {
      setSectionError('Network error. Please try again.');
    }
  }

  /** "+ custom section…" — a genuinely nonstandard section, not in sectionCatalog at
   *  all. Mirrors addCustomKey's config-side counterpart: sectionKey becomes 'custom'
   *  (same key Daedalus/Hermes give an unmatched heading), heading is the user's own
   *  text, content starts empty. */
  async function addCustomSection(): Promise<void> {
    if (!canEdit) return;
    setAddSectionMenuOpen(false);
    const raw = window.prompt('Section heading (e.g. "# MISSION"):');
    const heading = raw?.trim();
    if (!heading) return;
    setSectionError(null);
    try {
      const res = await apiFetch(`/api/agents/${agent.id}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKey: 'custom', heading, content: '' }),
      });
      if (res.ok) {
        const { agent: updated } = (await res.json()) as { agent: AgentDTO };
        onAgentUpdated(updated);
      } else {
        setSectionError('Could not add the section. Please try again.');
      }
    } catch {
      setSectionError('Network error. Please try again.');
    }
  }

  async function removeSection(sectionId: string): Promise<void> {
    setSectionError(null);
    try {
      const res = await apiFetch(`/api/agents/${agent.id}/sections/${sectionId}`, { method: 'DELETE' });
      if (res.ok) {
        onAgentUpdated({ ...agent, sections: agent.sections.filter((s) => s.id !== sectionId) });
      } else {
        setSectionError('Could not remove the section. Please try again.');
      }
    } catch {
      setSectionError('Network error. Please try again.');
    }
  }

  function renderAddSectionButton() {
    return (
      <span data-addsection-anchor className="relative inline-block ml-[6px]">
        <button
          type="button"
          disabled={!canEdit}
          title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : 'Add a section'}
          onClick={(e) => { e.stopPropagation(); setAddSectionMenuOpen((v) => !v); }}
          className="w-[16px] h-[16px] rounded-[5px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[12px] font-bold grid place-items-center cursor-pointer hover:text-[var(--text)] hover:border-[var(--text)] p-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          +
        </button>
        {addSectionMenuOpen && (
          <div
            className="absolute z-30 top-full left-0 mt-[4px] min-w-[200px] bg-[var(--elev)] border border-[var(--border)] rounded-[10px] shadow-[0_10px_30px_rgba(0,0,0,.18)] overflow-hidden py-[4px]"
            onClick={(e) => e.stopPropagation()}
          >
            {unsetSectionCatalog.length ? (
              unsetSectionCatalog.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => void addSectionFromCatalog(d)}
                  className="flex items-center gap-[6px] w-full px-[12px] py-[7px] text-[12px] font-sans text-[var(--text)] hover:bg-[var(--accent-wash)] cursor-pointer text-left"
                >
                  {d.defaultHeading.replace(/^#+\s*/, '')}
                </button>
              ))
            ) : (
              <div className="px-[12px] py-[10px] text-[11.5px] text-[var(--faint)] italic">
                All catalog sections are present
              </div>
            )}
            {/* "+ custom section…" — mirrors "+ custom key…" above: a genuinely
                nonstandard section (unknown to sectionCatalog) should still be addable. */}
            <button
              type="button"
              onClick={() => void addCustomSection()}
              className="flex items-center gap-[6px] w-full px-[12px] py-[7px] text-[12px] font-sans text-[var(--text)] hover:bg-[var(--accent-wash)] cursor-pointer text-left border-t border-[var(--border)]"
            >
              + custom section…
            </button>
          </div>
        )}
      </span>
    );
  }

  return (
    <div>
      {/* Zone label: [Sections] Body ▾ ─────── */}
      <div
        className="flex items-center gap-[8px] mt-[18px] mb-[9px] text-[var(--faint)] text-[10px] font-bold tracking-[.09em] uppercase cursor-pointer select-none"
        onClick={() => setSectionsCollapsed((v) => !v)}
        title={sectionsCollapsed ? 'Expand sections' : 'Collapse sections'}
      >
        <span className="text-[var(--accent)] border border-[var(--accent)] rounded-[4px] px-[5px] text-[9px] tracking-[.03em]">
          Sections
        </span>
        Body
        <span className="text-[var(--faint)] text-[9px]">{sectionsCollapsed ? '▸' : '▾'}</span>
        {renderAddSectionButton()}
        <span className="flex-1 h-px bg-[var(--border)]" />
      </div>

      {sectionError && (
        <p className="mb-[9px] text-[11px] text-[var(--err)]">{sectionError}</p>
      )}

      {!sectionsCollapsed && (
        <div className="space-y-[9px]">
          {agent.sections.map((section) => (
            <SectionBlock
              key={section.id}
              agentId={agent.id}
              section={section}
              interactionLock={interactionLock}
              isCited={citedItems.some((c) => c.type === 'section' && c.key === section.sectionKey)}
              onToggleCite={(additive) =>
                onToggleCite(
                  { type: 'section', key: section.sectionKey, label: sectionDisplayLabel(section) },
                  additive,
                )
              }
              onEditStart={onEditStart}
              onEditEnd={onEditEnd}
              resolveEditorRef={resolveEditorRef}
              onSaved={(content, newVersion) =>
                onSectionSaved(section.id, content, newVersion)
              }
              onRemove={() => void removeSection(section.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
