'use client';

/**
 * app/components/Library/CreateAgentButton.tsx
 *
 * Plan 03 Phase C, C.6 — "+ New agent" action in the Library panel.
 *
 * Shows a minimal inline form with name + description inputs.
 * On success, navigates to the new agent's route (/agents/{id}).
 * On error, shows an inline message.
 *
 * Uses POST /api/agents (exists from Plan 01 Phase 4.8).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';

export function CreateAgentButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setCreating(true);
    setError(null);

    try {
      const response = await apiFetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });

      if (response.status === 409) {
        setError('An agent with that name already exists.');
        return;
      }
      if (!response.ok) {
        setError('Failed to create agent. Please try again.');
        return;
      }

      const dto = await response.json() as { id: string };
      setOpen(false);
      setName('');
      setDescription('');
      router.push(`/agents/${dto.id}`);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  if (!open) {
    return (
      <div
        onClick={() => setOpen(true)}
        className="flex items-center gap-[7px] px-3 py-[7px] text-[var(--muted)] cursor-pointer text-[12px] hover:text-[var(--text)]"
      >
        ＋ New agent
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setOpen(false); }}
        placeholder="Agent name"
        className="w-full border border-[var(--border)] rounded-[6px] px-2 py-1 text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        placeholder="Description (optional)"
        className="w-full border border-[var(--border)] rounded-[6px] px-2 py-1 text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      {error && <p className="text-[11px] text-[var(--err)]">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex-1 text-[11px] bg-[var(--accent)] text-white rounded-[6px] py-1 font-medium hover:opacity-90 disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] px-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
