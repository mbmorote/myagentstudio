/**
 * lib/serialize/parseFrontmatter.ts
 *
 * String-preserving YAML frontmatter parser.
 *
 * - Uses js-yaml FAILSAFE_SCHEMA: all plain scalars are kept as strings.
 *   This prevents coercions like `claude-sonnet-4-6` → float, `no` → false.
 * - Returns an ordered {key, rawValue}[] array.
 * - rawValue: scalar → string, flat list → string[], nested mapping or a list
 *   containing non-scalars → Record<string, unknown> | unknown[], preserved verbatim
 *   (supersedes an earlier hard-reject-on-nested-value behavior; the deferred `__raw`
 *   escape hatch that would have addressed it was retired in favor of catalog keys
 *   declaring `datatype: 'json'` instead).
 * - YAML comments are silently dropped — this is documented and tested as an
 *   accepted, deliberate exception to lossless round-tripping (there's no `custom`
 *   slot to hold a comment in, since it isn't a key).
 * - Matched-but-unparseable frontmatter throws FrontmatterParseError (loud, never a
 *   silently-discarded frontmatter block). No frontmatter block at all (regex
 *   no-match) remains a valid [] case.
 */

import * as yaml from 'js-yaml';
import type { FrontmatterEntry } from './types.js';

/**
 * Regex that matches an opening `---`, the YAML content (non-greedy), and a
 * closing `---` followed by a newline or end-of-string.
 * Handles both LF and CRLF line endings.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Thrown when a frontmatter block is present but cannot be parsed as valid YAML.
 * Nested values no longer throw (see the file header) — this is the only
 * remaining failure mode, so there is no error `code`/`key` discriminant to carry.
 *
 * Routes catch this and return 400 `invalid_frontmatter`.
 */
export class FrontmatterParseError extends Error {
  constructor() {
    super('Frontmatter block is present but cannot be parsed as valid YAML');
    this.name = 'FrontmatterParseError';
  }
}

/**
 * Parses the YAML frontmatter from a full markdown string.
 * Returns an ordered array of {key, rawValue} pairs.
 * All scalar values are preserved as strings — no type coercion.
 * Flat lists (arrays of scalars) are returned as string[].
 * Returns [] if no frontmatter block is found (regex no-match).
 *
 * @throws {FrontmatterParseError} frontmatter regex matched but yaml.load() threw
 *   (malformed YAML — e.g. duplicate keys, tab indentation).
 */
export function parseFrontmatter(md: string): FrontmatterEntry[] {
  const match = FRONTMATTER_RE.exec(md);
  if (!match) return [];

  const yamlText = match[1];

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlText, { schema: yaml.FAILSAFE_SCHEMA });
  } catch {
    // Matched but unparseable — throw loudly (A2). Returning [] would silently discard
    // the entire frontmatter (including name), causing '' → collision bugs.
    throw new FrontmatterParseError();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

  const entries: FrontmatterEntry[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') {
      // Common case: scalar string (FAILSAFE_SCHEMA ensures all plain scalars are strings).
      entries.push({ key, rawValue: value });
    } else if (Array.isArray(value)) {
      // Flat list (every item a scalar string) stays string[], matching pre-existing
      // behavior. A list containing a nested map/array (e.g. an inline mcpServers entry)
      // is preserved verbatim as unknown[] — supersedes A3's old rejection (#35/#40).
      const items = value as unknown[];
      const allScalars = items.every((item) => typeof item === 'string');
      entries.push({ key, rawValue: allScalars ? (items as string[]) : items });
    } else {
      // Nested mapping (FAILSAFE_SCHEMA guarantees a plain object here) — preserved
      // verbatim, e.g. `hooks`. Supersedes A3's old rejection (#35/#40).
      entries.push({ key, rawValue: value as Record<string, unknown> });
    }
  }

  return entries;
}

/**
 * Returns the byte offset in `md` at which the body begins (the character
 * immediately after the closing `---` line, including its newline).
 * Returns 0 if no frontmatter block is found.
 */
export function bodyStartOf(md: string): number {
  const match = FRONTMATTER_RE.exec(md);
  return match ? match[0].length : 0;
}
