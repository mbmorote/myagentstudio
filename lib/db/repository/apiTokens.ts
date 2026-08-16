import 'server-only';

/**
 * lib/db/repository/apiTokens.ts
 *
 * Repository layer for api_token rows (Plan 13, MCP access).
 *
 * The ONLY file that touches the api_token table. Owns all CRUD for Personal
 * Access Tokens used by console MCP clients (Claude Code and equivalents).
 *
 * Invariants enforced here:
 *   - Every read that scopes by owner uses ownerId in the same WHERE clause.
 *     No function can accidentally return another user's token.
 *   - The tokenHash is NEVER returned in list output — only prefix, name,
 *     scope, and dates are returned to callers. The hash is only ever read
 *     by findApiTokenByHash(), which is the lookup path, not a list path.
 *   - revokedAt is a soft delete — no token row is ever physically deleted,
 *     so lastUsedAt survives revocation as an audit trail.
 *   - Per-user cap: createApiToken enforces a maximum of MAX_TOKENS_PER_USER
 *     active (not revoked) tokens to prevent unbounded accumulation.
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';

// Per the plan (§4.2): suggest 10 active tokens per user.
const MAX_TOKENS_PER_USER = 10;

// ─────────────────────────────  DTO types  ─────────────────────────────────

/** Returned by list and create (minus the plaintext, which is returned at creation only). */
export type ApiTokenRow = {
  id: string;
  ownerId: string;
  name: string;
  /** First 12 chars of the plaintext — display only, never replayable. */
  prefix: string;
  scope: 'read' | 'write';
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

/** Returned by findApiTokenByHash — includes ownerId and scope for the guard. */
export type ApiTokenRecord = ApiTokenRow & {
  /** The owner's user id — used by the MCP guard to resolve the principal. */
  ownerId: string;
  tokenId: string; // alias for id, typed separately for clarity in the guard
};

export type CreateApiTokenInput = {
  ownerId: string;
  name: string;
  /** SHA-256 hex of the plaintext token — the lookup key. Never the plaintext. */
  tokenHash: string;
  /** First 12 chars of the plaintext token — display only. */
  prefix: string;
  scope: 'read' | 'write';
  /** Optional expiry; null = never expires. */
  expiresAt?: Date | null;
};

// ─────────────────────────────  Cap error  ────────────────────────────────

export class TooManyTokensError extends Error {
  override name = 'TooManyTokensError';
  readonly limit: number;
  constructor(limit: number) {
    super(`You already have ${limit} active tokens — revoke one before creating another.`);
    this.limit = limit;
  }
}

// ─────────────────────────────  Write  ──────────────────────────────────────

/**
 * Creates an api_token row. Enforces the per-user active-token cap.
 *
 * Returns the created ApiTokenRow (no tokenHash, no plaintext).
 * Throws TooManyTokensError if the cap is reached.
 */
export function createApiToken(input: CreateApiTokenInput): ApiTokenRow {
  // Count active (not revoked) tokens for this owner
  const activeRows = db
    .select({ id: schema.apiToken.id })
    .from(schema.apiToken)
    .where(
      and(
        eq(schema.apiToken.ownerId, input.ownerId),
        isNull(schema.apiToken.revokedAt),
      ),
    )
    .all();

  if (activeRows.length >= MAX_TOKENS_PER_USER) {
    throw new TooManyTokensError(MAX_TOKENS_PER_USER);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(schema.apiToken).values({
    id,
    ownerId: input.ownerId,
    name: input.name,
    tokenHash: input.tokenHash,
    prefix: input.prefix,
    scope: input.scope,
    createdAt: now,
    lastUsedAt: null,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
  }).run();

  return {
    id,
    ownerId: input.ownerId,
    name: input.name,
    prefix: input.prefix,
    scope: input.scope,
    createdAt: now,
    lastUsedAt: null,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
  };
}

// ─────────────────────────────  Read  ───────────────────────────────────────

/**
 * Lists all tokens for a user — prefix/name/scope/dates only, never the hash.
 * Ordered newest first.
 */
export function listApiTokensForUser(ownerId: string): ApiTokenRow[] {
  const rows = db
    .select({
      id: schema.apiToken.id,
      ownerId: schema.apiToken.ownerId,
      name: schema.apiToken.name,
      prefix: schema.apiToken.prefix,
      scope: schema.apiToken.scope,
      createdAt: schema.apiToken.createdAt,
      lastUsedAt: schema.apiToken.lastUsedAt,
      expiresAt: schema.apiToken.expiresAt,
      revokedAt: schema.apiToken.revokedAt,
    })
    .from(schema.apiToken)
    .where(eq(schema.apiToken.ownerId, ownerId))
    .orderBy(desc(schema.apiToken.createdAt))
    .all();

  return rows.map(mapRow);
}

/**
 * Looks up a token by its SHA-256 hash. Returns null if not found.
 * Returns the FULL record including ownerId for the MCP guard.
 *
 * Note: this intentionally does NOT filter on revokedAt/expiresAt — the
 * guard (lib/auth/mcpGuard.ts) makes the final decision on what a found
 * row means, so the repository returns whatever it finds.
 */
export function findApiTokenByHash(tokenHash: string): (ApiTokenRow & { tokenId: string }) | null {
  const row = db
    .select()
    .from(schema.apiToken)
    .where(eq(schema.apiToken.tokenHash, tokenHash))
    .get();

  if (!row) return null;

  return {
    ...mapRow(row),
    tokenId: row.id,
  };
}

/**
 * Updates lastUsedAt for the given token id. Best-effort — a failure here
 * does not fail the request (same pattern as gateway log-write failures).
 */
export function touchApiTokenLastUsed(id: string): void {
  db.update(schema.apiToken)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiToken.id, id))
    .run();
}

/**
 * Soft-deletes a token by setting revokedAt. Only the owner's token is
 * ever operated on — both id and ownerId must match for the update to apply.
 * Returns true if a row was updated, false if not found or wrong owner.
 */
export function revokeApiToken(id: string, ownerId: string): boolean {
  const result = db.update(schema.apiToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.apiToken.id, id),
        eq(schema.apiToken.ownerId, ownerId),
        isNull(schema.apiToken.revokedAt), // don't double-revoke
      ),
    )
    .run();

  return result.changes > 0;
}

// ─────────────────────────────  Internal helpers  ───────────────────────────

function mapRow(row: {
  id: string;
  ownerId: string;
  name: string;
  prefix: string;
  scope: string;
  createdAt: Date | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}): ApiTokenRow {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope as 'read' | 'write',
    createdAt: row.createdAt ?? new Date(0),
    lastUsedAt: row.lastUsedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}
