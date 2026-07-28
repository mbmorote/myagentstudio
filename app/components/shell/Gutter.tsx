'use client';

/**
 * app/components/shell/Gutter.tsx
 *
 * Plan 03 Phase B, B.4 — Drag-to-resize divider.
 *
 * Matches the mockup's .gv (vertical, col-resize) and .gh (horizontal, row-resize).
 * The accent-colored center line appears on hover/drag.
 *
 * Delegates drag logic to useResizable — the parent holds the size state.
 */

import { useState } from 'react';
import { useResizable } from '@/app/hooks/useResizable';

interface GutterProps {
  /** 'vertical' for left↔center / center↔right (column resize)
   *  'horizontal' for viz↔chat (row resize) */
  orientation: 'vertical' | 'horizontal';
  size: number;
  setSize: (size: number) => void;
  /** If true, dragging in the positive direction shrinks the target */
  invert?: boolean;
}

export function Gutter({ orientation, size, setSize, invert = false }: GutterProps) {
  const [isDragging, setIsDragging] = useState(false);
  const prop = orientation === 'vertical' ? 'w' : 'h';
  const { onMouseDown: baseMouseDown } = useResizable({ size, setSize, prop, invert });

  function handleMouseDown(e: React.MouseEvent) {
    setIsDragging(true);
    baseMouseDown(e);
    // Clear dragging state on mouseup
    function onUp() {
      setIsDragging(false);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mouseup', onUp);
  }

  if (orientation === 'vertical') {
    return (
      <div
        onMouseDown={handleMouseDown}
        className="flex-none w-[9px] cursor-col-resize relative group"
      >
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[3px] h-[34px] rounded-[3px] transition-colors duration-[120ms] ${
            isDragging ? 'bg-[var(--accent)]' : 'bg-[var(--border)] group-hover:bg-[var(--accent)]'
          }`}
        />
      </div>
    );
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      className="flex-none h-[9px] cursor-row-resize relative group"
    >
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[3px] w-[34px] rounded-[3px] transition-colors duration-[120ms] ${
          isDragging ? 'bg-[var(--accent)]' : 'bg-[var(--border)] group-hover:bg-[var(--accent)]'
        }`}
      />
    </div>
  );
}
