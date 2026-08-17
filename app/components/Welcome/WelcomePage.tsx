'use client';

/**
 * app/components/Welcome/WelcomePage.tsx
 *
 * Plan 12 — pre-login landing page, ported from architecture/layout/Layout-Landing.html
 * (2026-08-14). Public route (see /welcome/page.tsx + middleware.ts PUBLIC_PATHS) — the
 * first thing a prospective, non-signed-up visitor sees; distinct audience from the
 * first-login guided tour (GuidedTour.tsx), which only signed-up users ever see.
 *
 * Known placeholder ported as a literal TODO below, tracked in
 * plans/archive/12-ui-batch-launch-polish.md's "Known placeholders" list — replace before ship:
 *   - Walkthrough step "screenshots" (bracketed placeholder text — format undecided)
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

import { Suspense, useState } from 'react';
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
}

const WALK_STEPS: WalkStep[] = [
  {
    kicker: 'STEP 1 — IMPORT',
    title: 'Bring in any agent file',
    desc: 'Drop in a .md agent — Structural mode reorganizes it into a canonical layout, Strict mode keeps your structure and just labels it.',
    shot: '[ screenshot — import dialog ]',
  },
  {
    kicker: 'STEP 2 — EDIT',
    title: 'Change it directly, or describe the change',
    desc: 'Edit fields in the structured view, or tell the built-in chat what you want changed — it proposes the edit for review.',
    shot: '[ screenshot — structured view + chat ]',
  },
  {
    kicker: 'STEP 3 — REVIEW',
    title: 'See exactly what changed',
    desc: 'Every proposed edit shows as a diff against the raw file before it applies. Nothing changes silently.',
    shot: '[ screenshot — raw view / diff ]',
  },
  {
    kicker: 'STEP 4 — EXPORT',
    title: 'Take it back out clean',
    desc: 'Download the result as a plain agent file, ready to drop back into your own tools.',
    shot: '[ screenshot — export ]',
  },
];

// Real features only — the mock's grid had 2 Lorem-Ipsum filler cards to round out a
// 6-card layout; dropped rather than shipped, grid reflowed to a clean 2x2 of the 4
// real ones instead of forcing placeholder copy into production.
const FEATURES = [
  { title: 'Structured + raw views', desc: 'See the same agent both ways, always in sync.' },
  { title: 'AI-guided editing', desc: 'Propose changes in chat, review before anything applies.' },
  { title: 'Export to your platform', desc: 'Round-trips cleanly back to plain agent files.' },
  { title: 'More providers, soon', desc: 'Not locked to a single model vendor.' },
];

// Trimmed from docs/roadmap.md (the curated, plain-language capability list) — not
// generic "Feature N short example" filler. One shipped + one in-progress + two planned,
// matching the wave line's Shipped/Building/Planned/Planned rhythm.
const ROADMAP_TEASER = [
  { status: 'Shipped', title: 'AI chat editing', down: false, open: false },
  { status: 'Building now', title: 'A second AI provider', down: true, open: true },
  { status: 'Planned', title: 'Group organization', down: false, open: true },
  { status: 'Planned', title: 'Chat history that persists', down: true, open: true },
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

  const s = WALK_STEPS[step];
  const next = () => setStep((i) => (i + 1) % WALK_STEPS.length);
  const prev = () => setStep((i) => (i - 1 + WALK_STEPS.length) % WALK_STEPS.length);

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
            MyAgent
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
          Build and edit AI agents without fighting YAML frontmatter
        </h1>
        <p className="text-[17.05px] text-[var(--muted)] mx-auto mb-[8.8px] max-w-[704px]">
          Import an agent, edit it in a structured view or by chatting with it, export it
          back out — one workbench, no hand-editing markdown.
        </p>
      </div>

      {/* ── Walkthrough card ────────────────────────────────────────────── */}
      <div className="px-[30.8px] pt-[4.4px] pb-[6.6px] max-w-[1078px] mx-auto w-full text-center">
        <h2 className="font-bold text-[22px] mb-[6.6px]">How it works</h2>
        <p className="text-[14.3px] text-[var(--muted)] mb-[19.8px]">The same real workbench, step by step</p>
        <div className="text-left bg-[var(--elev)] border border-[var(--border)] rounded-[11px] shadow-[0_13.2px_30.8px_-19.8px_rgba(0,0,0,.35)] p-[24.2px] min-h-[385px] flex flex-col">
          <div className="text-[11px] tracking-[.08em] uppercase text-[var(--accent-ink)] mb-[8.8px]">
            {String(step + 1).padStart(2, '0')} / {String(WALK_STEPS.length).padStart(2, '0')}
          </div>
          <div className="grid grid-cols-[1.1fr_1fr] gap-x-[28.6px] gap-y-[27.5px] items-start flex-1 min-h-[187px]">
            <div>
              <div className="text-[11px] tracking-[.1em] uppercase text-[var(--accent)] mb-[8.8px]">{s.kicker}</div>
              <h3 className="font-bold text-[24.2px] mb-[8.8px] tracking-[-0.01em]">{s.title}</h3>
              <p className="text-[14.85px] text-[var(--muted)]">{s.desc}</p>
            </div>
            <WalkShot text={s.shot} />
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
          onClick={() => setAuthModal('signup')}
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
            className="relative w-[min(946px,94vw)] bg-[var(--elev)] border border-[var(--border)] rounded-[13.2px] shadow-[0_26.4px_66px_-22px_rgba(0,0,0,.4)] p-[35.2px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setModalOpen(false)}
              className="absolute top-[15.4px] right-[15.4px] bg-transparent border-none text-[17.6px] text-[var(--faint)] cursor-pointer p-[6.6px] hover:text-[var(--text)]"
            >
              ✕
            </button>
            <div className="text-[11px] tracking-[.08em] uppercase text-[var(--accent-ink)] mb-[8.8px]">
              {String(step + 1).padStart(2, '0')} / {String(WALK_STEPS.length).padStart(2, '0')}
            </div>
            <div className="grid grid-cols-[1.1fr_1fr] gap-x-[28.6px] gap-y-[27.5px] items-start" style={{ minHeight: 264 }}>
              <div>
                <div className="text-[11px] tracking-[.1em] uppercase text-[var(--accent)] mb-[8.8px]">{s.kicker}</div>
                <h3 className="font-bold text-[26.4px] mb-[8.8px] tracking-[-0.01em]">{s.title}</h3>
                <p className="text-[14.85px] text-[var(--muted)]">{s.desc}</p>
              </div>
              <WalkShot text={s.shot} minHeight={176} />
              <div className="grid grid-cols-2 col-span-2">
                <div className="flex items-center justify-center">
                  <WalkBtn onClick={prev}>← Previous</WalkBtn>
                </div>
                <div className="flex items-center justify-center gap-[11px]">
                  <WalkBtn onClick={next}>Next →</WalkBtn>
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
                </div>
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
                onSwitchToSignup={() => setAuthModal('signup')}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* ── Signup modal ── same reasoning as the login modal above; triggered by the
          "Get started — ask for an invite" CTA (2026-08-14). Reuses the real SignupForm
          (invite code + Google/password, OAuth-callback error handling) via `embedded`.
          initialMode="request" opens straight into the no-code request-access sub-form
          (2026-08-17 fix) — the CTA's own label promises that flow, so landing on the
          invite-code-required form first was the wrong default; SignupForm's own "Have
          an invite code? Sign up" link still switches into the other sub-form in place.
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
                initialMode="request"
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

/** Placeholder screenshot frame — TODO: real product screenshots, format undecided
 *  (plans/archive/12-ui-batch-launch-polish.md / docs/roadmap.md "Improve the guided tour"). */
function WalkShot({ text, minHeight = 132 }: { text: string; minHeight?: number }) {
  return (
    <div className="border border-[var(--border)] rounded-[11px] bg-[var(--elev)] overflow-hidden shadow-[0_13.2px_30.8px_-19.8px_rgba(0,0,0,.35)] flex flex-col" style={{ aspectRatio: '9/5' }}>
      <div className="flex gap-[5.5px] px-[11px] py-[8.8px] border-b border-[var(--border)] bg-[var(--panel)] flex-none">
        <span className="w-[8.8px] h-[8.8px] rounded-full bg-[var(--border)]" />
        <span className="w-[8.8px] h-[8.8px] rounded-full bg-[var(--border)]" />
        <span className="w-[8.8px] h-[8.8px] rounded-full bg-[var(--border)]" />
      </div>
      <div
        className="px-[19.8px] py-[28.6px] flex items-center justify-center flex-1 text-[var(--faint)] text-[13.2px] italic text-center"
        style={{ minHeight }}
      >
        {text}
      </div>
    </div>
  );
}
