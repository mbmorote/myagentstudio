/**
 * lib/auth/rateLimit.ts
 *
 * In-process fixed-window rate limiter (Plan 13: generalized key — was (route, IP) only).
 *
 * Two call signatures:
 *   checkRateLimit(request, route)
 *     — the original form: keys by (route, client IP). Used by login/signup/request-access
 *       (the public, session-free endpoints reachable from the internet).
 *
 *   checkRateLimitByKey(key)
 *     — a direct string key. Used by the MCP guard to key by ('mcp', tokenId), so each
 *       token has its own independent rate window rather than sharing one per IP.
 *
 * Limit: 10 attempts per 15-minute window per key.
 *
 * Stated limitations, accepted deliberately (same as before this generalization):
 *   - Per-process: a multi-instance deploy multiplies the effective limit.
 *   - Resets on restart.
 *   - x-forwarded-for is spoofable unless TLS termination rewrites it
 *     (applies to checkRateLimit's IP derivation, not to checkRateLimitByKey).
 *
 * These limitations are documented here rather than elsewhere so they're visible
 * at the definition site, not just in the consuming code.
 */

import type { NextRequest } from 'next/server';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

type WindowEntry = {
  count: number;
  windowStart: number;
};

const store = new Map<string, WindowEntry>();

/**
 * Core limiter logic — takes an arbitrary string key.
 * Returns null if within the limit, or { retryAfterSeconds } if exceeded.
 */
export function checkRateLimitByKey(key: string): null | { retryAfterSeconds: number } {
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    // New or expired window — start fresh
    entry = { count: 1, windowStart: now };
    store.set(key, entry);
    return null;
  }

  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    const retryAfterMs = WINDOW_MS - (now - entry.windowStart);
    return { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }

  return null;
}

/**
 * Returns null if the request is within the rate limit, or
 * { retryAfterSeconds: number } if the limit has been exceeded.
 *
 * Keys by (route, client IP).
 * IP source: first entry of x-forwarded-for, falling back to 'unknown'.
 */
export function checkRateLimit(
  request: NextRequest,
  route: string,
): null | { retryAfterSeconds: number } {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const key = `${route}:${ip}`;
  return checkRateLimitByKey(key);
}
