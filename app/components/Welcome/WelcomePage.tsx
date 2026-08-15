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
        <div className="flex items-center gap-4 max-w-[980px] mx-auto px-7 py-3">
          <div className="flex items-center gap-[9px] font-bold tracking-[-0.01em] text-[15px]">
            <span
              className="w-[9px] h-[9px] rounded-[2px] bg-[var(--accent)]"
              style={{ boxShadow: '0 0 0 3px var(--accent-wash)' }}
            />
            MyAgent
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setAuthModal('login')}
            className="text-[13px] font-semibold text-[var(--accent-ink)] bg-transparent border border-[var(--border)] rounded-[7px] px-4 py-[7px] cursor-pointer hover:border-[var(--accent)]"
          >
            Log in
          </button>
        </div>
      </div>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <div className="px-7 pt-9 pb-2 max-w-[980px] mx-auto text-center">
        <h1 className="text-[34px] leading-[1.2] mx-auto mb-[10px] tracking-[-0.02em] max-w-[720px]">
          Build and edit AI agents without fighting YAML frontmatter
        </h1>
        <p className="text-[15.5px] text-[var(--muted)] mx-auto mb-2 max-w-[640px]">
          Import an agent, edit it in a structured view or by chatting with it, export it
          back out — one workbench, no hand-editing markdown.
        </p>
      </div>

      {/* ── Walkthrough card ────────────────────────────────────────────── */}
      <div className="px-7 pt-1 pb-1.5 max-w-[980px] mx-auto w-full text-center">
        <h2 className="text-[20px] mb-[6px]">How it works</h2>
        <p className="text-[13px] text-[var(--muted)] mb-[18px]">The same real workbench, step by step</p>
        <div className="text-left bg-[var(--elev)] border border-[var(--border)] rounded-[10px] shadow-[0_12px_28px_-18px_rgba(0,0,0,.35)] p-[22px] min-h-[350px] flex flex-col">
          <div className="text-[10px] tracking-[.08em] uppercase text-[var(--accent-ink)] mb-2">
            {String(step + 1).padStart(2, '0')} / {String(WALK_STEPS.length).padStart(2, '0')}
          </div>
          <div className="grid grid-cols-[1.1fr_1fr] gap-x-[26px] gap-y-[25px] items-start flex-1 min-h-[170px]">
            <div>
              <div className="text-[10px] tracking-[.1em] uppercase text-[var(--accent)] mb-2">{s.kicker}</div>
              <h3 className="text-[22px] mb-2 tracking-[-0.01em]">{s.title}</h3>
              <p className="text-[13.5px] text-[var(--muted)]">{s.desc}</p>
            </div>
            <WalkShot text={s.shot} />
            {/* grid-cols-[1.1fr_auto_1fr], not the mock's [1.1fr_0_1fr] — the mock relied on
                white-space:nowrap forcing a nominally-zero column open via CSS Grid's
                min-content override, which measured fine visually but left the real button
                and the dots column overlapping for hit-testing (verified: clicks on "Full
                view" landed on the dots div instead). auto sizes the column to its content
                directly, no overlap. */}
            <div className="grid grid-cols-[1.1fr_auto_1fr] col-span-2">
              <div className="flex items-center justify-center gap-[10px]">
                <WalkBtn onClick={prev}>← Previous</WalkBtn>
                <WalkBtn onClick={next}>Next →</WalkBtn>
              </div>
              <div className="flex items-center justify-center gap-[10px]">
                <WalkBtn onClick={() => setModalOpen(true)}>⤢ Full view</WalkBtn>
              </div>
              <div className="flex items-center justify-center gap-2">
                {WALK_STEPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    aria-label={`Go to step ${i + 1}`}
                    className={`w-2 h-2 rounded-full cursor-pointer ${i === step ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center py-[31px] pb-[22px]">
        {/* TODO: copy could still use a pass */}
        <button
          type="button"
          onClick={() => setAuthModal('signup')}
          className="bg-[var(--accent)] text-white px-[22px] py-3 rounded-[10px] font-bold cursor-pointer hover:bg-[var(--accent-ink)]"
        >
          Get started — ask for an invite
        </button>
      </div>

      {/* ── Trust strip ─────────────────────────────────────────────────── */}
      <div className="max-w-[980px] mx-auto px-7 pb-10 w-full text-left">
        <div className="flex items-start gap-[14px] bg-[var(--elev)] w-full border border-[var(--border)] rounded-[10px] shadow-[0_12px_28px_-18px_rgba(0,0,0,.35)] px-[26px] py-[22px]">
          <span className="text-[var(--accent)] text-[18px] flex-none mt-0.5">◆</span>
          <div>
            <div className="text-[10px] tracking-[.1em] uppercase text-[var(--accent)] mb-[6px]">Agent-aware chat</div>
            <h3 className="text-[16px] mb-1 tracking-[-0.01em]">Not a generic assistant</h3>
            <p className="text-[13px] text-[var(--muted)] max-w-[620px]">
              It always knows your agent&apos;s full current state and proposes changes in
              plain language — nothing gets written until you review and approve the diff.
            </p>
          </div>
        </div>
      </div>

      {/* ── Feature grid ────────────────────────────────────────────────── */}
      <div className="px-7 pb-[30px] max-w-[980px] mx-auto w-full">
        <div className="grid grid-cols-2 gap-[14px]">
          {FEATURES.map((f) => (
            <div key={f.title} className="border border-[var(--border)] rounded-[10px] px-3 py-[14px] bg-[var(--panel)]">
              <div className="flex items-center gap-2 mb-[5px]">
                <span className="text-[var(--accent)] text-[16px]">◆</span>
                <h4 className="text-[12.5px] m-0">{f.title}</h4>
              </div>
              <p className="text-[11.5px] text-[var(--faint)] m-0">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Roadmap teaser ──────────────────────────────────────────────── */}
      <div className="px-7 pb-[60px] max-w-[980px] mx-auto w-full text-center">
        <h2 className="text-[20px] mb-2">What&apos;s coming</h2>
        <p className="text-[13px] text-[var(--muted)] mb-[10px]">No dates — just the direction we&apos;re headed</p>
        <div className="welcome-rmline relative h-[190px]">
          {ROADMAP_TEASER.map((item, i) => (
            <div
              key={item.title}
              className="absolute top-0 h-full w-[170px] text-center -translate-x-1/2"
              style={{ left: `${12.5 + i * 25}%` }}
            >
              <div
                className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[11px] h-[11px] rounded-full border-2 border-[var(--accent)] ${item.down ? 'top-[70%]' : 'top-[20%]'}`}
                style={{ background: item.open ? 'var(--elev)' : 'var(--accent)' }}
              />
              <div
                className="absolute left-1/2 -translate-x-1/2 w-full flex flex-col gap-[5px]"
                style={
                  item.down
                    ? { bottom: 'calc(30% + 16px)', flexDirection: 'column-reverse' }
                    : { top: 'calc(20% + 16px)' }
                }
              >
                <div className="text-[10px] tracking-[.08em] uppercase text-[var(--accent-ink)] font-bold m-0">
                  {item.status}
                </div>
                <h4 className="text-[14px] m-0">{item.title}</h4>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-[5] bg-[var(--panel)] border-t border-[var(--border)] text-[11.5px] text-[var(--faint)]">
        <div className="flex items-center gap-[18px] max-w-[980px] mx-auto px-7 py-[10px]">
          <div className="flex items-center gap-3 text-[var(--muted)] font-semibold">
            <span>Built by {AUTHOR_NAME}</span>
            <a href={AUTHOR_LINKEDIN} className="ml-2 text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">LinkedIn</a>
            <a href={AUTHOR_GITHUB} className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">GitHub</a>
            <a href={AUTHOR_EMAIL} className="text-[var(--muted)] no-underline hover:text-[var(--accent-ink)]">Email</a>
          </div>
          <div className="flex-1 min-w-[220px] text-right">
            © {new Date().getFullYear()} ProcessMind Solutions. All rights reserved. · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
          </div>
        </div>
      </div>

      {/* ── Fullscreen walkthrough modal ────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-5"
          style={{ background: 'rgba(20,24,30,.5)' }}
          onClick={() => setModalOpen(false)}
        >
          <div
            className="relative w-[min(860px,94vw)] bg-[var(--elev)] border border-[var(--border)] rounded-[12px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.4)] p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setModalOpen(false)}
              className="absolute top-[14px] right-[14px] bg-transparent border-none text-[16px] text-[var(--faint)] cursor-pointer p-[6px] hover:text-[var(--text)]"
            >
              ✕
            </button>
            <div className="text-[10px] tracking-[.08em] uppercase text-[var(--accent-ink)] mb-2">
              {String(step + 1).padStart(2, '0')} / {String(WALK_STEPS.length).padStart(2, '0')}
            </div>
            <div className="grid grid-cols-[1.1fr_1fr] gap-x-[26px] gap-y-[25px] items-start" style={{ minHeight: 240 }}>
              <div>
                <div className="text-[10px] tracking-[.1em] uppercase text-[var(--accent)] mb-2">{s.kicker}</div>
                <h3 className="text-[24px] mb-2 tracking-[-0.01em]">{s.title}</h3>
                <p className="text-[13.5px] text-[var(--muted)]">{s.desc}</p>
              </div>
              <WalkShot text={s.shot} minHeight={160} />
              <div className="grid grid-cols-2 col-span-2">
                <div className="flex items-center justify-center">
                  <WalkBtn onClick={prev}>← Previous</WalkBtn>
                </div>
                <div className="flex items-center justify-center gap-[10px]">
                  <WalkBtn onClick={next}>Next →</WalkBtn>
                  <div className="flex items-center gap-2">
                    {WALK_STEPS.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setStep(i)}
                        aria-label={`Go to step ${i + 1}`}
                        className={`w-2 h-2 rounded-full cursor-pointer ${i === step ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
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
          everywhere else in the app; this is only reachable from /welcome's nav. */}
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
          (invite code + Google/password, OAuth-callback error handling) via `embedded`. */}
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
      className="font-[inherit] text-[13px] font-semibold text-[var(--text)] bg-transparent border border-[var(--border)] rounded-[7px] px-4 py-2 cursor-pointer min-w-[108px] text-center whitespace-nowrap hover:border-[var(--accent)]"
    >
      {children}
    </button>
  );
}

/** Placeholder screenshot frame — TODO: real product screenshots, format undecided
 *  (plans/archive/12-ui-batch-launch-polish.md / docs/roadmap.md "Improve the guided tour"). */
function WalkShot({ text, minHeight = 120 }: { text: string; minHeight?: number }) {
  return (
    <div className="border border-[var(--border)] rounded-[10px] bg-[var(--elev)] overflow-hidden shadow-[0_12px_28px_-18px_rgba(0,0,0,.35)] flex flex-col" style={{ aspectRatio: '9/5' }}>
      <div className="flex gap-[5px] px-[10px] py-2 border-b border-[var(--border)] bg-[var(--panel)] flex-none">
        <span className="w-2 h-2 rounded-full bg-[var(--border)]" />
        <span className="w-2 h-2 rounded-full bg-[var(--border)]" />
        <span className="w-2 h-2 rounded-full bg-[var(--border)]" />
      </div>
      <div
        className="px-[18px] py-[26px] flex items-center justify-center flex-1 text-[var(--faint)] text-[12px] italic text-center"
        style={{ minHeight }}
      >
        {text}
      </div>
    </div>
  );
}
