'use client';

/**
 * app/components/CustomViz/ModelEffortControl.tsx
 *
 * Plan 15 (D1, §6 step 8.5) — extracted from AgentView.tsx's renderModelEffort().
 * Rendered in the agent HEADER (top-right, next to the name), NOT inside the
 * collapsible "[Config] Keys" zone body — a pre-existing architectural wrinkle from
 * the monolith, named explicitly here rather than silently carried forward: this
 * control edits config-zone DATA (the `model`/`effort` keys) but lives visually in
 * the header. This extraction does not change that placement (AgentView still
 * renders this component in its header JSX, not inside ConfigZone) — moving it
 * would be a visual change, and this refactor is behavior-preserving only.
 *
 * Does NOT call resolveConfigEditors/resolveAllEditors before opening — this is
 * pre-existing behavior from the monolith (the original trigger button's onClick
 * never called either), not an omission introduced by this extraction. Opening this
 * popover does not resolve an open initial-prompt/custom-JSON-block/section editor,
 * and vice versa.
 */

import { useState, useMemo } from 'react';
import type { AgentDTO, ConfigDefLite } from '@/lib/db/repository';
import type { InteractionLock } from '@/app/components/WorkbenchShell';
import { useOutsideClick } from '@/app/hooks/useOutsideClick';

const EFFORT_OPTS: { value: string | null; label: string; hint?: string }[] = [
  { value: null, label: 'Default', hint: 'Model default — removes the effort key' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
];

interface ModelEffortControlProps {
  agent: AgentDTO;
  configCatalog: ConfigDefLite[];
  canEdit: boolean;
  interactionLock: InteractionLock;
  currentConfigPairs: () => { propKey: string; value: unknown }[];
  saveConfig: (rows: { propKey: string; value: unknown }[]) => Promise<void>;
  saveConfigKey: (key: string, value: unknown) => Promise<void>;
  removeConfigKey: (key: string) => Promise<void>;
}

export function ModelEffortControl({
  agent,
  configCatalog,
  canEdit,
  interactionLock,
  currentConfigPairs,
  saveConfig,
  saveConfigKey,
  removeConfigKey,
}: ModelEffortControlProps) {
  const modelDef = useMemo(() => configCatalog.find((d) => d.key === 'model') ?? null, [configCatalog]);
  const configMap = new Map(agent.config.map((c) => [c.propKey, c.value]));

  const modelValue = (configMap.get('model') as string) ?? 'inherit';
  const effortValue = configMap.has('effort') ? (configMap.get('effort') as string) : null;
  const effortLabel = EFFORT_OPTS.find((o) => o.value === effortValue)?.label ?? effortValue ?? 'Default';
  const modelOptions = (modelDef?.allowedValues ?? []) as readonly string[];
  const modelBad = !modelOptions.includes(modelValue);

  const [meOpen, setMeOpen] = useState(false);
  const [meFilter, setMeFilter] = useState('');
  const [meEffortOpen, setMeEffortOpen] = useState(false);

  useOutsideClick(meOpen, '[data-me-area]', () => {
    setMeOpen(false);
    setMeEffortOpen(false);
  });

  async function saveModel(newModel: string) {
    if (newModel === modelValue) return;
    const without = currentConfigPairs().filter((c) => c.propKey !== 'model');
    await saveConfig([...without, { propKey: 'model', value: newModel }]);
    setMeOpen(false);
    setMeEffortOpen(false);
  }

  async function saveEffort(newEffort: string | null) {
    if (newEffort === null) {
      await removeConfigKey('effort');
    } else {
      await saveConfigKey('effort', newEffort);
    }
    setMeEffortOpen(false);
    setMeOpen(false);
  }

  const filteredModels = modelOptions.filter((m) =>
    m.toLowerCase().includes(meFilter.toLowerCase()),
  );
  // Include current model even if it doesn't match the filter (and it's not in the list)
  const modelsToShow =
    !modelOptions.includes(modelValue) && !filteredModels.includes(modelValue)
      ? [...filteredModels, modelValue]
      : filteredModels;

  return (
    <div data-me-area className="relative flex-none ml-auto">
      {/* Trigger button */}
      <button
        type="button"
        disabled={!canEdit}
        onClick={(e) => { e.stopPropagation(); setMeOpen((v) => !v); setMeFilter(''); setMeEffortOpen(false); }}
        title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress — model edit disabled') : (modelBad ? `'${modelValue}' is not a current recognized model value.` : 'Model & effort')}
        className={`flex items-center gap-[8px] font-mono text-[11px] border rounded-[7px] px-[10px] py-[5px] bg-[var(--elev)] appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${
          canEdit ? 'cursor-pointer' : ''
        } ${
          modelBad
            ? 'border-[var(--warn)] text-[var(--warn)]'
            : 'border-[var(--border)] text-[var(--text)]'
        }`}
      >
        {modelBad && <span>⚠ </span>}
        {modelValue}
        <span className="text-[var(--faint)] font-sans text-[10px]">{effortLabel}</span>
        <span className="text-[var(--faint)] text-[9px] ml-[2px]">▾</span>
      </button>

      {/* Model panel */}
      {meOpen && (
        <div
          className="absolute z-30 top-full right-0 mt-[6px] w-[260px] bg-[var(--elev)] border border-[var(--border)] rounded-[10px] shadow-[0_10px_30px_rgba(0,0,0,.18)] text-left"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={meFilter}
            placeholder="Search models"
            onChange={(e) => setMeFilter(e.target.value)}
            className="w-full box-border font-inherit text-[12px] px-[12px] py-[9px] border-b border-[var(--border)] bg-transparent text-[var(--text)] outline-none rounded-t-[10px]"
          />
          <div className="max-h-[220px] overflow-y-auto py-[4px]">
            {modelsToShow.length ? (
              modelsToShow.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => void saveModel(m)}
                  className="flex items-center justify-between gap-2 w-full px-[12px] py-[7px] text-[12px] font-mono text-[var(--text)] hover:bg-[var(--accent-wash)] cursor-pointer"
                >
                  <span>{m}</span>
                  {m === modelValue && <span className="text-[var(--accent)] font-bold font-sans">✓</span>}
                </button>
              ))
            ) : (
              <div className="px-[12px] py-[10px] text-[11.5px] text-[var(--faint)] italic">No matches</div>
            )}
          </div>
          {/* Effort footer row */}
          <div
            className="relative flex items-center justify-between px-[12px] py-[9px] border-t border-[var(--border)] bg-[var(--bg)] rounded-b-[10px] cursor-pointer text-[var(--text)] hover:bg-[var(--accent-wash)]"
            onClick={(e) => { e.stopPropagation(); setMeEffortOpen((v) => !v); }}
          >
            <span className="text-[9.5px] font-bold uppercase tracking-[.05em] text-[var(--faint)]">Effort</span>
            <span className="flex items-center gap-[5px] text-[12px] font-sans text-[var(--muted)]">{effortLabel} ›</span>

            {/* Effort side panel — floats to the LEFT of the model panel */}
            {meEffortOpen && (
              <div
                className="absolute z-31 right-full bottom-0 mr-[6px] w-[230px] bg-[var(--elev)] border border-[var(--border)] rounded-[10px] shadow-[0_10px_30px_rgba(0,0,0,.18)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-[12px] pt-[10px] pb-[4px] text-[11px] text-[var(--faint)] leading-[1.4]">
                  How thoroughly Claude responds; lower effort saves tokens.
                </div>
                <div className="py-[4px]">
                  {EFFORT_OPTS.map((opt) => (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => void saveEffort(opt.value)}
                      className="flex items-center w-full px-[12px] py-[7px] text-[12px] font-sans text-[var(--text)] hover:bg-[var(--accent-wash)] cursor-pointer gap-[6px]"
                    >
                      <span className="flex-1 text-left">{opt.label}</span>
                      {opt.hint && <span className="text-[10.5px] text-[var(--faint)]">{opt.hint}</span>}
                      {opt.value === effortValue && <span className="text-[var(--accent)] font-bold">✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
