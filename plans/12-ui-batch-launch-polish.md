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

**Current state:** Fully specced conceptually, not started, not prototyped.

**Shape:** spotlight/dim-panel mechanism (no new dependency — `WorkbenchShell`'s four panels
are fixed regions), six steps (welcome/why, Library, Structured view, Chat, cite-a-section,
Raw + download), skippable per-step and to finish, re-runnable via a "?" affordance, a
persisted "seen" flag (`localStorage`).

**What's still needed before this can move:**
- Prototype in `Layout-Workbench.html` (the mechanism itself, not just described)
- Exact copy/tone for each of the six steps — not yet written

## "Experimental — don't paste sensitive data" disclaimer

**Current state:** No disclaimer exists anywhere in the signup/login flow today.

**Shape:** one sentence, cheap. Placement options: the signup form, a persistent banner, or
folded into the existing `ConsentPopup.tsx`.

**What's still needed before this can move:**
- Placement decision
- Exact wording

## Sequencing note

All three prototype in `Layout-Workbench.html` first, per standing rule 4 — none of them are
a "trivial one-line style tweak" exemption. Branding is the only one of the three that's
externally blocked; the tour and the disclaimer can start prototyping immediately, in
parallel with each other and with `plans/11-second-llm-provider.md`.
