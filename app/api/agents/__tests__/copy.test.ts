/**
 * app/api/agents/__tests__/copy.test.ts
 *
 * Route-level tests for POST /api/agents/[id]/copy (Plan 15 §5.6, Step 6).
 *
 * Covers:
 *   - 201 with the new AgentDTO (source:'copied') for an owner and for a
 *     share-holder
 *   - 409 name_exists on a collision with the copier's own agent
 *   - 404 for a stranger with no access to the source
 *   - unauthenticated → 401
 *   - the fake AI provider's call count is 0 across the whole suite (§4.6/§4.10:
 *     zero provider calls on this path — the cheapest possible proof, and the
 *     one that would catch a future refactor routing copy through import
 *     "for consistency")
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

type SessionLike = { userId: string; email: string; role: 'admin' | 'user' };
let currentSession: SessionLike | null = null;

vi.mock('../../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// ── Fake AI provider — asserts zero calls, never a real one ──────────────────
const fakeStream = vi.fn(async () => ({
  text: '# ROLE\n\nShould never be called.\n',
  stopReason: 'end_turn' as const,
  model: 'claude-opus-4-8',
  usage: { inputTokens: 1, outputTokens: 1 },
}));
const fakeComplete = vi.fn(async () => ({
  text: '{"sections":{}}',
  stopReason: 'end_turn' as const,
  model: 'claude-opus-4-8',
  usage: { inputTokens: 1, outputTokens: 1 },
}));
vi.mock('../../../../lib/ai/anthropicProvider.js', () => ({
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

import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { createTestUser } from '../../../../lib/db/__tests__/test-users.js';
import { CONFIG_DEFS } from '../../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../../lib/db/sectionDefsSeed.js';

import { POST as createAgentPOST } from '../route.js';
import { POST as sharesPOST } from '../[id]/shares/route.js';
import { POST as shareLinkPOST } from '../[id]/share-link/route.js';
import { POST as redeemPOST } from '../redeem/route.js';
import { POST as copyPOST } from '../[id]/copy/route.js';

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
});

function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) } as { params: Promise<T> };
}

function asUser(user: { id: string; email: string; role: 'admin' | 'user' }): void {
  currentSession = { userId: user.id, email: user.email, role: user.role };
}

async function makeAgent(owner: { id: string; email: string; role: 'admin' | 'user' }, name: string): Promise<{ id: string; name: string }> {
  asUser(owner);
  const res = await createAgentPOST(
    new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: 'copy route test agent' }),
    }),
  );
  const dto = (await res.json()) as { id: string; name: string };
  return dto;
}

function copyReq(id: string, name?: string): Request {
  return new Request(`http://localhost/api/agents/${id}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name !== undefined ? { name } : {}),
  });
}

describe('POST /api/agents/[id]/copy', () => {
  it('owner copying their OWN agent → 400 cannot_copy_own_agent (added during implementation, not the original draft)', async () => {
    const owner = createTestUser('user');
    const source = await makeAgent(owner, `copy-owner-${crypto.randomUUID()}`);

    asUser(owner);
    // Even with an explicit, non-colliding name — the block fires before the
    // name pre-check, so this is never a 409.
    const res = await copyPOST(copyReq(source.id, `${source.name}-explicit-name`), ctx({ id: source.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('cannot_copy_own_agent');
  });

  it('still blocked after the owner redeems their own share-link code (robust across the code path)', async () => {
    const owner = createTestUser('user');
    const source = await makeAgent(owner, `copy-owner-code-${crypto.randomUUID()}`);

    asUser(owner);
    const linkRes = await shareLinkPOST(new Request(`http://localhost/api/agents/${source.id}/share-link`, { method: 'POST' }), ctx({ id: source.id }));
    const { publicCode } = await linkRes.json();
    await redeemPOST(new Request('http://localhost/api/agents/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: publicCode }),
    }));

    const res = await copyPOST(copyReq(source.id, `${source.name}-via-code`), ctx({ id: source.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('cannot_copy_own_agent');
  });

  it('still blocked when the owner has (hypothetically) been added by their own email (robust across the email path)', async () => {
    const owner = createTestUser('user');
    const source = await makeAgent(owner, `copy-owner-selfemail-${crypto.randomUUID()}`);

    // The normal grant route refuses this (cannot_share_with_self) — this
    // test writes the row directly to prove the copy guard is robust even if
    // that other guard were ever bypassed or removed, not merely lucky.
    testDb.insert(schema.agentShare).values({
      id: crypto.randomUUID(),
      agentId: source.id,
      recipientEmail: owner.email,
      grantedVia: 'email',
    }).run();

    asUser(owner);
    const res = await copyPOST(copyReq(source.id, `${source.name}-via-selfemail`), ctx({ id: source.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('cannot_copy_own_agent');
  });

  it('a share-holder copies a shared agent → 201', async () => {
    const owner = createTestUser('user');
    const recipient = createTestUser('user');
    const source = await makeAgent(owner, `copy-shared-${crypto.randomUUID()}`);

    asUser(owner);
    await sharesPOST(
      new Request(`http://localhost/api/agents/${source.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail: recipient.email }),
      }),
      ctx({ id: source.id }),
    );

    asUser(recipient);
    const res = await copyPOST(copyReq(source.id), ctx({ id: source.id }));
    expect(res.status).toBe(201);
    const dto = await res.json();
    expect(dto.name).toBe(source.name);
  });

  it("409 name_exists on a collision with the copier's own agent", async () => {
    const owner = createTestUser('user');
    const copier = createTestUser('user');
    const source = await makeAgent(owner, `copy-collision-${crypto.randomUUID()}`);
    const existing = await makeAgent(copier, `copy-collision-target-${crypto.randomUUID()}`);

    // copier needs access to source first — a share, since copier isn't the owner.
    asUser(owner);
    await sharesPOST(
      new Request(`http://localhost/api/agents/${source.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail: copier.email }),
      }),
      ctx({ id: source.id }),
    );

    asUser(copier);
    const res = await copyPOST(copyReq(source.id, existing.name), ctx({ id: source.id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('name_exists');
  });

  it('a stranger with no access to the source → 404', async () => {
    const owner = createTestUser('user');
    const stranger = createTestUser('user');
    const source = await makeAgent(owner, `copy-stranger-${crypto.randomUUID()}`);

    asUser(stranger);
    const res = await copyPOST(copyReq(source.id), ctx({ id: source.id }));
    expect(res.status).toBe(404);
  });

  it('unauthenticated → 401', async () => {
    currentSession = null;
    const res = await copyPOST(copyReq('any-id'), ctx({ id: 'any-id' }));
    expect(res.status).toBe(401);
  });
});

describe('zero AI provider calls across this entire suite (§4.6/§4.10)', () => {
  it('fakeStream and fakeComplete were never invoked', () => {
    expect(fakeStream).not.toHaveBeenCalled();
    expect(fakeComplete).not.toHaveBeenCalled();
  });
});
