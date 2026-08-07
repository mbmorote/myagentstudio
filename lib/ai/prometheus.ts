import 'server-only';

/**
 * lib/ai/prometheus.ts
 *
 * Phase 2 — Prometheus system-agent caller with the new output contract.
 *
 * Sends the agent's name, description, sections (full or cited), config values
 * (full or cited), the blueprint catalog, and the user's instruction to Claude
 * via PROMETHEUS_PROMPT and returns a PrometheusProposal — a real chat message
 * plus a modifications object covering description, sections, and config.
 *
 * Key invariants enforced here (Rules Index #3/#7/#23):
 *   - Server-scoped to one agent: all content is loaded server-side, never from
 *     the client. The model sees only what the server chose to attach.
 *   - No tools exposed.
 *   - Split-level demotion: every sections value is scanned and demoted at propose
 *     time (§4.4), so the proposal card shows byte-identical content to what will
 *     be written on Apply.
 *   - Out-of-scope filter runs at propose time (§5.4), not at apply time, so the
 *     user never sees a proposed change that would be silently dropped later.
 *   - Cancellation (Rules Index #23): request.signal is passed through as the
 *     Anthropic SDK RequestOptions.signal.
 */

import { getGateway, LlmDryRunBlockedError, LlmUserCapReachedError } from './gateway.js';
import type { LlmCallContext } from './gateway.js';
import { PROMETHEUS_PROMPT } from './prompts/generated/prometheus.js';
import { renderBlueprintForPrompt } from '../blueprint/index.js';
import { getChatHistoryTurns } from '../settings.js';

// ─────────────────────────────  Types  ────────────────────────────────────────

export type PrometheusSection = {
  sectionKey: string;
  heading: string | null;
  content: string;
};

export type PrometheusModifications = {
  description?: string;
  /** sectionKey → complete new content (§4.1) */
  sections?: Record<string, string>;
  /** propKey → complete new value; null = delete the key (§4.1) */
  config?: Record<string, unknown>;
};

export type PrometheusProposal = {
  /** The assistant's real chat answer, always shown in the bubble. */
  message: string;
  /** {} when nothing changed (question-only turn). */
  modifications: PrometheusModifications;
  /** Server-generated warnings about dropped entries — never from the model (§4.3). */
  warnings: string[];
};

export type PrometheusInput = {
  agentName: string;
  agentDescription: string;
  splitLevel: number;
  sections: PrometheusSection[];
  /** Current config values — sent to model in §5.2/§5.3 ## Current config block. */
  config: { propKey: string; value: unknown }[];
  instruction: string;
  /**
   * Section-scoped chat selection — narrows which sections are shown to the model.
   * When present + non-empty, only cited sections are sent. agentName/description
   * are always sent regardless (§5.1).
   */
  citedSectionKeys?: string[];
  /**
   * Config-scoped chat selection — narrows which config keys are shown to the model
   * and which config changes are accepted from it (§5.3).
   */
  citedConfigKeys?: string[];
  /**
   * Prior turns in this chat session — dialogue only, never re-derived content.
   * Each entry's `message` is the raw instruction (user) or Prometheus's prior
   * `message` (assistant) — never the `modifications` JSON, since current
   * section/config content always comes fresh from `sections`/`config` above,
   * not from history. Capped server-side to `chatHistoryTurns` (settings).
   */
  history?: { role: 'user' | 'assistant'; message: string }[];
  signal?: AbortSignal;
};

// ─────────────────────────────  Errors  ────────────────────────────────────────

/** Thrown when the Anthropic API call itself fails (network, auth, timeout, etc.). */
export class PrometheusUpstreamError extends Error {
  constructor(cause: string) {
    super(`Anthropic API failure in Prometheus: ${cause}`);
    this.name = 'PrometheusUpstreamError';
  }
}

/** Thrown when Prometheus returns a structurally invalid response. */
export class PrometheusInvalidResponseError extends Error {
  constructor(reason: string) {
    super(`Invalid Prometheus response: ${reason}`);
    this.name = 'PrometheusInvalidResponseError';
  }
}

// ─────────────────────────────  Caller  ───────────────────────────────────────

/**
 * Calls Prometheus with the agent content and the user's instruction and returns
 * a typed proposal — the model's chat message plus its proposed modifications.
 *
 * @param input  Agent context + instruction + optional AbortSignal (Rules Index #23)
 * @param ctx    Gateway context for logging (agentId always known for chat, §5.2)
 * @returns      PrometheusProposal with message, modifications (filtered + demoted), and warnings
 * @throws       LlmDryRunBlockedError          when live LLM calls are disabled
 * @throws       LlmUserCapReachedError         when the per-user hourly cap is reached
 * @throws       PrometheusUpstreamError        on API failure
 * @throws       PrometheusInvalidResponseError on structurally invalid model output
 * @throws       Error with name 'AbortError'   if the request was cancelled
 */
export async function callPrometheus(
  input: PrometheusInput,
  ctx: LlmCallContext = { kind: 'chat' },
): Promise<PrometheusProposal> {
  const blueprint = renderBlueprintForPrompt();
  const userMessage = buildUserMessage(input, blueprint);

  // Prior turns, capped to the last `chatHistoryTurns` (settings, admin-configurable) —
  // dialogue only (message text), never re-derived content. Cap enforced server-side
  // regardless of how much history the client sent (server-scoped, Rules Index #7).
  const historyCap = getChatHistoryTurns();
  const cappedHistory = (input.history ?? []).slice(-historyCap);
  const historyMessages = cappedHistory.map((turn) => ({
    role: turn.role,
    content: turn.message,
  }));

  // Dry-run check outside the catch-all so it can never be swallowed as ai_upstream.
  let res;
  try {
    // Pass signal through to the gateway → provider → SDK (Rules Index #23).
    res = await getGateway().complete(
      {
        system: PROMETHEUS_PROMPT,
        messages: [...historyMessages, { role: 'user', content: userMessage }],
        maxTokens: 8192,
        signal: input.signal,
      },
      ctx,
    );
  } catch (err) {
    // Belt-and-braces: re-throw policy errors unchanged
    if (err instanceof LlmDryRunBlockedError) throw err;
    if (err instanceof LlmUserCapReachedError) throw err;
    // Re-throw our own error types unchanged
    if (err instanceof PrometheusUpstreamError) throw err;
    if (err instanceof PrometheusInvalidResponseError) throw err;
    // AbortError: client cancelled — re-throw as-is so the route can handle it
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new PrometheusUpstreamError(String(err));
  }

  // Handle policy-refusal results (outside the try, cannot be misclassified as 502)
  if (!res.ok) {
    if (res.reason === 'llm_cap_reached') throw new LlmUserCapReachedError(res);
    throw new LlmDryRunBlockedError(res.logId, ctx.kind, res.model);
  }

  const responseText = res.response.text;
  return parsePrometheusResponse(
    responseText,
    input.splitLevel,
    input.citedSectionKeys,
    input.citedConfigKeys,
  );
}

// ─────────────────────────────  Message builder  ──────────────────────────────

/**
 * Builds the user-facing message for Prometheus: identity context, current
 * sections (full or cited), current config (full or cited, §5.2/§5.3),
 * blueprint catalog, and the instruction.
 */
function buildUserMessage(input: PrometheusInput, blueprint: string): string {
  const splitPrefix = '#'.repeat(input.splitLevel);
  const citedSectionKeys = input.citedSectionKeys;
  const citedConfigKeys = input.citedConfigKeys;
  const sectionScoped = !!citedSectionKeys && citedSectionKeys.length > 0;
  const configScoped = !!citedConfigKeys && citedConfigKeys.length > 0;
  const scoped = sectionScoped || configScoped;

  const sectionsToShow = sectionScoped
    ? input.sections.filter((s) => citedSectionKeys!.includes(s.sectionKey))
    : input.sections;

  const configToShow = configScoped
    ? input.config.filter((c) => citedConfigKeys!.includes(c.propKey))
    : input.config;

  const lines: string[] = [
    `Agent: ${input.agentName}`,
    `Description: ${input.agentDescription}`,
    `Split level: ${input.splitLevel} (the file's top-level heading is \`${splitPrefix}\`; ` +
      `never write \`${splitPrefix} \` headings inside section content)`,
  ];

  if (scoped) {
    // Build a human-readable scope summary, e.g. "sections: role, output  config: tools"
    const parts: string[] = [];
    if (sectionScoped) parts.push(`sections: ${citedSectionKeys!.join(', ')}`);
    if (configScoped) parts.push(`config: ${citedConfigKeys!.join(', ')}`);
    lines.push(
      '',
      `The user has focused this instruction on: ${parts.join('  ')}. Only ` +
        "those are shown below — you have not been given the agent's other sections " +
        'or config values, so do not reference or attempt to change them.',
    );
  }

  lines.push('', '## Current sections', '');

  for (const section of sectionsToShow) {
    lines.push(`### sectionKey: ${section.sectionKey}`);
    if (section.heading) {
      lines.push(`Heading: ${section.heading}`);
    }
    lines.push('');
    lines.push(section.content);
    lines.push('');
  }

  // Config block (§5.2/§5.3) — one line per key: `propKey: <JSON.stringify(value)>`
  // JSON (not YAML) so lists, nested objects, and scalars all round-trip cleanly.
  if (configToShow.length > 0) {
    lines.push('## Current config', '');
    for (const { propKey, value } of configToShow) {
      lines.push(`${propKey}: ${JSON.stringify(value)}`);
    }
    lines.push('');
  }

  lines.push('---', '');
  lines.push(blueprint);
  lines.push('', '---', '');
  lines.push(`Instruction: ${input.instruction}`);

  return lines.join('\n');
}

// ─────────────────────────────  Parser  ───────────────────────────────────────

/**
 * Extracts, validates, and normalises Prometheus's JSON response into a
 * PrometheusProposal. Exported so unit tests can call it directly
 * (plans/07-prometheus-propose-apply.md §6.2).
 *
 * Extraction is a three-step ordered attempt (§4.2):
 *   1. JSON.parse(responseText.trim())        — normal well-behaved model output
 *   2. Strip code fence, then parse            — model wrapped it in ```json … ```
 *   3. Greedy first-{-to-last-} slice, parse  — model added prose around the object
 *
 * Validation follows the §4.3 tolerance table: structural failures throw;
 * single bad entries are dropped with a warning and the rest survive.
 *
 * The out-of-scope filter (§5.4) runs here, not at write time, so the user never
 * sees a proposed change that would later be silently dropped on Apply.
 *
 * @param responseText     Raw text from the model
 * @param splitLevel       Agent's split level — used for section demotion (§4.4)
 * @param citedSectionKeys When set+non-empty: only these section keys pass the filter
 * @param citedConfigKeys  When set+non-empty: only these config keys pass the filter
 */
export function parsePrometheusResponse(
  responseText: string,
  splitLevel: number,
  citedSectionKeys?: string[],
  citedConfigKeys?: string[],
): PrometheusProposal {
  const warnings: string[] = [];

  // ── Step 1: Extract JSON — three attempts (§4.2) ─────────────────────────
  let parsed: unknown;

  // Attempt 1: direct parse (the normal case)
  try {
    parsed = JSON.parse(responseText.trim());
  } catch {
    // Attempt 2: strip ```json … ``` fences
    try {
      const stripped = responseText
        .replace(/^```json\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim();
      parsed = JSON.parse(stripped);
    } catch {
      // Attempt 3: greedy first-{-to-last-} slice
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new PrometheusInvalidResponseError('response is not valid JSON');
      }
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new PrometheusInvalidResponseError('response is not valid JSON');
      }
    }
  }

  // ── Step 2: Validate root is a plain object ───────────────────────────────
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PrometheusInvalidResponseError(
      'response root is not a JSON object',
    );
  }

  const obj = parsed as Record<string, unknown>;

  // ── Step 3: Extract message (tolerant — §4.3) ─────────────────────────────
  let message: string;
  if (typeof obj.message !== 'string') {
    // Covers: missing, null, non-string — all tolerated per §4.3
    warnings.push('Prometheus returned no message.');
    message = '';
  } else {
    message = obj.message;
  }

  // ── Step 4: Extract modifications (tolerant — §4.3) ──────────────────────
  let rawMods: Record<string, unknown>;
  if (
    !obj.modifications ||
    typeof obj.modifications !== 'object' ||
    Array.isArray(obj.modifications)
  ) {
    warnings.push('Prometheus returned no modifications object.');
    rawMods = {};
  } else {
    rawMods = { ...(obj.modifications as Record<string, unknown>) };
  }

  // Drop name — agent names are not chat-editable (constraint 3 / §4.3)
  if ('name' in rawMods) {
    warnings.push(
      'Prometheus proposed a name change; agent names are not chat-editable.',
    );
    delete rawMods['name'];
  }

  const modifications: PrometheusModifications = {};

  // ── Description (§4.3: non-string → drop + warn; §5.4: always kept in scoped mode) ──
  if ('description' in rawMods) {
    if (typeof rawMods['description'] !== 'string') {
      warnings.push(
        'Prometheus returned a non-string description; it was dropped.',
      );
    } else {
      modifications.description = rawMods['description'] as string;
    }
  }

  // ── Sections (§4.3 + §4.4 demotion + §5.4 scope filter) ─────────────────
  if ('sections' in rawMods) {
    const rawSections = rawMods['sections'];
    if (
      !rawSections ||
      typeof rawSections !== 'object' ||
      Array.isArray(rawSections)
    ) {
      warnings.push(
        'Prometheus returned an invalid sections object; it was dropped.',
      );
    } else {
      const sectionMap: Record<string, string> = {};
      const sectionScoped =
        !!citedSectionKeys && citedSectionKeys.length > 0;

      for (const [key, value] of Object.entries(
        rawSections as Record<string, unknown>,
      )) {
        // Scope filter: drop out-of-scope keys in scoped mode (§5.4)
        if (sectionScoped && !citedSectionKeys!.includes(key)) {
          console.warn(
            `[prometheus] Proposed section "${key}" is outside the cited set — dropped`,
          );
          warnings.push(
            `Prometheus proposed a change to a section you didn't cite (\`${key}\`); it was not included.`,
          );
          continue;
        }
        // Type check: value must be a string (§4.3)
        if (typeof value !== 'string') {
          warnings.push(
            `Prometheus returned a non-string value for sections["${key}"]; it was dropped.`,
          );
          continue;
        }
        // Split-level demotion at propose time (§4.4)
        sectionMap[key] = demoteSplitLevelHeadings(value, splitLevel);
      }

      if (Object.keys(sectionMap).length > 0) {
        modifications.sections = sectionMap;
      }
    }
  }

  // ── Config (§4.3 + §5.4 scope filter; any JSON type including null passes) ──
  if ('config' in rawMods) {
    const rawConfig = rawMods['config'];
    if (
      !rawConfig ||
      typeof rawConfig !== 'object' ||
      Array.isArray(rawConfig)
    ) {
      warnings.push(
        'Prometheus returned an invalid config object; it was dropped.',
      );
    } else {
      const configMap: Record<string, unknown> = {};
      const configScoped = !!citedConfigKeys && citedConfigKeys.length > 0;

      for (const [key, value] of Object.entries(
        rawConfig as Record<string, unknown>,
      )) {
        // Scope filter: drop out-of-scope keys in scoped mode (§5.4)
        if (configScoped && !citedConfigKeys!.includes(key)) {
          console.warn(
            `[prometheus] Proposed config key "${key}" is outside the cited set — dropped`,
          );
          warnings.push(
            `Prometheus proposed a change to a config key you didn't cite (\`${key}\`); it was not included.`,
          );
          continue;
        }
        // All JSON types pass through unchanged, including null (= delete sentinel).
        // No datatype/allowedValues validation — constraint 4 / Decision J.
        configMap[key] = value;
      }

      if (Object.keys(configMap).length > 0) {
        modifications.config = configMap;
      }
    }
  }

  return { message, modifications, warnings };
}

// ─────────────────────────────  Heading demotion  ─────────────────────────────

/**
 * Scans `content` line by line and demotes any heading that sits exactly at
 * `splitLevel` (e.g. `# Heading` when splitLevel=1) by prepending one `#`.
 *
 * Defense-in-depth guard for Rules Index #3 — the prompt already instructs
 * the model not to emit these; we verify and fix server-side.
 *
 * Exported so the apply route can import it independently without creating a
 * circular dependency (§4.4 — two separate implementations are intentional).
 *
 * Examples:
 *   splitLevel=1: `# Foo` → `## Foo`; `## Foo` unchanged; `#Foo` unchanged.
 *   splitLevel=2: `## Bar` → `### Bar`; `# Bar` unchanged.
 */
export function demoteSplitLevelHeadings(content: string, splitLevel: number): string {
  const exactPrefix = '#'.repeat(splitLevel) + ' ';
  const nextLevelPrefix = '#'.repeat(splitLevel + 1);

  return content
    .split('\n')
    .map((line) => {
      if (line.startsWith(exactPrefix) && !line.startsWith(nextLevelPrefix)) {
        return '#' + line;
      }
      return line;
    })
    .join('\n');
}
