/**
 * lib/import/assemble.ts
 *
 * Deterministic reassembly: takes Stage-1 blocks (from parse()) + Stage-2 labels
 * (from callHermes()) and produces the ImportedAgentData shape expected
 * by repository.upsertAgentFromImport().
 *
 * Key invariants:
 * - Content bytes are ALWAYS copied from Stage-1 blocks by blockId.
 * - The AI's labels only determine sectionKey assignment — never content.
 * - Unmapped / low-confidence blocks → sectionKey: "custom".
 * - The order-0 headingless block (heading: null) passes through as sectionKey: "custom",
 *   heading: null (per hermes.md guardrail #3 — the AI never assigns it a key).
 * - Config values come from the deterministically-parsed frontmatter only — Stage 2 never
 *   classifies config data (the propKey mapping capability was removed 2026-07-26:
 *   frontmatter keys are already exact, unambiguous strings, so there was never a
 *   classification problem there for AI to solve).
 *
 * Name/description handling:
 * - name stored verbatim — never normalised (flag-don't-block: never silently rewritten).
 * - Missing description → placeholder string + descriptionMissing flag on DTO.
 */

import type { StructuredAgent, BodyBlock, FrontmatterEntry } from '../serialize/types.js';
import type { ImportedAgentData } from '../db/repository/agents.js';
import type { Stage2Labels, Stage2Mapping } from '../ai/hermes.js';
import { CONFIG_DEFS } from '../blueprint/catalog.js';

const DESCRIPTION_PLACEHOLDER = '(no description provided)';

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

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles Stage-1 parse output + Stage-2 label map into ImportedAgentData.
 *
 * @param structured  Stage-1 StructuredAgent (from parse(md))
 * @param labels      Stage-2 label map (from callHermes)
 * @param rawMd       The raw original markdown string (byte-for-byte, for rawSourceSnapshot)
 */
export function assemble(
  structured: StructuredAgent,
  labels: Stage2Labels,
  rawMd: string,
): ImportedAgentData {
  // ── Extract name + description from frontmatter ───────────────────────────
  const fmMap = new Map(structured.frontmatter.map((e) => [e.key, e.rawValue]));

  // name and description are expected to be scalar strings. If a file somehow has a
  // list value for 'name'/'description', coerce to a joined string (edge case — a
  // well-formed agent file will always have scalar name/description).
  const toScalar = (v: FrontmatterEntry['rawValue'] | undefined): string | undefined =>
    v === undefined ? undefined : Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : undefined;

  // name: verbatim (flag-don't-block — never silently rewritten)
  const name = toScalar(fmMap.get('name')) ?? '';

  // description: placeholder if missing
  const descriptionRaw = toScalar(fmMap.get('description'));
  const description =
    descriptionRaw !== undefined && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : DESCRIPTION_PLACEHOLDER;

  // ── Config: all frontmatter entries except name + description ────────────
  const config: { propKey: string; value: unknown }[] = [];
  for (const entry of structured.frontmatter) {
    if (entry.key === 'name' || entry.key === 'description') continue;
    // Store rawValue verbatim as the config value (A3) — scalar, flat list, or (for
    // datatype:'json' keys like hooks/mcpServers) a genuine nested object/array (#35/#40).
    // computeValidation handles both scalar and array forms for lists (rules.ts).
    // coerceConfigValue restores real number/boolean types for 'int'/'bool' fields.
    config.push({ propKey: entry.key, value: coerceConfigValue(entry.key, entry.rawValue) });
  }

  // ── Build blockId → BodyBlock lookup ────────────────────────────────────
  const blockById = new Map<string, BodyBlock>(
    structured.blocks.map((b) => [b.blockId, b]),
  );

  // ── Build assignment map: blockId → { sectionKey, allBlockIds } ──────────
  // All blockIds in a merge group point to the same entry.
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
    // Excludes the headingless preamble block even if the AI incorrectly
    // included it in a merge group (guardrail says it never gets a sectionKey,
    // but that's prompt-enforced, not code-enforced) — it's already emitted
    // independently by the heading===null branch above, so including it here
    // would make it the "primary" and cause the real primary's content to be
    // silently dropped (found in code review, 2026-08-12).
    const mergeBlocks = assignment.blockIds
      .map((id) => blockById.get(id))
      .filter((b): b is BodyBlock => b !== undefined && b.heading !== null)
      .sort((a, b) => a.order - b.order);

    // Only process when we're at the primary (first-by-order) block.
    if (mergeBlocks.length === 0 || mergeBlocks[0].blockId !== block.blockId) {
      // This block is a secondary in the merge group — skip; primary handles it.
      processedIds.add(block.blockId);
      continue;
    }

    // ── Build merged content: primary content + (secondary heading + content)*
    // Content bytes are ALWAYS from Stage-1 blocks, never from the AI's output.
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

  // A4: belt-and-braces fallback — any input block not yet emitted becomes 'custom'.
  // Defends against overlapping mappings or other edge cases where processedIds misses a block.
  for (const block of sortedBlocks) {
    if (!processedIds.has(block.blockId)) {
      sections.push({
        sectionKey: 'custom',
        heading: block.heading,
        content: block.content,
        order: block.order,
      });
      processedIds.add(block.blockId);
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

/** Extracts the sectionKey from a mapping (the only label kind Stage 2 produces). */
function getSectionKey(mapping: Stage2Mapping): string {
  return mapping.sectionKey;
}
