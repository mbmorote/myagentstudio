/**
 * lib/serialize/parseFrontmatter.ts
 *
 * String-preserving YAML frontmatter parser (Rules Index #4).
 *
 * - Uses js-yaml FAILSAFE_SCHEMA: all plain scalars are kept as strings.
 *   This prevents coercions like `claude-sonnet-4-6` → float, `no` → false.
 * - Returns an ordered {key, rawValue}[] array.
 * - YAML comments are silently dropped — this is documented and tested as
 *   an accepted loss per Rules Index #4.
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
 * Parses the YAML frontmatter from a full markdown string.
 * Returns an ordered array of {key, rawValue} pairs.
 * All values are preserved as strings — no type coercion.
 * Returns [] if no valid frontmatter block is found.
 */
export function parseFrontmatter(md: string): FrontmatterEntry[] {
  const match = FRONTMATTER_RE.exec(md);
  if (!match) return [];

  const yamlText = match[1];

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlText, { schema: yaml.FAILSAFE_SCHEMA });
  } catch {
    // Malformed YAML — return empty rather than throwing (fail-safe)
    return [];
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

  const entries: FrontmatterEntry[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    // With FAILSAFE_SCHEMA all scalars are strings, but sequences/mappings
    // would still be parsed as arrays/objects. Stringify defensively.
    entries.push({ key, rawValue: String(value) });
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
