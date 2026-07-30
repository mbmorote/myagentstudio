import 'server-only';

/**
 * lib/ai/structuralConverter.ts
 *
 * Stage-2b caller for Structural Import mode (Rules Index #27, #31).
 *
 * Unlike the Strict Import converter (importConverter.ts) which receives only
 * blockId + heading and returns labels, the structural converter receives the
 * agent's full raw text and the blueprint, and returns the ENTIRE restructured
 * agent body as one markdown document — no frontmatter in the output (frontmatter
 * is handled 100% deterministically by the server in both modes).
 *
 * The returned document is then persisted by re-running Stage-1 parse() on it
 * and mapping headings → sectionKeys via SECTION_DEFS.defaultHeading (B3).
 *
 * Safety model: prompt-enforced restructure (import-instructions-structural.md)
 * plus deterministic coverage check (lib/import/coverage.ts — B5).
 * A truncated response (stop_reason === 'max_tokens') is a hard fail — never
 * stored, routes to 422 (Rules Index #31).
 */

import { getGateway, LlmDryRunBlockedError } from './gateway.js';
import type { LlmCallContext } from './gateway.js';
import { STRUCTURAL_IMPORT_PROMPT } from './prompts/generated/import-instructions-structural.js';
import { renderBlueprintForPrompt } from '../blueprint/index.js';

// ─────────────────────────────  Errors  ────────────────────────────────────────

/** Thrown when the Anthropic API call itself fails (network, auth, timeout, etc.). */
export class StructuralConverterUpstreamError extends Error {
  constructor(cause: string) {
    super(`Anthropic API failure (structural): ${cause}`);
    this.name = 'StructuralConverterUpstreamError';
  }
}

/**
 * Thrown when the structural converter's response was truncated (stop_reason === 'max_tokens').
 * A truncated document is silent content loss by definition — never stored (Rules Index #31).
 * Routes to 422 { error: 'structural_truncated' }.
 */
export class StructuralConverterTruncatedError extends Error {
  constructor() {
    super('Structural converter response was truncated (max_tokens) — content loss, rejected');
    this.name = 'StructuralConverterTruncatedError';
  }
}

/**
 * Thrown when the structural converter returns a structurally invalid response
 * (e.g. no text block in the response).
 */
export class StructuralConverterInvalidResponseError extends Error {
  constructor(reason: string) {
    super(`Invalid structural converter response: ${reason}`);
    this.name = 'StructuralConverterInvalidResponseError';
  }
}

// ─────────────────────────────  Caller  ────────────────────────────────────────

/**
 * Calls the structural import converter with the agent's full raw markdown.
 * Returns the restructured body document as a string (no frontmatter — the server
 * handles frontmatter deterministically from Stage-1 parse output).
 *
 * Uses gateway.stream() which preserves the streaming transport (§3.5):
 * the SDK's finalMessage() is used internally, same as before this refactor.
 *
 * @param rawMd  The full raw markdown of the agent file being imported.
 * @param ctx    Gateway context for logging (§5.2)
 * @returns      The restructured body document (markdown, no frontmatter).
 * @throws       LlmDryRunBlockedError             when live LLM calls are disabled
 * @throws       StructuralConverterUpstreamError   on API failure
 * @throws       StructuralConverterTruncatedError  on stop_reason === 'max_tokens'
 * @throws       StructuralConverterInvalidResponseError  on unexpected response shape
 */
export async function callStructuralConverter(
  rawMd: string,
  ctx: LlmCallContext = { kind: 'import-structural' },
): Promise<string> {
  const blueprint = renderBlueprintForPrompt({ includeConfig: false });

  // Build the user message per the INPUT section of import-instructions-structural.md:
  // two clearly delimited attachments — the blueprint catalog and the full raw agent text.
  //
  // The agent being imported may itself contain fenced code blocks (```/~~~) — wrapping
  // it in a ``` fence would prematurely close on the first one found inside real agent
  // files (confirmed: 3 of 15 golden fixtures contain fenced code). XML-style tags are
  // used instead, since a raw agent file containing a literal "</agent-source>" line is
  // vanishingly unlikely, unlike a literal ``` line.
  const userMessage = [
    '<agent-blueprint>',
    blueprint,
    '</agent-blueprint>',
    '',
    '<agent-source>',
    rawMd,
    '</agent-source>',
  ].join('\n');

  // Dry-run check outside the catch-all so it can never be swallowed as ai_upstream (§3.6).
  let res;
  try {
    // Stream the response — structural output can be large (full agent body).
    // gateway.stream() preserves the SDK's streaming transport (§3.5).
    res = await getGateway().stream(
      {
        system: STRUCTURAL_IMPORT_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 32000,
      },
      ctx,
    );
  } catch (err) {
    // Belt-and-braces: re-throw LlmDryRunBlockedError unchanged
    if (err instanceof LlmDryRunBlockedError) throw err;
    throw new StructuralConverterUpstreamError(String(err));
  }

  // Handle dry-run result (§3.6 — outside the try, cannot be misclassified as 502)
  if (!res.ok) throw new LlmDryRunBlockedError(res.logId, ctx.kind, res.model);

  // Hard fail on truncation — a truncated document is content loss (Rules Index #31).
  // Domain rule stays in the caller — the gateway only records stopReason, never acts on it (§3.5).
  if (res.response.stopReason === 'max_tokens') {
    throw new StructuralConverterTruncatedError();
  }

  return res.response.text;
}
