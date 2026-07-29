# MyAgent — Roadmap

Staged next-work plan, consolidated from `CLAUDE.md`'s running session narrative,
`design/TechDesign.md`'s Deferred Decisions table, `design/Concept.md`'s Build order, and
`plans/layout-prototype-todo.md`. Unnumbered like `layout-prototype-todo.md` (not an
`@architect`-written execution spec) — a living index of what's open and roughly how urgent
it is, not a locked sequence. Update this file (not the scattered pointers above) as items
move; the detailed *why* for each item still lives at its original source, linked below.

**Last reviewed:** 2026-07-29, right after this session's Library toggle / pill-cap /
red-tier / panel-gap / MCP-pill migration landed (commit `74f8c86`).

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
- **Export (route only)** — `GET /api/agents/[id]/export` exists and backs the Raw pane's
  read-only preview. See Tier 2 below — the actual *user-facing* "get this out of the app"
  action doesn't exist yet, so build-order #3 is only half-done.
- **Blueprint catalog** refreshed against real Claude Code docs — see the CLAUDE.md pointer,
  2026-07-28.
- **UI punch-list** (6/7), **Tier 1 Config zone redesign** (16/17), and **this session's 5
  items** (Library toggle, pill cap, red/invalid tier, panel gap, MCP pill compaction) — all
  in `CLAUDE.md`; the last batch is also in `plans/layout-prototype-todo.md`.
- **Docs**: `README.md`, `docs/user-guide.md`, per-flow `lib/*/CLAUDE.md` files.

## Open items, by tier

### Tier 1 — real papercuts, hit by actual data today

1. **Catalog seed drift.** `lib/db/seed.ts` has upsert logic that would heal the DB's
   `configDef`/`sectionDef` rows, but `npm run db:seed` isn't wired into `predev`/`prebuild`
   — editing `catalog.ts` doesn't propagate. Current mitigation (`AgentView.tsx` reads
   live in-code `CONFIG_DEFS` instead of the DB-embedded copy) works but is a workaround,
   not a fix. *Real fix:* wire `db:seed` into the build/dev pipeline, or stop persisting a
   DB-embedded catalog copy at all if nothing actually reads it anymore. Confirm which
   before touching — worth checking whether anything still depends on the DB copy first.
2. **`__raw` frontmatter escape hatch.** A real `mcpServers` file with an inline nested
   server-config object still hits a hard `unsupported_frontmatter` 400 on import — confirmed
   real (not hypothetical) via the Blueprint catalog refresh session. `TechDesign.md`
   Deferred Decisions #40.

### Tier 2 — product decisions needed before building

3. **"+ custom key…" arbitrary config-key creation.** Blocked on a real UX contradiction:
   a user-created key with no matching `ConfigDef` immediately gets flagged as
   `unknownConfigKeys` (a warn pill right next to the field they just intentionally made).
   Needs a "user-acknowledged custom key" concept (new DB column, or a separate key-status
   mechanism) before it can be built without undermining itself. `CLAUDE.md`'s Tier 1
   redesign pointer has the full detail.

### Tier 3 — build-order gaps (things the product needs to feel finished)

4. **Frictionless export back to Claude** (build-order #3, the *point* of "platform-is-
   master"). The Raw pane is explicitly labeled "read reference" — there's no download,
   copy-to-clipboard, or write-to-`.claude/agents/` action anywhere. This is arguably the
   single most-missing piece of the MVP's own stated value prop.
5. **Dedicated group-management view** — punch-list item 7. Not started, not researched.
   Genuinely new scope (today groups are only managed inline via drag-and-drop + the
   Library panel's inline New-group form).
6. **Strict-mode merged-heading instability / adversarial-file re-audit** — flagged during
   Plan 02 as "not re-verified this pass," never actually re-checked since. Presume open.

### Tier 4 — new scope (post-MVP features from Concept.md's build order)

7. **Export translation to other platforms** (Copilot, etc.) — build-order #4. Real format
   translation, not a file copy. Not started.
8. **Sharing / forking** — build-order #5. Not started.
9. **Skill module** — build-order #6. A sibling entity to `Agent` for `SKILL.md` files,
   genuinely different shape (no Role/Behavior/Guardrails/Output sections, sometimes a whole
   supporting-file directory). `TechDesign.md` Deferred Decisions table has the full field
   list already researched. Not started.

### Tier 5 — infra/tooling polish

10. **ESLint config** — see Stability snapshot above.
11. **`scripts/build-prompts.ts` readable output** — `TechDesign.md` Deferred Decisions #26,
    marked **[HIGH PRIORITY]** there: currently emits an escaped single-line string, hard to
    debug. Still not done.
12. **Component/UI test coverage** — see Stability snapshot above. Not urgent, but the gap
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

**Tier 3 item 4 (frictionless export)** is the strongest candidate to pick up next: it's
the smallest gap between "what's built" and "what the product promises" (platform-is-
master only means something if getting an agent *out* is actually easy), it's well-scoped
(the export route already exists — this is a UI action, not new backend design), and it
doesn't require a product decision to unblock like Tier 2 does. Tier 1's two papercuts are
worth a cheap parallel pass (both are small, already-diagnosed fixes) before or alongside it.

Not recommended yet: Tier 4's new-scope items — each is a real second effort (translation
logic, a sharing model, a whole second entity type) better sequenced after the MVP's own
loop (import → edit → **export**) is airtight, which Tier 3 item 4 is what closes.
