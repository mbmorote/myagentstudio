import 'server-only';

/**
 * lib/db/repository/oauthAccounts.ts
 *
 * Repository layer for oauth_account rows (§4.1, §4.2).
 *
 * Design notes:
 *   - `linkOAuthAccount()` is a separate, single-statement INSERT — not part of the
 *     transactional signup primitive. It creates no user, redeems no code, and needs
 *     no transaction. A race between two concurrent link attempts for the same
 *     (provider, sub) is handled by the composite PK's unique-constraint error (§4.2).
 *   - `getOAuthAccount()` and `listOAuthAccountsForUser()` are plain indexed reads.
 *   - No UPDATE or DELETE is exported — the table is insert-only by application
 *     convention (unlinking is out of scope; §4.1 design notes).
 *   - Identity is (provider, providerAccountId), never email (§1 constraint 7).
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';

// ─────────────────────────────  DTO types  ─────────────────────────────────

export type OAuthAccountRow = {
  provider: string;
  providerAccountId: string;
  userId: string;
  providerEmail: string | null;
  createdAt: Date;
};

export type LinkOAuthAccountInput = {
  provider: string;
  providerAccountId: string;
  userId: string;
  providerEmail: string | null;
};

// ─────────────────────────────  Reads  ─────────────────────────────────────

/** Returns the oauth_account row for a given (provider, providerAccountId), or null. */
export function getOAuthAccount(
  provider: string,
  providerAccountId: string,
): OAuthAccountRow | null {
  const row = db
    .select()
    .from(schema.oauthAccount)
    .where(
      and(
        eq(schema.oauthAccount.provider, provider),
        eq(schema.oauthAccount.providerAccountId, providerAccountId),
      ),
    )
    .get();

  if (!row) return null;
  return mapOAuthAccountRow(row);
}

/** Returns all oauth_account rows for a given userId (via the oauth_account_user_idx). */
export function listOAuthAccountsForUser(userId: string): OAuthAccountRow[] {
  const rows = db
    .select()
    .from(schema.oauthAccount)
    .where(eq(schema.oauthAccount.userId, userId))
    .all();

  return rows.map(mapOAuthAccountRow);
}

// ─────────────────────────────  Writes  ────────────────────────────────────

/**
 * Links an existing user to an OAuth provider identity (§3.7 outcome 2 — auto-link).
 *
 * Single-statement INSERT — no transaction, no user creation, no invite code redemption.
 * Uniqueness is enforced by the (provider, providerAccountId) composite PK.
 * A caller catching a unique-constraint violation on this insert must re-read the
 * existing row and proceed as if the link already existed (§4.2 last paragraph).
 *
 * Throws on any DB error (including the unique-constraint violation on a race).
 */
export function linkOAuthAccount(input: LinkOAuthAccountInput): OAuthAccountRow {
  db.insert(schema.oauthAccount)
    .values({
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      userId: input.userId,
      providerEmail: input.providerEmail,
    })
    .run();

  const row = db
    .select()
    .from(schema.oauthAccount)
    .where(
      and(
        eq(schema.oauthAccount.provider, input.provider),
        eq(schema.oauthAccount.providerAccountId, input.providerAccountId),
      ),
    )
    .get();

  if (!row) throw new Error('oauth_account row not found immediately after insert');
  return mapOAuthAccountRow(row);
}

// ─────────────────────────────  Internal mapper  ───────────────────────────

function mapOAuthAccountRow(
  row: typeof schema.oauthAccount.$inferSelect,
): OAuthAccountRow {
  return {
    provider: row.provider,
    providerAccountId: row.providerAccountId,
    userId: row.userId,
    providerEmail: row.providerEmail ?? null,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt
        : new Date((row.createdAt as number) * 1000),
  };
}
