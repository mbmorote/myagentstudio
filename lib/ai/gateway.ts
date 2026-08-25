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
import { writeCallLog, countLlmCallsInWindow, reserveCallSlot, finalizeCallLog } from '../db/repository/llmCallLog.js';
import { getUserPolicy } from '../db/repository/users.js';
import { getSetting } from '../db/repository/settings.js';
import { resolveActiveProvider } from './providerRegistry.js';
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
  /**
   * Plan 13 (2026-08-15) — MCP server origin tracking.
   * 'web' = browser-session call (default when absent).
   * 'mcp' = call via an MCP bearer token (push_agent tool — renamed from
   * import_agent 2026-08-24).
   * Written to llm_call_log.origin so the audit log can distinguish MCP-initiated
   * calls from browser-initiated ones — without this, an audit log that can't tell
   * them apart is actively wrong once two sources exist.
   * Defaults to 'web' when absent to preserve pre-Plan-13 behavior.
   */
  origin?: 'web' | 'mcp';
};

// ─────────────────────────────  Result  ───────────────────────────────────────

export type LlmGatewayResult =
  | { ok: true;  response: LlmResponse; logId: string | null }
  | { ok: false; reason: 'dry_run_blocked';  model: string; logId: string | null }
  | { ok: false; reason: 'llm_cap_reached';  model: string; logId: null; kind: LlmCallKind;
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
    this.kind = result.kind;
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
 * Execution order inside complete() / stream() — normative:
 * 0. Resolve provider (fresh per call via the resolver — enables per-call provider
 *    selection from the 'llmProvider' setting without a restart, Plan 11 constraint 4).
 * 1. Resolve model (after provider, because defaultModel() is provider-specific; before
 *    the gate, so dry-run rows record the model that WOULD have been used).
 * 2. Read liveLlmCalls (fresh, no cache).
 * 3. If !live OR ctx.forceDryRun → write dry-run log row → return { ok:false, 'dry_run_blocked' }.
 *    Provider never invoked.
 * 4. Cap gate, only on the live path:
 *      ctx.userId == null                      → skip (pre-auth rows, scripts, tests)
 *      getUserPolicy(userId)?.role === 'admin'  → skip (admin exempt)
 *      countLlmCallsInWindow(...) >= limit      → { ok:false, 'llm_cap_reached', … } (NO log row)
 * 5. Live path → call provider → write log row (with userId + sharedWithAdmin snapshot) →
 *    return { ok:true } or re-throw on error.
 *
 * @param providerOrResolver - A fixed LLMProvider object OR a zero-argument function that
 *   returns one. Passing a function (e.g. resolveActiveProvider) is the production path —
 *   the gateway calls it on every run() invocation so the active provider can change between
 *   calls (setting flip) without any restart. Passing a plain object is the test path;
 *   every createGateway(fakeProvider) call site in the test suites keeps compiling and
 *   passing untouched because a plain object is normalized to () => object internally.
 */
export function createGateway(providerOrResolver: LLMProvider | (() => LLMProvider)): LlmGateway {
  // Normalize: a plain provider object becomes a resolver that always returns it.
  // A function is used as-is so getGateway() can pass resolveActiveProvider directly.
  const resolve: () => LLMProvider = typeof providerOrResolver === 'function'
    ? providerOrResolver
    : () => providerOrResolver;

  async function run(
    req: LlmRequest,
    ctx: LlmCallContext,
    method: 'complete' | 'stream',
  ): Promise<LlmGatewayResult> {
    // Step 0: Resolve provider fresh on each call (constraint 4 — no stale singleton)
    const provider = resolve();

    // Step 1: Resolve model after resolving the provider (provider-specific defaultModel)
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
          provider: provider.id,
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
          origin: ctx.origin ?? 'web',
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
      // Fail-closed on a missing policy row, not fail-open (same asymmetry as
      // getLiveLlmCalls — money-spending exemptions may only come from a
      // CONFIRMED admin role, never from the absence of a policy row).
      // Found in code review, 2026-08-12: the prior `policy !== null && ...`
      // check silently skipped the cap for a null policy too.
      if (policy?.role !== 'admin') {
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
            kind: ctx.kind,
            limit,
            windowSeconds: CAP_WINDOW_SECONDS,
            retryAfterSeconds,
          };
        }
      }
    }

    // Step 4.5 (race fix, 2026-08-12): reserve the slot BEFORE the network call,
    // not after — this is what actually closes the cap-check race (§3.9 fix).
    // Applied uniformly (admin/userId-null calls included) so there's one log-
    // write path, not two; it only changes *when* the row exists, not who gets
    // one. A reservation failure is swallowed, same as any other live-path log
    // failure (§5.5) — the call proceeds with logId: null and nothing to finalize.
    let logId: string | null = null;
    try {
      logId = reserveCallSlot({
        kind: ctx.kind,
        provider: provider.id,
        agentId: ctx.agentId ?? null,
        agentLabel: ctx.agentLabel ?? null,
        model,
        requestPayload,
        userId,
        sharedWithAdmin,
        origin: ctx.origin ?? 'web',
      });
    } catch (reserveErr) {
      console.error('[llm-log] Failed to reserve call slot:', String(reserveErr));
    }

    // Step 5: Live path
    const t0 = Date.now();
    let response: LlmResponse;
    try {
      response = method === 'stream'
        ? await provider.stream(resolvedReq)
        : await provider.complete(resolvedReq);
    } catch (err) {
      // Provider threw — finalize the reserved row with the error, then re-throw
      // the ORIGINAL object (identity preserved — err.name === 'AbortError' must
      // keep working downstream, §3.3 step 4)
      const durationMs = Date.now() - t0;
      const errMsg = err instanceof Error
        ? `${err.name}: ${err.message}`.slice(0, 2000)
        : String(err).slice(0, 2000);
      if (logId !== null) {
        try {
          finalizeCallLog(logId, { responsePayload: null, error: errMsg, durationMs, usage: null });
        } catch (logErr) {
          // Swallow log failure; re-throw the original provider error below (§5.5)
          console.error('[llm-log] Failed to finalize error log entry:', String(logErr));
        }
      }
      throw err; // re-throw original — identity preserved
    }

    // Success — finalize the reserved row
    const durationMs = Date.now() - t0;
    if (logId !== null) {
      try {
        finalizeCallLog(logId, {
          responsePayload: { text: response.text, stopReason: response.stopReason },
          error: null,
          durationMs,
          usage: response.usage,
        });
      } catch (logErr) {
        // Finalize failed after a successful live call — swallow, response is real (§5.5)
        console.error('[llm-log] Failed to finalize success log entry:', String(logErr));
      }
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
 * Constructed lazily — the gateway object itself is created once, but its internal
 * resolver (resolveActiveProvider) is called fresh on every AI call so the active
 * provider reflects the current 'llmProvider' setting without any restart.
 * Provider instances are cached per-id in providerRegistry.ts.
 */
export function getGateway(): LlmGateway {
  if (!_gateway) {
    // Pass resolveActiveProvider as a function reference — the gateway calls it
    // on every run() invocation, not at construction time. This is the seam that
    // makes provider selection a live setting rather than a boot-time decision.
    _gateway = createGateway(resolveActiveProvider);
  }
  return _gateway;
}
