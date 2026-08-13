# Plan 03 — Visual Shell Alignment, Library, Groups, and In-Browser Import

> Turns two things into one ordered, file-by-file build:
>
> 1. `design/Concept.md`'s build-order item #2 ("Library + groups (left panel) — cheap,
>    wanted early"), plus the one usability gap Phase 4 left behind — there is currently no
>    way to get an agent into the app from the browser (`POST /api/agents/import` only
>    exists as a raw API call; confirmed live, 2026-07-28, seeding the `dev` agent required
>    a manual `curl`). Named in `plans/02-import-hardening-structural.md`'s Phase D table
>    ("UI mode picker + import warnings surface — Phase 4") but never landed in Phase 4's
>    actual scope.
> 2. **Visual/structural alignment with `design/layout/Layout-Workbench.html`** — the
>    settled "look" (per `CLAUDE.md`: "the look. Interactive, self-contained mockup of the
>    settled 4-pane UI"). Reviewing it against what Phase 4 actually shipped (2026-07-28)
>    surfaced real gaps, not just cosmetic ones: no Raw `.md` pane exists at all, no
>    fold/resize mechanics, no design tokens (plain default Tailwind/shadcn instead of the
>    mockup's teal-accent system), config as a table instead of pills, chat with no
>    per-change "target" chips. **The user confirmed Example A (chat as a prompt bar under
>    the visualization, raw agent on the right) is the one real, locked layout** — Example B
>    and the layout-toggle control in the mockup were exploration, not a shipped choice; no
>    A/B switcher gets built.
>
> Folded together because Phase C below (the Library panel) would otherwise get built twice
> — once in today's plain styling, once restyled — since it touches the same
> `WorkbenchShell` the shell-alignment work rebuilds. Phase B (shell) has to land first.
>
> **This file is the spec for `@dev` — execute phases in order.** Do not commit or make any
> real Anthropic API call without the user's explicit ask (standing project rules,
> `CLAUDE.md`).

---

## 0. Ambiguities resolved before build

| # | Gap | Resolution for this plan | Why this is safe |
|---|---|---|---|
| R1 | **Group nesting.** `Group.parentId` exists in the schema but Plan 01 deliberately left it always `null` ("flat MVP", §3 notes). Does this plan turn it on? | **No — stays flat.** Every group created here has `parentId: null`. The column exists for a future nested-groups feature; this plan doesn't touch it. | Matches Plan 01's explicit original intent; nesting is real added UI complexity (tree rendering, cycle prevention) the "cheap, wanted early" framing doesn't ask for. |
| R2 | **Membership cardinality.** Can one agent belong to more than one group? | **Yes — many-to-many.** `membership`'s composite PK is `(agentId, groupId)`, which already structurally supports it; nothing forces one-group-per-agent. | Tagging is the natural model for "organize my agents" and costs nothing extra — the schema already allows it, only the UI/routes need to. |
| R3 | **`deleteAgent` doesn't clean up `membership` rows.** Confirmed live in `lib/db/repository/agents.ts`: it deletes `agentConfig`, `agentSection`, `agent`, but never touches `membership`. Since `membership.agentId` has no FK cascade (soft-reference pattern, consistent with the rest of the schema), deleting an agent today would leave orphan rows. | **Fix required, not optional.** `deleteAgent` must also delete the agent's `membership` rows in the same transaction. This is *not* a rule-4 violation (unlike `SectionRevision`/`AgentSnapshot`, `membership` is a pure index with no historical value — there's nothing to preserve). | Silent orphan rows would corrupt future group-membership queries the moment this plan's own features are used. Must ship together. |
| R4 | **Deleting a group.** Does it delete the agents in it? | **No.** Deleting a group deletes only its `membership` rows (the agents themselves are untouched, they just become ungrouped). | Groups are an organizational label, not a container with ownership semantics. |
| R5 | **Agent-switching UX.** `app/page.tsx` today is a Server Component that always loads "the first agent" — there's no way to view a different one. | **Per-agent route: `app/agents/[id]/page.tsx`**, same Server Component pattern as today's `page.tsx` but parameterized. `app/page.tsx` redirects to the first agent in the list (or renders the existing empty state if there are zero agents). Left-pane agent rows are `next/link`s to `/agents/[id]`. | Keeps `WorkbenchShell`'s existing Server-Component-loads-then-hands-off-to-client-state pattern intact. A full route navigation naturally resets `WorkbenchShell`'s local state (chat history, interaction lock, fold/resize — R15) when switching agents. |
| R6 | **Import UI input shape.** File picker, paste box, or both? | **Both, feeding one `<textarea>`.** A file `<input type="file">` reads the selected `.md` client-side (`FileReader`) and fills the same textarea a user could otherwise paste into directly. No server-side file-upload endpoint — the existing `POST /api/agents/import` already takes raw text in the body. Rendered inside the modal from D2 (resolved below). | Cheapest UI that covers both real usage patterns without adding `multipart/form-data` handling to a route that doesn't need it. |
| R7 | **Import mode picker default.** Plan 02 made `'structural'` the API's default. Should the UI default match? | **Yes.** Radio/select defaults to Structural, Strict as the explicit secondary choice. | Consistency with Rules Index #27 (Structural is primary/default). |
| R8 | **Drag-and-drop library.** D1 (below) resolved to drag-and-drop over click/checkbox — needs a real implementation choice. | **`@dnd-kit/core`** (+ `@dnd-kit/utilities` if needed). One new dependency. | The modern standard for React DnD — actively maintained, works with React 19, accessible out of the box unlike hand-rolled native HTML5 DnD. |
| R9 | **Drag semantics: does dropping an agent into a group *move* it there or *add* it (R2 already locked many-to-many)?** | **Add, never move.** Dropping adds a membership; it never removes an existing one. Removing from a specific group is a small "×" on the agent row *when rendered inside that group's section*. | Keeps drag-and-drop unambiguous under many-to-many membership. |
| R10 | **Which mockup layout is real — Example A, Example B, or a user-facing toggle between them?** | **Example A only, locked.** Chat renders as a prompt bar under the Custom Visualization (center-bottom); Raw agent renders on the right. No layout-switcher UI gets built — the mockup's `Example A / Example B` segmented control in its topbar is exploration artifact, not part of this build. | Explicit user instruction (2026-07-28): "the example A on the mock should be the real one." Removes an entire UI surface (the switcher) and a whole alternate arrangement (Example B) from scope. |
| R11 | **The Raw pane needs something to render — no export capability exists server-side today.** `lib/serialize/export.ts`'s `exportAgent()` is a pure function over a `StructuredAgent`; nothing currently assembles one from a live DB agent for read purposes (the closest thing, `serializeAgentSnapshot` in `agents.ts`, is a private helper that also *writes* an `AgentSnapshot` row — more than the Raw pane needs). | **New read-only `GET /api/agents/[id]/export` route**, `text/plain` response, computed fresh from the agent's current sections/config on every request. No `AgentSnapshot(kind:'export')` row is written — that's Rules Index #16, still explicitly deferred to a later export-UX plan (Concept.md build-order #3). This is compute-on-read only. | Gives the Raw pane real content without touching the deferred snapshot/export-UX feature. `exportAgent()` itself is unchanged — only a new call site. |
| R12 | **Design tokens.** How do the mockup's CSS custom properties (`--bg`, `--panel`, `--accent`, etc.) get into a Tailwind/shadcn codebase? | **Ported verbatim into `app/globals.css`** as real CSS custom properties (same names, same light/dark values, same `@media (prefers-color-scheme: dark)` + `[data-theme]` override structure as the mockup), consumed via Tailwind's arbitrary-value syntax (`bg-[var(--panel)]`, `text-[var(--muted)]`, `border-[var(--border)]`, `rounded-[9px]`, etc.) rather than a `tailwind.config.ts` theme extension. | Smaller, lower-risk diff for a shell this size — no `tailwind.config.ts` color-scale rewrite, no risk of shadcn's existing slate tokens colliding with a parallel theme system. The mockup's own values are the source of truth; copy them, don't reinterpret them. |
| R13 | **Chat "target" chips — the mockup's demo dialogue shows the mediator editing `model` and `tools` (frontmatter/config).** The actual chat mediator (Phase 4) only ever rewrites `AgentSection` content — `POST /api/chat`'s contract never touches `AgentConfig`. | **Target chips reflect reality, not the mockup's demo copy.** Every chip this plan renders reads `◆ section · <sectionKey>` for a section the mediator actually changed. There is no config-editing chat path, and this plan does not add one. | Extending the mediator to edit frontmatter would be a real contract change (Draft D, §7 of Plan 01) — out of scope for a visual-alignment pass. Flagging this now so nobody later assumes the mockup's demo dialogue is a spec for chat capability. |
| R14 | **Section collapse.** The mockup's sections have a chevron (expanded/collapsed); the built `SectionBlock` is always fully expanded. | **Add the chevron toggle**, default expanded, per-section local state (not persisted — resets on navigation, same as everything else in R15). | Matches the mockup; cheap, no new state-management layer needed. |
| R15 | **Does fold/resize/collapse state persist (e.g. `localStorage`)?** | **No — component-local `useState` only**, same as the mockup's own reference implementation (plain JS variables, resets on reload). | Matches the mockup exactly (it doesn't persist either) and avoids scope creep into a settings/preferences layer this plan doesn't otherwise need. Explicitly deferred, not silently decided. |

---

## 1. Guiding constraints (locked — do not replan)

- No new database tables or columns. `group` and `membership` (`lib/db/schema.ts`) were built
  in Plan 01 Phase 2 and are unused until now — this plan is exactly their trigger.
- `lib/db/repository/*` remains the only DB import surface (Rules Index #8a) — new group/
  membership functions go in a new `lib/db/repository/groups.ts`; the export helper (R11)
  goes in `lib/db/repository/agents.ts` alongside its existing `serializeAgentSnapshot`,
  exported through the barrel (`lib/db/repository/index.ts`).
- No change to `POST /api/agents/import`'s contract (Plan 02) — this plan only adds a UI that
  calls it. No change to `POST /api/chat`'s contract (Plan 01 Draft D) — R13 is explicit that
  this plan does not extend the mediator to touch config.
- **Example A is the only layout this plan builds** (R10) — no topbar layout switcher, no
  Example B arrangement, anywhere in the code.
- Design tokens come from the mockup verbatim (R12) — no new color/spacing system invented,
  no `tailwind.config.ts` theme-extension rewrite.
- Two new dependencies are approved, and nothing beyond them without flagging it first:
  `@dnd-kit/core` (R8, drag-and-drop) and shadcn's `Dialog` primitive (`npx shadcn add
  dialog`, pulling in `@radix-ui/react-dialog` — `components.json` has been configured for
  this since Phase 0, just never used).
- Standing project rules apply throughout: no commit without explicit ask; no real Anthropic
  API call without explicit ask — build and unit-test everything with the AI client mocked,
  the same pattern every existing route test already uses. The shell-alignment work (Phase B)
  makes zero API calls of any kind — it's pure UI plus one new deterministic (non-AI) route.

---

## 2. File creation order (the build phases)

```
Phase A  Repository + routes ......... group/membership CRUD, deleteAgent fix, lite-DTO groups, export route   [GATE: repo + route tests green]
Phase B  Visual shell alignment ...... design tokens, Panel/fold/resize primitives, fixed Example-A layout, Raw pane, section collapse, config pills, chat target chips   [GATE: side-by-side browser check against the mockup]
Phase C  Library panel ............... real grouped agent list + drag-and-drop, built on Phase B's Panel primitive   [GATE: browser check — list renders, switching/grouping/import trigger all work]
Phase D  Import UI .................... modal, wired to the existing import route   [GATE: browser check only — do NOT submit a real import without the user's ask]
```

### Phase A — Repository + routes

| Order | File | Responsibility |
|---|---|---|
| A.1 | `lib/db/repository/agents.ts` | **Fix R3**: `deleteAgent` also deletes `membership` rows for the agent, inside the existing transaction. |
| A.2 | `lib/db/repository/groups.ts` | New file. `createGroup(name)`, `listGroups()` (each with its member agent IDs), `deleteGroup(groupId)` (deletes the group row + its `membership` rows only), `addMembership(agentId, groupId)`, `removeMembership(agentId, groupId)`. All `parentId: null` (R1). `createGroup` on a duplicate `name` throws the same `NameExistsError`-shaped error `updateAgent` already uses in `agents.ts`, for a consistent 409 at the route layer. |
| A.3 | `lib/db/repository/agents.ts` | Extend `listAgents()`'s lite DTO with `groupIds: string[]` (via a join against `membership`). `getAgentFull` is unchanged. |
| A.4 | `lib/db/repository/agents.ts` | **R11**: extract the frontmatter-build + `exportAgent()` call already inside the private `serializeAgentSnapshot` into a new exported `exportAgentMarkdown(agentId): string | null` (returns `null` if the agent doesn't exist) that reads the agent's *current* sections/config fresh — no snapshot write, no `AgentSnapshot` row. `serializeAgentSnapshot` keeps calling the same shared inner logic so the two don't drift. |
| A.5 | `lib/db/repository/index.ts` | Barrel exports for the new group functions, `exportAgentMarkdown`, and their types. |
| A.6 | `app/api/groups/route.ts` | `GET` → `Group[]` (each with `memberAgentIds`). `POST` → `{name: string}` → `201 Group`; `409 { error: 'name_exists' }` on duplicate. |
| A.7 | `app/api/groups/[id]/route.ts` | `DELETE` → `204`; `404` if the group doesn't exist. |
| A.8 | `app/api/agents/[id]/groups/route.ts` | `POST` → `{groupId: string}` → adds the membership row, `201 { ok: true }`; `404` if agent or group doesn't exist; idempotent if the membership already exists (no `409`, just `200`). |
| A.9 | `app/api/agents/[id]/groups/[groupId]/route.ts` | `DELETE` → removes the membership row, `204`; `404` if it doesn't exist. |
| A.10 | `app/api/agents/[id]/export/route.ts` | **R11**: `GET` → `text/plain` body = `exportAgentMarkdown(id)`; `404` if the agent doesn't exist. |
| A.11 | `lib/db/repository/__tests__/groups.test.ts` | New tests: create/list/delete group; add/remove membership; **`deleteAgent` no longer leaves orphan `membership` rows (the R3 regression test)**; `listAgents()` lite DTO carries correct `groupIds`; `exportAgentMarkdown` output round-trips through `parse()` back to the same sections/frontmatter. |
| A.12 | `app/api/groups/__tests__/groups.test.ts`, `app/api/agents/__tests__/export.test.ts`, + additions to `app/api/agents/__tests__/agents.test.ts` | Route-level tests for A.6–A.10, following the existing mocked-DB pattern. |

**Gate A:** `npm test` green including the new suites; `deleteAgent` regression test passes;
`npx tsc --noEmit` clean.

### Phase B — Visual shell alignment

| Order | File | Responsibility |
|---|---|---|
| B.1 | `app/globals.css` | Port the mockup's full token set — `:root`, `@media (prefers-color-scheme: dark)`, `:root[data-theme="light"]`, `:root[data-theme="dark"]` — verbatim: same variable names (`--bg`, `--panel`, `--elev`, `--border`, `--text`, `--muted`, `--faint`, `--accent`, `--accent-ink`, `--accent-wash`, `--ok`, `--warn`, `--err`, `--grip`), same values (R12). |
| B.2 | `app/components/shell/Panel.tsx` | New. Reusable panel chrome: header (glyph + uppercase label + optional `.role` subtitle + optional fold button) + scrollable body — matches the mockup's `.panel`/`.phead`/`.pbody`. |
| B.3 | `app/components/shell/Rail.tsx` | New. Collapsed-panel icon rail (`.rail`) — click to un-fold. |
| B.4 | `app/hooks/useResizable.ts` + `app/components/shell/Gutter.tsx` | New. Drag-to-resize divider, ported from the mockup's `onDown`/`onMove`/`onUp` handlers — same clamps (150–640px width, 120–520px height). |
| B.5 | `app/components/shell/Topbar.tsx` | New. Brand + theme toggle only (R10 — no layout switcher). |
| B.6 | `app/components/WorkbenchShell.tsx` | Rewritten around the fixed Example-A grid: `Topbar` on top; below it, Left = `Panel`(Library — Phase C fills the body) with fold+resize, Center = `Panel`(Viz) stacked over a `Gutter` over `Panel`(Chat), Right = `Panel`(Raw) with fold+resize. Fold/resize state is local `useState` (R15). `key={agent.id}` on the root so switching agents resets all local state, chat history included. |
| B.7 | `app/components/CustomViz/AgentView.tsx` | Config zone rewritten from a table to pills — `.pill` for each known config value, `.pill.warn` for each validation flag (outdated `model`, unrecognized `tools` entries), `.pill.grp` for each group the agent belongs to (reads the agent's `groupIds` + group names from `GET /api/groups`, loaded by `WorkbenchShell`/passed down — ties directly into Phase A/C's group data). Agent header rewritten to match `.agentcard-head`: monogram avatar (first two characters of the name), name as heading, `source`/`platform` subtitle line. |
| B.8 | `app/components/CustomViz/SectionBlock.tsx` | Add the chevron expand/collapse (R14) wrapping the existing content rendering; existing raw-edit/interaction-lock behavior is unchanged, just gated behind "expanded". |
| B.9 | `app/components/Raw/RawAgentView.tsx` | New. Fetches `GET /api/agents/[id]/export` (A.10/R11) and renders line-numbered monospace text (`.raw`/`.rn`/`.rc`) — the frontmatter block (between the two `---` lines) dimmed (`.fm`), any line starting with `# ` colored as a heading (`.h1`). No full markdown parsing — a simple per-line classifier is enough (mirrors the mockup's own `buildRaw()`, which does exactly this). |
| B.10 | `app/components/Chat/ChatPanel.tsx` | Message bubbles restyled to `.msg`/`.bubble`/`.who`; each section the mediator actually changed in a response gets a `.target` chip reading `◆ section · <sectionKey>` (R13 — sections only, never config, regardless of what the mockup's demo dialogue shows). |

**Gate B (manual browser check — no API calls, this is pure UI):** open the app side-by-side
with `design/layout/Layout-Workbench.html` (which defaults to Example A) and confirm: panel
chrome, colors, rounding, and the fixed three-pane-with-split-center layout visually match;
folding each side panel to its rail and back works; dragging all three dividers (left↔center,
viz↔chat, center↔right) resizes within the mockup's own clamps; sections collapse/expand;
config renders as pills with the same two validation flags styled `warn`; the Raw pane shows
the live `dev` agent's actual exported markdown, line-numbered, frontmatter dimmed, headings
colored.

### Phase C — Library panel

| Order | File | Responsibility |
|---|---|---|
| C.1 | `app/page.tsx` | Rewritten per R5: loads `listAgents()`; zero agents → existing empty state; one or more → redirect (`next/navigation`'s `redirect()`) to `/agents/{first.id}`. |
| C.2 | `app/agents/[id]/page.tsx` | New. Same Server Component shape as today's `page.tsx` (loads one full `AgentDTO` via `getAgentFull`, plus `listAgents()` and `listGroups()` for the Library panel and pills) but keyed off the route param. `404` (Next's `notFound()`) if the agent ID doesn't exist. |
| C.3 | `app/components/Library/LibraryPanel.tsx` | New. Fills Phase B's left `Panel` body: wrapped in `@dnd-kit/core`'s `DndContext`; renders groups as headers with their member rows, plus the mockup's two pseudo-groups — **"All agents"** (every agent, flat) and **"Ungrouped"** (agents with zero `groupIds`) — then a separator, then the action rows ("＋ New agent" → C.6, "⇪ Import .md" → Phase D). |
| C.4 | `app/components/Library/AgentListItem.tsx` | New. One row: monogram avatar (same two-character rule as B.7's agent header), name, an `imported`/`created` tag matching the agent's `source`, drag handle (`useDraggable`), delete button (`window.confirm` — no custom confirm-dialog exists, and building one is out of scope beyond the import modal's `Dialog`) calling `DELETE /api/agents/[id]`. Selected/current agent gets the `.sel` highlight. When rendered inside a `GroupSection`, also shows the "×" remove-from-this-group action (R9). |
| C.5 | `app/components/Library/GroupSection.tsx` | New. One group's collapsible header + member rows, wrapped as a `useDroppable` drop zone (R8/R9 — dropping an `AgentListItem` here calls `POST /api/agents/[id]/groups`); "+ New group" affordance (`POST /api/groups`); delete action (`DELETE /api/groups/[id]`) with confirm. "All agents" and "Ungrouped" render via the same row component but are not drop targets (R9 — no "add to ungrouped" action; "All agents" isn't a real group). |
| C.6 | `app/components/Library/CreateAgentButton.tsx` | New. Minimal "+ New agent" — name + description inputs, `POST /api/agents` (exists from Phase 4), navigates to the new agent's route on success. |

**Gate C (manual browser check, `@dev` — no API calls needed, this is all local CRUD):**
open the app → the seeded `dev` agent appears under "Ungrouped" and in "All agents" → create a
group → **drag** `dev` onto the new group's drop zone → `dev` now renders under the new group
*and* "Ungrouped" is empty (add, not move — confirm R9) → click the "×" on `dev` inside the
group to remove that one membership, confirm it falls back to "Ungrouped" → create a second
agent via "+ New agent" → switch between the two via the Library list, confirm the center/right
panes update, chat history clears, and fold/resize state resets (R5/R15) → delete the second
agent → confirm it disappears from the list and (spot-check via the DB) its `membership` row
is gone too, not orphaned.

### Phase D — Import UI

| Order | File | Responsibility |
|---|---|---|
| D.1 | *(setup)* | `npx shadcn add dialog` — generates `app/components/ui/dialog.tsx`, adds `@radix-ui/react-dialog`. One-time. |
| D.2 | `app/components/Library/ImportButton.tsx` | New. The "⇪ Import .md" row from C.3 opens the `ImportDialog` (D.3), holding its open/closed state. |
| D.3 | `app/components/Library/ImportDialog.tsx` | New. Built on the shadcn `Dialog` from D.1. Contains: a `<textarea>` for pasted `.md`, a file `<input type="file" accept=".md">` that reads the file via `FileReader` and fills the same textarea, a mode radio (`Structural` default / `Strict`), and a submit button that `POST`s `{ md, mode }` to `/api/agents/import`. |
| D.4 | `app/components/Library/ImportDialog.tsx` (same file) | Handle the response: success → close the dialog, navigate to `/agents/{dto.id}`, and if `warnings` is present (Structural mode, Rules Index #31) show them inline — the "import warnings surface" Plan 02's Phase D table flagged as still-needed. `{skipped: 'unchanged'}` (Rules Index #36) → a small "already up to date" notice instead of navigating away from nothing changed. Error responses (`400`/`422`/`502`) → inline message keyed off the `error` code, matching `lib/import`'s existing error-code vocabulary. Dialog stays open on error so the user's pasted text isn't lost. |

**Gate D (manual browser check only — do NOT submit the import form during this check,
per standing project rules):** click "⇪ Import .md", confirm the dialog opens and the
textarea/file-picker/mode-radio render and are wired to component state, confirm the submit
button is disabled on empty input, confirm the dialog closes on cancel/escape without side
effects. **Do not click submit** — that fires a real API call and needs the user's explicit
go-ahead first, same as the `dev.md` seed import did.

---

## 3. Schema

**No migration.** `group` and `membership` already exist exactly as needed (`lib/db/schema.ts`,
built Plan 01 Phase 2):

```ts
export const group = sqliteTable('group', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  parentId: text('parent_id'),        // stays null this plan (R1)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const membership = sqliteTable('membership', {
  agentId: text('agent_id').notNull(),
  groupId: text('group_id').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.groupId] }),
}));
```

No Drizzle `references()` FK cascade on either soft-reference column, consistent with the rest
of the schema — cascades are handled explicitly in the repository (R3, R4).

---

## 4. API route contracts

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| `GET` | `/api/groups` | – | `{ id, name, memberAgentIds: string[] }[]` | – |
| `POST` | `/api/groups` | `{ name: string }` | `201` same shape, `memberAgentIds: []` | `400` invalid body; `409 { error: 'name_exists' }` |
| `DELETE` | `/api/groups/[id]` | – | `204` | `404` |
| `POST` | `/api/agents/[id]/groups` | `{ groupId: string }` | `201 { ok: true }` (or `200` if already a member) | `400` invalid body; `404` agent or group not found |
| `DELETE` | `/api/agents/[id]/groups/[groupId]` | – | `204` | `404` |
| `GET` | `/api/agents/[id]/export` | – | `200 text/plain` — the agent's current exported `.md` | `404` |

`GET /api/agents`'s existing lite DTO gains one field: `groupIds: string[]`. No other existing
route contract changes.

---

## 5. Business rules

1. A group's `name` is unique (schema-enforced, same `UNIQUE constraint failed` → `409`
   detection pattern `app/api/agents/route.ts` already uses for agent names).
2. An agent may belong to zero, one, or many groups (R2).
3. Deleting a group deletes only its `membership` rows — member agents are untouched (R4).
4. Deleting an agent deletes its `membership` rows along with its config/sections, in the same
   transaction (R3 — this closes a real gap in the already-shipped `deleteAgent`).
5. `parentId` is always `null` in every group this plan creates (R1).
6. The import UI never changes what `POST /api/agents/import` does — it is a thin client over
   the existing, already-hardened (Plan 02) contract.
7. The chat UI never implies config-editing capability that doesn't exist — target chips only
   ever name a `sectionKey` (R13).
8. `GET /api/agents/[id]/export` is read-only and writes nothing — no `AgentSnapshot` row, no
   side effect of any kind (R11).

---

## 6. Testing approach

- **Unit/integration (Vitest, mocked DB — same pattern as every existing suite):**
  `lib/db/repository/__tests__/groups.test.ts` (A.11, includes the `exportAgentMarkdown`
  round-trip assertion) and the new route test files (A.12). The `deleteAgent`-orphans-
  `membership` regression test is the one non-negotiable new assertion — it's a real bug
  being fixed, not just new-feature coverage.
- **Manual browser check (no test-runner support exists for React components in this
  project — Phase 4 didn't add one, and this plan doesn't either):** Gates B, C, and D above.
  Gate D explicitly stops short of submitting the import form (no real API call without ask).
  Gate B is explicitly a side-by-side visual comparison against the actual mockup file, not a
  written checklist of colors — open both and look.

---

## 7. Decisions — resolved with the user (2026-07-28)

Genuine product/UX calls, not implementation gaps — surfaced before build, not invented by
`@dev`.

1. **D1 — Add-to-group interaction. RESOLVED: drag-and-drop**, not click/checkbox. New
   dependency `@dnd-kit/core` (R8); add-not-move semantics resolved as R9.
2. **D2 — Import UI placement. RESOLVED: modal/dialog**, not an inline collapsible panel.
   Built on shadcn's `Dialog` primitive (D.1) — the first shadcn component this codebase
   actually pulls in.
3. **D3 — Which mockup layout ships. RESOLVED: Example A only** (R10) — chat under the
   visualization, raw agent on the right, no A/B switcher.

---

## 8. Risks & mitigation

| Risk | Mitigation |
|---|---|
| Orphaned `membership` rows if R3's `deleteAgent` fix is skipped or done outside the transaction | A.11's regression test is a hard gate — Phase A does not pass without it. |
| Import UI accidentally becomes a second implementation of validation/error-handling that drifts from the route's actual error codes | D.4 explicitly reuses the route's existing `error` code vocabulary rather than inventing new client-side copy. |
| Visual-alignment work becomes an open-ended pixel-chase against the mockup | Gate B is scoped as one side-by-side comparison pass, not an exhaustive diff — close-enough on chrome/tokens/layout structure, not literal CSS-value matching. |
| Chat target chips (R13) get built to match the mockup's demo dialogue (config edits) instead of what the mediator actually does | R13/rule 7 are explicit: chips only ever name a changed `sectionKey`. If this reads as a downgrade from the mockup's demo, that's correct — the demo showed aspirational capability, not the Phase-4-built contract. |
| `@dnd-kit/core` or the shadcn `Dialog` pull in more than expected (transitive deps, React 19 compat issues) | Both are mainstream, actively maintained libraries; if either has a real React 19 incompatibility at build time, stop and flag it rather than downgrading React or reaching for a different library mid-implementation. |

## Acceptance checklist (whole plan)

- [ ] `deleteAgent` no longer orphans `membership` rows (regression test green).
- [ ] Groups: create, list (with correct `memberAgentIds`), delete (agents survive, membership
      rows don't) all round-trip through both the repository and the route layer.
- [ ] `GET /api/agents/[id]/export` returns text that round-trips through `parse()`.
- [ ] The app's shell (panel chrome, tokens, fold/resize, the Viz-over-Chat / Raw-on-the-right
      Example-A split) visually matches `design/layout/Layout-Workbench.html` side by side.
- [ ] Config renders as pills (including group-membership pills and warn-styled validation
      flags); sections are collapsible; the Raw pane shows real live export output.
- [ ] Chat message bubbles carry `◆ section · <sectionKey>` target chips for sections the
      mediator actually changed — never a config-edit chip.
- [ ] Library panel renders the real agent list grouped correctly, including "All agents" and
      "Ungrouped", against the live `dev` agent already seeded in `myagent.db`.
- [ ] Switching agents via the Library list navigates to `/agents/[id]`, and all of
      `WorkbenchShell`'s local state (chat history, interaction lock, fold/resize) resets.
- [ ] Import UI (modal) renders and is wired to component state, but no real import was
      submitted during `@dev`'s build/verification pass — that's explicitly the user's call.
- [ ] All existing tests still green, plus the new Phase A suites; `npx tsc --noEmit` clean;
      `next build` succeeds.
