/**
 * lib/import/assembleStructural.ts
 *
 * Builds ImportedAgentData from Structural Import's output (Phase B3, step 4–6).
 *
 * After callDaedalus() returns the restructured body document:
 *
 * Step 4: splitBody(returnedDoc) — parse the model's output body into blocks.
 *   Map each block: heading exactly matches a SECTION_DEFS.defaultHeading → that
 *   def's sectionKey; heading null or no match → 'custom'. Deterministic, no AI.
 *
 * Step 6: Build ImportedAgentData:
 *   - name / description / config from the **original** Stage-1 frontmatter
 *     (never from the model's output — Rules Index #27 decision #2).
 *   - splitLevel from the *output* document (will be 1; canonical headings are `#`).
 *   - sections from step 4.
 *   - rawSourceSnapshot: rawMd (the original raw bytes — NOT the model's output).
 *
 * Key invariant: the model's output contributes only *section structure and content*,
 * not frontmatter. Frontmatter (name, description, config) is always taken from
 * Stage-1 parse of the original file.
 */

import { splitBody } from '../serialize/splitBody.js';
import { SECTION_DEFS, CONFIG_DEFS } from '../blueprint/catalog.js';
import type { StructuredAgent, FrontmatterEntry } from '../serialize/types.js';
import type { ImportedAgentData } from '../db/repository/agents.js';

const DESCRIPTION_PLACEHOLDER = '(no description provided)';

/** Precomputed map: defaultHeading → sectionKey for deterministic mapping. */
const HEADING_TO_KEY = new Map<string, string>(
  SECTION_DEFS.map((def) => [def.defaultHeading, def.key]),
);

// Explicit Map<string, string> (not inferred) — CONFIG_DEFS' `key`/`datatype` are literal
// unions, which would otherwise narrow this Map's key type and make .get() reject the
// plain `string` that coerceConfigValue's `key` parameter actually is.
const CONFIG_DATATYPE = new Map<string, string>(CONFIG_DEFS.map((d) => [d.key, d.datatype]));

/**
 * Stage 1's YAML parse deliberately returns every scalar as a string, with no
 * coercion (lib/import/CLAUDE.md — avoids e.g. a model string like "4-6" turning
 * into a float). That's correct for Stage 1, but 'int'/'bool' catalog fields
 * (maxTurns, background) need their real JS type restored before they become
 * config rows, or the UI's malformed-value flagging (AgentView.tsx isInvalidInt)
 * and the bool pill's truthiness check both misread a perfectly valid imported
 * value. A value that doesn't cleanly parse is left as the original string, so
 * genuinely malformed input still gets flagged rather than silently coerced.
 */
function coerceConfigValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const datatype = CONFIG_DATATYPE.get(key);
  if (datatype === 'int' && /^-?\d+$/.test(value)) return parseInt(value, 10);
  if (datatype === 'bool') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

/**
 * Assembles the full ImportedAgentData for the structural import pipeline.
 *
 * @param original      Stage-1 StructuredAgent parsed from the original rawMd.
 * @param restructuredBody  The structural converter's returned body document (no frontmatter).
 * @param rawMd         The original raw markdown bytes — stored as rawSourceSnapshot.
 */
export function assembleStructural(
  original: StructuredAgent,
  restructuredBody: string,
  rawMd: string,
): ImportedAgentData {
  // ── Step 4: parse the output body → blocks, map headings → sectionKeys ──
  const { splitLevel, blocks } = splitBody(restructuredBody);

  const sections: ImportedAgentData['sections'] = blocks.map((block, idx) => {
    // Exact match against SECTION_DEFS.defaultHeading → canonical sectionKey.
    // heading null or no match → 'custom'.
    const sectionKey = block.heading !== null
      ? (HEADING_TO_KEY.get(block.heading) ?? 'custom')
      : 'custom';

    return {
      sectionKey,
      heading: block.heading,
      content: block.content,
      order: idx,
    };
  });

  // ── Step 6: frontmatter from original Stage-1 parse (never from model) ──
  const fmMap = new Map(original.frontmatter.map((e) => [e.key, e.rawValue]));

  // name/description are expected to be scalar strings — a well-formed agent file never
  // gives them a list or nested-json value; Array.isArray covers the (edge-case) list form.
  const toScalar = (v: FrontmatterEntry['rawValue'] | undefined): string | undefined =>
    v === undefined ? undefined : Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : undefined;

  const name = toScalar(fmMap.get('name')) ?? '';
  const descriptionRaw = toScalar(fmMap.get('description'));
  const description =
    descriptionRaw !== undefined && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : DESCRIPTION_PLACEHOLDER;

  // Config: all frontmatter entries except name + description (rawValue may now be a
  // nested object/array for datatype:'json' keys like hooks/mcpServers — #35/#40).
  // coerceConfigValue restores real number/boolean types for 'int'/'bool' fields.
  const config: { propKey: string; value: unknown }[] = [];
  for (const entry of original.frontmatter) {
    if (entry.key === 'name' || entry.key === 'description') continue;
    config.push({ propKey: entry.key, value: coerceConfigValue(entry.key, entry.rawValue) });
  }

  return {
    name,
    description,
    platform: 'claude',
    splitLevel,
    rawSourceSnapshot: rawMd,
    config,
    sections,
  };
}
