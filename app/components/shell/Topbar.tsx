'use client';

/**
 * app/components/shell/Topbar.tsx
 *
 * Plan 03 Phase B, B.5 — Brand bar with theme toggle.
 *
 * Matches the mockup's .topbar. No layout switcher — Example A is the only
 * layout (R10). The theme toggle applies data-theme="light"|"dark" to
 * document.documentElement, which the CSS custom properties respond to.
 */

export function Topbar() {
  function toggleTheme() {
    const root = document.documentElement;
    const current =
      root.getAttribute('data-theme') ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
  }

  return (
    <div className="flex-none flex items-center gap-4 px-4 py-[9px] bg-[var(--panel)] border-b border-[var(--border)]">
      {/* Brand */}
      <div className="flex items-center gap-[9px] font-semibold tracking-[-0.01em] text-[var(--text)]">
        <span
          className="w-[9px] h-[9px] rounded-[2px] bg-[var(--accent)]"
          style={{ boxShadow: '0 0 0 3px var(--accent-wash)' }}
        />
        <span>Agent Workbench</span>
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="ml-auto text-[12px] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[7px] px-[11px] py-[5px] cursor-pointer hover:text-[var(--text)]"
      >
        ◐ Theme
      </button>
    </div>
  );
}
