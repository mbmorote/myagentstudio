'use client';

/**
 * app/components/shell/Rail.tsx
 *
 * Plan 03 Phase B, B.3 — Collapsed-panel icon rail.
 *
 * Matches the mockup's .rail — a narrow vertical strip shown when a side
 * panel is folded. Clicking it un-folds the panel.
 */

interface RailProps {
  /** Icon character (e.g. "▤" for Library, "≡" for Raw) */
  glyph: string;
  /** Label text displayed vertically */
  label: string;
  /** Called when the rail is clicked to un-fold */
  onUnfold: () => void;
  /**
   * Extra classes — used by WorkbenchShell to add a small gap (mr/ml-[9px]) on the
   * side facing the center panel. Folding a side panel also removes its resize
   * gutter (nothing left to drag), which had silently been providing that gap —
   * without this the rail sits flush against center. Prototyped 2026-07-29.
   */
  className?: string;
}

export function Rail({ glyph, label, onUnfold, className = '' }: RailProps) {
  return (
    <div
      onClick={onUnfold}
      title={`Show ${label}`}
      className={`flex-none w-[34px] bg-[var(--panel)] border border-[var(--border)] rounded-[9px] flex flex-col items-center gap-[10px] py-[10px] cursor-pointer text-[var(--muted)] hover:text-[var(--accent-ink)] hover:border-[var(--accent)] ${className}`}
    >
      <span className="text-[12px]">{glyph}</span>
      <span
        className="text-[11px] font-semibold tracking-[.08em] uppercase"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {label}
      </span>
    </div>
  );
}
