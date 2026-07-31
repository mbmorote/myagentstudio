import 'server-only';

/**
 * lib/db/repository/users.ts
 *
 * Repository layer for user rows and invite codes.
 *
 * Constraints enforced here:
 *   - constraint 5: createUserWithInvite() accepts a passwordHash, never a plaintext
 *     password — hashing must happen outside any db.transaction() callback.
 *   - constraint 6: this layer never issues a JWT and never sees a plaintext password.
 *   - constraint 11: shareLogsWithAdmin is stored but never rewritten after creation
 *     (the gateway enforces this; the log row carries its own copy).
 *   - §4.4: createUserWithInvite() re-checks all preconditions inside one transaction.
 */

import { eq, and, sql, gte } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';

// ─────────────────────────────  DTO types  ─────────────────────────────────

export type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  shareLogsWithAdmin: boolean;
  createdAt: Date;
};

/** Narrow read used by the gateway — never exposes passwordHash. */
export type UserPolicy = {
  role: 'admin' | 'user';
  shareLogsWithAdmin: boolean;
};

export type InviteCodeRow = {
  code: string;
  note: string | null;
  createdBy: string;
  createdAt: Date;
  redeemedBy: string | null;
  redeemedAt: Date | null;
};

// ─────────────────────────────  User reads  ────────────────────────────────

export function getUserById(id: string): UserRow | null {
  const row = db.select().from(schema.user).where(eq(schema.user.id, id)).get();
  if (!row) return null;
  return mapUserRow(row);
}

export function getUserByEmail(email: string): UserRow | null {
  const row = db.select().from(schema.user).where(eq(schema.user.email, email)).get();
  if (!row) return null;
  return mapUserRow(row);
}

export function getUserCount(): number {
  const result = db.select({ count: sql<number>`COUNT(*)` }).from(schema.user).get();
  return result?.count ?? 0;
}

/**
 * The narrow read the gateway uses (§3.9 step 4, §5.6).
 * Deliberately returns only role + consent — the LLM path never holds a password hash.
 * Returns null if the user does not exist.
 */
export function getUserPolicy(userId: string): UserPolicy | null {
  const row = db
    .select({ role: schema.user.role, shareLogsWithAdmin: schema.user.shareLogsWithAdmin })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .get();

  if (!row) return null;
  return {
    role: row.role as 'admin' | 'user',
    shareLogsWithAdmin: Boolean(row.shareLogsWithAdmin),
  };
}

// ─────────────────────────────  User writes  ───────────────────────────────

/**
 * Updates the bootstrap admin's email and passwordHash.
 * Called only by scripts/bootstrap-user.ts — never by a route.
 *
 * If `force` is false (default), rejects if the stored hash is not the sentinel.
 * Returns true if the update happened, false if skipped (hash already set, no force).
 */
export function setUserPassword(
  userId: string,
  email: string,
  passwordHash: string,
  force = false,
): boolean {
  const existing = db.select().from(schema.user).where(eq(schema.user.id, userId)).get();
  if (!existing) return false;

  if (!force && existing.passwordHash !== '') {
    return false; // already has a password; caller should use --force
  }

  db.update(schema.user)
    .set({ email, passwordHash })
    .where(eq(schema.user.id, userId))
    .run();

  return true;
}

/**
 * Updates a user's own shareLogsWithAdmin preference.
 * Returns true if updated, false if the user was not found.
 * No admin variant exists — consent belongs only to the user (§8 invariant 17).
 */
export function setUserLogSharing(userId: string, shareLogsWithAdmin: boolean): boolean {
  const existing = db.select({ id: schema.user.id }).from(schema.user)
    .where(eq(schema.user.id, userId)).get();
  if (!existing) return false;

  db.update(schema.user)
    .set({ shareLogsWithAdmin })
    .where(eq(schema.user.id, userId))
    .run();

  return true;
}

// ─────────────────────────────  Atomic signup  ────────────────────────────

export type OAuthSignupInput = {
  provider: string;
  providerAccountId: string;
  providerEmail: string | null;
};

export type CreateUserWithInviteInput = {
  email: string;           // already normalized (lowercased + trimmed)
  passwordHash: string;    // already hashed — constraint 5
  code: string;            // already normalized
  maxUsers: number;        // read from settings by the caller
  shareLogsWithAdmin: boolean; // the signup consent choice — never inferred (§5.6)
  /**
   * Required, explicitly nullable (§4.2). Pass null for password-only signup so
   * every call site states its intent — an optional field is an opt-out that will
   * eventually be taken by accident (P05-C2 reasoning applied to a new field).
   */
  oauth: OAuthSignupInput | null;
};

export type CreateUserWithInviteResult =
  | { ok: true; user: UserRow }
  | { ok: false; reason: 'invalid_code' | 'email_exists' | 'cap_reached' | 'oauth_account_exists' };

/**
 * Internal signal class used to force a rollback from inside a db.transaction()
 * callback when a precondition discovered after a DML statement is violated.
 * better-sqlite3 rolls back if the callback throws; returning commits.
 */
class RollbackSignal extends Error {
  constructor(public readonly failureReason: Exclude<CreateUserWithInviteResult, { ok: true }>['reason']) {
    super(`rollback: ${failureReason}`);
    this.name = 'RollbackSignal';
  }
}

/**
 * The one transactional signup primitive (§4.4, extended by §4.2).
 *
 * Re-checks all preconditions inside one synchronous db.transaction():
 *   1. Invite code exists and is unredeemed.
 *   2. User count is below maxUsers.
 *   3. Email is not already registered.
 *   4. Inserts the user (role: 'user', always — signup never mints admin).
 *   4a. (when oauth !== null) Re-checks (provider, providerAccountId) uniqueness.
 *   4b. (when oauth !== null) Inserts the oauth_account row.
 *   5. Marks the code redeemed.
 *
 * passwordHash is accepted here, never a plaintext password (constraint 5).
 * oauth is required and explicitly nullable — pass null for password-only signup (§4.2).
 * A failure anywhere leaves the invite code unredeemed and zero rows written.
 *
 * Steps 1–3 return before any DML so they can use `return` to exit. Steps 4a–4b come
 * after the user INSERT (step 4), so they throw a RollbackSignal to force a rollback.
 */
export function createUserWithInvite(
  input: CreateUserWithInviteInput,
): CreateUserWithInviteResult {
  let result: CreateUserWithInviteResult = { ok: false, reason: 'invalid_code' };

  try {
    db.transaction((tx) => {
      // 1. Validate invite code
      const codeRow = tx
        .select()
        .from(schema.inviteCode)
        .where(eq(schema.inviteCode.code, input.code))
        .get();

      if (!codeRow || codeRow.redeemedBy !== null) {
        result = { ok: false, reason: 'invalid_code' };
        return; // no DML yet — return commits nothing
      }

      // 2. Check user cap
      const countResult = tx.select({ count: sql<number>`COUNT(*)` }).from(schema.user).get();
      const count = countResult?.count ?? 0;
      if (count >= input.maxUsers) {
        result = { ok: false, reason: 'cap_reached' };
        return; // no DML yet
      }

      // 3. Check for duplicate email
      const emailCheck = tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, input.email))
        .get();

      if (emailCheck) {
        result = { ok: false, reason: 'email_exists' };
        return; // no DML yet
      }

      // 4. Insert user (role: 'user' unconditionally — §8 invariant 6)
      const userId = crypto.randomUUID();
      tx.insert(schema.user).values({
        id: userId,
        email: input.email,
        passwordHash: input.passwordHash,
        role: 'user',
        shareLogsWithAdmin: input.shareLogsWithAdmin,
      }).run();

      // 4a. If an OAuth identity was supplied, re-check uniqueness inside the transaction.
      //     This is the authoritative check — the composite PK is the independent backstop
      //     for a race (§4.2). Throws RollbackSignal (not returns) because step 4 already
      //     ran a DML statement; better-sqlite3 only rolls back on throw, not on return.
      if (input.oauth !== null) {
        const existingOAuth = tx
          .select({ provider: schema.oauthAccount.provider })
          .from(schema.oauthAccount)
          .where(
            and(
              eq(schema.oauthAccount.provider, input.oauth.provider),
              eq(schema.oauthAccount.providerAccountId, input.oauth.providerAccountId),
            ),
          )
          .get();

        if (existingOAuth) {
          throw new RollbackSignal('oauth_account_exists');
        }

        // 4b. Insert the oauth_account row pointing at the newly created user.
        tx.insert(schema.oauthAccount).values({
          provider: input.oauth.provider,
          providerAccountId: input.oauth.providerAccountId,
          userId,
          providerEmail: input.oauth.providerEmail,
        }).run();
      }

      // 5. Mark code redeemed (AND redeemed_by IS NULL is the backstop for a race)
      tx.update(schema.inviteCode)
        .set({ redeemedBy: userId, redeemedAt: new Date() })
        .where(
          and(
            eq(schema.inviteCode.code, input.code),
            // SQL IS NULL check via Drizzle
            sql`${schema.inviteCode.redeemedBy} IS NULL`,
          ),
        )
        .run();

      // Re-read the freshly inserted user row to return it
      const newUser = tx.select().from(schema.user).where(eq(schema.user.id, userId)).get();
      if (!newUser) {
        // Shouldn't happen; guard for type safety
        result = { ok: false, reason: 'invalid_code' };
        return;
      }

      result = { ok: true, user: mapUserRow(newUser) };
    });
  } catch (e) {
    if (e instanceof RollbackSignal) {
      result = { ok: false, reason: e.failureReason };
    } else {
      throw e;
    }
  }

  return result;
}

// ─────────────────────────────  Invite codes  ──────────────────────────────

export type CreateInviteCodeInput = {
  code: string;        // already generated and normalized
  note?: string | null;
  createdBy: string;   // admin's user id
};

export function createInviteCode(input: CreateInviteCodeInput): InviteCodeRow {
  db.insert(schema.inviteCode).values({
    code: input.code,
    note: input.note ?? null,
    createdBy: input.createdBy,
    redeemedBy: null,
  }).run();

  const row = db.select().from(schema.inviteCode).where(eq(schema.inviteCode.code, input.code)).get();
  if (!row) throw new Error(`Invite code not found after insert: ${input.code}`);
  return mapInviteCodeRow(row);
}

export function listInviteCodes(): InviteCodeRow[] {
  const rows = db
    .select()
    .from(schema.inviteCode)
    .orderBy(schema.inviteCode.createdAt)
    .all();
  return rows.map(mapInviteCodeRow);
}

/**
 * Revokes an unredeemed invite code (DELETE the row).
 * Returns 'deleted' if removed, 'already_redeemed' if it has been redeemed,
 * 'not_found' if the code doesn't exist.
 */
export function revokeInviteCode(
  code: string,
): 'deleted' | 'already_redeemed' | 'not_found' {
  const row = db.select().from(schema.inviteCode).where(eq(schema.inviteCode.code, code)).get();
  if (!row) return 'not_found';
  if (row.redeemedBy !== null) return 'already_redeemed';

  db.delete(schema.inviteCode).where(eq(schema.inviteCode.code, code)).run();
  return 'deleted';
}

// ─────────────────────────────  Internal mappers  ──────────────────────────

function mapUserRow(row: typeof schema.user.$inferSelect): UserRow {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role as 'admin' | 'user',
    shareLogsWithAdmin: Boolean(row.shareLogsWithAdmin),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date((row.createdAt as number) * 1000),
  };
}

function mapInviteCodeRow(row: typeof schema.inviteCode.$inferSelect): InviteCodeRow {
  return {
    code: row.code,
    note: row.note ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date((row.createdAt as number) * 1000),
    redeemedBy: row.redeemedBy ?? null,
    redeemedAt: row.redeemedAt
      ? (row.redeemedAt instanceof Date ? row.redeemedAt : new Date((row.redeemedAt as number) * 1000))
      : null,
  };
}
