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
import { getChatHistoryTurns, getChatMaxTokens } from '../settings.js';
import type { SectionDefLite } from '../db/repository/agents.js';

// ─────────────────────────────  Types  ────────────────────────────────────────

export type PrometheusSection = {
  sectionKey: string;
  heading: string | null;
  content: string;
};

export type PrometheusModifications = {
  description?: string;
  /** sectionKey → complete new content; null = delete the section (§4.1) */
  sections?: Record<string, string | null>;
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

/** Thrown when Prometheus's response was truncated (stop_reason === 'max_tokens').
 *  Mirrors DaedalusTruncatedError (daedalus.ts) — a hard fail, never silently
 *  degraded to a partial or best-effort parse, since a cut-off JSON object's
 *  proposed edits are unrecoverable content loss, not just a formatting hiccup. */
export class PrometheusTruncatedError extends Error {
  constructor() {
    super('Prometheus response was truncated (max_tokens) — content loss, rejected');
    this.name = 'PrometheusTruncatedError';
  }
}

// ─────────────────────────────  Caller  ───────────────────────────────────────

/**
 * Calls Prometheus with the agent content and the user's instruction and returns
 * a typed proposal — the model's chat message plus its proposed modifications.
 *
 * @param input  Agent context + instruction + optional AbortSignal (Rules Index #23)
 * @param sectionDefs  The agent's platform section catalog — fetched by the route via
 *   getSectionDefs(agent.platform) and forwarded here (same boundary reasoning as
 *   daedalus.ts/hermes.ts — lib/ai only touches lib/db through the gateway).
 * @param ctx    Gateway context for logging (agentId always known for chat, §5.2)
 * @returns      PrometheusProposal with message, modifications (filtered + demoted), and warnings
 * @throws       LlmDryRunBlockedError          when live LLM calls are disabled
 * @throws       LlmUserCapReachedError         when the per-user hourly cap is reached
 * @throws       PrometheusUpstreamError        on API failure
 * @throws       PrometheusTruncatedError       on stop_reason === 'max_tokens'
 * @throws       PrometheusInvalidResponseError on structurally invalid model output
 * @throws       Error with name 'AbortError'   if the request was cancelled
 */
export async function callPrometheus(
  input: PrometheusInput,
  sectionDefs: readonly SectionDefLite[],
  ctx: LlmCallContext = { kind: 'chat' },
): Promise<PrometheusProposal> {
  const blueprint = renderBlueprintForPrompt(sectionDefs);
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
    // Uses stream(), not complete(): the Anthropic SDK refuses a non-streaming
    // request once maxTokens is high enough that generation could plausibly
    // exceed 10 minutes (~21,333 tokens for claude-sonnet-5 — see the SDK's
    // calculateNonstreamingTimeout()), which chatMaxTokens (now 30000) exceeds.
    // stream() returns the identical fully-accumulated LlmResponse shape as
    // complete() — daedalus.ts already uses it for the same reason at its own
    // higher maxTokens (32000).
    res = await getGateway().stream(
      {
        system: PROMETHEUS_PROMPT,
        messages: [...historyMessages, { role: 'user', content: userMessage }],
        maxTokens: getChatMaxTokens(),
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

  // Truncation is a hard fail, checked before any parse attempt (domain rule stays
  // in the caller, mirrors daedalus.ts — the gateway only records stopReason, never
  // acts on it). A cut-off response can leave a proposed edit's JSON mid-string
  // (unterminated), which parsePrometheusResponse's non-JSON fallback would
  // otherwise silently swallow as a message-only turn — invisibly discarding a
  // real, already-paid-for proposed change instead of surfacing the failure.
  if (res.response.stopReason === 'max_tokens') {
    throw new PrometheusTruncatedError();
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
 * If all three attempts find no usable JSON object at all (2026-08-12 — observed for
 * advisory/opinion instructions where the model answers in plain prose with no JSON
 * envelope), this does NOT throw — it returns a fallback PrometheusProposal with the
 * raw text as `message`, empty `modifications`, and a warning. Only a response that
 * *contains* a `{...}` substring which still fails to parse, or parses to the wrong
 * shape, is treated as a hard failure.
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
      let sliceParsed: unknown;
      let sliceOk = false;
      if (jsonMatch) {
        try {
          sliceParsed = JSON.parse(jsonMatch[0]);
          sliceOk = true;
        } catch {
          sliceOk = false;
        }
      }
      if (!sliceOk) {
        // Non-JSON fallback (2026-08-12): observed live for advisory/opinion
        // instructions ("which section do you recommend I change first?") — the
        // model answers in plain prose with no JSON envelope at all, despite the
        // OUTPUT FORMAT rule. All three extraction attempts have nothing to work
        // with in that case (no `{...}` substring exists). Previously this threw
        // PrometheusInvalidResponseError, surfacing as an opaque 502 `ai_upstream`
        // and discarding an already-paid-for, often perfectly good answer. Instead,
        // treat the raw text as the chat message with no proposed changes — the
        // user at least sees the answer; nothing gets silently applied.
        return {
          message: responseText.trim(),
          modifications: {},
          warnings: [
            'Prometheus did not return the expected format for this reply — showing its raw response as-is, with no proposed changes.',
          ],
        };
      }
      parsed = sliceParsed;
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
      const sectionMap: Record<string, string | null> = {};
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
        // null = delete sentinel, mirroring config's convention (§4.1) — passes through
        // untouched, no demotion (there's no content to scan).
        if (value === null) {
          sectionMap[key] = null;
          continue;
        }
        // Type check: value must be a string otherwise (§4.3)
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

// ─────────────────────────────  Trailing separator  ─────────────────────────────

/**
 * Ensures `content` ends with a blank line so `exportAgent()`'s
 * `heading + '\n' + content` concatenation (lib/serialize/export.ts) never glues
 * the next section's heading onto this section's last line of text.
 *
 * Defense-in-depth guard, same rationale as demoteSplitLevelHeadings above: the
 * prompt already asks for a trailing blank line, this verifies and fixes
 * server-side. Exported so the apply route can import it independently (§4.4
 * pattern — two separate implementations are intentional).
 */
export function ensureTrailingBlankLine(content: string): string {
  return content.replace(/\s+$/, '') + '\n\n';
}

// ─────────────────────────────  Echoed heading  ─────────────────────────────

/**
 * Strips a leading line that just echoes the section's own heading — exact or
 * one-level-demoted (`demoteSplitLevelHeadings` may have already run on this
 * content by the time this is called) — plus any blank lines directly after it.
 * `content` is body-only by contract; `heading` is a separate field never
 * duplicated inside it. Without this, the structured view shows the heading
 * twice: once as the section card's real title, once as the first line of the
 * body underneath it.
 *
 * Defense-in-depth guard, same rationale as demoteSplitLevelHeadings/
 * ensureTrailingBlankLine above: the prompt already instructs the model not to
 * echo its own heading (GUARDRAILS #9), this verifies and fixes server-side.
 * Exported so the apply route can import it independently (§4.4 pattern).
 */
export function stripEchoedHeading(content: string, heading: string | null): string {
  if (!heading) return content;

  const lines = content.split('\n');
  const firstLine = lines[0]?.trim() ?? '';
  const demoted = '#' + heading;

  if (firstLine !== heading && firstLine !== demoted) return content;

  let rest = lines.slice(1);
  while (rest.length > 0 && rest[0].trim() === '') rest = rest.slice(1);
  return rest.join('\n');
}

// ─────────────────────────────  New-section heading  ─────────────────────────────

/**
 * Derives the heading for a section proposed via chat that doesn't exist on the agent
 * yet (2026-08-11 — closes roadmap TODO item 1's chat half). The `sections` output
 * contract carries content only (GUARDRAILS #9 — heading is a separate field
 * Prometheus never writes), so when a proposed `sectionKey` doesn't match any
 * existing section, the apply route treats it as an add and needs a heading from
 * somewhere other than the model's JSON.
 *
 * Prefers the section catalog: if `sectionKey` matches a known catalog def (e.g.
 * `output` → `# OUTPUT FORMAT`), use that def's real heading — keeps a chat-proposed
 * standard section indistinguishable from one added manually via the "+" picker
 * (`AgentView.tsx`'s `addSectionFromCatalog`). Otherwise derives a heading from the
 * key itself (kebab/snake case → spaced caps, e.g. `known-limits` → `KNOWN LIMITS`)
 * at the agent's own split level, matching every other section's heading depth.
 *
 * Exported for unit testing; used only by the apply route (§4.4 pattern).
 */
export function deriveHeadingForNewSection(
  sectionKey: string,
  splitLevel: number,
  catalogDefs: { key: string; defaultHeading: string }[],
): string {
  const catalogMatch = catalogDefs.find((d) => d.key === sectionKey);
  if (catalogMatch) return catalogMatch.defaultHeading;

  const words = sectionKey.replace(/[-_]+/g, ' ').trim().toUpperCase();
  const label = words || sectionKey.toUpperCase();
  return '#'.repeat(Math.max(1, splitLevel)) + ' ' + label;
}
