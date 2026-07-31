/**
 * app/api/agents/__tests__/agents.test.ts
 *
 * Phase 4 §8 — Integration tests for the /api/agents CRUD routes.
 *
 * Tests route handlers directly (imported and called as functions).
 * DB client replaced with in-memory test instance. No Anthropic calls.
 *
 * Assertions per §8:
 *   - GET /api/agents      → list of agents
 *   - POST /api/agents     → creates agent with core sections; 409 on name collision
 *   - GET /api/agents/[id] → full AgentDTO; 404 on unknown id
 *   - PATCH /api/agents/[id] → updates name/description; 404; 409 name collision
 *   - DELETE /api/agents/[id] → deletes agent; SectionRevision rows retained; 404
 *   - PATCH /api/agents/[id]/sections/[sectionId] → content update; 409 version conflict
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock getSession — the single auth seam (§10.2) ────────────────────────────
import { BOOTSTRAP_USER_ID } from '../../../../lib/auth/constants.js';
let currentSession: { userId: string; email: string; role: 'admin' | 'user' } | null = {
  userId: BOOTSTRAP_USER_ID,
  email: 'bootstrap@example.test',
  role: 'user',
};

vi.mock('../../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// ── Imports after mock ─────────────────────────────────────────────────────────
import { eq } from 'drizzle-orm';
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { CONFIG_DEFS, SECTION_DEFS } from '../../../../lib/blueprint/catalog.js';
import { getAgentFull } from '../../../../lib/db/repository/agents.js';

// Route handlers under test
import { GET as listAgentsGET, POST as createAgentPOST } from '../route.js';
import { GET as getAgentGET, PATCH as patchAgentPATCH, DELETE as deleteAgentDELETE } from '../[id]/route.js';
import { PATCH as patchSectionPATCH } from '../[id]/sections/[sectionId]/route.js';
import { POST as addMembershipPOST } from '../[id]/groups/route.js';
import { POST as createGroupPOST } from '../../groups/route.js';

// ── Seed catalog tables ────────────────────────────────────────────────────────
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
});

// ── Helper to create a mock Next.js params context ────────────────────────────
// The type-cast is required because TypeScript infers Record<string,string>
// rather than the specific shape each route expects.
function makeParamsContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) } as { params: Promise<T> };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/agents', () => {
  it('returns a list (may be empty initially)', async () => {
    const response = await listAgentsGET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(Array.isArray(json)).toBe(true);
  });
});

describe('POST /api/agents', () => {
  it('creates a new agent with core sections seeded', async () => {
    const request = new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-crud', description: 'CRUD test agent' }),
    });

    const response = await createAgentPOST(request);
    expect(response.status).toBe(201);

    const dto = await response.json() as {
      id: string;
      name: string;
      description: string;
      sections: { sectionKey: string }[];
    };
    expect(dto.name).toBe('test-crud');
    expect(dto.description).toBe('CRUD test agent');
    // Core sections should be seeded (role, behavior, guardrails, output)
    const coreSectionKeys = dto.sections.map((s) => s.sectionKey);
    expect(coreSectionKeys).toContain('role');
    expect(coreSectionKeys).toContain('behavior');
    expect(coreSectionKeys).toContain('guardrails');
    expect(coreSectionKeys).toContain('output');
  });

  it('returns 409 name_exists on duplicate name', async () => {
    const body = JSON.stringify({ name: 'test-crud-409', description: 'First instance' });

    // First create
    await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    );

    // Second create with same name
    const response = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    );
    expect(response.status).toBe(409);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('name_exists');
  });

  it('returns 400 for missing required fields', async () => {
    const response = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'no-description' }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('GET /api/agents/[id]', () => {
  it('returns full AgentDTO for a known agent', async () => {
    // Create an agent first
    const createResponse = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-get-full', description: 'Get full test' }),
      }),
    );
    const { id } = await createResponse.json() as { id: string };

    const response = await getAgentGET(
      new Request(`http://localhost/api/agents/${id}`),
      makeParamsContext({ id }),
    );
    expect(response.status).toBe(200);
    const dto = await response.json() as {
      id: string;
      sections: unknown[];
      config: unknown[];
      validation: unknown;
    };
    expect(dto.id).toBe(id);
    expect(Array.isArray(dto.sections)).toBe(true);
    expect(Array.isArray(dto.config)).toBe(true);
    expect(dto.validation).toBeDefined();
  });

  it('returns 404 for unknown id', async () => {
    const response = await getAgentGET(
      new Request('http://localhost/api/agents/no-such-id'),
      makeParamsContext({ id: 'no-such-id' }),
    );
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/agents/[id]', () => {
  it('updates name and description', async () => {
    const createResponse = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-patch-agent', description: 'Before' }),
      }),
    );
    const { id } = await createResponse.json() as { id: string };

    const response = await patchAgentPATCH(
      new Request(`http://localhost/api/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'After patch' }),
      }),
      makeParamsContext({ id }),
    );
    expect(response.status).toBe(200);
    const dto = await response.json() as { description: string };
    expect(dto.description).toBe('After patch');
  });

  it('returns 404 for unknown id', async () => {
    const response = await patchAgentPATCH(
      new Request('http://localhost/api/agents/ghost', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Ghost' }),
      }),
      makeParamsContext({ id: 'ghost' }),
    );
    expect(response.status).toBe(404);
  });

  it('returns 409 on name collision', async () => {
    // Create two agents
    const r1 = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'patch-collision-a', description: 'A' }),
      }),
    );
    await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'patch-collision-b', description: 'B' }),
      }),
    );
    const { id } = await r1.json() as { id: string };

    // Try to rename A to B (collision)
    const response = await patchAgentPATCH(
      new Request(`http://localhost/api/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'patch-collision-b' }),
      }),
      makeParamsContext({ id }),
    );
    expect(response.status).toBe(409);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('name_exists');
  });
});

describe('DELETE /api/agents/[id]', () => {
  it('deletes agent and returns {ok:true}', async () => {
    const createResponse = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-delete-agent', description: 'Delete me' }),
      }),
    );
    const { id } = await createResponse.json() as { id: string };

    const response = await deleteAgentDELETE(
      new Request(`http://localhost/api/agents/${id}`, { method: 'DELETE' }),
      makeParamsContext({ id }),
    );
    expect(response.status).toBe(200);
    const json = await response.json() as { ok: boolean };
    expect(json.ok).toBe(true);

    // Agent should be gone
    const dto = getAgentFull(id, BOOTSTRAP_USER_ID);
    expect(dto).toBeNull();
  });

  it('retains SectionRevision rows after agent deletion (rule 4)', async () => {
    const createResponse = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-delete-revisions', description: 'Check revisions' }),
      }),
    );
    const { id, sections } = await createResponse.json() as {
      id: string;
      sections: { id: string }[];
    };
    const sectionIds = sections.map((s) => s.id);

    // Delete the agent
    await deleteAgentDELETE(
      new Request(`http://localhost/api/agents/${id}`, { method: 'DELETE' }),
      makeParamsContext({ id }),
    );

    // SectionRevision rows for each section should still exist (soft ref — rule 4)
    for (const sectionId of sectionIds) {
      const revisions = testDb
        .select()
        .from(schema.sectionRevision)
        .where(eq(schema.sectionRevision.sectionId, sectionId))
        .all();
      expect(revisions.length).toBeGreaterThan(0);
    }
  });

  it('returns 404 for unknown id', async () => {
    const response = await deleteAgentDELETE(
      new Request('http://localhost/api/agents/ghost', { method: 'DELETE' }),
      makeParamsContext({ id: 'ghost' }),
    );
    expect(response.status).toBe(404);
  });
});

// ── Plan 03 A.12: R3 regression + groupIds in listAgents ─────────────────────

describe('DELETE /api/agents/[id] — R3: membership rows deleted (Plan 03)', () => {
  it('deletes membership rows along with the agent (no orphan rows)', async () => {
    // Create agent
    const agentRes = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'r3-route-orphan-agent', description: 'R3 orphan test' }),
      }),
    );
    const { id: agentId } = await agentRes.json() as { id: string };

    // Create group
    const groupRes = await createGroupPOST(
      new Request('http://localhost/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'r3-route-orphan-group' }),
      }),
    );
    const { id: groupId } = await groupRes.json() as { id: string };

    // Add membership
    await addMembershipPOST(
      new Request(`http://localhost/api/agents/${agentId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      }),
      makeParamsContext({ id: agentId }),
    );

    // Verify membership exists
    const beforeRows = testDb
      .select()
      .from(schema.membership)
      .where(eq(schema.membership.agentId, agentId))
      .all();
    expect(beforeRows).toHaveLength(1);

    // Delete agent
    await deleteAgentDELETE(
      new Request(`http://localhost/api/agents/${agentId}`, { method: 'DELETE' }),
      makeParamsContext({ id: agentId }),
    );

    // Membership rows must be gone (no orphans)
    const afterRows = testDb
      .select()
      .from(schema.membership)
      .where(eq(schema.membership.agentId, agentId))
      .all();
    expect(afterRows).toHaveLength(0);
  });
});

describe('GET /api/agents — groupIds in lite DTO (Plan 03 A.3)', () => {
  it('includes groupIds for agents that have memberships', async () => {
    const agentRes = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'groupids-lite-agent', description: 'groupIds test' }),
      }),
    );
    const { id: agentId } = await agentRes.json() as { id: string };

    const groupRes = await createGroupPOST(
      new Request('http://localhost/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'groupids-lite-group' }),
      }),
    );
    const { id: groupId } = await groupRes.json() as { id: string };

    await addMembershipPOST(
      new Request(`http://localhost/api/agents/${agentId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      }),
      makeParamsContext({ id: agentId }),
    );

    const listRes = await listAgentsGET();
    const agents = await listRes.json() as { id: string; groupIds: string[] }[];
    const found = agents.find((a) => a.id === agentId);
    expect(found).toBeDefined();
    expect(found!.groupIds).toContain(groupId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/agents/[id]/sections/[sectionId]', () => {
  it('updates section content and returns new version', async () => {
    const createResponse = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-section-patch', description: 'Section patch test' }),
      }),
    );
    const dto = await createResponse.json() as {
      id: string;
      sections: { id: string; sectionKey: string; version: number }[];
    };
    const section = dto.sections.find((s) => s.sectionKey === 'role')!;

    const response = await patchSectionPATCH(
      new Request(
        `http://localhost/api/agents/${dto.id}/sections/${section.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Manually updated role.', expectedVersion: section.version }),
        },
      ),
      makeParamsContext({ id: dto.id, sectionId: section.id }),
    );
    expect(response.status).toBe(200);
    const result = await response.json() as { content: string; version: number };
    expect(result.content).toBe('Manually updated role.');
    expect(result.version).toBe(section.version + 1);
  });

  it('returns 409 version_conflict on stale expectedVersion', async () => {
    const createResponse = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-section-conflict', description: 'Conflict test' }),
      }),
    );
    const dto = await createResponse.json() as {
      id: string;
      sections: { id: string; sectionKey: string; version: number }[];
    };
    const section = dto.sections.find((s) => s.sectionKey === 'behavior')!;

    // Send with wrong expectedVersion
    const response = await patchSectionPATCH(
      new Request(
        `http://localhost/api/agents/${dto.id}/sections/${section.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Stale write.', expectedVersion: section.version + 99 }),
        },
      ),
      makeParamsContext({ id: dto.id, sectionId: section.id }),
    );
    expect(response.status).toBe(409);
    const json = await response.json() as { error: string; current: number };
    expect(json.error).toBe('version_conflict');
    expect(typeof json.current).toBe('number');
  });
});

// ── Auth guard: unauthenticated → 401 (§10.2, §3.6) ─────────────────────────

describe('unauthenticated → 401', () => {
  it('GET /api/agents returns 401 when there is no session', async () => {
    currentSession = null;
    const res = await listAgentsGET();
    expect(res.status).toBe(401);
    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'user' };
  });
});
