'use client';

/**
 * app/hooks/useOutsideClick.ts
 *
 * Plan 15 (D1, AgentView.tsx refactor, §6 step 8.5) — extracted from 7 near-identical
 * hand-rolled "close this popover/editor on outside click" effects that used to live
 * directly in AgentView.tsx (one each for the model+effort popover, the scalar-value
 * pick popover, the initial-prompt block, a custom-JSON block, the tool picker, the
 * add-key menu, and the add-section menu — an 8th, deselecting a selected list-item
 * pill, has no element to check against and fires on any click at all).
 *
 * Preserves the original callers' "always call the LATEST onOutside, but only
 * attach/detach the listener when active/selector actually change" behavior — several
 * call sites (the initial-prompt block, a custom-JSON block) close over draft state
 * that changes on every keystroke; re-subscribing the listener on every keystroke
 * would be wasteful. The internal ref is reassigned on every render (a safe, standard
 * React idiom — refs don't trigger re-renders and mutating one during render is fine),
 * so the effect's own dependency array can stay minimal.
 *
 * selector: null means "any outside click at all" (no element to scope against) —
 * the list-item-pill-deselect case.
 */

import { useEffect, useRef } from 'react';

export function useOutsideClick(active: boolean, selector: string | null, onOutside: () => void): void {
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;

  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (selector === null) {
        onOutsideRef.current();
        return;
      }
      const el = document.querySelector(selector);
      if (el && !el.contains(e.target as Node)) onOutsideRef.current();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [active, selector]);
}
