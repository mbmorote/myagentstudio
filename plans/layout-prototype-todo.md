# Layout prototype hand-off list

Simple running TODO — not a numbered execution-spec plan like `01`/`02`/`03`. Every layout/
UI change gets prototyped first in `design/layout/Layout-Workbench.html` (per standing
project rule), then listed here until it's migrated into the real app (`WorkbenchShell.tsx`,
`SectionBlock.tsx`, `AgentView.tsx`, etc.) — mirrors how the Tier 1 Config zone redesign was
tracked before its 2026-07-29 migration. Mark an item `✅ migrated` with the commit/date once
`@dev` (or a manual session) has ported it into real code; don't delete finished rows, so
this stays a full record of what shipped and when.

---

## 🔲 Not yet migrated

*(none currently)*

---

## ✅ Migrated

All five items below were prototyped in `Layout-Workbench.html` and migrated into the real
app in the same session, 2026-07-29. Verified live against the real local DB (the `dev`
agent — 47 real MCP tools, a perfect fixture for the cap) with `npx tsc --noEmit` and
`npm test` (132/132) both clean. **Not committed yet** — per standing rule 1, changes sit
uncommitted in the working tree until the user explicitly says to commit.

### 1. Library panel — Agents/Grouped toggle + Manage separator
**Migrated to:** `app/components/shell/Panel.tsx` (`role` prop widened to `React.ReactNode`),
`app/components/WorkbenchShell.tsx` (owns `libraryMode` state + renders the toggle as the
Panel header's `role`, now renders `LibraryPanel` directly instead of accepting a
`libraryContent` prop), `app/components/Library/LibraryPanel.tsx` (new `mode` prop drives
flat-vs-grouped rendering; dropped the old redundant flat "All agents" pseudo-section
entirely), `app/components/Library/ImportButton.tsx` (label renamed "Import .md" →
"Import agent"), `app/agents/[id]/page.tsx` (simplified — no longer builds `LibraryPanel`
JSX itself, `WorkbenchShell` does).
**Behavior:** matches the mockup — the word next to "Library" in the panel header (default
"Agents") is the toggle itself; click flips it to "Grouped" and back. Independent of
selection. Manage separator order: New agent, New group, Import agent.
**Deviation from the hand-off note below:** `WorkbenchShell`'s old `libraryContent?:
ReactNode` prop was removed rather than kept — it was redundant with the `agents`/`groups`
props `WorkbenchShell` already received, and had exactly one caller. No test referenced it.

### 2. Config list-item cap ("+N more")
**Migrated to:** `app/components/CustomViz/AgentView.tsx` (`LIST_ITEM_CAP = 14` constant,
`listExpanded` state, cap/expand logic in `renderListRow`).
**Behavior:** matches the mockup — caps at 14 visible pills, "+N more ▾" / "show less ▴"
toggle, "+ add" hidden while collapsed. Verified live: `dev`'s real 47-tool list correctly
capped with a "+33 more" pill.
**Note:** `SectionBlock.tsx` was not touched — list-item pills are entirely an `AgentView.tsx`
concern (Tier 1 Config zone); `SectionBlock.tsx` only renders Tier 2 section bodies.

### 3. Red "invalid" pill tier (vs. existing yellow "outdated")
**Migrated to:** `app/components/CustomViz/AgentView.tsx` (`renderScalarRow`'s `isInvalidInt`
check, `border-[var(--err)]` styling, ✕ prefix).
**Icon confirmed with the user before building:** ✕ (not ❗).
**Behavior:** an int-datatype scalar (currently just `maxTurns`) holding a non-positive or
non-numeric value renders in the new red/`--err` tier with a ✕ prefix and a "click to fix"
tooltip, distinct from the existing yellow `⚠` tier used for unrecognized-but-well-formed
enum/tool values. Verified live via a temporary DB-level `maxTurns` seed (inserted, screenshotted,
then removed — not part of the migration itself).
**Deviation from the hand-off note below:** implemented as a local derivation inside
`renderScalarRow`, matching the existing pattern the file already uses for the yellow
`isValidEnum` tier (also computed locally, not via `Rules.computeValidation`) — the earlier
note assumed the pill's badness came from the shared lib rule function; it doesn't,
`AgentView.tsx` has always derived pill validity client-side. `lib/blueprint/rules.ts` was
not touched.

### 4. Folded side-panel gap
**Migrated to:** `app/components/shell/Rail.tsx` (new optional `className` prop),
`app/components/WorkbenchShell.tsx` (`mr-[9px]` / `ml-[9px]` passed at each Rail call site).
**Behavior:** matches the mockup exactly — folding Library or Raw agent now leaves a clean
gap to the center panel instead of sitting flush against it. Verified live in both directions.

### 5. Compact MCP tool pills
**Migrated to:** `app/components/CustomViz/AgentView.tsx` (`MCP_DISPLAY_RE`, `mcpDisplayOf()`,
wired into `renderItemPill`'s normal-item branch).
**Behavior:** matches the mockup — `mcp__server__tool` items render as `mcp:<tool>`, full
qualified name moves into the tooltip. **Real-world caveat found during migration:** the
`dev` agent's actual stored tool names are a differently-shaped, non-standard string
(`atlassian-mcp-server-addCommentToJiraIssue`, hyphens not the `mcp__server__tool` double-
underscore spec) — those don't match `MCP_DISPLAY_RE` and correctly fall through to the
existing yellow "unrecognized" tier instead of being compacted. That's a pre-existing data-
shape issue with how those tools got named/imported, unrelated to and not fixed by this item.
