# MyAgentStudio — Project Explanation

The product story: what probleM this solves, who it's for, how it Actually woRks, and how
it Came tOgether. For the engineering internals (data model, stack detail, architecture),
see `system-about.md`.

---

## The problem

Building AI agents — for Claude Code, for Copilot, for any tool that takes a system-prompt
file — tends to settle into the same workflow: open a chat window, ask the model to draft
or revise an agent definition, paste the result into a `.md` file, and repeat. The AI part
of that loop works well. What's missing is visibility: while you're editing an agent
through a chat prompt, you can't actually *see* the agent clearly — its sections, its
config, what changed and what didn't. Once you have more than a handful of agents, keeping
track of a growing pile of loose `.md` files by hand stops being pleasant.

## What it is

MyAgentStudio is a **guided agent workbench**, not a Markdown editor. Every section of the
currently selected agent is laid out clearly on screen, at all times, and an AI chat panel
sits right next to that view — it edits those specific sections in place, and the result
appears in the structured view instantly. The point isn't chat *or* structure; it's chat
*with* structure, so you never edit an agent blind.

## Who it's for

Serious Claude Code / Copilot agent users who already maintain a working library of agent
definitions and want a better way to see, organize, and iterate on them than a folder of
`.md` files and a chat window. The tool grew out of exactly that need — its first user
maintains a real library of a dozen-plus agents (the coaching, pipeline, and workbench
agents referenced throughout this doc's own development are real examples) and uses the
workbench to manage them day to day.

## The killer feature

An **agent-aware AI chat**. Not a generic assistant — it always knows the full current
state of the agent you have open (its description, every section, every config value) and
can propose a change to any of them in a single instruction, without ever touching the
one field it's not allowed to change: the agent's `name`. Nothing it proposes is written
until you explicitly approve it — you always see exactly what would change, side-by-side
with what's there today, before anything is committed.

## How it works

### The four-pane layout

```
┌─────────────┬───────────────────────────┬──────────────┐
│  LIBRARY    │  Structured View          │  Raw │ Share │
│             │  ─────────────────────    │  ┄┄┄┄┄┄┄┄┄┄  │
│  Zara ◄     │  ▸ Role                   │  ---         │
│  Aria       │  ▸ Behavior               │  name: Zara  │
│  dev        │  ▸ Guardrails             │  tools: ...  │
│  qa         │  ▸ Output                 │  ---         │
│  ...        │  ─────────────────────    │  # ROLE      │
│             │  AI CHAT: "tighten her    │  ...         │
│             │  guardrails" → [proposal] │  (foldable,  │
│             │                           │   read-only) │
└─────────────┴───────────────────────────┴──────────────┘
```

- **Library** (left, foldable) — every agent you've imported or created, listed in one
  place, plus a **Shared with me** section for agents someone else granted you access to.
  (Filing agents into groups is designed and built underneath but not yet exposed
  in the UI — see `roadmap.md`.)
- **Structured view** (center top) — the selected agent split into its real sections:
  Role, Behavior, Guardrails, Output, plus whichever optional sections it uses. This is
  the platform's main view — always visible, never hidden behind a chat transcript.
- **AI chat** (center bottom, under the structured view) — where you type an instruction;
  a proposed change appears as a card, and clicking Apply is what actually edits the
  agent above.
- **Right dock** (right, foldable) — a two-tab panel: **Raw**, a live, read-only preview
  of the exact `.md` file the current state would export to, with a one-click download;
  and **Share**, where an owner grants another user read-only access.

### Import

You bring an existing `.md` agent file in one of two ways. **Structural** import (the
default) reads the whole file and reorganizes it into the workbench's canonical section
structure — the right choice for a file from another tool, or one with inconsistent or
nonstandard headings. **Strict** import classifies existing headings without rewriting any
content — the right choice for a file that's already well-organized and should come in
verbatim. Either way, nothing about a real agent file's content is ever silently dropped:
anything the importer can't confidently place lands as its own custom section rather than
being discarded.

### Editing — structured, or by chat

Every section can be edited directly, in place, with an explicit Save. Or you can describe
the change in plain language to the AI chat — "tighten the guardrails," "add a Sources
section," "switch the model to Opus" — and review a proposal before anything lands. Both
paths write to the same structured data and show up identically in the structured view and
the Raw preview the moment they're saved or applied.

### Organizing (coming soon)

The workbench is designed so an agent can belong to any number of groups at once — a group
is a label, not a folder, so one agent could live under both "Personal" and "Pipeline"
without being duplicated or moved, with editing from either group touching the one
underlying agent everywhere it appears. The data model and API for this are built; the
on-screen controls to create a group or file an agent into one are switched off for this
first launch and are next on the roadmap.

### Export

The Raw panel is always a live, accurate preview of what exporting would produce — not a
separate "generate export" step. One click downloads the current state as a real
`.md` file, ready to drop into a `.claude/agents/` directory.

### Sharing an agent

An owner can hand another user **live, read-only access** to an agent — by a reusable
link code, or by their email address directly, even before that person has an account.
Unlike export, this isn't a snapshot: the recipient always sees the owner's current
version as it changes. A recipient can never edit the shared agent; their only available
action is **Copy to me**, which forks an independent copy into their own library with no
ongoing connection back to the original.

### Beyond the browser: console access

The same library is reachable from a terminal, not just the workbench. A user generates a
personal access token in their Account page and points a console AI tool — Claude Code, or
anything that speaks MCP over HTTP — at the workbench's own agent data: list what's there,
pull one agent's full content, or push an edited file back in. It's the same import
pipeline the browser's Import dialog uses under the hood, so the same safety net (a
snapshot before and after, nothing silently lost) applies whether the edit came from a
click or a terminal command.

## The technology

A single Next.js application — the whole workbench, frontend and backend, is one deploy
unit. The frontend is React (via Next's App Router) styled with Tailwind; the backend is
the same app's own server-side Route Handlers, which is also the only place the Anthropic
API key ever lives — the browser calls the workbench's own API, never Anthropic directly.
Agent data is stored in SQLite via Drizzle ORM, behind a repository layer that keeps
ownership checks and query logic in one place. AI calls (both import modes, and the chat
agent) go through Anthropic's official SDK, funneled through a single gateway function
that handles logging, a dry-run mode, and per-user rate limits before any request reaches
the network. Accounts are gated by admin-issued invite codes, with sign-in by password or
Google OAuth.

## How it was developed

The project started from a concrete, personal itch rather than a market survey: editing
agents through an AI chat already worked well, but doing it blind — no persistent view of
the agent being edited — didn't. The very first design decision, before any code, was that
the **platform, not the `.md` file, is the source of truth** — files are something you
import from and export to, not what the tool edits directly. That one call shaped
everything downstream: a structured data model with two symmetric zones (typed config,
freeform sections), an AI-assisted-but-never-lossy import pipeline, and a chat agent that
proposes changes to review rather than one that edits silently.

The canonical section schema (Role / Behavior / Guardrails / Output, plus optional
Sources / Lifecycle / Handoffs / Tone / Modes / Boundaries) wasn't guessed — it came from
auditing a real library of agent files and finding one dominant convention with real
drift (inconsistent naming, mixed model identifiers, tool-list bloat), which is exactly
the kind of mess the workbench was built to surface and fix rather than silently paper
over. That audit-driven habit continued as the project grew: later additions to the
catalog (like the Boundaries section) came from recognizing a real, recurring pattern
rather than from guessing what might be useful.

The build went from a single-user local prototype (one AI key, one person, one machine) to
a multi-tenant application with real accounts, invite-gated signup, Google sign-in, and
per-user cost controls — each layer added deliberately once the layer under it was solid,
not designed in from day one. The chat editing feature went through its own evolution:
starting as a single-section rewrite tool, then widening to edit any section, then to
propose changes across description/sections/config in one turn with an explicit
review-and-approve step before anything is written — the "never edit blind" principle
applied to the tool's own AI feature, not just to the human editing experience it was
built to fix.
