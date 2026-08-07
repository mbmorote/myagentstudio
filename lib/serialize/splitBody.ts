/**
 * lib/serialize/splitBody.ts
 *
 * Stage-1 deterministic body splitter.
 *
 * Rules:
 * - Splits on the **shallowest** heading level actually present in the body.
 * - Respects fenced code blocks: ``` and ~~~ fences are tracked; a `#` line
 *   inside a fence is NOT treated as a heading.
 * - An unclosed fence ⇒ everything from the fence-open to end-of-body is
 *   content (treated as one big fence block, so no headings are detected).
 * - Pre-heading prose (before the first heading at the split level) becomes a
 *   block with heading: null and order: 0, PROVIDED it contains at least one
 *   non-whitespace character. Purely-whitespace preambles are dropped.
 * - blockIds are "block-{order}" — deterministic, stable per parse.
 */

import type { BodyBlock } from './types.js';

export type SplitResult = {
  splitLevel: number;
  blocks: BodyBlock[];
};

/** Returns the ATX heading level of a line (1–6), or 0 if not a heading. */
function headingLevel(line: string): number {
  const m = /^(#{1,6}) /.exec(line);
  return m ? m[1].length : 0;
}

/**
 * Checks whether a line opens or closes a fenced code block.
 * Opening: line starts with 3+ backticks or 3+ tildes (ATX fence).
 * A fence is closed by a line starting with the SAME fence character and at
 * least the SAME number of repeated characters.
 */
function fenceMarkerOf(line: string): string | null {
  const m = /^(`{3,}|~{3,})/.exec(line);
  return m ? m[1] : null;
}

/**
 * Splits a markdown body string into BodyBlocks at the shallowest heading level.
 */
export function splitBody(body: string): SplitResult {
  // Split into raw lines (preserving \r in content if CRLF source).
  // linePositions[i] is the byte-offset of the start of line i in `body`.
  const rawLines = body.split('\n');
  const linePositions: number[] = [];
  let cumPos = 0;
  for (let i = 0; i < rawLines.length; i++) {
    linePositions.push(cumPos);
    // +1 accounts for the '\n' that split removed
    cumPos += rawLines[i].length + 1;
  }
  // Note: cumPos may exceed body.length by 1 for bodies that don't end in '\n',
  // but we always clamp to body.length when slicing.

  // Strip trailing \r from each line for heading/fence detection only.
  // Raw content is still extracted directly from `body` via linePositions.
  const lines = rawLines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

  // ── Pass 1: collect headings outside fences ──────────────────────────────

  let inFence = false;
  let fenceChar = '';
  let fenceMinLen = 0;

  const headings: { lineIndex: number; level: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inFence) {
      const marker = fenceMarkerOf(line);
      // Close the fence if same character and at least the same length
      if (marker && marker[0] === fenceChar && marker.length >= fenceMinLen) {
        inFence = false;
        fenceChar = '';
        fenceMinLen = 0;
      }
      // Inside fence: nothing is a heading
    } else {
      const marker = fenceMarkerOf(line);
      if (marker) {
        inFence = true;
        fenceChar = marker[0];
        fenceMinLen = marker.length;
      } else {
        const level = headingLevel(line);
        if (level > 0) {
          headings.push({ lineIndex: i, level, text: line });
        }
      }
    }
  }

  // ── Determine splitLevel ──────────────────────────────────────────────────

  if (headings.length === 0) {
    // No headings at all — entire body is one optional headingless block
    const blocks: BodyBlock[] = [];
    if (body.trim().length > 0) {
      blocks.push({ blockId: 'block-0', heading: null, content: body, order: 0 });
    }
    return { splitLevel: 1, blocks };
  }

  const splitLevel = Math.min(...headings.map((h) => h.level));

  // ── Pass 2: filter to only split-level headings ───────────────────────────

  const splitHeadings = headings.filter((h) => h.level === splitLevel);

  // ── Pass 3: build blocks ─────────────────────────────────────────────────

  const blocks: BodyBlock[] = [];
  let order = 0;

  /** Slices a region of body clamped to valid bounds. */
  const slice = (start: number, end: number): string =>
    body.slice(Math.max(0, start), Math.min(body.length, end));

  // Preamble: everything before the first split-level heading
  const firstHeading = splitHeadings[0];
  const preambleContent = slice(0, linePositions[firstHeading.lineIndex]);

  if (preambleContent.trim().length > 0) {
    blocks.push({
      blockId: `block-${order}`,
      heading: null,
      content: preambleContent,
      order: order,
    });
    order++;
  }
  // If preamble is whitespace-only, skip it (structural drop; round-trip still
  // holds because export also skips the leading whitespace, so parse(export(x))
  // produces no preamble block either).

  // Headed blocks
  for (let i = 0; i < splitHeadings.length; i++) {
    const current = splitHeadings[i];
    const next = splitHeadings[i + 1];

    // Heading line in body ends where the next line starts.
    const headingLineEnd =
      current.lineIndex + 1 < linePositions.length
        ? linePositions[current.lineIndex + 1]
        : body.length;

    // Content: from after the heading line to before the next split heading (or end)
    const contentEnd = next ? linePositions[next.lineIndex] : body.length;
    const content = slice(headingLineEnd, contentEnd);

    blocks.push({
      blockId: `block-${order}`,
      heading: current.text, // without \r (stripped above)
      content,
      order: order,
    });
    order++;
  }

  return { splitLevel, blocks };
}
