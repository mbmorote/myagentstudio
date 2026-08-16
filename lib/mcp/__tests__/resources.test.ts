/**
 * lib/mcp/__tests__/resources.test.ts
 *
 * Tests for lib/mcp/resources.ts (Plan 13 §5.4).
 *
 * Cases:
 *   - listResourcesForPrincipal covers the same agent set list_agents does, in the
 *     myagent://agent/{id} shape
 *   - readAgentResource returns byte-identical text to export_agent for the same
 *     agent (they must share one code path — divergence here means someone added a
 *     second export)
 *   - Tenancy: a resource read for another owner's agent id returns null
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

import { listResourcesForPrincipal, readAgentResource } from '../resources.js';
import { handleListAgents } from '../tools/listAgents.js';
import { handleExportAgent } from '../tools/exportAgent.js';
import type { McpPrincipal } from '../../auth/mcpGuard.js';

let userA: ReturnType<typeof createTestUser>;
let userB: ReturnType<typeof createTestUser>;
let agentA: { id: string };

function principalFor(userId: string): McpPrincipal {
  return { userId, tokenId: `tok-${userId}`, scope: 'read' };
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
  agentA = createAgent(userA.id, 'resource-agent-a', "A's resource agent");
});

describe('listResourcesForPrincipal', () => {
  it('covers the same agent set as list_agents, in the myagent://agent/{id} shape', () => {
    const resources = listResourcesForPrincipal(principalFor(userA.id));
    const toolResult = handleListAgents(principalFor(userA.id));

    expect(resources.map((r) => r.uri).sort()).toEqual(
      toolResult.agents.map((a) => `myagent://agent/${a.id}`).sort(),
    );

    const entry = resources.find((r) => r.uri === `myagent://agent/${agentA.id}`)!;
    expect(entry.name).toBe('resource-agent-a');
    expect(entry.mimeType).toBe('text/markdown');
  });

  it("does not include another owner's agents", () => {
    const resources = listResourcesForPrincipal(principalFor(userB.id));
    expect(resources.some((r) => r.uri === `myagent://agent/${agentA.id}`)).toBe(false);
  });
});

describe('readAgentResource', () => {
  it('returns byte-identical text to export_agent for the same agent', () => {
    const resourceText = readAgentResource(principalFor(userA.id), agentA.id);
    const exportResult = handleExportAgent(principalFor(userA.id), { agentId: agentA.id });
    expect(exportResult.ok).toBe(true);
    if (!exportResult.ok) return;
    expect(resourceText).toBe(exportResult.markdown);
  });

  it("returns null for another owner's agent id (same non-disclosure posture as export_agent)", () => {
    expect(readAgentResource(principalFor(userB.id), agentA.id)).toBeNull();
  });

  it('returns null for an unknown agent id', () => {
    expect(readAgentResource(principalFor(userA.id), 'does-not-exist')).toBeNull();
  });
});
