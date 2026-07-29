/**
 * app/agents/[id]/page.tsx
 *
 * Plan 03 Phase C, C.2 — Per-agent route.
 *
 * Same Server Component shape as the old app/page.tsx (loads one full AgentDTO
 * via getAgentFull) but keyed off the route param. Also loads listAgents() and
 * listGroups() for the Library panel and the config group-membership pills.
 *
 * getConfigCatalog() (2026-07-29 — closes catalog seed drift) loads the full config
 * catalog fresh from the DB on every request, passed down to AgentView instead of it
 * statically importing CONFIG_DEFS — so a catalog.ts edit + `npm run db:seed` + a page
 * reload is enough to update the UI, no rebuild/redeploy needed.
 *
 * 404 (Next's notFound()) if the agent ID doesn't exist.
 *
 * key={agent.id} is passed to WorkbenchShell so Next.js re-mounts the client
 * component when navigating between agents, resetting all local state (chat
 * history, interaction lock, fold/resize — R5, R15).
 */

import { notFound } from 'next/navigation';
import { getAgentFull, listAgents, listGroups, getConfigCatalog } from '@/lib/db/repository';
import { WorkbenchShell } from '@/app/components/WorkbenchShell';
import type { AgentDTO } from '@/lib/db/repository';

interface AgentPageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentPage({ params }: AgentPageProps) {
  const { id } = await params;

  const agent = getAgentFull(id);
  if (!agent) notFound();

  const agents = listAgents();
  const groups = listGroups();
  const configCatalog = getConfigCatalog();

  return (
    <WorkbenchShell
      key={agent.id}
      initialAgent={agent as AgentDTO}
      agents={agents}
      groups={groups}
      configCatalog={configCatalog}
    />
  );
}
