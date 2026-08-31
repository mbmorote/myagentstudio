/**
 * app/api/agents/__tests__/export.test.ts
 *
 * Plan 03 Phase A, A.12 — Route-level tests for GET /api/agents/[id]/export.
 *
 * Tests route handler directly. DB client replaced with in-memory test instance.
 *
 * Assertions:
 *   - GET /api/agents/[id]/export → 200 text/plain when agent exists
 *   - GET /api/agents/[id]/export → 404 when agent does not exist
 *   - The response body is valid markdown (starts with --- frontmatter)
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BOOTSTRAP_USER_ID } from '../../../../lib/auth/constants.js';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock getSession — the single auth seam (§10.2) ────────────────────────────
let currentSession: { userId: string; email: string; role: 'admin' | 'user' } | null = {
  userId: BOOTSTRAP_USER_ID,
  email: 'bootstrap@example.test',
  role: 'user',
};

vi.mock('../../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// ── Imports after mock ─────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { createTestUser } from '../../../../lib/db/__tests__/test-users.js';
import { CONFIG_DEFS } from '../../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../../lib/db/sectionDefsSeed.js';

import { GET as exportGET } from '../[id]/export/route.js';
import { POST as createAgentPOST } from '../route.js';
import { POST as sharesPOST } from '../[id]/shares/route.js';

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
describe('GET /api/agents/[id]/export', () => {
  it('returns 200 text/plain with markdown for a known agent', async () => {
    const createResponse = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'export-route-agent', description: 'Export route test' }),
      }),
    );
    const { id } = await createResponse.json() as { id: string };

    const response = await exportGET(
      new Request(`http://localhost/api/agents/${id}/export`),
      makeParamsContext({ id }),
    );

    expect(response.status).toBe(200);
    const contentType = response.headers.get('Content-Type') ?? '';
    expect(contentType).toContain('text/plain');

    const body = await response.text();
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(0);
    // Exported markdown should start with YAML frontmatter
    expect(body.startsWith('---')).toBe(true);
    // Must contain the agent name
    expect(body).toContain('name: export-route-agent');
  });

  it('returns 404 for unknown agent id', async () => {
    const response = await exportGET(
      new Request('http://localhost/api/agents/no-such-id/export'),
      makeParamsContext({ id: 'no-such-id' }),
    );
    expect(response.status).toBe(404);
  });

  it('does not write any AgentSnapshot rows (read-only — R11)', async () => {
    const createResponse = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'export-no-snap-agent', description: 'No snapshot' }),
      }),
    );
    const { id } = await createResponse.json() as { id: string };

    const snapshotsBefore = testDb
      .select()
      .from(schema.agentSnapshot)
      .all()
      .filter((s) => s.agentId === id);

    await exportGET(
      new Request(`http://localhost/api/agents/${id}/export`),
      makeParamsContext({ id }),
    );

    const snapshotsAfter = testDb
      .select()
      .from(schema.agentSnapshot)
      .all()
      .filter((s) => s.agentId === id);

    expect(snapshotsAfter.length).toBe(snapshotsBefore.length);
  });
});

// ── Plan 15 (D2 resolved): a share-holder may also export ──────────────────

describe('GET /api/agents/[id]/export — share-holder access (D2)', () => {
  it('a share-holder gets 200 text/plain, same content as the owner', async () => {
    const owner = createTestUser('user');
    currentSession = { userId: owner.id, email: owner.email, role: 'user' };
    const createRes = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `export-shared-${crypto.randomUUID()}`, description: 'D2 export test' }),
      }),
    );
    const { id } = (await createRes.json()) as { id: string };

    const recipient = createTestUser('user');
    await sharesPOST(
      new Request(`http://localhost/api/agents/${id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail: recipient.email }),
      }),
      makeParamsContext({ id }),
    );

    const ownerExport = await exportGET(new Request(`http://localhost/api/agents/${id}/export`), makeParamsContext({ id }));
    const ownerBody = await ownerExport.text();

    currentSession = { userId: recipient.id, email: recipient.email, role: 'user' };
    const sharedRes = await exportGET(new Request(`http://localhost/api/agents/${id}/export`), makeParamsContext({ id }));
    expect(sharedRes.status).toBe(200);
    expect(await sharedRes.text()).toBe(ownerBody);

    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'user' };
  });

  it('a stranger (no owner, no share) still gets 404', async () => {
    const owner = createTestUser('user');
    currentSession = { userId: owner.id, email: owner.email, role: 'user' };
    const createRes = await createAgentPOST(
      new Request('http://localhost/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `export-stranger-${crypto.randomUUID()}`, description: 'D2 export test' }),
      }),
    );
    const { id } = (await createRes.json()) as { id: string };

    const stranger = createTestUser('user');
    currentSession = { userId: stranger.id, email: stranger.email, role: 'user' };
    const res = await exportGET(new Request(`http://localhost/api/agents/${id}/export`), makeParamsContext({ id }));
    expect(res.status).toBe(404);

    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'user' };
  });
});

// ── Auth guard: unauthenticated → 401 (§10.2, §3.6) ─────────────────────────

describe('unauthenticated → 401', () => {
  it('GET /api/agents/[id]/export returns 401 when there is no session', async () => {
    currentSession = null;
    const res = await exportGET(
      new Request('http://localhost/api/agents/any-id/export'),
      makeParamsContext({ id: 'any-id' }),
    );
    expect(res.status).toBe(401);
    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'user' };
  });
});

