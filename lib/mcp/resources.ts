import 'server-only';

/**
 * lib/mcp/resources.ts
 *
 * MCP resources (Plan 13 §4.5): exposes each of the caller's agents as a
 * myagentstudio://agent/{id} resource, addressable content a client can attach without
 * a tool call or a model decision. Read scope only.
 *
 * Backed by the exact same two repository calls list_agents and export_agent use
 * (listAgents / exportAgentMarkdown) — no third data path, so a resource read and
 * an export_agent call are guaranteed to return byte-identical text for the same
 * agent.
 */

import { listAgents as listAgentsRepo, exportAgentMarkdown } from '../db/repository/index.js';
import type { McpPrincipal } from '../auth/mcpGuard.js';

export const RESOURCE_URI_SCHEME = 'myagentstudio';
export const RESOURCE_URI_TEMPLATE = 'myagentstudio://agent/{id}';

export type ResourceListEntry = {
  uri: string;
  name: string;
  description: string;
  mimeType: 'text/markdown';
};

/** resources/list — mirrors list_agents' owner scoping exactly. */
export function listResourcesForPrincipal(principal: McpPrincipal): ResourceListEntry[] {
  const rows = listAgentsRepo(principal.userId);
  return rows.map((r) => ({
    uri: `myagentstudio://agent/${r.id}`,
    name: r.name,
    description: r.description,
    mimeType: 'text/markdown' as const,
  }));
}

/**
 * resources/read for a myagentstudio://agent/{id} URI. Returns null for an agentId that
 * does not exist or does not belong to this principal — same non-disclosure posture
 * as export_agent.
 */
export function readAgentResource(principal: McpPrincipal, agentId: string): string | null {
  return exportAgentMarkdown(agentId, principal.userId);
}
