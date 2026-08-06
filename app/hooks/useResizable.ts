'use client';

/**
 * app/hooks/useResizable.ts
 *
 * Plan 03 Phase B, B.4 — Drag-to-resize hook.
 *
 * Ported from the mockup's onDown/onMove/onUp handlers.
 * Default clamps: 150–640px for widths, 120–520px for heights — overridable per
 * instance via min/max (2026-08-06, added for the raw panel's 200px floor).
 *
 * Usage: attach onMouseDown from the returned object to a gutter element.
 * The hook uses document-level mousemove/mouseup listeners (attached/removed
 * per drag session) so it handles fast cursor movement outside the gutter.
 */

import { useCallback } from 'react';

type ResizeProps = {
  /** Current size in pixels (controlled by parent via useState) */
  size: number;
  /** Setter from parent useState */
  setSize: (size: number) => void;
  /** 'w' for horizontal resize, 'h' for vertical resize */
  prop: 'w' | 'h';
  /** If true, dragging right/down shrinks the target (right panel, chat panel) */
  invert?: boolean;
  /** Overrides the default clamp floor/ceiling (150–640 for 'w', 120–520 for 'h'). */
  min?: number;
  max?: number;
};

export function useResizable({ size, setSize, prop, invert = false, min, max }: ResizeProps) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startSize = size;

      // Add cursor class to body to prevent flicker during drag
      if (prop === 'w') {
        document.body.style.cursor = 'col-resize';
      } else {
        document.body.style.cursor = 'row-resize';
      }
      document.body.style.userSelect = 'none';

      function onMove(ev: MouseEvent) {
        if (prop === 'w') {
          const delta = (ev.clientX - startX) * (invert ? -1 : 1);
          const next = Math.max(min ?? 150, Math.min(max ?? 640, startSize + delta));
          setSize(next);
        } else {
          const delta = (ev.clientY - startY) * (invert ? -1 : 1);
          const next = Math.max(min ?? 120, Math.min(max ?? 520, startSize + delta));
          setSize(next);
        }
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [size, setSize, prop, invert, min, max],
  );

  return { onMouseDown };
}
