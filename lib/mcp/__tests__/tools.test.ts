/**
 * lib/mcp/__tests__/tools.test.ts
 *
 * Tests for the read-scope MCP tool handlers (Plan 13 §5.4): list_agents, get_agent,
 * export_agent. Each handler is called directly with a principal — no protocol round
 * trip, no SDK involved (that's what makes these directly testable per §4.1).
 *
 * Cases:
 *   - Tenancy: A's principal can never list, read, or export B's agent
 *   - get_agent returns the derived validation block; an unknown config key is
 *     FLAGGED, not rejected (flag-don't-block, constraint 5)
 *   - export_agent's markdown and get_agent's structured content describe the same
 *     agent consistently
 *   - list_agents only returns the caller's own agents, in the documented shape
 *   - A principal's scope ('read' or 'write') has no bearing on whether a read tool
 *     succeeds — read tools take no scope check at all (write is a superset)
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client.js', async () => {
  const { testDb } = await import('../../db/__tests__/test-db.js');
  return { db: testDb };
});

import * as schema from '../../db/schema.js';
import { testDb } from '../../db/__tests__/test-db.js';
import { createTestUser } from '../../db/__tests__/test-users.js';
import { CONFIG_DEFS } from '../../blueprint/catalog.js';
import { SECTION_DEFS } from '../../db/sectionDefsSeed.js';
import { createAgent } from '../../db/repository/agents.js';

import { handleListAgents } from '../tools/listAgents.js';
import { handleGetAgent } from '../tools/getAgent.js';
import { handleExportAgent } from '../tools/exportAgent.js';
import type { McpPrincipal } from '../../auth/mcpGuard.js';

let userA: ReturnType<typeof createTestUser>;
let userB: ReturnType<typeof createTestUser>;
let agentA: { id: string };
let agentB: { id: string };

function principalFor(userId: string, scope: 'read' | 'write' = 'read'): McpPrincipal {
  return { userId, tokenId: `tok-${userId}`, scope };
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

  userA = createTestUser('user');
  userB = createTestUser('user');
  agentA = createAgent(userA.id, 'agent-a', "A's agent");
  agentB = createAgent(userB.id, 'agent-b', "B's agent");
});

// ── list_agents ────────────────────────────────────────────────────────────────

describe('handleListAgents', () => {
  it("returns only the caller's own agents, in the documented shape", () => {
    const result = handleListAgents(principalFor(userA.id));
    expect(result.agents.some((a) => a.id === agentA.id)).toBe(true);
    expect(result.agents.some((a) => a.id === agentB.id)).toBe(false);

    const row = result.agents.find((a) => a.id === agentA.id)!;
    expect(row.name).toBe('agent-a');
    expect(row.description).toBe("A's agent");
    expect(row.source).toBe('created');
    expect(row.platform).toBe('claude');
    expect(typeof row.updatedAt).toBe('string');
  });

  it("B's principal never sees A's agent", () => {
    const result = handleListAgents(principalFor(userB.id));
    expect(result.agents.some((a) => a.id === agentA.id)).toBe(false);
  });

  it('works identically for a write-scoped principal (scope has no bearing on read tools)', () => {
    const readResult = handleListAgents(principalFor(userA.id, 'read'));
    const writeResult = handleListAgents(principalFor(userA.id, 'write'));
    expect(writeResult.agents.map((a) => a.id).sort()).toEqual(readResult.agents.map((a) => a.id).sort());
  });
});

// ── get_agent ──────────────────────────────────────────────────────────────────

describe('handleGetAgent', () => {
  it("returns the full AgentDTO for the caller's own agent", () => {
    const result = handleGetAgent(principalFor(userA.id), { agentId: agentA.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agent.id).toBe(agentA.id);
    expect(result.agent.name).toBe('agent-a');
    expect(Array.isArray(result.agent.sections)).toBe(true);
    expect(result.agent.validation).toBeDefined();
  });

  it("B's principal cannot read A's agent — not_found, same as an unknown id", () => {
    const resultCrossOwner = handleGetAgent(principalFor(userB.id), { agentId: agentA.id });
    const resultUnknown = handleGetAgent(principalFor(userB.id), { agentId: 'does-not-exist' });
    expect(resultCrossOwner).toEqual({ ok: false, error: 'not_found' });
    expect(resultUnknown).toEqual({ ok: false, error: 'not_found' });
  });

  it('flags an unrecognized config key rather than rejecting it (flag, not block)', () => {
    // Insert a config row with a propKey that has no matching ConfigDef — directly via
    // the schema, mirroring how blueprint validation tests construct this case.
    testDb.insert(schema.agentConfig).values({
      agentId: agentA.id,
      propKey: 'totally-unknown-key',
      value: JSON.stringify('some-value'),
    }).run();

    const result = handleGetAgent(principalFor(userA.id), { agentId: agentA.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Never rejected — the agent is still returned in full.
    expect(result.agent.config.some((c) => c.propKey === 'totally-unknown-key')).toBe(true);
    // And it's flagged in the validation block.
    expect(result.agent.validation.unknownConfigKeys).toContain('totally-unknown-key');
  });
});

// ── export_agent ───────────────────────────────────────────────────────────────

describe('handleExportAgent', () => {
  it("returns the deterministic markdown export for the caller's own agent", () => {
    const result = handleExportAgent(principalFor(userA.id), { agentId: agentA.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.markdown).toBe('string');
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.markdown).toContain('agent-a');
  });

  it("B's principal cannot export A's agent — not_found", () => {
    const result = handleExportAgent(principalFor(userB.id), { agentId: agentA.id });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns not_found for an unknown agentId', () => {
    const result = handleExportAgent(principalFor(userA.id), { agentId: 'does-not-exist' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });
});

// ── Cross-tool consistency ────────────────────────────────────────────────────

describe('export_agent vs get_agent consistency', () => {
  it("export_agent's markdown mentions the same name get_agent returns", () => {
    const exportResult = handleExportAgent(principalFor(userA.id), { agentId: agentA.id });
    const getResult = handleGetAgent(principalFor(userA.id), { agentId: agentA.id });
    expect(exportResult.ok).toBe(true);
    expect(getResult.ok).toBe(true);
    if (!exportResult.ok || !getResult.ok) return;
    expect(exportResult.markdown).toContain(getResult.agent.name);
  });
});
