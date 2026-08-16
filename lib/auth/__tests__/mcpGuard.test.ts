/**
 * lib/auth/__tests__/mcpGuard.test.ts
 *
 * Tests for lib/auth/mcpGuard.ts (Plan 13 §5.3).
 *
 * Mocks the repository lookup (findApiTokenByHash / touchApiTokenLastUsed) and the
 * rate limiter (checkRateLimitByKey) — the two seams mcpGuard.ts calls out to.
 *
 * Cases:
 *   - No header / wrong scheme / empty bearer / unknown token / revoked / expired →
 *     all 401, and all produce the SAME body (no oracle distinguishing "revoked"
 *     from "never existed")
 *   - Valid token → principal carries the right userId/scope and NO role field at all
 *   - Rate limiter: exceeding it → 429 + Retry-After; a different token is unaffected
 *   - No log line or error body contains the presented token's plaintext
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

type MockTokenRecord = {
  id: string;
  ownerId: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  tokenId: string;
};

let mockRecord: MockTokenRecord | null = null;
let mockRateLimitResult: null | { retryAfterSeconds: number } = null;
const touchCalls: string[] = [];

vi.mock('../../db/repository/apiTokens.js', () => ({
  findApiTokenByHash: vi.fn(() => mockRecord),
  touchApiTokenLastUsed: vi.fn((id: string) => { touchCalls.push(id); }),
}));

vi.mock('../rateLimit.js', () => ({
  checkRateLimitByKey: vi.fn(() => mockRateLimitResult),
}));

import { authenticateMcpToken } from '../mcpGuard.js';
import { generateApiToken } from '../apiToken.js';

function makeRequest(authHeader: string | null): Request {
  const headers = new Headers();
  if (authHeader !== null) headers.set('Authorization', authHeader);
  return new Request('http://localhost/api/mcp', { method: 'POST', headers });
}

beforeEach(() => {
  mockRecord = null;
  mockRateLimitResult = null;
  touchCalls.length = 0;
  vi.clearAllMocks();
});

// ── Failure cases — all 401, all identical body ─────────────────────────────────

describe('authenticateMcpToken — failure cases', () => {
  it('no Authorization header → 401 with WWW-Authenticate: Bearer', async () => {
    const result = await authenticateMcpToken(makeRequest(null));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('wrong auth scheme (not Bearer) → 401', async () => {
    const result = await authenticateMcpToken(makeRequest('Basic abc123'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it('empty bearer value → 401', async () => {
    const result = await authenticateMcpToken(makeRequest('Bearer '));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it('unknown token (no matching row) → 401', async () => {
    mockRecord = null;
    const { plaintext } = generateApiToken();
    const result = await authenticateMcpToken(makeRequest(`Bearer ${plaintext}`));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it('revoked token → 401', async () => {
    mockRecord = {
      id: 't1', tokenId: 't1', ownerId: 'u1', name: 'x', prefix: 'mya_xxxx',
      scope: 'read', createdAt: new Date(), lastUsedAt: null,
      expiresAt: null, revokedAt: new Date(),
    };
    const { plaintext } = generateApiToken();
    const result = await authenticateMcpToken(makeRequest(`Bearer ${plaintext}`));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it('expired token → 401', async () => {
    mockRecord = {
      id: 't2', tokenId: 't2', ownerId: 'u1', name: 'x', prefix: 'mya_xxxx',
      scope: 'read', createdAt: new Date(), lastUsedAt: null,
      expiresAt: new Date(Date.now() - 60_000), revokedAt: null,
    };
    const { plaintext } = generateApiToken();
    const result = await authenticateMcpToken(makeRequest(`Bearer ${plaintext}`));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it('all failure cases produce the identical response body (no revoked-vs-unknown oracle)', async () => {
    const bodies: unknown[] = [];

    mockRecord = null;
    bodies.push(await (await authenticateMcpToken(makeRequest('Bearer ' + generateApiToken().plaintext)) as { ok: false; response: Response }).response.json());

    mockRecord = {
      id: 't3', tokenId: 't3', ownerId: 'u1', name: 'x', prefix: 'mya_xxxx',
      scope: 'read', createdAt: new Date(), lastUsedAt: null,
      expiresAt: null, revokedAt: new Date(),
    };
    bodies.push(await (await authenticateMcpToken(makeRequest('Bearer ' + generateApiToken().plaintext)) as { ok: false; response: Response }).response.json());

    mockRecord = {
      id: 't4', tokenId: 't4', ownerId: 'u1', name: 'x', prefix: 'mya_xxxx',
      scope: 'read', createdAt: new Date(), lastUsedAt: null,
      expiresAt: new Date(Date.now() - 60_000), revokedAt: null,
    };
    bodies.push(await (await authenticateMcpToken(makeRequest('Bearer ' + generateApiToken().plaintext)) as { ok: false; response: Response }).response.json());

    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });
});

// ── Success case ─────────────────────────────────────────────────────────────────

describe('authenticateMcpToken — success', () => {
  it('valid token → principal carries the right userId/scope and NO role field', async () => {
    mockRecord = {
      id: 'tok-1', tokenId: 'tok-1', ownerId: 'user-42', name: 'laptop', prefix: 'mya_xxxx',
      scope: 'write', createdAt: new Date(), lastUsedAt: null,
      expiresAt: null, revokedAt: null,
    };
    const { plaintext } = generateApiToken();
    const result = await authenticateMcpToken(makeRequest(`Bearer ${plaintext}`));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.userId).toBe('user-42');
    expect(result.principal.tokenId).toBe('tok-1');
    expect(result.principal.scope).toBe('write');
    // Structural assertion — no role field, even accidentally
    expect('role' in result.principal).toBe(false);
  });

  it('touches lastUsedAt on success', async () => {
    mockRecord = {
      id: 'tok-2', tokenId: 'tok-2', ownerId: 'user-1', name: 'x', prefix: 'mya_xxxx',
      scope: 'read', createdAt: new Date(), lastUsedAt: null,
      expiresAt: null, revokedAt: null,
    };
    const { plaintext } = generateApiToken();
    await authenticateMcpToken(makeRequest(`Bearer ${plaintext}`));
    expect(touchCalls).toContain('tok-2');
  });
});

// ── Rate limiting ────────────────────────────────────────────────────────────────

describe('authenticateMcpToken — rate limiting', () => {
  it('rate-limited → 429 with Retry-After', async () => {
    mockRecord = {
      id: 'tok-3', tokenId: 'tok-3', ownerId: 'user-1', name: 'x', prefix: 'mya_xxxx',
      scope: 'read', createdAt: new Date(), lastUsedAt: null,
      expiresAt: null, revokedAt: null,
    };
    mockRateLimitResult = { retryAfterSeconds: 42 };
    const { plaintext } = generateApiToken();
    const result = await authenticateMcpToken(makeRequest(`Bearer ${plaintext}`));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get('Retry-After')).toBe('42');
  });

  it('a request under the limit is unaffected', async () => {
    mockRecord = {
      id: 'tok-4', tokenId: 'tok-4', ownerId: 'user-1', name: 'x', prefix: 'mya_xxxx',
      scope: 'read', createdAt: new Date(), lastUsedAt: null,
      expiresAt: null, revokedAt: null,
    };
    mockRateLimitResult = null;
    const { plaintext } = generateApiToken();
    const result = await authenticateMcpToken(makeRequest(`Bearer ${plaintext}`));
    expect(result.ok).toBe(true);
  });
});

// ── Credential non-disclosure ─────────────────────────────────────────────────────

describe('authenticateMcpToken — never logs or echoes the presented token', () => {
  it('no console output or error body contains the presented token plaintext', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockRecord = null;
    const { plaintext } = generateApiToken();
    const result = await authenticateMcpToken(makeRequest(`Bearer ${plaintext}`));

    if (!result.ok) {
      const bodyText = await result.response.clone().text();
      expect(bodyText.includes(plaintext)).toBe(false);
    }

    const allCalls = [...consoleSpy.mock.calls, ...warnSpy.mock.calls, ...logSpy.mock.calls]
      .flat()
      .map((v) => String(v));
    expect(allCalls.some((s) => s.includes(plaintext))).toBe(false);

    consoleSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});
