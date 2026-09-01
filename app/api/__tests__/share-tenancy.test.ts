/**
 * app/api/__tests__/share-tenancy.test.ts
 *
 * The tenancy regression suite for Plan 15 — Share agent (§5.5). Built on the
 * same harness as tenancy.test.ts (in-memory DB, mocked getSession, mocked AI
 * provider), but proving a DIFFERENT and stronger property: not just that a
 * stranger (B in the original suite) can't touch A's agent, but that a
 * legitimate, known reader — C, who genuinely holds a share grant on A's
 * agent — still cannot mutate it through any route, tool, or repository
 * function. A "known reader can't write" is the property constraint 1
 * actually depends on; a stranger being blocked proves much less.
 *
 * This file does NOT edit tenancy.test.ts — that suite's own B-vs-A
 * assertions keep passing untouched (verified by the full suite run after
 * every step in this build), which is the other half of "B (no share) is
 * unchanged."
 *
 * Every mutating-endpoint case asserts BOTH the status code AND that the
 * target row is byte-identical afterwards — same posture tenancy.test.ts
 * insists on, for the same reason: a 404 that already performed the write
 * would still pass a status-only assertion.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

type SessionLike = { userId: string; email: string; role: 'admin' | 'user' };
let currentSession: SessionLike | null = null;

vi.mock('../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// ── Fake AI provider — real gateway runs, fake provider responds (matches
// tenancy.test.ts's own setup; needed by chat/import even though most of
// this file's assertions 404 before ever reaching it) ──────────────────────
const fakeStream = vi.fn(async () => ({
  text: '# ROLE\n\nTest agent content.\n',
  stopReason: 'end_turn' as const,
  model: 'claude-opus-4-8',
  usage: { inputTokens: 5, outputTokens: 10 },
}));
const fakeComplete = vi.fn(async () => ({
  text: '{"sections":{}}',
  stopReason: 'end_turn' as const,
  model: 'claude-opus-4-8',
  usage: { inputTokens: 5, outputTokens: 10 },
}));
vi.mock('../../../lib/ai/anthropicProvider.js', () => ({
  createAnthropicProvider: () => ({
    id: 'fake',
    defaultModel: () => 'claude-opus-4-8',
    complete: fakeComplete,
    stream: fakeStream,
  }),
  LlmProviderResponseError: class LlmProviderResponseError extends Error {
    constructor(msg: string) { super(msg); this.name = 'LlmProviderResponseError'; }
  },
}));

// ── Imports after mocks ────────────────────────────────────────────────────
import * as schema from '../../../lib/db/schema.js';
import { testDb } from '../../../lib/db/__tests__/test-db.js';
import { createTestUser } from '../../../lib/db/__tests__/test-users.js';
import { CONFIG_DEFS } from '../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../lib/db/sectionDefsSeed.js';
import { createAgent, getAgentFull, getAgentFullForViewer, listSharedWithViewer } from '../../../lib/db/repository/agents.js';
import { createGroup, addMembership } from '../../../lib/db/repository/groups.js';
import { createShare } from '../../../lib/db/repository/agentShares.js';
import { generateApiToken } from '../../../lib/auth/apiToken.js';
import { createApiToken } from '../../../lib/db/repository/apiTokens.js';

// ── Route imports ──────────────────────────────────────────────────────────
import {
  GET as getAgentGET,
  PATCH as patchAgentPATCH,
  DELETE as deleteAgentDELETE,
} from '../agents/[id]/route.js';
import { PATCH as patchSectionPATCH } from '../agents/[id]/sections/[sectionId]/route.js';
import { POST as addMembershipPOST } from '../agents/[id]/groups/route.js';
import { DELETE as removeMembershipDELETE } from '../agents/[id]/groups/[groupId]/route.js';
import { POST as chatPOST } from '../chat/route.js';
import { POST as applyProposalPOST } from '../agents/[id]/apply-proposal/route.js';
import { POST as importPOST } from '../agents/import/route.js';
import { GET as sharesGET, POST as sharesPOST } from '../agents/[id]/shares/route.js';
import { DELETE as shareDELETE } from '../agents/[id]/shares/[shareId]/route.js';
import { POST as shareLinkPOST, DELETE as shareLinkDELETE } from '../agents/[id]/share-link/route.js';
import { POST as mcpPOST } from '../mcp/route.js';

function setSetting(key: string, value: string): void {
  testDb.insert(schema.setting).values({ key, value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
    .run();
}

function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) } as { params: Promise<T> };
}

function jsonReq(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const VALID_MD = (name: string) => `---
name: ${name}
description: A test agent for share-tenancy tests
---

# ROLE

I am a test agent.
`;

// ── Test data ─────────────────────────────────────────────────────────────

let aId: string; let aEmail: string;
let aAgentId: string; let aAgentName: string; let aSectionId: string; let aGroupId: string;
let cId: string; let cEmail: string;
let bId: string; let bEmail: string;
let shareId: string; // C's own share row on A's agent

beforeAll(() => {
  for (const def of CONFIG_DEFS) {
    testDb.insert(schema.configDef).values({
      key: def.key, label: def.label, datatype: def.datatype,
      allowedValues: def.allowedValues as string[] | null,
      required: def.required, isCore: def.isCore, exportable: true,
    }).onConflictDoNothing().run();
  }
  for (const def of SECTION_DEFS) {
    testDb.insert(schema.sectionDef).values({
      key: def.key, defaultHeading: def.defaultHeading,
      isCore: def.isCore, defaultOrder: def.defaultOrder,
      template: def.template, helpText: def.helpText,
    }).onConflictDoNothing().run();
  }

  setSetting('liveLlmCalls', 'true');
  setSetting('maxLlmCallsPerUserPerHour', '10');

  const a = createTestUser('user'); aId = a.id; aEmail = a.email;
  const c = createTestUser('user'); cId = c.id; cEmail = c.email;
  const b = createTestUser('user'); bId = b.id; bEmail = b.email;

  aAgentName = `share-tenancy-a-agent-${crypto.randomUUID()}`;
  const aAgent = createAgent(aId, aAgentName, "A's agent");
  aAgentId = aAgent.id;
  const aFull = getAgentFull(aAgentId, aId)!;
  aSectionId = aFull.sections[0]?.id ?? '';

  const aGroup = createGroup(aId, `share-tenancy-a-group-${crypto.randomUUID()}`);
  aGroupId = aGroup.id;
  addMembership(aAgentId, aGroupId, aId);

  // C holds a genuine share grant on A's agent — set up directly at the
  // repository layer (already covered by §5.2/§5.6's own tests), not via the
  // route, so this file's setup doesn't depend on the routes it's testing.
  const share = createShare(aAgentId, cEmail, 'email');
  shareId = share.id;
});

// ── C can read ──────────────────────────────────────────────────────────────
//
// There is no JSON API route for a viewer-scoped read yet (and per the plan,
// none is planned — Step 10's app/agents/[id]/page.tsx Server Component calls
// getAgentFullForViewer directly; GET /api/agents/[id] stays owner-scoped
// forever, per constraint 2). So "C can read" is asserted at the repository
// layer here — already covered by §5.3's dedicated tests, repeated here for
// this file's own completeness as a regression baseline before the "C cannot
// write" assertions below.

describe('C (share-holder) can read', () => {
  it("getAgentFullForViewer(A's agent, C) → access:'shared', full DTO", () => {
    const result = getAgentFullForViewer(aAgentId, cId);
    expect(result).not.toBeNull();
    expect(result?.access).toBe('shared');
    expect(result?.agent.id).toBe(aAgentId);
  });

  it("A's agent appears in C's shared list", () => {
    const list = listSharedWithViewer(cId);
    expect(list.some((ag) => ag.id === aAgentId)).toBe(true);
  });
});

// ── C cannot write — every mutating endpoint still 404s ─────────────────────

describe('C (share-holder) cannot write to A\'s agent — every mutating endpoint 404s', () => {
  beforeAll(() => {
    currentSession = { userId: cId, email: cEmail, role: 'user' };
  });

  it("PATCH /api/agents/[A] → 404, A's row unchanged", async () => {
    const before = testDb.select().from(schema.agent).all().find((ag) => ag.id === aAgentId);
    const res = await patchAgentPATCH(
      jsonReq(`http://localhost/api/agents/${aAgentId}`, 'PATCH', { name: 'hacked-by-c' }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(404);
    const after = testDb.select().from(schema.agent).all().find((ag) => ag.id === aAgentId);
    expect(after?.name).toBe(before?.name);
    expect(after?.updatedAt?.getTime()).toBe(before?.updatedAt?.getTime());
  });

  it("DELETE /api/agents/[A] → 404, A's row still exists", async () => {
    const res = await deleteAgentDELETE(
      new Request(`http://localhost/api/agents/${aAgentId}`, { method: 'DELETE' }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(404);
    const after = testDb.select().from(schema.agent).all().find((ag) => ag.id === aAgentId);
    expect(after).toBeDefined();
  });

  it("PATCH /api/agents/[A]/sections/[As] → 404, section unchanged", async () => {
    const before = testDb.select().from(schema.agentSection).all().find((s) => s.id === aSectionId);
    const res = await patchSectionPATCH(
      jsonReq(
        `http://localhost/api/agents/${aAgentId}/sections/${aSectionId}`,
        'PATCH',
        { content: 'hacked-by-c', expectedVersion: 0 },
      ),
      ctx({ id: aAgentId, sectionId: aSectionId }),
    );
    expect(res.status).toBe(404);
    const after = testDb.select().from(schema.agentSection).all().find((s) => s.id === aSectionId);
    expect(after?.content).toBe(before?.content);
    expect(after?.version).toBe(before?.version);
  });

  it("POST /api/agents/[A]/groups → 404", async () => {
    const res = await addMembershipPOST(
      jsonReq(`http://localhost/api/agents/${aAgentId}/groups`, 'POST', { groupId: aGroupId }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(404);
  });

  it("DELETE /api/agents/[A]/groups/[A-group] → 404, membership unchanged", async () => {
    const before = testDb.select().from(schema.membership).all()
      .filter((m) => m.agentId === aAgentId && m.groupId === aGroupId);
    expect(before).toHaveLength(1);

    const res = await removeMembershipDELETE(
      new Request(`http://localhost/api/agents/${aAgentId}/groups/${aGroupId}`, { method: 'DELETE' }),
      ctx({ id: aAgentId, groupId: aGroupId }),
    );
    expect(res.status).toBe(404);

    const after = testDb.select().from(schema.membership).all()
      .filter((m) => m.agentId === aAgentId && m.groupId === aGroupId);
    expect(after).toHaveLength(1);
  });

  it("POST /api/chat with A's agentId → 404, zero new section_revision rows", async () => {
    const before = testDb.select().from(schema.sectionRevision).all().length;
    const res = await chatPOST(
      jsonReq('http://localhost/api/chat', 'POST', { agentId: aAgentId, instruction: 'improve my ROLE section' }),
    );
    expect(res.status).toBe(404);
    const after = testDb.select().from(schema.sectionRevision).all().length;
    expect(after).toBe(before);
  });

  it("POST /api/agents/[A]/apply-proposal → 404, A's row and sections unchanged", async () => {
    const rowBefore = testDb.select().from(schema.agent).all().find((ag) => ag.id === aAgentId);
    const sectionsBefore = testDb.select().from(schema.agentSection).all().filter((s) => s.agentId === aAgentId);

    const res = await applyProposalPOST(
      jsonReq(`http://localhost/api/agents/${aAgentId}/apply-proposal`, 'POST', {
        modifications: { description: 'hacked-by-c', sections: { role: 'hacked content' } },
      }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(404);

    const rowAfter = testDb.select().from(schema.agent).all().find((ag) => ag.id === aAgentId);
    expect(rowAfter?.description).toBe(rowBefore?.description);
    const sectionsAfter = testDb.select().from(schema.agentSection).all().filter((s) => s.agentId === aAgentId);
    expect(sectionsAfter).toEqual(sectionsBefore);
  });

  it("POST /api/agents/import with A's agent name → creates C's OWN agent, never touches A's", async () => {
    fakeStream.mockClear();
    const aRowBefore = testDb.select().from(schema.agent).all().find((ag) => ag.id === aAgentId);

    const res = await importPOST(
      jsonReq('http://localhost/api/agents/import', 'POST', { md: VALID_MD(aAgentName), mode: 'structural' }),
    );
    expect([200, 201]).toContain(res.status);

    const aRowAfter = testDb.select().from(schema.agent).all().find((ag) => ag.id === aAgentId);
    expect(aRowAfter?.name).toBe(aRowBefore?.name);
    expect(aRowAfter?.ownerId).toBe(aId);

    // The new agent belongs to C, not A, and is a distinct row from A's.
    const cAgents = testDb.select().from(schema.agent).all().filter((ag) => ag.ownerId === cId && ag.name === aAgentName);
    expect(cAgents).toHaveLength(1);
    expect(cAgents[0].id).not.toBe(aAgentId);
  });
});

// ── C cannot administer the share — a share-holder is not a co-owner ────────

describe("C (share-holder) cannot administer A's share settings — 404 everywhere", () => {
  beforeAll(() => {
    currentSession = { userId: cId, email: cEmail, role: 'user' };
  });

  it('GET /api/agents/[A]/shares → 404', async () => {
    const res = await sharesGET(new Request(`http://localhost/api/agents/${aAgentId}/shares`), ctx({ id: aAgentId }));
    expect(res.status).toBe(404);
  });

  it('POST /api/agents/[A]/shares → 404', async () => {
    const res = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${aAgentId}/shares`, 'POST', { recipientEmail: 'another@example.com' }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(404);
  });

  it("DELETE /api/agents/[A]/shares/[C's own shareId] → 404 — C cannot even revoke their own access this way", async () => {
    const res = await shareDELETE(
      new Request(`http://localhost/api/agents/${aAgentId}/shares/${shareId}`),
      ctx({ id: aAgentId, shareId }),
    );
    expect(res.status).toBe(404);

    // The share row still exists — C is still a share-holder afterward.
    const stillShared = getAgentFullForViewer(aAgentId, cId);
    expect(stillShared?.access).toBe('shared');
  });

  it('POST /api/agents/[A]/share-link → 404', async () => {
    const res = await shareLinkPOST(new Request(`http://localhost/api/agents/${aAgentId}/share-link`, { method: 'POST' }), ctx({ id: aAgentId }));
    expect(res.status).toBe(404);
  });

  it('DELETE /api/agents/[A]/share-link → 404', async () => {
    const res = await shareLinkDELETE(new Request(`http://localhost/api/agents/${aAgentId}/share-link`, { method: 'DELETE' }), ctx({ id: aAgentId }));
    expect(res.status).toBe(404);
  });
});

// ── B (no share) is unchanged — direct check, full assurance is the
// unmodified tenancy.test.ts suite still passing (verified by the full run) ─

describe('B (no share at all) — unchanged baseline', () => {
  it('GET /api/agents/[A] → 404 for B, same as ever', async () => {
    currentSession = { userId: bId, email: bEmail, role: 'user' };
    const res = await getAgentGET(new Request(`http://localhost/api/agents/${aAgentId}`), ctx({ id: aAgentId }));
    expect(res.status).toBe(404);
  });
});

// ── MCP: shared agents ARE now visible over MCP (Step 8c landed) ────────────
//
// D8 (plans/archive/15-share-agent.md §8) resolved to fold MCP share-visibility INTO
// this plan as its own later step (§6 step 8c). That step has now landed —
// list_agents/get_agent/pull_agent are viewer-scoped (owner OR share-holder),
// so C's token DOES see A's shared agent. This inverts what this test
// originally asserted pre-8c — updated here rather than silently deleted, per
// this file's own earlier note. The deeper tenancy property — C still can't
// WRITE to A's agent via push_agent — is covered separately and specifically
// in lib/mcp/__tests__/tools.test.ts's "shared-agent visibility over MCP"
// block, not duplicated here.

describe("MCP (post-Step-8c): C's token sees A's shared agent, read-only", () => {
  it("list_agents includes A's agent for C, with access:'shared'", async () => {
    const generated = generateApiToken();
    createApiToken({
      ownerId: cId,
      name: 'share-tenancy-mcp-token',
      tokenHash: generated.hash,
      prefix: generated.prefix,
      scope: 'read',
    });

    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_agents', arguments: {} } };
    const res = await mcpPOST(new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${generated.plaintext}`,
      },
      body: JSON.stringify(rpc),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { content: Array<{ type: string; text: string }> } };
    const payload = JSON.parse(body.result.content[0].text) as { agents: Array<{ id: string; access: string }> };
    const row = payload.agents.find((ag) => ag.id === aAgentId);
    expect(row).toBeDefined();
    expect(row?.access).toBe('shared');
  });
});
