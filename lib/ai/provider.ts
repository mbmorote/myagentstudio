/**
 * lib/ai/provider.ts
 *
 * Provider-agnostic contract for LLM transport (§3.1).
 *
 * Rules:
 *   - No implementation here — types and interface only.
 *   - No imports beyond types from this file.
 *   - LlmRequest is the ONLY thing a provider ever receives — no domain metadata
 *     (kind, agentId) crosses into the provider (§2.1).
 *   - `system` is a separate field (not messages[0]) so each provider can map it
 *     natively: Anthropic takes it as a top-level param; OpenAI-compatible APIs
 *     take it as role:'system'. Call sites are free of both shapes.
 */

export type LlmRole = 'user' | 'assistant';
export type LlmMessage = { role: LlmRole; content: string };

/**
 * Normalized stop reason. Anything a provider returns that isn't in this set
 * is mapped to 'other'.
 */
export type LlmStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'other';

export type LlmUsage = { inputTokens: number; outputTokens: number };

/**
 * What a CALL SITE builds. System prompt and messages are separate.
 */
export type LlmRequest = {
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /**
   * Omitted ⇒ provider default; the GATEWAY resolves it before forwarding.
   * Model is resolved at the gateway so a dry-run row records the model that
   * WOULD have been used (§3.3 step 1).
   */
  model?: string;
  /**
   * Rules Index #23 — must survive the abstraction. Forwarded by the gateway
   * to the provider so a cancelled client request also cancels the upstream call.
   */
  signal?: AbortSignal;
};

/**
 * What the PROVIDER receives — identical to LlmRequest except model is always
 * resolved (never undefined).
 */
export type ResolvedLlmRequest = LlmRequest & { model: string };

export type LlmResponse = {
  text: string;          // concatenated text blocks
  stopReason: LlmStopReason;
  model: string;
  usage: LlmUsage | null;
};

export interface LLMProvider {
  /** Stable identifier for this provider. Used in llm_call_log.provider column. */
  readonly id: string;
  /** The default model to use when req.model is omitted. */
  defaultModel(): string;
  /** Non-streaming transport. */
  complete(req: ResolvedLlmRequest): Promise<LlmResponse>;
  /**
   * Streaming transport, awaited to completion. Same return shape.
   * The streaming transport is used for large responses (structuralConverter)
   * but the result shape is identical — no incremental deltas yet (§3.5, §14).
   */
  stream(req: ResolvedLlmRequest): Promise<LlmResponse>;
}
