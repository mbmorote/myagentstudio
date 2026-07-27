/**
 * lib/blueprint/prompt.ts
 *
 * Generates the blueprint text block injected into both system-agent prompts.
 * Derived from the same CONFIG_DEFS and SECTION_DEFS arrays the validator uses
 * (Rules Index #9 — no divergent second copy).
 */

import { CONFIG_DEFS, SECTION_DEFS } from './catalog.js';

/**
 * Renders the agent blueprint as a structured text block suitable for inclusion
 * in a system-agent prompt. Called by lib/ai at request time (Phase 3+).
 *
 * Generated from the live catalog arrays — not a hand-maintained string.
 */
export function renderBlueprintForPrompt(): string {
  const lines: string[] = [
    '## Agent Blueprint',
    '',
    'The following describes the canonical structure of a Claude agent managed by this platform.',
    '',
    '### Configuration fields (YAML frontmatter)',
    '',
  ];

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

  lines.push('', '### Body sections', '');

  for (const def of SECTION_DEFS) {
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
