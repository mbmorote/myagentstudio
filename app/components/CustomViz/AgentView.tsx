'use client';

/**
 * app/components/CustomViz/AgentView.tsx
 *
 * Phase 4.2 — CustomViz pane content.
 *
 * Renders the two structured zones for a single agent:
 *
 *   Zone 1 — Config: typed rows from AgentConfig + ConfigDef metadata.
 *     Validation flags (outdatedOrUnknownValues, unknownConfigKeys,
 *     nameSpecViolation, descriptionMissing) are surfaced inline — derived,
 *     never stored (R2, §6 business rule 8).
 *
 *   Zone 2 — Sections: ordered AgentSection rows, each rendered via SectionBlock.
 *
 * Receives the interaction lock state and callbacks from WorkbenchShell so that
 * raw-edit toggles in SectionBlock can engage/release the lock (§6 rule 12,
 * Rules Index #22).
 *
 * No API key access. Read from DTO only.
 */

import type { AgentDTO } from '@/lib/db/repository';
import type { InteractionLock } from '@/app/components/WorkbenchShell';
import { SectionBlock } from '@/app/components/CustomViz/SectionBlock';

interface AgentViewProps {
  agent: AgentDTO;
  interactionLock: InteractionLock;
  onEditStart: () => void;
  onEditEnd: () => void;
  onSectionSaved: (sectionId: string, content: string, newVersion: number) => void;
}

export function AgentView({
  agent,
  interactionLock,
  onEditStart,
  onEditEnd,
  onSectionSaved,
}: AgentViewProps) {
  const { validation } = agent;
  const hasValidationIssues =
    validation.nameSpecViolation ||
    validation.descriptionMissing ||
    validation.unknownConfigKeys.length > 0 ||
    validation.outdatedOrUnknownValues.length > 0;

  return (
    <div className="space-y-6">
      {/* ── Agent header ──────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold">{agent.name}</h1>
          {validation.nameSpecViolation && (
            <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">
              name spec violation
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {agent.description || (
            <span className="italic text-destructive">description missing</span>
          )}
        </p>
      </div>

      {/* ── Validation banner ─────────────────────────────────────────────── */}
      {hasValidationIssues && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm dark:border-yellow-700 dark:bg-yellow-900/20">
          <p className="font-medium text-yellow-800 dark:text-yellow-300">
            Validation flags
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-yellow-700 dark:text-yellow-400">
            {validation.nameSpecViolation && (
              <li>Name does not match lowercase-hyphen spec</li>
            )}
            {validation.descriptionMissing && (
              <li>Description is missing or empty</li>
            )}
            {validation.unknownConfigKeys.map((k) => (
              <li key={k}>Unknown config key: <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/40">{k}</code></li>
            ))}
            {validation.outdatedOrUnknownValues.map(({ propKey, value }) => (
              <li key={propKey}>
                <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/40">{propKey}</code>
                {': '}
                <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/40">{String(value)}</code>
                {' — outdated or unrecognized value'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Zone 1: Config ────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Configuration
        </h2>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Key</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Value</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
              </tr>
            </thead>
            <tbody>
              {agent.config.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-muted-foreground italic">
                    No config entries
                  </td>
                </tr>
              ) : (
                agent.config.map((row) => {
                  const isOutdated = validation.outdatedOrUnknownValues.some(
                    (v) => v.propKey === row.propKey,
                  );
                  const isUnknownKey = validation.unknownConfigKeys.includes(row.propKey);

                  return (
                    <tr key={row.propKey} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.propKey}
                        {isUnknownKey && (
                          <span className="ml-1 rounded bg-yellow-100 px-1 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400">
                            unknown
                          </span>
                        )}
                      </td>
                      <td className={`px-3 py-2 font-mono text-xs ${isOutdated ? 'text-destructive' : ''}`}>
                        {Array.isArray(row.value)
                          ? (row.value as string[]).join(', ')
                          : String(row.value)}
                        {isOutdated && (
                          <span className="ml-2 rounded bg-red-100 px-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-400">
                            outdated
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.def?.datatype ?? 'any'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          platform: <span className="font-mono">{agent.platform}</span>
          {' · '}
          source: <span className="font-mono">{agent.source}</span>
          {' · '}
          split level: <span className="font-mono">{agent.splitLevel}</span>
        </p>
      </section>

      {/* ── Zone 2: Sections ──────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sections ({agent.sections.length})
        </h2>
        <div className="space-y-3">
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
      </section>
    </div>
  );
}
