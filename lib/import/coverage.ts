/**
 * lib/import/coverage.ts
 *
 * Deterministic coverage check for Structural Import — backs up the model's own
 * verbatim-movement guardrail with a code-enforced check, since (unlike Strict
 * Import) the server never sees or verifies the model's restructured output byte
 * by byte.
 *
 * After the structural converter returns a restructured body document, this check
 * compares each Stage-1 source block against what survived in the output. Low
 * coverage produces a CoverageWarning on the response — never a hard block.
 * Recovery is always possible via rawSourceSnapshot + AgentSnapshot + SectionRevision.
 *
 * Normalization (both sides):
 *   - Lowercase
 *   - Collapse all whitespace runs to single spaces
 *   - Strip markdown decoration chars: # * _ > | -
 *
 * Coverage for a source block:
 *   - Split its normalized content into non-empty lines.
 *   - Coverage = fraction of those lines that appear as substrings of the
 *     normalized output document.
 *   - Coverage < 0.8 → CoverageWarning.
 */

import type { BodyBlock } from '../serialize/types.js';

// ─────────────────────────────  Types  ────────────────────────────────────────

export type CoverageWarning = {
  blockId: string;
  heading: string | null;
  /** Fraction of source lines found in output — 0.0 to 1.0. */
  coverage: number;
};

// ─────────────────────────────  Constants  ────────────────────────────────────

/** Fraction below which a block is considered partially/fully lost. */
const COVERAGE_THRESHOLD = 0.8;

/** Markdown decoration characters to strip during normalization. */
const DECORATION_RE = /[#*_>|-]/g;

/** Collapses runs of horizontal whitespace (spaces/tabs) to a single space. */
const HSPACE_RE = /[ \t]+/g;

/** Collapses all whitespace including newlines — used for the output search string. */
const ALLSPACE_RE = /\s+/g;

// ─────────────────────────────  Main export  ─────────────────────────────────

/**
 * Checks how much content from each Stage-1 source block survived in the
 * structural converter's output document.
 *
 * Normalization strategy:
 * - Source block: normalize each line individually (lowercase, strip decorations,
 *   collapse horizontal whitespace, trim) then filter empty lines. This preserves
 *   line boundaries so each line can be independently checked.
 * - Output document: flatten to a single normalized string (all whitespace collapsed
 *   to one space) for substring searching.
 *
 * Coverage for a block = fraction of its non-empty normalized lines that appear as
 * substrings of the normalized output.
 *
 * @param sourceBlocks  Stage-1 BodyBlock[] (from parse() on the original raw md).
 * @param outputDoc     The structural converter's returned body document (full string).
 * @returns             Array of CoverageWarning for any block with coverage < 0.8.
 *                      Empty array = full coverage (all blocks look intact).
 */
export function checkCoverage(
  sourceBlocks: BodyBlock[],
  outputDoc: string,
): CoverageWarning[] {
  // Flatten the output to a single normalized string for substring searching.
  const normalizedOutput = flattenNormalize(outputDoc);
  const warnings: CoverageWarning[] = [];

  for (const block of sourceBlocks) {
    // Normalize the block's content line-by-line (heading not included in content bytes).
    const lines = block.content
      .split('\n')
      .map((l) => lineNormalize(l))
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      // Empty block — no content to lose, skip.
      continue;
    }

    // Coverage = fraction of source lines found as substrings of the output.
    const foundCount = lines.filter((line) => normalizedOutput.includes(line)).length;
    const coverage = foundCount / lines.length;

    if (coverage < COVERAGE_THRESHOLD) {
      warnings.push({ blockId: block.blockId, heading: block.heading, coverage });
    }
  }

  return warnings;
}

// ─────────────────────────────  Helpers  ─────────────────────────────────────

/**
 * Normalizes a single source line for coverage comparison.
 * Lowercase → strip decoration chars → collapse horizontal whitespace → trim.
 * Newlines are NOT touched (this is a per-line function).
 */
function lineNormalize(text: string): string {
  return text
    .toLowerCase()
    .replace(DECORATION_RE, '')
    .replace(HSPACE_RE, ' ')
    .trim();
}

/**
 * Flattens a full document to a single normalized string for substring searching.
 * Lowercase → strip decoration chars → collapse ALL whitespace (including newlines)
 * to one space → trim.
 */
function flattenNormalize(text: string): string {
  return text
    .toLowerCase()
    .replace(DECORATION_RE, '')
    .replace(ALLSPACE_RE, ' ')
    .trim();
}
