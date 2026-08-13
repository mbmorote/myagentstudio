/**
 * lib/blueprint/prompt.ts
 *
 * Generates the blueprint text block injected into both system-agent prompts.
 *
 * Config fields still come from CONFIG_DEFS (lib/blueprint/catalog.ts) — that
 * migration hasn't happened yet. Section defs are passed in by the caller
 * (fetched via lib/db/repository's getSectionDefs(platform), DB-owned since
 * 2026-08-07) rather than imported from catalog.ts — this file has no DB access
 * of its own (lib/blueprint stays I/O-free; the route/caller layer owns fetching).
 */

import { CONFIG_DEFS } from './catalog.js';
import type { SectionDefLite } from '../db/repository/agents.js';

/**
 * Renders the agent blueprint as a structured text block suitable for inclusion
 * in a system-agent prompt. Called by lib/ai at request time (Phase 3+).
 *
 * @param sectionDefs  The platform's section catalog, in canonical order —
 *   fetched by the caller via getSectionDefs(platform) and forwarded here.
 * @param options.includeConfig  Include the "Configuration fields" section.
 *   Default true (Prometheus needs full agent context, config included).
 *   The import converter passes `false` — Stage 2 never classifies config data
 *   (propKey removed 2026-07-26: frontmatter keys are already exact, unambiguous
 *   strings, so there was never a real classification problem there), so including
 *   it there was pure dead-weight tokens for a decision the model is never asked to make.
 */
export function renderBlueprintForPrompt(
  sectionDefs: readonly SectionDefLite[],
  options?: { includeConfig?: boolean },
): string {
  const includeConfig = options?.includeConfig ?? true;

  const lines: string[] = [
    '## Agent Blueprint',
    '',
    'The following describes the canonical structure of a Claude agent managed by this platform.',
  ];

  if (includeConfig) {
    lines.push('', '### Configuration fields (YAML frontmatter)', '');

    for (const def of CONFIG_DEFS) {
      const parts: string[] = [`**${def.key}**`, `type: ${def.datatype}`];
      if (def.required) parts.push('required');
      if (def.isCore) parts.push('core');
      const header = parts.join(', ');

      if (def.allowedValues !== null) {
        const vals = (def.allowedValues as readonly string[]).join(' | ');
        lines.push(`- ${header} — allowed values: ${vals}`);
      } else {
        lines.push(`- ${header}`);
      }
    }
  }

  lines.push('', '### Body sections', '');

  for (const def of sectionDefs) {
    const coreTag = def.isCore ? ' [core]' : '';
    lines.push(`- **${def.key}**${coreTag} — heading: \`${def.defaultHeading}\``);
    lines.push(`  ${def.helpText}`);
  }

  lines.push(
    '',
    '### Section labeling notes',
    '',
    '- A section whose heading does not match any known sectionKey is stored as sectionKey: "custom".',
    '- Headings are preserved verbatim; the tool never rewrites them.',
    '- The "behavior" section appears in real agents under many names (BEHAVIOR, HOW IT WORKS, INSTRUCTIONS, PROCESS, etc.).',
  );

  return lines.join('\n');
}
