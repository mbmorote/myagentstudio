import 'server-only';

/**
 * lib/email/gateway.ts
 *
 * The single choke point for all outbound email (Plan 14, §4.3, constraint 1).
 * Mirrors lib/ai/gateway.ts step-for-step, minus the re-throw — a DELIBERATE
 * divergence (constraint 2): an AI call IS the user's requested action, so
 * failing it is correct; an email is a side effect of someone else's action, so
 * failing that action would violate this codebase's "Flag, don't block" rule.
 *
 * Order of operations:
 *   0. Resolve the provider. Not configured → { ok:false, 'not_configured' } + one log row,
 *      so "why did nothing arrive?" is answerable from data.
 *   1. Kill-switch gate — getLiveEmailSends(), read fresh (no cache). Off → log row
 *      'dry_run', { ok:false, 'dry_run_blocked' }. No network traffic at all.
 *   2. Cap gate — count 'sent'/'failed' email_log rows in the trailing 60 minutes
 *      against getMaxEmailsPerHour(). At/over → log row 'blocked_cap',
 *      { ok:false, 'cap_reached', retryAfterSeconds }. This row does NOT inflate
 *      the count that produced it — countBillableEmailsInWindow only counts
 *      'sent'/'failed' rows (§4.3 step 2's deliberate divergence from the LLM cap).
 *   3. Live path — provider.send() under a 10s AbortSignal.timeout(). Success →
 *      log row 'sent', { ok:true }. A timeout classifies as reason:'timeout';
 *      anything else as reason:'provider_error' — both write a log row with
 *      status:'failed' (the status enum has no separate timeout value) and
 *      NEVER re-throw.
 *   4. Log-write failures are swallowed with a console.error, exactly as the AI
 *      gateway does on its live path — the mail is already sent/failed;
 *      discarding that outcome for a logging failure would be strictly worse.
 *
 * Imports from lib/db/ are permitted HERE and only here (constraint 1, §4.10).
 * The provider must never import from lib/db/.
 */

import { getLiveEmailSends, getMaxEmailsPerHour } from '../settings.js';
import { writeEmailLog, countBillableEmailsInWindow } from '../db/repository/emailLog.js';
import { getEmailReplyTo } from '../env.js';
import { resolveEmailProvider } from './registry.js';
import type { EmailProvider } from './provider.js';
import type { EmailLogStatus, WriteEmailLogInput } from '../db/repository/emailLog.js';

// ─────────────────────────────  Context & message  ──────────────────────────

export type EmailContext = {
  /** 'invite_code' today. Plain string, open-ended — other plans (password
   *  reset, deletion notice) add kinds with no schema change (§4.4). */
  kind: string;
  relatedType?: 'invite_code' | 'user' | 'access_request' | null;
  relatedId?: string | null;
  /** The acting admin's user id, or null for a system-triggered send. */
  triggeredBy?: string | null;
};

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Overrides the env-configured EMAIL_REPLY_TO for this send when set. */
  replyTo?: string | null;
  idempotencyKey?: string;
};

// ─────────────────────────────  Result  ──────────────────────────────────────

export type EmailSendResult =
  | { ok: true; reason?: never; providerMessageId: string | null; logId: string | null }
  | {
      ok: false;
      reason: 'not_configured' | 'dry_run_blocked' | 'cap_reached' | 'provider_error' | 'timeout';
      detail?: string;
      retryAfterSeconds?: number;
      logId: string | null;
    };

// ─────────────────────────────  Interface  ───────────────────────────────────

export interface EmailGateway {
  sendEmail(msg: OutboundEmail, ctx: EmailContext): Promise<EmailSendResult>;
}

const CAP_WINDOW_SECONDS = 3600; // rolling 60-minute window, matching the LLM cap's window
const SEND_TIMEOUT_MS = 10_000;  // every provider call carries an AbortSignal.timeout()

function isTimeoutError(err: unknown): boolean {
  // AbortSignal.timeout() fires with a TimeoutError DOMException in modern
  // runtimes; a manually-aborted signal fires AbortError. Treat both as a
  // timeout for classification purposes — neither is a provider rejection.
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

function formatError(err: unknown): string {
  return err instanceof Error
    ? `${err.name}: ${err.message}`.slice(0, 2000)
    : String(err).slice(0, 2000);
}

/** Swallows a writeEmailLog failure (§4.3 step 4) — a send outcome is never discarded for a logging failure. */
function safeWriteLog(input: WriteEmailLogInput): string | null {
  try {
    return writeEmailLog(input);
  } catch (logErr) {
    console.error('[email-log] Failed to write email log entry:', String(logErr));
    return null;
  }
}

/**
 * @param providerOrResolver - A fixed EmailProvider (or null) OR a zero-argument
 *   function that returns one. Passing a function (resolveEmailProvider) is the
 *   production path — the gateway calls it on every sendEmail() invocation so a
 *   live env/config change takes effect without a restart. Passing a plain
 *   value is the test path; it's normalized to () => value internally, matching
 *   lib/ai/gateway.ts's createGateway() shape.
 */
export function createEmailGateway(
  providerOrResolver: EmailProvider | null | (() => EmailProvider | null),
): EmailGateway {
  const resolve: () => EmailProvider | null = typeof providerOrResolver === 'function'
    ? providerOrResolver
    : () => providerOrResolver;

  async function sendEmail(msg: OutboundEmail, ctx: EmailContext): Promise<EmailSendResult> {
    // Step 0: resolve the provider fresh on each call
    const provider = resolve();
    if (!provider) {
      const logId = safeWriteLog({
        kind: ctx.kind,
        provider: 'none',
        toEmail: msg.to,
        subject: msg.subject,
        status: 'not_configured',
        durationMs: 0,
        relatedType: ctx.relatedType ?? null,
        relatedId: ctx.relatedId ?? null,
        triggeredBy: ctx.triggeredBy ?? null,
      });
      return { ok: false, reason: 'not_configured', logId };
    }

    // Step 1: kill-switch gate — read fresh, no cache (same rule as getLiveLlmCalls)
    const live = getLiveEmailSends();
    if (!live) {
      const logId = safeWriteLog({
        kind: ctx.kind,
        provider: provider.id,
        toEmail: msg.to,
        subject: msg.subject,
        status: 'dry_run',
        durationMs: 0,
        relatedType: ctx.relatedType ?? null,
        relatedId: ctx.relatedId ?? null,
        triggeredBy: ctx.triggeredBy ?? null,
      });
      console.info(`[email-gateway] blocked — kind=${ctx.kind} to=${msg.to} (dry run)`);
      return { ok: false, reason: 'dry_run_blocked', logId };
    }

    // Step 2: cap gate — trailing 60-minute window, counting only rows that
    // actually reached the provider ('sent'/'failed'); a denial row never
    // inflates the count that produced it (§4.3 step 2).
    const limit = getMaxEmailsPerHour();
    const sinceMs = Date.now() - CAP_WINDOW_SECONDS * 1000;
    const count = countBillableEmailsInWindow(sinceMs);
    if (count >= limit) {
      const logId = safeWriteLog({
        kind: ctx.kind,
        provider: provider.id,
        toEmail: msg.to,
        subject: msg.subject,
        status: 'blocked_cap',
        durationMs: 0,
        relatedType: ctx.relatedType ?? null,
        relatedId: ctx.relatedId ?? null,
        triggeredBy: ctx.triggeredBy ?? null,
      });
      console.info(`[email-gateway] cap reached — count=${count} limit=${limit}`);
      // retryAfterSeconds is the full window rather than derived from the
      // oldest in-window row's timestamp — unlike the LLM cap's precise
      // derivation (§3.9), there's no per-user identity to make that precise
      // about here, and a coarse retry hint is sufficient for an
      // operator-facing, deployment-wide cap.
      return { ok: false, reason: 'cap_reached', logId, retryAfterSeconds: CAP_WINDOW_SECONDS };
    }

    // Step 3: live path
    const t0 = Date.now();
    const signal = AbortSignal.timeout(SEND_TIMEOUT_MS);
    try {
      const result = await provider.send(
        {
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          replyTo: msg.replyTo ?? getEmailReplyTo(),
          idempotencyKey: msg.idempotencyKey,
        },
        { signal },
      );
      const durationMs = Date.now() - t0;
      const logId = safeWriteLog({
        kind: ctx.kind,
        provider: provider.id,
        toEmail: msg.to,
        subject: msg.subject,
        status: 'sent',
        providerMessageId: result.providerMessageId,
        durationMs,
        relatedType: ctx.relatedType ?? null,
        relatedId: ctx.relatedId ?? null,
        triggeredBy: ctx.triggeredBy ?? null,
      });
      return { ok: true, providerMessageId: result.providerMessageId, logId };
    } catch (err) {
      const durationMs = Date.now() - t0;
      const errMsg = formatError(err);
      const timedOut = isTimeoutError(err);
      const logId = safeWriteLog({
        kind: ctx.kind,
        provider: provider.id,
        toEmail: msg.to,
        subject: msg.subject,
        status: 'failed' as EmailLogStatus,
        error: errMsg,
        durationMs,
        relatedType: ctx.relatedType ?? null,
        relatedId: ctx.relatedId ?? null,
        triggeredBy: ctx.triggeredBy ?? null,
      });
      // Never a re-throw (constraint 2) — the caller's write already committed
      // before this function was ever invoked.
      return {
        ok: false,
        reason: timedOut ? 'timeout' : 'provider_error',
        detail: errMsg,
        logId,
      };
    }
  }

  return { sendEmail };
}

// ─────────────────────────────  Route-facing status  ─────────────────────────

/**
 * The simplified 5-way status routes expose in their JSON response bodies
 * (§4.8) — collapses EmailSendResult's more granular `reason` down to what a
 * caller actually needs to render: did it go out or not, and roughly why.
 */
export type EmailStatus = 'sent' | 'failed' | 'blocked' | 'not_configured' | 'disabled';

export function emailStatusFromResult(result: EmailSendResult): EmailStatus {
  if (result.ok) return 'sent';
  switch (result.reason) {
    case 'not_configured': return 'not_configured';
    case 'dry_run_blocked': return 'disabled';
    case 'cap_reached': return 'blocked';
    case 'provider_error':
    case 'timeout':
    default:
      return 'failed';
  }
}

// ─────────────────────────────  Singleton  ───────────────────────────────────

let _gateway: EmailGateway | null = null;

/**
 * Returns the process-wide gateway singleton. Constructed lazily; its resolver
 * (resolveEmailProvider) is called fresh on every sendEmail() invocation so a
 * live env/config change takes effect without a restart.
 */
export function getEmailGateway(): EmailGateway {
  if (!_gateway) {
    _gateway = createEmailGateway(resolveEmailProvider);
  }
  return _gateway;
}
