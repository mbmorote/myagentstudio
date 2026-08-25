/**
 * lib/auth/__tests__/rateLimit.test.ts
 *
 * Unit tests for checkRateLimit — pure in-process fixed-window limiter, no I/O.
 *
 * The module-level `store` Map is private and persists for the life of the
 * process (there's no reset export), so each test uses its own unique
 * (route, IP) key to avoid cross-test interference within this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { checkRateLimit, checkRateLimitByKey } from '../rateLimit.js';

function makeRequest(ip: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (ip !== null) headers['x-forwarded-for'] = ip;
  return new NextRequest('http://localhost/api/auth/login', { headers });
}

let routeCounter = 0;
function uniqueRoute(): string {
  routeCounter += 1;
  return `test-route-${routeCounter}`;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkRateLimit', () => {
  it('allows requests under the limit (20 per window)', () => {
    const route = uniqueRoute();
    const req = makeRequest('1.2.3.4');
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(req, route)).toBeNull();
    }
  });

  it('blocks the 21st request within the same window', () => {
    const route = uniqueRoute();
    const req = makeRequest('1.2.3.5');
    for (let i = 0; i < 20; i++) {
      checkRateLimit(req, route);
    }
    const result = checkRateLimit(req, route);
    expect(result).not.toBeNull();
    expect(result?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('retryAfterSeconds is at most the full window (15 min = 900s)', () => {
    const route = uniqueRoute();
    const req = makeRequest('1.2.3.6');
    for (let i = 0; i < 20; i++) {
      checkRateLimit(req, route);
    }
    const result = checkRateLimit(req, route);
    expect(result?.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it('resets after the 15-minute window expires', () => {
    const route = uniqueRoute();
    const req = makeRequest('1.2.3.7');
    for (let i = 0; i < 20; i++) {
      checkRateLimit(req, route);
    }
    expect(checkRateLimit(req, route)).not.toBeNull();

    // Advance past the 15-minute window.
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect(checkRateLimit(req, route)).toBeNull();
  });

  it('tracks different IPs independently under the same route', () => {
    const route = uniqueRoute();
    const reqA = makeRequest('10.0.0.1');
    const reqB = makeRequest('10.0.0.2');
    for (let i = 0; i < 20; i++) {
      checkRateLimit(reqA, route);
    }
    // A is now blocked, but B (different IP, same route) is fresh.
    expect(checkRateLimit(reqA, route)).not.toBeNull();
    expect(checkRateLimit(reqB, route)).toBeNull();
  });

  it('tracks different routes independently for the same IP', () => {
    const routeA = uniqueRoute();
    const routeB = uniqueRoute();
    const req = makeRequest('10.0.0.3');
    for (let i = 0; i < 20; i++) {
      checkRateLimit(req, routeA);
    }
    expect(checkRateLimit(req, routeA)).not.toBeNull();
    expect(checkRateLimit(req, routeB)).toBeNull();
  });

  it('takes the first entry of a comma-separated x-forwarded-for and trims it', () => {
    const route = uniqueRoute();
    const reqMulti = makeRequest(' 10.0.0.4 , 10.0.0.5');
    const reqSameFirst = makeRequest('10.0.0.4');
    for (let i = 0; i < 20; i++) {
      checkRateLimit(reqMulti, route);
    }
    // Same effective IP (first entry, trimmed) as reqMulti → shares the limit.
    expect(checkRateLimit(reqSameFirst, route)).not.toBeNull();
  });

  it('falls back to "unknown" when x-forwarded-for is absent', () => {
    const route = uniqueRoute();
    const req = makeRequest(null);
    expect(checkRateLimit(req, route)).toBeNull();
  });
});

// ── checkRateLimitByKey (Plan 13 — generalized key, used by the MCP guard) ──────

describe('checkRateLimitByKey', () => {
  it('allows requests under the limit (20 per window) for a direct string key', () => {
    const key = `mcp:${uniqueRoute()}`;
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimitByKey(key)).toBeNull();
    }
  });

  it('blocks the 21st request within the same window', () => {
    const key = `mcp:${uniqueRoute()}`;
    for (let i = 0; i < 20; i++) {
      checkRateLimitByKey(key);
    }
    const result = checkRateLimitByKey(key);
    expect(result).not.toBeNull();
    expect(result?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks different keys independently — one token id does not affect another', () => {
    const keyA = `mcp:${uniqueRoute()}`;
    const keyB = `mcp:${uniqueRoute()}`;
    for (let i = 0; i < 20; i++) {
      checkRateLimitByKey(keyA);
    }
    expect(checkRateLimitByKey(keyA)).not.toBeNull();
    expect(checkRateLimitByKey(keyB)).toBeNull();
  });

  it('checkRateLimit(request, route) and checkRateLimitByKey share the same underlying store — a colliding key is shared', () => {
    // checkRateLimit builds the key as `${route}:${ip}`. Constructing the identical
    // string via checkRateLimitByKey must hit the same window.
    const route = uniqueRoute();
    const req = makeRequest('10.9.9.9');
    const equivalentKey = `${route}:10.9.9.9`;
    for (let i = 0; i < 20; i++) {
      checkRateLimit(req, route);
    }
    expect(checkRateLimitByKey(equivalentKey)).not.toBeNull();
  });
});
