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

import { getClient, getModel } from './client.js';
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
 * Uses streaming to handle the larger response size (up to 32000 tokens).
 *
 * @param rawMd  The full raw markdown of the agent file being imported.
 * @returns      The restructured body document (markdown, no frontmatter).
 * @throws       StructuralConverterUpstreamError   on API failure
 * @throws       StructuralConverterTruncatedError  on stop_reason === 'max_tokens'
 * @throws       StructuralConverterInvalidResponseError  on unexpected response shape
 */
export async function callStructuralConverter(rawMd: string): Promise<string> {
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

  try {
    const client = getClient();
    const model = getModel();

    // Stream the response — structural output can be large (full agent body).
    const stream = client.messages.stream({
      model,
      max_tokens: 32000,
      system: STRUCTURAL_IMPORT_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const finalMessage = await stream.finalMessage();

    // Hard fail on truncation — a truncated document is content loss (Rules Index #31).
    if (finalMessage.stop_reason === 'max_tokens') {
      throw new StructuralConverterTruncatedError();
    }

    const textBlock = finalMessage.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new StructuralConverterInvalidResponseError('No text block in Anthropic response');
    }

    return textBlock.text;
  } catch (err) {
    // Re-throw our own typed errors unchanged.
    if (
      err instanceof StructuralConverterTruncatedError ||
      err instanceof StructuralConverterInvalidResponseError
    ) {
      throw err;
    }
    throw new StructuralConverterUpstreamError(String(err));
  }
}
