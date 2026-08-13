import 'server-only';

/**
 * lib/db/repository/llmCallLog.ts
 *
 * Append-only audit log for AI call attempts (§4.2, §10.3).
 *
 * Invariants:
 *   - No DELETE is exported — append-only by design. One narrow exception to
 *     "no UPDATE" (added 2026-08-12, code-review fix #3): reserveCallSlot()/
 *     finalizeCallLog() together close a cap-check race (see their own
 *     docstrings) — a reserved row is updated exactly once, by its own
 *     writer, to attach the real outcome. It is never otherwise mutated.
 *   - Deleting an agent leaves its log rows intact (soft agentId ref).
 *   - listCallLogs selects explicit columns so a future column cannot silently
 *     leak into the list DTO (Plan B readiness, §4.2).
 *   - sharedWithAdmin is written ONCE by the gateway at write time and never
 *     updated — constraint 11. The row's copy governs what the admin sees (§5.6).
 *   - Pre-auth rows (userId IS NULL) are NEVER redacted, regardless of
 *     sharedWithAdmin — they predate multi-tenancy and belong to the admin (§4.3).
 */

import { eq, and, gte, desc, sql, SQL } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';
import type { LoggedRequest, LoggedResponse } from '../schema.js';

// Re-export for callers that build the write payload
export type { LoggedRequest, LoggedResponse };

export type LlmCallKind = 'import-strict' | 'import-structural' | 'chat';

export type WriteCallLogInput = {
  kind: LlmCallKind;
  agentId?: string | null;
  agentLabel?: string | null;
  dryRun: boolean;
  model: string;
  requestPayload: LoggedRequest;
  responsePayload?: LoggedResponse | null;
  error?: string | null;
  durationMs: number;
  usage?: { inputTokens: number; outputTokens: number } | null;
  /** The user who triggered this call; null for pre-auth/script/test rows (§4.3). */
  userId?: string | null;
  /** Snapshot of the user's shareLogsWithAdmin at write time (§5.6, constraint 11). */
  sharedWithAdmin: boolean;
};

/** Shape returned from listCallLogs — no payloads (§4.2 Plan B readiness). */
export type CallLogListItem = {
  id: string;
  kind: LlmCallKind;
  provider: string;
  agentId: string | null;
  agentLabel: string | null;
  dryRun: boolean;
  model: string;
  error: string | null;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number } | null;
  createdAt: Date;
  /** The user who triggered this call; null for pre-auth rows (§4.3). */
  userId: string | null;
  /**
   * Whether the requestPayload/responsePayload would be redacted for the viewer.
   * Based on the §5.6 rule: userId !== null && userId !== viewerUserId && sharedWithAdmin === false.
   * In the list DTO, payloads are not included — this flag lets the UI show a lock icon.
   */
  redacted: boolean;
};

/** Full row including payloads — returned only by getCallLog. */
export type CallLogFull = CallLogListItem & {
  requestPayload: LoggedRequest | null;
  responsePayload: LoggedResponse | null;
};

export type ListCallLogsOptions = {
  limit?: number;        // 1–500, default 200
  dryRun?: boolean;      // filter when provided
  kind?: LlmCallKind;   // filter when provided
  userId?: string | null; // filter to a specific user when provided
  /**
   * The user viewing the list. Used to compute the `redacted` flag.
   * When provided, rows where userId !== viewerUserId && sharedWithAdmin === false
   * are marked redacted. When omitted, redacted defaults to userId !== null && sharedWithAdmin === false.
   */
  viewerUserId?: string | null;
};

// ─────────────────────────────  Write  ─────────────────────────────────────

/**
 * Appends one row. Returns the generated id.
 * Throws if the INSERT fails — callers catch this and handle per §5.5.
 */
export function writeCallLog(input: WriteCallLogInput): string {
  const id = crypto.randomUUID();
  db.insert(schema.llmCallLog).values({
    id,
    kind: input.kind,
    agentId: input.agentId ?? null,
    agentLabel: input.agentLabel ?? null,
    dryRun: input.dryRun,
    model: input.model,
    requestPayload: input.requestPayload,
    responsePayload: input.responsePayload ?? null,
    error: input.error ?? null,
    durationMs: input.durationMs,
    usage: input.usage ?? null,
    userId: input.userId ?? null,
    sharedWithAdmin: input.sharedWithAdmin,
  }).run();
  return id;
}

// ─────────────────────────────  Reserve / finalize (live-path race fix)  ────

export type ReserveCallSlotInput = {
  kind: LlmCallKind;
  agentId?: string | null;
  agentLabel?: string | null;
  model: string;
  requestPayload: LoggedRequest;
  userId?: string | null;
  sharedWithAdmin: boolean;
};

/**
 * Reserves a row for a live call BEFORE the network call happens, so it
 * counts toward countLlmCallsInWindow() immediately — closing the race where
 * the cap-check read and the log-write that used to make a call "count" were
 * separated by the full provider round-trip, letting concurrent requests all
 * read the same stale count and all pass the cap (found in code review,
 * 2026-08-12). Row starts with dryRun:false and a null response/error/usage;
 * MUST be completed by finalizeCallLog() on every exit path (success,
 * provider error, or abort) — see that function.
 *
 * Throws if the INSERT fails, same as writeCallLog — callers catch this and
 * proceed without a logId per §5.5 (a failed log write is never a reason to
 * block a live call).
 */
export function reserveCallSlot(input: ReserveCallSlotInput): string {
  const id = crypto.randomUUID();
  db.insert(schema.llmCallLog).values({
    id,
    kind: input.kind,
    agentId: input.agentId ?? null,
    agentLabel: input.agentLabel ?? null,
    dryRun: false,
    model: input.model,
    requestPayload: input.requestPayload,
    responsePayload: null,
    error: null,
    durationMs: 0,
    usage: null,
    userId: input.userId ?? null,
    sharedWithAdmin: input.sharedWithAdmin,
  }).run();
  return id;
}

export type FinalizeCallLogInput = {
  responsePayload?: LoggedResponse | null;
  error?: string | null;
  durationMs: number;
  usage?: { inputTokens: number; outputTokens: number } | null;
};

/**
 * Completes a row created by reserveCallSlot() with the real outcome — the
 * ONE UPDATE exported from this file (see the file-header invariant and
 * reserveCallSlot's docstring). Every reserve MUST be paired with exactly one
 * finalize, on every exit path, or the row is left permanently looking
 * "in progress" (durationMs:0, error:null, responsePayload:null).
 */
export function finalizeCallLog(id: string, input: FinalizeCallLogInput): void {
  db.update(schema.llmCallLog)
    .set({
      responsePayload: input.responsePayload ?? null,
      error: input.error ?? null,
      durationMs: input.durationMs,
      usage: input.usage ?? null,
    })
    .where(eq(schema.llmCallLog.id, id))
    .run();
}

// ─────────────────────────────  Read — list  ────────────────────────────────

/**
 * Lists log rows ordered by createdAt DESC, id DESC.
 * Payloads are excluded (Plan B readiness — explicit column selection).
 * The `redacted` field on each item indicates whether the detail view would
 * redact payloads for the given viewer (§5.6).
 */
export function listCallLogs(opts: ListCallLogsOptions = {}): CallLogListItem[] {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 500);

  const conditions: SQL[] = [];
  if (opts.dryRun !== undefined) {
    conditions.push(eq(schema.llmCallLog.dryRun, opts.dryRun));
  }
  if (opts.kind !== undefined) {
    conditions.push(eq(schema.llmCallLog.kind, opts.kind));
  }
  if (opts.userId !== undefined) {
    if (opts.userId === null) {
      conditions.push(sql`${schema.llmCallLog.userId} IS NULL`);
    } else {
      conditions.push(eq(schema.llmCallLog.userId, opts.userId));
    }
  }

  const where = conditions.length > 0
    ? (conditions.length === 1 ? conditions[0] : and(...conditions))
    : undefined;

  const q = db
    .select({
      id: schema.llmCallLog.id,
      kind: schema.llmCallLog.kind,
      provider: schema.llmCallLog.provider,
      agentId: schema.llmCallLog.agentId,
      agentLabel: schema.llmCallLog.agentLabel,
      dryRun: schema.llmCallLog.dryRun,
      model: schema.llmCallLog.model,
      error: schema.llmCallLog.error,
      durationMs: schema.llmCallLog.durationMs,
      usage: schema.llmCallLog.usage,
      createdAt: schema.llmCallLog.createdAt,
      userId: schema.llmCallLog.userId,
      sharedWithAdmin: schema.llmCallLog.sharedWithAdmin,
    })
    .from(schema.llmCallLog)
    .orderBy(desc(schema.llmCallLog.createdAt), desc(schema.llmCallLog.id))
    .limit(limit);

  const rows = where ? q.where(where).all() : q.all();
  const viewerUserId = opts.viewerUserId;

  return rows.map((r) => {
    const userId = r.userId ?? null;
    const shared = Boolean(r.sharedWithAdmin);
    const redacted = computeRedacted(userId, viewerUserId ?? null, shared);
    return {
      id: r.id,
      kind: r.kind as LlmCallKind,
      provider: r.provider,
      agentId: r.agentId ?? null,
      agentLabel: r.agentLabel ?? null,
      dryRun: Boolean(r.dryRun),
      model: r.model,
      error: r.error ?? null,
      durationMs: r.durationMs,
      usage: r.usage as { inputTokens: number; outputTokens: number } | null,
      createdAt: r.createdAt,
      userId,
      redacted,
    };
  });
}

// ─────────────────────────────  Read — detail  ──────────────────────────────

/**
 * Returns a single row with full payloads (or nulled if redacted), or null if not found.
 *
 * viewerUserId is REQUIRED — the §5.6 redaction rule requires knowing who is asking.
 * There is no default or optional form; a caller that omits it cannot silently get
 * the unredacted row (same principle as ownerId in §6.1).
 *
 * Redaction rule (§5.6):
 *   redacted = userId !== null && userId !== viewerUserId && sharedWithAdmin === false
 * When redacted: requestPayload = null, responsePayload = null, redacted = true.
 * Pre-auth rows (userId === null) are NEVER redacted (§4.3).
 */
export function getCallLog(id: string, viewerUserId: string): CallLogFull | null {
  const row = db
    .select()
    .from(schema.llmCallLog)
    .where(eq(schema.llmCallLog.id, id))
    .get();

  if (!row) return null;

  const userId = row.userId ?? null;
  const shared = Boolean(row.sharedWithAdmin);
  const redacted = computeRedacted(userId, viewerUserId, shared);

  return {
    id: row.id,
    kind: row.kind as LlmCallKind,
    provider: row.provider,
    agentId: row.agentId ?? null,
    agentLabel: row.agentLabel ?? null,
    dryRun: Boolean(row.dryRun),
    model: row.model,
    error: row.error ?? null,
    durationMs: row.durationMs,
    usage: row.usage as { inputTokens: number; outputTokens: number } | null,
    createdAt: row.createdAt,
    userId,
    redacted,
    requestPayload: redacted ? null : (row.requestPayload as LoggedRequest),
    responsePayload: redacted ? null : ((row.responsePayload ?? null) as LoggedResponse | null),
  };
}

// ─────────────────────────────  Cap count  ──────────────────────────────────

/**
 * Counts live (dry_run = 0) calls for a user in a rolling window.
 * Returns COUNT(*) and MIN(created_at) so the caller can compute
 * retryAfterSeconds = (oldestAt + windowSeconds) - now.
 *
 * `sinceEpochSeconds` = Math.floor((Date.now() / 1000) - windowSeconds) — computed by caller.
 *
 * Backed by llm_call_log_user_created_idx (§4.3 / §3.9).
 */
export function countLlmCallsInWindow(
  userId: string,
  sinceEpochSeconds: number,
): { count: number; oldestAt: Date | null } {
  const result = db
    .select({
      count: sql<number>`COUNT(*)`,
      oldestAt: sql<number | null>`MIN(${schema.llmCallLog.createdAt})`,
    })
    .from(schema.llmCallLog)
    .where(
      and(
        eq(schema.llmCallLog.userId, userId),
        eq(schema.llmCallLog.dryRun, false),
        gte(schema.llmCallLog.createdAt, new Date(sinceEpochSeconds * 1000)),
      ),
    )
    .get();

  const count = result?.count ?? 0;
  const oldestRaw = result?.oldestAt;

  let oldestAt: Date | null = null;
  if (oldestRaw !== null && oldestRaw !== undefined) {
    // sql<number | null> → SQLite returns epoch seconds as a number
    oldestAt = new Date(oldestRaw * 1000);
  }

  return { count, oldestAt };
}

// ─────────────────────────────  Internal helpers  ───────────────────────────

/**
 * §5.6 redaction rule:
 *   redacted = userId !== null && userId !== viewerUserId && sharedWithAdmin === false
 *
 * Pre-auth rows (userId === null) are never redacted.
 * The viewer's own rows (userId === viewerUserId) are never redacted.
 */
function computeRedacted(
  userId: string | null,
  viewerUserId: string | null,
  sharedWithAdmin: boolean,
): boolean {
  if (userId === null) return false;          // pre-auth row — never redacted (§4.3)
  if (userId === viewerUserId) return false;  // viewer's own row
  return !sharedWithAdmin;
}
