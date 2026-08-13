/**
 * lib/db/repository/__tests__/index.test.ts
 *
 * lib/db/repository/index.ts is the ONLY DB import surface outside lib/db —
 * a pure re-export barrel over agents.js, catalog.js,
 * groups.js, settings.js, llmCallLog.js, users.js, oauthAccounts.js.
 *
 * Missing/renamed exports are already caught by tsc at compile time; this is
 * a runtime smoke test that every binding actually resolves through the
 * barrel (catches ESM/circular-import interop issues tsc wouldn't), not a
 * test of each function's own behavior (covered in each module's own test
 * file, e.g. repo.test.ts for agents.ts).
 *
 * Replaces lib/db/client.js with the in-memory test DB, same as every other
 * repository test — the real client.ts singleton (a real file-backed SQLite
 * connection with no override) must never be touched by a test.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../client.js', async () => {
  const { testDb } = await import('../../__tests__/test-db.js');
  return { db: testDb };
});

import * as repo from '../index.js';

describe('lib/db/repository barrel exports', () => {
  it('re-exports every agents.js function as a callable', () => {
    for (const name of [
      'createAgent',
      'getAgentFull',
      'getAgentSnapshotInfo',
      'listAgents',
      'updateSectionContent',
      'addSection',
      'deleteSection',
      'updateAgent',
      'upsertAgentFromImport',
      'deleteAgent',
      'exportAgentMarkdown',
    ] as const) {
      expect(typeof repo[name]).toBe('function');
    }
  });

  it('re-exports agents.js error classes', () => {
    expect(typeof repo.VersionConflictError).toBe('function'); // classes are functions
    expect(typeof repo.SectionNotFoundError).toBe('function');
    expect(new repo.SectionNotFoundError('x')).toBeInstanceOf(Error);
  });

  it('re-exports every catalog.js function', () => {
    for (const name of ['getConfigDefs', 'getSectionDefs', 'getConfigCatalog', 'getSectionCatalog'] as const) {
      expect(typeof repo[name]).toBe('function');
    }
  });

  it('re-exports every groups.js function', () => {
    for (const name of ['createGroup', 'listGroups', 'deleteGroup', 'addMembership', 'removeMembership'] as const) {
      expect(typeof repo[name]).toBe('function');
    }
  });

  it('re-exports every settings.js function', () => {
    for (const name of ['getSetting', 'setSetting', 'getAllSettings'] as const) {
      expect(typeof repo[name]).toBe('function');
    }
  });

  it('re-exports every llmCallLog.js function', () => {
    for (const name of [
      'writeCallLog',
      'listCallLogs',
      'getCallLog',
      'countLlmCallsInWindow',
      'reserveCallSlot',
      'finalizeCallLog',
    ] as const) {
      expect(typeof repo[name]).toBe('function');
    }
  });

  it('re-exports every users.js function', () => {
    for (const name of [
      'getUserById',
      'getUserByEmail',
      'getUserCount',
      'getUserPolicy',
      'setUserPassword',
      'setUserLogSharing',
      'createUserWithInvite',
      'createInviteCode',
      'listInviteCodes',
      'revokeInviteCode',
      'getInviteCode',
    ] as const) {
      expect(typeof repo[name]).toBe('function');
    }
  });

  it('re-exports every oauthAccounts.js function', () => {
    for (const name of ['getOAuthAccount', 'listOAuthAccountsForUser', 'linkOAuthAccount'] as const) {
      expect(typeof repo[name]).toBe('function');
    }
  });
});
