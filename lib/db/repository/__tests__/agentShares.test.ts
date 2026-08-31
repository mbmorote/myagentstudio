/**
 * lib/db/repository/__tests__/agentShares.test.ts
 *
 * Tests for lib/db/repository/agentShares.ts (Plan 15 §5.2).
 *
 * Covers:
 *   - Grant by email → row exists with grantedVia:'email', email lowercased + trimmed
 *   - Granting the same (agentId, email) twice creates exactly one row and
 *     returns the original — the idempotency assertion the whole design rests on
 *   - Granting by code for an agent already granted by email is likewise one row
 *     — the cross-mechanism half of the same rule
 *   - MixedCase@Example.COM and '  mixedcase@example.com  ' collapse to the same row
 *   - setPublicCode → findAgentIdByPublicCode → clearPublicCode → findAgentIdByPublicCode
 *     returns null
 *   - Two agents cannot hold the same code (unique index)
 *   - Two agents with publicCode = NULL coexist — the regression test for anyone
 *     who "fixes" the unique index into a NOT NULL or a partial index
 *   - deleteSharesForAgent removes only that agent's rows
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

import { testDb } from '../../__tests__/test-db.js';
import { createTestUser } from '../../__tests__/test-users.js';
import * as schema from '../../schema.js';
import { CONFIG_DEFS } from '../../../blueprint/catalog.js';
import { SECTION_DEFS } from '../../sectionDefsSeed.js';
import { createAgent } from '../agents.js';
import {
  createShare,
  listSharesForAgent,
  deleteShare,
  deleteSharesForAgent,
  findShare,
  setPublicCode,
  clearPublicCode,
  findAgentIdByPublicCode,
} from '../agentShares.js';
import { generateShareCode } from '../../../auth/shareCode.js';

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

function makeAgent(name: string) {
  const owner = createTestUser('user');
  return createAgent(owner.id, name, 'test agent');
}

describe('createShare — grant by email', () => {
  it('creates a row with grantedVia:email, lowercased + trimmed', () => {
    const agent = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const row = createShare(agent.id, '  Recipient@Example.COM  ', 'email');

    expect(row.agentId).toBe(agent.id);
    expect(row.recipientEmail).toBe('recipient@example.com');
    expect(row.grantedVia).toBe('email');
    expect(row.id).toBeTruthy();
  });

  it('granting the same (agentId, email) twice creates exactly one row and returns the original', () => {
    const agent = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const first = createShare(agent.id, 'dup@example.com', 'email');
    const second = createShare(agent.id, 'dup@example.com', 'email');

    expect(second.id).toBe(first.id);
    expect(listSharesForAgent(agent.id)).toHaveLength(1);
  });

  it('granting by code for an agent already granted by email is also one row (cross-mechanism idempotency)', () => {
    const agent = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const byEmail = createShare(agent.id, 'cross@example.com', 'email');
    const byCode = createShare(agent.id, 'cross@example.com', 'code');

    expect(byCode.id).toBe(byEmail.id);
    expect(byCode.grantedVia).toBe('email'); // the original row's mechanism is preserved
    expect(listSharesForAgent(agent.id)).toHaveLength(1);
  });

  it('MixedCase@Example.COM and whitespace-padded lowercase collapse to the same row', () => {
    const agent = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const first = createShare(agent.id, 'MixedCase@Example.COM', 'email');
    const second = createShare(agent.id, '  mixedcase@example.com  ', 'email');

    expect(second.id).toBe(first.id);
    expect(listSharesForAgent(agent.id)).toHaveLength(1);
  });
});

describe('findShare', () => {
  it('finds a granted share by normalized email', () => {
    const agent = makeAgent(`share-agent-${crypto.randomUUID()}`);
    createShare(agent.id, 'findme@example.com', 'email');

    expect(findShare(agent.id, '  FindMe@Example.com ')).not.toBeNull();
  });

  it('returns null for an agent/email pair with no grant', () => {
    const agent = makeAgent(`share-agent-${crypto.randomUUID()}`);
    expect(findShare(agent.id, 'nobody@example.com')).toBeNull();
  });
});

describe('deleteShare', () => {
  it('revokes one person and leaves other shares on the same agent intact', () => {
    const agent = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const a = createShare(agent.id, 'a@example.com', 'email');
    createShare(agent.id, 'b@example.com', 'email');

    const result = deleteShare(a.id, agent.id);
    expect(result).toBe(true);

    const remaining = listSharesForAgent(agent.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].recipientEmail).toBe('b@example.com');
  });

  it('returns false when the shareId does not belong to the given agentId', () => {
    const agentA = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const agentB = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const shareOnA = createShare(agentA.id, 'x@example.com', 'email');

    const result = deleteShare(shareOnA.id, agentB.id);
    expect(result).toBe(false);
    expect(listSharesForAgent(agentA.id)).toHaveLength(1);
  });

  it('returns false for an unknown shareId', () => {
    const agent = makeAgent(`share-agent-${crypto.randomUUID()}`);
    expect(deleteShare(crypto.randomUUID(), agent.id)).toBe(false);
  });
});

describe('deleteSharesForAgent', () => {
  it("removes only that agent's rows", () => {
    const agentA = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const agentB = makeAgent(`share-agent-${crypto.randomUUID()}`);
    createShare(agentA.id, 'a1@example.com', 'email');
    createShare(agentA.id, 'a2@example.com', 'email');
    createShare(agentB.id, 'b1@example.com', 'email');

    deleteSharesForAgent(agentA.id);

    expect(listSharesForAgent(agentA.id)).toHaveLength(0);
    expect(listSharesForAgent(agentB.id)).toHaveLength(1);
  });
});

describe('publicCode accessors', () => {
  it('set → find → clear → find round trip', () => {
    const agent = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const code = generateShareCode();

    expect(findAgentIdByPublicCode(code)).toBeNull();

    setPublicCode(agent.id, code);
    expect(findAgentIdByPublicCode(code)).toBe(agent.id);

    clearPublicCode(agent.id);
    expect(findAgentIdByPublicCode(code)).toBeNull();
  });

  it('two agents cannot hold the same code (unique index)', () => {
    const agentA = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const agentB = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const code = generateShareCode();

    setPublicCode(agentA.id, code);
    expect(() => setPublicCode(agentB.id, code)).toThrow();
  });

  it('two agents with publicCode = NULL coexist (regression: NULL must never collide in the unique index)', () => {
    const agentA = makeAgent(`share-agent-${crypto.randomUUID()}`);
    const agentB = makeAgent(`share-agent-${crypto.randomUUID()}`);
    // Neither agent has ever called setPublicCode — both have publicCode = NULL
    // by default. Constructing them at all, with no throw, is the assertion.
    expect(agentA.id).not.toBe(agentB.id);
  });
});
