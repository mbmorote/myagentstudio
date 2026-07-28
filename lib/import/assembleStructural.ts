/**
 * lib/import/assembleStructural.ts
 *
 * Builds ImportedAgentData from Structural Import's output (Phase B3, step 4–6).
 *
 * After callStructuralConverter() returns the restructured body document:
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
import { SECTION_DEFS } from '../blueprint/catalog.js';
import type { StructuredAgent } from '../serialize/types.js';
import type { ImportedAgentData } from '../db/repository/agents.js';

const DESCRIPTION_PLACEHOLDER = '(no description provided)';

/** Precomputed map: defaultHeading → sectionKey for deterministic mapping. */
const HEADING_TO_KEY = new Map<string, string>(
  SECTION_DEFS.map((def) => [def.defaultHeading, def.key]),
);

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

  const toScalar = (v: string | string[] | undefined): string | undefined =>
    v === undefined ? undefined : Array.isArray(v) ? v.join(', ') : v;

  const name = toScalar(fmMap.get('name')) ?? '';
  const descriptionRaw = toScalar(fmMap.get('description'));
  const description =
    descriptionRaw !== undefined && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : DESCRIPTION_PLACEHOLDER;

  // Config: all frontmatter entries except name + description (rawValue: string | string[]).
  const config: { propKey: string; value: unknown }[] = [];
  for (const entry of original.frontmatter) {
    if (entry.key === 'name' || entry.key === 'description') continue;
    config.push({ propKey: entry.key, value: entry.rawValue });
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
