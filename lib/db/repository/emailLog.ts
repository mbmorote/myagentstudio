import 'server-only';

/**
 * lib/db/repository/emailLog.ts
 *
 * Append-only audit log for outbound email attempts (Plan 14, §4.5).
 *
 * Invariants:
 *   - No UPDATE, no DELETE exported — append-only, with no sanctioned exception
 *     (unlike llm_call_log's reserve/finalize pair: the cap counter here is a
 *     filtered COUNT query over completed rows, not the raw row count, so nothing
 *     needs a reserved row to close a race).
 *   - The rendered email body is never accepted as input — WriteEmailLogInput has
 *     no body/html field at all. The constraint is structural (the type), not a
 *     habit to remember (lib/email/CLAUDE.md, constraint 7).
 */

import { and, eq, gte, desc, sql } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';

export type EmailLogStatus = 'sent' | 'failed' | 'dry_run' | 'blocked_cap' | 'not_configured';

export type WriteEmailLogInput = {
  kind: string;
  provider: string;
  toEmail: string;
  subject: string;
  status: EmailLogStatus;
  providerMessageId?: string | null;
  error?: string | null;
  durationMs: number;
  relatedType?: string | null;
  relatedId?: string | null;
  triggeredBy?: string | null;
};

export type EmailLogRow = {
  id: string;
  kind: string;
  provider: string;
  toEmail: string;
  subject: string;
  status: EmailLogStatus;
  providerMessageId: string | null;
  error: string | null;
  durationMs: number;
  relatedType: string | null;
  relatedId: string | null;
  triggeredBy: string | null;
  createdAt: Date;
};

function toRow(r: typeof schema.emailLog.$inferSelect): EmailLogRow {
  return {
    id: r.id,
    kind: r.kind,
    provider: r.provider,
    toEmail: r.toEmail,
    subject: r.subject,
    status: r.status as EmailLogStatus,
    providerMessageId: r.providerMessageId ?? null,
    error: r.error ?? null,
    durationMs: r.durationMs,
    relatedType: r.relatedType ?? null,
    relatedId: r.relatedId ?? null,
    triggeredBy: r.triggeredBy ?? null,
    createdAt: r.createdAt,
  };
}

// ─────────────────────────────  Write  ─────────────────────────────────────

/**
 * Appends one row. Returns the generated id.
 * Throws if the INSERT fails — the gateway swallows this with a console.error on
 * the live path (a mail already sent/failed is never discarded for a logging
 * failure); on the dry-run/blocked paths the caller still returns its blocked
 * result with logId: null.
 */
export function writeEmailLog(input: WriteEmailLogInput): string {
  const id = crypto.randomUUID();
  db.insert(schema.emailLog).values({
    id,
    kind: input.kind,
    provider: input.provider,
    toEmail: input.toEmail,
    subject: input.subject,
    status: input.status,
    providerMessageId: input.providerMessageId ?? null,
    error: input.error ?? null,
    durationMs: input.durationMs,
    relatedType: input.relatedType ?? null,
    relatedId: input.relatedId ?? null,
    triggeredBy: input.triggeredBy ?? null,
  }).run();
  return id;
}

// ─────────────────────────────  Cap count  ──────────────────────────────────

/**
 * Counts rows created at or after `sinceMs` whose status is 'sent' or 'failed' —
 * i.e. the ones that actually reached the provider. This asymmetry (a filtered
 * query, not the raw row count) is deliberate and is what lets a 'blocked_cap' /
 * 'dry_run' / 'not_configured' row be logged without inflating the count that
 * produced it (§4.3 step 2).
 */
export function countBillableEmailsInWindow(sinceMs: number): number {
  const result = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.emailLog)
    .where(
      and(
        sql`${schema.emailLog.status} IN ('sent', 'failed')`,
        gte(schema.emailLog.createdAt, new Date(sinceMs)),
      ),
    )
    .get();
  return result?.count ?? 0;
}

// ─────────────────────────────  Per-code status  ────────────────────────────

/**
 * Returns the newest email_log row for a given invite code, or null if none exist.
 *
 * Tiebroken by SQLite's implicit rowid (monotonically increasing with insertion
 * order), not just createdAt — createdAt is second-granularity (`unixepoch()`),
 * so two attempts for the same code within the same second (e.g. a fast
 * double-click on "Resend") would otherwise tie and the wrong one could sort
 * first, which matters here more than in a list view: this result answers
 * "did the LAST attempt for this code actually succeed?"
 */
export function getLastEmailForInviteCode(code: string): EmailLogRow | null {
  const row = db
    .select()
    .from(schema.emailLog)
    .where(and(eq(schema.emailLog.relatedType, 'invite_code'), eq(schema.emailLog.relatedId, code)))
    .orderBy(desc(schema.emailLog.createdAt), desc(sql`rowid`))
    .limit(1)
    .get();
  return row ? toRow(row) : null;
}

// ─────────────────────────────  Read — list  ────────────────────────────────

export type ListEmailLogOptions = { limit?: number; offset?: number };

/**
 * Admin-only read, newest first — backs D6's Email log pane if built. The table
 * is not write-only without this: countBillableEmailsInWindow and
 * getLastEmailForInviteCode above are both load-bearing regardless.
 */
export function listEmailLog(opts: ListEmailLogOptions = {}): EmailLogRow[] {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 500);
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = db
    .select()
    .from(schema.emailLog)
    .orderBy(desc(schema.emailLog.createdAt), desc(schema.emailLog.id))
    .limit(limit)
    .offset(offset)
    .all();
  return rows.map(toRow);
}
