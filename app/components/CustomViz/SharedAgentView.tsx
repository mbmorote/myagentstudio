'use client';

/**
 * app/components/CustomViz/SharedAgentView.tsx
 *
 * Plan 15 — Share Agent, §4.9 surface C / §8 D1. What a recipient sees at
 * `/agents/[id]` — a SEPARATE root from AgentView, not the owner's view with edit
 * affordances hidden by CSS (D1's real decision, plans/15-share-agent.md §8): a missed
 * branch here is a control that simply doesn't exist, never a live edit control that
 * 404s. Read-only: name, description, config, sections. No banner here (2026-08-31
 * live-testing feedback: "no alert... should not exist") — who shared it, and the
 * Copy-to-me/Export actions, live in the Custom Visualization panel's own title bar
 * instead (WorkbenchShell + SharedAgentActions.tsx), not repeated in an alert box below it.
 *
 * Config rendering (revised same day, second round of live-testing feedback — "should
 * be regular one with read-only", i.e. match ConfigZone.tsx's actual pill-based
 * layout, not a bespoke boxed key/value grid): SCALAR_KEY_ORDER/LIST_KEY_ORDER below
 * are duplicated from ConfigZone.tsx rather than imported — small, stable, rarely-
 * changing arrays; the same "controlled duplication at small grain" call the plan's
 * own D1 reuse-decision already made about this component pair. `model`/`effort` are
 * deliberately excluded: the owner's view shows them via ModelEffortControl in the
 * header, not as Config Keys rows, and this read-only view has no header control to
 * put them in either, so they're just omitted rather than faked into a spot they
 * never occupy in the real layout.
 */

import type { AgentDTO } from '@/lib/db/repository';

interface SharedAgentViewProps {
  agent: AgentDTO;
}

function monogram(name: string): string {
  const parts = name.trim().split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toLowerCase();
  }
  return name.slice(0, 2).toLowerCase();
}

function formatConfigValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Mirrors ConfigZone.tsx's own SCALAR_KEY_ORDER/LIST_KEY_ORDER exactly, including the
// model/effort exclusion (see file doc comment above).
const SCALAR_KEY_ORDER = ['permissionMode', 'maxTurns', 'memory', 'background', 'isolation', 'color'];
const LIST_KEY_ORDER = ['tools', 'disallowedTools', 'skills'];
const HEADER_OWNED_KEYS = new Set(['model', 'effort']);

const READONLY_PILL = 'inline-flex items-center text-[10.5px] font-mono px-[8px] py-[2px] rounded-full border border-[var(--border)] text-[var(--text)] bg-[var(--elev)]';
const CONFIG_ROW_LABEL = 'flex-none text-right text-[10px] text-[var(--accent-ink)] opacity-80 w-[104px] pt-[4px]';

export function SharedAgentView({ agent }: SharedAgentViewProps) {
  const configByKey = new Map(agent.config.map((c) => [c.propKey, c]));
  const scalarEntries = SCALAR_KEY_ORDER.map((k) => configByKey.get(k)).filter((c): c is (typeof agent.config)[number] => !!c);
  const listEntries = LIST_KEY_ORDER.map((k) => configByKey.get(k)).filter((c): c is (typeof agent.config)[number] => !!c);
  const orderedKeys = new Set([...SCALAR_KEY_ORDER, ...LIST_KEY_ORDER]);
  const otherEntries = agent.config.filter((c) => !orderedKeys.has(c.propKey) && !HEADER_OWNED_KEYS.has(c.propKey));
  const hasAnyConfig = scalarEntries.length > 0 || listEntries.length > 0 || otherEntries.length > 0;

  return (
    <div className="p-[14px_16px_20px]">
      {/* Header — same monogram/name/description convention as AgentView, no edit affordances */}
      <div className="flex items-start gap-3 mb-[14px]">
        <div className="w-[40px] h-[40px] rounded-[9px] bg-[var(--accent)] text-white flex-none grid place-items-center font-bold text-[17px]">
          {monogram(agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[19px] font-semibold tracking-[-0.02em] text-[var(--text)]">{agent.name}</h1>
          <div className="text-[var(--muted)] text-[12px] mt-[2px]">
            {agent.description || <span className="italic text-[var(--err)]">description missing</span>}
          </div>
        </div>
      </div>

      {/* Config — read-only */}
      <div className="flex items-center gap-[8px] mt-[18px] mb-[9px] text-[var(--faint)] text-[10px] font-bold tracking-[.09em] uppercase select-none">
        <span className="text-[var(--accent)] border border-[var(--accent)] rounded-[4px] px-[5px] text-[9px] tracking-[.03em]">
          Config
        </span>
        Keys
        <span className="flex-1 h-px bg-[var(--border)]" />
      </div>
      {!hasAnyConfig ? (
        <p className="text-[12px] text-[var(--faint)] italic mb-[18px]">No config keys set.</p>
      ) : (
        <div className="mb-[18px]">
          {scalarEntries.length > 0 && (
            <div className="grid grid-cols-2 gap-x-[18px] gap-y-[2px] mb-[10px]">
              {scalarEntries.map((c) => (
                <div key={c.propKey} className="flex items-start gap-2 py-[4px]">
                  <span className={CONFIG_ROW_LABEL}>{c.def?.label ?? c.propKey}</span>
                  <span className={READONLY_PILL}>{formatConfigValue(c.value)}</span>
                </div>
              ))}
            </div>
          )}

          {listEntries.length > 0 && (
            <div className="flex flex-col gap-[2px] mt-[4px]">
              {listEntries.map((c) => (
                <div key={c.propKey} className="flex items-start gap-2 py-[4px]">
                  <span className={CONFIG_ROW_LABEL}>{c.def?.label ?? c.propKey}</span>
                  <div className="flex-1 flex flex-wrap gap-[5px] items-center">
                    {(Array.isArray(c.value) ? c.value : []).map((item, i) => (
                      <span key={i} className={READONLY_PILL}>{String(item)}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {otherEntries.length > 0 && (
            <div className="flex flex-col gap-[2px] mt-[4px]">
              {otherEntries.map((c) => (
                <div key={c.propKey} className="flex items-start gap-2 py-[4px]">
                  <span className={CONFIG_ROW_LABEL}>{c.def?.label ?? c.propKey}</span>
                  <span className="text-[11px] text-[var(--muted)] font-mono break-all pt-[4px]">{formatConfigValue(c.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sections — read-only */}
      <div className="flex items-center gap-[8px] mt-[18px] mb-[9px] text-[var(--faint)] text-[10px] font-bold tracking-[.09em] uppercase select-none">
        <span className="text-[var(--accent)] border border-[var(--accent)] rounded-[4px] px-[5px] text-[9px] tracking-[.03em]">
          Sections
        </span>
        Body
        <span className="flex-1 h-px bg-[var(--border)]" />
      </div>
      <div className="space-y-[9px]">
        {agent.sections.map((section) => (
          <div key={section.id} className="rounded-[9px] border border-[var(--border)] bg-[var(--elev)] overflow-hidden">
            <div className="flex items-center gap-[8px] px-3 py-[9px] text-[12.5px] font-semibold text-[var(--text)]">
              {section.heading ?? section.def?.defaultHeading ?? section.sectionKey}
            </div>
            <div className="whitespace-pre-wrap px-3 pb-3 font-mono text-[12px] leading-[1.5] text-[var(--muted)]">
              {section.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
