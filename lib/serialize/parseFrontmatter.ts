/**
 * lib/serialize/parseFrontmatter.ts
 *
 * String-preserving YAML frontmatter parser (Rules Index #4, #34, #35).
 *
 * - Uses js-yaml FAILSAFE_SCHEMA: all plain scalars are kept as strings.
 *   This prevents coercions like `claude-sonnet-4-6` → float, `no` → false.
 * - Returns an ordered {key, rawValue}[] array.
 * - rawValue is string | string[]: scalar → string, block-list → string[].
 *   Nested maps or lists-of-non-scalars → FrontmatterParseError (loud, A3).
 * - YAML comments are silently dropped — this is documented and tested as
 *   an accepted loss per Rules Index #4.
 * - Matched-but-unparseable frontmatter throws FrontmatterParseError (A2).
 *   No frontmatter block at all (regex no-match) remains a valid [] case.
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
 * Thrown when a frontmatter block is present but cannot be parsed (A2),
 * or when a value is of an unsupported type (nested map / non-scalar array — A3).
 *
 * Routes catch this and return 400 with the appropriate error code.
 */
export class FrontmatterParseError extends Error {
  /** 'invalid_frontmatter' for malformed YAML; 'unsupported_frontmatter' for nested values. */
  readonly code: 'invalid_frontmatter' | 'unsupported_frontmatter';
  /** The frontmatter key that triggered the error, if applicable. */
  readonly key?: string;

  constructor(code: 'invalid_frontmatter' | 'unsupported_frontmatter', key?: string) {
    super(
      code === 'invalid_frontmatter'
        ? 'Frontmatter block is present but cannot be parsed as valid YAML'
        : `Frontmatter key "${key}" has an unsupported nested value (only scalars and flat lists are allowed)`,
    );
    this.name = 'FrontmatterParseError';
    this.code = code;
    this.key = key;
  }
}

/**
 * Parses the YAML frontmatter from a full markdown string.
 * Returns an ordered array of {key, rawValue} pairs.
 * All scalar values are preserved as strings — no type coercion.
 * Flat lists (arrays of scalars) are returned as string[].
 * Returns [] if no frontmatter block is found (regex no-match).
 *
 * @throws {FrontmatterParseError} code:'invalid_frontmatter' — frontmatter regex matched
 *   but yaml.load() threw (malformed YAML — e.g. duplicate keys, tab indentation).
 * @throws {FrontmatterParseError} code:'unsupported_frontmatter' — a value is a nested
 *   mapping or an array containing non-scalars (stated limitation until __raw hatch, A3).
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
    throw new FrontmatterParseError('invalid_frontmatter');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

  const entries: FrontmatterEntry[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') {
      // Common case: scalar string (FAILSAFE_SCHEMA ensures all plain scalars are strings).
      entries.push({ key, rawValue: value });
    } else if (Array.isArray(value)) {
      // Flat list: each item must be a scalar string (FAILSAFE_SCHEMA → always strings
      // for plain scalars, but nested objects/arrays inside the list are unsupported).
      for (const item of value as unknown[]) {
        if (typeof item !== 'string') {
          // Non-scalar array item (e.g. a nested map inside a list) — loud rejection (A3).
          throw new FrontmatterParseError('unsupported_frontmatter', key);
        }
      }
      entries.push({ key, rawValue: value as string[] });
    } else {
      // Nested mapping or other non-scalar — unsupported until __raw hatch exists (A3).
      throw new FrontmatterParseError('unsupported_frontmatter', key);
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
