import 'server-only';

/**
 * lib/ai/hermes.ts
 *
 * Stage-2 import caller. Sends each Stage-1 block's blockId + heading text (never
 * content) + the Agent Blueprint + the compiled HERMES_PROMPT to Claude
 * and parses the labels-only JSON.
 *
 * Hard rule: the AI response must NEVER contain a `content` or `text`
 * field at the top level or inside any mapping entry. If it does, we throw
 * HermesInvalidResponseError — the server always copies content bytes from
 * Stage-1 blocks by blockId; the AI only supplies labels.
 */

import { getGateway, LlmDryRunBlockedError, LlmUserCapReachedError } from './gateway.js';
import type { LlmCallContext } from './gateway.js';
import { HERMES_PROMPT } from './prompts/generated/hermes.js';
import { renderBlueprintForPrompt } from '../blueprint/index.js';
import type { SectionDefLite } from '../db/repository/agents.js';

// ─────────────────────────────  Types  ────────────────────────────────────────

export type Stage2Mapping =
  | { blockId: string; sectionKey: string }
  | { blockIds: string[]; sectionKey: string };

export type Stage2Labels = {
  mappings: Stage2Mapping[];
  unmapped: string[];
};

// ─────────────────────────────  Errors  ────────────────────────────────────────

/** Thrown when the Anthropic API call itself fails (network, auth, timeout, etc.). */
export class HermesUpstreamError extends Error {
  constructor(cause: string) {
    super(`Anthropic API failure: ${cause}`);
    this.name = 'HermesUpstreamError';
  }
}

/**
 * Thrown when the AI returns a structurally invalid response, or when it includes
 * forbidden content/text fields — Stage 2 output is labels only, never content;
 * this is the defense-in-depth check for that rule.
 */
export class HermesInvalidResponseError extends Error {
  constructor(reason: string) {
    super(`Invalid AI label response: ${reason}`);
    this.name = 'HermesInvalidResponseError';
  }
}

/**
 * Thrown when Hermes's response was truncated (stop_reason === 'max_tokens').
 * A truncated label response is content loss by definition — never trusted
 * (same rationale as DaedalusTruncatedError, generalized to Strict Import).
 * Routes to 422 { error: 'strict_truncated' }.
 */
export class HermesTruncatedError extends Error {
  constructor() {
    super('Hermes response was truncated (max_tokens) — content loss, rejected');
    this.name = 'HermesTruncatedError';
  }
}

// ─────────────────────────────  Caller  ────────────────────────────────────────

/** The only per-block data Stage 2 ever receives: id + heading, never content. */
export type Stage2BlockRef = {
  blockId: string;
  heading: string | null;
};

/**
 * Sends each block's id + heading text (never content) from Stage 1 to Claude and
 * returns the Stage-2 label map.
 *
 * @param blocks       Stable block identifiers + heading text from Stage-1 parse
 * @param sectionDefs  The platform's section catalog — fetched by the route via
 *   getSectionDefs(platform) and forwarded here (same boundary reasoning as daedalus.ts).
 * @param ctx     Gateway context for logging (§5.2 — agentId best-effort at call time)
 * @returns       Parsed and validated Stage2Labels
 * @throws        LlmDryRunBlockedError          when live LLM calls are disabled
 * @throws        HermesUpstreamError   on API failure
 * @throws        HermesInvalidResponseError  on bad/content-bearing AI output
 */
export async function callHermes(
  blocks: Stage2BlockRef[],
  sectionDefs: readonly SectionDefLite[],
  ctx: LlmCallContext = { kind: 'import-strict' },
): Promise<Stage2Labels> {
  // Stage 2 never classifies config/frontmatter data — frontmatter keys are already
  // exact, unambiguous strings, unlike headings, so there's no classification
  // problem for the AI to solve there. Omit it from the prompt.
  const blueprint = renderBlueprintForPrompt(sectionDefs, { includeConfig: false });

  const userMessage = [
    'Classify the following Stage-1 blocks according to the Agent Blueprint.',
    'Each block is given by its blockId and heading text only — never its content.',
    'Return only the JSON labels object — no prose, no code fences.',
    '',
    'Blocks to classify:',
    JSON.stringify(blocks, null, 2),
    '',
    blueprint,
  ].join('\n');

  // Dry-run check outside the catch-all so it can never be swallowed as ai_upstream (§3.6).
  let res;
  try {
    res = await getGateway().complete(
      {
        system: HERMES_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 4096,
      },
      ctx,
    );
  } catch (err) {
    // Belt-and-braces: re-throw LlmDryRunBlockedError unchanged if it somehow ends up here
    if (err instanceof LlmDryRunBlockedError) throw err;
    throw new HermesUpstreamError(String(err));
  }

  // Handle policy-refusal results (§3.6, §3.9 — outside the try, cannot be misclassified as 502)
  if (!res.ok) {
    if (res.reason === 'llm_cap_reached') throw new LlmUserCapReachedError(res);
    throw new LlmDryRunBlockedError(res.logId, ctx.kind, res.model);
  }

  // Hard fail on truncation — a truncated label response is content loss by
  // definition, same rule daedalus.ts/prometheus.ts already enforce for their own calls.
  if (res.response.stopReason === 'max_tokens') {
    throw new HermesTruncatedError();
  }

  // Provider-level errors (no text block) are already mapped by anthropicProvider.ts —
  // any remaining upstream error would come through the catch above.
  return parseHermesLabels(res.response.text);
}

// ─────────────────────────────  Internal validation  ──────────────────────────

export function parseHermesLabels(responseText: string): Stage2Labels {
  // Extract the JSON object — the AI may wrap it in a code fence.
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new HermesInvalidResponseError('No JSON object found in AI response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new HermesInvalidResponseError('AI response is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HermesInvalidResponseError('AI response root is not a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  // Defense-in-depth: top-level content/text fields are forbidden — Stage 2
  // output is labels only, never content.
  if ('content' in obj || 'text' in obj) {
    throw new HermesInvalidResponseError(
      'AI response contains forbidden "content" or "text" field at top level',
    );
  }

  if (!Array.isArray(obj.mappings)) {
    throw new HermesInvalidResponseError('AI response missing "mappings" array');
  }

  if (!Array.isArray(obj.unmapped)) {
    throw new HermesInvalidResponseError('AI response missing "unmapped" array');
  }

  // Validate each mapping entry.
  for (const entry of obj.mappings as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new HermesInvalidResponseError('Mapping entry is not an object');
    }
    const m = entry as Record<string, unknown>;

    // Forbidden fields inside a mapping — same labels-only rule, defense-in-depth.
    if ('content' in m || 'text' in m) {
      throw new HermesInvalidResponseError(
        'Mapping entry contains forbidden "content" or "text" field',
      );
    }

    // Must have blockId or blockIds.
    const hasBlockId = 'blockId' in m && typeof m.blockId === 'string';
    const hasBlockIds =
      'blockIds' in m &&
      Array.isArray(m.blockIds) &&
      (m.blockIds as unknown[]).every((x) => typeof x === 'string');

    if (!hasBlockId && !hasBlockIds) {
      throw new HermesInvalidResponseError(
        'Mapping entry missing valid "blockId" (string) or "blockIds" (string[])',
      );
    }

    // Must have sectionKey. (propKey removed 2026-07-26 — config mapping is fully
    // deterministic from frontmatter: frontmatter keys are already exact, unambiguous
    // strings, so there's no classification problem for the AI to solve there.)
    const hasSectionKey = 'sectionKey' in m && typeof m.sectionKey === 'string';
    if (!hasSectionKey) {
      throw new HermesInvalidResponseError('Mapping entry missing "sectionKey"');
    }
  }

  // A4: reject any response where a blockId appears in more than one mapping entry.
  // Overlapping merge groups silently drop a block in assemble() (audit finding 2).
  const seenBlockIds = new Set<string>();
  for (const entry of obj.mappings as Stage2Mapping[]) {
    const ids = 'blockIds' in entry ? entry.blockIds : [entry.blockId];
    for (const id of ids) {
      if (seenBlockIds.has(id)) {
        throw new HermesInvalidResponseError(
          `blockId "${id}" appears in more than one mapping entry (overlapping groups)`,
        );
      }
      seenBlockIds.add(id);
    }
  }

  return {
    mappings: obj.mappings as Stage2Mapping[],
    unmapped: obj.unmapped as string[],
  };
}
