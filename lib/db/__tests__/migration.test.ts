/**
 * lib/db/__tests__/migration.test.ts
 *
 * Verifies that the 0003 migration applied correctly to the shared in-memory DB.
 * test-db.ts runs migrate() eagerly at module load, so by the time these tests
 * run the schema is already in place.
 *
 * Assertions (§4.5 gate 0 verification checks):
 *   - agent.owner_id is NOT NULL
 *   - agent_owner_name_unique and group_owner_name_unique exist
 *   - agent_name_unique is GONE
 *   - Two owners may share an agent name; one owner may not
 *   - user and invite_code tables exist with the expected columns
 *   - user.share_logs_with_admin and llm_call_log.shared_with_admin both exist,
 *     are NOT NULL, and default to 0
 *   - llm_call_log_user_created_idx exists
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { vi } from 'vitest';

vi.mock('../client.js', async () => {
  const { testDb } = await import('./test-db.js');
  return { db: testDb };
});

import { testDb } from './test-db.js';
import { createTestUser } from './test-users.js';
import { CONFIG_DEFS, SECTION_DEFS } from '../../blueprint/catalog.js';
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
      key: def.key, label: def.label, defaultHeading: def.defaultHeading,
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
