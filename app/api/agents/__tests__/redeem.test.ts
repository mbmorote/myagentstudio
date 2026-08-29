/**
 * app/api/agents/__tests__/redeem.test.ts
 *
 * Route-level tests for POST /api/agents/redeem (Plan 15 §5.6, Step 5).
 *
 * Covers:
 *   - Unknown code, well-formed-but-never-issued code, and a disabled code all
 *     produce the exact same 404 { error: 'invalid_code' } body (constraint 6)
 *   - Valid code, non-owner, first redemption → 200, access:'shared',
 *     alreadyHadAccess:false; a share row is created
 *   - Redeeming the same code again → alreadyHadAccess:true, still one row
 *   - Redeeming your own agent's code → access:'owner', alreadyHadAccess:true,
 *     no share row written
 *   - invalid_body for a missing/wrong-typed code
 *   - unauthenticated → 401
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

import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { createTestUser } from '../../../../lib/db/__tests__/test-users.js';
import { CONFIG_DEFS } from '../../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../../lib/db/sectionDefsSeed.js';

import { POST as createAgentPOST } from '../route.js';
import { GET as sharesGET } from '../[id]/shares/route.js';
import { POST as shareLinkPOST, DELETE as shareLinkDELETE } from '../[id]/share-link/route.js';
import { POST as redeemPOST } from '../redeem/route.js';

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

async function makeAgent(owner: { id: string; email: string; role: 'admin' | 'user' }, name: string): Promise<string> {
  asUser(owner);
  const res = await createAgentPOST(
    new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: 'redeem route test agent' }),
    }),
  );
  const { id } = (await res.json()) as { id: string };
  return id;
}

async function enableLink(owner: { id: string; email: string; role: 'admin' | 'user' }, id: string): Promise<string> {
  asUser(owner);
  const res = await shareLinkPOST(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'POST' }), ctx({ id }));
  return (await res.json()).publicCode;
}

function redeemReq(code: unknown): Request {
  return new Request('http://localhost/api/agents/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/agents/redeem — invalid codes collapse to one body (constraint 6)', () => {
  it('unknown/garbage code → 404 invalid_code', async () => {
    const user = createTestUser('user');
    asUser(user);
    const res = await redeemPOST(redeemReq('totally-not-a-real-code'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'invalid_code' });
  });

  it('well-formed-but-never-issued code → the SAME 404 body', async () => {
    const user = createTestUser('user');
    asUser(user);
    const res = await redeemPOST(redeemReq(`shr_${'a'.repeat(43)}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'invalid_code' });
  });

  it('a code whose agent has since disabled its link → the SAME 404 body', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `redeem-disabled-${crypto.randomUUID()}`);
    const code = await enableLink(owner, id);

    asUser(owner);
    await shareLinkDELETE(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'DELETE' }), ctx({ id }));

    const recipient = createTestUser('user');
    asUser(recipient);
    const res = await redeemPOST(redeemReq(code));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'invalid_code' });
  });
});

describe('POST /api/agents/redeem — valid code, non-owner', () => {
  it('first redemption → 200, access:shared, alreadyHadAccess:false, and a share row is created', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `redeem-first-${crypto.randomUUID()}`);
    const code = await enableLink(owner, id);

    const recipient = createTestUser('user');
    asUser(recipient);
    const res = await redeemPOST(redeemReq(code));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agentId).toBe(id);
    expect(body.access).toBe('shared');
    expect(body.alreadyHadAccess).toBe(false);
    expect(typeof body.agentName).toBe('string');

    asUser(owner);
    const list = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    const shares = (await list.json()).shares;
    expect(shares).toHaveLength(1);
    expect(shares[0].recipientEmail).toBe(recipient.email);
    expect(shares[0].grantedVia).toBe('code');
  });

  it('redeeming the same code again → alreadyHadAccess:true, still exactly one share row', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `redeem-twice-${crypto.randomUUID()}`);
    const code = await enableLink(owner, id);

    const recipient = createTestUser('user');
    asUser(recipient);
    await redeemPOST(redeemReq(code));
    const second = await redeemPOST(redeemReq(code));
    expect(second.status).toBe(200);
    expect((await second.json()).alreadyHadAccess).toBe(true);

    asUser(owner);
    const list = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    expect((await list.json()).shares).toHaveLength(1);
  });
});

describe('POST /api/agents/redeem — redeeming your own agent\'s code', () => {
  it("returns access:'owner', alreadyHadAccess:true, and writes no share row", async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `redeem-self-${crypto.randomUUID()}`);
    const code = await enableLink(owner, id);

    asUser(owner);
    const res = await redeemPOST(redeemReq(code));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access).toBe('owner');
    expect(body.alreadyHadAccess).toBe(true);

    const list = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    expect((await list.json()).shares).toEqual([]);
  });
});

describe('POST /api/agents/redeem — validation and auth', () => {
  it('missing code → 400 invalid_body', async () => {
    const user = createTestUser('user');
    asUser(user);
    const res = await redeemPOST(new Request('http://localhost/api/agents/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
  });

  it('non-string code → 400 invalid_body', async () => {
    const user = createTestUser('user');
    asUser(user);
    const res = await redeemPOST(redeemReq(12345));
    expect(res.status).toBe(400);
  });

  it('unauthenticated → 401', async () => {
    currentSession = null;
    const res = await redeemPOST(redeemReq('anything'));
    expect(res.status).toBe(401);
  });
});
