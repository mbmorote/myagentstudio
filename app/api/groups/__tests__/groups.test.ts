/**
 * app/api/groups/__tests__/groups.test.ts
 *
 * Plan 03 Phase A, A.12 — Route-level tests for /api/groups and /api/groups/[id].
 *
 * Tests route handlers directly (imported and called as functions).
 * DB client replaced with in-memory test instance. No Anthropic calls.
 *
 * Assertions:
 *   - GET /api/groups      → list of groups
 *   - POST /api/groups     → creates group; 400 invalid body; 409 name_exists
 *   - DELETE /api/groups/[id] → 204; 404 on unknown id
 *   - POST /api/agents/[id]/groups   → 201 new; 200 idempotent; 404 agent/group not found
 *   - DELETE /api/agents/[id]/groups/[groupId] → 204; 404 if not found
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

// ── Imports after mock ─────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { CONFIG_DEFS } from '../../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../../lib/db/sectionDefsSeed.js';

import { GET as listGroupsGET, POST as createGroupPOST } from '../route.js';
import { DELETE as deleteGroupDELETE } from '../[id]/route.js';
import { POST as addMembershipPOST } from '../../agents/[id]/groups/route.js';
import { DELETE as removeMembershipDELETE } from '../../agents/[id]/groups/[groupId]/route.js';
import { POST as createAgentPOST } from '../../agents/route.js';

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

function makeParamsContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) } as { params: Promise<T> };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/groups', () => {
  it('returns an array (may be empty initially)', async () => {
    const response = await listGroupsGET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(Array.isArray(json)).toBe(true);
  });
});

describe('POST /api/groups', () => {
  it('creates a group and returns it', async () => {
    const request = new Request('http://localhost/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'route-test-group' }),
    });
    const response = await createGroupPOST(request);
    expect(response.status).toBe(201);
    const dto = await response.json() as { id: string; name: string; memberAgentIds: string[] };
    expect(dto.name).toBe('route-test-group');
    expect(dto.memberAgentIds).toEqual([]);
    expect(typeof dto.id).toBe('string');
  });

  it('returns 409 name_exists on duplicate name', async () => {
    await createGroupPOST(
      new Request('http://localhost/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'route-dup-group' }),
      }),
    );
    const response = await createGroupPOST(
      new Request('http://localhost/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'route-dup-group' }),
      }),
    );
    expect(response.status).toBe(409);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('name_exists');
  });

  it('returns 400 for missing name', async () => {
    const response = await createGroupPOST(
      new Request('http://localhost/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/groups/[id]', () => {
  it('deletes a group and returns 204', async () => {
    const createResponse = await createGroupPOST(
      new Request('http://localhost/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'route-del-group' }),
      }),
    );
    const { id } = await createResponse.json() as { id: string };

    const response = await deleteGroupDELETE(
      new Request(`http://localhost/api/groups/${id}`, { method: 'DELETE' }),
      makeParamsContext({ id }),
    );
    expect(response.status).toBe(204);
  });

  it('returns 404 for unknown group', async () => {
    const response = await deleteGroupDELETE(
      new Request('http://localhost/api/groups/no-such-group', { method: 'DELETE' }),
      makeParamsContext({ id: 'no-such-group' }),
    );
    expect(response.status).toBe(404);
  });
});

describe('POST /api/agents/[id]/groups (add membership)', () => {
  it('adds agent to group, returns 201 on new and 200 on repeat', async () => {
    // Create agent
    const agentRes = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'route-mem-agent', description: 'Membership route test' }),
      }),
    );
    const { id: agentId } = await agentRes.json() as { id: string };

    // Create group
    const groupRes = await createGroupPOST(
      new Request('http://localhost/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'route-mem-group' }),
      }),
    );
    const { id: groupId } = await groupRes.json() as { id: string };

    // First add → 201
    const r1 = await addMembershipPOST(
      new Request(`http://localhost/api/agents/${agentId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      }),
      makeParamsContext({ id: agentId }),
    );
    expect(r1.status).toBe(201);
    const j1 = await r1.json() as { ok: boolean };
    expect(j1.ok).toBe(true);

    // Second add (idempotent) → 200
    const r2 = await addMembershipPOST(
      new Request(`http://localhost/api/agents/${agentId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      }),
      makeParamsContext({ id: agentId }),
    );
    expect(r2.status).toBe(200);
  });

  it('returns 404 if agent does not exist', async () => {
    const groupRes = await createGroupPOST(
      new Request('http://localhost/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'route-404-agent-group' }),
      }),
    );
    const { id: groupId } = await groupRes.json() as { id: string };

    const response = await addMembershipPOST(
      new Request('http://localhost/api/agents/no-such-agent/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      }),
      makeParamsContext({ id: 'no-such-agent' }),
    );
    expect(response.status).toBe(404);
  });

  it('returns 404 if group does not exist', async () => {
    const agentRes = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'route-404-group-agent', description: 'no group' }),
      }),
    );
    const { id: agentId } = await agentRes.json() as { id: string };

    const response = await addMembershipPOST(
      new Request(`http://localhost/api/agents/${agentId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: 'no-such-group' }),
      }),
      makeParamsContext({ id: agentId }),
    );
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/agents/[id]/groups/[groupId] (remove membership)', () => {
  it('removes membership and returns 204', async () => {
    const agentRes = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'route-rem-mem-agent', description: 'remove mem' }),
      }),
    );
    const { id: agentId } = await agentRes.json() as { id: string };

    const groupRes = await createGroupPOST(
      new Request('http://localhost/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'route-rem-mem-group' }),
      }),
    );
    const { id: groupId } = await groupRes.json() as { id: string };

    // Add
    await addMembershipPOST(
      new Request(`http://localhost/api/agents/${agentId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      }),
      makeParamsContext({ id: agentId }),
    );

    // Remove
    const response = await removeMembershipDELETE(
      new Request(`http://localhost/api/agents/${agentId}/groups/${groupId}`, { method: 'DELETE' }),
      makeParamsContext({ id: agentId, groupId }),
    );
    expect(response.status).toBe(204);
  });

  it('returns 404 if membership does not exist', async () => {
    const response = await removeMembershipDELETE(
      new Request('http://localhost/api/agents/no-agent/groups/no-group', { method: 'DELETE' }),
      makeParamsContext({ id: 'no-agent', groupId: 'no-group' }),
    );
    expect(response.status).toBe(404);
  });
});

// ── Auth guard: unauthenticated → 401 (§10.2, §3.6) ─────────────────────────

describe('unauthenticated → 401', () => {
  it('GET /api/groups returns 401 when there is no session', async () => {
    currentSession = null;
    const res = await listGroupsGET();
    expect(res.status).toBe(401);
    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'user' };
  });
});
