import 'server-only';

/**
 * lib/ai/gateway.ts
 *
 * The single choke point for all AI calls (§3.3, constraint 2).
 *
 * Responsibilities:
 *   - Read the liveLlmCalls setting (fresh on every call — §6, no cache)
 *   - Resolve the model (before the gate, so dry-run rows are accurate)
 *   - If dry-run: write a log row, return { ok: false }. Provider never touched.
 *   - If live: forward to the provider, write a log row, return { ok: true }.
 *   - On provider error: write a log row with error, re-throw the ORIGINAL object.
 *   - On log-write failure: swallow, console.error, proceed (§5.5).
 *   - No DB transaction spans the network call (§9, §4.3 risk note).
 *
 * Imports from lib/db/ are permitted HERE and only here (constraint 3).
 * Providers are pure transport and must never import from lib/db/.
 */

import { getLiveLlmCalls } from '../settings.js';
import { writeCallLog } from '../db/repository/llmCallLog.js';
import { createAnthropicProvider } from './anthropicProvider.js';
import type { LLMProvider, LlmRequest, LlmResponse } from './provider.js';
import type { LlmCallKind, WriteCallLogInput } from '../db/repository/llmCallLog.js';

// Re-export so callers can import the kind type from here
export type { LlmCallKind };

// ─────────────────────────────  Context  ──────────────────────────────────────

export type LlmCallContext = {
  kind: LlmCallKind;
  agentId?: string | null;
  agentLabel?: string | null;
};

// ─────────────────────────────  Result  ───────────────────────────────────────

export type LlmGatewayResult =
  | { ok: true;  response: LlmResponse; logId: string | null }
  | { ok: false; reason: 'dry_run_blocked'; model: string; logId: string | null };

// ─────────────────────────────  Error  ────────────────────────────────────────

/**
 * Thrown by callers (not the gateway itself) when the gateway returns ok:false.
 * Having it thrown by the caller means it propagates through the existing typed-error
 * protocol each caller already has with its route, without changing return types.
 *
 * The catch-all in each caller re-throws this unchanged (§3.6 belt-and-braces).
 */
export class LlmDryRunBlockedError extends Error {
  readonly logId: string | null;
  readonly kind: LlmCallKind;
  readonly model: string;
  override name = 'LlmDryRunBlockedError';

  constructor(logId: string | null, kind: LlmCallKind, model: string) {
    super(`LLM call blocked: live LLM calls are turned off (kind=${kind}, model=${model})`);
    this.logId = logId;
    this.kind = kind;
    this.model = model;
  }
}

// ─────────────────────────────  Interface  ────────────────────────────────────

export interface LlmGateway {
  complete(req: LlmRequest, ctx: LlmCallContext): Promise<LlmGatewayResult>;
  stream(req: LlmRequest, ctx: LlmCallContext): Promise<LlmGatewayResult>;
}

// ─────────────────────────────  Implementation  ───────────────────────────────

/**
 * Execution order inside complete() / stream() — normative (§3.3):
 * 1. Resolve model (before the gate, so dry-run rows record the model that WOULD have been used)
 * 2. Read liveLlmCalls (fresh, no cache)
 * 3. If not live → write dry-run log row → return { ok:false }. Provider never invoked.
 * 4. If live → call provider → write log row → return { ok:true } or re-throw on error.
 */
export function createGateway(provider: LLMProvider): LlmGateway {
  async function run(
    req: LlmRequest,
    ctx: LlmCallContext,
    method: 'complete' | 'stream',
  ): Promise<LlmGatewayResult> {
    // Step 1: Resolve model before the gate (§3.3 step 1)
    const model = req.model ?? provider.defaultModel();
    const resolvedReq = { ...req, model };

    // Step 2: Fresh setting read — no caching (§6, risk 9)
    const live = getLiveLlmCalls();

    // Build the request payload for the log (no credentials — invariant 6)
    const requestPayload: WriteCallLogInput['requestPayload'] = {
      system: req.system,
      messages: req.messages,
      maxTokens: req.maxTokens,
      model,
    };

    // Step 3: Dry-run path — provider is never touched
    if (!live) {
      const t0 = Date.now();
      let logId: string | null = null;
      try {
        logId = writeCallLog({
          kind: ctx.kind,
          agentId: ctx.agentId ?? null,
          agentLabel: ctx.agentLabel ?? null,
          dryRun: true,
          model,
          requestPayload,
          responsePayload: null,
          error: null,
          durationMs: Date.now() - t0,
          usage: null,
        });
      } catch (logErr) {
        // Log write failed — dry-run still blocks (§5.5), never becomes a live call
        console.error('[llm-log] Failed to write dry-run log entry:', String(logErr));
      }
      console.info(`[llm-gateway] blocked — kind=${ctx.kind} model=${model}`);
      return { ok: false, reason: 'dry_run_blocked', model, logId };
    }

    // Step 4: Live path
    const t0 = Date.now();
    let response: LlmResponse;
    try {
      response = method === 'stream'
        ? await provider.stream(resolvedReq)
        : await provider.complete(resolvedReq);
    } catch (err) {
      // Provider threw — write a log row with the error, then re-throw the ORIGINAL object
      // (identity preserved — err.name === 'AbortError' must keep working downstream, §3.3 step 4)
      const durationMs = Date.now() - t0;
      const errMsg = err instanceof Error
        ? `${err.name}: ${err.message}`.slice(0, 2000)
        : String(err).slice(0, 2000);
      try {
        writeCallLog({
          kind: ctx.kind,
          agentId: ctx.agentId ?? null,
          agentLabel: ctx.agentLabel ?? null,
          dryRun: false,
          model,
          requestPayload,
          responsePayload: null,
          error: errMsg,
          durationMs,
          usage: null,
        });
      } catch (logErr) {
        // Swallow log failure; re-throw the original provider error below (§5.5)
        console.error('[llm-log] Failed to write error log entry:', String(logErr));
      }
      throw err; // re-throw original — identity preserved
    }

    // Success — write log row
    const durationMs = Date.now() - t0;
    let logId: string | null = null;
    try {
      logId = writeCallLog({
        kind: ctx.kind,
        agentId: ctx.agentId ?? null,
        agentLabel: ctx.agentLabel ?? null,
        dryRun: false,
        model,
        requestPayload,
        responsePayload: { text: response.text, stopReason: response.stopReason },
        error: null,
        durationMs,
        usage: response.usage,
      });
    } catch (logErr) {
      // Log write failed after a successful live call — swallow, response is real (§5.5)
      console.error('[llm-log] Failed to write success log entry:', String(logErr));
    }

    return { ok: true, response, logId };
  }

  return {
    complete(req, ctx) { return run(req, ctx, 'complete'); },
    stream(req, ctx)   { return run(req, ctx, 'stream'); },
  };
}

// ─────────────────────────────  Singleton  ────────────────────────────────────

let _gateway: LlmGateway | null = null;

/**
 * Returns the process-wide gateway singleton.
 * Constructed lazily — the provider (and therefore the SDK singleton) is only
 * instantiated on the first AI call, not at module load time.
 */
export function getGateway(): LlmGateway {
  if (!_gateway) {
    _gateway = createGateway(createAnthropicProvider());
  }
  return _gateway;
}
