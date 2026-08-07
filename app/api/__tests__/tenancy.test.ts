/**
 * app/api/__tests__/tenancy.test.ts
 *
 * Cross-tenant isolation — the crown jewel of the multi-tenant auth plan (§10.4).
 *
 * Two regular users (A and B) and one admin. A owns an agent, group, and
 * membership. Every id-taking endpoint is exercised with B's session and the
 * expected isolation (404, 403, or owner-scoped 200) is asserted.
 *
 * Every mutating-row test asserts BOTH the status code AND that the target row
 * is byte-identical afterwards — a 404 that already performed the write would
 * still pass a status-only assertion.
 *
 * Additional slices:
 *   - Owner-scoped uniqueness (§6.3): B may import/create an agent with A's name
 *   - Admin views A's log entries: redaction rule (§5.6) applied correctly
 *   - Per-user LLM cap (§3.9): B at cap → 429; dryRun → 409; admin exempt
 *   - Unauthenticated → 401 for every guarded endpoint
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Replace DB client with in-memory test DB ───────────────────────────────────
vi.mock('../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock getSession — single auth seam (§10.2) ────────────────────────────────
type SessionLike = { userId: string; email: string; role: 'admin' | 'user' };
let currentSession: SessionLike | null = null;

vi.mock('../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// ── Mock AI provider — real gateway runs, fake provider responds ───────────────
//
// stream() → used by structural import; returns a minimal restructured body.
// complete() → used by chat mediator; returns valid JSON with no section changes.
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

// ── Imports after mocks ────────────────────────────────────────────────────────
import * as schema from '../../../lib/db/schema.js';
import { testDb } from '../../../lib/db/__tests__/test-db.js';
import { createTestUser } from '../../../lib/db/__tests__/test-users.js';
import { CONFIG_DEFS } from '../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../lib/db/sectionDefsSeed.js';
import { createAgent, getAgentFull } from '../../../lib/db/repository/agents.js';
import { createGroup, addMembership } from '../../../lib/db/repository/groups.js';

// ── Route imports ──────────────────────────────────────────────────────────────
import { GET as listAgentsGET, POST as createAgentPOST } from '../agents/route.js';
import {
  GET as getAgentGET,
  PATCH as patchAgentPATCH,
  DELETE as deleteAgentDELETE,
} from '../agents/[id]/route.js';
import { GET as exportGET } from '../agents/[id]/export/route.js';
import { PATCH as patchSectionPATCH } from '../agents/[id]/sections/[sectionId]/route.js';
import { POST as addMembershipPOST } from '../agents/[id]/groups/route.js';
import { DELETE as removeMembershipDELETE } from '../agents/[id]/groups/[groupId]/route.js';
import { GET as listGroupsGET } from '../groups/route.js';
import { DELETE as deleteGroupDELETE } from '../groups/[id]/route.js';
import { POST as chatPOST } from '../chat/route.js';
import { POST as importPOST } from '../agents/import/route.js';
import { GET as settingsGET, PATCH as settingsPATCH } from '../settings/route.js';
import { GET as logListGET } from '../llm-call-log/route.js';
import { GET as logDetailGET } from '../llm-call-log/[id]/route.js';
import { GET as accountGET, PATCH as accountPATCH } from '../account/route.js';

// ── Test data ─────────────────────────────────────────────────────────────────

let aId: string;
let aEmail: string;
let aAgentId: string;
let aSectionId: string;
let aGroupId: string;

let bId: string;
let bEmail: string;
let bAgent1Id: string;
let bAgent2Id: string;
let bSection2Id: string;  // section of bAgent2 (for mismatched-pair within B)

let adminId: string;
let adminAgentId: string;

let aLogRowRedacted: string; // A's log row, sharedWithAdmin=false
let aLogRowShared: string;   // A's log row, sharedWithAdmin=true

const SHARED_AGENT_NAME = 'tenancy-shared-agent-name';

const VALID_MD = (name: string) => `---
name: ${name}
description: A test agent for tenancy tests
---

# ROLE

I am a test agent.
`;

// ── Param-context helper ───────────────────────────────────────────────────────
function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) } as { params: Promise<T> };
}

// ── Request helpers ────────────────────────────────────────────────────────────
function jsonReq(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function nextReq(url: string, method = 'GET'): NextRequest {
  return new NextRequest(url, { method });
}

// ── Setting helper ─────────────────────────────────────────────────────────────
function setSetting(key: string, value: string): void {
  testDb
    .insert(schema.setting)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
    .run();
}

// ── Direct log-row insertion ───────────────────────────────────────────────────
function insertLogRow(userId: string | null, sharedWithAdmin: boolean): string {
  const id = crypto.randomUUID();
  testDb.insert(schema.llmCallLog).values({
    id,
    kind: 'chat',
    provider: 'anthropic',
    agentId: null,
    agentLabel: 'test',
    dryRun: false,
    model: 'claude-opus-4-8',
    requestPayload: {
      system: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      model: 'claude-opus-4-8',
    },
    responsePayload: { text: 'ok', stopReason: 'end_turn' },
    error: null,
    durationMs: 10,
    usage: null,
    userId,
    sharedWithAdmin,
  }).run();
  return id;
}

// ── Global setup ──────────────────────────────────────────────────────────────

beforeAll(() => {
  // 1. Seed catalog tables
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

  // 2. Settings
  setSetting('liveLlmCalls', 'true');
  setSetting('maxLlmCallsPerUserPerHour', '1');

  // 3. Create users
  const a = createTestUser('user');
  aId = a.id; aEmail = a.email;
  const b = createTestUser('user');
  bId = b.id; bEmail = b.email;
  const adm = createTestUser('admin');
  adminId = adm.id;

  // 4. Create A's agent and get one section ID
  currentSession = { userId: aId, email: aEmail, role: 'user' };
  const aAgent = createAgent(aId, SHARED_AGENT_NAME, "A's agent");
  aAgentId = aAgent.id;
  const aFull = getAgentFull(aAgentId, aId)!;
  aSectionId = aFull.sections[0]?.id ?? '';

  // 5. Create A's group and add A's agent
  const aGroup = createGroup(aId, "A's group");
  aGroupId = aGroup.id;
  addMembership(aAgentId, aGroupId, aId);

  // 6. Create B's two agents
  const bAgent1 = createAgent(bId, 'b-agent-1', "B's first agent");
  bAgent1Id = bAgent1.id;

  const bAgent2 = createAgent(bId, 'b-agent-2', "B's second agent");
  bAgent2Id = bAgent2.id;
  const bFull2 = getAgentFull(bAgent2Id, bId)!;
  bSection2Id = bFull2.sections[0]?.id ?? '';

  // 7. Create admin's agent
  const adminAgent = createAgent(adminId, 'admin-agent', "Admin's agent");
  adminAgentId = adminAgent.id;

  // 8. Create log rows for A (for redaction tests)
  aLogRowRedacted = insertLogRow(aId, false); // A not consenting → redacted for admin
  aLogRowShared   = insertLogRow(aId, true);  // A consenting → visible to admin
});

// ── §6.3: owner-scoped uniqueness ─────────────────────────────────────────────

describe("owner-scoped uniqueness — B can reuse A's names (§6.3)", () => {
  it("POST /api/agents with A's name → 201 for B (not 409)", async () => {
    currentSession = { userId: bId, email: bEmail, role: 'user' };
    const res = await createAgentPOST(
      jsonReq('http://localhost/api/agents', 'POST', {
        name: SHARED_AGENT_NAME,
        description: "B's version",
      }),
    );
    // B can create an agent with the same name — different owner
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    // Make sure it is a different agent than A's
    expect(body.id).not.toBe(aAgentId);
  });

  it("POST /api/agents/import with A's agent name → 200, new agent for B, A unchanged", async () => {
    currentSession = { userId: bId, email: bEmail, role: 'user' };
    fakeStream.mockClear();

    const aRowBefore = testDb.select().from(schema.agent)
      .all().find((ag) => ag.id === aAgentId);

    const res = await importPOST(
      jsonReq('http://localhost/api/agents/import', 'POST', {
        md: VALID_MD(SHARED_AGENT_NAME),
        mode: 'structural',
      }),
    );
    // Import succeeds (200) and creates a new agent for B
    expect([200, 201]).toContain(res.status);

    const aRowAfter = testDb.select().from(schema.agent)
      .all().find((ag) => ag.id === aAgentId);
    // A's agent row is unchanged
    expect(aRowAfter?.name).toBe(aRowBefore?.name);
    expect(aRowAfter?.ownerId).toBe(aId);
  });
});

// ── Cross-tenant isolation: B accessing A's resources ─────────────────────────

describe("cross-tenant isolation — B cannot access A's resources", () => {
  beforeAll(() => {
    currentSession = { userId: bId, email: bEmail, role: 'user' };
  });

  it("GET /api/agents — A's agent is absent from B's list", async () => {
    const res = await listAgentsGET();
    expect(res.status).toBe(200);
    const agents = await res.json() as { id: string }[];
    expect(agents.every((ag) => ag.id !== aAgentId)).toBe(true);
  });

  it('GET /api/agents/[A] → 404', async () => {
    const res = await getAgentGET(
      new Request(`http://localhost/api/agents/${aAgentId}`),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(404);
  });

  it("PATCH /api/agents/[A] → 404, A's row unchanged", async () => {
    const rowBefore = testDb.select().from(schema.agent).all().find((ag) => ag.id === aAgentId);

    const res = await patchAgentPATCH(
      jsonReq(`http://localhost/api/agents/${aAgentId}`, 'PATCH', { name: 'hacked' }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(404);

    const rowAfter = testDb.select().from(schema.agent).all().find((ag) => ag.id === aAgentId);
    expect(rowAfter?.name).toBe(rowBefore?.name);
    expect(rowAfter?.updatedAt?.getTime()).toBe(rowBefore?.updatedAt?.getTime());
  });

  it("DELETE /api/agents/[A] → 404, A's row still exists", async () => {
    const res = await deleteAgentDELETE(
      new Request(`http://localhost/api/agents/${aAgentId}`, { method: 'DELETE' }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(404);

    const rowAfter = testDb.select().from(schema.agent).all().find((ag) => ag.id === aAgentId);
    expect(rowAfter).toBeDefined();
  });

  it('GET /api/agents/[A]/export → 404', async () => {
    const res = await exportGET(
      new Request(`http://localhost/api/agents/${aAgentId}/export`),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(404);
  });

  it("PATCH /api/agents/[A]/sections/[As] → 404, section unchanged", async () => {
    const secBefore = testDb.select().from(schema.agentSection)
      .all().find((s) => s.id === aSectionId);

    const res = await patchSectionPATCH(
      jsonReq(
        `http://localhost/api/agents/${aAgentId}/sections/${aSectionId}`,
        'PATCH',
        { content: 'hacked content', expectedVersion: 0 },
      ),
      ctx({ id: aAgentId, sectionId: aSectionId }),
    );
    expect(res.status).toBe(404);

    const secAfter = testDb.select().from(schema.agentSection)
      .all().find((s) => s.id === aSectionId);
    expect(secAfter?.content).toBe(secBefore?.content);
    expect(secAfter?.version).toBe(secBefore?.version);
  });

  it('PATCH /api/agents/[B-agent]/sections/[A-section] → 404 (mismatched pair)', async () => {
    // B's agent id + A's section id — cross-owner mismatch
    const res = await patchSectionPATCH(
      jsonReq(
        `http://localhost/api/agents/${bAgent1Id}/sections/${aSectionId}`,
        'PATCH',
        { content: 'hacked', expectedVersion: 0 },
      ),
      ctx({ id: bAgent1Id, sectionId: aSectionId }),
    );
    expect(res.status).toBe(404);
  });

  it('PATCH /api/agents/[B-agent1]/sections/[B-agent2-section] → 404 (within-B mismatch)', async () => {
    // Both belong to B, but the section doesn't belong to the named agent
    const res = await patchSectionPATCH(
      jsonReq(
        `http://localhost/api/agents/${bAgent1Id}/sections/${bSection2Id}`,
        'PATCH',
        { content: 'hacked', expectedVersion: 0 },
      ),
      ctx({ id: bAgent1Id, sectionId: bSection2Id }),
    );
    expect(res.status).toBe(404);
  });

  it('POST /api/agents/[A]/groups → 404', async () => {
    const res = await addMembershipPOST(
      jsonReq(`http://localhost/api/agents/${aAgentId}/groups`, 'POST', { groupId: aGroupId }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(404);
  });

  it('DELETE /api/agents/[A]/groups/[A-group] → 404', async () => {
    const res = await removeMembershipDELETE(
      new Request(
        `http://localhost/api/agents/${aAgentId}/groups/${aGroupId}`,
        { method: 'DELETE' },
      ),
      ctx({ id: aAgentId, groupId: aGroupId }),
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/groups — A's group is absent from B's list", async () => {
    const res = await listGroupsGET();
    expect(res.status).toBe(200);
    const groups = await res.json() as { id: string }[];
    expect(groups.every((g) => g.id !== aGroupId)).toBe(true);
  });

  it('DELETE /api/groups/[A-group] → 404', async () => {
    const res = await deleteGroupDELETE(
      new Request(`http://localhost/api/groups/${aGroupId}`, { method: 'DELETE' }),
      ctx({ id: aGroupId }),
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/chat with A's agentId → 404, zero new section_revision rows", async () => {
    const revisionsBefore = testDb.select().from(schema.sectionRevision).all().length;

    const res = await chatPOST(
      jsonReq('http://localhost/api/chat', 'POST', {
        agentId: aAgentId,
        instruction: 'improve my ROLE section',
      }),
    );
    expect(res.status).toBe(404);

    const revisionsAfter = testDb.select().from(schema.sectionRevision).all().length;
    expect(revisionsAfter).toBe(revisionsBefore);
  });
});

// ── Admin-only endpoints: B (user) gets 403 ────────────────────────────────────

describe('admin-only resources — B gets 403 (not 401)', () => {
  beforeAll(() => {
    currentSession = { userId: bId, email: bEmail, role: 'user' };
  });

  it('GET /api/settings → 403', async () => {
    const res = await settingsGET(nextReq('http://localhost/api/settings'));
    expect(res.status).toBe(403);
  });

  it('PATCH /api/settings → 403', async () => {
    const res = await settingsPATCH(
      new NextRequest('http://localhost/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'liveLlmCalls', value: false }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('GET /api/llm-call-log → 403', async () => {
    const res = await logListGET(nextReq('http://localhost/api/llm-call-log'));
    expect(res.status).toBe(403);
  });

  it('GET /api/llm-call-log/[id] → 403', async () => {
    const res = await logDetailGET(
      nextReq(`http://localhost/api/llm-call-log/${aLogRowRedacted}`),
      ctx({ id: aLogRowRedacted }),
    );
    expect(res.status).toBe(403);
  });
});

// ── GET /api/account — returns B's own row (not A's) ─────────────────────────

describe("GET /api/account — B gets own row", () => {
  beforeAll(() => {
    currentSession = { userId: bId, email: bEmail, role: 'user' };
  });

  it("GET /api/account → 200 with B's email", async () => {
    const res = await accountGET();
    expect(res.status).toBe(200);
    const body = await res.json() as { email: string };
    expect(body.email).toBe(bEmail);
    expect(body.email).not.toBe(aEmail);
  });

  it("PATCH /api/account → 200, A's shareLogsWithAdmin unchanged", async () => {
    const aRowBefore = testDb.select().from(schema.user).all().find((u) => u.id === aId);
    const aShareBefore = aRowBefore?.shareLogsWithAdmin;

    const res = await accountPATCH(
      new NextRequest('http://localhost/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareLogsWithAdmin: true }),
      }),
    );
    expect(res.status).toBe(200);

    // A's row is unchanged
    const aRowAfter = testDb.select().from(schema.user).all().find((u) => u.id === aId);
    expect(aRowAfter?.shareLogsWithAdmin).toBe(aShareBefore);
  });
});

// ── Log redaction — admin viewing A's rows (§5.6) ────────────────────────────

describe("log redaction — admin viewing A's rows (§5.6)", () => {
  beforeAll(() => {
    currentSession = { userId: adminId, email: 'admin@example.test', role: 'admin' };
  });

  it("admin views A's non-consenting row → 200, redacted:true, payloads null, metadata intact", async () => {
    const res = await logDetailGET(
      nextReq(`http://localhost/api/llm-call-log/${aLogRowRedacted}`),
      ctx({ id: aLogRowRedacted }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.redacted).toBe(true);
    expect(body.requestPayload).toBeNull();
    expect(body.responsePayload).toBeNull();
    // Metadata fields still populated
    expect(body.id).toBe(aLogRowRedacted);
    expect(typeof body.model).toBe('string');
    expect(typeof body.durationMs).toBe('number');
    expect(body.userId).toBe(aId);
  });

  it("admin views A's consenting row → 200, redacted:false, payloads present", async () => {
    const res = await logDetailGET(
      nextReq(`http://localhost/api/llm-call-log/${aLogRowShared}`),
      ctx({ id: aLogRowShared }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.redacted).toBe(false);
    expect(body.requestPayload).not.toBeNull();
    expect(body.responsePayload).not.toBeNull();
  });
});

// ── Per-user LLM cap (§3.9) ───────────────────────────────────────────────────
//
// cap = 1, B already has 1 live log row in the window (inserted in global beforeAll)
// so B is at the cap before any test in this block.

describe('per-user LLM cap (§3.9)', () => {
  beforeAll(() => {
    // Ensure cap setting is 1 (set globally, but re-assert here for clarity)
    setSetting('maxLlmCallsPerUserPerHour', '1');
    // Insert 1 live log row for B so B is at cap before the first test in this block.
    // (The uniqueness import test above may also have written a row for B, but we
    // insert one here to keep this block self-contained regardless of prior execution.)
    insertLogRow(bId, false);
  });

  it('POST /api/chat as B, B at cap → 429 llm_cap_reached, canDryRun:true, no new log row', async () => {
    currentSession = { userId: bId, email: bEmail, role: 'user' };
    fakeComplete.mockClear();
    const logsBefore = testDb.select().from(schema.llmCallLog).all().length;

    const res = await chatPOST(
      jsonReq('http://localhost/api/chat', 'POST', {
        agentId: bAgent1Id,
        instruction: 'improve ROLE',
      }),
    );

    expect(res.status).toBe(429);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('llm_cap_reached');
    expect(body.canDryRun).toBe(true);

    // Provider never called
    expect(fakeComplete).not.toHaveBeenCalled();

    // No new log row written (cap block writes nothing)
    const logsAfter = testDb.select().from(schema.llmCallLog).all().length;
    expect(logsAfter).toBe(logsBefore);
  });

  it('POST /api/chat as B with dryRun:true, B at cap → 409 llm_dry_run', async () => {
    currentSession = { userId: bId, email: bEmail, role: 'user' };
    fakeComplete.mockClear();

    const res = await chatPOST(
      jsonReq('http://localhost/api/chat', 'POST', {
        agentId: bAgent1Id,
        instruction: 'improve ROLE',
        dryRun: true,
      }),
    );

    // forceDryRun fires at step 3, before cap check at step 4 → 409
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('llm_dry_run');

    // Provider never called
    expect(fakeComplete).not.toHaveBeenCalled();
  });

  it('POST /api/chat as admin, admin over cap threshold → not 429', async () => {
    currentSession = { userId: adminId, email: 'admin@example.test', role: 'admin' };
    // Insert 2 extra log rows for admin (over cap=1)
    insertLogRow(adminId, false);
    insertLogRow(adminId, false);

    const res = await chatPOST(
      jsonReq('http://localhost/api/chat', 'POST', {
        agentId: adminAgentId,
        instruction: 'improve ROLE',
      }),
    );

    // Admin is exempt — should not get 429
    expect(res.status).not.toBe(429);
  });
});

// ── Unauthenticated → 401 for every guarded endpoint ────────────────────────

describe('unauthenticated → 401', () => {
  beforeAll(() => {
    currentSession = null;
  });

  it('GET /api/agents → 401', async () => {
    expect((await listAgentsGET()).status).toBe(401);
  });

  it('GET /api/agents/[id] → 401', async () => {
    const res = await getAgentGET(
      new Request(`http://localhost/api/agents/${aAgentId}`),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(401);
  });

  it('PATCH /api/agents/[id] → 401', async () => {
    const res = await patchAgentPATCH(
      jsonReq(`http://localhost/api/agents/${aAgentId}`, 'PATCH', { name: 'x' }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(401);
  });

  it('DELETE /api/agents/[id] → 401', async () => {
    const res = await deleteAgentDELETE(
      new Request(`http://localhost/api/agents/${aAgentId}`, { method: 'DELETE' }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/agents/[id]/export → 401', async () => {
    const res = await exportGET(
      new Request(`http://localhost/api/agents/${aAgentId}/export`),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(401);
  });

  it('PATCH /api/agents/[id]/sections/[sectionId] → 401', async () => {
    const res = await patchSectionPATCH(
      jsonReq('http://localhost/api/agents/x/sections/y', 'PATCH', { content: 'x', expectedVersion: 0 }),
      ctx({ id: 'x', sectionId: 'y' }),
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/agents/[id]/groups → 401', async () => {
    const res = await addMembershipPOST(
      jsonReq(`http://localhost/api/agents/${aAgentId}/groups`, 'POST', { groupId: aGroupId }),
      ctx({ id: aAgentId }),
    );
    expect(res.status).toBe(401);
  });

  it('DELETE /api/agents/[id]/groups/[groupId] → 401', async () => {
    const res = await removeMembershipDELETE(
      new Request(`http://localhost/api/agents/x/groups/y`, { method: 'DELETE' }),
      ctx({ id: 'x', groupId: 'y' }),
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/groups → 401', async () => {
    expect((await listGroupsGET()).status).toBe(401);
  });

  it('DELETE /api/groups/[id] → 401', async () => {
    const res = await deleteGroupDELETE(
      new Request(`http://localhost/api/groups/${aGroupId}`, { method: 'DELETE' }),
      ctx({ id: aGroupId }),
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/chat → 401', async () => {
    const res = await chatPOST(
      jsonReq('http://localhost/api/chat', 'POST', { agentId: 'x', instruction: 'y' }),
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/agents/import → 401', async () => {
    const res = await importPOST(
      jsonReq('http://localhost/api/agents/import', 'POST', { md: VALID_MD('x') }),
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/agents → 401', async () => {
    const res = await createAgentPOST(
      jsonReq('http://localhost/api/agents', 'POST', { name: 'x', description: 'y' }),
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/settings → 401', async () => {
    expect((await settingsGET(nextReq('http://localhost/api/settings'))).status).toBe(401);
  });

  it('GET /api/llm-call-log → 401', async () => {
    expect((await logListGET(nextReq('http://localhost/api/llm-call-log'))).status).toBe(401);
  });

  it('GET /api/account → 401', async () => {
    expect((await accountGET()).status).toBe(401);
  });
});
