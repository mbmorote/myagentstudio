import 'server-only';

/**
 * lib/mcp/resources.ts
 *
 * MCP resources (Plan 13 §4.5): exposes each agent the caller can read (owned
 * or, per Plan 15 D8/§6 step 8c, shared with them) as a myagentstudio://agent/{id}
 * resource, addressable content a client can attach without a tool call or a
 * model decision. Read scope only.
 *
 * Backed by the exact same repository calls list_agents and pull_agent use
 * (listAgents + listSharedWithViewer / exportAgentMarkdownForViewer) — no third
 * data path, so a resource list matches list_agents' agent set exactly, and a
 * resource read is guaranteed byte-identical to a pull_agent call for the same
 * agent.
 */

import { listAgents as listAgentsRepo, listSharedWithViewer, exportAgentMarkdownForViewer } from '../db/repository/index.js';
import type { McpPrincipal } from '../auth/mcpGuard.js';

export const RESOURCE_URI_SCHEME = 'myagentstudio';
export const RESOURCE_URI_TEMPLATE = 'myagentstudio://agent/{id}';

export type ResourceListEntry = {
  uri: string;
  name: string;
  description: string;
  mimeType: 'text/markdown';
};

/** resources/list — mirrors list_agents' owner-or-share-holder scoping exactly. */
export function listResourcesForPrincipal(principal: McpPrincipal): ResourceListEntry[] {
  const owned = listAgentsRepo(principal.userId);
  const shared = listSharedWithViewer(principal.userId);
  return [...owned, ...shared].map((r) => ({
    uri: `myagentstudio://agent/${r.id}`,
    name: r.name,
    description: r.description,
    mimeType: 'text/markdown' as const,
  }));
}

/**
 * resources/read for a myagentstudio://agent/{id} URI. Returns null for an agentId
 * that does not exist or the caller has no access to (neither owner nor
 * share-holder) — same non-disclosure posture as pull_agent.
 */
export function readAgentResource(principal: McpPrincipal, agentId: string): string | null {
  return exportAgentMarkdownForViewer(agentId, principal.userId);
}
