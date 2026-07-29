'use client';

/**
 * app/components/Library/ImportButton.tsx
 *
 * Plan 03 Phase D, D.2 — "⇪ Import agent" action row in the Library panel.
 *
 * Opens the ImportDialog (D.3) and holds its open/closed state.
 */

import { useState } from 'react';
import { ImportDialog } from '@/app/components/Library/ImportDialog';

export function ImportButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className="flex items-center gap-[7px] px-3 py-[7px] text-[var(--muted)] cursor-pointer text-[12px] hover:text-[var(--text)]"
      >
        ⇪ Import agent
      </div>
      <ImportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
