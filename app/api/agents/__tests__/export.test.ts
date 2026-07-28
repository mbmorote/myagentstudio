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

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Imports after mock ─────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { CONFIG_DEFS, SECTION_DEFS } from '../../../../lib/blueprint/catalog.js';

import { GET as exportGET } from '../[id]/export/route.js';
import { POST as createAgentPOST } from '../route.js';

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
