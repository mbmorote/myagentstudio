# Branding Design Review — 2026-08-06

Requested by the user for roadmap TODO item 10 ("Company signature on the platform").
Presentation-only, per the user's brief — **no functional changes proposed**, and none made
here; this is analysis, to be prototyped in `architecture/layout/Layout-Workbench.html` (per
standing rule 4) once an actual logo asset and company name/copy exist. Same "outside opinion,
not a build plan" role as `Evaluation-260730.md` / `Design-Review-260806.md`.

Grounded in the real running app: `app/components/shell/Topbar.tsx`, `app/components/Auth/
LoginForm.tsx` / `SignupForm.tsx`, `app/components/CustomViz/AgentView.tsx`, `app/globals.css`.
Every claim below cites the file it comes from — nothing is a guess about how the app looks.

---

## 1. Typography

**Current state:** one font stack for UI (`--ui: system-ui, -apple-system, "Segoe UI", Roboto,
sans-serif`) and one for code/raw content (`--mono`), defined once in `app/globals.css`. No
named type scale — every component picks a raw pixel size ad hoc via Tailwind arbitrary values
(`text-[11px]`, `text-[12.5px]`, etc.).

**Critique:** counting distinct `text-[Npx]` values across `app/components/` turns up **14
different sizes in active use**: 9, 9.5, 10, 10.5, 11, 11.5, 12, 13, 14, 15, 16, 17, 19, 20.
Several pairs (10/10.5, 11/11.5) sit close enough that they read as the same size at a glance
but were typed independently — that's not a deliberate fine-grained scale, it's drift from
having no scale at all. The effect isn't chaotic (weight and color are doing most of the actual
hierarchy work — see below), but it means "why is this 11.5 and not 11" has no answer anywhere
in the codebase, and every new component is one more coin-flip added to the pile.

Where hierarchy *does* work well: `AgentView.tsx`'s agent header uses a real jump (name at a
larger size, `.sub` description smaller and muted) and config rows lean on **color + weight**,
not size, to separate label from value — labels at `--faint`/`--accent-ink`, values at full
`--text` contrast. That's the right instinct; it's just not written down as a rule anywhere,
so it's easy for a future addition to default back to "make the important thing bigger" instead.

**Distinction between titles, keys, and values:** keys (`.row-label` in `AgentView.tsx`, `.k`
in the Raw panel) are already color-differentiated from values. Titles (agent name, panel
headers) are differentiated by size + weight. The three tiers are distinguishable today — the
gap is that the ruleset is implicit (tribal knowledge in whoever wrote each component), not a
documented scale a new component can be checked against.

**Recommended changes (presentation only, no behavior):**
- Collapse the 14 sizes to a documented scale of roughly 6 steps (e.g. 10 / 11 / 12 / 13 / 15 /
  20), each with a stated role ("10 = meta/hint text", "12 = body", "20 = page-level title", …).
  Doesn't require touching every file at once — write the scale down first, apply opportunistically.
- No font-family change recommended — system-ui is the correct, neutral, fast choice for a
  developer tool; swapping in a brand typeface here would fight point 5 below (neutrality).

---

## 2. Color System

**Current state (after today's accent-recolor pass):** a single themed accent
(`--accent`/`--accent-ink`/`--accent-wash`, now blue) drives nearly every "this is interactive
or notable" surface — panel glyphs, the brand dot, buttons, hover washes, the config-row label
color. Category-hue pill variables (`--cap`/`--ctl`/`--res`/`--prs`) exist in `globals.css` but
are **explicitly unused** — a prior design decision (2026-07-29, noted in `globals.css`'s own
comment) removed category-hue coloring from pills because it read as noise once rows got their
own labels.

**Critique:** this is a *good* color system for a dev tool — one accent, used consistently,
means the eye learns "blue = act on this" once and it holds everywhere. The risk for branding
is the opposite of most requests: the temptation will be to reach for the company's brand color
as a **second** accent somewhere prominent (e.g. tinting the whole Topbar), which would
re-introduce exactly the per-surface color noise the 2026-07-29 decision and today's accent
consolidation both deliberately moved away from. Brand color and functional accent color
competing for the same "look here" signal is the actual risk to design against, not a lack of
color today.

**Visual grouping using color:** already handled by `--accent-wash` (selection/hover washes)
and the border-per-panel convention — distinct panels, one shared accent. No gap here worth
raising.

**How brand color can be incorporated subtly and professionally:** as a **static identity
mark**, not a functional-state color. Concretely: a small logo/wordmark rendered in the brand's
actual color sits fine in the Topbar or a footer because it never competes with `--accent` for
attention — it's not attached to hover/focus/selection state, so the eye doesn't have to
disambiguate "is this blue because it's brand, or because it's clickable." If the brand color
happens to *be* a blue close to the current accent, that's a lucky coincidence worth leaning
into (visually reinforcing, not competing); if it's a clashing color (e.g. warm orange/red),
render it desaturated/monochrome (single brand-colored logo mark, everything else neutral) rather
than adjusting the app's functional accent to match.

**Recommended changes:** none to the existing token set. When a logo asset exists, treat its
color as fixed/local to the mark itself (`<img>`/inline SVG with its own colors), never wired
into `--accent`/`--accent-ink`.

---

## 3. Layout & Structure

**Spacing between YAML/config fields:** `AgentView.tsx`'s scalar/list rows use a consistent
`gap-2`/`py-[4px]` rhythm (`renderScalarRow`/`renderListRow`), and today's session's item-5 pass
(muted-accent labels) reinforced label/value separation without touching spacing. No spacing
inconsistency found worth flagging.

**Visual hierarchy of agent metadata:** the header block (monogram → name → description →
pills) reads top-down correctly: identity, then identity-details, then machine-readable facts.
This is the part of the app that already looks most like "a record about something," not a
form.

**Integration between the agent panel and AI chat panel:** per today's earlier pass (design
review item 3), Chat now has a taller default height and its own accent-colored border,
visually promoting it to a peer of the Config panel rather than a footnote — this directly
supports the "agent as first-class object" question below, since editing-via-conversation now
reads as equally legitimate to editing the structured fields directly.

**Does the agent feel like a first-class object, or just a file?** Mixed, and this is the one
real structural finding: the **header** (monogram, name, description) reads as "a thing" — an
entity with an identity. But the **Raw panel** sits at full visual weight one pane over,
showing the same agent as literal YAML/markdown bytes, and until today's opacity pass (item 4)
it had *equal* chrome weight to the primary Config panel. The three panels (Config / Chat / Raw)
each show a true, non-conflicting projection of the same object — that's a strength, not a
flaw — but nothing in the current layout states that relationship explicitly. A first-time
viewer has to infer "these three panels are the same agent, viewed three ways" from position
and content alone.

**Recommended changes:**
- No new panel or structural rework needed — the projections are already correct. Consider (as
  a cheap, low-risk addition, not required for item 10): a one-line connective label somewhere
  neutral, e.g. under the agent name in the header, along the lines of *"Structured view · Chat
  · Raw export — three views of this agent"* — makes the three-panes-one-object relationship
  explicit rather than assumed. Optional; flagging because it's directly relevant to "does this
  feel like a first-class object" but is a judgment call, not something the brief asked to fix.

---

## 4. Branding Integration

**Current state:** the "Agent Workbench" wordmark + small accent-colored dot appears in exactly
two places — `Topbar.tsx` (line ~49-55) and `LoginForm.tsx`/`SignupForm.tsx` (their own copy of
the same markup, line ~109-118 in `LoginForm.tsx`). **There is no footer anywhere in the app** —
confirmed by reading `LoginForm.tsx` in full: the card ends at the "Need an account?" link with
no trailing attribution row. There is currently **zero** company-name/copyright/logo presence
distinct from the product's own "Agent Workbench" name — TODO item 10 is entirely greenfield,
not a "move an existing thing" task.

**Best placement for the company logo:**

| Location | Verdict | Why |
|---|---|---|
| **Topbar, next to/replacing the accent dot** | Not recommended as primary | The dot is doing double duty as brand mark *and* as the visual echo of `--accent` used everywhere else (matches `.arow.sel .av`, etc.) — replacing it risks breaking that echo for a logo that has to compete for space with Account/Logout/email in an already-dense row. |
| **Topbar, far right, small, separate from the controls cluster** | Viable, secondary | Low-risk, low-visibility placement — a small mark that doesn't compete with the functional controls. Best if the ask is "just be present," not "be seen." |
| **A new footer strip (app-wide, thin, bottom of viewport)** | **Recommended primary** | Doesn't exist today, so it's pure addition with zero risk of disturbing the workbench's information density (screen real estate is already tight — see the 4-pane layout's `.foot` legend strip in the mockup, which proves a thin bottom strip is an established pattern here, not a new concept). |
| **Login/signup card, below the form** | **Recommended secondary**, pairs well with the footer | These pages are low-density (a single centered card) — the one place in the app with real spare vertical room, and the one place a new user's attention isn't already split across four panels. |
| **Inside the agent identity area (next to the monogram)** | Not recommended | Would conflate "this is the product's brand" with "this is the agent's own identity" — the monogram's entire job (per item 1's original design-review rationale) is representing the *agent*, not the platform. |

**Specific suggestion:** a small monochrome/neutral-tone wordmark or icon-mark, ~16-20px tall,
in a new thin footer strip (reusing the mockup's existing `.foot` chip-row pattern/spacing as
precedent), right-aligned or centered depending on the actual asset's shape once it exists.

**Prototyped 2026-08-06** (`Layout-Workbench.html`) — on reflection, folded into the
*existing* `.foot` legend row (a `.foot-brand` chip after the "drag any divider…" hint, a
thin `border-left` divider separating it from the functional legend) rather than a wholly new
strip, since this same review's own finding above is that vertical room in the 4-pane grid is
already tight — this gets the requested footer presence at zero extra vertical cost, which is
a stricter reading of "minimal" than the original suggestion. Demo content only (`ACME Corp`,
same fake-but-labeled convention as the mockup's demo agent) — **not** carried into real
production pages (`Topbar.tsx`, `LoginForm.tsx`, `SignupForm.tsx`); this review's own
prerequisite (an actual asset/company name/copy) still hasn't been met, and shipping a visible
`<Company Name>`-style placeholder to a real viewer would be worse than shipping nothing.

**How to include "Produced by `<Company Name>`" without clutter:**
- Smallest reasonable type size (10-10.5px, consistent with the scale above's "meta/hint" tier),
  `--faint` color — the same treatment already given to the mockup's own `.foot` legend text and
  to timestamps/hints throughout the app. It should read like a hint, not a heading.
- Static text, not a link, unless there's an actual destination worth sending a user to (a
  company site) — an attribution that's also a nav element invites hover states and focus rings
  that undercut "minimal."
- One line: `Produced by <Company Name>` — resist adding a tagline or copyright year in the same
  breath; if a copyright line is wanted, it's a second, even quieter line below, not inline.

**Ensuring branding feels intentional, minimal, professional:** the strongest signal available
here is *restraint* — this app's whole visual language (per the color-system section above) is
"one accent, used sparingly, everywhere consistent." A branding treatment that follows the same
discipline (one mark, one line of attribution, fixed neutral placement, never animated, never
tied to interactive state) will read as native to the product rather than bolted on. The
opposite failure mode — a colorful logo, a tagline, and a "powered by" badge all fighting for
space in the Topbar — is the one concrete thing to actively avoid.

---

## 5. Overall UX Feel

**Professionalism and clarity:** high, already. The 4-pane workbench, the consistent accent
discipline, and the restrained type/color use all read as a considered developer tool, not a
prototype. Nothing in this review found sloppiness — the typography finding above is drift from
absent documentation, not visible inconsistency a user would notice.

**Does the interface communicate "agent workbench"?** Yes — the panel labels are literal
(*Library*, *Custom Visualization*, *AI Chat*, *Raw agent*), the layout mirrors an IDE (which is
the intended reference point per `architecture/Concept.md`), and the always-visible structured
view next to the always-visible chat is the product's actual differentiator, not an
implementation detail — it's visible on first look.

**Does the structured view feel intentional and helpful?** Yes, per the layout-and-structure
section above — the header-then-fields hierarchy is doing real work, not just dumping frontmatter
into a box.

**Will branding enhance the experience or distract from it?** Depends entirely on restraint.
Given everything above — a codebase with one consistent accent, zero existing footer/attribution
surface, and a deliberate history of *removing* extra color signals rather than adding them
(the 2026-07-29 category-hue pill decision) — the house style here is minimalism-by-precedent.
Branding that respects that precedent (a small mark, a quiet attribution line, placed somewhere
that isn't fighting the workbench's own information density) will read as *this team cares
enough to sign their work*. Branding that doesn't respect it (bright brand colors, prominent
Topbar real estate, an animated logo) will read as marketing bolted onto a tool, which actively
undercuts the "professional developer tool" feel this review otherwise found intact.

---

## Recommended changes (consolidated)

1. Document a ~6-step type scale (typography section) — no component changes required yet,
   just writing down the rule so future additions have something to check against.
2. No color-token changes — keep the brand mark's color local to the asset itself, never wired
   into `--accent`/`--accent-ink`.
3. Optional, low-priority: a one-line connective label near the agent header naming the
   Config/Chat/Raw three-views relationship explicitly (layout-and-structure section).
4. Add a new thin app-wide footer strip (primary logo placement + attribution line).
5. Add matching, smaller attribution under the login/signup card (secondary placement).
6. When the actual logo asset and company name/copy are ready: prototype items 4-5 in
   `Layout-Workbench.html` first, per standing rule 4 — this review recommends *where* and
   *how much*, not final pixel values, which should be tuned against the real asset.

## Description of the improved layout

Visually, almost nothing about the current 4-pane workbench changes. The only new surface is a
thin footer strip below the existing `.workbench` grid (same visual weight as the mockup's
existing `.foot` legend row — this app already has precedent for a quiet bottom strip, so this
isn't a new pattern, just a new instance of one) carrying a small neutral-toned logo mark and,
optionally, the attribution line. On `/login` and `/signup`, the same attribution line appears
in `--faint` text below the existing card, matching the hint-text treatment already used
elsewhere on those pages (the OAuth "or" divider, the "Need an account?" line).

## Merged-layout concept

There's only one real design here (no second layout to merge strengths from), so the "merged"
version is: **keep the current workbench pixel-for-pixel, add the footer strip described above
as a pure addition beneath it.** This is deliberately the lowest-risk path — it adds the
requested company presence without touching, resizing, or re-weighting a single existing panel,
which matters given how tightly the vertical space in the 4-pane grid is already budgeted
(`center-bottom` alone grew 240→320px just today for weight reasons — there's no spare vertical
room to take branding *out of* the workbench itself without a real fight over pixels that
belong to functional panels today).
