/**
 * lib/serialize/importParse.ts
 *
 * Stage-1 parse: the left side of the round-trip invariant.
 * Composes parseFrontmatter + splitBody into parse(md): StructuredAgent.
 *
 * This is Stage-1 ONLY — deterministic, no AI.
 * Stage-2 labeling (blockId → sectionKey mapping) happens in Phase 3 against the DB.
 */

import { parseFrontmatter, bodyStartOf } from './parseFrontmatter.js';
import { splitBody } from './splitBody.js';
import type { StructuredAgent } from './types.js';

/**
 * Parses a markdown agent file into a StructuredAgent.
 *
 * - Frontmatter: ordered {key, rawValue}[] with FAILSAFE_SCHEMA (no coercion).
 * - splitLevel: shallowest heading level in the body.
 * - blocks: ordered BodyBlock[] with stable blockIds.
 */
export function parse(md: string): StructuredAgent {
  const frontmatter = parseFrontmatter(md);
  const bodyStart = bodyStartOf(md);
  const body = md.slice(bodyStart);
  const { splitLevel, blocks } = splitBody(body);

  return { frontmatter, splitLevel, blocks };
}
