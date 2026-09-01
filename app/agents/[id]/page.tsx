/**
 * app/agents/[id]/page.tsx
 *
 * Plan 03 Phase C, C.2 — Per-agent route.
 *
 * Plan 15 (2026-08-31, §6 step 10) — switched from the owner-scoped getAgentFull() to
 * the viewer-scoped getAgentFullForViewer(): the caller may now be the owner OR a
 * share-holder, and WorkbenchShell branches its whole layout on which (constraint 1,
 * plans/archive/15-share-agent.md §3 — a 'shared' access value is never treated as ownership).
 * getAgentFull() itself is untouched (constraint 2) — every other still-owner-only
 * caller is unaffected.
 *
 * Also loads listAgents() (owned) AND listSharedWithViewer() (shared-with-them) for the
 * Library panel — unconditionally, regardless of which agent is currently open, since
 * the Library shows the viewer's whole world either way.
 *
 * getConfigCatalog() (2026-07-29 — closes catalog seed drift) loads the full config
 * catalog fresh from the DB on every request, passed down to AgentView instead of it
 * statically importing CONFIG_DEFS — so a catalog.ts edit + `npm run db:seed` + a page
 * reload is enough to update the UI, no rebuild/redeploy needed. Only meaningful for the
 * owner's editable AgentView — SharedAgentView reads each config item's `def` straight
 * off the AgentDTO (already embedded per §5 of Plan 01), so it needs neither catalog.
 *
 * 404 (Next's notFound()) if the agent ID doesn't exist, or the caller is neither its
 * owner nor a share-holder.
 *
 * key={agent.id} is passed to WorkbenchShell so Next.js re-mounts the client
 * component when navigating between agents, resetting all local state (chat
 * history, interaction lock, fold/resize — R5, R15).
 *
 * Requires an authenticated session — middleware and requirePageSession() both guard.
 */

import { notFound } from 'next/navigation';
import { getAgentFullForViewer, listAgents, listSharedWithViewer, listGroups, getConfigCatalog, getSectionCatalog } from '@/lib/db/repository';
import { WorkbenchShell } from '@/app/components/WorkbenchShell';
import { requirePageSession } from '@/lib/auth/session';

interface AgentPageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentPage({ params }: AgentPageProps) {
  const session = await requirePageSession(`/agents/${(await params).id}`);
  const { id } = await params;

  const resolved = getAgentFullForViewer(id, session.userId);
  if (!resolved) notFound();
  const { agent, access, ownerEmail } = resolved;

  const agents = listAgents(session.userId);
  const sharedAgents = listSharedWithViewer(session.userId);
  const groups = listGroups(session.userId);
  const configCatalog = getConfigCatalog();
  const sectionCatalog = getSectionCatalog(agent.platform);

  return (
    <WorkbenchShell
      key={agent.id}
      initialAgent={agent}
      agents={agents}
      sharedAgents={sharedAgents}
      groups={groups}
      configCatalog={configCatalog}
      sectionCatalog={sectionCatalog}
      session={session}
      access={access}
      ownerEmail={ownerEmail}
    />
  );
}
