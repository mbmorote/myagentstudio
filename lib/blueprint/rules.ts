/**
 * lib/blueprint/rules.ts
 *
 * Pure rule functions derived from the catalog. No I/O.
 * All validation flags are derived, never stored (R2).
 *
 * All rule functions are grouped under the single exported `Rules` object so
 * callers reference one thing (`Rules.computeValidation(...)`) instead of a
 * handful of separate named imports — kept as plain functions (no `class`),
 * matching the rest of the codebase's functional style.
 *
 * Name-spec validation (lowercase-hyphen) was removed per user request —
 * agent names are no longer flagged for not matching that spec.
 */

import { CONFIG_DEFS, SECTION_DEFS } from './catalog.js';

// ─────────────────────────────  Types  ────────────────────────────────────────

export type ValidationResult = {
  descriptionMissing: boolean;
  unknownConfigKeys: string[];
  outdatedOrUnknownValues: { propKey: string; value: unknown }[];
};

export type AgentForValidation = {
  name: string;
  description: string;
  config: { propKey: string; value: unknown }[];
};

// ─────────────────────────────  Rule functions  ────────────────────────────────

/**
 * Given a sectionKey (e.g. "role") or a raw heading string (e.g. "# ROLE"),
 * returns the heading string to emit.
 *
 * - If the input already starts with "#", it is a heading and is returned verbatim.
 * - If it matches a known sectionKey, returns that def's defaultHeading.
 * - Otherwise, synthesizes a heading: "# " + key.toUpperCase().
 */
function renderHeading(sectionKeyOrHeading: string): string {
  if (sectionKeyOrHeading.startsWith('#')) {
    return sectionKeyOrHeading;
  }
  const def = SECTION_DEFS.find((d) => d.key === sectionKeyOrHeading);
  if (def) return def.defaultHeading;
  return `# ${sectionKeyOrHeading.toUpperCase()}`;
}

/**
 * Returns the datatype for a given propKey, or 'any' if not in the catalog.
 */
function configDatatypeFor(propKey: string): string {
  const def = CONFIG_DEFS.find((d) => d.key === propKey);
  return def ? def.datatype : 'any';
}

/**
 * Returns the SectionDef entry for a given sectionKey, or undefined if unknown.
 */
function sectionDefFor(sectionKey: string): (typeof SECTION_DEFS)[number] | undefined {
  return SECTION_DEFS.find((d) => d.key === sectionKey);
}

/**
 * Computes all validation flags for an agent. Pure — reads only the live data
 * passed in + the in-code catalog. (R2: derived, never stored.)
 */
function computeValidation(agent: AgentForValidation): ValidationResult {
  const descriptionMissing =
    agent.description === null ||
    agent.description === undefined ||
    agent.description.trim() === '';

  const knownKeys = new Set(CONFIG_DEFS.map((d) => d.key));
  const unknownConfigKeys = agent.config
    .map((c) => c.propKey)
    .filter((k) => !knownKeys.has(k as never));

  const outdatedOrUnknownValues: { propKey: string; value: unknown }[] = [];
  for (const { propKey, value } of agent.config) {
    const def = CONFIG_DEFS.find((d) => d.key === propKey);
    if (!def || def.allowedValues === null) continue;

    const allowed = def.allowedValues as readonly string[];

    if (def.datatype === 'list') {
      // value may be an array of tool names or a comma-separated string
      const items: string[] = Array.isArray(value)
        ? (value as string[])
        : String(value)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      const bad = items.filter((v) => !allowed.includes(v));
      if (bad.length > 0) {
        outdatedOrUnknownValues.push({ propKey, value });
      }
    } else {
      // enum, bool, int, string — compare as string
      if (!allowed.includes(String(value))) {
        outdatedOrUnknownValues.push({ propKey, value });
      }
    }
  }

  return { descriptionMissing, unknownConfigKeys, outdatedOrUnknownValues };
}

// ─────────────────────────────  Grouped export  ───────────────────────────────

export const Rules = {
  renderHeading,
  configDatatypeFor,
  sectionDefFor,
  computeValidation,
};
