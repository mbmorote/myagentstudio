'use client';

/**
 * app/components/CustomViz/AgentView.tsx
 *
 * 2026-07-29 — Full editable config zone redesign (design decisions 1–17).
 * 2026-08-29 — Structural refactor (Plan 15, D1, §6 step 8.5): split from a single
 * 1899-line component into a thin shell (this file: header + name editing) plus
 * three focused pieces — ModelEffortControl (header, config-owned data),
 * ConfigZone (Zone 1), SectionsZone (Zone 2) — sharing config-save logic through
 * the useAgentConfigSave hook. Behavior-preserving: see plans/15-share-agent.md
 * §8 (D1) for the full analysis and each extracted file's own doc comment for
 * what moved and why. AccessZone (Zone 3, Plan 15's actual new feature) is not
 * part of this step — this step only prepares the ground for it.
 *
 * Config zone (Zone 1 — "Keys", now ConfigZone.tsx):
 *   - Zone label: [Config] badge + "Keys" text + collapse chevron + "+" add-key button.
 *   - Two-column scalar grid for set scalar fields (permissionMode/maxTurns/memory/
 *     background/isolation/color): label left, value pill right, hover-reveal × to remove.
 *   - Enum/bool scalars open a popover (not native <select>); int (maxTurns) uses inline
 *     input; color shows a small swatch in the pill.
 *   - Full-width list rows (tools/disallowedTools/skills): label + pills + "+ add" control.
 *     tools uses a searchable picker; disallowedTools/skills use inline text input.
 *   - initialPrompt: click-to-expand textarea block with Save/Cancel and outside-click-confirm.
 *   - Any datatype:'json' key (hooks, mcpServers), plus any nonstandard key, renders as a
 *     custom JSON block (pill row / full JSON / textarea, three tiers).
 *
 * Model+effort header control (decision 12, now ModelEffortControl.tsx):
 *   - Combined trigger button (top-right of card header): "model effort ▾"
 *   - Opens a popover: search box + model list + "Effort" footer row.
 *
 * Sections zone (Zone 2 — "Body", now SectionsZone.tsx):
 *   - Zone label: [Sections] badge + "Body" text + collapse chevron.
 *   - SectionBlocks: click header/chevron to collapse, click body text to edit.
 *   - Outside-click-confirm (in SectionBlock) and cross-editor coordination via resolveEditorRef.
 *
 * Persistence: PATCH /api/agents/[id] with full-replace config array — see
 * useAgentConfigSave.ts. Returns full AgentDTO; onAgentUpdated propagates it to
 * WorkbenchShell.
 */

import { useState, useRef } from 'react';
import type { AgentDTO, GroupDTO, ConfigDefLite, SectionDefLite } from '@/lib/db/repository';
import type { InteractionLock, CitedItem } from '@/app/components/WorkbenchShell';
import { SectionsZone } from '@/app/components/CustomViz/SectionsZone';
import { ConfigZone } from '@/app/components/CustomViz/ConfigZone';
import { ModelEffortControl } from '@/app/components/CustomViz/ModelEffortControl';
import { useAgentConfigSave } from '@/app/hooks/useAgentConfigSave';
import { apiFetch } from '@/lib/apiFetch';

// ─────────────────────────  Helpers  ───────────────────────────────────────

/** Two-character monogram from an agent name. */
function monogram(name: string): string {
  const parts = name.trim().split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toLowerCase();
  }
  return name.slice(0, 2).toLowerCase();
}

// ─────────────────────────  Props  ─────────────────────────────────────────

interface AgentViewProps {
  agent: AgentDTO;
  groups: GroupDTO[];
  /** Full config catalog, loaded fresh from the DB per page request (2026-07-29). */
  configCatalog: ConfigDefLite[];
  /** Full section catalog for this agent's platform, same freshness as configCatalog —
   *  powers the "+ Add section" menu (roadmap TODO item 1's non-chat half). */
  sectionCatalog: SectionDefLite[];
  interactionLock: InteractionLock;
  /** Sections/config blocks currently cited for chat (2026-07-31, frontend-only). */
  citedItems: CitedItem[];
  onToggleCite: (item: CitedItem, additive: boolean) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  onSectionSaved: (sectionId: string, content: string, newVersion: number) => void;
  onNameSaved: (name: string) => void;
  /** Called after any config PATCH — provides the full updated DTO from the server. */
  onAgentUpdated: (agent: AgentDTO) => void;
}

// ─────────────────────────  Component  ─────────────────────────────────────

export function AgentView({
  agent,
  groups,
  configCatalog,
  sectionCatalog,
  interactionLock,
  citedItems,
  onToggleCite,
  onEditStart,
  onEditEnd,
  onSectionSaved,
  onNameSaved,
  onAgentUpdated,
}: AgentViewProps) {
  const agentGroups = groups.filter((g) => g.memberAgentIds.includes(agent.id));

  // ── Interaction lock ──────────────────────────────────────────────────────
  // Extended in Plan 08 Phase 2 to also block on 'proposal' — closes the pre-existing
  // gap where config was editable mid-chat-call (§5.5), and blocks all editors while
  // a proposal is pending (§5.4).
  const canEdit = interactionLock !== 'chat' && interactionLock !== 'proposal';

  // ── Name editing state ────────────────────────────────────────────────────
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // ── Cross-editor coordination ref (passed to every SectionBlock and to
  // ConfigZone, which resolves it before opening the initial-prompt / a
  // custom-JSON-block editor) ───────────────────────────────────────────────
  const resolveEditorRef = useRef<(() => void) | null>(null);

  // ── Config save — shared between ModelEffortControl and ConfigZone.
  // configError is genuinely ONE piece of shared state (see the hook's doc
  // comment): a model-save failure surfaces in ConfigZone's error paragraph,
  // not near the model popover. ─────────────────────────────────────────────
  const { configError, setConfigError, currentConfigPairs, saveConfig, saveConfigKey, removeConfigKey } =
    useAgentConfigSave(agent, onAgentUpdated);

  // ── Name editing ──────────────────────────────────────────────────────────

  function startNameEdit() {
    if (!canEdit || isEditingName) return;
    setNameDraft(agent.name);
    setNameError(null);
    setIsEditingName(true);
    onEditStart();
  }

  function cancelNameEdit() {
    setIsEditingName(false);
    setNameDraft(agent.name);
    setNameError(null);
    onEditEnd();
  }

  async function saveNameEdit() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === agent.name) {
      cancelNameEdit();
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      const response = await apiFetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (response.ok) {
        onNameSaved(trimmed);
        setIsEditingName(false);
        onEditEnd();
      } else if (response.status === 409) {
        setNameError('An agent with that name already exists.');
      } else {
        setNameError('Save failed. Please try again.');
      }
    } catch {
      setNameError('Network error. Please try again.');
    } finally {
      setNameSaving(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-[14px_16px_20px] space-y-0">

      {/* ── Agent header ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 mb-[14px]">
        {/* Monogram avatar — theme accent only; design review 2026-08-06 item 1
            (tinting with the agent's own `color` config value) was reverted. */}
        <div className="w-[40px] h-[40px] rounded-[9px] bg-[var(--accent)] text-white flex-none grid place-items-center font-bold text-[17px]">
          {monogram(agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          {isEditingName ? (
            <div>
              <input
                autoFocus
                value={nameDraft}
                disabled={nameSaving}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void saveNameEdit()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveNameEdit();
                  if (e.key === 'Escape') cancelNameEdit();
                }}
                className="m-0 w-full text-[19px] font-semibold tracking-[-0.02em] text-[var(--text)] bg-[var(--bg)] border border-[var(--accent)] rounded-[6px] px-[6px] py-[1px] outline-none"
              />
              {nameError && (
                <p className="text-[11px] text-[var(--err)] mt-[3px]">{nameError}</p>
              )}
            </div>
          ) : (
            <h1
              onClick={startNameEdit}
              title={canEdit ? 'Click to rename' : (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress — rename disabled')}
              className={`m-0 text-[19px] font-semibold tracking-[-0.02em] text-[var(--text)] rounded-[6px] px-[6px] py-[1px] -mx-[6px] ${
                canEdit ? 'cursor-text hover:bg-[var(--bg)]' : ''
              }`}
            >
              {agent.name}
            </h1>
          )}
          <div className="text-[var(--muted)] text-[12px] mt-[2px]">
            {agent.description || <span className="italic text-[var(--err)]">description missing</span>}
            {' · '}
            <span>{agent.source === 'imported' ? 'imported into platform' : 'created in platform'}</span>
          </div>
          {/* Group membership pills */}
          {agentGroups.length > 0 && (
            <div className="flex flex-wrap gap-[6px] mt-[9px]">
              {agentGroups.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex items-center gap-[6px] text-[11px] px-[9px] py-[3px] rounded-full border border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent-wash)]"
                >
                  ◆ {g.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Model + effort header control (decision 12) */}
        <ModelEffortControl
          agent={agent}
          configCatalog={configCatalog}
          canEdit={canEdit}
          interactionLock={interactionLock}
          currentConfigPairs={currentConfigPairs}
          saveConfig={saveConfig}
          saveConfigKey={saveConfigKey}
          removeConfigKey={removeConfigKey}
        />
      </div>

      {/* ── Zone 1: Config Keys (extracted — Plan 15 §6 step 8.5) ──────────── */}
      <ConfigZone
        agent={agent}
        configCatalog={configCatalog}
        canEdit={canEdit}
        interactionLock={interactionLock}
        citedItems={citedItems}
        onToggleCite={onToggleCite}
        resolveEditorRef={resolveEditorRef}
        configError={configError}
        setConfigError={setConfigError}
        currentConfigPairs={currentConfigPairs}
        saveConfig={saveConfig}
        saveConfigKey={saveConfigKey}
        removeConfigKey={removeConfigKey}
      />

      {/* ── Zone 2: Sections Body (extracted — Plan 15 §6 step 8.5) ────────── */}
      <SectionsZone
        agent={agent}
        sectionCatalog={sectionCatalog}
        interactionLock={interactionLock}
        canEdit={canEdit}
        citedItems={citedItems}
        onToggleCite={onToggleCite}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
        onSectionSaved={onSectionSaved}
        onAgentUpdated={onAgentUpdated}
        resolveEditorRef={resolveEditorRef}
      />
    </div>
  );
}
