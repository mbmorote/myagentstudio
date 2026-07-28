/**
 * app/agents/[id]/page.tsx
 *
 * Plan 03 Phase C, C.2 — Per-agent route.
 *
 * Same Server Component shape as the old app/page.tsx (loads one full AgentDTO
 * via getAgentFull) but keyed off the route param. Also loads listAgents() and
 * listGroups() for the Library panel and the config group-membership pills.
 *
 * 404 (Next's notFound()) if the agent ID doesn't exist.
 *
 * key={agent.id} is passed to WorkbenchShell so Next.js re-mounts the client
 * component when navigating between agents, resetting all local state (chat
 * history, interaction lock, fold/resize — R5, R15).
 */

import { notFound } from 'next/navigation';
import { getAgentFull, listAgents, listGroups } from '@/lib/db/repository';
import { WorkbenchShell } from '@/app/components/WorkbenchShell';
import { LibraryPanel } from '@/app/components/Library/LibraryPanel';
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

  return (
    <WorkbenchShell
      key={agent.id}
      initialAgent={agent as AgentDTO}
      agents={agents}
      groups={groups}
      libraryContent={
        <LibraryPanel
          currentAgentId={agent.id}
          agents={agents}
          groups={groups}
        />
      }
    />
  );
}
