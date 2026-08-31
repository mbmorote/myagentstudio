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
 * Revised 2026-08-17 — / is now the default landing page for signed-out visitors
 * instead of bouncing to /login (middleware.ts's PUBLIC_PATHS now includes /). No
 * session → render the same landing content as /welcome. A valid session falls through
 * to the pre-existing behaviour below unchanged.
 *
 * Zero owned agents AND zero shared-with-them agents → render WorkbenchShell in its
 * null-agent state.
 * Otherwise → redirect to the first owned agent, falling back to the first shared one
 * (Plan 15, §4.7 — a shared-only user must not land in the empty state; a wrongly
 * prioritized redirect would just be a different, subtler symptom of the same bug).
 */

import { redirect } from 'next/navigation';
import { listAgents, listSharedWithViewer, listGroups, getConfigCatalog, getSectionCatalog } from '@/lib/db/repository';
import { getSession } from '@/lib/auth/session';
import { isOAuthConfigured } from '@/lib/env';
import { WorkbenchShell } from '@/app/components/WorkbenchShell';
import { WelcomePage } from '@/app/components/Welcome/WelcomePage';

export default async function Home() {
  const session = await getSession();
  if (!session) {
    return <WelcomePage oauthConfigured={isOAuthConfigured()} />;
  }

  const agents = listAgents(session.userId);
  const sharedAgents = listSharedWithViewer(session.userId);

  if (agents.length === 0 && sharedAgents.length === 0) {
    const groups = listGroups(session.userId);
    const configCatalog = getConfigCatalog();
    const sectionCatalog = getSectionCatalog();

    return (
      <WorkbenchShell
        initialAgent={null}
        agents={agents}
        sharedAgents={sharedAgents}
        groups={groups}
        configCatalog={configCatalog}
        sectionCatalog={sectionCatalog}
        session={session}
      />
    );
  }

  redirect(`/agents/${agents.length > 0 ? agents[0].id : sharedAgents[0].id}`);
}
