/**
 * app/api/agents/[id]/__tests__/sections.test.ts
 *
 * Integration tests for the manual add/remove section routes — the structured
 * view's "+"/"Remove" buttons (roadmap TODO item 1's non-chat half):
 *   POST   /api/agents/[id]/sections
 *   DELETE /api/agents/[id]/sections/[sectionId]
 *
 * No LLM involved on either path — these are pure DB writes gated by session auth.
 * Added 2026-08-11, at the user's request, alongside the chat-add fix — this pair
 * of routes had zero test coverage until now (only the underlying repository
 * functions, addSection/deleteSection, were tested in repo.test.ts).
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
import { CONFIG_DEFS } from '../../../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../../../lib/db/sectionDefsSeed.js';
import { createAgent, getAgentFull } from '../../../../../lib/db/repository/agents.js';
import { createTestUser } from '../../../../../lib/db/__tests__/test-users.js';

// Route handlers under test
import { POST as postSection } from '../sections/route.js';
import { DELETE as deleteSection } from '../sections/[sectionId]/route.js';

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

  const dto = createAgent(
    BOOTSTRAP_USER_ID,
    'manual-sections-test-agent',
    'Test agent for manual add/remove section route tests',
  );
  testAgentId = dto.id;
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/agents/test/sections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePostContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function makeDeleteContext(id: string, sectionId: string): { params: Promise<{ id: string; sectionId: string }> } {
  return { params: Promise.resolve({ id, sectionId }) };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/agents/[id]/sections', () => {
  it('adds a section with the given sectionKey/heading/content, appended in order', async () => {
    const res = await postSection(
      makePostRequest({ sectionKey: 'sources', heading: '# SOURCES', content: 'Reads local files.' }),
      makePostContext(testAgentId),
    );
    expect(res.status).toBe(201);

    const json = await res.json() as {
      agent: { sections: { sectionKey: string; heading: string | null; content: string }[] };
      sectionId: string;
    };

    expect(json.sectionId).toBeTruthy();
    const added = json.agent.sections.find((s) => s.sectionKey === 'sources');
    expect(added).toBeDefined();
    expect(added?.heading).toBe('# SOURCES');
    expect(added?.content).toBe('Reads local files.');

    // The revision is author:'user' — manual add, not chat.
    const revisions = testDb
      .select()
      .from(schema.sectionRevision)
      .where(eq(schema.sectionRevision.sectionId, json.sectionId))
      .all();
    expect(revisions.length).toBe(1);
    expect(revisions[0].author).toBe('user');
  });

  it('accepts a null heading (custom section with no heading yet)', async () => {
    const res = await postSection(
      makePostRequest({ sectionKey: 'custom', heading: null, content: '' }),
      makePostContext(testAgentId),
    );
    expect(res.status).toBe(201);
  });

  it('400s on a missing/invalid body', async () => {
    const res = await postSection(
      makePostRequest({ sectionKey: '', content: 'x' }),
      makePostContext(testAgentId),
    );
    expect(res.status).toBe(400);
  });

  it('404s for a cross-owner agent id', async () => {
    const otherUser = createTestUser();
    const otherAgent = createAgent(otherUser.id, 'other-owner-sections-agent', 'Not owned by bootstrap');

    const res = await postSection(
      makePostRequest({ sectionKey: 'sources', heading: '# SOURCES', content: 'x' }),
      makePostContext(otherAgent.id),
    );
    expect(res.status).toBe(404);
  });

  it('401s when unauthenticated', async () => {
    currentSession = null;
    const res = await postSection(
      makePostRequest({ sectionKey: 'sources', heading: '# SOURCES', content: 'x' }),
      makePostContext(testAgentId),
    );
    expect(res.status).toBe(401);
    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'user' };
  });
});

describe('DELETE /api/agents/[id]/sections/[sectionId]', () => {
  it('removes a non-core section', async () => {
    const added = await postSection(
      makePostRequest({ sectionKey: 'lifecycle', heading: '# LIFECYCLE', content: 'x' }),
      makePostContext(testAgentId),
    );
    const { sectionId } = await added.json() as { sectionId: string };

    const res = await deleteSection(new Request('http://localhost', { method: 'DELETE' }), makeDeleteContext(testAgentId, sectionId));
    expect(res.status).toBe(204);

    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    expect(agentAfter.sections.find((s) => s.id === sectionId)).toBeUndefined();
  });

  // Core sections are removable too (2026-08-11, at the user's explicit request —
  // an earlier pass had blocked this; see CHANGELOG.md and SectionBlock.tsx's
  // confirm-dialog wording, which calls out that it's core rather than refusing it).
  it('removes a core section — no isCore gate on this route', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const coreSection = agentBefore.sections.find((s) => s.def?.isCore)!;
    expect(coreSection).toBeDefined();

    const res = await deleteSection(new Request('http://localhost', { method: 'DELETE' }), makeDeleteContext(testAgentId, coreSection.id));
    expect(res.status).toBe(204);

    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    expect(agentAfter.sections.find((s) => s.id === coreSection.id)).toBeUndefined();
  });

  it('404s for a nonexistent sectionId', async () => {
    const res = await deleteSection(new Request('http://localhost', { method: 'DELETE' }), makeDeleteContext(testAgentId, 'not-a-real-section-id'));
    expect(res.status).toBe(404);
  });

  it('404s when the sectionId belongs to a different agent', async () => {
    const otherAgent = createAgent(BOOTSTRAP_USER_ID, 'cross-agent-section-agent', 'A different agent, same owner');
    const foreignSectionId = otherAgent.sections[0].id;

    const res = await deleteSection(new Request('http://localhost', { method: 'DELETE' }), makeDeleteContext(testAgentId, foreignSectionId));
    expect(res.status).toBe(404);

    // The section still exists on its real agent — nothing was deleted.
    const otherAgentAfter = getAgentFull(otherAgent.id, BOOTSTRAP_USER_ID)!;
    expect(otherAgentAfter.sections.find((s) => s.id === foreignSectionId)).toBeDefined();
  });

  it('401s when unauthenticated', async () => {
    const agentBefore = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    const anySection = agentBefore.sections[0];

    currentSession = null;
    const res = await deleteSection(new Request('http://localhost', { method: 'DELETE' }), makeDeleteContext(testAgentId, anySection.id));
    expect(res.status).toBe(401);
    currentSession = { userId: BOOTSTRAP_USER_ID, email: 'bootstrap@example.test', role: 'user' };

    const agentAfter = getAgentFull(testAgentId, BOOTSTRAP_USER_ID)!;
    expect(agentAfter.sections.find((s) => s.id === anySection.id)).toBeDefined();
  });
});
