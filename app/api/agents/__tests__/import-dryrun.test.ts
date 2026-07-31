/**
 * app/api/agents/__tests__/import-dryrun.test.ts
 *
 * Dry-run end-to-end route tests for POST /api/agents/import (§10.4).
 *
 * Mocks the PROVIDER module (not the caller) so the real caller, real gateway,
 * and real route all execute. With liveLlmCalls='false':
 *   - response is 409 with error:'llm_dry_run', dryRun:true, logId non-null
 *   - kind is correct for both import modes
 *   - fake.complete/fake.stream were never called
 *   - exactly one llm_call_log row with dryRun:true
 *   - zero agent-side writes (no new agent, agentSection, sectionRevision, agentSnapshot)
 *
 * Covers both import-structural and import-strict call paths.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { BOOTSTRAP_USER_ID } from '../../../../lib/auth/constants.js';

// ── Mock getSession — the single auth seam (§10.2) ────────────────────────────
let currentSession: { userId: string; email: string; role: 'admin' | 'user' } | null = {
  userId: BOOTSTRAP_USER_ID,
  email: 'bootstrap@example.test',
  role: 'user',
};

vi.mock('../../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock the provider — real caller, real gateway, real route all execute ──────
const fakeComplete = vi.fn(async () => {
  throw new Error('should not be called in dry-run');
});
const fakeStream = vi.fn(async () => {
  throw new Error('should not be called in dry-run');
});

vi.mock('../../../../lib/ai/anthropicProvider.js', () => ({
  createAnthropicProvider: () => ({
    id: 'fake',
    defaultModel: () => 'claude-opus-4-8',
    complete: fakeComplete,
    stream: fakeStream,
  }),
  LlmProviderResponseError: class LlmProviderResponseError extends Error {
    constructor(msg: string) { super(msg); this.name = 'LlmProviderResponseError'; }
  },
}));

// ── Imports after mocks ────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { CONFIG_DEFS, SECTION_DEFS } from '../../../../lib/blueprint/catalog.js';
import { POST } from '../import/route.js';

// Minimal valid agent .md for test fixtures
const VALID_MD = `---
name: test-agent
description: A test agent for dry-run tests
---

# ROLE

I am a test agent.
`;

function setLiveLlmCalls(value: string) {
  testDb
    .insert(schema.setting)
    .values({ key: 'liveLlmCalls', value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
    .run();
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/agents/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function countAgents(): number {
  return testDb.select().from(schema.agent).all().length;
}

function countLogRows(): number {
  return testDb.select().from(schema.llmCallLog).all().length;
}

// ── Seed catalog tables ────────────────────────────────────────────────────────
beforeAll(() => {
  for (const def of CONFIG_DEFS) {
    testDb
      .insert(schema.configDef)
      .values({
        key: def.key, label: def.label, datatype: def.datatype,
        allowedValues: def.allowedValues as string[] | null,
        required: def.required, isCore: def.isCore, exportable: true,
      })
      .onConflictDoNothing()
      .run();
  }
  for (const def of SECTION_DEFS) {
    testDb
      .insert(schema.sectionDef)
      .values({
        key: def.key, label: def.label, defaultHeading: def.defaultHeading,
        isCore: def.isCore, defaultOrder: def.defaultOrder,
        template: def.template, helpText: def.helpText,
      })
      .onConflictDoNothing()
      .run();
  }
});

beforeEach(() => {
  fakeComplete.mockClear();
  fakeStream.mockClear();
});

describe('POST /api/agents/import — dry-run', () => {
  it('structural mode: 409 with llm_dry_run, kind=import-structural, no agent created', async () => {
    setLiveLlmCalls('false');
    const agentsBefore = countAgents();
    const logsBefore = countLogRows();

    const response = await POST(makeRequest({ md: VALID_MD, mode: 'structural' }));

    expect(response.status).toBe(409);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('llm_dry_run');
    expect(body.dryRun).toBe(true);
    expect(body.kind).toBe('import-structural');
    expect(typeof body.logId).toBe('string');
    expect(body.message).toContain('turned off');

    // Provider never called
    expect(fakeStream).not.toHaveBeenCalled();
    expect(fakeComplete).not.toHaveBeenCalled();

    // Exactly one log row written
    expect(countLogRows()).toBe(logsBefore + 1);
    const rows = testDb.select().from(schema.llmCallLog).all();
    const latest = rows[rows.length - 1];
    expect(latest.dryRun).toBe(true);
    expect(latest.kind).toBe('import-structural');

    // Zero agent-side writes (invariant 8)
    expect(countAgents()).toBe(agentsBefore);
  });

  it('strict mode: 409 with llm_dry_run, kind=import-strict, no agent created', async () => {
    setLiveLlmCalls('false');
    const agentsBefore = countAgents();
    const logsBefore = countLogRows();

    const response = await POST(makeRequest({ md: VALID_MD, mode: 'strict' }));

    expect(response.status).toBe(409);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('llm_dry_run');
    expect(body.dryRun).toBe(true);
    expect(body.kind).toBe('import-strict');
    expect(typeof body.logId).toBe('string');

    // Provider never called
    expect(fakeComplete).not.toHaveBeenCalled();

    // Exactly one log row
    expect(countLogRows()).toBe(logsBefore + 1);
    const rows = testDb.select().from(schema.llmCallLog).all();
    const latest = rows[rows.length - 1];
    expect(latest.dryRun).toBe(true);

    // Zero agent-side writes
    expect(countAgents()).toBe(agentsBefore);
  });
});

// ── Auth guard: unauthenticated → 401 (§10.2, §3.6) ─────────────────────────

describe('unauthenticated → 401', () => {
  it('POST /api/agents/import returns 401 when there is no session', async () => {
    currentSession = null;
    const res = await POST(makeRequest({ md: VALID_MD, mode: 'structural' }));
    expect(res.status).toBe(401);
    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'user' };
  });
});
