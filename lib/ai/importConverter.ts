import 'server-only';

/**
 * lib/ai/importConverter.ts
 *
 * Stage-2 import caller. Sends Stage-1 blockIds + the Agent Blueprint +
 * the compiled IMPORT_CONVERTER_PROMPT to Claude and parses the labels-only JSON.
 *
 * Hard rule (Rules Index #5): the AI response must NEVER contain a `content` or `text`
 * field at the top level or inside any mapping entry. If it does, we throw
 * ImportConverterInvalidResponseError — the server always copies content bytes from
 * Stage-1 blocks by blockId; the AI only supplies labels.
 */

import { getClient, getModel } from './client.js';
import { IMPORT_CONVERTER_PROMPT } from './prompts/generated/import-converter.js';
import { renderBlueprintForPrompt } from '../blueprint/index.js';

// ─────────────────────────────  Types  ────────────────────────────────────────

export type Stage2Mapping =
  | { blockId: string; sectionKey: string }
  | { blockIds: string[]; sectionKey: string }
  | { blockId: string; propKey: string }
  | { blockIds: string[]; propKey: string };

export type Stage2Labels = {
  mappings: Stage2Mapping[];
  unmapped: string[];
};

// ─────────────────────────────  Errors  ────────────────────────────────────────

/** Thrown when the Anthropic API call itself fails (network, auth, timeout, etc.). */
export class ImportConverterUpstreamError extends Error {
  constructor(cause: string) {
    super(`Anthropic API failure: ${cause}`);
    this.name = 'ImportConverterUpstreamError';
  }
}

/**
 * Thrown when the AI returns a structurally invalid response, or when it includes
 * forbidden content/text fields (defense-in-depth on Rules Index #5).
 */
export class ImportConverterInvalidResponseError extends Error {
  constructor(reason: string) {
    super(`Invalid AI label response: ${reason}`);
    this.name = 'ImportConverterInvalidResponseError';
  }
}

// ─────────────────────────────  Caller  ────────────────────────────────────────

/**
 * Sends the blockIds from Stage 1 to Claude and returns the Stage-2 label map.
 *
 * @param blockIds  Stable block identifiers from Stage-1 parse ("block-0", "block-1", …)
 * @returns         Parsed and validated Stage2Labels
 * @throws          ImportConverterUpstreamError   on API failure
 * @throws          ImportConverterInvalidResponseError  on bad/content-bearing AI output
 */
export async function callImportConverter(blockIds: string[]): Promise<Stage2Labels> {
  const blueprint = renderBlueprintForPrompt();

  const userMessage = [
    'Classify the following Stage-1 block IDs according to the Agent Blueprint.',
    'Return only the JSON labels object — no prose, no code fences.',
    '',
    'Block IDs to classify:',
    JSON.stringify(blockIds, null, 2),
    '',
    blueprint,
  ].join('\n');

  let responseText: string;
  try {
    const client = getClient();
    const model = getModel();
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: IMPORT_CONVERTER_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new ImportConverterUpstreamError('No text block in Anthropic response');
    }
    responseText = textBlock.text;
  } catch (err) {
    if (err instanceof ImportConverterUpstreamError) throw err;
    throw new ImportConverterUpstreamError(String(err));
  }

  return parseAndValidateLabels(responseText);
}

// ─────────────────────────────  Internal validation  ──────────────────────────

function parseAndValidateLabels(responseText: string): Stage2Labels {
  // Extract the JSON object — the AI may wrap it in a code fence.
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new ImportConverterInvalidResponseError('No JSON object found in AI response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new ImportConverterInvalidResponseError('AI response is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ImportConverterInvalidResponseError('AI response root is not a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  // Defense-in-depth: top-level content/text fields are forbidden (Rules Index #5).
  if ('content' in obj || 'text' in obj) {
    throw new ImportConverterInvalidResponseError(
      'AI response contains forbidden "content" or "text" field at top level',
    );
  }

  if (!Array.isArray(obj.mappings)) {
    throw new ImportConverterInvalidResponseError('AI response missing "mappings" array');
  }

  if (!Array.isArray(obj.unmapped)) {
    throw new ImportConverterInvalidResponseError('AI response missing "unmapped" array');
  }

  // Validate each mapping entry.
  for (const entry of obj.mappings as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ImportConverterInvalidResponseError('Mapping entry is not an object');
    }
    const m = entry as Record<string, unknown>;

    // Forbidden fields inside a mapping (Rules Index #5 — defense-in-depth).
    if ('content' in m || 'text' in m) {
      throw new ImportConverterInvalidResponseError(
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
      throw new ImportConverterInvalidResponseError(
        'Mapping entry missing valid "blockId" (string) or "blockIds" (string[])',
      );
    }

    // Must have sectionKey or propKey.
    const hasSectionKey = 'sectionKey' in m && typeof m.sectionKey === 'string';
    const hasPropKey = 'propKey' in m && typeof m.propKey === 'string';
    if (!hasSectionKey && !hasPropKey) {
      throw new ImportConverterInvalidResponseError(
        'Mapping entry missing "sectionKey" or "propKey"',
      );
    }
  }

  return {
    mappings: obj.mappings as Stage2Mapping[],
    unmapped: obj.unmapped as string[],
  };
}
