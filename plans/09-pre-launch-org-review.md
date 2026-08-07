# Plan 09 — Pre-Launch Organization Review (Docs, Code, Tests)

> **Status: 🟡 Charter drafted 2026-08-06, at the user's request — not yet run.** Sits as
> `plans/roadmap.md` TODO item 6, sequenced right before item 7 (the big flow test) and after
> item 5 (second LLM provider) — the last thing that happens before final functional
> validation and deploy. **Absorbs** the narrower doc-sync task that previously held this slot
> (Plan 06 Phase 6 remainder + the consent-popup supersession — see Track A, Known Finding A1)
> rather than existing alongside it.
>
> **What this is not:** a bug hunt, a `tsc`/test-suite pass-fail check, or a correctness
> review. Those are covered elsewhere (the big flow test, `npm test`/`tsc` gates run per
> standing rule 5). This plan asks a different question of each of three areas — **does it
> reflect what we actually built, and is it organized the way it should be** — not "does it
> run."
>
> **Output is a findings list, not a fix-everything mandate** (confirmed with the user
> 2026-08-06): small things get fixed inline as they're found, same pattern as the big flow
> test's own triage rule (item 7). Anything bigger becomes its own new TODO/FUTURE item rather
> than open-ending this plan indefinitely.

---

## 0. Why this, why now

Nine months (in project time) of incremental builds — Plans 01 through 08 — each shipped real,
reviewed, working functionality. Nothing here questions whether any of it *works*. What hasn't
had a dedicated pass is whether the **paper trail still matches the territory**: whether
`CLAUDE.md` folder maps, `architecture/TechDesign.md`'s Rules Index, and `docs/user-guide.md`
still describe the app as it actually behaves today, after eight plans' worth of supersessions,
reworks, and renames (chat mediator → Prometheus, import converters → Hermes/Daedalus, the
propose/apply split, the accent-color pass, etc.) — and whether the code and test suite
underneath are organized the way someone picking this project up fresh would expect, not just
the way each individual plan happened to leave them.

Doing this right before the big flow test (item 7) is deliberate: that test is the last
functional gate before deploy, and it's more useful to run against code/docs that are already
known-current than to find organizational drift *during* the test and have to context-switch.

## 1. Scope & non-goals

**In scope**, one question per track:
- **Track A (Docs):** does every doc's *claim* match current *behavior*?
- **Track B (Code):** is the code organized the way the project's own stated conventions say
  it should be — not "is it correct," but "is it in the right place, is it the right shape"?
- **Track C (Tests):** do we have tests **where we should**, organized **how they should
  be** — not "do the existing tests pass"?

**Out of scope:**
- Fixing bugs found incidentally (flag as a new TODO/FUTURE item instead, unless trivial).
- Running `npm test` / `tsc --noEmit` / `npm run build` as part of this review — those are
  gated by standing rule 5 (ask first) same as any other task; Track C's method (below) is
  reading test files, not executing them.
- Any real Anthropic API call — none of this needs one.
- Redesigning anything — if a doc, code, or test structure looks wrong, that's a finding, not
  an invitation to restructure it as part of this plan.

## 2. Track A — Documentation accuracy audit

**Method:** for each doc below, re-read it against the *current* code it describes (not memory
of what the code used to do), flagging any claim that's stale, aspirational-but-never-built, or
silently superseded without a note.

**Surfaces to check:**
- `CLAUDE.md` (root) — folder map, standing rules, the numbered plan-file list's status
  annotations.
- `lib/ai/CLAUDE.md`, `lib/import/CLAUDE.md`, `lib/serialize/CLAUDE.md` — per-folder maps.
- `architecture/TechDesign.md` — the Rules Index (every row, not just recently-touched ones)
  and the Deferred Decisions table.
- `architecture/Concept.md` — the build-order list against what's actually in "What's built."
- `README.md`, `docs/user-guide.md` — user-facing claims about what the app does.

**Known finding, carried in from the item this plan absorbs (A1):** the 2026-07-31 partial
doc-sync commit covered Plan 06 Phase 6 for Phases 0–4 only — `TechDesign.md`'s Rules Index
#63–71 and Deferred Decisions table, `README.md`, and `docs/user-guide.md` need checking
against what Phase 5.3's live OAuth pass actually confirmed. Separately, the activity-log
consent flow changed from a blocking `/signup` field (Plan 06's original design) to a
dismissible post-login popup — a real supersession not yet reflected in the Rules Index
(needs an entry matching how Rules Index #7 documents the chat-mediator scope reversal) or in
the user-guide's signup walkthrough.

**Known finding, surfaced 2026-08-06 while investigating an unrelated item (A2):** `AgentDTO`
carries a server-computed `validation` field (`descriptionMissing`, `unknownConfigKeys`,
`outdatedOrUnknownValues`, from `lib/blueprint/rules.ts`'s `computeValidation`) that, as of
this writing, **no UI component reads** — confirmed by grepping `app/` for `.validation` and
finding only a test asserting the field exists (`app/api/agents/__tests__/agents.test.ts`).
The mockup's own `.foot` legend ("⚠ = outdated," "✕ = invalid") describes exactly this kind of
signal, but the real app's actual unknown-key/invalid-value flagging (`AgentView.tsx`'s own,
separate, client-side computation — now folded into the custom-key-block treatment per
roadmap TODO item 1) never reads this server-side field at all. This is a doc-vs-code question
as much as a code question: is `Rules.computeValidation`'s output dead code to remove, or a
half-built feature the mockup's legend already promised and the docs should stop implying is
live either way? Flag for a decision, don't silently pick one.

**"What's on the log is on the log" (the user's framing):** specifically verify the Activity
Log — what `docs/user-guide.md` and `TechDesign.md` say gets logged (which call kinds, which
fields, the §5.6 redaction behavior) against what `lib/db/repository/llmCallLog.ts` and the
`llm_call_log` schema actually capture and the Settings page actually renders. This is the
single most concrete "does the doc match the wire" check in this track.

## 3. Track B — Code organization review

**Method:** not a line-by-line correctness read (that's `@codeauditor`'s job on new code, and
the big flow test's job on behavior) — a structural survey against the project's *own stated*
conventions, asking "is this where the project's own docs say it should be, and is it the
shape those docs describe":
- Does every folder's actual contents match its `CLAUDE.md`'s description of it?
- Any dead code, commented-out blocks, or unused exports left behind by a superseded design
  (Track A's finding A2 is a concrete candidate — a whole server-computed field with zero
  readers)?
- Any duplicated logic that arose from parallel work and was never consolidated (e.g. checked
  during the 2026-08-06 accent-color pass: `AgentView.tsx`'s `COLOR_HEX` vs.
  `WorkbenchShell.tsx`'s now-removed `PANEL_COLOR_HEX` was one instance already caught and
  removed same-day — this track is about finding others like it, not re-checking that one).
- Any component/module that's grown past what its own file-header docblock describes (a sign
  the docblock is stale, or the component took on scope it shouldn't have).

**Not in scope for this track:** performance, security review (that's `security-review`'s
job), or opinions about whether an already-settled architecture decision was the right one —
`TechDesign.md`'s Rules Index already records those debates; re-litigating a locked decision
isn't this plan's purpose.

## 4. Track C — Test suite structure review

**Method:** read the test tree's *shape*, not its pass/fail state:
- Does every `lib/`/`app/api/` module with real logic have a corresponding `__tests__/`
  entry, or is coverage concentrated in some areas and absent in others by accident of when
  each part was built?
- Do test file names/locations mirror the source they test, per whatever convention the
  existing suite already established (so a new contributor can find "the test for X" without
  guessing)?
- Any test file testing a code path that no longer exists (a stale test for a superseded
  design — e.g. would there be leftover assertions about the old separate "⚠ unknown key"
  warning-pill styling that roadmap TODO item 1 just retired)?
- Where the standing "mock all AI calls" rule (`CLAUDE.md` rule 2) is actually being followed
  — a structural check that new test files added since the rule was written still comply, not
  a re-verification that already-passing tests pass.

## 5. Process

1. Run all three tracks, producing one findings list per track (file + line + claim/gap,
   same citation discipline as `plans/Branding-Design-Review-260806.md`).
2. Triage each finding: trivial and unambiguous → fix inline as part of this pass; anything
   requiring a judgment call, a design decision, or non-trivial work → becomes its own new
   TODO or FUTURE roadmap item (with a pointer back here for context), not silently fixed.
3. Update `plans/roadmap.md`'s "What's built" / TODO / FUTURE sections to reflect whatever
   moved.
4. This plan is "done" when all three findings lists exist and have been triaged — not when
   every finding is resolved.

## 6. Sequencing note

This sits as `plans/roadmap.md` TODO item 6, after item 5 (second LLM provider) and before
item 7 (the big flow test) — deliberately last "quality" item before the "does it actually
work end-to-end" gate, so that test runs against docs/code/tests already known to be honest
about their own state.
