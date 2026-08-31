/**
 * lib/mcp/__tests__/importAgent.test.ts
 *
 * Tests for the write-scope MCP tool handler push_agent (renamed from
 * import_agent 2026-08-24; handler function name handleImportAgent and this
 * file's own name are unchanged — Plan 13 §5.5).
 * Provider mocked at the module level, running the real gateway and the real
 * assemble/persist path — the pattern app/api/agents/__tests__/import-dryrun.test.ts
 * already uses.
 *
 * Cases:
 *   - write_scope_required: a read-scoped token is refused, no LLM call attempted
 *   - mcpWrites:false → refusal with a named error, no LLM call, no agent row
 *     created or modified
 *   - New name → creates an agent (source:'imported'); matching name → updates in
 *     place, never duplicates (stands in for the dropped create_agent tool)
 *   - Snapshot trail: pre-import + post-import snapshots exist after an update-import,
 *     changed sections carry author:'reimport' revisions
 *   - Byte-identical re-import short-circuits to skipped:'unchanged', zero LLM calls
 *   - Cross-owner safety: a name collision with another owner's agent creates the
 *     caller's own agent, leaves the other owner's untouched
 *   - Dry-run: dryRun:true → the gateway's hard stop, provider never invoked
 *   - Truncated model response → hard rejection, nothing persisted
 *   - Coverage warnings are passed through
 */

import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';
import type { LlmResponse } from '../../ai/provider.js';

vi.mock('../../db/client.js', async () => {
  const { testDb } = await import('../../db/__tests__/test-db.js');
  return { db: testDb };
});

const fakeStream = vi.fn(async (): Promise<LlmResponse> => ({
  text: '# ROLE\n\nTest agent content.\n',
  stopReason: 'end_turn',
  model: 'claude-opus-4-8',
  usage: { inputTokens: 5, outputTokens: 10 },
}));

const fakeComplete = vi.fn(async () => ({
  text: '{"labels":{}}',
  stopReason: 'end_turn' as const,
  model: 'claude-opus-4-8',
  usage: { inputTokens: 5, outputTokens: 10 },
}));

vi.mock('../../ai/anthropicProvider.js', () => ({
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

import * as schema from '../../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { testDb } from '../../db/__tests__/test-db.js';
import { createTestUser } from '../../db/__tests__/test-users.js';
import { CONFIG_DEFS } from '../../blueprint/catalog.js';
import { SECTION_DEFS } from '../../db/sectionDefsSeed.js';
import { listAgents } from '../../db/repository/agents.js';
import { createShare } from '../../db/repository/agentShares.js';

import { handleImportAgent } from '../tools/importAgent.js';
import { handleGetAgent } from '../tools/getAgent.js';
import type { McpPrincipal } from '../../auth/mcpGuard.js';

function setSetting(key: string, value: string): void {
  testDb.insert(schema.setting).values({ key, value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
    .run();
}

function principalFor(userId: string, scope: 'read' | 'write' = 'write'): McpPrincipal {
  return { userId, tokenId: `tok-${userId}`, scope };
}

function agentMd(name: string, description = 'A test agent'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# Role\n\nOriginal content for ${name}.\n`;
}

function snapshotsFor(agentId: string): Array<{ kind: string }> {
  return testDb.select({ kind: schema.agentSnapshot.kind })
    .from(schema.agentSnapshot)
    .where(eq(schema.agentSnapshot.agentId, agentId))
    .all();
}

function revisionAuthorsFor(agentId: string): string[] {
  const sections = testDb.select({ id: schema.agentSection.id })
    .from(schema.agentSection)
    .where(eq(schema.agentSection.agentId, agentId))
    .all();
  const sectionIds = sections.map((s) => s.id);
  if (sectionIds.length === 0) return [];
  const revisions = testDb.select({ author: schema.sectionRevision.author })
    .from(schema.sectionRevision)
    .where(inArray(schema.sectionRevision.sectionId, sectionIds))
    .all();
  return revisions.map((r) => r.author);
}

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
  setSetting('maxLlmCallsPerUserPerHour', '1000');
  setSetting('mcpWrites', 'true');
});

beforeEach(() => {
  fakeStream.mockClear();
  fakeComplete.mockClear();
});

// ── Token scope gate ─────────────────────────────────────────────────────────

describe('handleImportAgent — token scope gate', () => {
  it('a read-scoped token is refused, no LLM call attempted', async () => {
    const user = createTestUser('user');
    const result = await handleImportAgent(principalFor(user.id, 'read'), { md: agentMd('scope-test-agent') });
    expect(result).toEqual({ ok: false, error: 'write_scope_required' });
    expect(fakeStream).not.toHaveBeenCalled();
    expect(fakeComplete).not.toHaveBeenCalled();
  });
});

// ── mcpWrites kill switch ──────────────────────────────────────────────────────

describe('handleImportAgent — mcpWrites kill switch', () => {
  it('mcpWrites:false → refusal, no LLM call, no agent row created', async () => {
    setSetting('mcpWrites', 'false');
    try {
      const user = createTestUser('user');
      const beforeCount = listAgents(user.id).length;

      const result = await handleImportAgent(principalFor(user.id), { md: agentMd('killswitch-agent') });

      expect(result).toEqual({ ok: false, error: 'mcp_writes_disabled' });
      expect(fakeStream).not.toHaveBeenCalled();
      expect(fakeComplete).not.toHaveBeenCalled();
      expect(listAgents(user.id).length).toBe(beforeCount);
    } finally {
      setSetting('mcpWrites', 'true');
    }
  });
});

// ── Create vs update ────────────────────────────────────────────────────────────

describe('handleImportAgent — create vs update-in-place', () => {
  it('a new name creates an agent with source:\'imported\'', async () => {
    const user = createTestUser('user');
    const result = await handleImportAgent(principalFor(user.id), { md: agentMd('create-test-agent') });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.name).toBe('create-test-agent');
    expect(result.agent.source).toBe('imported');
  });

  it('a matching name updates in place — never duplicates (stands in for create_agent)', async () => {
    const user = createTestUser('user');
    const first = await handleImportAgent(principalFor(user.id), { md: agentMd('update-test-agent', 'v1') });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await handleImportAgent(principalFor(user.id), { md: agentMd('update-test-agent', 'v1-changed-enough-to-not-be-byte-identical') });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.agent.id).toBe(first.agent.id);

    const matching = listAgents(user.id).filter((a) => a.name === 'update-test-agent');
    expect(matching).toHaveLength(1);
  });
});

// ── Snapshot trail (constraint 8, inherited not invented) ───────────────────────

describe('handleImportAgent — snapshot trail', () => {
  it('an update-import writes pre-import and post-import snapshots, and reimport-tagged revisions', async () => {
    const user = createTestUser('user');
    const first = await handleImportAgent(principalFor(user.id), { md: agentMd('snapshot-test-agent', 'v1') });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await handleImportAgent(principalFor(user.id), { md: agentMd('snapshot-test-agent', 'v2-different-enough') });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const kinds = snapshotsFor(second.agent.id).map((s) => s.kind).sort();
    expect(kinds).toContain('pre-import');
    expect(kinds).toContain('post-import');

    const authors = revisionAuthorsFor(second.agent.id);
    expect(authors).toContain('reimport');
  });
});

// ── Byte-identical short-circuit ────────────────────────────────────────────────

describe('handleImportAgent — byte-identical re-import short-circuit', () => {
  it('re-importing identical bytes returns skipped:\'unchanged\' with zero LLM calls', async () => {
    const user = createTestUser('user');
    const md = agentMd('unchanged-test-agent');

    const first = await handleImportAgent(principalFor(user.id), { md });
    expect(first.ok).toBe(true);

    fakeStream.mockClear();
    fakeComplete.mockClear();

    const second = await handleImportAgent(principalFor(user.id), { md });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.skipped).toBe('unchanged');
    expect(fakeStream).not.toHaveBeenCalled();
    expect(fakeComplete).not.toHaveBeenCalled();
  });
});

// ── Cross-owner safety ──────────────────────────────────────────────────────────

describe('handleImportAgent — cross-owner safety', () => {
  it("a name collision with another owner's agent creates the caller's own agent, leaves the other untouched", async () => {
    const userA = createTestUser('user');
    const userB = createTestUser('user');

    const aResult = await handleImportAgent(principalFor(userA.id), { md: agentMd('shared-name-agent', "A's version") });
    expect(aResult.ok).toBe(true);
    if (!aResult.ok) return;

    const bResult = await handleImportAgent(principalFor(userB.id), { md: agentMd('shared-name-agent', "B's version") });
    expect(bResult.ok).toBe(true);
    if (!bResult.ok) return;

    expect(bResult.agent.id).not.toBe(aResult.agent.id);
    expect(bResult.agent.description).toBe("B's version");

    // A's agent is untouched
    const aAgents = listAgents(userA.id).filter((a) => a.name === 'shared-name-agent');
    expect(aAgents).toHaveLength(1);
    expect(aAgents[0].description).toBe("A's version");
  });

  it(
    "Plan 15 (D8, §6 step 8c): C 'pushing' a document named after a SHARED agent's name creates " +
    "C's own agent, never touches the shared agent — write-surface containment re-verified for " +
    'the shared case specifically, not assumed to carry over from cross-owner safety above',
    async () => {
      const owner = createTestUser('user');
      const recipient = createTestUser('user');

      const ownerResult = await handleImportAgent(principalFor(owner.id), { md: agentMd('c-push-shared-agent', "owner's version") });
      expect(ownerResult.ok).toBe(true);
      if (!ownerResult.ok) return;

      createShare(ownerResult.agent.id, recipient.email, 'email');

      // Confirm C can actually see it first (the interesting case: it's not
      // just "unknown to C", it's "known to C, but still can't be written").
      const readBefore = handleGetAgent(principalFor(recipient.id, 'read'), { agentId: ownerResult.agent.id });
      expect(readBefore.ok).toBe(true);

      const pushResult = await handleImportAgent(
        principalFor(recipient.id),
        { md: agentMd('c-push-shared-agent', "recipient's attempted overwrite") },
      );
      expect(pushResult.ok).toBe(true);
      if (!pushResult.ok) return;

      // The owner's agent is completely untouched.
      const ownerAgents = listAgents(owner.id).filter((a) => a.name === 'c-push-shared-agent');
      expect(ownerAgents).toHaveLength(1);
      expect(ownerAgents[0].description).toBe("owner's version");

      // The recipient got their OWN new agent, a distinct row.
      expect(pushResult.agent.id).not.toBe(ownerResult.agent.id);
      expect(pushResult.agent.description).toBe("recipient's attempted overwrite");
    },
  );
});

// ── Dry-run ──────────────────────────────────────────────────────────────────────

describe('handleImportAgent — dry-run', () => {
  it('dryRun:true forces the gateway hard stop; provider never invoked', async () => {
    const user = createTestUser('user');
    const result = await handleImportAgent(principalFor(user.id), { md: agentMd('dryrun-test-agent'), dryRun: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('llm_dry_run');
    expect(fakeStream).not.toHaveBeenCalled();
    expect(fakeComplete).not.toHaveBeenCalled();

    // No agent was created
    expect(listAgents(user.id).filter((a) => a.name === 'dryrun-test-agent')).toHaveLength(0);
  });
});

// ── Truncation ───────────────────────────────────────────────────────────────────

describe('handleImportAgent — truncated response', () => {
  it('a truncated (max_tokens) response is rejected — nothing persisted', async () => {
    fakeStream.mockImplementationOnce(async () => ({
      text: '# ROLE\n\nTruncated content...',
      stopReason: 'max_tokens' as const,
      model: 'claude-opus-4-8',
      usage: { inputTokens: 5, outputTokens: 4096 },
    }));

    const user = createTestUser('user');
    const result = await handleImportAgent(principalFor(user.id), { md: agentMd('truncated-test-agent') });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('structural_truncated');
    expect(listAgents(user.id).filter((a) => a.name === 'truncated-test-agent')).toHaveLength(0);
  });
});

// ── Coverage warnings ────────────────────────────────────────────────────────────

describe('handleImportAgent — coverage warnings', () => {
  it('warnings from checkCoverage are passed through on the result', async () => {
    // A restructured body that drops content the original had, to trigger a
    // low-coverage warning for the dropped block.
    fakeStream.mockImplementationOnce(async () => ({
      text: '# ROLE\n\nCompletely different content that shares nothing with the source.\n',
      stopReason: 'end_turn' as const,
      model: 'claude-opus-4-8',
      usage: { inputTokens: 5, outputTokens: 10 },
    }));

    const user = createTestUser('user');
    const md = '---\nname: coverage-test-agent\ndescription: test\n---\n\n# Role\n\nThis specific sentence about elephants and submarines must survive restructuring intact for coverage to pass.\n';
    const result = await handleImportAgent(principalFor(user.id), { md });
    expect(result.ok).toBe(true);
    if (!result.ok || result.skipped) return;
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
