'use client';

/**
 * app/components/shell/GuidedTour.tsx
 *
 * Ported from architecture/layout/Layout-Workbench.html's guided-tour prototype
 * (Plan 12 mini-tour, 2026-08-14) — a spotlight rect (giant box-shadow cutout, pulsing
 * accent ring) plus a popover that follows it. Seven steps over the actual core loop:
 * welcome, then Library (import) → Custom Visualization (edit direct) → Chat (edit via
 * AI) → the proposal's before/after comparison → Apply → Export.
 *
 * Two real-app differences from the mockup, both handled below rather than assumed away:
 *   - The mockup's demo chat always had a live proposal card to point at. Here, a fresh
 *     session has none until the user actually sends a chat message — steps 5/6 fall back
 *     to spotlighting the whole Chat panel (via a comma-separated selector list, most
 *     specific first) when #tourProposalCard / #tourApplyBtn don't exist yet.
 *   - The mockup's "Current value" block was open by default; the real ChatPanel keeps it
 *     collapsed behind a "show current ▾" toggle (2026-08-07 decision) — the comparison
 *     step's copy describes that toggle instead of assuming the comparison is already on
 *     screen.
 *
 * Exposes start() via ref so Topbar's replay button (owned by WorkbenchShell, a sibling of
 * this component) can trigger it without lifting the tour's own step state up a level.
 */

import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';

const TOUR_SEEN_KEY = 'myagent_tour_seen';

interface TourStep {
  target: string | null;
  title: string;
  body: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    target: null,
    title: 'Welcome to the Workbench',
    body: 'A quick look at the core loop: import an agent, edit it two ways, review what would change, apply it, then export. Six steps — skip to any of them, or exit any time.',
  },
  {
    target: '#tourLibrary',
    title: 'Library',
    body: 'Every agent lives here. "⇪ Import agent" brings in a .md file — its frontmatter is read directly, and the body goes to Daedalus or Hermes depending on the mode you pick.',
  },
  {
    target: '#tourCustomViz',
    title: 'Edit on Custom',
    body: 'The structured view: name, config, and sections as editable fields. Changes made here are direct — no AI in the loop, nothing to review before it’s saved.',
  },
  {
    target: '#tourChat',
    title: 'Edit on Chat',
    body: 'Describe the change you want in plain language. Prometheus proposes an edit here rather than applying it straight away — that proposal is what the next two steps walk through.',
  },
  {
    target: '#tourProposalCard, #tourChat',
    title: 'See the comparison',
    body: 'Once there’s a proposal, each changed row has a "show current ▾" toggle — click it to see exactly what’s there today next to what’s proposed, before you decide anything.',
  },
  {
    target: '#tourApplyBtn, #tourChat',
    title: 'Apply',
    body: 'Apply writes the change into the agent. Discard, right next to it, throws the proposal away and unlocks editing again — either way the choice is explicit, nothing happens on its own.',
  },
  {
    target: '#tourDownloadBtn, #tourRaw',
    title: 'Export',
    body: 'The Raw panel mirrors the real exported .md, live, as you edit. Download grabs it any time — there’s no separate export step to run first.',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface GuidedTourHandle {
  start: () => void;
}

interface GuidedTourProps {
  /** Called at tour start so both side panels are guaranteed visible for their steps. */
  onUnfoldLeft: () => void;
  onUnfoldRight: () => void;
}

function resolveTarget(selector: string | null): HTMLElement | null {
  if (!selector) return null;
  for (const sel of selector.split(',').map((s) => s.trim())) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

/** Nearest scrollable ancestor, or null. Used to clamp the spotlight to what's actually
 *  visible — a target row can be taller than its own scroll viewport (e.g. a long proposal
 *  in the Chat panel), and getBoundingClientRect ignores that clipping. */
function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export const GuidedTour = forwardRef<GuidedTourHandle, GuidedTourProps>(function GuidedTour(
  { onUnfoldLeft, onUnfoldRight },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [spotRect, setSpotRect] = useState<Rect | null>(null);
  const [popStyle, setPopStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const popRef = useRef<HTMLDivElement>(null);

  const position = useCallback(() => {
    const step = TOUR_STEPS[index];
    const el = resolveTarget(step.target);
    const pad = 6;
    const margin = 14;
    let rect: Rect | null = null;

    if (el) {
      const scroller = findScrollableAncestor(el);
      if (scroller) {
        el.scrollIntoView({ block: 'center' });
        const er = el.getBoundingClientRect();
        const sr = scroller.getBoundingClientRect();
        const top = Math.max(er.top, sr.top);
        const bottom = Math.min(er.bottom, sr.bottom);
        const left = Math.max(er.left, sr.left);
        const right = Math.min(er.right, sr.right);
        rect =
          bottom > top && right > left
            ? { top, left, width: right - left, height: bottom - top }
            : { top: sr.top, left: sr.left, width: sr.width, height: sr.height };
      } else {
        const er = el.getBoundingClientRect();
        rect = { top: er.top, left: er.left, width: er.width, height: er.height };
      }
    }

    setSpotRect(rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null);

    const pw = popRef.current?.offsetWidth ?? 380;
    const ph = popRef.current?.offsetHeight ?? 170;
    let top: number, left: number;
    if (!rect) {
      top = (window.innerHeight - ph) / 2;
      left = (window.innerWidth - pw) / 2;
    } else {
      // A tall, narrow target (a sidebar panel like Library) gets covered almost
      // entirely if the popover just stacks below/above it, since a panel that
      // narrow is thinner than the popover itself — prefer placing it BESIDE the
      // panel instead, top-aligned to it (found in browser review, 2026-08-18,
      // step 2/Library). Wider/shorter targets (a row, a button) keep the
      // original below → above → vertically-centered fallback chain.
      const isTallNarrow = rect.height > rect.width * 1.3 && rect.width < pw * 1.2;
      const fitsRight = rect.left + rect.width + margin + pw <= window.innerWidth;
      const fitsLeft = rect.left - margin - pw >= 0;

      if (isTallNarrow && (fitsRight || fitsLeft)) {
        left = fitsRight ? rect.left + rect.width + margin : rect.left - margin - pw;
        top = Math.max(margin, Math.min(rect.top, window.innerHeight - ph - margin));
      } else {
        if (rect.top + rect.height + margin + ph <= window.innerHeight) top = rect.top + rect.height + margin;
        else if (rect.top - margin - ph >= 0) top = rect.top - margin - ph;
        else top = Math.max(margin, (window.innerHeight - ph) / 2);
        left = rect.left + rect.width / 2 - pw / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
      }
    }
    setPopStyle({ top, left });
  }, [index]);

  // Re-measure whenever the visible step changes, and once more after the popover's own
  // content (which varies the popover's height) has actually painted.
  useLayoutEffect(() => {
    if (!open) return;
    position();
  }, [open, index, position]);

  useImperativeHandle(ref, () => ({
    start() {
      onUnfoldLeft();
      onUnfoldRight();
      setIndex(0);
      setOpen(true);
    },
  }));

  function end() {
    setOpen(false);
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  }

  // Auto-run once per browser.
  useLayoutEffect(() => {
    if (localStorage.getItem(TOUR_SEEN_KEY)) return;
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        onUnfoldLeft();
        onUnfoldRight();
        setIndex(0);
        setOpen(true);
      });
      // no cleanup needed for raf2 at this scope — component lifetime covers it
      void raf2;
    });
    return () => cancelAnimationFrame(raf1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  return (
    <>
      {/* Blocks interaction with the real UI behind it purely by sitting on top in the
          stacking order (no pointer-events:none) — same technique as the mockup's
          #tourBackdrop, no click handler needed to make it opaque to hit-testing. */}
      <div className="fixed inset-0 z-[200] cursor-default" />
      {spotRect && (
        <div
          className="tour-spot fixed z-[201] pointer-events-none transition-[top,left,width,height] duration-200 ease-out"
          style={{
            top: spotRect.top,
            left: spotRect.left,
            width: spotRect.width,
            height: spotRect.height,
          }}
        />
      )}
      <div
        ref={popRef}
        className="fixed z-[202] w-[380px] bg-[var(--panel)] text-[var(--text)] border border-[var(--border)] rounded-[10px] shadow-[0_12px_40px_rgba(0,0,0,.32)] py-[18px] px-[20px]"
        style={{ top: popStyle.top, left: popStyle.left }}
        role="dialog"
        aria-modal="true"
      >
        <div className="text-[11px] font-bold tracking-[.06em] uppercase text-[var(--faint)] mb-[8px]">
          {index + 1} / {TOUR_STEPS.length}
        </div>
        <div className="text-[17px] font-bold mb-[8px]">{step.title}</div>
        <div className="text-[14px] text-[var(--muted)] leading-[1.6]">{step.body}</div>
        <div className="flex items-center justify-between gap-[10px] mt-[18px]">
          <button
            type="button"
            onClick={end}
            className="text-[13px] rounded-[7px] px-[4px] py-[6px] border-none bg-transparent text-[var(--muted)] cursor-pointer hover:text-[var(--text)]"
          >
            Exit
          </button>
          <div className="flex gap-[8px]">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              className="text-[13px] rounded-[7px] px-[14px] py-[7px] border border-[var(--border)] bg-[var(--elev)] text-[var(--muted)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:text-[var(--text)] enabled:hover:border-[var(--text)]"
            >
              ‹ Prev
            </button>
            <button
              type="button"
              onClick={() => (isLast ? end() : setIndex((i) => i + 1))}
              className="text-[13px] rounded-[7px] px-[14px] py-[7px] border-none bg-[var(--accent)] text-white font-semibold cursor-pointer hover:brightness-110"
            >
              {isLast ? 'Finish ✓' : 'Next ›'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
});
