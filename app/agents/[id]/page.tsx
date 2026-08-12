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
 * 404 (Next's notFound()) if the agent ID doesn't exist or is not owned by the caller.
 *
 * key={agent.id} is passed to WorkbenchShell so Next.js re-mounts the client
 * component when navigating between agents, resetting all local state (chat
 * history, interaction lock, fold/resize — R5, R15).
 *
 * Requires an authenticated session — middleware and requirePageSession() both guard.
 */

import { notFound } from 'next/navigation';
import { getAgentFull, listAgents, listGroups, getConfigCatalog, getSectionCatalog } from '@/lib/db/repository';
import { WorkbenchShell } from '@/app/components/WorkbenchShell';
import type { AgentDTO } from '@/lib/db/repository';
import { requirePageSession } from '@/lib/auth/session';

interface AgentPageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentPage({ params }: AgentPageProps) {
  const session = await requirePageSession(`/agents/${(await params).id}`);
  const { id } = await params;

  const agent = getAgentFull(id, session.userId);
  if (!agent) notFound();

  const agents = listAgents(session.userId);
  const groups = listGroups(session.userId);
  const configCatalog = getConfigCatalog();
  const sectionCatalog = getSectionCatalog(agent.platform);

  return (
    <WorkbenchShell
      key={agent.id}
      initialAgent={agent as AgentDTO}
      agents={agents}
      groups={groups}
      configCatalog={configCatalog}
      sectionCatalog={sectionCatalog}
      session={session}
    />
  );
}
