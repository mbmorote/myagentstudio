/**
 * app/api/chat/__tests__/chat-dryrun.test.ts
 *
 * Dry-run end-to-end test for POST /api/chat (§10.4).
 *
 * Mocks the PROVIDER module (not the caller) so the real chatMediator.ts,
 * real gateway.ts, and real route.ts all execute. With liveLlmCalls='false':
 *   - response is 409 with error:'llm_dry_run', dryRun:true, kind:'chat', logId non-null
 *   - fake.complete was never called
 *   - exactly one llm_call_log row with dryRun:true
 *   - zero agent-side writes (no new sectionRevision, no version bump)
 *
 * Kept separate from chat.test.ts because that file mocks at the chatMediator
 * level, which would prevent the gateway from executing.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
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

// ── Mock the PROVIDER (not the caller) — real gateway and real caller execute ──
const fakeComplete = vi.fn(async () => {
  throw new Error('should not be called in dry-run');
});

vi.mock('../../../../lib/ai/anthropicProvider.js', () => ({
  createAnthropicProvider: () => ({
    id: 'fake',
    defaultModel: () => 'claude-opus-4-8',
    complete: fakeComplete,
    stream: fakeComplete,
  }),
  LlmProviderResponseError: class LlmProviderResponseError extends Error {
    constructor(msg: string) { super(msg); this.name = 'LlmProviderResponseError'; }
  },
}));

// ── Imports after mocks ────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { CONFIG_DEFS, SECTION_DEFS } from '../../../../lib/blueprint/catalog.js';
import { createAgent } from '../../../../lib/db/repository/agents.js';
import { POST } from '../route.js';

function setLiveLlmCalls(value: string) {
  testDb
    .insert(schema.setting)
    .values({ key: 'liveLlmCalls', value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
    .run();
}

function countLogRows(): number {
  return testDb.select().from(schema.llmCallLog).all().length;
}

// ── Seed and create test agent ─────────────────────────────────────────────────
let testAgentId: string;

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

  const dto = createAgent(BOOTSTRAP_USER_ID, 'chat-dryrun-test-agent', 'Test agent for chat dry-run');
  testAgentId = dto.id;
});

describe('POST /api/chat — dry-run', () => {
  it('returns 409 with llm_dry_run, kind=chat; provider never called; one log row; zero agent writes', async () => {
    setLiveLlmCalls('false');
    const logsBefore = countLogRows();

    // Snapshot section versions before the call
    const agentBefore = testDb
      .select()
      .from(schema.agentSection)
      .all()
      .filter((s) => s.agentId === testAgentId);
    const versionsBefore = new Map(agentBefore.map((s) => [s.id, s.version]));

    const revisionsBefore = testDb
      .select()
      .from(schema.sectionRevision)
      .all().length;

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: testAgentId, instruction: 'test dry run' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(409);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('llm_dry_run');
    expect(body.dryRun).toBe(true);
    expect(body.kind).toBe('chat');
    expect(typeof body.logId).toBe('string');
    expect(body.message).toContain('turned off');

    // Provider never called
    expect(fakeComplete).not.toHaveBeenCalled();

    // Exactly one new log row, dryRun=true
    expect(countLogRows()).toBe(logsBefore + 1);
    const rows = testDb.select().from(schema.llmCallLog).all();
    const latest = rows[rows.length - 1];
    expect(latest.dryRun).toBe(true);
    expect(latest.kind).toBe('chat');
    expect(latest.agentId).toBe(testAgentId);

    // Zero agent-side writes (invariant 8) — no new revisions, no version bumps
    expect(testDb.select().from(schema.sectionRevision).all().length).toBe(revisionsBefore);
    const agentAfter = testDb
      .select()
      .from(schema.agentSection)
      .all()
      .filter((s) => s.agentId === testAgentId);
    for (const section of agentAfter) {
      expect(section.version).toBe(versionsBefore.get(section.id));
    }
  });
});

// ── Auth guard: unauthenticated → 401 (§10.2, §3.6) ─────────────────────────

describe('unauthenticated → 401', () => {
  it('POST /api/chat returns 401 when there is no session', async () => {
    currentSession = null;
    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: testAgentId, messages: [] }),
      }),
    );
    expect(res.status).toBe(401);
    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'user' };
  });
});
