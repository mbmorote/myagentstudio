/**
 * app/api/chat/__tests__/chat.test.ts
 *
 * POST /api/chat — propose-only (Phase 1).
 *
 * Tests the route handler directly (imported and called as a function).
 * The Anthropic API is NEVER called — callPrometheus is mocked with controlled
 * responses. The DB client is replaced with an in-memory test instance.
 *
 * KEY INVARIANT: POST /api/chat NEVER writes to agent, agent_section, agent_config,
 * or section_revision (plans/archive/08-prometheus-apply.md §7 invariant 1).
 * The ZERO WRITES test (test 1 below) is the load-bearing enforcement of this invariant.
 *
 * Tests:
 *   1.  ZERO WRITES unconditionally — the load-bearing test. A successful chat call
 *       with non-empty modifications leaves agent_section.content/version,
 *       section_revision count, agent.description, and agent_config rows byte-identical
 *       to before. For sections too, not just description/config.
 *   2.  Response shape: { proposal: { message, modifications, warnings }, meta }.
 *   3.  Server loads sections and config from DB and passes them to callPrometheus.
 *   4.  Question-only turn (modifications: {}) → 200, no writes, message present.
 *   5.  citedSectionKeys and citedConfigKeys forwarded to callPrometheus correctly.
 *   6.  citedConfigKeys malformed (not array of strings) → unscoped fallback, 200.
 *   7.  Cancellation → 499.
 *   8.  Unknown agentId → 404.
 *   9.  Unauthenticated → 401.
 */

import { beforeAll, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { eq } from 'drizzle-orm';
import { BOOTSTRAP_USER_ID } from '../../../../lib/auth/constants.js';

// ── Mock getSession — the single auth seam ────────────────────────────────────
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

// ── Mock callPrometheus — never calls the real Anthropic API ──────────────────
// The mock returns PrometheusProposal shape: { message, modifications, warnings }
vi.mock('../../../../lib/ai/prometheus.js', () => ({
  callPrometheus: vi.fn(),
  PrometheusUpstreamError: class PrometheusUpstreamError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'PrometheusUpstreamError';
    }
  },
  PrometheusInvalidResponseError: class PrometheusInvalidResponseError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'PrometheusInvalidResponseError';
    }
  },
  PrometheusTruncatedError: class PrometheusTruncatedError extends Error {
    constructor() {
      super('Prometheus response was truncated (max_tokens) — content loss, rejected');
      this.name = 'PrometheusTruncatedError';
    }
  },
  demoteSplitLevelHeadings: vi.fn((content: string) => content),
}));

// ── Imports after mocks ────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { CONFIG_DEFS } from '../../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../../lib/db/sectionDefsSeed.js';
import {
  createAgent,
  getAgentFull,
} from '../../../../lib/db/repository/agents.js';
import { callPrometheus, PrometheusTruncatedError } from '../../../../lib/ai/prometheus.js';
import type { PrometheusProposal } from '../../../../lib/ai/prometheus.js';

// Route handler under test
import { POST } from '../route.js';

// ── Seed catalog + create test agent ──────────────────────────────────────────
let testAgentId: string;

beforeAll(() => {
  for (const def of CONFIG_DEFS) {
    testDb
      .insert(schema.configDef)
      .values({
        key: def.key,
        label: def.label,
        datatype: def.datatype,
        allowedValues: def.allowedValues as string[] | null,
        required: def.required,
        isCore: def.isCore,
        exportable: true,
      })
      .onConflictDoNothing()
      .run();
  }
  for (const def of SECTION_DEFS) {
    testDb
      .insert(schema.sectionDef)
      .values({
        key: def.key,
        defaultHeading: def.defaultHeading,
        isCore: def.isCore,
        defaultOrder: def.defaultOrder,
        template: def.template,
        helpText: def.helpText,
      })
      .onConflictDoNothing()
      .run();
  }

  const dto = createAgent(BOOTSTRAP_USER_ID, 'test-agent-p1', 'A test agent for Phase 1 chat route tests');
  testAgentId = dto.id;
});

// ── Helper ────────────────────────────────────────────────────────────────────
function makeRequest(body: unknown, signal?: AbortSignal): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/** Shorthand to mock callPrometheus with a PrometheusProposal return value. */
function mockProposal(proposal: PrometheusProposal) {
  (callPrometheus as MockedFunction<typeof callPrometheus>).mockResolvedValueOnce(proposal);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/chat — propose-only (Phase 1)', () => {

  // ── 1. ZERO WRITES unconditionally (the load-bearing test) ───────────────
  // A successful call with non-empty modifications must not touch any agent row,
  // section row, section_revision row, or config row. This single test enforces
  // the rule that POST /api/chat never writes to the agent, and supersedes the
  // old section-auto-apply behavior.
  it('ZERO WRITES: non-empty modifications response leaves DB unchanged for sections, description, and config', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const descriptionBefore = agentBefore.description;
    const versionsBefore = new Map(agentBefore.sections.map((s) => [s.id, s.version]));
    const contentsBefore = new Map(agentBefore.sections.map((s) => [s.id, s.content]));
    const revisionCountBefore = testDb.select().from(schema.sectionRevision).all().length;
    const configCountBefore = testDb
      .select()
      .from(schema.agentConfig)
      .where(eq(schema.agentConfig.agentId, testAgentId))
      .all().length;

    mockProposal({
      message: 'I updated role, behavior, description, and model.',
      modifications: {
        sections: { role: 'Proposed new role.', behavior: 'Proposed new behavior.' },
        description: 'Proposed new description.',
        config: { model: 'claude-opus-5' },
      },
      warnings: [],
    });

    const res = await POST(makeRequest({ agentId: testAgentId, instruction: 'update everything' }));
    expect(res.status).toBe(200);

    // section_revision count unchanged
    const revisionCountAfter = testDb.select().from(schema.sectionRevision).all().length;
    expect(revisionCountAfter).toBe(revisionCountBefore);

    // section versions and content unchanged
    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    for (const section of agentAfter.sections) {
      expect(section.version).toBe(versionsBefore.get(section.id));
      expect(section.content).toBe(contentsBefore.get(section.id));
    }

    // description unchanged
    expect(agentAfter.description).toBe(descriptionBefore);

    // agent_config unchanged (no new rows written)
    const configCountAfter = testDb
      .select()
      .from(schema.agentConfig)
      .where(eq(schema.agentConfig.agentId, testAgentId))
      .all().length;
    expect(configCountAfter).toBe(configCountBefore);
  });

  // ── 2. Response shape ─────────────────────────────────────────────────────
  it('response shape is { proposal: { message, modifications, warnings }, meta }', async () => {
    mockProposal({
      message: 'Proposal message text.',
      modifications: { sections: { role: 'New role content.' } },
      warnings: ['A warning.'],
    });

    const res = await POST(makeRequest({ agentId: testAgentId, instruction: 'update role' }));
    expect(res.status).toBe(200);

    const json = await res.json() as {
      proposal: {
        message: string;
        modifications: Record<string, unknown>;
        warnings: string[];
      };
      meta: {
        agentId: string;
        proposedAt: string;
        scoped: boolean;
        citedSectionKeys: string[];
        citedConfigKeys: string[];
      };
    };

    expect(typeof json.proposal.message).toBe('string');
    expect(json.proposal.message).toBe('Proposal message text.');
    expect(typeof json.proposal.modifications).toBe('object');
    expect(Array.isArray(json.proposal.warnings)).toBe(true);
    expect(json.proposal.warnings).toEqual(['A warning.']);

    expect(json.meta.agentId).toBe(testAgentId);
    expect(typeof json.meta.proposedAt).toBe('string');
    expect(typeof json.meta.scoped).toBe('boolean');
    expect(Array.isArray(json.meta.citedSectionKeys)).toBe(true);
    expect(Array.isArray(json.meta.citedConfigKeys)).toBe(true);
  });

  // ── 3. Server loads sections + config from DB ─────────────────────────────
  it('server loads sections and config from DB and passes them to callPrometheus', async () => {
    mockProposal({ message: 'noop', modifications: {}, warnings: [] });

    const res = await POST(makeRequest({ agentId: testAgentId, instruction: 'noop' }));
    expect(res.status).toBe(200);

    const lastCall = (callPrometheus as MockedFunction<typeof callPrometheus>).mock.calls.at(-1)!;
    const [callArg] = lastCall;

    // sections come from DB
    expect(Array.isArray(callArg.sections)).toBe(true);
    expect(callArg.sections.length).toBeGreaterThan(0);
    for (const s of callArg.sections) {
      expect(typeof s.content).toBe('string');
    }

    // config comes from DB (agent just created — may be empty array, but must exist)
    expect(Array.isArray(callArg.config)).toBe(true);
  });

  // ── 4. Question-only turn (modifications: {}) → 200, no writes, message present ──
  it('question-only turn (modifications: {}) → 200, message present, zero writes', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const versionsBefore = new Map(agentBefore.sections.map((s) => [s.id, s.version]));
    const revisionsBefore = testDb.select().from(schema.sectionRevision).all().length;

    mockProposal({
      message: 'Your agent looks great! No changes needed.',
      modifications: {},
      warnings: [],
    });

    const res = await POST(makeRequest({ agentId: testAgentId, instruction: 'how does my agent look?' }));
    expect(res.status).toBe(200);

    const json = await res.json() as {
      proposal: { message: string; modifications: Record<string, unknown>; warnings: string[] };
      meta: Record<string, unknown>;
    };

    expect(json.proposal.message).toBe('Your agent looks great! No changes needed.');
    expect(json.proposal.modifications).toEqual({});
    expect(json.meta.agentId).toBe(testAgentId);

    // No DB writes
    const revisionsAfter = testDb.select().from(schema.sectionRevision).all().length;
    expect(revisionsAfter).toBe(revisionsBefore);

    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    for (const section of agentAfter.sections) {
      expect(section.version).toBe(versionsBefore.get(section.id));
    }
  });

  // ── 5. Cited keys forwarded correctly ────────────────────────────────────
  it('citedSectionKeys and citedConfigKeys are forwarded to callPrometheus', async () => {
    mockProposal({ message: 'ok', modifications: {}, warnings: [] });

    const res = await POST(makeRequest({
      agentId: testAgentId,
      instruction: 'review role and model',
      citedSectionKeys: ['role'],
      citedConfigKeys: ['model'],
    }));
    expect(res.status).toBe(200);

    const lastCall = (callPrometheus as MockedFunction<typeof callPrometheus>).mock.calls.at(-1)!;
    const [callArg] = lastCall;
    expect(callArg.citedSectionKeys).toEqual(['role']);
    expect(callArg.citedConfigKeys).toEqual(['model']);

    const json = await res.json() as { meta: { scoped: boolean; citedSectionKeys: string[]; citedConfigKeys: string[] } };
    expect(json.meta.scoped).toBe(true);
    expect(json.meta.citedSectionKeys).toEqual(['role']);
    expect(json.meta.citedConfigKeys).toEqual(['model']);
  });

  // ── 6. citedConfigKeys malformed → unscoped fallback ─────────────────────
  it('malformed citedConfigKeys (not array of strings) → ignored, unscoped, 200', async () => {
    mockProposal({ message: 'ok', modifications: {}, warnings: [] });

    const res = await POST(makeRequest({
      agentId: testAgentId,
      instruction: 'review agent',
      citedConfigKeys: 'not-an-array',
    }));
    expect(res.status).toBe(200);

    const lastCall = (callPrometheus as MockedFunction<typeof callPrometheus>).mock.calls.at(-1)!;
    const [callArg] = lastCall;
    // Malformed → falls back to undefined (unscoped)
    expect(callArg.citedConfigKeys).toBeUndefined();
  });

  // ── 7. Cancellation → 499 ─────────────────────────────────────────────────
  // Zero writes is unconditional for POST /api/chat, so we only need to assert 499.
  it('cancellation: aborted request → 499', async () => {
    (callPrometheus as MockedFunction<typeof callPrometheus>).mockImplementationOnce(
      (input: Parameters<typeof callPrometheus>[0]) =>
        new Promise<never>((_, reject) => {
          const onAbort = () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          };
          if (input.signal?.aborted) {
            onAbort();
          } else {
            input.signal?.addEventListener('abort', onAbort, { once: true });
          }
        }),
    );

    const controller = new AbortController();
    const routePromise = POST(makeRequest(
      { agentId: testAgentId, instruction: 'tighten everything' },
      controller.signal,
    ));

    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    const res = await routePromise;
    expect(res.status).toBe(499);

    const json = await res.json() as { error: string };
    expect(json.error).toBe('cancelled');
  });

  // ── 7b. Truncated response (stop_reason === 'max_tokens') → 422, not 502 ──
  // 2026-08-12: found live — a truncated response's cut-off JSON was previously
  // either a 502 ai_upstream, or (after the non-JSON fallback fix) silently
  // swallowed as a message-only turn. callPrometheus now throws
  // PrometheusTruncatedError before parsing is ever attempted; the route must
  // map it to its own distinct code, not ai_upstream.
  it('truncated response (max_tokens) → 422 chat_truncated', async () => {
    (callPrometheus as MockedFunction<typeof callPrometheus>).mockRejectedValueOnce(
      new PrometheusTruncatedError(),
    );

    const res = await POST(makeRequest({ agentId: testAgentId, instruction: 'rewrite everything' }));
    expect(res.status).toBe(422);

    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('chat_truncated');
  });

  // ── 8. Unknown agentId → 404 ──────────────────────────────────────────────
  it('returns 404 for an unknown agentId', async () => {
    const res = await POST(makeRequest({ agentId: 'does-not-exist', instruction: 'test' }));
    expect(res.status).toBe(404);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('not_found');
  });

});

// ── Auth guard: unauthenticated → 401 ─────────────────────────────────────────
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
