# Plan 12 — UI batch: branding, guided tour, disclaimer, landing page, request access

> **Status: tracker for a mostly-shipped batch.** Started as a lightweight scope doc for
> three bundled TODO items; grew into the real implementation record as each piece got
> prototyped, ported into the real app, and verified in-browser. This file is now the single
> place to review the whole batch and close out what's left — see the table below for the
> fast path, the sections after it for the full detail on each item.
>
> Standing project rules apply in full: no commit without an explicit ask, layout work
> prototypes in `architecture/layout/Layout-Workbench.html` before touching live code
> (`CLAUDE.md` standing rule 4).

---

## At a glance

| Item | Status | What's left |
|---|---|---|
| **Company branding on the platform** | Mostly shipped | `/welcome` footer author identity still placeholder |
| **First-login guided tour (mini-tour)** | Shipped, in the real app | Copy drafted, not formally signed off |
| **"Don't paste sensitive data" disclaimer** | Not started | Placement decision + wording |
| **Pre-login landing page** | Shipped, in the real app | Terms/Privacy pages don't exist yet; author identity |
| **"Request access" (new, 2026-08-14)** | Shipped, in the real app | Automated email delivery — tracked separately as a roadmap NEXT item |

Three of five are live in the real app right now, not just mocked up. The two genuinely
open items (disclaimer; Terms/Privacy pages) are both small and undecided rather than
blocked on anything external.

## Company branding on the platform

**Current state (2026-08-14):** Live in the real app — the Workbench footer shows the
ProcessMind Solutions mark + name (`app/components/WorkbenchShell.tsx`, replacing the
mockup's "ACME Corp" placeholder). The `/welcome` landing page also has an identity line in
its own footer, though that one's author name/LinkedIn/GitHub/email are still placeholder
constants (`AUTHOR_*` in `WelcomePage.tsx`) pending real values.

**What's still needed:**
- Real values for the `/welcome` footer's author identity (name, LinkedIn, GitHub, email)
- The quiet login/signup-page branding line (secondary placement) was recommended early on
  but never prototyped — still open if wanted

**Rule (still in force):** no placeholder branding goes into real code — a real viewer
seeing demo branding reads worse than seeing nothing. (The `/welcome` footer's `AUTHOR_*`
placeholders are the one deliberate exception, tracked above, not an oversight.)

## First-login guided tour (mini-tour)

**Current state:** Prototyped in `Layout-Workbench.html`, then ported into the real app
(2026-08-14) as `app/components/shell/GuidedTour.tsx`, wired into `WorkbenchShell.tsx` — no
longer mockup-only. Spotlight/dim-panel mechanism (a fixed spotlight rect with a giant
`box-shadow` cutout + pulsing accent ring, plus a popover that follows it), no new
dependency. Seven steps: welcome, then the six-step core loop the user asked for — Library
(import), Custom Visualization (edit direct), Chat (edit via AI), the proposal's before/after
comparison, Apply, Export (Raw panel's Download). Skippable per-step (Exit, every step) and
to finish (last step's Next becomes "Finish ✓"), re-runnable via the topbar's "ⓘ Guided
tour" button, persisted "seen" flag via `localStorage` (`myagent_tour_seen`) — auto-runs
once, replay always available regardless of the flag.

**Two real-app adaptations made during the port** (the mockup's demo data didn't need
these):
- A fresh session has no live proposal until the user actually chats — the comparison/apply
  steps fall back to spotlighting the whole Chat panel when `#tourProposalCard`/
  `#tourApplyBtn` don't exist yet (comma-separated selector fallback, most specific first).
- The real `ChatPanel`'s "Current value" block is collapsed behind a "show current ▾"
  toggle by default (a 2026-08-07 decision), unlike the mockup's always-open demo — the
  comparison step's copy describes that toggle instead of assuming it's already visible.

**Verified in-browser** (mockup first, then the real port, Chrome, both themes): all seven
steps position correctly, no console errors. One bug found and fixed in the mockup before
the port — the "see the comparison" step's target row is taller than the chat panel's own
scroll viewport, so its spotlight needs clamping to the visible scroll area or it bleeds
into the panel above; `tourPositionFor()`/`GuidedTour.tsx`'s `position()` both intersect the
target rect with its scroll-container's rect before drawing the spotlight.

**What's still needed:**
- Copy is drafted (all seven steps have real body text, not placeholders) but not yet
  formally signed off — open to a tone pass if wanted

## "Experimental — don't paste sensitive data" disclaimer

**Current state:** No disclaimer exists anywhere in the signup/login flow today.

**Shape:** one sentence, cheap. Placement options: the signup form, a persistent banner, or
folded into the existing `ConsentPopup.tsx`.

**What's still needed before this can move:**
- Placement decision
- Exact wording

## Pre-login landing page

**Current state:** Mockup done in `architecture/layout/Layout-Landing.html` (hero,
walkthrough card, feats grid, wave roadmap timeline, footer) — this is now the reference for
the real build, alongside `Layout-Workbench.html` for the rest of the app. Earlier drafts
(`Landing-standalone.html`, `Layout-Landing2.html`) are retired to the gitignored
`architecture/layout/Old Ones/` folder, kept locally for history only.

**Ported into the real app (2026-08-14):** live at `/welcome` (`app/components/Welcome/
WelcomePage.tsx`, added to `middleware.ts`'s `PUBLIC_PATHS`). Verified in-browser: hero,
walkthrough (Prev/Next/Full-view modal/dots), feature grid, roadmap wave, footer, dark
theme all work. Two real bugs found and fixed during that check, neither present in the
static mockup:
- The app's global `body{overflow:hidden}` (for the fixed-viewport Workbench shell) broke
  this page's normal scroll — fixed by making the page's own root div its scroll container
  (`h-screen overflow-y-auto`) instead of relying on document-level scroll.
- The mock's "Full view" button used a CSS Grid column explicitly sized `0`, forced open
  only by `white-space:nowrap` on the button's own min-content size — visually fine in the
  mock, but in this port it left the dots control sitting on top of the button for
  hit-testing (clicks landed on the dots, not the button). Fixed with `grid-cols-
  [1.1fr_auto_1fr]` instead of `[1.1fr_0_1fr]` — same visual result, no overlap.

The nav's "Log in" and the "Get started" CTA now open the real `LoginForm`/`SignupForm`
(Google + password/invite-code, OAuth-callback error handling) in modals, via a new
`embedded` prop on each — not mockup duplicates. Each form's cross-link ("Sign in" /
"Sign up with an invite code") switches straight to the other modal via a new
`onSwitchToLogin`/`onSwitchToSignup` prop instead of navigating away, so the modal flow
never breaks out to a full page mid-switch. `/login` and `/signup` themselves are
untouched (props default to the original full-page behavior) — still what `middleware.ts`
sends unauthenticated visitors to everywhere else in the app. All verified in-browser:
both modals open/close, the cross-links switch correctly in both directions, and the
standalone `/login`/`/signup` pages are unaffected.

The feature grid and roadmap teaser use real content (4 real features, not the mock's 2
Lorem-Ipsum filler cards; roadmap items pulled from `docs/roadmap.md` — AI chat editing
shipped, second AI provider building, group organization + persistent chat history
planned) rather than the mock's generic placeholder text.

**Still needed before this ships:**
- **Terms and Privacy pages.** Footer already links to `#terms`/`#privacy` placeholders but
  the pages themselves don't exist yet. Structure/style reference given by the user:
  https://antondevtips.com/legal/privacy and https://antondevtips.com/legal/terms — standard
  SaaS boilerplate per the earlier decision (legal/license disclaimer, not legal-industry-
  specific copy).
- Author identity in the `/welcome` footer (name, LinkedIn, GitHub, email) — still the
  `AUTHOR_*` placeholder constants in `WelcomePage.tsx`.

Resolved during the port (2026-08-14): the "Full view" button hit-testing bug (see above)
is fixed, and the routing decision landed on a new public `/welcome` path (not `/` itself) —
both no longer open items.

**Known placeholders in `Layout-Landing.html` — audited 2026-08-14, replace before ship:**
- **Footer identity line** (`.fbrand`) — name reads literally "Built by the user" (intentional
  stand-in, per the standing rule against writing the user's real name into repo files —
  swap for the real name at the real-code stage, not in this mockup file) and the
  LinkedIn/GitHub/Email links are all `href="#"`. Deferred earlier this session ("save this
  for when migrating to the platform") — the real URLs/address are still needed.
- **Terms/Privacy links** — `href="#"` placeholders; pages don't exist yet (see above).
- **Hero CTA** (`.invite-wrap` link) — `href="#"` placeholder, and the copy itself ("Get
  Start - Ask a invite!") reads as a rough draft, not final wording — needs both a real
  destination and a copy pass.
- **Walkthrough step "screenshots"** — all four steps show italic bracketed text (`[
  screenshot — import dialog ]`, etc.) instead of real product images. Format still undecided
  per the roadmap's separate "Improve the guided tour"/landing-page NEXT items (video vs.
  screenshots vs. static copy).
- **Feature grid** — 2 of the 6 cards are literal Lorem Ipsum ("Lorem ipsum dolor" / "Sit amet
  consectetur adipiscing elit sed do." and "Eiusmod tempor" / "Incididunt ut labore et dolore
  magna aliqua."), added to fill out the grid's 3-row/6-card layout. Needs either two more
  real features or a reflow to a grid that fits the 4 real ones.
- **Roadmap teaser** — all four wave-timeline items in this mockup file are still placeholder
  text ("Feature one short example" through "Feature four short example"), per the earlier
  decision to keep it as a trimmed-down teaser rather than the full backlog. The real port
  (`WelcomePage.tsx`) already uses real content pulled from `docs/roadmap.md` — see below —
  this bullet is just noting the mockup file itself was never updated to match.
- **Open question — brand name.** The landing page's nav/login-modal brand reads "MyAgent"
  (the product name used throughout this repo); this session separately introduced
  "ProcessMind Solutions" as the real company/publisher name for the in-app Workbench
  footer. Not yet decided whether the landing page should show the product name, the company
  name, or both (e.g. product name in the nav, company name in the footer) — flagging rather
  than guessing.

## "Request access" — signup without an invite code (2026-08-14)

**Current state:** Shipped and verified in-browser. A visitor on `/signup` (standalone or
the `/welcome` modal) without an invite code can toggle to "Request access" — name, email,
optional "how did you hear about us?" (LinkedIn / a thread or post online / GitHub / a
friend / other). Same confirmation message shown regardless of outcome (already a user /
already an open request or live code for that email / freshly logged) — no email-enumeration
leak, matching the rest of this auth system's posture.

**Admin side:** Settings gained an "Access requests" grid above Invite Codes. Per request:
**Generate code** creates an invite code bound to that email, expiring per a new admin
setting ("Access-request code expiry (hours)", default 5 — configurable, not hardcoded, per
the user's explicit ask) — and removes the request (the code is the durable record from
there on, visible in the Invite Codes table with new "For" and "Expires" columns). **Dismiss**
just removes it, no code. Redemption at actual signup enforces both the email match and the
expiry, folding any failure into the same generic "Invalid or already-used invite code"
message the rest of the flow already uses — never a distinct error that would leak *why* a
code failed.

**Explicitly not built (by the user's direction):** no automated email to the requester —
the admin copies the generated code and sends it by hand, for now. Tracked as a roadmap NEXT
item ("Automated invite-code email delivery," `plans/roadmap.md`) once an email provider is
picked.

**Schema:** `invite_code` gained nullable `boundEmail`/`expiresAt` (both null = today's
admin-generated codes, unchanged behavior) and `createdBy` became nullable (self-requested
codes have no admin author). New `access_request` table (name, email, referralSource,
createdAt) — a row is an open, unhandled request; both admin actions delete it.

**Verified end-to-end:** submission → DB row → dedupe (resubmitting the same email while a
request is open creates no duplicate) → admin generates a code → request disappears, code
appears in Invite Codes with correct bound email + countdown → wrong-email redemption
rejected generically → correct-email redemption passes the bind check (confirmed by reaching
the next validation step) → Dismiss removes a request with no code created. `tsc` clean
throughout (only 2 pre-existing, unrelated errors in files never touched this session).

## What's left, across the whole batch

Everything below is small and undecided rather than blocked on anything external — no
sequencing dependency between any of them:

1. **Disclaimer** — not started at all. Needs a placement decision (signup form /
   persistent banner / folded into `ConsentPopup.tsx`) and one sentence of wording.
2. **Terms and Privacy pages** for `/welcome`'s footer links. Style reference already given:
   https://antondevtips.com/legal/privacy and https://antondevtips.com/legal/terms.
3. **Author identity** — real name/LinkedIn/GitHub/email to replace the `AUTHOR_*`
   placeholder constants in `WelcomePage.tsx`, and the open question of whether `/welcome`'s
   nav should show the product name ("MyAgent") or the company name ("ProcessMind
   Solutions") or both.
4. **Guided tour copy sign-off** — a tone pass over the seven steps' drafted body text, if
   wanted before calling it final.
5. **Login/signup-page branding line** — the secondary placement recommended early in the
   branding review, never prototyped. Optional; the footer placement already covers the
   "no placeholder branding ships" rule on its own.

Not part of this batch's remaining scope, but adjacent and worth knowing about: automated
invite-code email delivery (so the admin stops copying codes by hand) is tracked separately
as a roadmap NEXT item once an email provider is picked — see `plans/roadmap.md`.
