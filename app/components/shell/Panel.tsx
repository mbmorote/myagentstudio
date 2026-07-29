'use client';

/**
 * app/components/shell/Panel.tsx
 *
 * Plan 03 Phase B, B.2 — Reusable panel chrome.
 *
 * Matches the mockup's .panel / .phead / .pbody pattern:
 *   - Header: glyph + uppercase label + optional .role subtitle + optional fold button
 *   - Body: scrollable flex-1 area
 *
 * Used for all four panes: Library (left), Custom Viz (center-top),
 * Chat (center-bottom), Raw (right).
 */

interface PanelProps {
  /** Icon character shown before the label (e.g. "▤", "◈", "✦", "≡") */
  glyph: string;
  /** Uppercase panel label */
  label: string;
  /**
   * Optional subtitle shown right-aligned in a smaller muted font. Accepts a node
   * (not just a string) so the Library panel's Agents/Grouped toggle — prototyped
   * 2026-07-29 — can render as a clickable element here.
   */
  role?: React.ReactNode;
  /** If true, shows a collapse button (⟨ or ⟩ depending on side) */
  foldable?: boolean;
  /** Which direction the fold button points — left panels fold left (⟨), right panels (⟩) */
  foldDirection?: 'left' | 'right';
  /** Called when the fold button is clicked */
  onFold?: () => void;
  /** Children are the scrollable body content */
  children?: React.ReactNode;
  /** Additional class names for the panel container */
  className?: string;
  /** Inline styles for sized panels (e.g. { width: 218 } or { height: 240 }) */
  style?: React.CSSProperties;
}

export function Panel({
  glyph,
  label,
  role,
  foldable,
  foldDirection = 'left',
  onFold,
  children,
  className = '',
  style,
}: PanelProps) {
  return (
    <div
      className={`flex flex-col min-w-0 min-h-0 overflow-hidden rounded-[9px] border border-[var(--border)] bg-[var(--panel)] ${className}`}
      style={style}
    >
      {/* Panel header — .phead */}
      <div
        className="flex-none flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--elev)] text-[11px] font-semibold tracking-[.06em] uppercase text-[var(--muted)]"
      >
        <span className="text-[var(--accent)]">{glyph}</span>
        <span>{label}</span>
        {role && (
          <span className="ml-auto font-medium tracking-[.03em] normal-case text-[var(--faint)] text-[10px]">
            {role}
          </span>
        )}
        {foldable && onFold && (
          <button
            onClick={onFold}
            title="Collapse"
            className="ml-2 w-5 h-5 flex-none border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)] rounded-[5px] text-[11px] grid place-items-center hover:text-[var(--accent-ink)] hover:border-[var(--accent)] cursor-pointer"
          >
            {foldDirection === 'left' ? '⟨' : '⟩'}
          </button>
        )}
      </div>

      {/* Panel body — .pbody */}
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>
    </div>
  );
}
