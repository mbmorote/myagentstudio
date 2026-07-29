'use client';

/**
 * app/components/CustomViz/AgentView.tsx
 *
 * Plan 03 Phase B, B.7 — Config zone rewritten from table to pills.
 *
 * Renders the two structured zones for a single agent:
 *
 *   Agent header: monogram avatar (first two chars of name) + name h1 + source/platform subtitle.
 *
 *   Zone 1 — Config: pills for each known config key/value.
 *     - .pill.warn for validation flags (outdated model, unrecognized tools).
 *     - .pill.grp for each group the agent belongs to (reads agent.groupIds + group names).
 *     - .pill for each normal config entry.
 *
 *   Zone 2 — Sections: ordered AgentSection rows, each rendered via SectionBlock.
 *
 * Receives the interaction lock state and callbacks from WorkbenchShell.
 * Receives groups from WorkbenchShell (loaded server-side, passed down).
 *
 * R13: no config-editing chat path exists; target chips in ChatPanel only show sectionKey.
 */

import type { AgentDTO, GroupDTO } from '@/lib/db/repository';
import type { InteractionLock } from '@/app/components/WorkbenchShell';
import { SectionBlock } from '@/app/components/CustomViz/SectionBlock';

interface AgentViewProps {
  agent: AgentDTO;
  groups: GroupDTO[];
  interactionLock: InteractionLock;
  onEditStart: () => void;
  onEditEnd: () => void;
  onSectionSaved: (sectionId: string, content: string, newVersion: number) => void;
}

/** Two-character monogram: first letter of first word + first letter of second word, or first two chars. */
function monogram(name: string): string {
  const parts = name.trim().split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toLowerCase();
  }
  return name.slice(0, 2).toLowerCase();
}

export function AgentView({
  agent,
  groups,
  interactionLock,
  onEditStart,
  onEditEnd,
  onSectionSaved,
}: AgentViewProps) {
  const { validation } = agent;

  // Resolve which groups this agent belongs to by filtering on memberAgentIds
  // (WorkbenchShell passes groups loaded server-side; each group carries its memberAgentIds).
  const agentGroups = groups.filter((g) => g.memberAgentIds.includes(agent.id));

  return (
    <div className="p-[14px_16px_20px] space-y-0">

      {/* ── Agent header (.agentcard-head) ───────────────────────────────── */}
      <div className="flex items-start gap-3 mb-[14px]">
        {/* Monogram avatar (.bigav) */}
        <div className="w-[40px] h-[40px] rounded-[9px] bg-[var(--accent)] text-white flex-none grid place-items-center font-bold text-[17px]">
          {monogram(agent.name)}
        </div>
        <div className="min-w-0">
          <h1 className="m-0 text-[19px] font-semibold tracking-[-0.02em] text-[var(--text)]">
            {agent.name}
          </h1>
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
      </div>

      {/* ── Zone 1: Config (.zone-label + .pills) ───────────────────────── */}
      <div className="zone-label flex items-center gap-2 mb-[9px] mt-[18px] text-[var(--faint)] text-[10px] font-bold tracking-[.09em] uppercase">
        <span className="text-[var(--accent)] border border-[var(--accent)] rounded-[4px] px-[5px] py-0 text-[9px] tracking-[.03em]">
          Tier 1
        </span>
        Config · frontmatter
        <span className="flex-1 h-px bg-[var(--border)]" />
      </div>

      <div className="flex flex-wrap gap-[6px]">
        {/* Validation flag pills — warn style */}
        {validation.outdatedOrUnknownValues.map(({ propKey, value }) => (
          <span
            key={propKey}
            className="inline-flex items-center gap-[6px] text-[11px] px-[9px] py-[3px] rounded-full border border-[var(--warn)] text-[var(--warn)] bg-[var(--elev)] before:content-['⚠'] before:text-[10px]"
          >
            {propKey}{' '}
            <b className="font-mono text-[10.5px] mx-[3px]">{String(value)}</b>
            {' '}is outdated
          </span>
        ))}
        {validation.unknownConfigKeys.map((k) => (
          <span
            key={k}
            className="inline-flex items-center gap-[6px] text-[11px] px-[9px] py-[3px] rounded-full border border-[var(--warn)] text-[var(--warn)] bg-[var(--elev)] before:content-['⚠'] before:text-[10px]"
          >
            tool <b className="font-mono text-[10.5px] mx-[3px]">{k}</b> not recognized
          </span>
        ))}

        {/* Normal config pills */}
        {agent.config.map((row) => {
          const isOutdated = validation.outdatedOrUnknownValues.some(
            (v) => v.propKey === row.propKey,
          );
          const isUnknownKey = validation.unknownConfigKeys.includes(row.propKey);
          if (isOutdated || isUnknownKey) return null; // already shown as warn

          const valueStr = Array.isArray(row.value)
            ? `[${(row.value as string[]).length} entries]`
            : String(row.value);

          return (
            <span
              key={row.propKey}
              className="inline-flex items-center gap-[6px] text-[11px] px-[9px] py-[3px] rounded-full border border-[var(--border)] text-[var(--muted)] bg-[var(--elev)]"
            >
              <span className="text-[var(--faint)]">{row.propKey}</span>
              <span className="text-[var(--text)] font-medium font-mono text-[10.5px]">
                {valueStr}
              </span>
            </span>
          );
        })}

        {agent.config.length === 0 && (
          <span className="text-[12px] text-[var(--faint)] italic">No config entries</span>
        )}
      </div>

      {/* ── Zone 2: Sections ─────────────────────────────────────────────── */}
      <div className="zone-label flex items-center gap-2 mb-[9px] mt-[18px] text-[var(--faint)] text-[10px] font-bold tracking-[.09em] uppercase">
        <span className="text-[var(--accent)] border border-[var(--accent)] rounded-[4px] px-[5px] py-0 text-[9px] tracking-[.03em]">
          Tier 2
        </span>
        Sections · body
        <span className="flex-1 h-px bg-[var(--border)]" />
      </div>

      <div className="space-y-[9px]">
        {agent.sections.map((section) => (
          <SectionBlock
            key={section.id}
            agentId={agent.id}
            section={section}
            interactionLock={interactionLock}
            onEditStart={onEditStart}
            onEditEnd={onEditEnd}
            onSaved={(content, newVersion) =>
              onSectionSaved(section.id, content, newVersion)
            }
          />
        ))}
      </div>
    </div>
  );
}
