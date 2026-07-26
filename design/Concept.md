# Agent Workbench — Concept

> A workbench for building and managing AI agents, where an **agent-aware AI chat**
> sits next to an **always-visible structured view** of the agent it's editing.

## The problem (why this exists)

I already build and use a library of AI agents (in Claude, and I also use Copilot).
I like editing them *with AI* in the prompt — but while I do, **I can't see my agent
clearly.** The AI is great; the visibility is missing. Managing a growing pile of
`.md` agent files in a chat box is not friendly.

So the tool keeps the part that works (AI-assisted editing) and adds the part that's
missing (structure + a clear view + a place to organize and export).

## What it is (one sentence)

Not a Markdown editor — a **guided agent workbench**: I see every section of an agent
laid out clearly, and an AI chat next to it edits those sections in place, so I never
edit blind again.

## Who it's for

**First user: me**, and people like me — serious Claude / Copilot agent users who
already have a messy library of agent definitions. Beginner-friendly presets can widen
the audience later; they are not the foundation.

The origin is scratch-my-own-itch, which is the whole point: if I build it and keep
using it, it works. If I drift back to editing `.md` by hand, it doesn't.

## The killer feature

An **agent-aware AI chat**. Not a generic chatbot — it always knows the sections of the
currently-selected agent, edits *those* specifically, and writes the result back into
the structured view instantly. That editing loop is the engineering heart of the tool.

## Layout (3 panes)

```
┌─────────────┬───────────────────────────┬──────────────┐
│  AGENTS     │  Zara                     │  AI CHAT     │
│             │  ─────────────────────    │              │
│ ▾ Personal  │  ▸ Role                   │ "tighten     │
│    Zara ◄   │  ▸ Tools                  │  her         │
│    Aria     │  ▸ Instructions           │  guardrails" │
│ ▾ Pipeline  │  ▸ Output format          │              │
│    analyst  │  ▸ Guardrails             │ [AI edits    │
│    architect│                           │  the section │
│    dev      │  (live preview / raw ⇄)   │  in place]   │
└─────────────┴───────────────────────────┴──────────────┘
```

- **Left** — groupable agent list (e.g. a "Personal" group with Zara + Aria).
- **Center** — the agent split into its real sections, always visible.
- **Right** — the AI chat, whose edits appear immediately in the center pane.

## Decisions locked

| Decision        | Locked as |
|-----------------|-----------|
| What it is      | A guided *agent workbench*, not a Markdown editor |
| First user      | Me / serious Claude & Copilot agent users |
| Killer feature  | AI chat that edits the *structured sections* in place |
| Source of truth | **Platform is master** |
| AI provider     | **Bring-your-own-key** for MVP → hosted later (easy first, migrate later) |
| Layout          | 3-pane: groupable list · structured sections · AI chat |

## Build order

1. **Structured view + agent-aware AI chat** — the core loop, the reason to open the app.
2. **Library + groups** (left panel) — cheap, wanted early.
3. **Frictionless export back to Claude** — the "master" tax: if the platform owns the
   agents, exporting them back out has to be effortless.
4. **Export to Copilot / others** — real *translation* between formats, not a file copy.
5. **Sharing / forking** — show my agent to a friend so they can fork their own from it.

## Deliberately out of scope (for now)

No agent execution, no workflow builder, no multi-agent orchestration engine, no memory
logic. Just building, seeing, organizing, and exporting agent *definitions*.

## Canonical agent structure (reference)

Verified against Anthropic's current docs (code.claude.com — Claude Code subagents +
Agent SDK). **This is the ground truth the workbench schema mirrors.**

A Claude subagent is a single `.md` file (`.claude/agents/` project-level, or
`~/.claude/agents/` user-level) with **two distinct zones**:

```markdown
---                          ← YAML frontmatter (structured CONFIG — official schema)
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---
                             ← Markdown body (the SYSTEM PROMPT — the agent's "brain")
You are a code reviewer. When invoked, analyze the code and
provide specific, actionable feedback on quality and security.
```

### Tier 1 — Frontmatter (official, typed, enumerable)

Only `name` and `description` are **required**; everything else is optional. This tier
is a fixed spec — the workbench mirrors it, doesn't invent it. Great fit for
dropdowns / typed inputs (the "pre-defined options" idea).

| Field | Req? | What it is | Workbench UI |
|-------|------|-----------|--------------|
| `name` | ✅ | lowercase-hyphen id | text input |
| `description` | ✅ | *when* to delegate to this agent | textarea |
| `tools` | – | allowed tools (inherits all if omitted) | multi-select |
| `disallowedTools` | – | tools to deny | multi-select |
| `model` | – | `sonnet`/`opus`/`haiku`/`fable`/full-id/`inherit` | dropdown |
| `permissionMode` | – | `default`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`/`plan` | dropdown |
| `maxTurns` | – | agentic turn cap | number |
| `skills` | – | skills to preload | multi-select |
| `mcpServers` | – | MCP servers available | list |
| `hooks` | – | lifecycle hooks | advanced |
| `memory` | – | `user`/`project`/`local` (cross-session learning) | dropdown |
| `effort` | – | `low`/`medium`/`high`/`xhigh`/`max` | dropdown |
| `background`, `isolation`, `color`, `initialPrompt` | – | misc | advanced |

### Tier 2 — Body (free-form system prompt, NO official sub-structure)

Claude treats the body as **one blob** of instructions. The sections we use —
Role / Goals / Instructions / Output format / Guardrails — are a **convention we
invented**, not part of any spec. That's the opening: the frontmatter is where the
workbench *conforms* to the standard; the body is where it *adds value* by imposing a
good, opinionated section template that raw agent files don't have.

### Agent SDK confirms the same model

The SDK's `AgentDefinition` uses the same pieces in code form: `description`, `prompt`
(= the body/system prompt), `tools`, `model`. Frontmatter fields and SDK parameters are
the *same conceptual model* in two skins — so a workbench data model built on the
frontmatter + body split maps cleanly to **both** the file format and the SDK.

### Consequences for the build

- The center pane is **two tiers**, not one flat list: a typed **config** tier
  (frontmatter, spec-defined, safe/easy) and an opinionated **prompt** tier (body, our
  design, the differentiator, what the AI chat mostly rewrites).
- **Export to Copilot** = keep/translate the body, drop or remap most frontmatter
  (Copilot has no equivalent for most config fields). The two-tier split makes this
  translation legible instead of magic.

## Real-library audit (15 agents)

Read the actual `~/.claude/agents/` library to derive the schema from real data, not a
guess. Finding: **no single pattern** — one dominant convention plus real drift. The tool
must not hardcode any of this; it standardizes it.

**Dominant convention (14 of 15)** — the "specializing in" template:

```
# ROLE            → "You are a senior X specializing in: …" + "Your job is…" + a STOP clause
# {NAME} BEHAVIOR → numbered process steps
# RULES           → hard guardrails
# OUTPUT FORMAT   → a Section | Format table
```

- 12 follow it cleanly (analyst, impact, architect, dev, qa, codeauditor, mobile,
  datasync, notion + the coaching agents' richer variant).
- 2 drift (`scribe`, `ux`) — drop the `# ROLE` heading, open with bare prose.
- 1 outlier (`orchestrator`) — no ROLE/RULES headings at all.

**Richer variant (Zara, Ada, Aria)** — same core plus extra sections: `SOURCES YOU READ`,
`START/END OF SESSION` (read memory / write report), `HANDOFFS`, `TONE`, `SESSION MODES`,
and one-offs (Aria's `TUNING MODE`, `THE AUDIO`). Aria is 557 lines.

### Drift the workbench would catch (this IS the "reviewing" feature, proven on real data)

- **`name` casing breaks the spec.** Spec requires lowercase-hyphen; `Zara`/`Ada`/`Aria`
  are capitalized. `analyst`/`dev` are correct. → validator flags instantly.
- **`model` inconsistent** — `claude-sonnet-4-6`, `claude-sonnet-5`, `opus`, `sonnet`
  (mixed full-IDs + aliases, some pointing at older versions). → dropdown of valid models.
- **`tools` bloat** — every pipeline agent drags a 40+ entry copy-pasted Atlassian-MCP
  dump; coaching agents keep tidy 5–8 lists. → multi-select.
- **`description` quoting** inconsistent (some quoted, some bare). → normalized on save.
- **The core "how it works" section has 6 different names** across the library
  (`BEHAVIOR` / `WHAT YOU DO` / `MECHANICS` / `SESSION FLOW` / …). This is the exact
  "pattern that isn't easy to understand" the tool fixes.

## Body schema (the workbench's opinionated Tier-2 template)

One superset schema covers the whole library. Core is required; optional sections toggle
on per agent.

**Core (every agent):**
- **Role** — identity ("You are X specializing in…")
- **Behavior** — how it works, the numbered process *(named `Behavior`, not `Process`)*
- **Guardrails** — hard rules / what it must not do
- **Output** — the shape of what it returns

**Optional (opt-in):**
- **Sources** — files/inputs it reads
- **Lifecycle** — start/end-of-session duties (read memory / write report)
- **Handoffs** — relationships to other agents
- **Tone** — voice
- **Modes** — sub-modes (e.g. dev's Mode A/B, Zara's session modes)

This gives the simple agents their clean 4-section shape and lets the rich ones switch on
the extras — one schema, not two divergent conventions.

## Grouping model (how agents are organized)

**Requirement:** an agent can belong to *many* groups at once (e.g. `doc-editor` in both
`personal` and `professional`), with an unlimited number of user-defined groups.

**Decision: groups are many-to-many LABELS, not folders.** A folder is a location
(one-to-many — a file lives in one place); that's exactly what can't put one agent in two
groups. A label is a tag the agent carries; it appears under every group it's tagged with,
while remaining a single underlying agent (edit once, updates everywhere; untagging just
drops the label, never deletes).

**This is a concrete platform-beats-files win:** on the filesystem `dev.md` lives in
exactly one directory — the OS forbids two. The platform (being master) has no such limit,
so multi-group membership is something raw files literally cannot do.

Key conceptual rules (data model / tables live in `TechDesign.md`):
- **Groups are labels, not folders** — an agent carries many; it appears under each,
  stays one underlying agent (edit once, updates everywhere; untag ≠ delete).
- **Unlimited, user-defined groups.** No hardcoded families.
- **Ship flat, keep nesting cheap** — flat now, nestable later with zero data migration
  (see TechDesign).
- **Membership is platform metadata, not written into exported `.md`** (keeps exports
  spec-clean).
- Provide **"All agents"** and **"Ungrouped"** views so nothing is lost when untagged.

## Companion docs

- **`TechDesign.md`** — the *how*: data model, serialization contract, stack. The
  conceptual design here (two-tier agent schema, superset body template, many-to-many
  grouping) is settled and feeds directly into it.
