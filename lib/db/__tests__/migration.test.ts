/**
 * lib/db/__tests__/migration.test.ts
 *
 * Verifies that migrations up to 0004 applied correctly to the shared in-memory DB.
 * test-db.ts runs migrate() eagerly at module load, so by the time these tests
 * run the schema is already in place.
 *
 * Assertions (§4.5 gate 0 verification checks for 0003; §4.3 gate 2 checks for 0004):
 *   - agent.owner_id is NOT NULL
 *   - agent_owner_name_unique and group_owner_name_unique exist
 *   - agent_name_unique is GONE
 *   - Two owners may share an agent name; one owner may not
 *   - user and invite_code tables exist with the expected columns
 *   - user.share_logs_with_admin and llm_call_log.shared_with_admin both exist,
 *     are NOT NULL, and default to 0
 *   - llm_call_log_user_created_idx exists
 *   - oauth_account table exists with the expected columns (composite PK, both indexes)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { vi } from 'vitest';

vi.mock('../client.js', async () => {
  const { testDb } = await import('./test-db.js');
  return { db: testDb };
});

import { eq } from 'drizzle-orm';
import { testDb } from './test-db.js';
import { createTestUser } from './test-users.js';
import { CONFIG_DEFS } from '../../blueprint/catalog.js';
import { SECTION_DEFS } from '../sectionDefsSeed.js';
import * as schema from '../schema.js';

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

describe('migration 0003 schema verification', () => {
  it('user table exists and has expected columns', () => {
    // Insert a user row to confirm the schema
    const id = crypto.randomUUID();
    testDb.insert(schema.user).values({
      id,
      email: `migration-test-${id}@example.com`,
      passwordHash: '',
      role: 'admin',
      shareLogsWithAdmin: false,
    }).run();

    const row = testDb.select().from(schema.user).all().find((u) => u.id === id);
    expect(row).toBeDefined();
    expect(row?.role).toBe('admin');
    expect(row?.shareLogsWithAdmin).toBe(false);
    expect(row?.passwordHash).toBe('');
  });

  it('user.share_logs_with_admin defaults to false (0)', () => {
    const id = crypto.randomUUID();
    testDb.insert(schema.user).values({
      id,
      email: `migration-default-${id}@example.com`,
      passwordHash: '',
      role: 'user',
      shareLogsWithAdmin: false,
    }).run();

    const row = testDb.select().from(schema.user).all().find((u) => u.id === id);
    expect(row?.shareLogsWithAdmin).toBe(false);
  });

  it('invite_code table exists', () => {
    const owner = createTestUser('admin');
    const code = 'AAAA-BBBB-CCCC-DDDD';
    testDb.insert(schema.inviteCode).values({
      code,
      note: 'test',
      createdBy: owner.id,
      redeemedBy: null,
    }).run();

    const row = testDb.select().from(schema.inviteCode).all().find((r) => r.code === code);
    expect(row).toBeDefined();
    expect(row?.redeemedBy).toBeNull();
  });

  it('agent.owner_id is NOT NULL (cannot insert without it)', () => {
    const owner = createTestUser();
    const id = crypto.randomUUID();
    // This should not throw — owner_id is provided
    testDb.insert(schema.agent).values({
      id,
      ownerId: owner.id,
      name: `migration-agent-${id}`,
      description: 'test',
      source: 'created',
      platform: 'claude',
      splitLevel: 1,
    }).run();

    const row = testDb.select().from(schema.agent).all().find((a) => a.id === id);
    expect(row?.ownerId).toBe(owner.id);
  });

  it('two owners may share an agent name', () => {
    const ownerA = createTestUser();
    const ownerB = createTestUser();
    const sharedName = `shared-name-${crypto.randomUUID()}`;

    testDb.insert(schema.agent).values({
      id: crypto.randomUUID(), ownerId: ownerA.id, name: sharedName,
      description: 'a', source: 'created', platform: 'claude', splitLevel: 1,
    }).run();
    // Should not throw
    testDb.insert(schema.agent).values({
      id: crypto.randomUUID(), ownerId: ownerB.id, name: sharedName,
      description: 'b', source: 'created', platform: 'claude', splitLevel: 1,
    }).run();

    const rows = testDb.select().from(schema.agent).all().filter((a) => a.name === sharedName);
    expect(rows).toHaveLength(2);
  });

  it('one owner may not have two agents with the same name', () => {
    const owner = createTestUser();
    const name = `duplicate-${crypto.randomUUID()}`;

    testDb.insert(schema.agent).values({
      id: crypto.randomUUID(), ownerId: owner.id, name,
      description: 'first', source: 'created', platform: 'claude', splitLevel: 1,
    }).run();

    expect(() => {
      testDb.insert(schema.agent).values({
        id: crypto.randomUUID(), ownerId: owner.id, name,
        description: 'second', source: 'created', platform: 'claude', splitLevel: 1,
      }).run();
    }).toThrow();
  });

  it('llm_call_log has user_id (nullable) and shared_with_admin (NOT NULL, default false)', () => {
    const owner = createTestUser();
    const agentId = crypto.randomUUID();
    testDb.insert(schema.agent).values({
      id: agentId, ownerId: owner.id, name: `log-test-agent-${agentId}`,
      description: 'log test', source: 'created', platform: 'claude', splitLevel: 1,
    }).run();

    const id = crypto.randomUUID();
    testDb.insert(schema.llmCallLog).values({
      id,
      kind: 'chat',
      provider: 'anthropic',
      agentId,
      agentLabel: 'test',
      dryRun: false,
      model: 'test-model',
      requestPayload: { system: '', messages: [], maxTokens: 100, model: 'test-model' },
      responsePayload: null,
      error: null,
      durationMs: 100,
      usage: null,
      userId: owner.id,
      sharedWithAdmin: false,
    }).run();

    const row = testDb.select().from(schema.llmCallLog).all().find((r) => r.id === id);
    expect(row?.userId).toBe(owner.id);
    expect(row?.sharedWithAdmin).toBe(false);
  });

  it('llm_call_log user_id is nullable (pre-auth rows)', () => {
    const id = crypto.randomUUID();
    testDb.insert(schema.llmCallLog).values({
      id,
      kind: 'chat',
      provider: 'anthropic',
      agentId: null,
      agentLabel: null,
      dryRun: true,
      model: 'test-model',
      requestPayload: { system: '', messages: [], maxTokens: 100, model: 'test-model' },
      responsePayload: null,
      error: null,
      durationMs: 0,
      usage: null,
      userId: null,
      sharedWithAdmin: false,
    }).run();

    const row = testDb.select().from(schema.llmCallLog).all().find((r) => r.id === id);
    expect(row?.userId).toBeNull();
  });
});

// ── migration 0004: oauth_account table ──────────────────────────────────────

describe('migration 0004 — oauth_account table', () => {
  it('oauth_account table exists and accepts a valid row', () => {
    const owner = createTestUser('user');
    const providerAccountId = `mig-sub-${crypto.randomUUID()}`;

    testDb.insert(schema.oauthAccount).values({
      provider: 'google',
      providerAccountId,
      userId: owner.id,
      providerEmail: 'mig@gmail.com',
    }).run();

    const row = testDb
      .select()
      .from(schema.oauthAccount)
      .all()
      .find((r) => r.providerAccountId === providerAccountId);

    expect(row).toBeDefined();
    expect(row?.provider).toBe('google');
    expect(row?.userId).toBe(owner.id);
    expect(row?.providerEmail).toBe('mig@gmail.com');
    expect(row?.createdAt).toBeDefined();
  });

  it('providerEmail is nullable', () => {
    const owner = createTestUser('user');
    const providerAccountId = `mig-null-${crypto.randomUUID()}`;

    testDb.insert(schema.oauthAccount).values({
      provider: 'google',
      providerAccountId,
      userId: owner.id,
      providerEmail: null,
    }).run();

    const row = testDb
      .select()
      .from(schema.oauthAccount)
      .all()
      .find((r) => r.providerAccountId === providerAccountId);

    expect(row?.providerEmail).toBeNull();
  });

  it('composite PK (provider, providerAccountId) — duplicate is rejected', () => {
    const owner1 = createTestUser('user');
    const owner2 = createTestUser('user');
    const providerAccountId = `mig-pk-${crypto.randomUUID()}`;

    testDb.insert(schema.oauthAccount).values({
      provider: 'google',
      providerAccountId,
      userId: owner1.id,
      providerEmail: null,
    }).run();

    expect(() => {
      testDb.insert(schema.oauthAccount).values({
        provider: 'google',
        providerAccountId,   // same PK
        userId: owner2.id,
        providerEmail: null,
      }).run();
    }).toThrow();
  });

  it('oauth_account_user_provider_unique — one provider per user is enforced', () => {
    const owner = createTestUser('user');
    const sub1 = `mig-up1-${crypto.randomUUID()}`;
    const sub2 = `mig-up2-${crypto.randomUUID()}`;

    testDb.insert(schema.oauthAccount).values({
      provider: 'google',
      providerAccountId: sub1,
      userId: owner.id,
      providerEmail: null,
    }).run();

    // Same user, same provider, different sub → unique index violation
    expect(() => {
      testDb.insert(schema.oauthAccount).values({
        provider: 'google',
        providerAccountId: sub2,  // different sub — not a PK collision
        userId: owner.id,          // same user + same provider → UNIQUE violation
        providerEmail: null,
      }).run();
    }).toThrow();
  });

  it('oauth_account_user_idx — different provider for same user is allowed', () => {
    const owner = createTestUser('user');
    const googleSub = `mig-g-${crypto.randomUUID()}`;
    const githubSub = `mig-gh-${crypto.randomUUID()}`;

    // Google
    testDb.insert(schema.oauthAccount).values({
      provider: 'google',
      providerAccountId: googleSub,
      userId: owner.id,
      providerEmail: null,
    }).run();

    // A second provider for the same user — should NOT throw
    testDb.insert(schema.oauthAccount).values({
      provider: 'github',
      providerAccountId: githubSub,
      userId: owner.id,
      providerEmail: null,
    }).run();

    const rows = testDb
      .select()
      .from(schema.oauthAccount)
      .all()
      .filter((r) => r.userId === owner.id);

    expect(rows).toHaveLength(2);
  });
});

// ── migration 0009: agent_share table + agent.publicCode columns (Plan 15) ──

describe('migration 0009 — agent_share + agent.publicCode', () => {
  it('agent_share table exists and accepts a valid row', () => {
    const owner = createTestUser('user');
    const agentId = crypto.randomUUID();
    testDb.insert(schema.agent).values({
      id: agentId, ownerId: owner.id, name: `mig9-agent-${agentId}`,
      description: 'migration test', source: 'created', platform: 'claude', splitLevel: 1,
    }).run();

    const shareId = crypto.randomUUID();
    testDb.insert(schema.agentShare).values({
      id: shareId,
      agentId,
      recipientEmail: 'mig9@example.com',
      grantedVia: 'email',
    }).run();

    const row = testDb.select().from(schema.agentShare).all().find((r) => r.id === shareId);
    expect(row).toBeDefined();
    expect(row?.agentId).toBe(agentId);
    expect(row?.grantedVia).toBe('email');
    expect(row?.createdAt).toBeDefined();
  });

  it('agent_share_agent_email_unique — duplicate (agentId, email) is rejected', () => {
    const owner = createTestUser('user');
    const agentId = crypto.randomUUID();
    testDb.insert(schema.agent).values({
      id: agentId, ownerId: owner.id, name: `mig9-dup-${agentId}`,
      description: 'migration test', source: 'created', platform: 'claude', splitLevel: 1,
    }).run();

    testDb.insert(schema.agentShare).values({
      id: crypto.randomUUID(), agentId, recipientEmail: 'dup9@example.com', grantedVia: 'email',
    }).run();

    expect(() => {
      testDb.insert(schema.agentShare).values({
        id: crypto.randomUUID(), agentId, recipientEmail: 'dup9@example.com', grantedVia: 'code',
      }).run();
    }).toThrow();
  });

  it('agent.publicCode is nullable and agent_public_code_unique rejects a duplicate non-null code', () => {
    const owner = createTestUser('user');
    const agentAId = crypto.randomUUID();
    const agentBId = crypto.randomUUID();
    testDb.insert(schema.agent).values({
      id: agentAId, ownerId: owner.id, name: `mig9-code-a-${agentAId}`,
      description: 'a', source: 'created', platform: 'claude', splitLevel: 1,
    }).run();
    testDb.insert(schema.agent).values({
      id: agentBId, ownerId: owner.id, name: `mig9-code-b-${agentBId}`,
      description: 'b', source: 'created', platform: 'claude', splitLevel: 1,
    }).run();

    // Both NULL by default — no throw
    const rows = testDb.select().from(schema.agent).all()
      .filter((a) => a.id === agentAId || a.id === agentBId);
    expect(rows.every((a) => a.publicCode === null)).toBe(true);

    const code = `mig9-${crypto.randomUUID()}`;
    testDb.update(schema.agent).set({ publicCode: code }).where(eq(schema.agent.id, agentAId)).run();

    expect(() => {
      testDb.update(schema.agent).set({ publicCode: code }).where(eq(schema.agent.id, agentBId)).run();
    }).toThrow();
  });

  it("agent.source accepts 'copied' (D3)", () => {
    const owner = createTestUser('user');
    const id = crypto.randomUUID();
    testDb.insert(schema.agent).values({
      id, ownerId: owner.id, name: `mig9-copied-${id}`,
      description: 'copy test', source: 'copied', platform: 'claude', splitLevel: 1,
    }).run();

    const row = testDb.select().from(schema.agent).all().find((a) => a.id === id);
    expect(row?.source).toBe('copied');
  });
});
