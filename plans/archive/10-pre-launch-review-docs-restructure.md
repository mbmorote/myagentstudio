# Plan 10 — Pre-Launch Review & Docs Restructure

> **Status: 🟢 Drafted and reviewed with the user 2026-08-12 — all §8 decision points
> resolved; ready to execute on the user's go.** Absorbs **Plan 09** (its three review
> tracks become Phase 1 here) — Plan 09 does not run separately. This plan is **next in
> the TODO order** (ahead of Second LLM provider — §8.8). Execution pauses at three user
> gates: after triage (Gate 1, end of §3), after the new docs are written (Gate 2, end of
> §5), and at the end (Gate 3, §7).
>
> **What this is:** one big plan covering (a) the full pre-launch review of docs, code
> organization, and test structure (Plan 09's charter), (b) a code & test improvement
> pass applying what the review finds, and (c) a restructuring of the project's
> documentation into a new, deliberate `docs/` set — replacing `architecture/`'s
> Concept/TechDesign split with audience-oriented documents modeled on the user's PMFlow
> docs (`PMFlow - System About.md`, `PMFlow - Project Explanation.md`) and a
> platform-presentable roadmap.
>
> **Standing rules apply throughout:** no commits without explicit ask (rule 1), no real
> Anthropic API calls (rule 2 — nothing here needs one), no test/build/tsc runs without
> asking first (rule 5 — the review reads files, it doesn't execute them).

---

## 0. Decisions already settled (discussion session, 2026-08-12)

These were agreed with the user before this plan was drafted; they are constraints, not
open questions:

1. **The `CLAUDE.md` layer stays internal** (root + `lib/*/CLAUDE.md`) — folder maps
   auto-loaded into agent context, not audience documentation. They get corrected, not
   replaced.
2. **Root `CLAUDE.md` becomes a pure map.** No status, no phase narrative, no dated
   history. One line per file/folder saying what it *is*. Status lives only in
   `plans/roadmap.md`; history lives only in `CHANGELOG.md`. Guiding principle for the
   whole doc set: **every fact lives in exactly one document; everything else points to
   it.** (Motivation: finishing one task currently means updating the plan file, the
   roadmap, the changelog, *and* `CLAUDE.md` — that duplication ends here.)
3. **`architecture/Concept.md` and `architecture/TechDesign.md` are absorbed and
   retired.** Every section gets an explicit destination in the new `docs/` set (see §5
   mapping); the original files then move to `architecture/audits/` as historical record.
   Nothing is deleted outright.
4. **The Rules Index goes through a three-exit triage** — the direction of authority has
   flipped: the rules were written to constrain code that didn't exist yet; now the code
   exists and is the source of truth. Each Rules Index row and each Deferred Decisions
   entry lands in exactly one of:
   - **Exit 1 — still true and still wanted:** restated in the new technical doc as a
     *description of current system behavior* (prose, not a numbered ledger).
   - **Exit 2 — still wanted but not built (or built differently):** becomes a roadmap
     item, not a rule.
   - **Exit 3 — no longer wanted / superseded:** dropped from living docs; survives only
     in the retired file in `audits/` and in git history.
   No standalone rules document — a new rules ledger would just drift again.
5. **Standing process rules stay in root `CLAUDE.md` untouched** (no-commit, no-API-call,
   dev-server-off, mockup-first, provisional ask-before-checks). They are how-we-work
   rules, not system-design rules.
6. **`plans/roadmap.md` stays the single source of truth for status** — it *is* the
   technical roadmap. The new friendly roadmap in `docs/` is a **curated projection** of
   it: capability-matrix shape (rows = capabilities, status = available / next / planned,
   one plain-language line each), refreshed as a deliberate editorial step when a
   user-visible capability changes — no automatic sync, no task-level granularity.
7. **Numbered plans are archived.** Plans 01–09 move to `plans/archive/` once this plan
   executes; their status headers are never maintained again (the roadmap owns status).
   The three review/opinion files in `plans/` (`Evaluation-260730.md`,
   `Design-Review-260806.md`, `Branding-Design-Review-260806.md`) move to
   `architecture/audits/` — they are audit-type records and fit that folder's defined
   purpose.
8. **Sequencing: review first, then fix the code and tests, then write the docs**
   *(second step added at review, 2026-08-12)*. The new docs must be written from
   *verified* claims about a system that isn't about to change — otherwise staleness is
   laundered into prettier files, or accurate docs go stale a phase later. So: Phase 1
   review → Phase 3 code/test improvement pass → Phase 4 doc rewrite describes the
   improved system.

## 1. Target documentation set

All audience docs live in `docs/`, with README as the one allowed exception (stays at
root). File names resolved at review (§8.1):

| Working name | Modeled on | Audience & content |
|---|---|---|
| `README.md` (root) | current | Entry point: what it is, quick-start, env vars, pointer to `docs/` |
| `docs/user-guide.md` | current | End users: task-oriented walkthroughs (already exists; revised for accuracy in Phase 3) |
| `docs/system-about.md` | `PMFlow - System About.md` | Devs / tech leads / engineers: stack, architecture, repository structure, design patterns and principles (absorbing the surviving Rules Index exits), domain/data model, serialization contract, technical strengths, known gaps |
| `docs/project-explanation.md` | `PMFlow - Project Explanation.md` | Narrative / portfolio: the problem, what the product is, who it's for, the killer feature, feature flows, how it was developed |
| `docs/roadmap.md` | matrix idea (user's PortFolioRoadmap concept, adapted) | Friendly, platform-presentable matrix of **big** items only (important to the user or technically) — features, resources, and fixes & changes — as Available today / Coming next / Planned, derived from `plans/roadmap.md` (see §8.7) |

Line drawn deliberately cleaner than PMFlow's own pair (which overlap): **Project
Explanation = product story and feature flows; System About = engineering internals.**
Shared facts live in System About; Explanation links rather than repeats — **with one
deliberate exception (user decision, 2026-08-12): Project Explanation carries its own
technologies/stack summary**, so it works self-contained as a portfolio piece (the stack
is stable, so the duplication cost is low). Everything else still follows
one-fact-one-home.

## 2. Phase 1 — Full review (Plan 09 absorbed)

Method and scope exactly as Plan 09 chartered; summarized here so this plan is
self-contained. Output: **one findings list per track** (file + line + claim/gap, same
citation discipline as `plans/Branding-Design-Review-260806.md`).

- **Track A — Docs accuracy:** every claim in root `CLAUDE.md`, `lib/*/CLAUDE.md`,
  `architecture/TechDesign.md` (every Rules Index row + Deferred Decisions entry — this
  doubles as the input inventory for the §0.4 triage), `architecture/Concept.md`,
  `README.md`, `docs/user-guide.md` — checked against current code, not memory. Includes
  Plan 09's known findings: **A1** (OAuth Phase 5/6 doc-sync gap + activity-log consent
  popup supersession) and **A2** (`AgentDTO.validation` server-computed field with zero UI
  readers — flag for a decision, don't silently pick one). Includes the "what's on the log
  is on the log" check: docs' Activity Log claims vs. `lib/db/repository/llmCallLog.ts`,
  the `llm_call_log` schema, and the Settings page rendering.
- **Track B — Code organization:** structural survey against the project's own stated
  conventions — folder contents vs. their `CLAUDE.md` descriptions, dead code / unused
  exports from superseded designs (A2 is a candidate), unconsolidated duplication, stale
  file-header docblocks. Not correctness, not performance, not re-litigating locked
  decisions.
- **Track C — Test structure:** shape of the test tree, read not run — coverage presence
  per `lib/`/`app/api/` module, name/location mirroring, stale tests for retired designs,
  compliance of newer test files with the mock-all-AI-calls rule.

## 3. Phase 2 — Triage

*(Contract updated at review, 2026-08-12: unlike Plan 09's findings-only mandate, code
and test findings **do get fixed inside this plan** — Phase 3 — so the docs are written
against the improved system, not a system about to change.)*

1. **Code/test findings (Tracks B, C):** each finding sorted into **fix-now** (goes to
   Phase 3: refactors, cleanup, dead-code removal, test reorganization/additions) or
   **defer** (genuinely its own project — e.g. full component-test coverage — becomes a
   TODO/FUTURE item with a pointer back here). Default leans fix-now; defer needs a
   reason.
2. **Docs findings (Track A):** these mostly do *not* get fixed in the old files — the old
   files are being retired. Track A's corrected-claims list feeds Phase 4 directly.
   Exception: claims in files that survive (`README.md`, `docs/user-guide.md`,
   `CLAUDE.md`s) get corrected in place during Phase 4/5.
3. **Rules triage:** every Rules Index row and Deferred Decisions entry assigned its exit
   (§0.4), recorded as a mapping table (rule → exit → destination) so the user can review
   the assignments before Phase 4 writes them in. **Exit assignments the user should
   confirm are flagged, not assumed** — especially any Exit 3 (drop).

> **🚪 GATE 1 (user):** review the three findings lists, the fix-now/defer split, and the
> rules mapping table. Nothing is fixed, written, or moved before this sign-off.

## 4. Phase 3 — Code & test improvement pass

Apply the Gate-1-approved fix-now list: refactors and reorganization from Track B
(dead code, duplication, stale docblocks, misplaced modules) and test-suite improvements
from Track C (reorganize, rename, fill agreed gaps, delete stale tests). Includes
resolving A2 (the `validation` field) whichever way the user decided at Gate 1.

Constraints:
- Behavior-preserving by intent — this is organization and quality, not features. Anything
  that turns out to need a design change goes back to the user, not silently decided.
- **Verification needs test/`tsc` runs — standing rule 5 applies: ask the user before
  running any check.** Expected shape: batch the fixes, then ask once for a verification
  run at the end of the phase rather than per-change.
- All AI-related tests stay mocked (rule 2); no real API calls.

## 4b. Phase 3.5 — General code-quality review (added 2026-08-12, user request)

Phase 1's Tracks A/B/C never included a general code-quality pass — Track B was scoped
to organization only (folder structure, dead code, duplication; explicitly excluded
correctness/performance/security), Track C to test structure, and the Phase 2 add-on
to whether *existing tests* are meaningful. None of them examined the application code
itself for correctness bugs, security issues, or simplification opportunities.

Inserted here, after Phase 3's fixes and before Phase 4 writes the new docs, so the
docs describe a codebase that's been checked for bugs — not just organized, tested, and
documented. Use the project's `/code-review` skill or `@codeauditor` agent. Findings
triaged the same way as Phase 2 (fix-now default, defer with a reason) before Phase 4
starts.

## 5. Phase 4 — Write the new docs

Written from Phase 1's verified claims + Phase 2's triage output, **describing the code as
it stands after Phase 3's improvements**. Section-by-section absorption map for the
retired files:

**`Concept.md` →**
- Problem / what it is / who it's for / killer feature / grouping model → Project
  Explanation.
- Layout (4 panes) → Project Explanation (feature-flow level) + System About (structure
  level).
- Canonical agent structure / body schema / real-library audit → System About (reference
  sections), coordinated with `Agent-Full-Reference.md` (§8.3).
- Decisions locked / build order / out-of-scope → dissolved: still-true decisions become
  System About prose; historical sequencing is already in CHANGELOG/plans; dropped items
  just retire with the file.

**`TechDesign.md` →**
- Design principles, data model, Zone 1/Zone 2, Agent Blueprint, system-vs-user agents,
  serialization contract → System About.
- Rules Index + Deferred Decisions → per-rule triage exits (§0.4).
- Decision drafts (A/B/C) → summarized as "how it was developed / key decisions" material
  (Project Explanation and/or System About); full detail retires with the file to
  `audits/`.

**New content:**
- `docs/roadmap.md` — the big-items matrix, derived from `plans/roadmap.md`.
- `README.md` and `docs/user-guide.md` — revised against Track A findings (including the
  A1 consent-popup supersession in the signup walkthrough).

> **🚪 GATE 2 (user):** review the new/revised docs. No file is moved, retired, or
> rewritten (`CLAUDE.md` included) before this sign-off.

## 6. Phase 5 — Restructure & retire

File moves and internal-layer cleanup, only after Gate 2:

1. Move `Concept.md`, `TechDesign.md` → `architecture/audits/` (historical record).
2. Move plans 01–09 → `plans/archive/`; move the three review/opinion files →
   `architecture/audits/`.
3. Rewrite root `CLAUDE.md` as a pure map (per §0.2): new folder layout, one line per
   item, standing rules kept, all status/narrative removed.
4. Correct `lib/*/CLAUDE.md` per Track A/B findings.
5. Update `plans/roadmap.md`: mark this plan's absorption of Plan 09, apply the §8.8
   reordering (this plan was item 1; Second LLM provider follows), add deferred items
   from Phase 2 triage, refresh "What's built."
6. `CHANGELOG.md` entry for the restructure (stays at root, unchanged in role — §8.6).

## 7. Phase 6 — Consistency pass

One read-through of the final state: no dangling cross-references to moved/retired files
(docs, code comments, and `architecture/layout/` included), every doc points to — not
repeats — facts homed elsewhere, `CLAUDE.md` map matches the actual tree. Done when the
tree, the map, and the docs agree.

> **🚪 GATE 3 (user):** final review of the whole result. Commit only on explicit ask
> (standing rule 1), as always.

## 8. Decision points (review session 2026-08-12)

1. **Doc file names — ✅ RESOLVED: lowercase-kebab.** `docs/system-about.md`,
   `docs/project-explanation.md`, `docs/roadmap.md`, matching `docs/user-guide.md`.
2. **Product name in titles — ✅ RESOLVED: optimize for easy renaming.** The product's
   final name is not decided yet (ties to roadmap TODO item 10, company signature /
   branding). So: use **"MyAgent"** as the working name, but only in title lines and
   first-sentence introductions — body prose says "the workbench" / "the platform," never
   the name. A future rename then touches a handful of title lines, not every paragraph.
3. **`architecture/Agent-Full-Reference.md` — ✅ RESOLVED: leave in `architecture/`.**
   It serves the code (Config-zone hint text source), not an external audience; one line
   in the `CLAUDE.md` map.
4. **Execution mode — ✅ RESOLVED: direct, in-session.** No subagent dispatch; one
   integrated head runs the tracks and phases.
5. **`architecture/` folder afterward — ✅ RESOLVED: keep as-is.** After the moves it
   holds `layout/`, `audits/`, and `Agent-Full-Reference.md` — internal working material
   only; name unchanged.
6. **`CHANGELOG.md` — ✅ RESOLVED: stays at root** in its current role.
7. **Friendly-roadmap scope — ✅ RESOLVED: big items only, three kinds, three statuses.**
   The matrix is not limited to features: entries are **features, resources, and fixes &
   changes**. Status names (confirmed): **Available today / Coming next / Planned**.
   Inclusion filter: **"big" = important to the user *or* technically important** — so a
   major internal item (e.g. second LLM provider) qualifies even if users don't see it
   directly — never task-level detail. Starting "Available today" rows (confirmed):
   Import (Strict / Structural), AI chat editing (propose/apply), Structured view & manual
   editing, Groups & Library, Export, Multi-user accounts & Google sign-in, Settings & cost
   controls (activity log, dry-run). Coming next / Planned rows are curated from
   `plans/roadmap.md` TODO/NEXT/FUTURE during Phase 3, same "big" filter.
8. **Roadmap slot — ✅ RESOLVED (updated 2026-08-12): this plan is next.** It replaces
   the Plan 09 entry and moves **ahead of Second LLM provider** — it becomes TODO item 1,
   the next thing executed; Second LLM provider follows it. Phase 4's roadmap update
   applies this reordering. (Note: Plan 09's charter said "item 6" — stale numbering from
   before the 2026-08-07 TODO rework; the roadmap's current numbering is authoritative,
   per the one-home-per-fact principle this plan installs.)
