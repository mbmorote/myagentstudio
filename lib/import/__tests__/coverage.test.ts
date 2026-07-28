/**
 * lib/import/__tests__/coverage.test.ts
 *
 * Unit tests for lib/import/coverage.ts (Phase B5).
 *
 * The four cases the plan specifies:
 *  1. Verbatim move across sections → no warning.
 *  2. A dropped block → warning.
 *  3. A paraphrased block → warning (content materially altered, coverage < 0.8).
 *  4. Content moved inside a merged section → no warning.
 */

import { describe, expect, it } from 'vitest';
import { checkCoverage } from '../coverage.js';
import type { BodyBlock } from '../../serialize/types.js';

// ─────────────────────────────  Helpers  ────────────────────────────────────

function block(
  id: string,
  heading: string | null,
  content: string,
  order: number,
): BodyBlock {
  return { blockId: id, heading, content, order };
}

// ─────────────────────────────  Tests  ─────────────────────────────────────

describe('checkCoverage', () => {
  it('verbatim move across sections → no warning', () => {
    // Source has two blocks; the output contains both contents but under a different heading.
    const sourceBlocks: BodyBlock[] = [
      block('block-0', '# ROLE', '\nYou are a senior developer.\n', 0),
      block('block-1', '# RULES', '\nNever lie.\nAlways help.\n', 1),
    ];
    // Output merges them into one section — all source lines survive verbatim.
    const outputDoc = `# ROLE\n\nYou are a senior developer.\nNever lie.\nAlways help.\n`;

    const warnings = checkCoverage(sourceBlocks, outputDoc);
    expect(warnings).toHaveLength(0);
  });

  it('a dropped block → warning with coverage=0', () => {
    const sourceBlocks: BodyBlock[] = [
      block('block-0', '# ROLE',     '\nYou are a senior developer.\n', 0),
      block('block-1', '# DROPPED',  '\nThis block was dropped entirely.\nWith multiple lines.\n', 1),
    ];
    // Output contains only the ROLE block content.
    const outputDoc = `# ROLE\n\nYou are a senior developer.\n`;

    const warnings = checkCoverage(sourceBlocks, outputDoc);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].blockId).toBe('block-1');
    expect(warnings[0].coverage).toBe(0);
  });

  it('a paraphrased block → warning (significantly altered content)', () => {
    const sourceBlocks: BodyBlock[] = [
      block('block-0', '# ROLE', '\nYou are a senior developer.\n', 0),
      block('block-1', '# RULES',
        '\nNever lie.\nAlways help users.\nBe concise.\nDo not hallucinate.\nRespect privacy.\n',
        1,
      ),
    ];
    // Output completely rewrites block-1 with different content.
    const outputDoc = `# ROLE\n\nYou are a senior developer.\n\n# RULES\n\nBe honest. Help people. Keep it short.\n`;

    const warnings = checkCoverage(sourceBlocks, outputDoc);
    // The paraphrased content should produce a warning (coverage < 0.8).
    expect(warnings.length).toBeGreaterThan(0);
    const rulesWarning = warnings.find((w) => w.blockId === 'block-1');
    expect(rulesWarning).toBeDefined();
    expect(rulesWarning!.coverage).toBeLessThan(0.8);
  });

  it('content moved inside a merged section → no warning', () => {
    const sourceBlocks: BodyBlock[] = [
      block('block-0', '# BEHAVIOR',
        '\nStep 1: read the input.\nStep 2: process it.\nStep 3: output the result.\n',
        0,
      ),
      block('block-1', '# NOTES',
        '\nAlways verify assumptions.\nCheck edge cases.\n',
        1,
      ),
    ];
    // Output merges both into one BEHAVIOR section — all content preserved.
    const outputDoc = [
      '# BEHAVIOR',
      '',
      'Step 1: read the input.',
      'Step 2: process it.',
      'Step 3: output the result.',
      'Always verify assumptions.',
      'Check edge cases.',
      '',
    ].join('\n');

    const warnings = checkCoverage(sourceBlocks, outputDoc);
    expect(warnings).toHaveLength(0);
  });

  it('empty block content is skipped without warning', () => {
    const sourceBlocks: BodyBlock[] = [
      block('block-0', '# ROLE', '\nYou are a developer.\n', 0),
      block('block-1', '# EMPTY', '\n   \n\n', 1),  // whitespace-only
    ];
    const outputDoc = `# ROLE\n\nYou are a developer.\n`;

    const warnings = checkCoverage(sourceBlocks, outputDoc);
    // Empty block should not produce a warning.
    expect(warnings.find((w) => w.blockId === 'block-1')).toBeUndefined();
  });

  it('partial loss below threshold produces warning; above threshold does not', () => {
    // 5 source lines; output keeps 4 of them (80% — exactly at threshold, no warning).
    const fiveLines = '\nLine one.\nLine two.\nLine three.\nLine four.\nLine five.\n';
    const sourceBlocks: BodyBlock[] = [
      block('block-0', '# ROLE', fiveLines, 0),
    ];
    const fourLinesOutput = `# ROLE\n\nLine one.\nLine two.\nLine three.\nLine four.\n`;

    const warnings80 = checkCoverage(sourceBlocks, fourLinesOutput);
    // 4/5 = 0.8 — exactly at threshold, NOT below, so no warning.
    expect(warnings80).toHaveLength(0);

    // 3 out of 5 lines → 0.6 < 0.8 → warning.
    const threeLinesOutput = `# ROLE\n\nLine one.\nLine two.\nLine three.\n`;
    const warnings60 = checkCoverage(sourceBlocks, threeLinesOutput);
    expect(warnings60).toHaveLength(1);
    expect(warnings60[0].blockId).toBe('block-0');
  });
});
