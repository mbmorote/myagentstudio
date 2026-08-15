import 'server-only';

/**
 * lib/db/repository/accessRequests.ts
 *
 * Repository layer for access_request rows (Plan 12, 2026-08-14) — the "Request access"
 * form for visitors without an invite code.
 *
 * A row is an OPEN request the admin hasn't acted on yet. Generating an invite code for
 * one (app/api/settings/access-requests/[id]/generate-code) or dismissing one both delete
 * the row — the generated code (if any) is the durable record from then on, in
 * lib/db/repository/users.ts's invite_code table, not here.
 */

import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';
import type { ReferralSource } from '../../auth/referralSource.js';

export type AccessRequestRow = {
  id: string;
  name: string;
  email: string;
  referralSource: ReferralSource | null;
  createdAt: Date;
};

function mapAccessRequestRow(row: typeof schema.accessRequest.$inferSelect): AccessRequestRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    referralSource: (row.referralSource as ReferralSource | null) ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date((row.createdAt as number) * 1000),
  };
}

export type CreateAccessRequestInput = {
  name: string;
  email: string; // already normalized (trim + lowercase) by the caller
  referralSource: ReferralSource | null;
};

export function createAccessRequest(input: CreateAccessRequestInput): AccessRequestRow {
  const id = crypto.randomUUID();
  db.insert(schema.accessRequest).values({
    id,
    name: input.name,
    email: input.email,
    referralSource: input.referralSource,
  }).run();

  const row = db.select().from(schema.accessRequest).where(eq(schema.accessRequest.id, id)).get();
  if (!row) throw new Error(`Access request not found after insert: ${id}`);
  return mapAccessRequestRow(row);
}

export function listAccessRequests(): AccessRequestRow[] {
  const rows = db
    .select()
    .from(schema.accessRequest)
    .orderBy(desc(schema.accessRequest.createdAt))
    .all();
  return rows.map(mapAccessRequestRow);
}

export function getAccessRequest(id: string): AccessRequestRow | null {
  const row = db.select().from(schema.accessRequest).where(eq(schema.accessRequest.id, id)).get();
  if (!row) return null;
  return mapAccessRequestRow(row);
}

export function deleteAccessRequest(id: string): boolean {
  const result = db.delete(schema.accessRequest).where(eq(schema.accessRequest.id, id)).run();
  return result.changes > 0;
}

/**
 * True if there's already an open (unhandled) request for this email — used to dedupe
 * at submission time so re-submitting the same email while a request is still pending
 * doesn't pile up duplicate rows in the admin's grid.
 */
export function hasOpenAccessRequest(email: string): boolean {
  const row = db
    .select({ id: schema.accessRequest.id })
    .from(schema.accessRequest)
    .where(eq(schema.accessRequest.email, email))
    .get();
  return row !== undefined;
}

/**
 * True if there's already a live (unredeemed, unexpired) invite code bound to this
 * email — a second signal alongside hasOpenAccessRequest, covering the case where the
 * admin already generated a code for a past request (which deletes the request row,
 * so hasOpenAccessRequest alone wouldn't catch it).
 */
export function hasActiveInviteCodeForEmail(email: string): boolean {
  const now = new Date();
  const row = db
    .select({ code: schema.inviteCode.code })
    .from(schema.inviteCode)
    .where(
      and(
        eq(schema.inviteCode.boundEmail, email),
        isNull(schema.inviteCode.redeemedBy),
        sql`(${schema.inviteCode.expiresAt} IS NULL OR ${schema.inviteCode.expiresAt} > ${Math.floor(now.getTime() / 1000)})`,
      ),
    )
    .get();
  return row !== undefined;
}
