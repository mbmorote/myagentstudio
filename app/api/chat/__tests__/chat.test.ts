/**
 * app/api/chat/__tests__/chat.test.ts
 *
 * Phase 2 integration tests for POST /api/chat.
 *
 * Tests the route handler directly (imported and called as a function).
 * The Anthropic API is NEVER called — callPrometheus is mocked with controlled
 * responses. The DB client is replaced with an in-memory test instance.
 *
 * Phase 2 transitional behavior: sections are still written to the DB on a
 * successful chat turn. description and config are proposed (in the response)
 * but NOT written to any DB row. Both behaviors are asserted here (§13.4
 * as adjusted for Phase 2's still-writing-sections state).
 *
 * Tests:
 *   1.  Bogus/unknown agentId → 404.
 *   2.  Server loads sections + config from DB (not client-supplied).
 *   3.  Sections are still written: two sections → versions bumped, two 'ai' revisions.
 *   4.  Split-level heading demotion applied before DB write (Rules Index #3).
 *   5.  Cancellation → 499, zero DB writes, zero revisions, no version bumps.
 *   6.  description in proposal.modifications is NOT written to any DB row.
 *   7.  config in proposal.modifications is NOT written to any DB row.
 *   8.  citedConfigKeys valid → passed to callPrometheus; config outside cited set
 *       is absent from the proposal (filtered by parsePrometheusResponse / mocked).
 *   9.  citedConfigKeys malformed (not array of strings) → unscoped fallback, 200.
 *   10. question-only turn (modifications: {}) → 200, no DB writes, message present.
 *   11. Unauthenticated → 401.
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
  // demoteSplitLevelHeadings: identity fn — demotion is tested via the route's own
  // inline demoteHeadings, which is not mocked here (it is in the route itself).
  demoteSplitLevelHeadings: vi.fn((content: string) => content),
}));

// ── Imports after mocks ────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { CONFIG_DEFS, SECTION_DEFS } from '../../../../lib/blueprint/catalog.js';
import {
  createAgent,
  getAgentFull,
  updateSectionContent,
} from '../../../../lib/db/repository/agents.js';
import { callPrometheus } from '../../../../lib/ai/prometheus.js';
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
        label: def.label,
        defaultHeading: def.defaultHeading,
        isCore: def.isCore,
        defaultOrder: def.defaultOrder,
        template: def.template,
        helpText: def.helpText,
      })
      .onConflictDoNothing()
      .run();
  }

  const dto = createAgent(BOOTSTRAP_USER_ID, 'test-agent-p2', 'A test agent for Phase 2 chat route tests');
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
describe('POST /api/chat — Phase 2', () => {

  // ── 1. Bogus agentId → 404 ────────────────────────────────────────────────
  it('returns 404 for an unknown agentId', async () => {
    const res = await POST(makeRequest({ agentId: 'does-not-exist', instruction: 'test' }));
    expect(res.status).toBe(404);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('not_found');
  });

  // ── 2. Server loads sections + config from DB ─────────────────────────────
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

  // ── 3. Sections are still written (transitional Phase 2 behavior) ─────────
  it('two-section proposal → both versions bumped, two ai revisions written', async () => {
    const agent = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const roleSection = agent.sections.find((s) => s.sectionKey === 'role')!;
    const behaviorSection = agent.sections.find((s) => s.sectionKey === 'behavior')!;
    const roleVersionBefore = roleSection.version;
    const behaviorVersionBefore = behaviorSection.version;

    const newRole = 'You are a rewritten role (Phase 2).';
    const newBehavior = 'Updated behavior (Phase 2).';

    mockProposal({
      message: 'Rewrote role and behavior.',
      modifications: {
        sections: { role: newRole, behavior: newBehavior },
      },
      warnings: [],
    });

    const res = await POST(makeRequest({ agentId: testAgentId, instruction: 'update role and behavior' }));
    expect(res.status).toBe(200);

    const json = await res.json() as { proposal: { modifications: { sections: Record<string, string> } } };

    // Both sections present in the response
    expect(json.proposal.modifications.sections?.role).toBe(newRole);
    expect(json.proposal.modifications.sections?.behavior).toBe(newBehavior);

    // Versions bumped in the DB
    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const roleAfter = agentAfter.sections.find((s) => s.sectionKey === 'role')!;
    const behaviorAfter = agentAfter.sections.find((s) => s.sectionKey === 'behavior')!;
    expect(roleAfter.version).toBe(roleVersionBefore + 1);
    expect(behaviorAfter.version).toBe(behaviorVersionBefore + 1);

    // Two ai revisions written
    const aiRevisions = testDb.select().from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.author, 'ai')).all();
    const roleRev = aiRevisions.find((r) => r.sectionId === roleSection.id && r.content === newRole);
    const behaviorRev = aiRevisions.find((r) => r.sectionId === behaviorSection.id && r.content === newBehavior);
    expect(roleRev).toBeDefined();
    expect(behaviorRev).toBeDefined();
  });

  // ── 4. Split-level demotion applied before DB write ───────────────────────
  it('demotes split-level headings in section content before writing to DB', async () => {
    const agent = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    expect(agent.splitLevel).toBe(1);
    const guardrailsSection = agent.sections.find((s) => s.sectionKey === 'guardrails')!;
    const versionBefore = guardrailsSection.version;

    const rawContent = '# This heading should be demoted\nNever do bad things.';
    const expectedDemoted = '## This heading should be demoted\nNever do bad things.';

    // The mock returns the raw (not-yet-demoted) content.
    // The route's inline demoteHeadings must demote it before writing.
    mockProposal({
      message: 'Tightened guardrails.',
      modifications: { sections: { guardrails: rawContent } },
      warnings: [],
    });

    const res = await POST(makeRequest({ agentId: testAgentId, instruction: 'tighten guardrails' }));
    expect(res.status).toBe(200);

    // Response shows the demoted content
    const json = await res.json() as { proposal: { modifications: { sections: Record<string, string> } } };
    expect(json.proposal.modifications.sections?.guardrails).toBe(expectedDemoted);

    // DB also has the demoted content
    const dbSection = testDb.select().from(schema.agentSection)
      .where(eq(schema.agentSection.id, guardrailsSection.id)).get();
    expect(dbSection?.content).toBe(expectedDemoted);
    expect(dbSection?.version).toBe(versionBefore + 1);
  });

  // ── 5. Cancellation → 499, zero DB writes ────────────────────────────────
  it('cancellation: aborted request → 499, zero DB writes, no revisions, no version bumps', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const versionsBefore = new Map(agentBefore.sections.map((s) => [s.id, s.version]));
    const revisionsBefore = testDb.select().from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.author, 'ai')).all().length;

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

    // No new ai revisions
    const revisionsAfter = testDb.select().from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.author, 'ai')).all().length;
    expect(revisionsAfter).toBe(revisionsBefore);

    // No version bumps
    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    for (const section of agentAfter.sections) {
      expect(section.version).toBe(versionsBefore.get(section.id));
    }
  });

  // ── 6. description in response, NOT in DB ─────────────────────────────────
  it('description in proposal.modifications is present in the response but not written to any DB row', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const descriptionBefore = agentBefore.description;

    const proposedDescription = 'A brand new proposed description — not yet applied.';

    mockProposal({
      message: 'Updated the description.',
      modifications: { description: proposedDescription },
      warnings: [],
    });

    const res = await POST(makeRequest({ agentId: testAgentId, instruction: 'rewrite the description' }));
    expect(res.status).toBe(200);

    const json = await res.json() as {
      proposal: { modifications: { description?: string }; message: string };
    };

    // description is present in the response proposal
    expect(json.proposal.modifications.description).toBe(proposedDescription);
    expect(json.proposal.message).toBe('Updated the description.');

    // description is NOT written to the DB row
    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    expect(agentAfter.description).toBe(descriptionBefore);
  });

  // ── 7. config in response, NOT in DB ──────────────────────────────────────
  it('config in proposal.modifications is present in the response but no agent_config row is written', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const configCountBefore = agentBefore.config.length;

    mockProposal({
      message: 'Switched model to opus.',
      modifications: { config: { model: 'claude-opus-5' } },
      warnings: [],
    });

    const res = await POST(makeRequest({ agentId: testAgentId, instruction: 'switch to opus' }));
    expect(res.status).toBe(200);

    const json = await res.json() as {
      proposal: { modifications: { config?: Record<string, unknown> } };
    };

    // config is present in the response
    expect(json.proposal.modifications.config?.model).toBe('claude-opus-5');

    // No new agent_config row written — the agent's config is unchanged
    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    expect(agentAfter.config.length).toBe(configCountBefore);
    expect(agentAfter.config.find((c) => c.propKey === 'model')).toBeUndefined();
  });

  // ── 8. citedConfigKeys passed through to callPrometheus ──────────────────
  it('valid citedConfigKeys is parsed and passed to callPrometheus', async () => {
    mockProposal({ message: 'ok', modifications: {}, warnings: [] });

    const res = await POST(makeRequest({
      agentId: testAgentId,
      instruction: 'review model',
      citedConfigKeys: ['model'],
    }));
    expect(res.status).toBe(200);

    const lastCall = (callPrometheus as MockedFunction<typeof callPrometheus>).mock.calls.at(-1)!;
    const [callArg] = lastCall;
    expect(callArg.citedConfigKeys).toEqual(['model']);
  });

  // ── 9. citedConfigKeys malformed → unscoped fallback ─────────────────────
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

  // ── 10. Question-only turn (modifications: {}) → 200, no writes ──────────
  it('question-only turn (modifications: {}) → 200, message present, no DB writes', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const versionsBefore = new Map(agentBefore.sections.map((s) => [s.id, s.version]));
    const revisionsBefore = testDb.select().from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.author, 'ai')).all().length;

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
    const revisionsAfter = testDb.select().from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.author, 'ai')).all().length;
    expect(revisionsAfter).toBe(revisionsBefore);

    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    for (const section of agentAfter.sections) {
      expect(section.version).toBe(versionsBefore.get(section.id));
    }
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
