import 'server-only';

/**
 * lib/mcp/tools/listAgents.ts
 *
 * MCP tool: list_agents (Plan 13 §4.4, read scope).
 *
 * Pure of transport and of the SDK — handleListAgents is directly unit-testable
 * without a protocol round trip. lib/mcp/server.ts wraps this into a registered
 * tool callback and packages the return value into a CallToolResult.
 */

import { listAgents as listAgentsRepo } from '../../db/repository/index.js';
import type { McpPrincipal } from '../../auth/mcpGuard.js';

export const TOOL_NAME = 'list_agents';

export const TOOL_DESCRIPTION =
  "Lists the authenticated user's agents (id, name, description, source, platform, " +
  'updatedAt). Read-only, makes no LLM call, and only ever returns agents owned by ' +
  "the caller's token — there is no way to list another user's agents.";

export type ListAgentsToolResult = {
  agents: Array<{
    id: string;
    name: string;
    description: string;
    source: string;
    platform: string;
    updatedAt: string;
  }>;
};

/** Backed by listAgents(ownerId) — the same repository call resources/list uses. */
export function handleListAgents(principal: McpPrincipal): ListAgentsToolResult {
  const rows = listAgentsRepo(principal.userId);
  return {
    agents: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      source: r.source,
      platform: r.platform,
      updatedAt: r.updatedAt,
    })),
  };
}
