# Plan 12 — UI batch: branding, guided tour, disclaimer

> **Status: Lightweight scope doc, not an execution spec.** Deliberately kept light at the
> user's request — a follow-up pass (a layout-focused agent) will turn this into real
> prototype/implementation detail. This file exists to bundle the scope and flag what needs
> deciding, not to plan file-by-file changes.
>
> Standing project rules apply in full: no commit without an explicit ask, layout work
> prototypes in `architecture/layout/Layout-Workbench.html` before touching live code
> (`CLAUDE.md` standing rule 4).

---

## Why these three are bundled

TODO items 3, 4, 5 (current numbering, `plans/roadmap.md`) share one property: all three are
`[UX]`-kind — visible UI/layout work — and none of them depend on each other or on the
Second LLM provider (`plans/11-second-llm-provider.md`). Grouping them lets this whole batch
run in parallel with that Infra track.

| Item | Blocked on |
|---|---|
| **Company branding on the platform** | Your actual brand assets/copy — nothing here can start without them |
| **First-login guided tour (mini-tour)** | Nothing — ready to prototype |
| **"Don't paste sensitive data" disclaimer** | Nothing — ready to prototype |

## Company branding on the platform

**Current state:** Design already reviewed against the user's own rubric — footer placement
(primary) plus a quiet login/signup line (secondary) recommended. Footer prototyped in
`Layout-Workbench.html` with demo-only "ACME Corp" content; the login/signup line isn't
prototyped yet.

**What's still needed before this can move:**
- Real company name
- Logo/brand asset (file, format)
- Footer copy (copyright line, tagline if any)
- Confirmation of the login/signup line's exact placement and copy

**Rule:** no placeholder branding goes into real code — a real viewer seeing demo branding
reads worse than seeing nothing.

## First-login guided tour (mini-tour)

**Current state:** Prototyped in `Layout-Workbench.html` — spotlight/dim-panel mechanism
(a fixed spotlight rect with a giant `box-shadow` cutout + pulsing accent ring, plus a
popover that follows it), no new dependency, `WorkbenchShell`'s panels are fixed regions.
Seven steps: welcome, then the six-step core loop the user asked for — Library (import),
Custom Visualization (edit direct), Chat (edit via AI), the proposal's before/after
comparison, Apply, Export (Raw panel's Download). Skippable per-step (Exit, every step) and
to finish (last step's Next becomes "Finish ✓"), re-runnable via the topbar's "ⓘ Guided
tour" button, persisted "seen" flag via `localStorage` (`myagent_tour_seen`) — auto-runs
once, replay always available regardless of the flag. Verified in-browser (Chrome, both
themes): all seven steps position correctly, no console errors. One bug found and fixed
during that check — the "see the comparison" step's target row is taller than the chat
panel's own scroll viewport, so its spotlight needs clamping to the visible scroll area or
it bleeds into the panel above; `tourPositionFor()` now intersects the target rect with its
scroll-container's rect before drawing the spotlight.

**What's still needed before this can move:**
- Copy is drafted (all seven steps have real body text now, not placeholders) but not yet
  signed off — open to a tone pass
- Port the mechanism into the real app once the copy is confirmed

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

**Still needed before this ships:**
- **Terms and Privacy pages.** Footer already links to `#terms`/`#privacy` placeholders but
  the pages themselves don't exist yet. Structure/style reference given by the user:
  https://antondevtips.com/legal/privacy and https://antondevtips.com/legal/terms — standard
  SaaS boilerplate per the earlier decision (legal/license disclaimer, not legal-industry-
  specific copy).
- **Fix note — "Full view" button.** In testing, the walkthrough card's "⤢ Full view" button
  text wasn't rendering visibly (label had gone missing/blank in the browser, separate from
  the earlier text-wrap issue already patched with `white-space:nowrap` on `.wbtn`). Needs a
  real browser check before this ships — confirm the label renders and never wraps/clips in
  any state (light/dark, at 110% zoom) rather than just eyeballing the static mockup.

## Sequencing note

All three prototype in `Layout-Workbench.html` first, per standing rule 4 — none of them are
a "trivial one-line style tweak" exemption. Branding is the only one of the three that's
externally blocked; the tour and the disclaimer can start prototyping immediately, in
parallel with each other and with `plans/11-second-llm-provider.md`.
