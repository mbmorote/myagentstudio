/**
 * lib/auth/rateLimit.ts
 *
 * In-process fixed-window rate limiter for the two public auth routes (§3.8).
 *
 * Scope: POST /api/auth/login and POST /api/auth/signup only — the only
 * endpoints reachable without a session on the public internet.
 *
 * Limit: 10 attempts per 15-minute window per (route, client IP).
 * IP source: first entry of x-forwarded-for, falling back to 'unknown'.
 *
 * Stated limitations, accepted deliberately (§3.8):
 *   - Per-process: a multi-instance deploy multiplies the effective limit.
 *   - Resets on restart.
 *   - x-forwarded-for is spoofable unless TLS termination rewrites it.
 *
 * The keep-or-drop question is open (§14, §16.7); this module is ~30 lines,
 * has no dependency, and removing it is deleting one file and two call sites.
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
 * Returns null if the request is within the rate limit, or
 * { retryAfterSeconds: number } if the limit has been exceeded.
 */
export function checkRateLimit(
  request: NextRequest,
  route: string,
): null | { retryAfterSeconds: number } {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const key = `${route}:${ip}`;
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
