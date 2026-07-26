# Agent Workbench — Pre-Build Design Review

> Adversarial design review of `Concept.md` + `TechDesign.md`, run 2026-07-24, before any
> code exists. Goal: find structural decisions that would be expensive to reverse once
> code is written on top of them.

**Verdict up front:** the core architecture is sound — EAV-with-no-FK, the grouping model,
and the stack are the right calls at this scale; leave them alone. The real risk is
concentrated in two places: **the round-trip invariant has several concrete, silent
failure modes as currently specified**, and **the Drizzle "driver swap" migration story is
factually wrong.**

---

## Findings — ranked most-severe first

### 1. The round-trip invariant fails silently — and the app itself can generate the violating content

**Claim:** `parse(export(parse(md))) === parse(md)` does not hold as specified, and the
worst violations come from *inside* the app, not messy imports.

**Failure scenarios (four distinct ones):**

- **a) Split-level headings inside section content.** Stage 1 splits on the shallowest
  heading level, but nothing stops a section's `content` from *containing* a heading at
  that level — and the chat mediator is the most likely author: ask it to "add an example"
  and it happily writes `# Example` inside `content`. Export emits it inline → re-import
  splits it into two sections → structural parse differs → invariant broken, silently.
  The verbatim safety net doesn't help because the failure is structural, not textual.
- **b) The headingless preamble contradicts the schema.** Stage 1 stores pre-heading prose
  "at order 0" — a block with **no heading**. But `AgentSection.heading` is `not null`,
  and export renders every row as `# {heading}`. Either import can't store the preamble,
  or export invents a heading — and an invented heading re-parses as a normal section,
  breaking the invariant.
- **c) `name` normalization vs. losslessness.** `Agent.name` is "validated lowercase-hyphen
  on save," and the real library contains `Zara`, `Ada`, `Aria`. Importing `Zara.md`
  either fails validation (blocks — violates "never block me") or normalizes to `zara`
  (changes content — violates Principle #10 and the round-trip). The design says both
  things and they can't both be true. This hits within the first fifteen imports.
- **d) YAML scalar coercion + comments.** A generic YAML parse turns `model: 4.6` into a
  float, `background: no` into `false`, and drops comments entirely. Re-export emits
  `4.6` / `false` — parse-equality technically holds for coercions but the *file
  semantics* changed; comments are simply lost with no `custom` fallback, because comments
  aren't keys.

**Fix, cheap now:**
- Make `heading` nullable (or empty-string allowed) and export headingless blocks verbatim (b).
- Decide the split-level policy: on save, either demote in-content headings, require them
  fenced, or store a per-agent `splitLevel` and validate content against it (a).
- For `name`: flag-don't-block — store `Zara` verbatim, surface the spec violation as a
  validation flag, normalize only when the user clicks fix (c). This matches the
  "reviewing is the feature" thesis.
- Parse frontmatter with a string-preserving YAML mode (e.g. `yaml` failsafe schema for
  scalars), and accept comment loss explicitly in Draft B rather than discovering it later (d).

**Cost:** a day of spec text plus golden-file tests now; after building, every stored agent
has ambiguous heading/preamble data and you migrate *content*, not just schema.

### 2. Stage 2 says "verbatim" but the mechanism allows the AI to touch bytes

**Claim:** "Content is copied verbatim" is a prompt-level promise, not a construction-level
guarantee — and Draft A contradicts itself: Stage 1 "splits deterministically," yet
Stage 2's AI "decides *boundaries* and types."

**Failure scenario:** if the AI's output includes content (even to "merge two blocks"),
verbatim-ness depends on model compliance. Models normalize whitespace, fix typos, and
truncate long blocks routinely. One 557-line Aria import with a silently dropped paragraph
and the importer is never trusted again — and it goes unnoticed, because the export looks
plausible.

**Fix, cheap now:** make Stage 2's output **only** `{ blockId → sectionKey/propKey }`.
Content never enters the model's *output* path; the server re-assembles from Stage-1 blocks
by id. If merge/split is wanted, express it as `{ blockIds: [1,2] → sectionKey }` over
Stage-1 blocks — still ids, still zero bytes through the model. Delete the word
"boundaries" from Stage 2.

**Cost:** one sentence in the design and a stricter response schema now; re-auditing every
past import for undetectable corruption later.

### 3. The Drizzle "driver swap" migration story is wrong

**Claim:** TechDesign says SQLite → Postgres/Azure SQL is "changing the driver." In Drizzle
it is not — schemas are dialect-specific (`sqliteTable` vs `pgTable` vs mssql), and the
column type systems differ (SQLite has no native boolean, timestamps are integers/text,
JSON is text; Azure SQL support in Drizzle is far less mature than Postgres).

**Failure scenario:** at roadmap step 5 (Azure), expecting a config change, you instead
face rewriting every schema file, regenerating all migrations from scratch, and porting
seed data — with live data to carry over.

**Fix, cheap now:**
1. Pick **Postgres, not Azure SQL**, as the stated future target (first-class Drizzle
   support; Azure has managed Postgres, so the Azure goal survives).
2. Keep all DB access behind a small repository layer with conservative column types
   (text/integer/JSON-as-text), so the eventual port is a mechanical schema rewrite, not
   an application rewrite.

**Cost:** a paragraph and a folder convention now; a genuinely painful week at the worst
time (the go-online push) later.

### 4. The Blueprint's "no drift" claim only covers the enumerable half

**Claim:** the catalogs give the *enumerations* (keys, allowed values, templates), but the
Blueprint also includes "the design rules" — lowercase-hyphen names, heading rendering,
split rules, required-field handling. Those live in code, and each of the three consumers
(UI validation, the import prompt, the validator) can implement them independently.

**Failure scenario:** the import prompt says names are lowercase-hyphen, the UI validator
uses a slightly different regex, and the export serializer has a third opinion. Six months
in, an agent passes import, fails the UI flag, and exports something the importer rejects —
classic three-implementation drift, exactly what the Blueprint was supposed to prevent.

**Fix, cheap now:** make `lib/blueprint` export one typed object **plus the rule functions**
(`validateName()`, `renderHeading()`, …) and a single `renderBlueprintForPrompt()` used by
both system agents. Add one test: the prompt text is generated from the same object the
validator imports.

**Cost:** trivial now (a module boundary decision); whack-a-mole inconsistency bugs forever
after.

### 5. AI edits are destructive with no history

**Claim:** the mediator "rewrites `content`" in place; there's no revision concept anywhere
in the data model, and chat is ephemeral in the MVP.

**Failure scenario:** the mediator is asked to "tighten the guardrails" on Aria, replaces
80 good lines with 12 mediocre ones, the chat session ends — the original prose is gone.
For a tool whose pitch is *trustworthy* AI editing, one such loss kills dogfooding.

**Fix, cheap now:** a `SectionRevision` table (`sectionId`, `content`, `timestamp`,
`author: user | ai`) written on every AI edit — append-only, no UI needed beyond "revert."

**Cost:** one table now; unrecoverable data loss plus retrofitting history into an editing
flow already built around in-place mutation later.

### 6. "Platform is master" collides with how the agents are actually used (product-level)

**Claim:** the agents *run* from `~/.claude/agents/` — Claude Code reads those files daily,
and one will inevitably get edited there (or via `/agents`). The design has import and
export but no story for **re-import of a file that diverged after export**.

**Failure scenario:** week 2 of dogfooding — `dev.md` is exported, then tweaked directly in
a Claude Code session. Platform and file now disagree. Re-importing creates a duplicate
(or hits the `name` unique constraint — behavior unspecified) and blows away platform-side
history. The quiet outcome: imports stop, then the app stops being opened — the exact
failure mode `Concept.md` defines for the project.

**Fix, cheap now:** don't build sync — just *decide* the collision behavior: re-import of
an existing `name` = update-in-place with a diff preview, and store a content hash at
export time so the app can flag "file changed outside the platform."

**Cost:** a design paragraph and one column now; a duplicate-riddled library and a trust
problem later.

### 7. Smaller, fix-in-passing

- **Import of a file missing `description`** violates the `not null` column. Decide:
  placeholder + validation flag (consistent with finding 1c's flag-don't-block philosophy).
- **Catalog evolution orphans values silently:** no FK means a renamed/removed `ConfigDef`
  key degrades existing `AgentConfig` rows to "unknown" with no signal. Distinguish
  "never known" from "was known, catalog changed" in the validation layer.
- **Stage 1 fence handling:** also treat `~~~` fences and unclosed fences deliberately
  (unclosed fence = rest-of-file is one block; acceptable, just make it a stated rule
  with a test).
- **Injection surface:** fine for local single-user — worst case, the model corrupts the
  user's own agent (which finding 5's revisions makes recoverable). Two rules must hold
  from day one: the mediator returns structured output scoped to the one `sectionId` the
  *server* chose (never "edit whatever section you think"), and it has **no tools**.
  Re-audit seriously when sharing/forking (build-order #5) arrives — imported foreign
  agents are then untrusted input to system prompts.

---

## Solid — leave alone

- **EAV + no-FK at this scale.** ~15 config keys × even 500 agents is thousands of rows;
  every hot query is "load one agent." The classic EAV pathologies (cross-attribute
  reporting, typed-column performance) don't apply. The `name`/`description`-as-columns
  line is drawn correctly — they're the only fields with constraints worth enforcing
  relationally.
- **Grouping.** Many-to-many labels with nullable `parentId` is textbook and genuinely
  additive; no migration trap. (Note: a globally unique `Group.name` now relaxes to
  unique-per-parent later additively too.)
- **Single Next.js + server-side key.** Correct reasoning, correctly derived from the
  actual constraint (the secret needs a server). The Vite analysis is right.
- **System/user agent split and the bootstrap call** (code-owned prompt templates first,
  formal system agents later) — right, and it correctly sidesteps the
  import-depends-on-import problem.
- **Export determinism + semantic-not-byte fidelity (Draft B's philosophy).** Normalizing
  drift *is* the feature; the philosophy is right — finding 1 is about the invariant's
  edge cases, not its premise.

## Blind spots

1. **Concurrent edits of one section.** The user can be typing in the structured view
   while the mediator streams a rewrite of the same `AgentSection`. Last-write-wins
   silently eats one of them. A `version` integer + optimistic check on write is ten
   lines now.
2. **The mediator's contract with the UI** is the hardest engineering in the project and
   has no draft: does it stream? propose-then-apply or apply-then-undo? multi-section
   edits in one turn? This deserves a **Draft D** before the chat route is built.
3. **What to prototype first to de-risk the riskiest finding:** before any UI, write
   `lib/serialize` and run a golden-file harness — **import → export → re-import all 15
   real agents from `~/.claude/agents/` and assert structural equality**. That single test
   suite operationalizes findings 1a–1d, exercises orchestrator's `##` case, Aria's 557
   lines, and the `Zara` naming collision on real data — and it's exactly the code the
   first slice needs anyway. If the invariant survives the real library, the design is
   proven where it matters.

---

## Bottom line

Nothing here forces a redesign — the two-zone EAV model and the stack hold up under
pressure. But before writing `lib/serialize`: tighten the round-trip spec (finding 1) and
the Stage-2 labels-only mechanism (finding 2) *on paper*, correct the Drizzle migration
assumption (finding 3), and add the revision table (finding 5). All four are hours now and
weeks later.
