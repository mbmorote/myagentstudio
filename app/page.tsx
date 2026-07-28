/**
 * app/page.tsx
 *
 * Plan 03 Phase C, C.1 — Rewritten per R5.
 *
 * Zero agents → render empty state.
 * One or more agents → redirect to /agents/{first.id}.
 *
 * (Phase B's shell alignment needs group data; this file is updated in C.1
 * to also redirect. The heavy lifting moves to app/agents/[id]/page.tsx.)
 */

import { redirect } from 'next/navigation';
import { listAgents } from '@/lib/db/repository';

export default function Home() {
  const agents = listAgents();

  if (agents.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          color: 'var(--faint)',
          fontFamily: 'var(--ui)',
          fontSize: '13px',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--muted)' }}>No agents yet</p>
        <p style={{ fontSize: '12px' }}>
          Import an agent via{' '}
          <code style={{ fontFamily: 'var(--mono)', color: 'var(--accent-ink)' }}>
            POST /api/agents/import
          </code>{' '}
          to get started.
        </p>
      </div>
    );
  }

  redirect(`/agents/${agents[0].id}`);
}
