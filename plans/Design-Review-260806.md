# Design Review — 2026-08-06

A presentation-only UI/UX review of the workbench (real app, both themes — not the mockup),
run against a fixed rubric (typography, color system, layout & structure, overall feel).
Companion to `plans/Evaluation-260730.md` in role — a point-in-time outside opinion, not a
build plan — but unlike that one, every recommendation here was also **implemented** the
same session, in both the real app and `architecture/layout/Layout-Workbench.html`, so the
user can review the result live and decide what to keep. No functional/behavioral change —
every item below is styling only.

## How to use this file

Each item has a **Verdict** slot — fill in `KEEP`, `REVERT`, or `ADJUST: <note>` after
reviewing live. Nothing here is final until that's filled in.

---

## Item 1 — Agent color drives the monogram

**Before:** the header monogram avatar (`AgentView.tsx`) was always accent teal
(`bg-[var(--accent)]`), regardless of the agent's own `color:` config value. That value was
only ever expressed as a small dot next to its config pill — nowhere else.

**After:** the monogram now reads `configMap.get('color')` and looks it up against the
existing `COLOR_HEX` map (the same one already used for the pill swatch); falls back to
accent teal when `color` is unset or not a recognized value.

**Files:** `app/components/CustomViz/AgentView.tsx` (`agentColorHex` computed just above the
header return, applied as an inline `style` override on the monogram `<div>`).

**Mockup note:** the mockup's `.bigav` avatar already had `style="background:#9b59b6"` — it
was already ahead here, just as a fixed demo value rather than something computed from live
config. No mockup change needed; real code now matches what the mockup already showed.

**Verdict:** REVERT (2026-08-06) — monogram no longer reads the agent's `color` config
value; back to plain `bg-[var(--accent)]`. Border/square colors should follow the theme
accent, not per-agent color. See the follow-up accent recolor below.

---

## Item 2 — Custom Visualization panel border tinted with agent color

**Before:** the Config/Viz panel's border was the same neutral gray as every other panel —
Library, Chat, Raw — no visual signal that this panel belongs to a specific, colored agent.

**After:** the panel's border now uses the same agent-color lookup as item 1 (`PANEL_COLOR_HEX`,
a small duplicate of `COLOR_HEX` — see note below) and falls back to the default gray border
when unset.

**Files:**
- `app/components/WorkbenchShell.tsx` — `agentPanelColor` computed from `agent.config`,
  applied via `style={{ borderColor: agentPanelColor }}` on the Custom Visualization `Panel`.
- `architecture/layout/Layout-Workbench.html` — `.center-top{border-color:#9b59b6}` (the
  mockup's one demo agent's fixed color; no live config state to compute from there).

**Note on the duplicated color map:** `PANEL_COLOR_HEX` in `WorkbenchShell.tsx` is a second
copy of `AgentView.tsx`'s `COLOR_HEX` (8 entries). Small enough to duplicate rather than add
a shared module for two lookups — flagging in case a third caller ever needs it, at which
point it should move to one shared place.

**Verdict:** REVERT (2026-08-06) — border no longer reads `agent.config`'s `color` value;
`PANEL_COLOR_HEX` removed as dead code. Border follows the theme accent (default), same as
every other panel.

---

## Item 3 — Chat panel gets more visual weight

**Before:** default height 240px, same neutral border as every other panel. Chat is the
primary way you act on an agent, but visually it read as a footnote under the Config zone.

**After:** default height raised to 320px, border color set to the accent color (not the
agent's own color — this is "this is where you act," a constant identity for the chat
surface itself, distinct from the agent-specific tint on the Config panel).

**Files:**
- `app/components/WorkbenchShell.tsx` — `chatHeight` initial state 240→320;
  `style={{ height: chatHeight, borderColor: 'var(--accent)' }}` on the Chat `Panel`.
- `architecture/layout/Layout-Workbench.html` — `.center-bottom{flex:0 0 320px; ...
  border-color:var(--accent)}` (was 240px, default border).

**Verdict:** KEEP (2026-08-06) — already theme accent (`var(--accent)`), not agent color;
matches the "borders should follow theme" direction confirmed alongside items 1/2's revert.

---

## Item 4 — Raw panel visually quieter than the Config panel

**Before:** the Raw panel (read-only export preview) had identical visual weight to the
Config panel (the primary editing surface) — same border contrast, same chrome saturation —
despite being explicitly secondary/reference material.

**After:** a flat `opacity: .92` on the whole panel. Chosen over hand-picking a lighter
border color because opacity is theme-agnostic (works identically in light/dark without a
second set of hardcoded values) and softens the panel uniformly rather than just one edge.

**Files:**
- `app/components/WorkbenchShell.tsx` — `className="flex-none opacity-[.92]"` added to the
  Raw `Panel`.
- `architecture/layout/Layout-Workbench.html` — `.right{...; opacity:.92}`.

**Verdict:** _(fill in)_

---

## Item 5 — Config-row labels: muted accent instead of plain gray

**Before:** every config row's label (`Permission mode`, `Tools`, `Max turns`, ...) and its
value pill were both rendered in roughly the same visual weight — the only distinction was
position (label left, pill right) and the label being slightly more muted gray. The raw
panel's frontmatter view, by contrast, already colors the `key:` portion distinctly from its
value — this borrows that same contrast into the structured Config zone.

**After:** row labels recolored from `text-[var(--faint)]` (plain gray) to
`text-[var(--accent-ink)]` at 80% opacity (a muted, not full-saturation, accent tone) — same
idea as the raw panel's key coloring, deliberately dialed back from full accent so it reads
as "a labeled field," not a wash of teal down the left column. Pill values are unchanged
(already at full `text-[var(--text)]` contrast, the darkest tone available).

**Scope note:** this pass only covers the two-column scalar grid and the full-width list
rows (`renderScalarRow` / `renderListRow`) — the block headers for `initialPrompt`,
`hooks`/`mcpServers`, and body Sections were left as-is; they already have stronger
differentiation (bold label, chevron, dedicated header row) and weren't the weak point the
review flagged. Worth revisiting only if the same "key pops, value stays plain" treatment is
wanted there too.

**Files:**
- `app/components/CustomViz/AgentView.tsx` — both `.row-label`-equivalent spans (scalar row
  ~line 889, list row ~line 1118) recolored.
- `architecture/layout/Layout-Workbench.html` — `.row-label{color:var(--accent-ink);
  opacity:.8}` (was `color:var(--faint)`), shared by both scalar and list rows there.

**Verdict:** _(fill in)_

---

## Not implemented (judgment calls, flagged for discussion rather than acted on)

- **Category-hue pill coloring** (tool vs. skill vs. MCP-server pills styled distinctly) —
  the review's color-system section floated this as a "consider," but the codebase has an
  explicit prior decision against category-hue coloring (dropped once rows got their own
  labels — read as noise). Left alone rather than re-litigating that call unprompted.
- **Value darkening/weight increase** — the review's typography section suggested giving
  values more weight than labels. In practice, pill values were already at full `--text`
  contrast (the darkest available tone) before this pass, so there was nothing left to darken
  — item 5's label recoloring achieves the same relative contrast from the other direction.

---

## Follow-up — accent recolor teal → blue, and items 1/2 reverted (2026-08-06, same day)

After reviewing items 1–5 live, two decisions:

1. **Items 1 & 2 reverted.** Per-agent-color tinting (monogram avatar, Custom Visualization
   border) added noise without earning it — border/square colors should track the **theme**
   (light/dark accent), not each agent's own `color` config value. `AgentView.tsx`'s
   `agentColorHex` and `WorkbenchShell.tsx`'s `PANEL_COLOR_HEX`/`agentPanelColor` were removed;
   both surfaces are back to plain `var(--accent)`. `COLOR_HEX` itself is untouched — still
   used for the config pill's color swatch dot, unrelated to this revert.

2. **Global accent recolored teal → blue.** `--accent` / `--accent-ink` / `--accent-wash`
   in `app/globals.css` and `Layout-Workbench.html` (all 4 theme blocks: `:root`, `@media
   dark`, `[data-theme="light"]`, `[data-theme="dark"]`) changed from teal to blue:
   - Light: `--accent #0e9d8e→#1479c9`, `--accent-ink #0a5f57→#0b4f85`,
     `--accent-wash rgba(14,157,142,.10)→rgba(20,121,201,.10)`
   - Dark: `--accent #3fb6a8→#4fa8e0`, `--accent-ink #8fe0d5→#a8d4f5`,
     `--accent-wash rgba(63,182,168,.12)→rgba(79,168,224,.12)`

   Single source of truth (only these two files ever hardcode the hex — everything else
   consumes `var(--accent)`), so this is a two-file edit, not a component hunt. Any future
   accent change (blue → something else) works the same way.

   **One pinned exception:** the Raw panel's frontmatter key coloring
   (`RawAgentView.tsx`'s `fm-field` key span, mockup's `.k` class) was explicitly called out
   to **stay the old teal**, not follow the theme accent — it's a fixed "this is a key"
   convention, not a themed UI accent. Moved to a new dedicated variable, `--raw-key`
   (`#0a5f57` light / `#8fe0d5` dark — the exact old `--accent-ink` values), defined
   alongside `--accent` in both files but never reassigned when `--accent` changes.

**Files:** `app/globals.css`, `architecture/layout/Layout-Workbench.html`,
`app/components/CustomViz/AgentView.tsx`, `app/components/WorkbenchShell.tsx`,
`app/components/Raw/RawAgentView.tsx`.
