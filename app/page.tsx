/**
 * app/page.tsx
 *
 * Phase 4.1 — Workbench shell (Server Component).
 *
 * Loads the single imported 'dev' agent (or the first agent in the DB) via the
 * repository and passes the initial AgentDTO to WorkbenchShell, the client-side
 * interactive wrapper. The Server Component only fetches data — all interactive
 * state (chat, raw-edit, interaction lock) lives in WorkbenchShell.
 *
 * MVP: left pane is a static placeholder (real library is a later plan).
 */

import { listAgents, getAgentFull } from '@/lib/db/repository';
import { WorkbenchShell } from '@/app/components/WorkbenchShell';
import type { AgentDTO } from '@/lib/db/repository';

export default function Home() {
  // Load the first agent in the list (dev agent after Gate 3 import).
  // In MVP there is exactly one agent; multi-agent selection is a later plan.
  const agents = listAgents();
  const firstAgent = agents.length > 0 ? getAgentFull(agents[0].id) : null;

  return <WorkbenchShell initialAgent={firstAgent as AgentDTO | null} />;
}
