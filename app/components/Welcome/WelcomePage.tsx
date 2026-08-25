'use client';

/**
 * app/components/Welcome/WelcomePage.tsx
 *
 * Plan 12 — pre-login landing page, ported from reference/layout/Layout-Landing.html
 * (2026-08-14). Public route (see /welcome/page.tsx + middleware.ts PUBLIC_PATHS) — the
 * first thing a prospective, non-signed-up visitor sees; distinct audience from the
 * first-login guided tour (GuidedTour.tsx), which only signed-up users ever see.
 *
 * Walkthrough step screenshots (2026-08-17): real PNGs in public/welcome/, referenced by
 * WalkStep.image and rendered by WalkShot via a plain <img object-cover>. A step without
 * an `image` set falls back to its italic `shot` placeholder text — screenshots get
 * added one step at a time, not all-or-nothing. Source screenshots are full-browser
 * captures of the real running app (not pre-cropped) — object-cover centers and crops
 * to the 9:5 frame, which works because the captured dialog/panel is itself
 * horizontally centered in the source screenshot.
 * The feature grid and roadmap teaser use real content (not the mock's Lorem-Ipsum filler
 * cards / generic "Feature N" teaser items) — see docs/roadmap.md for the roadmap source.
 *
 * Footer author identity (name/LinkedIn/GitHub/email) is read from NEXT_PUBLIC_AUTHOR_*
 * env vars rather than hardcoded here, so it's a one-line .env.local edit instead of a
 * code change — see .env.example. Falls back to a visible placeholder when unset, never
 * to blank/broken links.
 *
 * Sizing (2026-08-17): every dimension below (font sizes, padding, gaps, widths, radii,
 * shadow offsets) is the mock's own Layout-Landing.html value multiplied by 1.1 and
 * hardcoded, NOT a CSS zoom applied at render time. The mock scales its whole page via
 * body{zoom:1.1} ("scale spacing/sizing together... instead of hand-tuning every
 * padding/gap/icon") — real values were chosen here instead so DevTools/computed-styles
 * show the true rendered size and so the page doesn't depend on `zoom` (Firefox only
 * gained support in mid-2024). Two deliberate simplifications: 1px/2px hairline borders
 * are left unscaled (imperceptible at this multiplier, and every design system treats
 * hairlines as a fixed unit regardless of scale); em-based letter-spacing and the
 * unitless line-height ratio already scale automatically with font-size, so those were
 * left as-is. The embedded LoginForm/SignupForm inside this page's two auth modals are
 * NOT scaled — they render at the same size as the standalone /login and /signup pages,
 * since scaling them would mean touching those shared components and changing pages
 * outside this one's scope; the modal backdrop fully obscures the rest of the landing
 * page while open, so the two aren't seen side-by-side.
 */

import { Suspense, useEffect, useState } from 'react';
import { LoginForm } from '@/app/components/Auth/LoginForm';
import { SignupForm } from '@/app/components/Auth/SignupForm';

const AUTHOR_NAME = process.env.NEXT_PUBLIC_AUTHOR_NAME || 'the user';
const AUTHOR_LINKEDIN = process.env.NEXT_PUBLIC_AUTHOR_LINKEDIN || '#';
const AUTHOR_GITHUB = process.env.NEXT_PUBLIC_AUTHOR_GITHUB || '#';
const AUTHOR_EMAIL = process.env.NEXT_PUBLIC_AUTHOR_EMAIL || '#';

interface WalkStep {
  kicker: string;
  title: string;
  desc: string;
  shot: string;
  /** Real product screenshot, served from public/welcome/. Falls back to the italic
   *  `shot` placeholder text in WalkShot when unset — steps get real images one at a
   *  time as they're captured, not all-or-nothing. */
  image?: string;
  /** CSS object-position for `image` (e.g. '80% center') — shifts which part of the
   *  source screenshot stays visible under object-cover's crop. Defaults to 'center'.
   *  Needed per-step since each screenshot's own aspect ratio/content varies. */
  imagePosition?: string;
  /** Separate, usually higher-detail screenshot for the "Full view" modal (file name
   *  convention: step-N-name-full.jpg in public/welcome/). Falls back to `image` when a
   *  step doesn't have one yet — steps get their -full version one at a time, same
   *  incremental pattern as `image` itself. */
  fullImage?: string;
  /** object-fit for `fullImage` in the modal (see WalkShot.imageFit) — 'contain' for a
   *  source far from the 9:5 frame ratio (e.g. step-1-import-full.jpg is portrait,
   *  567×798; cover would crop it down to ~39% of its own height). Only applies to the
   *  modal; the inline card always uses `image`, which stays on 'cover'. */
  fullImageFit?: 'cover' | 'contain';
  /** object-position for `fullImage` specifically — separate from `imagePosition` so
   *  repositioning the modal's (usually differently-cropped) screenshot never affects
   *  the inline card's. Falls back to `imagePosition` when unset. */
  fullImagePosition?: string;
  /** Extra zoom for `fullImage` on top of object-fit:cover (see WalkShot.imageZoom) —
   *  e.g. 1.3 for 30% more than cover's own (often near-1x) scale. */
  fullImageZoom?: number;
}

const WALK_STEPS: WalkStep[] = [
  {
    kicker: 'STEP 1 — IMPORT',
    title: 'Bring in any agent',
    desc: 'Drop in a .md agent file — Structural mode reorganizes it into a clean, canonical layout; Strict mode keeps your structure and just labels it. Nothing gets silently dropped.',
    shot: '[ screenshot — import dialog ]',
    image: '/welcome/step-1-import.jpg',
    fullImage: '/welcome/step-1-import-full.jpg',
    fullImageFit: 'contain',
  },
  {
    kicker: 'STEP 2 — SEE',
    title: 'See the whole agent at once',
    desc: 'Every section — Role, Behavior, Guardrails, Output — sits on screen together, always. No more losing track of an agent inside a chat transcript or a wall of YAML.',
    shot: '[ screenshot — structured view, all sections expanded ]',
    image: '/welcome/step-2-see.jpg',
    fullImage: '/welcome/step-2-see-full.jpg',
    fullImageFit: 'cover',
    fullImagePosition: 'left top',
    fullImageZoom: 1.3,
  },
  {
    kicker: 'STEP 3 — EDIT',
    title: 'Edit it directly, or just describe the change',
    desc: "Change a field by hand, or tell the built-in chat what you want — it already knows the agent's full current state, so it proposes a precise edit instead of guessing.",
    shot: '[ screenshot — structured view + chat, mid-edit ]',
    image: '/welcome/step-3-edit.jpg',
    imagePosition: 'left center',
    fullImage: '/welcome/step-3-edit-full.jpg',
    // Reset to center for the full image (not 'left center') — that position was tuned
    // for the regular image's own crop need; the full image is different dimensions
    // (991×545, close to the 9:5 target) and needs no special positioning.
    fullImagePosition: 'center',
  },
  {
    // Kicker/title reworked (ux-agent finding #5, 2026-08-17) — "REVIEW & EXPORT" read
    // as two ideas bolted into one slot next to steps 1-3's single clean verbs. One
    // cohesive phrase now, still honest that both a review gate and an export happen.
    kicker: 'STEP 4 — SHIP IT',
    title: 'Approve it, then ship it',
    desc: "Every proposed change shows as a diff before it applies — nothing writes itself. When you're done, export the result as a plain agent file, ready for your own tools.",
    shot: '[ screenshot — proposal diff / export ]',
    image: '/welcome/step-4-review.jpg',
    fullImage: '/welcome/step-4-review-full.jpg',
    // Explicit, not just relying on WalkShot's default (ux-agent finding #4,
    // 2026-08-17) — step-4-review-full.jpg (969×516, ratio 1.88) is already close
    // enough to 9:5 that cover/center barely crops anything, so no zoom/reposition is
    // actually needed here unlike steps 1-2 — but leaving it implicit read as "this one
    // got skipped" rather than "this one was checked and is fine as-is".
    fullImageFit: 'cover',
    fullImagePosition: 'center',
  },
];

// Real features only — the mock's grid had 2 Lorem-Ipsum filler cards to round out a
// 6-card layout; dropped rather than shipped, grid reflowed to a clean 2x2 of the 4
// real ones instead of forcing placeholder copy into production.
//
// Revised 2026-08-18 (Plans 11/13 shipped, content review with the user): "AI-guided
// editing" dropped — it's the hero trust-strip card's whole story already, repeating it
// here was the weakest card. "More providers, soon" → "Multiple AI providers" (shipped,
// not "soon" — Plan 11). "Nothing gets lost on import" added — the import safety-net
// story (Structural reorganizes, Strict labels in place, anything unplaceable becomes
// its own section rather than being dropped) wasn't represented anywhere in this grid.
// MCP/console access deliberately NOT a card here — it's the roadmap wave's new
// "Shipped" headline instead, so it isn't told a third time across the page.
const FEATURES = [
  { title: 'Multiple AI providers', desc: 'Switch vendors behind one interface — not locked to a single model provider.' },
  { title: 'Structured + raw views', desc: 'See the same agent both ways, always in sync.' },
  { title: 'Nothing gets lost on import', desc: 'Structural or Strict, either way — anything the importer can’t confidently place becomes its own section, never silently dropped.' },
  { title: 'Export to your platform', desc: 'Round-trips cleanly back to plain agent files.' },
];

// Trimmed from docs/roadmap.md (the curated, plain-language capability list) — not
// generic "Feature N short example" filler. One shipped + one in-progress + two planned,
// matching the wave line's Shipped/Building/Planned/Planned rhythm.
//
// Revised 2026-08-18 (Plans 11/13 shipped, content review with the user): "AI chat
// editing" retired from this slot — it's already the hero card's whole story, so MCP
// takes the "Shipped" spotlight instead since it hasn't been told anywhere else on the
// page. "A second AI provider" removed (shipped — now FEATURES card #1, "Multiple AI
// providers"). "Group organization" swapped out of Planned for "A Skill module" and
// "Mobile access" — the user's picks; mobile access is deliberately an open idea, not a
// commitment (see plans/roadmap.md IDEA bucket "Mobile access to the workbench" — not
// decided-if or decided-how yet).
const ROADMAP_TEASER = [
  { status: 'Shipped', title: 'MCP / console access', down: false, open: false },
  { status: 'Building now', title: 'Sharing & forking agents', down: true, open: true },
  { status: 'Planned', title: 'A Skill module', down: false, open: true },
  { status: 'Planned', title: 'Mobile access', down: true, open: true },
];

interface WelcomePageProps {
  oauthConfigured: boolean;
}

export function WelcomePage({ oauthConfigured }: WelcomePageProps) {
  const [step, setStep] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  // Single slot for whichever auth modal is open (never both) — lets "Sign in"/"Sign up
  // with an invite code" inside one form switch straight to the other without navigating
  // away from /welcome.
  const [authModal, setAuthModal] = useState<'login' | 'signup' | null>(null);
  // Which SignupForm sub-form the signup modal opens into — the "Get started" CTA below
  // and the login modal's two account-creation links (2026-08-18 fix) each set this
  // explicitly before opening the modal, since the same modal JSX block is shared
  // between all three triggers.
  const [signupMode, setSignupMode] = useState<'signup' | 'request'>('request');

  const s = WALK_STEPS[step];
  const next = () => setStep((i) => (i + 1) % WALK_STEPS.length);
  const prev = () => setStep((i) => (i - 1 + WALK_STEPS.length) % WALK_STEPS.length);

  // Escape-to-close + arrow-key step navigation (ux-agent finding #8, 2026-08-17) — a
  // fullscreen modal with neither was a papercut for anyone used to normal web behavior.
  // Only attached while the modal is actually open.
  useEffect(() => {
    if (!modalOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setModalOpen(false);
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen, next, prev]);

  return (
    // h-screen + overflow-y-auto (not min-h-screen): app/globals.css sets body{overflow:hidden}
    // for the fixed-viewport Workbench shell, which fights a normal scrolling page — this div
    // becomes its own scroll container instead, so the sticky nav/footer stick correctly
    // relative to it.
    <div className="flex flex-col h-screen overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-[5] border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center gap-[17.6px] max-w-[1078px] mx-auto px-[30.8px] py-[13.2px]">
          <div className="flex items-center gap-[9.9px] font-bold tracking-[-0.01em] text-[16.5px]">
            <span
              className="w-[9.9px] h-[9.9px] rounded-[2.2px] bg-[var(--accent)]"
              style={{ boxShadow: '0 0 0 3.3px var(--accent-wash)' }}
            />
            MyAgentStudio
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setAuthModal('login')}
            className="text-[14.3px] font-semibold text-[var(--accent-ink)] bg-transparent border border-[var(--border)] rounded-[7.7px] px-[17.6px] py-[7.7px] cursor-pointer hover:border-[var(--accent)]"
          >
            Log in
          </button>
        </div>
      </div>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <div className="px-[30.8px] pt-[39.6px] pb-[8.8px] max-w-[1078px] mx-auto text-center">
        <h1 className="font-bold text-[37.4px] leading-[1.2] mx-auto mb-[11px] tracking-[-0.02em] max-w-[792px]">
          Your agent library, now visual
        </h1>
        <p className="text-[17.05px] text-[var(--muted)] mx-auto mb-[8.8px] max-w-[704px]">
          One workbench to see, edit, and organize every agent you maintain — by hand or by
          chat, with nothing hidden and nothing written until you approve it.
        </p>
      </div>

      {/* ── Walkthrough card ────────────────────────────────────────────── */}
      <div className="px-[30.8px] pt-[4.4px] pb-[6.6px] max-w-[1078px] mx-auto w-full text-center">
        <h2 className="font-bold text-[22px] mb-[6.6px]">How it works</h2>
        <p className="text-[14.3px] text-[var(--muted)] mb-[19.8px]">The same real workbench, step by step</p>
        <div className="text-left bg-[var(--elev)] border border-[var(--border)] rounded-[11px] shadow-[0_13.2px_30.8px_-19.8px_rgba(0,0,0,.35)] p-[24.2px] min-h-[385px] flex flex-col">
          {/* text-center (ux-agent finding #3, 2026-08-17) — the card wrapper is
              text-left, and this counter never overrode it, so it floated top-left,
              disconnected from the kicker/title/desc below it (which do center). */}
          <div className="text-center text-[11px] tracking-[.08em] uppercase text-[var(--accent-ink)] mb-[8.8px]">
            {String(step + 1).padStart(2, '0')} / {String(WALK_STEPS.length).padStart(2, '0')}
          </div>
          <div className="grid grid-cols-[1.1fr_1fr] gap-x-[28.6px] gap-y-[27.5px] items-start flex-1 min-h-[187px]">
            {/* min-h reserves worst-case space across all 4 steps (ux-agent finding #1,
                2026-08-17) — without it, step 3's longer title wraps to an extra line and
                the whole card (and the screenshot below it) visibly grows/shrinks as you
                click through steps. Same fix already applied to the modal's text block. */}
            <div className="text-center min-h-[160px]">
              <div className="text-[11px] tracking-[.1em] uppercase text-[var(--accent)] mb-[8.8px]">{s.kicker}</div>
              <h3 className="font-bold text-[24.2px] mb-[8.8px] tracking-[-0.01em]">{s.title}</h3>
              <p className="text-[14.85px] text-[var(--muted)]">{s.desc}</p>
            </div>
            <WalkShot
              text={s.shot}
              image={s.image}
              imagePosition={s.imagePosition}
              onExpand={() => setModalOpen(true)}
            />
            {/* grid-cols-[1.1fr_auto_1fr], not the mock's [1.1fr_0_1fr] — the mock relied on
                white-space:nowrap forcing a nominally-zero column open via CSS Grid's
                min-content override, which measured fine visually but left the real button
                and the dots column overlapping for hit-testing (verified: clicks on "Full
                view" landed on the dots div instead). auto sizes the column to its content
                directly, no overlap. */}
            <div className="grid grid-cols-[1.1fr_auto_1fr] col-span-2">
              <div className="flex items-center justify-center gap-[11px]">
                <WalkBtn onClick={prev}>← Previous</WalkBtn>
                <WalkBtn onClick={next}>Next →</WalkBtn>
              </div>
              <div className="flex items-center justify-center gap-[11px]">
                <WalkBtn onClick={() => setModalOpen(true)}>⤢ Full view</WalkBtn>
              </div>
              <div className="flex items-center justify-center gap-[8.8px]">
                {WALK_STEPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    aria-label={`Go to step ${i + 1}`}
                    className={`w-[8.8px] h-[8.8px] rounded-full cursor-pointer ${i === step ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center py-[34.1px] pb-[24.2px]">
        {/* TODO: copy could still use a pass */}
        <button
          type="button"
          onClick={() => { setSignupMode('request'); setAuthModal('signup'); }}
          className="text-[17px] bg-[var(--accent)] text-white px-[27px] py-[15px] rounded-[12px] font-bold cursor-pointer hover:bg-[var(--accent-ink)]"
        >
          Get started — ask for an invite
        </button>
      </div>

      {/* ── Trust strip ─────────────────────────────────────────────────── */}
      <div className="max-w-[1078px] mx-auto px-[30.8px] pt-[40px] pb-[44px] w-full text-left">
        <div className="flex items-start gap-[15.4px] bg-[var(--elev)] w-full border border-[var(--border)] rounded-[11px] shadow-[0_13.2px_30.8px_-19.8px_rgba(0,0,0,.35)] px-[28.6px] py-[24.2px]">
          <span className="text-[var(--accent)] text-[19.8px] flex-none mt-[2.2px]">◆</span>
          <div>
            <div className="text-[11px] tracking-[.1em] uppercase text-[var(--accent)] mb-[6.6px]">Agent-aware chat</div>
            <h3 className="font-bold text-[17.6px] mb-[4.4px] tracking-[-0.01em]">Not a generic assistant</h3>
            <p className="text-[14.3px] text-[var(--muted)] max-w-[682px]">
              It always knows your agent&apos;s full current state and proposes changes in
              plain language — nothing gets written until you review and approve the diff.
            </p>
          </div>
        </div>
      </div>

      {/* ── Feature grid ────────────────────────────────────────────────── */}
      <div className="px-[30.8px] pb-[33px] max-w-[1078px] mx-auto w-full">
        <div className="grid grid-cols-2 gap-[15.4px]">
          {FEATURES.map((f) => (
            <div key={f.title} className="border border-[var(--border)] rounded-[11px] px-[13.2px] py-[15.4px] bg-[var(--panel)]">
              <div className="flex items-center gap-[8.8px] mb-[5.5px]">
                <span className="text-[var(--accent)] text-[17.6px]">◆</span>
                <h4 className="font-bold text-[13.75px] m-0">{f.title}</h4>
              </div>
              <p className="text-[12.65px] text-[var(--faint)] m-0">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Roadmap teaser ──────────────────────────────────────────────── */}
      <div className="px-[30.8px] pb-[66px] max-w-[1078px] mx-auto w-full text-center">
        <h2 className="font-bold text-[22px] mb-[8.8px]">What&apos;s coming</h2>
        <p className="text-[14.3px] text-[var(--muted)] mb-[11px]">No dates — just the direction we&apos;re headed</p>
        <div className="welcome-rmline relative h-[209px]">
          {ROADMAP_TEASER.map((item, i) => (
            <div
              key={item.title}
              className="absolute top-0 h-full w-[187px] text-center -translate-x-1/2"
              style={{ left: `${12.5 + i * 25}%` }}
            >
              <div
                className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[12.1px] h-[12.1px] rounded-full border-2 border-[var(--accent)] ${item.down ? 'top-[70%]' : 'top-[20%]'}`}
                style={{ background: item.open ? 'var(--elev)' : 'var(--accent)' }}
              />
              <div
                className="absolute left-1/2 -translate-x-1/2 w-full flex flex-col gap-[5.5px]"
                style={
                  item.down
                    ? { bottom: 'calc(30% + 17.6px)', flexDirection: 'column-reverse' }
                    : { top: 'calc(20% + 17.6px)' }
                }
              >
                <div className="text-[11px] tracking-[.08em] uppercase text-[var(--accent-ink)] font-bold m-0">
                  {item.status}
                </div>
                <h4 className="font-bold text-[15.4px] m-0">{item.title}</h4>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-[5] bg-[var(--panel)] border-t border-[var(--border)] text-[12.65px] text-[var(--faint)]">
        <div className="flex items-center gap-[19.8px] max-w-[1078px] mx-auto px-[30.8px] py-[11px]">
          <div className="flex items-center gap-[13.2px] text-[var(--muted)] font-semibold">
            <span>Built by {AUTHOR_NAME}</span>
            <a href={AUTHOR_LINKEDIN} className="ml-[8.8px] text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">LinkedIn</a>
            <a href={AUTHOR_GITHUB} className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">GitHub</a>
            <a href={AUTHOR_EMAIL} className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">Email</a>
          </div>
          <div className="flex-1 min-w-[242px] text-right">
            © {new Date().getFullYear()} ProcessMind Solutions. All rights reserved. · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
          </div>
        </div>
      </div>

      {/* ── Fullscreen walkthrough modal ────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-[22px]"
          style={{ background: 'rgba(20,24,30,.5)' }}
          onClick={() => setModalOpen(false)}
        >
          <div
            // 946px→1320px (2026-08-17 fix): the old width was actually NARROWER than the
            // inline card's own container (~1078px minus padding), so "Full view" opened a
            // same-size (or smaller) modal — no zoom at all, just a re-centered popup.
            // WalkShot's aspect-ratio:9/5 is locked, so widening the modal alone makes the
            // screenshot column genuinely bigger (width grows, height follows), no separate
            // image-size hack needed. Text sizes below are bumped proportionally.
            className="relative w-[min(1320px,92vw)] bg-[var(--elev)] border border-[var(--border)] rounded-[13.2px] shadow-[0_26.4px_66px_-22px_rgba(0,0,0,.4)] p-[39.6px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setModalOpen(false)}
              className="absolute top-[15.4px] right-[15.4px] bg-transparent border-none text-[17.6px] text-[var(--faint)] cursor-pointer p-[6.6px] hover:text-[var(--text)]"
            >
              ✕
            </button>
            {/* Stacked layout (2026-08-17 test) — replaces the side-by-side grid the inline
                card uses: counter/kicker/title/desc centered on top, screenshot centered in
                the middle, Previous/dots/Next centered in one row underneath. A deliberately
                different shape from the inline card, not just a bigger version of it. */}
            <div className="flex flex-col items-center text-center">
              {/* Fixed min-height (2026-08-17 fix) — without it, the block's real height
                  depends on how many lines each step's title/desc wraps to (step 3's title
                  is longer than the others, e.g.), which made the whole modal — and the
                  screenshot frame below it — visibly grow/shrink as you clicked through
                  steps. This reserves worst-case space so only the text changes, not the
                  modal's size. */}
              <div className="flex flex-col items-center min-h-[233px]">
                <div className="text-[11px] tracking-[.08em] uppercase text-[var(--accent-ink)] mb-[8.8px]">
                  {String(step + 1).padStart(2, '0')} / {String(WALK_STEPS.length).padStart(2, '0')}
                </div>
                <div className="text-[12.1px] tracking-[.1em] uppercase text-[var(--accent)] mb-[8.8px]">{s.kicker}</div>
                <h3 className="font-bold text-[35.2px] mb-[13.2px] tracking-[-0.01em]">{s.title}</h3>
                <p className="text-[17.6px] text-[var(--muted)] max-w-[660px] mb-[30.8px]">{s.desc}</p>
              </div>
              <div className="w-full max-w-[902px] mb-[30.8px]">
                <WalkShot
                  text={s.shot}
                  image={s.fullImage || s.image}
                  imagePosition={s.fullImagePosition || s.imagePosition}
                  imageFit={s.fullImageFit}
                  imageZoom={s.fullImageZoom}
                  minHeight={242}
                />
              </div>
              <div className="flex items-center justify-center gap-[17.6px]">
                <WalkBtn onClick={prev}>← Previous</WalkBtn>
                <div className="flex items-center gap-[8.8px]">
                  {WALK_STEPS.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setStep(i)}
                      aria-label={`Go to step ${i + 1}`}
                      className={`w-[8.8px] h-[8.8px] rounded-full cursor-pointer ${i === step ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
                    />
                  ))}
                </div>
                <WalkBtn onClick={next}>Next →</WalkBtn>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Login modal ── ported from Layout-Landing.html's .loginback/.logindrawer
          (2026-08-14) — reuses the real LoginForm (Google + password, invite-signup
          link, OAuth-callback error handling) via its `embedded` prop, so this is the
          actual login flow in a modal shell, not a mockup duplicate. /login itself is
          unchanged — middleware.ts still sends unauthenticated visitors there from
          everywhere else in the app; this is only reachable from /welcome's nav.
          Not scaled with the rest of this page's ×1.1 sizing pass (2026-08-17) — see the
          file header note; LoginForm renders here at the same size as standalone /login. */}
      {authModal === 'login' && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-5"
          style={{ background: 'rgba(20,24,30,.55)' }}
          onClick={() => setAuthModal(null)}
        >
          <div
            className="relative w-[min(420px,94vw)] bg-[var(--elev)] border border-[var(--border)] rounded-[12px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)] p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setAuthModal(null)}
              className="absolute top-[14px] right-[14px] bg-transparent border-none text-[16px] text-[var(--faint)] cursor-pointer p-[6px] hover:text-[var(--text)]"
            >
              ✕
            </button>
            <Suspense>
              <LoginForm
                oauthConfigured={oauthConfigured}
                embedded
                onSwitchToSignup={(mode) => { setSignupMode(mode); setAuthModal('signup'); }}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* ── Signup modal ── same reasoning as the login modal above; triggered by the
          "Get started — ask for an invite" CTA (2026-08-14) and, as of 2026-08-18, by
          either of the login modal's two account-creation links. Reuses the real
          SignupForm (invite code + Google/password, OAuth-callback error handling) via
          `embedded`. `initialMode={signupMode}` opens straight into whichever sub-form
          the trigger promised (2026-08-17 fix, generalized 2026-08-18 — previously
          hardcoded to "request", which meant the login modal's invite-code link opened
          the wrong sub-form) — SignupForm's own in-form links still switch between the
          two sub-forms in place regardless of which one it opened into.
          Not scaled with the rest of this page's ×1.1 sizing pass — see the login modal's
          note above and the file header note. */}
      {authModal === 'signup' && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-5"
          style={{ background: 'rgba(20,24,30,.55)' }}
          onClick={() => setAuthModal(null)}
        >
          <div
            className="relative w-[min(420px,94vw)] max-h-[92vh] overflow-y-auto bg-[var(--elev)] border border-[var(--border)] rounded-[12px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)] p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setAuthModal(null)}
              className="absolute top-[14px] right-[14px] bg-transparent border-none text-[16px] text-[var(--faint)] cursor-pointer p-[6px] hover:text-[var(--text)]"
            >
              ✕
            </button>
            <Suspense>
              <SignupForm
                oauthConfigured={oauthConfigured}
                embedded
                initialMode={signupMode}
                onSwitchToLogin={() => setAuthModal('login')}
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}

function WalkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-[inherit] text-[14.3px] font-semibold text-[var(--text)] bg-transparent border border-[var(--border)] rounded-[7.7px] px-[17.6px] py-[8.8px] cursor-pointer min-w-[118.8px] text-center whitespace-nowrap hover:border-[var(--accent)]"
    >
      {children}
    </button>
  );
}

/** Screenshot frame — renders a real product screenshot when `image` is set (see
 *  WalkStep.image), otherwise falls back to the italic placeholder text (`text`), so
 *  steps can get real images one at a time as they're captured
 *  (plans/archive/12-ui-batch-launch-polish.md / docs/roadmap.md "Improve the guided tour"). */
function WalkShot({
  text,
  image,
  imagePosition = 'center',
  imageFit = 'cover',
  imageZoom = 1,
  minHeight = 132,
  onExpand,
}: {
  text: string;
  image?: string;
  imagePosition?: string;
  /** 'cover' (default) crops to fill the 9:5 frame — fine when the source is close to
   *  that ratio. 'contain' shows the whole image letterboxed instead — needed for
   *  sources far from 9:5 (e.g. a portrait screenshot), where cover would crop away
   *  most of the content no matter how imagePosition is set. */
  imageFit?: 'cover' | 'contain';
  /** Extra zoom on top of object-fit:cover's own (often near-1x, e.g. a 1092×514
   *  source into a 1.8-ratio box barely scales at all) — e.g. 1.3 for 30% more. Scales
   *  from the same corner/edge as `imagePosition` (transform-origin mirrors it), so
   *  zooming in crops further from the opposite side rather than re-centering. No
   *  effect with imageFit="contain" (nothing to crop further into). */
  imageZoom?: number;
  minHeight?: number;
  /** When set, the whole frame becomes clickable (opens the "Full view" modal) with a
   *  hover affordance — the ux-agent review's finding #6 (2026-08-17): the only way to
   *  open the modal was a small text button below the frame; clicking the screenshot
   *  itself, the most natural gesture, did nothing. Only passed by the inline card —
   *  the modal's own WalkShot has nowhere further to expand to. */
  onExpand?: () => void;
}) {
  return (
    <div
      className={`group relative border border-[var(--border)] rounded-[11px] bg-[var(--elev)] overflow-hidden shadow-[0_13.2px_30.8px_-19.8px_rgba(0,0,0,.35)] flex flex-col ${onExpand ? 'cursor-pointer' : ''}`}
      style={{ aspectRatio: '9/5' }}
      onClick={onExpand}
      role={onExpand ? 'button' : undefined}
      aria-label={onExpand ? 'Open full view' : undefined}
    >
      {onExpand && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(20,24,30,.35)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <span className="text-white text-[15.4px] font-semibold tracking-[-0.01em]">⤢ Full view</span>
        </div>
      )}
      <div className="flex gap-[5.5px] px-[11px] py-[8.8px] border-b border-[var(--border)] bg-[var(--panel)] flex-none">
        <span className="w-[8.8px] h-[8.8px] rounded-full bg-[var(--border)]" />
        <span className="w-[8.8px] h-[8.8px] rounded-full bg-[var(--border)]" />
        <span className="w-[8.8px] h-[8.8px] rounded-full bg-[var(--border)]" />
      </div>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={text}
          className={`flex-1 w-full min-h-0 ${imageFit === 'contain' ? 'object-contain' : 'object-cover'}`}
          style={{
            objectPosition: imagePosition,
            transform: imageZoom !== 1 ? `scale(${imageZoom})` : undefined,
            transformOrigin: imagePosition,
          }}
        />
      ) : (
        <div
          className="px-[19.8px] py-[28.6px] flex items-center justify-center flex-1 text-[var(--faint)] text-[13.2px] italic text-center"
          style={{ minHeight }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
