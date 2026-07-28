/**
 * lib/serialize/export.ts
 *
 * Deterministic write-out of a StructuredAgent to a markdown string (Draft B).
 *
 * Rules:
 * - Frontmatter: normalized YAML (FAILSAFE_SCHEMA, no key sorting, no line-wrap).
 * - Sections by ascending order.
 * - Headingless blocks (heading: null) are rendered as bare content — no heading invented.
 * - Section body is byte-for-byte the stored content (Rules Index #2).
 *
 * This is the right side of the round-trip invariant:
 *   parse(exportAgent(parse(md))) deep-equals parse(md)
 *
 * Note: the exported name in the barrel is "export" (the spec name). TypeScript
 * callers import it as `import { exportAgent } from '@/lib/serialize'` since `export`
 * is a reserved word and cannot be used as a destructured local binding.
 */

import * as yaml from 'js-yaml';
import type { StructuredAgent } from './types.js';

/**
 * Serializes a StructuredAgent back to a markdown string.
 * Semantic fidelity (not byte-identical); the round-trip invariant holds structurally.
 */
export function exportAgent(structured: StructuredAgent): string {
  // ── Frontmatter ────────────────────────────────────────────────────────────
  let output = '---\n';

  if (structured.frontmatter.length > 0) {
    // Reconstruct as a plain object preserving insertion order.
    // Object.fromEntries preserves the array order as string-key insertion order in V8+.
    // rawValue is now string | string[] (A3 — lists survive round-trip as arrays).
    const fmObj: Record<string, string | string[]> = Object.fromEntries(
      structured.frontmatter.map(({ key, rawValue }) => [key, rawValue]),
    );

    // yaml.dump with sortKeys:false + lineWidth:-1:
    //   - Scalars: quoted where needed for round-trip safety (DEFAULT_SCHEMA).
    //   - Arrays: emitted as YAML sequences — round-trips back to string[] via FAILSAFE_SCHEMA.
    //   - Keys are NOT alphabetically sorted (insertion order preserved).
    //   - Long strings are NOT wrapped.
    // Use DEFAULT_SCHEMA for dumping — FAILSAFE_SCHEMA adds !!str tags to every
    // scalar which breaks the round-trip regex match on re-parse.
    // The invariant holds: DEFAULT_SCHEMA dump + FAILSAFE_SCHEMA load produces the
    // same string values because DEFAULT_SCHEMA quotes values that look like booleans
    // or numbers, so FAILSAFE_SCHEMA parse still returns strings.
    output += yaml.dump(fmObj, {
      sortKeys: false,
      lineWidth: -1,
    });
  }

  output += '---\n';

  // ── Body blocks (sorted by order) ─────────────────────────────────────────
  const sortedBlocks = [...structured.blocks].sort((a, b) => a.order - b.order);

  for (const block of sortedBlocks) {
    if (block.heading === null) {
      // Headingless preamble block — bare content, no invented heading (Rules Index #2)
      output += block.content;
    } else {
      // Headed block — heading line + content bytes
      output += block.heading + '\n' + block.content;
    }
  }

  return output;
}
