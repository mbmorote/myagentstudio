import 'server-only';

/**
 * lib/ai/gateway.ts
 *
 * The single choke point for all AI calls (§3.3, constraint 2).
 *
 * Responsibilities:
 *   - Read the liveLlmCalls setting (fresh on every call — §6, no cache)
 *   - Resolve the model (before the gate, so dry-run rows are accurate)
 *   - If dry-run OR ctx.forceDryRun: write a log row, return { ok: false, 'dry_run_blocked' }.
 *     Provider never touched.
 *   - Step 4 (NEW): cap gate — check per-user rolling window; admin exempt; null userId skipped.
 *     Cap-blocked calls write NO log row (§3.9 — the log IS the counter).
 *   - If live: forward to the provider, write a log row, return { ok: true }.
 *   - On provider error: write a log row with error, re-throw the ORIGINAL object.
 *   - On log-write failure: swallow, console.error, proceed (§5.5).
 *   - No DB transaction spans the network call (§9, §4.3 risk note).
 *
 * Imports from lib/db/ are permitted HERE and only here (constraint 3).
 * Providers are pure transport and must never import from lib/db/.
 */

import { getLiveLlmCalls, parseSettingValue } from '../settings.js';
import { writeCallLog, countLlmCallsInWindow } from '../db/repository/llmCallLog.js';
import { getUserPolicy } from '../db/repository/users.js';
import { getSetting } from '../db/repository/settings.js';
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
  /** The authenticated user who triggered this call; null for scripts/tests/pre-auth. */
  userId?: string | null;
  /**
   * When true, forces the dry-run path even if liveLlmCalls is on.
   * May only downgrade a live call to a dry run — never the reverse (§8.16).
   * Sourced from a request body `{ dryRun: true }`; the client can't turn dry-run off.
   */
  forceDryRun?: boolean;
};

// ─────────────────────────────  Result  ───────────────────────────────────────

export type LlmGatewayResult =
  | { ok: true;  response: LlmResponse; logId: string | null }
  | { ok: false; reason: 'dry_run_blocked';  model: string; logId: string | null }
  | { ok: false; reason: 'llm_cap_reached';  model: string; logId: null;
      limit: number; windowSeconds: number; retryAfterSeconds: number };

// ─────────────────────────────  Errors  ───────────────────────────────────────

/**
 * Thrown by callers (not the gateway itself) when the gateway returns ok:false reason:'dry_run_blocked'.
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

/**
 * Thrown by callers (not the gateway itself) when the gateway returns ok:false reason:'llm_cap_reached'.
 * Routes catch it and return 429 { error: 'llm_cap_reached', limit, windowSeconds, retryAfterSeconds, canDryRun: true }.
 */
export class LlmUserCapReachedError extends Error {
  readonly kind: LlmCallKind;
  readonly model: string;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly retryAfterSeconds: number;
  override name = 'LlmUserCapReachedError';

  constructor(result: Extract<LlmGatewayResult, { reason: 'llm_cap_reached' }>) {
    super(
      `LLM call blocked: per-user cap reached (limit=${result.limit}, window=${result.windowSeconds}s, retry=${result.retryAfterSeconds}s)`,
    );
    this.kind = result.model as unknown as LlmCallKind; // unused directly — carried for logging
    this.model = result.model;
    this.limit = result.limit;
    this.windowSeconds = result.windowSeconds;
    this.retryAfterSeconds = result.retryAfterSeconds;
  }
}

// ─────────────────────────────  Interface  ────────────────────────────────────

export interface LlmGateway {
  complete(req: LlmRequest, ctx: LlmCallContext): Promise<LlmGatewayResult>;
  stream(req: LlmRequest, ctx: LlmCallContext): Promise<LlmGatewayResult>;
}

// ─────────────────────────────  Cap setting accessor  ─────────────────────────

const CAP_WINDOW_SECONDS = 3600; // rolling 60-minute window (§3.9, confirmed at review)
const CAP_DEFAULT = 15;          // default if the setting row is absent

/**
 * Returns the current maxLlmCallsPerUserPerHour setting.
 * When the row is absent (before Phase 2 seed), returns the default (15).
 * Fail-open on absent; fail-closed on unparseable (same asymmetry as getLiveLlmCalls).
 */
function getMaxLlmCallsPerUserPerHour(): number {
  const raw = getSetting('maxLlmCallsPerUserPerHour');
  if (raw === null) return CAP_DEFAULT; // pre-seed → use default
  const parsed = parseSettingValue(raw, 'int');
  if (parsed === null || typeof parsed !== 'number' || parsed < 1) {
    console.warn(
      `[settings] maxLlmCallsPerUserPerHour has unparseable/invalid value "${raw}" — using default ${CAP_DEFAULT}`,
    );
    return CAP_DEFAULT;
  }
  return parsed;
}

// ─────────────────────────────  Implementation  ───────────────────────────────

/**
 * Execution order inside complete() / stream() — normative (§3.3, extended at §3.9):
 * 1. Resolve model (before the gate, so dry-run rows record the model that WOULD have been used)
 * 2. Read liveLlmCalls (fresh, no cache)
 * 3. If !live OR ctx.forceDryRun → write dry-run log row → return { ok:false, 'dry_run_blocked' }.
 *    Provider never invoked.
 * 4. NEW — cap gate, only on the path that would spend money:
 *      ctx.userId == null                      → skip (pre-auth rows, scripts, tests)
 *      getUserPolicy(userId)?.role === 'admin'  → skip (admin exempt, §3.9)
 *      countLlmCallsInWindow(...) >= limit      → { ok:false, 'llm_cap_reached', … } (NO log row)
 * 5. Live path → call provider → write log row (with userId + sharedWithAdmin snapshot) →
 *    return { ok:true } or re-throw on error.
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

    // Resolve userId and the consent snapshot for log rows
    const userId = ctx.userId ?? null;
    const sharedWithAdmin: boolean = userId !== null
      ? Boolean(getUserPolicy(userId)?.shareLogsWithAdmin)
      : false;

    // Step 3: Dry-run path — provider is never touched
    if (!live || ctx.forceDryRun) {
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
          userId,
          sharedWithAdmin,
        });
      } catch (logErr) {
        // Log write failed — dry-run still blocks (§5.5), never becomes a live call
        console.error('[llm-log] Failed to write dry-run log entry:', String(logErr));
      }
      console.info(`[llm-gateway] blocked — kind=${ctx.kind} model=${model}`);
      return { ok: false, reason: 'dry_run_blocked', model, logId };
    }

    // Step 4 (NEW): Per-user cap gate — only on the live path (§3.9)
    // Skip when: userId is null (pre-auth/scripts/tests) or user is admin (exempt)
    if (userId !== null) {
      const policy = getUserPolicy(userId);
      if (policy !== null && policy.role !== 'admin') {
        const limit = getMaxLlmCallsPerUserPerHour();
        const sinceEpochSeconds = Math.floor(Date.now() / 1000) - CAP_WINDOW_SECONDS;
        const { count, oldestAt } = countLlmCallsInWindow(userId, sinceEpochSeconds);

        if (count >= limit) {
          // Compute retryAfterSeconds from the oldest in-window call's timestamp (§3.9)
          let retryAfterSeconds = CAP_WINDOW_SECONDS; // fallback: full window
          if (oldestAt !== null) {
            const oldestEpoch = Math.floor(oldestAt.getTime() / 1000);
            const freeAt = oldestEpoch + CAP_WINDOW_SECONDS;
            const nowEpoch = Math.floor(Date.now() / 1000);
            retryAfterSeconds = Math.max(1, freeAt - nowEpoch);
          }
          console.info(
            `[llm-gateway] cap reached — user=${userId} count=${count} limit=${limit}`,
          );
          // NO log row written (§3.9 — the log IS the counter; writing a denial row
          // would inflate the count and make retryAfterSeconds drift forward on every retry)
          return {
            ok: false,
            reason: 'llm_cap_reached',
            model,
            logId: null,
            limit,
            windowSeconds: CAP_WINDOW_SECONDS,
            retryAfterSeconds,
          };
        }
      }
    }

    // Step 5: Live path
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
          userId,
          sharedWithAdmin,
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
        userId,
        sharedWithAdmin,
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
