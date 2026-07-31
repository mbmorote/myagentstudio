/**
 * app/api/llm-call-log/__tests__/llm-call-log.test.ts
 *
 * Route tests for GET /api/llm-call-log and GET /api/llm-call-log/[id] (§10.4).
 *
 * Covers:
 *   - List shape and filters (dryRun, kind, limit)
 *   - Detail includes requestPayload / responsePayload
 *   - Unknown id → 404
 *   - limit above cap → 400 (the repository caps at 500; the route validates)
 *   - invalid query params → 400
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { BOOTSTRAP_USER_ID } from '../../../../lib/auth/constants.js';

// ── Mock getSession — the single auth seam (§10.2) ────────────────────────────
let currentSession: { userId: string; email: string; role: 'admin' | 'user' } | null = {
  userId: BOOTSTRAP_USER_ID,
  email: 'bootstrap@example.test',
  role: 'admin',
};

vi.mock('../../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mock ─────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { GET as listGET } from '../route.js';
import { GET as detailGET } from '../[id]/route.js';
import type { LoggedRequest } from '../../../../lib/db/schema.js';

// Clear log rows before each test
beforeEach(() => {
  testDb.delete(schema.llmCallLog).run();
});

const SAMPLE_REQUEST: LoggedRequest = {
  system: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'Hello' }],
  maxTokens: 100,
  model: 'claude-opus-4-8',
};

function insertLogRow(overrides: Partial<typeof schema.llmCallLog.$inferInsert> = {}): string {
  const id = crypto.randomUUID();
  testDb.insert(schema.llmCallLog).values({
    id,
    kind: 'chat',
    provider: 'anthropic',
    agentId: null,
    agentLabel: 'test-agent',
    dryRun: false,
    model: 'claude-opus-4-8',
    requestPayload: SAMPLE_REQUEST,
    responsePayload: null,
    error: null,
    durationMs: 42,
    usage: null,
    ...overrides,
  }).run();
  return id;
}

function makeListRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/llm-call-log');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

function makeDetailRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/llm-call-log/${id}`);
}

// ── List route ────────────────────────────────────────────────────────────────

describe('GET /api/llm-call-log', () => {
  it('returns empty entries array when no rows', async () => {
    const res = await listGET(makeListRequest());
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: unknown[] };
    expect(body.entries).toHaveLength(0);
  });

  it('returns entries without requestPayload / responsePayload fields', async () => {
    insertLogRow();
    const res = await listGET(makeListRequest());
    const body = await res.json() as { entries: Record<string, unknown>[] };
    expect(body.entries).toHaveLength(1);
    const entry = body.entries[0];
    expect(entry).not.toHaveProperty('requestPayload');
    expect(entry).not.toHaveProperty('responsePayload');
    // Check expected fields are present
    expect(typeof entry.id).toBe('string');
    expect(entry.kind).toBe('chat');
    expect(entry.dryRun).toBe(false);
    expect(typeof entry.createdAt).toBe('string');
  });

  it('filters by dryRun=true', async () => {
    insertLogRow({ dryRun: false });
    insertLogRow({ dryRun: true });
    const res = await listGET(makeListRequest({ dryRun: 'true' }));
    const body = await res.json() as { entries: Record<string, unknown>[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].dryRun).toBe(true);
  });

  it('filters by dryRun=false', async () => {
    insertLogRow({ dryRun: false });
    insertLogRow({ dryRun: true });
    const res = await listGET(makeListRequest({ dryRun: 'false' }));
    const body = await res.json() as { entries: Record<string, unknown>[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].dryRun).toBe(false);
  });

  it('filters by kind=import-strict', async () => {
    insertLogRow({ kind: 'chat' });
    insertLogRow({ kind: 'import-strict' });
    const res = await listGET(makeListRequest({ kind: 'import-strict' }));
    const body = await res.json() as { entries: Record<string, unknown>[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].kind).toBe('import-strict');
  });

  it('invalid dryRun param → 400', async () => {
    const res = await listGET(makeListRequest({ dryRun: 'maybe' }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_query');
    expect(body.field).toBe('dryRun');
  });

  it('invalid kind param → 400', async () => {
    const res = await listGET(makeListRequest({ kind: 'unknown-kind' }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_query');
    expect(body.field).toBe('kind');
  });

  it('limit above 500 → 400 invalid_query', async () => {
    const res = await listGET(makeListRequest({ limit: '501' }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_query');
    expect(body.field).toBe('limit');
  });

  it('limit=0 → 400 invalid_query', async () => {
    const res = await listGET(makeListRequest({ limit: '0' }));
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('invalid_query');
    expect(body.field).toBe('limit');
  });
});

// ── Detail route ──────────────────────────────────────────────────────────────

describe('GET /api/llm-call-log/[id]', () => {
  it('returns full row including requestPayload when found', async () => {
    const id = insertLogRow({
      responsePayload: { text: 'hello', stopReason: 'end_turn' },
    });
    const res = await detailGET(makeDetailRequest(id), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(id);
    expect(body).toHaveProperty('requestPayload');
    expect(body).toHaveProperty('responsePayload');
    const rp = body.requestPayload as LoggedRequest;
    expect(rp.system).toBe('You are a helpful assistant.');
    expect((body.responsePayload as Record<string, unknown>)?.text).toBe('hello');
  });

  it('unknown id → 404 not_found', async () => {
    const fakeId = crypto.randomUUID();
    const res = await detailGET(makeDetailRequest(fakeId), {
      params: Promise.resolve({ id: fakeId }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('not_found');
  });

  it('responsePayload is null for dry-run rows', async () => {
    const id = insertLogRow({ dryRun: true, responsePayload: null });
    const res = await detailGET(makeDetailRequest(id), {
      params: Promise.resolve({ id }),
    });
    const body = await res.json() as Record<string, unknown>;
    expect(body.responsePayload).toBeNull();
    expect(body.dryRun).toBe(true);
  });
});

// ── Auth guard: unauthenticated → 401 (§10.2, §3.6) ─────────────────────────

describe('unauthenticated → 401', () => {
  it('GET /api/llm-call-log returns 401 when there is no session', async () => {
    currentSession = null;
    const res = await listGET(makeListRequest());
    expect(res.status).toBe(401);
    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'admin' };
  });
});
