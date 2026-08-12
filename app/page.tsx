/**
 * app/page.tsx
 *
 * Plan 03 Phase C, C.1 — Rewritten per R5.
 * Revised 2026-07-31 (roadmap TODO item 1) — zero-agents branch now renders
 * WorkbenchShell with initialAgent={null} instead of a bare, Topbar-less div, so a
 * fresh signup can still log out / reach Account / import or create a first agent.
 * WorkbenchShell and LibraryPanel already had null-agent fallbacks built in (Viz/Chat/
 * Raw panels' "No agent loaded" states, LibraryPanel's now-optional currentAgentId) —
 * this was previously unreachable dead code, not a new UI.
 *
 * Zero agents → render WorkbenchShell in its null-agent state.
 * One or more agents → redirect to /agents/{first.id}.
 *
 * Requires an authenticated session — unauthenticated visitors are redirected to
 * /login?next=/ by middleware, and requirePageSession() is a second guarantee.
 */

import { redirect } from 'next/navigation';
import { listAgents, listGroups, getConfigCatalog, getSectionCatalog } from '@/lib/db/repository';
import { requirePageSession } from '@/lib/auth/session';
import { WorkbenchShell } from '@/app/components/WorkbenchShell';

export default async function Home() {
  const session = await requirePageSession('/');
  const agents = listAgents(session.userId);

  if (agents.length === 0) {
    const groups = listGroups(session.userId);
    const configCatalog = getConfigCatalog();
    const sectionCatalog = getSectionCatalog();

    return (
      <WorkbenchShell
        initialAgent={null}
        agents={agents}
        groups={groups}
        configCatalog={configCatalog}
        sectionCatalog={sectionCatalog}
        session={session}
      />
    );
  }

  redirect(`/agents/${agents[0].id}`);
}
