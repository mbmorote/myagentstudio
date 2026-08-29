/**
 * app/api/agents/__tests__/shares.test.ts
 *
 * Route-level tests for the owner-side share routes (Plan 15 §5.6, Step 4):
 *   GET/POST     /api/agents/[id]/shares
 *   DELETE       /api/agents/[id]/shares/[shareId]
 *   POST/DELETE  /api/agents/[id]/share-link
 *
 * Covers the §4.5 route matrix (adjusted for D4 — no rate limit — and D7 — no
 * per-agent cap, both resolved in plans/15-share-agent.md §8):
 *   - Grant by email: 200, idempotent-grant, invalid_email, cannot_share_with_self
 *   - Revoke: 204, unknown shareId → 404
 *   - Link enable: idempotent (D9) — re-POST returns the SAME code
 *   - Link disable → re-enable produces a FRESH code, never the old one (D9)
 *   - Constraint 5 (both directions): disabling the link leaves share rows
 *     intact; revoking a person leaves the link code intact
 *   - Ownership: a non-owner gets 404 on every route in this file
 *   - Unauthenticated → 401 on every route in this file
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

// ── Replace lib/db/client.ts with in-memory test DB ───────────────────────────
vi.mock('../../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

// ── Mock getSession — the single auth seam ────────────────────────────────────
type SessionLike = { userId: string; email: string; role: 'admin' | 'user' };
let currentSession: SessionLike | null = null;

vi.mock('../../../../lib/auth/session.js', () => ({
  getSession: vi.fn(async () => currentSession),
}));

// ── Imports after mocks ────────────────────────────────────────────────────────
import * as schema from '../../../../lib/db/schema.js';
import { testDb } from '../../../../lib/db/__tests__/test-db.js';
import { createTestUser } from '../../../../lib/db/__tests__/test-users.js';
import { CONFIG_DEFS } from '../../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../../lib/db/sectionDefsSeed.js';

import { POST as createAgentPOST } from '../route.js';
import { GET as sharesGET, POST as sharesPOST } from '../[id]/shares/route.js';
import { DELETE as shareDELETE } from '../[id]/shares/[shareId]/route.js';
import { POST as shareLinkPOST, DELETE as shareLinkDELETE } from '../[id]/share-link/route.js';

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
      body: JSON.stringify({ name, description: 'share route test agent' }),
    }),
  );
  const { id } = (await res.json()) as { id: string };
  return id;
}

function jsonReq(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('GET/POST /api/agents/[id]/shares', () => {
  it('GET returns empty link state and no shares for a fresh agent', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `shares-get-${crypto.randomUUID()}`);

    asUser(owner);
    const res = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publicCode).toBeNull();
    expect(body.publicCodeCreatedAt).toBeNull();
    expect(body.shares).toEqual([]);
  });

  it('POST grants access by email → 200 with the row shape', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `shares-post-${crypto.randomUUID()}`);

    asUser(owner);
    const res = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: '  Grant@Example.COM  ' }),
      ctx({ id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipientEmail).toBe('grant@example.com');
    expect(body.grantedVia).toBe('email');
    expect(body.id).toBeTruthy();

    const list = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    const listBody = await list.json();
    expect(listBody.shares).toHaveLength(1);
  });

  it('POST is idempotent-grant — re-adding the same email returns the same row, not a second one', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `shares-idem-${crypto.randomUUID()}`);

    asUser(owner);
    const first = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: 'dup@example.com' }),
      ctx({ id }),
    );
    const firstBody = await first.json();

    const second = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: 'dup@example.com' }),
      ctx({ id }),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);

    const list = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    expect((await list.json()).shares).toHaveLength(1);
  });

  it('POST rejects an invalid email with 400 invalid_email', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `shares-badmail-${crypto.randomUUID()}`);

    asUser(owner);
    const res = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: 'not-an-email' }),
      ctx({ id }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_email');
  });

  it('POST rejects sharing with your own address with 400 cannot_share_with_self', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `shares-self-${crypto.randomUUID()}`);

    asUser(owner);
    const res = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: owner.email.toUpperCase() }),
      ctx({ id }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('cannot_share_with_self');
  });

  it('a non-owner gets 404 on both GET and POST', async () => {
    const owner = createTestUser('user');
    const stranger = createTestUser('user');
    const id = await makeAgent(owner, `shares-stranger-${crypto.randomUUID()}`);

    asUser(stranger);
    const getRes = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    expect(getRes.status).toBe(404);

    const postRes = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: 'x@example.com' }),
      ctx({ id }),
    );
    expect(postRes.status).toBe(404);
  });

  it('unauthenticated → 401 on both GET and POST', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `shares-401-${crypto.randomUUID()}`);

    currentSession = null;
    const getRes = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    expect(getRes.status).toBe(401);

    const postRes = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: 'x@example.com' }),
      ctx({ id }),
    );
    expect(postRes.status).toBe(401);
  });
});

describe('DELETE /api/agents/[id]/shares/[shareId]', () => {
  it('revokes a person → 204, then the share list is empty', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `revoke-${crypto.randomUUID()}`);

    asUser(owner);
    const grant = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: 'revoke@example.com' }),
      ctx({ id }),
    );
    const { id: shareId } = await grant.json();

    const del = await shareDELETE(new Request(`http://localhost/api/agents/${id}/shares/${shareId}`), ctx({ id, shareId }));
    expect(del.status).toBe(204);

    const list = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    expect((await list.json()).shares).toEqual([]);
  });

  it('unknown shareId → 404', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `revoke-404-${crypto.randomUUID()}`);

    asUser(owner);
    const res = await shareDELETE(
      new Request(`http://localhost/api/agents/${id}/shares/${crypto.randomUUID()}`),
      ctx({ id, shareId: crypto.randomUUID() }),
    );
    expect(res.status).toBe(404);
  });

  it('a non-owner gets 404', async () => {
    const owner = createTestUser('user');
    const stranger = createTestUser('user');
    const id = await makeAgent(owner, `revoke-stranger-${crypto.randomUUID()}`);

    asUser(owner);
    const grant = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: 'y@example.com' }),
      ctx({ id }),
    );
    const { id: shareId } = await grant.json();

    asUser(stranger);
    const res = await shareDELETE(new Request(`http://localhost/api/agents/${id}/shares/${shareId}`), ctx({ id, shareId }));
    expect(res.status).toBe(404);
  });

  it('unauthenticated → 401', async () => {
    currentSession = null;
    const res = await shareDELETE(
      new Request('http://localhost/api/agents/any-id/shares/any-share'),
      ctx({ id: 'any-id', shareId: 'any-share' }),
    );
    expect(res.status).toBe(401);
  });

  it("revoking a person leaves the link code intact (constraint 5, the reverse direction)", async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `constraint5-b-${crypto.randomUUID()}`);

    asUser(owner);
    const enable = await shareLinkPOST(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'POST' }), ctx({ id }));
    const { publicCode } = await enable.json();

    const grant = await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: 'c5b@example.com' }),
      ctx({ id }),
    );
    const { id: shareId } = await grant.json();

    await shareDELETE(new Request(`http://localhost/api/agents/${id}/shares/${shareId}`), ctx({ id, shareId }));

    const state = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    expect((await state.json()).publicCode).toBe(publicCode);
  });
});

describe('POST/DELETE /api/agents/[id]/share-link', () => {
  it('POST enables link sharing and returns a code', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `link-enable-${crypto.randomUUID()}`);

    asUser(owner);
    const res = await shareLinkPOST(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'POST' }), ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.publicCode).toBe('string');
    expect(body.publicCode.startsWith('shr_')).toBe(true);
    expect(body.publicCodeCreatedAt).toBeTruthy();
  });

  it('POST is idempotent-enable (D9) — a second POST returns the SAME code', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `link-idem-${crypto.randomUUID()}`);

    asUser(owner);
    const first = await shareLinkPOST(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'POST' }), ctx({ id }));
    const firstCode = (await first.json()).publicCode;

    const second = await shareLinkPOST(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'POST' }), ctx({ id }));
    expect((await second.json()).publicCode).toBe(firstCode);
  });

  it('DELETE disables the link', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `link-disable-${crypto.randomUUID()}`);

    asUser(owner);
    await shareLinkPOST(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'POST' }), ctx({ id }));
    const del = await shareLinkDELETE(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'DELETE' }), ctx({ id }));
    expect(del.status).toBe(200);
    expect((await del.json()).publicCode).toBeNull();

    const state = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    expect((await state.json()).publicCode).toBeNull();
  });

  it('disable then re-enable produces a FRESH code, never the old one (D9)', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `link-fresh-${crypto.randomUUID()}`);

    asUser(owner);
    const first = await shareLinkPOST(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'POST' }), ctx({ id }));
    const firstCode = (await first.json()).publicCode;

    await shareLinkDELETE(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'DELETE' }), ctx({ id }));

    const second = await shareLinkPOST(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'POST' }), ctx({ id }));
    const secondCode = (await second.json()).publicCode;

    expect(secondCode).not.toBe(firstCode);
  });

  it('disabling the link leaves every existing share row intact (constraint 5)', async () => {
    const owner = createTestUser('user');
    const id = await makeAgent(owner, `constraint5-a-${crypto.randomUUID()}`);

    asUser(owner);
    await sharesPOST(
      jsonReq(`http://localhost/api/agents/${id}/shares`, 'POST', { recipientEmail: 'c5a@example.com' }),
      ctx({ id }),
    );
    await shareLinkPOST(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'POST' }), ctx({ id }));
    await shareLinkDELETE(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'DELETE' }), ctx({ id }));

    const state = await sharesGET(new Request(`http://localhost/api/agents/${id}/shares`), ctx({ id }));
    expect((await state.json()).shares).toHaveLength(1);
  });

  it('a non-owner gets 404 on both POST and DELETE', async () => {
    const owner = createTestUser('user');
    const stranger = createTestUser('user');
    const id = await makeAgent(owner, `link-stranger-${crypto.randomUUID()}`);

    asUser(stranger);
    const postRes = await shareLinkPOST(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'POST' }), ctx({ id }));
    expect(postRes.status).toBe(404);

    const delRes = await shareLinkDELETE(new Request(`http://localhost/api/agents/${id}/share-link`, { method: 'DELETE' }), ctx({ id }));
    expect(delRes.status).toBe(404);
  });

  it('unauthenticated → 401 on both POST and DELETE', async () => {
    currentSession = null;
    const postRes = await shareLinkPOST(new Request('http://localhost/api/agents/any-id/share-link', { method: 'POST' }), ctx({ id: 'any-id' }));
    expect(postRes.status).toBe(401);

    const delRes = await shareLinkDELETE(new Request('http://localhost/api/agents/any-id/share-link', { method: 'DELETE' }), ctx({ id: 'any-id' }));
    expect(delRes.status).toBe(401);
  });
});
