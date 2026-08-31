'use client';

/**
 * app/hooks/useAgentConfigSave.ts
 *
 * Plan 15 (D1, §6 step 8.5) — extracted from AgentView.tsx's "Config PATCH helpers"
 * section. Shared by ModelEffortControl and ConfigZone: `configError` is genuinely
 * ONE piece of shared state in the original monolith, not two independent ones — a
 * save failure from the header's model/effort popover surfaces in the SAME error
 * paragraph at the bottom of the Config zone, not near the popover itself. Splitting
 * this into two independent per-component error states would silently change that
 * behavior, so AgentView creates exactly one instance of this hook and passes the
 * result down to both.
 */

import { useState } from 'react';
import type { AgentDTO } from '@/lib/db/repository';
import { apiFetch } from '@/lib/apiFetch';

export function useAgentConfigSave(agent: AgentDTO, onAgentUpdated: (agent: AgentDTO) => void) {
  const [configError, setConfigError] = useState<string | null>(null);

  function currentConfigPairs(): { propKey: string; value: unknown }[] {
    return agent.config.map((c) => ({ propKey: c.propKey, value: c.value }));
  }

  async function saveConfig(newRows: { propKey: string; value: unknown }[]): Promise<void> {
    setConfigError(null);
    try {
      const res = await apiFetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: newRows }),
      });
      if (res.ok) {
        const dto = (await res.json()) as AgentDTO;
        onAgentUpdated(dto);
      } else {
        setConfigError('Save failed. Please try again.');
      }
    } catch {
      setConfigError('Network error. Please try again.');
    }
  }

  async function saveConfigKey(key: string, value: unknown): Promise<void> {
    const without = currentConfigPairs().filter((c) => c.propKey !== key);
    await saveConfig([...without, { propKey: key, value }]);
  }

  async function removeConfigKey(key: string): Promise<void> {
    await saveConfig(currentConfigPairs().filter((c) => c.propKey !== key));
  }

  return { configError, setConfigError, currentConfigPairs, saveConfig, saveConfigKey, removeConfigKey };
}
