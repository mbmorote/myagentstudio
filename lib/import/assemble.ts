/**
 * lib/import/assemble.ts
 *
 * Deterministic reassembly: takes Stage-1 blocks (from parse()) + Stage-2 labels
 * (from callImportConverter()) and produces the ImportedAgentData shape expected
 * by repository.upsertAgentFromImport().
 *
 * Key invariants (§6 rule 2, Rules Index #5/#6):
 * - Content bytes are ALWAYS copied from Stage-1 blocks by blockId.
 * - The AI's labels only determine sectionKey assignment — never content.
 * - Unmapped / low-confidence blocks → sectionKey: "custom".
 * - The order-0 headingless block (heading: null) passes through as sectionKey: "custom",
 *   heading: null (per import-converter guardrail #3 — the AI never assigns it a key).
 * - propKey-mapped body blocks (rare edge case) are stored as custom sections; config
 *   values come from the deterministically-parsed frontmatter only.
 *
 * Name/description handling:
 * - name stored verbatim — never normalised (Rules Index #1, flag-don't-block).
 * - Missing description → placeholder string + descriptionMissing flag on DTO (Rules Index #12).
 */

import type { StructuredAgent, BodyBlock } from '../serialize/types.js';
import type { ImportedAgentData } from '../db/repository/agents.js';
import type { Stage2Labels, Stage2Mapping } from '../ai/importConverter.js';

const DESCRIPTION_PLACEHOLDER = '(no description provided)';

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles Stage-1 parse output + Stage-2 label map into ImportedAgentData.
 *
 * @param structured  Stage-1 StructuredAgent (from parse(md))
 * @param labels      Stage-2 label map (from callImportConverter)
 * @param rawMd       The raw original markdown string (byte-for-byte, for rawSourceSnapshot)
 */
export function assemble(
  structured: StructuredAgent,
  labels: Stage2Labels,
  rawMd: string,
): ImportedAgentData {
  // ── Extract name + description from frontmatter ───────────────────────────
  const fmMap = new Map(structured.frontmatter.map((e) => [e.key, e.rawValue]));

  // name: verbatim (Rules Index #1 — flag-don't-block)
  const name = fmMap.get('name') ?? '';

  // description: placeholder if missing (Rules Index #12)
  const descriptionRaw = fmMap.get('description');
  const description =
    descriptionRaw !== undefined && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : DESCRIPTION_PLACEHOLDER;

  // ── Config: all frontmatter entries except name + description ────────────
  const config: { propKey: string; value: unknown }[] = [];
  for (const entry of structured.frontmatter) {
    if (entry.key === 'name' || entry.key === 'description') continue;
    // Store the rawValue string verbatim as the config value.
    // computeValidation handles both string and array forms for lists (rules.ts).
    config.push({ propKey: entry.key, value: entry.rawValue });
  }

  // ── Build blockId → BodyBlock lookup ────────────────────────────────────
  const blockById = new Map<string, BodyBlock>(
    structured.blocks.map((b) => [b.blockId, b]),
  );

  // ── Build assignment map: blockId → { sectionKey, allBlockIds } ──────────
  // All blockIds in a merge group point to the same entry.
  // propKey-mapped body blocks are treated as "custom" sections.
  const assignmentMap = new Map<string, { sectionKey: string; blockIds: string[] }>();

  for (const mapping of labels.mappings) {
    const sectionKey = getSectionKey(mapping);
    const ids = getBlockIds(mapping);

    // Sort ids by block order (so we can determine the primary block later)
    const assignment = { sectionKey, blockIds: ids };
    for (const id of ids) {
      assignmentMap.set(id, assignment);
    }
  }

  // ── Build sections (iterate blocks in order) ─────────────────────────────
  const sections: ImportedAgentData['sections'] = [];
  const processedIds = new Set<string>();

  const sortedBlocks = [...structured.blocks].sort((a, b) => a.order - b.order);

  for (const block of sortedBlocks) {
    if (processedIds.has(block.blockId)) continue;

    // Headingless preamble (order-0, heading: null) → custom, heading: null.
    // The AI never assigns it a sectionKey (import-converter guardrail #3).
    if (block.heading === null) {
      sections.push({
        sectionKey: 'custom',
        heading: null,
        content: block.content,
        order: block.order,
      });
      processedIds.add(block.blockId);
      continue;
    }

    const assignment = assignmentMap.get(block.blockId);

    if (!assignment) {
      // Unmapped block → custom (verbatim content, original heading preserved)
      sections.push({
        sectionKey: 'custom',
        heading: block.heading,
        content: block.content,
        order: block.order,
      });
      processedIds.add(block.blockId);
      continue;
    }

    // Resolve all blocks in this assignment group (merge), sorted by order.
    const mergeBlocks = assignment.blockIds
      .map((id) => blockById.get(id))
      .filter((b): b is BodyBlock => b !== undefined)
      .sort((a, b) => a.order - b.order);

    // Only process when we're at the primary (first-by-order) block.
    if (mergeBlocks.length === 0 || mergeBlocks[0].blockId !== block.blockId) {
      // This block is a secondary in the merge group — skip; primary handles it.
      processedIds.add(block.blockId);
      continue;
    }

    // ── Build merged content: primary content + (secondary heading + content)*
    // Content bytes are ALWAYS from Stage-1 blocks (Rules Index #5/#6).
    let content = mergeBlocks[0].content;
    for (let i = 1; i < mergeBlocks.length; i++) {
      const secondary = mergeBlocks[i];
      if (secondary.heading !== null) {
        // Include the heading line of the secondary block verbatim
        content += secondary.heading + '\n' + secondary.content;
      } else {
        content += secondary.content;
      }
    }

    sections.push({
      sectionKey: assignment.sectionKey,
      heading: mergeBlocks[0].heading,
      content,
      order: mergeBlocks[0].order,
    });

    for (const b of mergeBlocks) {
      processedIds.add(b.blockId);
    }
  }

  return {
    name,
    description,
    platform: 'claude',
    splitLevel: structured.splitLevel,
    rawSourceSnapshot: rawMd,
    config,
    sections,
  };
}

// ─────────────────────────────  Helpers  ─────────────────────────────────────

/** Extracts all blockIds referenced by a mapping. */
function getBlockIds(mapping: Stage2Mapping): string[] {
  if ('blockIds' in mapping) return mapping.blockIds;
  return [(mapping as { blockId: string }).blockId];
}

/**
 * Extracts the sectionKey from a mapping.
 * propKey-mapped body blocks are treated as "custom" sections (config values come
 * from the deterministically-parsed frontmatter only — not from body block labels).
 */
function getSectionKey(mapping: Stage2Mapping): string {
  if ('sectionKey' in mapping) return mapping.sectionKey;
  return 'custom';
}
