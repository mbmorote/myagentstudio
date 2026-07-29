# MyAgent — Roadmap

Staged next-work plan, consolidated from `CLAUDE.md`'s running session narrative,
`design/TechDesign.md`'s Deferred Decisions table, `design/Concept.md`'s Build order, and
`plans/layout-prototype-todo.md`. Unnumbered like `layout-prototype-todo.md` (not an
`@architect`-written execution spec) — a living index of what's open and roughly how urgent
it is, not a locked sequence. Update this file (not the scattered pointers above) as items
move; the detailed *why* for each item still lives at its original source, linked below.

**Last reviewed:** 2026-07-29, after the frictionless-export download action and the
catalog-seed-drift fix both landed in the same follow-up session (uncommitted as of this
edit — see the "What's built" pointers below for exact files touched).

## Stability snapshot (as of last review)

Confirmed clean before this doc was written:
- `npx tsc --noEmit` — clean
- `npm test` — 132/132 passing
- `npm run build` — succeeds, no unexpected diffs from generated files
- No `TODO`/`FIXME`/`XXX` markers left in `app/`, `lib/`, or `scripts/`
- `myagent.db*` correctly gitignored, never touched by git

Known gaps in the stability net itself (not app bugs — gaps in how we'd *catch* one):
- **No ESLint config exists.** `npm run lint` (`next lint`) has never been configured —
  running it drops into an interactive "how would you like to configure ESLint?" prompt.
  The script is wired in `package.json` but is currently dead. Low urgency (typecheck +
  tests are the real gate today) but worth fixing before the codebase gets much bigger.
- **No component/UI tests.** All 132 tests are `lib/`/`app/api/` — real business logic
  (import, serialize, blueprint rules, chat mediator) is well covered; the React component
  tree (`AgentView.tsx`, `LibraryPanel.tsx`, etc.) has zero automated coverage, only manual
  live-browser verification per session. Has held up fine so far given the size of the UI,
  but is worth naming honestly rather than assuming "132 passing" means full coverage.

## What's built

Condensed — full detail lives at each pointer, not repeated here.
- **Core loop** (structured view + agent-aware AI chat) — Concept build-order #1. `plans/01-*`.
- **Library + groups** (left panel, drag-and-drop, real `Group`/`Membership`) — build-order
  #2. `plans/03-*`, extended this session with the Agents/Grouped toggle.
- **Import**, both modes (Strict verbatim, Structural — default) — `plans/01-*` + `plans/02-*`.
- **Export, incl. the user-facing download** — `GET /api/agents/[id]/export` backs both the
  Raw pane's read-only preview and a new "⇩ Download" button (`RawAgentView.tsx`, client-side
  Blob + `<a download>`, no new route). Download-only was the explicit choice over
  copy-to-clipboard or direct write-to-disk. Build-order #3 done.
- **Catalog seed drift, fixed at the root** — `AgentView.tsx` no longer statically imports
  `CONFIG_DEFS`; it reads the full catalog from a `configCatalog` prop
  (`getConfigCatalog()`, `lib/db/repository/catalog.ts`) fetched fresh from the DB on every
  page request (`app/agents/[id]/page.tsx` → `WorkbenchShell` → `AgentView`). `configDef`
  gained a `hint` column (migration `0001_curved_sandman.sql`) so nothing was lost in the
  move. `npm run db:seed` is now also wired into `predev`/`prebuild`. Net effect: edit
  `catalog.ts`, run `npm run db:seed`, reload the page — no rebuild/redeploy needed.
  Verified live by patching a `config_def.hint` row directly in the DB and confirming a
  plain page reload picked it up with the dev server never restarted.
- **Blueprint catalog** refreshed against real Claude Code docs — see the CLAUDE.md pointer,
  2026-07-28.
- **UI punch-list** (6/7), **Tier 1 Config zone redesign** (16/17), and **this session's 5
  items** (Library toggle, pill cap, red/invalid tier, panel gap, MCP pill compaction) — all
  in `CLAUDE.md`; the last batch is also in `plans/layout-prototype-todo.md`.
- **Docs**: `README.md`, `docs/user-guide.md`, per-flow `lib/*/CLAUDE.md` files.

## Open items, by tier

### Tier 1 — real papercuts, hit by actual data today

1. **`__raw` frontmatter escape hatch.** A real `mcpServers` file with an inline nested
   server-config object still hits a hard `unsupported_frontmatter` 400 on import — confirmed
   real (not hypothetical) via the Blueprint catalog refresh session. `TechDesign.md`
   Deferred Decisions #40.

### Tier 2 — product decisions needed before building

2. **"+ custom key…" arbitrary config-key creation.** Blocked on a real UX contradiction:
   a user-created key with no matching `ConfigDef` immediately gets flagged as
   `unknownConfigKeys` (a warn pill right next to the field they just intentionally made).
   Needs a "user-acknowledged custom key" concept (new DB column, or a separate key-status
   mechanism) before it can be built without undermining itself. `CLAUDE.md`'s Tier 1
   redesign pointer has the full detail.

### Tier 3 — build-order gaps (things the product needs to feel finished)

3. **Dedicated group-management view** — punch-list item 7. Not started, not researched.
   Genuinely new scope (today groups are only managed inline via drag-and-drop + the
   Library panel's inline New-group form).
4. **Strict-mode merged-heading instability / adversarial-file re-audit** — flagged during
   Plan 02 as "not re-verified this pass," never actually re-checked since. Presume open.

### Tier 4 — new scope (post-MVP features from Concept.md's build order)

5. **Export translation to other platforms** (Copilot, etc.) — build-order #4. Real format
   translation, not a file copy. Not started.
6. **Sharing / forking** — build-order #5. Not started.
7. **Skill module** — build-order #6. A sibling entity to `Agent` for `SKILL.md` files,
   genuinely different shape (no Role/Behavior/Guardrails/Output sections, sometimes a whole
   supporting-file directory). `TechDesign.md` Deferred Decisions table has the full field
   list already researched. Not started.

### Tier 5 — infra/tooling polish

8. **ESLint config** — see Stability snapshot above.
9. **`scripts/build-prompts.ts` readable output** — `TechDesign.md` Deferred Decisions #26,
   marked **[HIGH PRIORITY]** there: currently emits an escaped single-line string, hard to
   debug. Still not done.
10. **Component/UI test coverage** — see Stability snapshot above. Not urgent, but the gap
    is real.

### Tier 6 — deliberately deferred (not MVP-blocking, explicit triggers)

The **learning-goals roadmap** (`TechDesign.md` §"Learning-goals roadmap") — JWT auth,
Docker, CI/CD, Azure — is explicitly staged for *after* the core product works and *when*
going online. Also still open, each with its own trigger in `TechDesign.md`'s Deferred
Decisions table: storage dialect (#8b), catalog versioning (#13), manual-edit save
frequency (#14), export-kind `AgentSnapshot` + diff view (#16), per-platform `ConfigDef`
scoping (#18), `model` display-label lookup (#20), propose-preview before mediator
rewrites (#24), AI-assisted config-key mapping (#30).

## Recommended next stage

With export and catalog seed drift both closed, **Tier 1 item 1 (`__raw` frontmatter escape
hatch)** is the strongest remaining candidate: it's the last real import papercut hit by
actual files (not hypothetical), already diagnosed (`unsupported_frontmatter` in
`lib/blueprint/catalog.ts`), and doesn't require a product decision to unblock, unlike
Tier 2. Tier 3 item 4 (a quick strict-mode adversarial-file re-audit) is a cheap parallel
check worth doing alongside it.

Not recommended yet: Tier 4's new-scope items — each is a real second effort (translation
logic, a sharing model, a whole second entity type) better sequenced after the MVP's own
loop (import → edit → export) is fully airtight, which is now much closer — export and the
DB catalog architecture were the two largest remaining gaps in that loop.
