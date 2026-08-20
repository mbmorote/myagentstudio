import 'server-only';

/**
 * lib/auth/mcpGuard.ts
 *
 * MCP bearer-token authentication guard (Plan 13).
 *
 * Third sibling to authenticate() / authenticateAdmin() in guard.ts. Same
 * discriminated-union return shape: { ok: true, principal } or
 * { ok: false, response }.
 *
 * Flow:
 *   1. Read Authorization header. Missing or not Bearer → 401 with WWW-Authenticate.
 *   2. IP-keyed rate limit ('mcp-auth', client IP) → 429. Runs before any credential
 *      is looked up, so unthrottled guessing against unknown/invalid tokens isn't
 *      possible — mirrors login/signup's (route, IP) limiting via checkRateLimit.
 *   3. SHA-256 the value; findApiTokenByHash.
 *   4. No row, revokedAt set, or expiresAt in the past → 401.
 *      All three cases produce an INDISTINGUISHABLE response — same non-disclosure
 *      posture as the repo's cross-owner 404 (confirming "revoked" vs. "never existed"
 *      would leak information about the credential space).
 *   5. Per-token rate limit keyed ('mcp', tokenId) → 429 with Retry-After.
 *   6. touchApiTokenLastUsed (best-effort — a failure here never fails the request,
 *      same reasoning as the gateway swallowing a log-write failure on a live call).
 *      Throttled to once per 5 minutes per token — skipped if lastUsedAt is recent.
 *   7. Return { userId, tokenId, scope }.
 *
 * McpPrincipal deliberately carries NO role field (constraint 2 — an admin's token
 * is an ordinary user's token; an admin API over MCP is explicitly out of scope).
 *
 * Token: 'mya_' + 43 base64url chars. Never logs or echoes any prefix of the
 * presented token beyond the stored display prefix already in the database.
 */

import { NextResponse } from 'next/server';
import { findApiTokenByHash, touchApiTokenLastUsed } from '../db/repository/index.js';
import { hashApiToken } from './apiToken.js';
import { checkRateLimitByKey } from './rateLimit.js';

const TOUCH_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

// ─────────────────────────────  Principal  ────────────────────────────────────

/**
 * Resolved identity from a valid MCP bearer token.
 * Deliberately carries no role field — an admin's token grants the same access
 * as any user's token. (MCP constraint 2: no new powers, no admin API surface.)
 */
export type McpPrincipal = {
  userId: string;
  tokenId: string;
  scope: 'read' | 'write';
};

// ─────────────────────────────  Guard  ────────────────────────────────────────

type McpAuthOk   = { ok: true;  principal: McpPrincipal };
type McpAuthFail = { ok: false; response: NextResponse };

/**
 * Authenticates an MCP request via bearer token.
 * Returns { ok: true, principal } or { ok: false, response: 401/429 }.
 */
export async function authenticateMcpToken(
  request: Request,
): Promise<McpAuthOk | McpAuthFail> {
  // Step 1: Extract the bearer token
  const authHeader = request.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      response: mcpErrorResponse(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' }),
    };
  }

  const presented = authHeader.slice('Bearer '.length).trim();
  if (!presented) {
    return {
      ok: false,
      response: mcpErrorResponse(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' }),
    };
  }

  // Step 2: IP-keyed rate limit — runs before any credential lookup, so unknown/invalid
  // token guessing is throttled too (mirrors login/signup's pre-validation IP limiting).
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipRateLimitResult = checkRateLimitByKey(`mcp-auth:${ip}`);
  if (ipRateLimitResult !== null) {
    return {
      ok: false,
      response: mcpErrorResponse(
        429,
        { error: 'too_many_requests', retryAfterSeconds: ipRateLimitResult.retryAfterSeconds },
        { 'Retry-After': String(ipRateLimitResult.retryAfterSeconds) },
      ),
    };
  }

  // Step 3: SHA-256 hash and look up
  const hash = hashApiToken(presented);
  const record = findApiTokenByHash(hash);

  // Step 4: Validate — all failure cases return the same 401 body (non-disclosure)
  if (!record || isRevoked(record) || isExpired(record)) {
    return {
      ok: false,
      response: mcpErrorResponse(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' }),
    };
  }

  // Step 5: Per-token rate limit — keyed ('mcp', tokenId)
  const rateKey = `mcp:${record.tokenId}`;
  const rateLimitResult = checkRateLimitByKey(rateKey);
  if (rateLimitResult !== null) {
    return {
      ok: false,
      response: mcpErrorResponse(
        429,
        { error: 'too_many_requests', retryAfterSeconds: rateLimitResult.retryAfterSeconds },
        { 'Retry-After': String(rateLimitResult.retryAfterSeconds) },
      ),
    };
  }

  // Step 6: Touch lastUsedAt — best-effort, failure never blocks the request.
  // Throttled: skip the write if the token was touched within the last 5 minutes.
  const shouldTouch =
    !record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > TOUCH_THROTTLE_MS;
  if (shouldTouch) {
    try {
      touchApiTokenLastUsed(record.tokenId);
    } catch (err) {
      console.error('[mcp-guard] Failed to update lastUsedAt:', String(err));
      // proceed — same as gateway swallowing a log-write failure
    }
  }

  // Step 7: Return the principal — no role field (constraint 2)
  return {
    ok: true,
    principal: {
      userId: record.ownerId,
      tokenId: record.tokenId,
      scope: record.scope,
    },
  };
}

// ─────────────────────────────  Internal helpers  ─────────────────────────────

/** Builds a JSON error response with extra headers (WWW-Authenticate, Retry-After). */
function mcpErrorResponse(
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, { status, headers: extraHeaders });
}

function isRevoked(record: { revokedAt: Date | null }): boolean {
  return record.revokedAt !== null;
}

function isExpired(record: { expiresAt: Date | null }): boolean {
  if (record.expiresAt === null) return false;
  return record.expiresAt <= new Date();
}
