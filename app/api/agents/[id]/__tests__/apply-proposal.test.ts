/**
 * app/api/agents/[id]/__tests__/apply-proposal.test.ts
 *
 * Integration tests for POST /api/agents/[id]/apply-proposal.
 *
 * Tests the route handler directly (imported and called as a function).
 * The Anthropic API is NEVER called — the apply route performs no LLM calls.
 * The DB client is replaced with an in-memory test instance.
 *
 * Tests (plans/08-prometheus-apply.md §10.2, in order given there):
 *   1.  CONFIG MERGE REGRESSION — apply one key; all other keys survive.
 *   2.  Config delete (null value removes the key; other keys untouched).
 *   3.  Config add (new key inserted; existing keys survive).
 *   4.  Section apply — content written, version bumped by 1, one ai revision.
 *   5.  Multi-part apply — description + 2 sections + 1 config in one call → all land.
 *   6.  Description-only apply does NOT touch agent_config rows at all.
 *   7.  Unknown sectionKey → skipped[], 200, other parts still applied.
 *   8.  `name` in payload → ignored, listed in skipped[], agent.name unchanged.
 *   9.  Split-level demotion applied at the apply route (not left to the caller).
 *   10. Cross-owner agent id → 404, zero writes.
 *   11. Unauthenticated → 401, zero writes.
 *   12. Malformed body (sections value is a number) → 400, zero writes.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { BOOTSTRAP_USER_ID } from '../../../../../lib/auth/constants.js';

// ── Mock getSession — the single auth seam ────────────────────────────────────
let currentSession: { userId: string; email: string; role: 'admin' | 'user' } | null = {
  userId: BOOTSTRAP_USER_ID,
  email: 'bootstrap@example.test',
  role: 'user',
};

vi.mock('../../../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mocks ────────────────────────────────────────────────────────
import * as schema from '../../../../../lib/db/schema.js';
import { testDb } from '../../../../../lib/db/__tests__/test-db.js';
import { CONFIG_DEFS, SECTION_DEFS } from '../../../../../lib/blueprint/catalog.js';
import { createAgent, getAgentFull } from '../../../../../lib/db/repository/agents.js';
import { createTestUser } from '../../../../../lib/db/__tests__/test-users.js';

// Route handler under test
import { POST } from '../apply-proposal/route.js';

// ── Seed catalog + create test agents ─────────────────────────────────────────
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

  const dto = createAgent(
    BOOTSTRAP_USER_ID,
    'apply-proposal-test-agent',
    'Test agent for apply-proposal route tests',
  );
  testAgentId = dto.id;
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/agents/test/apply-proposal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/**
 * Seeds agent_config rows directly for a given agent, replacing all existing rows.
 * Used so tests start from a known config state without going through the full
 * import pipeline.
 */
function seedConfig(agentId: string, entries: { propKey: string; value: unknown }[]): void {
  testDb.delete(schema.agentConfig).where(eq(schema.agentConfig.agentId, agentId)).run();
  if (entries.length > 0) {
    testDb
      .insert(schema.agentConfig)
      .values(entries.map((e) => ({ agentId, propKey: e.propKey, value: e.value })))
      .run();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/agents/[id]/apply-proposal', () => {

  // ── 1. CONFIG MERGE REGRESSION (the reason this file exists) ─────────────
  // Seed four config keys; apply only one modification; assert the other three survive.
  // If anyone ever passes modifications.config straight to updateAgent(), this test fails.
  it('config merge regression: applying one key leaves all other keys intact', async () => {
    seedConfig(testAgentId, [
      { propKey: 'model', value: 'claude-opus-4' },
      { propKey: 'tools', value: ['read_file'] },
      { propKey: 'subagent_type', value: 'general' },
      { propKey: 'color', value: 'blue' },
    ]);

    const res = await POST(
      makeRequest({ modifications: { config: { model: 'claude-opus-5' } } }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(200);

    const json = await res.json() as {
      agent: { config: { propKey: string; value: unknown }[] };
      applied: { configKeys: string[] };
    };

    // The modified key has the new value
    const modelEntry = json.agent.config.find((c) => c.propKey === 'model');
    expect(modelEntry?.value).toBe('claude-opus-5');

    // All three other keys still present with their original values
    const toolsEntry = json.agent.config.find((c) => c.propKey === 'tools');
    const subagentEntry = json.agent.config.find((c) => c.propKey === 'subagent_type');
    const colorEntry = json.agent.config.find((c) => c.propKey === 'color');
    expect(toolsEntry).toBeDefined();
    expect(subagentEntry?.value).toBe('general');
    expect(colorEntry?.value).toBe('blue');

    // applied.configKeys records the modified key
    expect(json.applied.configKeys).toContain('model');
  });

  // ── 2. Config delete ──────────────────────────────────────────────────────
  it('config delete: null value removes the key; other keys untouched', async () => {
    seedConfig(testAgentId, [
      { propKey: 'model', value: 'claude-opus-4' },
      { propKey: 'tools', value: ['read_file'] },
      { propKey: 'subagent_type', value: 'general' },
      { propKey: 'color', value: 'blue' },
    ]);

    const res = await POST(
      makeRequest({ modifications: { config: { tools: null } } }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(200);

    const json = await res.json() as {
      agent: { config: { propKey: string; value: unknown }[] };
      applied: { configKeys: string[] };
    };

    // tools is gone
    expect(json.agent.config.find((c) => c.propKey === 'tools')).toBeUndefined();

    // other three still present
    expect(json.agent.config.find((c) => c.propKey === 'model')).toBeDefined();
    expect(json.agent.config.find((c) => c.propKey === 'subagent_type')).toBeDefined();
    expect(json.agent.config.find((c) => c.propKey === 'color')).toBeDefined();

    // applied.configKeys includes the deleted key
    expect(json.applied.configKeys).toContain('tools');
  });

  // ── 3. Config add ─────────────────────────────────────────────────────────
  it('config add: new key inserted; existing keys survive', async () => {
    seedConfig(testAgentId, [
      { propKey: 'model', value: 'claude-opus-4' },
    ]);

    const res = await POST(
      makeRequest({ modifications: { config: { newKey: 'newValue' } } }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(200);

    const json = await res.json() as {
      agent: { config: { propKey: string; value: unknown }[] };
    };

    expect(json.agent.config.find((c) => c.propKey === 'newKey')?.value).toBe('newValue');
    expect(json.agent.config.find((c) => c.propKey === 'model')?.value).toBe('claude-opus-4');
  });

  // ── 4. Section apply ──────────────────────────────────────────────────────
  it('section apply: content written, version bumped by exactly 1, one ai revision', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const roleSection = agentBefore.sections.find((s) => s.sectionKey === 'role')!;
    const versionBefore = roleSection.version;

    const newContent = 'You are a highly skilled assistant.';

    const res = await POST(
      makeRequest({ modifications: { sections: { role: newContent } } }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(200);

    const json = await res.json() as {
      agent: { sections: { sectionKey: string; content: string; version: number }[] };
      applied: { sectionKeys: string[] };
    };

    // Section in response has new content and bumped version
    const roleInResponse = json.agent.sections.find((s) => s.sectionKey === 'role')!;
    expect(roleInResponse.content).toBe(newContent);
    expect(roleInResponse.version).toBe(versionBefore + 1);

    // applied.sectionKeys records the key
    expect(json.applied.sectionKeys).toContain('role');

    // One ai revision exists for this section with this exact content
    const allRevisions = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, roleSection.id))
      .all();
    const aiRevisions = allRevisions.filter(
      (r: typeof allRevisions[0]) => r.author === 'ai' && r.content === newContent,
    );
    expect(aiRevisions.length).toBe(1);
  });

  // ── 5. Multi-part apply ───────────────────────────────────────────────────
  it('multi-part apply: description + 2 sections + 1 config key all land', async () => {
    seedConfig(testAgentId, [
      { propKey: 'model', value: 'old-model' },
      { propKey: 'tools', value: ['read_file'] },
    ]);

    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const behaviorSection = agentBefore.sections.find((s) => s.sectionKey === 'behavior')!;
    const guardrailsSection = agentBefore.sections.find((s) => s.sectionKey === 'guardrails')!;

    const res = await POST(
      makeRequest({
        modifications: {
          description: 'Updated description via multi-part apply.',
          sections: {
            behavior: 'New behavior content.',
            guardrails: 'New guardrails content.',
          },
          config: { model: 'claude-opus-5' },
        },
      }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(200);

    const json = await res.json() as {
      agent: {
        description: string;
        sections: { sectionKey: string; content: string; version: number }[];
        config: { propKey: string; value: unknown }[];
      };
      applied: { description: boolean; sectionKeys: string[]; configKeys: string[] };
    };

    // All four parts applied
    expect(json.agent.description).toBe('Updated description via multi-part apply.');
    expect(json.agent.sections.find((s) => s.sectionKey === 'behavior')?.content).toBe('New behavior content.');
    expect(json.agent.sections.find((s) => s.sectionKey === 'guardrails')?.content).toBe('New guardrails content.');
    expect(json.agent.config.find((c) => c.propKey === 'model')?.value).toBe('claude-opus-5');

    // tools key survived (§3.4 merge)
    expect(json.agent.config.find((c) => c.propKey === 'tools')).toBeDefined();

    // applied reports all four
    expect(json.applied.description).toBe(true);
    expect(json.applied.sectionKeys).toContain('behavior');
    expect(json.applied.sectionKeys).toContain('guardrails');
    expect(json.applied.configKeys).toContain('model');

    // Verify DB directly
    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    expect(agentAfter.description).toBe('Updated description via multi-part apply.');
    expect(agentAfter.sections.find((s) => s.sectionKey === 'behavior')?.version)
      .toBe(behaviorSection.version + 1);
    expect(agentAfter.sections.find((s) => s.sectionKey === 'guardrails')?.version)
      .toBe(guardrailsSection.version + 1);
  });

  // ── 6. Description-only apply does NOT touch agent_config rows ────────────
  it('description-only apply does not touch agent_config rows (§3.4 "only pass config when present")', async () => {
    seedConfig(testAgentId, [
      { propKey: 'model', value: 'claude-opus-4' },
      { propKey: 'tools', value: ['read_file'] },
    ]);

    const configRowsBefore = testDb
      .select()
      .from(schema.agentConfig)
      .where(eq(schema.agentConfig.agentId, testAgentId))
      .all();

    const res = await POST(
      makeRequest({ modifications: { description: 'Description only — config must be untouched.' } }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(200);

    const configRowsAfter = testDb
      .select()
      .from(schema.agentConfig)
      .where(eq(schema.agentConfig.agentId, testAgentId))
      .all();

    // Exact same rows — no rewrite, no churn
    expect(configRowsAfter.length).toBe(configRowsBefore.length);
    for (const before of configRowsBefore) {
      const after = configRowsAfter.find(
        (r: typeof configRowsAfter[0]) => r.propKey === before.propKey,
      );
      expect(after).toBeDefined();
      expect(JSON.stringify(after?.value)).toBe(JSON.stringify(before.value));
    }
  });

  // ── 7. Unknown sectionKey → skipped[], other parts still applied ──────────
  it('unknown sectionKey is listed in skipped[]; other parts in the same call still apply', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const roleSection = agentBefore.sections.find((s) => s.sectionKey === 'role')!;
    const versionBefore = roleSection.version;

    const res = await POST(
      makeRequest({
        modifications: {
          sections: {
            ghost: 'This key does not exist.',
            role: 'Updated role after ghost skip.',
          },
        },
      }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(200);

    const json = await res.json() as {
      agent: { sections: { sectionKey: string; version: number }[] };
      applied: { sectionKeys: string[] };
      skipped: { part: string; key: string; reason: string }[];
    };

    // ghost is in skipped
    const ghostSkip = json.skipped.find((s) => s.key === 'ghost');
    expect(ghostSkip).toBeDefined();
    expect(ghostSkip?.reason).toBe('no_such_section');

    // role was still applied
    expect(json.applied.sectionKeys).toContain('role');
    const roleInResponse = json.agent.sections.find((s) => s.sectionKey === 'role')!;
    expect(roleInResponse.version).toBe(versionBefore + 1);
  });

  // ── 8. `name` in payload → skipped[], agent.name unchanged ───────────────
  it('name in modifications is dropped and listed in skipped[]; agent.name unchanged', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const nameBefore = agentBefore.name;

    const res = await POST(
      makeRequest({
        modifications: {
          name: 'Attempted rename via chat',
          description: 'This description change should still apply.',
        },
      }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(200);

    const json = await res.json() as {
      agent: { name: string };
      applied: { description: boolean };
      skipped: { part: string; key: string; reason: string }[];
    };

    // name unchanged
    expect(json.agent.name).toBe(nameBefore);

    // name is in skipped
    const nameSkip = json.skipped.find((s) => s.key === 'name');
    expect(nameSkip).toBeDefined();

    // description was still applied
    expect(json.applied.description).toBe(true);
  });

  // ── 9. Split-level demotion at the apply route (not left to the caller) ───
  it('apply route demotes split-level headings even when the payload contains them', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    expect(agentBefore.splitLevel).toBe(1); // default agents have splitLevel 1

    const rawContent = '# This heading should be demoted\nBody text.';
    const expectedDemoted = '## This heading should be demoted\nBody text.';

    const res = await POST(
      makeRequest({ modifications: { sections: { role: rawContent } } }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(200);

    const json = await res.json() as {
      agent: { sections: { sectionKey: string; content: string }[] };
    };

    // The response contains the demoted content
    const roleSection = json.agent.sections.find((s) => s.sectionKey === 'role');
    expect(roleSection?.content).toBe(expectedDemoted);

    // The DB also has the demoted content
    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    expect(agentAfter.sections.find((s) => s.sectionKey === 'role')?.content).toBe(expectedDemoted);
  });

  // ── 10. Cross-owner agent id → 404, zero writes ───────────────────────────
  it('cross-owner agent id yields 404, not 403, and zero writes', async () => {
    // Create a second user and an agent owned by them
    const otherUser = createTestUser();
    const otherAgent = createAgent(otherUser.id, 'other-users-agent', 'Not owned by bootstrap');

    const otherAgentBefore = getAgentFull(otherAgent.id, otherUser.id)!;
    const versionsBefore = new Map(
      otherAgentBefore.sections.map((s) => [s.id, s.version]),
    );
    const configCountBefore = testDb
      .select()
      .from(schema.agentConfig)
      .where(eq(schema.agentConfig.agentId, otherAgent.id))
      .all().length;

    // Bootstrap user tries to apply to another user's agent
    const res = await POST(
      makeRequest({
        modifications: {
          sections: { role: 'Attempting cross-owner write.' },
          config: { model: 'claude-opus-5' },
        },
      }),
      makeContext(otherAgent.id),
    );
    expect(res.status).toBe(404);

    const json = await res.json() as { error: string };
    expect(json.error).toBe('not_found');

    // Zero writes — versions unchanged, config unchanged
    const otherAgentAfter = getAgentFull(otherAgent.id, otherUser.id)!;
    for (const section of otherAgentAfter.sections) {
      expect(section.version).toBe(versionsBefore.get(section.id));
    }
    const configCountAfter = testDb
      .select()
      .from(schema.agentConfig)
      .where(eq(schema.agentConfig.agentId, otherAgent.id))
      .all().length;
    expect(configCountAfter).toBe(configCountBefore);
  });

  // ── 11. Unauthenticated → 401, zero writes ────────────────────────────────
  it('unauthenticated request → 401, zero writes', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const versionsBefore = new Map(agentBefore.sections.map((s) => [s.id, s.version]));

    currentSession = null;

    const res = await POST(
      makeRequest({ modifications: { sections: { role: 'Should not be written.' } } }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(401);

    // Restore session for subsequent tests
    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'user' };

    // Zero writes
    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    for (const section of agentAfter.sections) {
      expect(section.version).toBe(versionsBefore.get(section.id));
    }
  });

  // ── 12. Malformed body → 400, zero writes ─────────────────────────────────
  it('malformed body (sections value is a number) → 400, zero writes', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const versionsBefore = new Map(agentBefore.sections.map((s) => [s.id, s.version]));

    const res = await POST(
      makeRequest({
        modifications: {
          sections: { role: 42 }, // number is invalid — must be a string
        },
      }),
      makeContext(testAgentId),
    );
    expect(res.status).toBe(400);

    const json = await res.json() as { error: string; field: string };
    expect(json.error).toBe('invalid_body');
    expect(json.field).toBe('sections');

    // Zero writes
    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    for (const section of agentAfter.sections) {
      expect(section.version).toBe(versionsBefore.get(section.id));
    }
  });

});
