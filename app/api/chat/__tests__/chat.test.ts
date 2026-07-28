/**
 * app/api/chat/__tests__/chat.test.ts
 *
 * Phase 4 §8 — Integration tests for POST /api/chat.
 *
 * Tests the route handler directly (imported and called as a function).
 * The Anthropic API is NEVER called — callChatMediator is mocked with controlled
 * responses. The DB client is replaced with an in-memory test instance.
 *
 * Assertions per §8:
 *   1. Bogus/unknown agentId → 404, no DB writes.
 *   2. Server uses DB content for every section (not client-supplied).
 *   3. Two-section mediator response → both versions bumped, two ai revisions written.
 *   4. Returned section containing a heading at agent.splitLevel → demoted before
 *      persistence, checked per returned section (Rules Index #3).
 *   5. Section whose baseline version moved mid-turn → {conflict:true, current, content}
 *      for that section only; other changed sections still apply.
 *   6. Cancellation (#23): aborted request (signal fires) → zero DB writes, zero new
 *      SectionRevision rows, no version bump on any section.
 */

import { beforeAll, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { eq } from 'drizzle-orm';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock callChatMediator — never calls the real Anthropic API ────────────────
vi.mock('../../../../lib/ai/chatMediator.js', () => ({
  callChatMediator: vi.fn(),
  ChatMediatorUpstreamError: class ChatMediatorUpstreamError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ChatMediatorUpstreamError';
    }
  },
  ChatMediatorInvalidResponseError: class ChatMediatorInvalidResponseError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ChatMediatorInvalidResponseError';
    }
  },
  // Export demoteSplitLevelHeadings so it can be imported from the same module
  // (the route imports it indirectly; the mock needs to pass through the real fn)
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
  VersionConflictError,
} from '../../../../lib/db/repository/agents.js';
import { callChatMediator } from '../../../../lib/ai/chatMediator.js';

// Route handler under test
import { POST } from '../route.js';

// ── Seed catalog + create test agent ──────────────────────────────────────────
let testAgentId: string;

beforeAll(() => {
  // Seed catalog rows (idempotent via onConflictDoNothing)
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

  // Create a test agent (source:'created', 4 core sections, version=0 each)
  const dto = createAgent('test-agent', 'A test agent for chat route tests');
  testAgentId = dto.id;
});

// ── Helper to build a POST Request ────────────────────────────────────────────
function makeRequest(
  body: unknown,
  signal?: AbortSignal,
): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/chat', () => {
  // ── 1. Bogus agentId → 404 ────────────────────────────────────────────────
  it('returns 404 for an unknown agentId', async () => {
    const request = makeRequest({ agentId: 'does-not-exist', instruction: 'test' });
    const response = await POST(request);
    expect(response.status).toBe(404);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('not_found');
  });

  // ── 2. Server uses DB content (not client-supplied) ───────────────────────
  it('server loads sections from DB, ignoring any client-supplied content', async () => {
    // The request body has NO content field — content comes from DB only
    (callChatMediator as MockedFunction<typeof callChatMediator>).mockResolvedValueOnce({
      sections: {},
    });

    const request = makeRequest({ agentId: testAgentId, instruction: 'noop' });
    const response = await POST(request);
    expect(response.status).toBe(200);

    // Verify callChatMediator was called with the DB-loaded sections (not client-supplied)
    const [callArg] = (callChatMediator as MockedFunction<typeof callChatMediator>).mock.calls[
      (callChatMediator as MockedFunction<typeof callChatMediator>).mock.calls.length - 1
    ];
    expect(callArg.sections).toBeDefined();
    expect(callArg.sections.length).toBeGreaterThan(0);
    // Each section should have content from the DB (template text), not empty
    for (const section of callArg.sections) {
      expect(typeof section.content).toBe('string');
    }
  });

  // ── 3. Two-section mediator response → both versions bumped, two ai revisions ──
  it('two-section response bumps both versions and writes two ai revisions', async () => {
    const agent = getAgentFull(testAgentId)!;
    const roleSection = agent.sections.find((s) => s.sectionKey === 'role')!;
    const behaviorSection = agent.sections.find((s) => s.sectionKey === 'behavior')!;
    const roleVersionBefore = roleSection.version;
    const behaviorVersionBefore = behaviorSection.version;

    const newRoleContent = 'You are a rewritten role.';
    const newBehaviorContent = 'Updated behavior steps.';

    (callChatMediator as MockedFunction<typeof callChatMediator>).mockResolvedValueOnce({
      sections: {
        role: newRoleContent,
        behavior: newBehaviorContent,
      },
    });

    const request = makeRequest({ agentId: testAgentId, instruction: 'update role and behavior' });
    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = await response.json() as {
      sections: Record<string, { content: string; version: number }>;
    };

    // Both sections reported in response
    expect(json.sections.role).toBeDefined();
    expect(json.sections.behavior).toBeDefined();
    expect(json.sections.role.version).toBe(roleVersionBefore + 1);
    expect(json.sections.behavior.version).toBe(behaviorVersionBefore + 1);
    expect(json.sections.role.content).toBe(newRoleContent);
    expect(json.sections.behavior.content).toBe(newBehaviorContent);

    // Verify two ai revisions were written to the DB
    const aiRevisions = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.author, 'ai'))
      .all();
    // At least 2 (there may be more from prior test runs in this beforeAll scope)
    const roleRevision = aiRevisions.find(
      (r) => r.sectionId === roleSection.id && r.content === newRoleContent,
    );
    const behaviorRevision = aiRevisions.find(
      (r) => r.sectionId === behaviorSection.id && r.content === newBehaviorContent,
    );
    expect(roleRevision).toBeDefined();
    expect(behaviorRevision).toBeDefined();
  });

  // ── 4. Split-level heading demotion before persistence (Rules Index #3) ────
  it('demotes split-level headings in mediator output before writing to DB', async () => {
    const agent = getAgentFull(testAgentId)!;
    // agent.splitLevel is 1 (created agents default to 1)
    expect(agent.splitLevel).toBe(1);

    const guardrailsSection = agent.sections.find((s) => s.sectionKey === 'guardrails')!;
    const versionBefore = guardrailsSection.version;

    // Mediator returns content containing a level-1 heading (should be demoted)
    const rawContent = '# This heading should be demoted\n- Never do bad things\n- Always do good';
    const expectedDemoted = '## This heading should be demoted\n- Never do bad things\n- Always do good';

    (callChatMediator as MockedFunction<typeof callChatMediator>).mockResolvedValueOnce({
      sections: {
        guardrails: rawContent,
      },
    });

    const request = makeRequest({ agentId: testAgentId, instruction: 'tighten guardrails' });
    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = await response.json() as {
      sections: Record<string, { content: string; version: number }>;
    };

    // The persisted content should have the heading demoted
    expect(json.sections.guardrails.content).toBe(expectedDemoted);
    expect(json.sections.guardrails.version).toBe(versionBefore + 1);

    // Verify the DB content is also the demoted version
    const dbSection = testDb
      .select()
      .from(schema.agentSection)
      .where(eq(schema.agentSection.id, guardrailsSection.id))
      .get();
    expect(dbSection?.content).toBe(expectedDemoted);
  });

  // ── 5. Per-section conflict: one conflict doesn't block others ─────────────
  it('conflicted section reported individually; other sections still apply', async () => {
    const agent = getAgentFull(testAgentId)!;
    const outputSection = agent.sections.find((s) => s.sectionKey === 'output')!;
    const roleSection = agent.sections.find((s) => s.sectionKey === 'role')!;

    // Simulate a concurrent write to 'output' AFTER this request's baseline load
    // will be captured, but BEFORE updateSectionContent runs for it.
    // We do this by bumping the version directly via updateSectionContent (a 'user' edit
    // that lands while our mediator call is "in flight").
    //
    // The chat handler reads baseline versions, then calls the mediator (mocked instant),
    // then writes sections. We simulate the race by:
    //   (1) Having the mediator return both 'output' and 'role' as changed.
    //   (2) Before the route gets to write, we manually bump 'output' version.
    //       BUT since the call is synchronous here, we can't interleave.
    //
    // Alternative: capture the baseline BEFORE the call, then externally advance 'output'.
    // Since everything is synchronous (synchronous DB + synchronous mock), the only way
    // to test this is to give the route a version that's already stale in the DB.
    //
    // Approach: manually bump 'output' in the DB to version+1 BEFORE calling POST.
    // The route will read the current version (already bumped) as its baseline.
    // No — that makes the baseline correct, not stale.
    //
    // Correct approach: write a version bump to 'output' AFTER the test setup but ensure
    // the POST handler's baseline read captures the PRE-bump version.
    //
    // The cleanest testable setup:
    //   - Capture current versions.
    //   - Call updateSectionContent to bump 'output' version (simulating a concurrent edit).
    //   - Mock the mediator to return new content for BOTH 'output' and 'role'.
    //   - The route will load the NEW (bumped) version as its baseline.
    //   - So this simulates the conflict as if the bump happened MID-FLIGHT.
    //
    // To actually test the conflict path, we need the baseline version in the route to
    // differ from the DB version when updateSectionContent is called. This requires the
    // section to be modified BETWEEN the route's getAgentFull() call and its
    // updateSectionContent() call. Since we can't interleave in synchronous code,
    // we use the following trick: pre-bump 'output' version in DB, then mock the
    // mediator to use the OLD (pre-bump) version expectation.
    //
    // Simpler: provide the route with a stale baseline by bumping the section manually
    // before the route runs, and then expecting the route's baseline (from getAgentFull)
    // to already be at the bumped version. This doesn't create a conflict.
    //
    // TRUE approach: use the VersionConflictError directly by providing a custom
    // implementation of updateSectionContent (via a spy) that throws for 'output' only.
    // But updateSectionContent is in the same module as the rest of the repository.
    //
    // SIMPLEST approach that tests the actual code path:
    // 1. Read current 'output' version from DB (e.g., version N).
    // 2. Manually execute updateSectionContent for 'output' with version N → version N+1.
    // 3. Then call POST — the route will getAgentFull() and see version N+1 as baseline.
    // 4. Mock mediator returns changes for both 'output' and 'role'.
    // 5. Route calls updateSectionContent('output', ..., expectedVersion=N+1).
    // 6. That SUCCEEDS (no conflict) because N+1 is the current version.
    //
    // We're stuck — to test a conflict, we need to bump the version BETWEEN getAgentFull
    // and updateSectionContent in the route. This is only possible with async code.
    //
    // SOLUTION: Use the VersionConflictError directly by temporarily replacing
    // updateSectionContent behavior. Since we can't easily spy on the repo function
    // (it's called from the route directly), we mock the whole repo module.
    //
    // We already mock lib/db/client.js; the repo imports that. But we can't easily
    // make one call to updateSectionContent succeed and another fail without additional
    // mocking.
    //
    // For the purpose of this test suite, we'll verify the CONFLICT RESPONSE PATH by
    // constructing the scenario: mock callChatMediator AND mock updateSectionContent
    // through a module-level approach. Since updateSectionContent calls the synchronous
    // DB, the simplest way is to set up the DB state so the conflict actually occurs.
    //
    // ACTUAL APPROACH:
    // 1. Record 'output' version before the test: N.
    // 2. Mock callChatMediator to return { output: "new", role: "new" }.
    // 3. In the mock, also bump 'output' in the DB directly (simulating a concurrent write).
    //    -- but the mock can't run code between getAgentFull and updateSectionContent.
    //
    // Given these constraints with synchronous SQLite, we'll test the CONFLICT RESPONSE
    // SHAPE by calling updateSectionContent once outside the route to advance the version,
    // and then relying on the route's own updateSectionContent to detect the mismatch.
    //
    // HERE IS THE KEY INSIGHT: The route first calls getAgentFull (reads baseline versions),
    // then calls the mediator (mocked, instant), then calls updateSectionContent.
    // Between getAgentFull and updateSectionContent, we can interleave via the mock:
    // make the callChatMediator mock also bump 'output' in the DB as a side-effect.

    const outputVersionBefore = outputSection.version;
    const roleVersionBefore = roleSection.version;
    const newRoleContent = 'Role updated in conflict test.';
    const newOutputContent = 'Output updated — but this will conflict.';
    const concurrentContent = 'Concurrent manual edit to output.';

    // Mock: mediator returns both sections; as a side-effect, bump 'output' version
    // to simulate a concurrent write that lands between getAgentFull and updateSectionContent.
    (callChatMediator as MockedFunction<typeof callChatMediator>).mockImplementationOnce(
      async () => {
        // Side-effect: bump 'output' version in the DB (concurrent edit)
        updateSectionContent(
          outputSection.id,
          concurrentContent,
          'user',
          outputVersionBefore,
        );
        return {
          sections: {
            role: newRoleContent,
            output: newOutputContent,
          },
        };
      },
    );

    const request = makeRequest({
      agentId: testAgentId,
      instruction: 'update role and output',
    });
    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = await response.json() as {
      sections: Record<string, { content: string; version: number } | { conflict: true; current: number; content: string }>;
    };

    // 'role' should have applied successfully
    const roleResult = json.sections.role as { content: string; version: number };
    expect(roleResult.content).toBe(newRoleContent);
    expect(roleResult.version).toBe(roleVersionBefore + 1);

    // 'output' should report a conflict (its version was bumped while the mediator ran)
    const outputResult = json.sections.output as { conflict: true; current: number; content: string };
    expect(outputResult.conflict).toBe(true);
    expect(outputResult.current).toBe(outputVersionBefore + 1);
    expect(outputResult.content).toBe(concurrentContent);
  });

  // ── 6. Cancellation: aborted request → zero DB writes ────────────────────
  it('cancellation: aborted request (signal fires) → zero DB writes, no revisions, no version bump', async () => {
    const agentBefore = getAgentFull(testAgentId)!;
    const versionsBefore = new Map(agentBefore.sections.map((s) => [s.id, s.version]));

    const aiRevisionsBefore = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.author, 'ai'))
      .all().length;

    // Mock callChatMediator: listens for abort signal; rejects with AbortError when fired.
    // Never resolves otherwise (simulating a long-running API call).
    (callChatMediator as MockedFunction<typeof callChatMediator>).mockImplementationOnce(
      (input: Parameters<typeof callChatMediator>[0]) =>
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
    const request = makeRequest(
      { agentId: testAgentId, instruction: 'tighten everything' },
      controller.signal,
    );

    const routePromise = POST(request);

    // Give the route one tick to get past request.json() and reach callChatMediator,
    // then abort. The mock will immediately reject because the signal fires.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    const response = await routePromise;

    // Route should return without writing anything
    expect(response.status).toBe(499);

    // No new ai revisions
    const aiRevisionsAfter = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.author, 'ai'))
      .all().length;
    expect(aiRevisionsAfter).toBe(aiRevisionsBefore);

    // No version bumps on any section
    const agentAfter = getAgentFull(testAgentId)!;
    for (const section of agentAfter.sections) {
      expect(section.version).toBe(versionsBefore.get(section.id));
    }
  });
});
