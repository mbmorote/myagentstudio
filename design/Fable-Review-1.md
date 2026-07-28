# Fable Review 1 — full-project audit + import-instructions comparison

> **How to use this:** open a fresh session on **Claude Fable 5**, set effort to **high**
> (or xhigh). **Attach**: `Concept.md`, `TechDesign.md`, and all four files in
> `design/system-agents/` — `import-instructions.md`, `import-instructions -copilot.md`,
> `import-instructions-structural.md`, `import-instructions-structural-copilot.md`, plus
> `chat-mediator.md`. Then paste everything below the line. Ask for the whole review in
> **one shot**. When it's done, come back to Opus/Sonnet to act on the findings.

---

You are a principal engineer doing two things in one pass: (1) a **current-state audit** of
an AI agent-workbench platform that now has real code behind it, and (2) a **head-to-head
comparison** of two competing drafts of the same system-agent rule-set. Be concrete. For
every concern, give a **specific failure scenario** (inputs/state → what breaks), not a
vague worry. It's fine — expected, even — to say a decision is sound and move on; I want
signal, not a padded list.

## What the platform is (so you don't re-derive it)

A local-first, single-user **agent workbench**: an AI chat that edits a structured view of
a Claude/Copilot agent in place. Platform-is-master; `.md` is an export target. Stack:
single Next.js full-stack app, Drizzle + SQLite, official Anthropic SDK, key server-side
only. `Concept.md` = the what/why, `TechDesign.md` = the how (data model, Rules Index,
Blueprint, decision drafts) — both attached.

**Where it actually stands (not just design-on-paper):** Phase 1 (structured-data round-trip
proof), Phase 2 (Drizzle persistence + repository layer), and Phase 3 (the Strict Import
pipeline, `POST /api/agents/import`) are built and committed. A second import mode,
**Structural Import**, was designed 2026-07-28 (`TechDesign.md` Rules Index #27/#31/#32) but
has **no code path yet** — no route, no prompt wiring, no UI mode picker. Two competing
drafts of its rule-set exist (see Part 2) and neither has been chosen as final.

## Part 1 — Current-state project audit

Rank by how costly each would be to get wrong or leave unresolved, given code already
exists on top of some of these decisions (a finding here may mean "fix the code," not just
"fix the design"):

1. **Design-vs-code fidelity.** Do the built Phase 1–3 pieces actually match what
   `TechDesign.md` claims is locked (Rules Index #5/#6/#28/#29 especially — Stage 2
   labels-only, content-never-touches-the-model, the `propKey` removal)? Look for drift
   between the doc and the real `lib/`, `app/api/agents/import`, `scripts/build-prompts.ts`.
2. **The EAV + no-FK "openness" data model**, now that real imports have run against it.
   Any integrity, query, or migration pain surfacing in practice that the design didn't
   anticipate?
3. **The Blueprint as single source for UI/import/validation.** Now that Stage 2 actually
   consumes it (`renderBlueprintForPrompt`), has anything drifted into a second
   implementation, or does the "one module, three consumers" claim still hold?
4. **Round-trip fidelity in practice.** The golden-file test claim
   (`parse(export(parse(md))) === parse(md)`) — was this actually exercised against messy
   real-world agents (the commit log mentions "live model testing" and a bugfix)? What broke,
   and is the fix general or a patch for one observed case?
5. **System vs. user agent boundary + prompt-injection surface**, now that imported
   (untrusted) agent content is actually being fed to a system-agent prompt. Concrete abuse
   scenario: a malicious agent file crafted to make the import converter misbehave.
6. **Structural Import's design-only status.** Is the safety model described in
   `TechDesign.md` (#31: prompt-enforced, not code-verified, same trust class as the
   mediator) actually adequate for a mode that's explicitly meant to handle the *most*
   malformed/adversarial input files — or is prompt-only enforcement the wrong tradeoff
   specifically for the class of input this mode targets?

## Part 2 — Compare the two import-instructions drafts

Two people/tools independently drafted rule-sets for the same two import modes. Compare
them pairwise:

- **Strict Import**: `design/system-agents/import-instructions.md` (mine) vs.
  `design/system-agents/import-instructions -copilot.md` (Copilot's).
- **Structural Import**: `design/system-agents/import-instructions-structural.md` (mine) vs.
  `design/system-agents/import-instructions-structural-copilot.md` (Copilot's).

**The I/O contract for Structural Import is locked — not part of what you're deciding.**
State this back before evaluating anything, so it's clear it isn't up for debate: the
system prompt is `import-instructions-structural.md`; the model is given, as attached
content, (1) the Blueprint's canonical catalog and (2) the **complete raw text of the
agent being imported**; the model returns **one complete markdown document — the whole
new agent, already in agent format** (Role → Behavior → Guardrails → Output, sections
written out directly). No `blockId` mapping, no `action` tags, no server-side
reassembly, no split points reported back for the server to execute. This is the
architecture already settled in `TechDesign.md` (Rules Index #27/#31/#32) and in my
`import-instructions-structural.md` draft.

**Copilot's Structural draft uses a different, incompatible output contract** —
`blockId` + `action` (`rename`/`merge`/`split`/`relocate`/`reorder`) JSON, closer to
Strict Import's server-reassembly model, with content given as input but never returned.
**Do not treat this as a competing architecture to weigh against mine and pick between.**
Its output-contract choice is out of scope — flag any way in which it's actually
inconsistent on its own terms (e.g. claiming "no content fields" while requiring
content-level decisions like split boundaries the server would have nowhere to read from)
as a flaw in that draft, not as a reason to reconsider the locked contract.

The actual task: **for each pair, extract what's genuinely better in either draft — its
guardrail wording, its ambiguity handling, its coverage of edge cases, its clarity as a
model-facing instruction — and fold it into a single best-of-both rule-set, without
changing the locked I/O contract above.** This is not "pick the better file." Where
Copilot's draft has a stronger guardrail, better-scoped rule, or catches a case mine
misses, say so specifically (quote it) so it can be ported over in its *wording/intent*,
translated into the whole-document output shape if its original form assumed the
mapping-based contract.

Evaluate:
1. **Guardrail strength and coverage** — line up each draft's guardrails against the
   Structural Import concept doc's requirements (no meaning rewrite, no content loss, no
   hallucination, no forced structure except last-resort, verbatim movement). For every
   guardrail present in one draft but weaker or missing in the other, name it and say
   which wording should win.
2. **Ambiguity handling** — mine allows last-resort custom-block naming (a deliberate
   loosening, see `TechDesign.md` #32); both Copilot drafts default to "leave unmapped,
   never guess" with no equivalent. Which is the better default, and does the difference
   matter enough to reconcile? Note that this decision is independent of the output
   contract — it can be folded into the whole-document format either way.
3. **Clarity as a model-facing prompt.** Independent of content, which draft's phrasing is
   more likely to actually bind model behavior — more concrete, less ambiguous, less
   readable-as-aspirational-prose? Cite specific sentences.
4. **Strict Import pair** — same exercise, but here the output contract already matches
   (both are labels-only, blockId-based) so an architecture pick is legitimately in scope
   if the drafts genuinely diverge there; otherwise treat it as the same
   extract-the-best-of-both exercise as Structural.
5. **Deliverable.** Produce the actual merged rule-set text for Structural Import (in the
   locked whole-document-output shape) incorporating every improvement you found worth
   taking from Copilot's draft — not just a list of recommendations to apply later.

## How to respond (keep it tight)

1. **Part 1 findings** — ranked most-severe first: one-line claim · concrete failure
   scenario · recommended fix · cost to fix now vs. later.
2. **Part 2 — the merged Structural Import rule-set**, full text, in the locked
   whole-document-output shape, plus a short changelist of what was ported from Copilot's
   draft and why. Same treatment for the Strict Import pair (merged text + changelist, or a
   clear "mine already covers everything Copilot's does" if that's genuinely true).
3. **Solid — leave alone.** What you pressure-tested in either part and think is right.
4. **Blind spots.** What wasn't asked here that you'd want to know before finalizing
   Structural Import's implementation?

Prioritize the one or two findings most likely to force a rewrite or a wrong rule-set
choice. If something is sound, say so plainly rather than inventing problems.
