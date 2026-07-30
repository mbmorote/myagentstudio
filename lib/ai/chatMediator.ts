import 'server-only';

/**
 * lib/ai/chatMediator.ts
 *
 * Phase 4.5 — Chat mediator caller.
 *
 * Sends the whole agent's current content (every section, loaded server-side by the
 * caller — never from the client) + the instruction + CHAT_MEDIATOR_PROMPT +
 * renderBlueprintForPrompt() to Claude and returns only the changed sections.
 *
 * Key invariants enforced here (§7 Draft D, Rules Index #3/#7/#23):
 *   - Server-scoped to one agent: the caller passes all sections, the model sees only
 *     those sections and may rewrite any number of them.
 *   - No tools exposed.
 *   - Split-level demotion double-check: each returned section's content is scanned
 *     line-by-line; any heading at exactly agent.splitLevel (`# ` for level 1,
 *     `## ` for level 2, etc.) is demoted one level before the content is returned
 *     (defense-in-depth — the prompt already guardrails this, but we verify).
 *   - Cancellation (Rules Index #23): request.signal is passed through as the Anthropic
 *     SDK RequestOptions.signal so aborting the client request also cancels the
 *     upstream API call. The caller (route) handles the resulting AbortError without
 *     writing to the DB.
 */

import { getGateway, LlmDryRunBlockedError } from './gateway.js';
import type { LlmCallContext } from './gateway.js';
import { CHAT_MEDIATOR_PROMPT } from './prompts/generated/chat-mediator.js';
import { renderBlueprintForPrompt } from '../blueprint/index.js';

// ─────────────────────────────  Types  ────────────────────────────────────────

export type MediatorSection = {
  sectionKey: string;
  heading: string | null;
  content: string;
};

export type MediatorInput = {
  agentName: string;
  splitLevel: number;
  sections: MediatorSection[];
  instruction: string;
  signal?: AbortSignal;
};

export type MediatorResult = {
  sections: { [sectionKey: string]: string };
};

// ─────────────────────────────  Errors  ────────────────────────────────────────

/** Thrown when the Anthropic API call itself fails (network, auth, timeout, etc.). */
export class ChatMediatorUpstreamError extends Error {
  constructor(cause: string) {
    super(`Anthropic API failure in chat mediator: ${cause}`);
    this.name = 'ChatMediatorUpstreamError';
  }
}

/** Thrown when the mediator returns a structurally invalid response. */
export class ChatMediatorInvalidResponseError extends Error {
  constructor(reason: string) {
    super(`Invalid chat mediator response: ${reason}`);
    this.name = 'ChatMediatorInvalidResponseError';
  }
}

// ─────────────────────────────  Caller  ───────────────────────────────────────

/**
 * Calls the chat mediator with the full agent content and the user's instruction.
 *
 * @param input  Agent context + instruction + optional AbortSignal (Rules Index #23)
 * @param ctx    Gateway context for logging (agentId always known for chat, §5.2)
 * @returns      Map of sectionKey → new content for each section that changed
 * @throws       LlmDryRunBlockedError             when live LLM calls are disabled
 * @throws       ChatMediatorUpstreamError on API failure
 * @throws       ChatMediatorInvalidResponseError on invalid model output
 * @throws       Error with name 'AbortError' if the request was cancelled
 */
export async function callChatMediator(
  input: MediatorInput,
  ctx: LlmCallContext = { kind: 'chat' },
): Promise<MediatorResult> {
  const blueprint = renderBlueprintForPrompt();
  const userMessage = buildUserMessage(input, blueprint);

  // Dry-run check outside the catch-all so it can never be swallowed as ai_upstream (§3.6).
  let res;
  try {
    // Pass signal through to the gateway → provider → SDK (Rules Index #23).
    res = await getGateway().complete(
      {
        system: CHAT_MEDIATOR_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 8192,
        signal: input.signal,
      },
      ctx,
    );
  } catch (err) {
    // Belt-and-braces: re-throw LlmDryRunBlockedError unchanged
    if (err instanceof LlmDryRunBlockedError) throw err;
    // Re-throw our own error types unchanged
    if (err instanceof ChatMediatorUpstreamError) throw err;
    if (err instanceof ChatMediatorInvalidResponseError) throw err;
    // AbortError: client cancelled — re-throw as-is so the route can handle it
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ChatMediatorUpstreamError(String(err));
  }

  // Handle dry-run result (§3.6 — outside the try, cannot be misclassified as 502)
  if (!res.ok) throw new LlmDryRunBlockedError(res.logId, ctx.kind, res.model);

  const responseText = res.response.text;
  const parsed = parseMediatorResponse(responseText);

  // Server double-checks each returned section for split-level headings and
  // demotes if found (defense-in-depth on Rules Index #3).
  const demoted: { [sectionKey: string]: string } = {};
  for (const [key, content] of Object.entries(parsed.sections)) {
    demoted[key] = demoteSplitLevelHeadings(content, input.splitLevel);
  }

  return { sections: demoted };
}

// ─────────────────────────────  Internal helpers  ──────────────────────────────

/**
 * Builds the user-facing message for the mediator: current agent sections +
 * blueprint catalog + the instruction to execute.
 */
function buildUserMessage(input: MediatorInput, blueprint: string): string {
  const splitPrefix = '#'.repeat(input.splitLevel);
  const lines: string[] = [
    `Agent: ${input.agentName}`,
    `Split level: ${input.splitLevel} (the file's top-level heading is \`${splitPrefix}\`; ` +
      `never write \`${splitPrefix} \` headings inside section content)`,
    '',
    '## Current sections',
    '',
  ];

  for (const section of input.sections) {
    lines.push(`### sectionKey: ${section.sectionKey}`);
    if (section.heading) {
      lines.push(`Heading: ${section.heading}`);
    }
    lines.push('');
    lines.push(section.content);
    lines.push('');
  }

  lines.push('---', '');
  lines.push(blueprint);
  lines.push('', '---', '');
  lines.push(`Instruction: ${input.instruction}`);

  return lines.join('\n');
}

/**
 * Parses and validates the mediator's JSON response.
 * Expected shape: { sections: { [sectionKey]: string } }
 */
function parseMediatorResponse(responseText: string): MediatorResult {
  // The model may wrap the JSON in a code fence — extract the object
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new ChatMediatorInvalidResponseError(
      'No JSON object found in mediator response',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new ChatMediatorInvalidResponseError(
      'Mediator response is not valid JSON',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ChatMediatorInvalidResponseError(
      'Mediator response root is not a JSON object',
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (!obj.sections || typeof obj.sections !== 'object' || Array.isArray(obj.sections)) {
    throw new ChatMediatorInvalidResponseError(
      'Mediator response missing "sections" object',
    );
  }

  const sections = obj.sections as Record<string, unknown>;

  // Validate each entry is a string (full section content)
  for (const [key, value] of Object.entries(sections)) {
    if (typeof value !== 'string') {
      throw new ChatMediatorInvalidResponseError(
        `Mediator response sections["${key}"] is not a string`,
      );
    }
  }

  return { sections: sections as { [sectionKey: string]: string } };
}

/**
 * Scans `content` line by line and demotes any heading that sits exactly at
 * `splitLevel` (e.g. `# Heading` when splitLevel=1) by prepending one `#`.
 *
 * Defense-in-depth guard for Rules Index #3 — the prompt already instructs
 * the model not to emit these; we verify and fix server-side.
 *
 * Examples:
 *   splitLevel=1: `# Foo` → `## Foo`; `## Foo` unchanged; `#Foo` unchanged.
 *   splitLevel=2: `## Bar` → `### Bar`; `# Bar` unchanged.
 */
export function demoteSplitLevelHeadings(content: string, splitLevel: number): string {
  // exactPrefix is e.g. `# ` for level 1, `## ` for level 2
  const exactPrefix = '#'.repeat(splitLevel) + ' ';
  // nextLevelPrefix is e.g. `## ` for level 1 — used to confirm we're NOT already
  // seeing a deeper heading (e.g. `## Heading` starts with `# ` but that's incorrect)
  // Actually: `## Heading` does NOT start with `# ` because the second char is `#` not ` `.
  // The `exactPrefix` check already uniquely identifies level-N headings. The extra check
  // against nextLevelPrefix is unnecessary but kept for clarity.
  const nextLevelPrefix = '#'.repeat(splitLevel + 1);

  return content
    .split('\n')
    .map((line) => {
      // Check: line starts with exactly splitLevel `#`s followed by a space
      if (line.startsWith(exactPrefix) && !line.startsWith(nextLevelPrefix)) {
        return '#' + line;
      }
      return line;
    })
    .join('\n');
}
