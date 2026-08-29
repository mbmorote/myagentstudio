import 'server-only';

/**
 * lib/mcp/tools/listAgents.ts
 *
 * MCP tool: list_agents (Plan 13 §4.4, read scope).
 *
 * Pure of transport and of the SDK — handleListAgents is directly unit-testable
 * without a protocol round trip. lib/mcp/server.ts wraps this into a registered
 * tool callback and packages the return value into a CallToolResult.
 *
 * Plan 15 (D8 resolved, folded into this plan as its own later step, §6 step 8c):
 * now composes owned agents (listAgents) with shared-with-caller agents
 * (listSharedWithViewer) into one list, distinguished by `access`. Each is the
 * same repository call the web UI's Library uses for the equivalent split —
 * no third read path. A share-holder's write attempt still can't touch the
 * shared agent (push_agent always writes into principal.userId's OWN
 * namespace via upsertAgentFromImport — see lib/mcp/tools/importAgent.ts's
 * doc comment), so surfacing it here is read-only in the same structural
 * sense the web UI's shared view is.
 */

import { listAgents as listAgentsRepo, listSharedWithViewer } from '../../db/repository/index.js';
import type { McpPrincipal } from '../../auth/mcpGuard.js';

export const TOOL_NAME = 'list_agents';

export const TOOL_DESCRIPTION =
  "Lists the authenticated user's agents (id, name, description, source, platform, " +
  "updatedAt, access) — both agents the caller owns (access:'owner') and agents " +
  "someone else has shared with them (access:'shared', with the owner's email in " +
  "ownerEmail). There is no way to list another user's agents unless they were " +
  'explicitly shared with the caller.';

export type ListAgentsToolResult = {
  agents: Array<{
    id: string;
    name: string;
    description: string;
    source: string;
    platform: string;
    updatedAt: string;
    access: 'owner' | 'shared';
    ownerEmail?: string;
  }>;
};

/** Backed by listAgents(ownerId) + listSharedWithViewer(viewerId) — the same
 *  two repository calls resources/list uses, so the two stay in lockstep. */
export function handleListAgents(principal: McpPrincipal): ListAgentsToolResult {
  const owned = listAgentsRepo(principal.userId);
  const shared = listSharedWithViewer(principal.userId);

  return {
    agents: [
      ...owned.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        source: r.source,
        platform: r.platform,
        updatedAt: r.updatedAt,
        access: 'owner' as const,
      })),
      ...shared.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        source: r.source,
        platform: r.platform,
        updatedAt: r.updatedAt,
        access: 'shared' as const,
        ownerEmail: r.ownerEmail,
      })),
    ],
  };
}
