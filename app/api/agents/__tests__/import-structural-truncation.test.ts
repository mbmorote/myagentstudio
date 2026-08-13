/**
 * app/api/agents/__tests__/import-structural-truncation.test.ts
 *
 * End-to-end route test for POST /api/agents/import, mode='structural', when the
 * Anthropic response is truncated (stop_reason === 'max_tokens').
 *
 * Mocks the PROVIDER module (not the caller) so the real caller (callDaedalus),
 * real gateway, and real route all execute — exercising the actual truncation
 * check inside callDaedalus (a truncated document is content loss by definition,
 * never stored) and the route's error mapping to
 * 422 { error: 'structural_truncated' }, not just a mock's own configured return
 * value. Companion to lib/import/__tests__/structural.test.ts, which tests the
 * assembleStructural/upsertAgentFromImport pipeline layer below the route and
 * has no access to this route-level error-mapping behavior.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOTSTRAP_USER_ID } from '../../../../lib/auth/constants.js';

// ── Mock getSession — the single auth seam (§10.2) ────────────────────────────
const currentSession: { userId: string; email: string; role: 'admin' | 'user' } = {
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
const fakeStream = vi.fn(async () => ({
  text: '# ROLE\n\nPartial restructured content, cut off mid-sen',
  stopReason: 'max_tokens' as const,
  model: 'claude-opus-4-8',
  usage: { inputTokens: 500, outputTokens: 4096 },
}));

vi.mock('../../../../lib/ai/anthropicProvider.js', () => ({
  createAnthropicProvider: () => ({
    id: 'fake',
    defaultModel: () => 'claude-opus-4-8',
    complete: vi.fn(async () => {
      throw new Error('complete() should not be called for structural import');
    }),
    stream: fakeStream,
  }),
  LlmProviderResponseError: class LlmProviderResponseError extends Error {
    constructor(msg: string) { super(msg); this.name = 'LlmProviderResponseError'; }
  },
}));

// ── Imports after mocks ────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { CONFIG_DEFS } from '../../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../../lib/db/sectionDefsSeed.js';
import { POST } from '../import/route.js';

// Minimal valid agent .md for test fixtures
const VALID_MD = `---
name: truncated-test-agent
description: A test agent for structural-truncation tests
---

# ROLE

I am a test agent with enough content to plausibly hit a token limit.
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

function countSnapshots(): number {
  return testDb.select().from(schema.agentSnapshot).all().length;
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
        key: def.key, defaultHeading: def.defaultHeading,
        isCore: def.isCore, defaultOrder: def.defaultOrder,
        template: def.template, helpText: def.helpText,
      })
      .onConflictDoNothing()
      .run();
  }
  setLiveLlmCalls('true');
});

beforeEach(() => {
  fakeStream.mockClear();
});

describe('POST /api/agents/import — structural mode, truncated response', () => {
  it('422 structural_truncated when stop_reason is max_tokens, nothing stored', async () => {
    const agentsBefore = countAgents();
    const snapshotsBefore = countSnapshots();

    const response = await POST(makeRequest({ md: VALID_MD, mode: 'structural' }));

    expect(response.status).toBe(422);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('structural_truncated');

    // The real truncation check inside callDaedalus actually ran (fake provider
    // was actually called) — this is not a mock asserting its own configured value.
    expect(fakeStream).toHaveBeenCalledTimes(1);

    // Nothing was written to the DB — the route never reached assembleStructural/
    // upsertAgentFromImport on this path.
    expect(countAgents()).toBe(agentsBefore);
    expect(countSnapshots()).toBe(snapshotsBefore);
  });
});
