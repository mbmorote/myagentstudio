import 'server-only';

/**
 * lib/db/repository/llmCallLog.ts
 *
 * Append-only audit log for AI call attempts (§4.2, §10.3).
 *
 * Invariants:
 *   - No UPDATE or DELETE is exported — append-only by design.
 *   - Deleting an agent leaves its log rows intact (soft agentId ref).
 *   - listCallLogs selects explicit columns so a future userId column
 *     cannot silently leak into the list DTO (Plan B readiness, §4.2).
 */

import { eq, and, desc, SQL } from 'drizzle-orm';
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
};

/** Full row including payloads — returned only by getCallLog. */
export type CallLogFull = CallLogListItem & {
  requestPayload: LoggedRequest;
  responsePayload: LoggedResponse | null;
};

export type ListCallLogsOptions = {
  limit?: number;       // 1–500, default 200
  dryRun?: boolean;     // filter when provided
  kind?: LlmCallKind;  // filter when provided
};

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
  }).run();
  return id;
}

/**
 * Lists log rows ordered by createdAt DESC, id DESC.
 * Payloads are excluded (Plan B readiness — explicit column selection).
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
    })
    .from(schema.llmCallLog)
    .orderBy(desc(schema.llmCallLog.createdAt), desc(schema.llmCallLog.id))
    .limit(limit);

  const rows = where ? q.where(where).all() : q.all();

  return rows.map((r) => ({
    ...r,
    kind: r.kind as LlmCallKind,
    agentId: r.agentId ?? null,
    agentLabel: r.agentLabel ?? null,
    dryRun: Boolean(r.dryRun),
    error: r.error ?? null,
    usage: r.usage as { inputTokens: number; outputTokens: number } | null,
  }));
}

/**
 * Returns a single row with full payloads, or null if not found.
 */
export function getCallLog(id: string): CallLogFull | null {
  const row = db
    .select()
    .from(schema.llmCallLog)
    .where(eq(schema.llmCallLog.id, id))
    .get();

  if (!row) return null;

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
    requestPayload: row.requestPayload as LoggedRequest,
    responsePayload: (row.responsePayload ?? null) as LoggedResponse | null,
  };
}
