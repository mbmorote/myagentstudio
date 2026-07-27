/**
 * lib/serialize/types.ts
 *
 * The canonical "structured" form of a parsed agent file. (R3)
 *
 * `StructuredAgent` is the operational definition of the round-trip invariant:
 *   parse(export(parse(md))) deep-equals parse(md)
 *
 * - frontmatter: ordered array of {key, rawValue} string pairs (no coercion)
 * - splitLevel:  the shallowest heading depth found in the body (1 = #, 2 = ##…)
 * - blocks:      ordered array of body blocks, each with a stable blockId
 *
 * Equality is deep-equal of this normalized object.
 * content is compared byte-for-byte; frontmatter is compared as strings (no coercion).
 */

export type FrontmatterEntry = {
  /** The YAML key, e.g. "model" */
  key: string;
  /** The scalar value preserved as a string — no type coercion (Rules Index #4) */
  rawValue: string;
};

export type BodyBlock = {
  /**
   * Stable block identifier, derived deterministically from the block's position
   * in the parsed output ("block-0", "block-1", …).
   * Used by Stage-2 import to map blocks to sectionKeys (Phase 3).
   */
  blockId: string;
  /**
   * The full heading line including the # prefix (e.g. "# ROLE"), or null for a
   * headingless preamble block (Rules Index #2).
   */
  heading: string | null;
  /**
   * The raw body content of this block, byte-for-byte as it appears in the source,
   * NOT including the heading line itself.
   */
  content: string;
  /** Zero-based position among blocks. The headingless preamble is always order 0. */
  order: number;
};

export type StructuredAgent = {
  /** Ordered frontmatter entries, preserved as strings (failsafe YAML, Rules Index #4). */
  frontmatter: FrontmatterEntry[];
  /**
   * The heading level used to split the body (1 = #, 2 = ##, …).
   * Derived as the shallowest heading depth actually present in the body.
   * Defaults to 1 when the body has no headings. (R1)
   */
  splitLevel: number;
  /** Ordered body blocks. */
  blocks: BodyBlock[];
};
