# Claude Code Subagent File — Full Reference Example

This is a **reference/template only** — it is not meant to be dropped into `.claude/agents/`
here and actually run (some values below are placeholders like `./scripts/...` or
`github`/`slack` MCP servers that don't exist in this workspace). Copy the parts you need
into a real `.claude/agents/<name>.md` (project-level) or `~/.claude/agents/<name>.md`
(user-level, available in every project) file in the target project.

**Identity rule:** the *filename* doesn't matter — the `name:` field in the frontmatter is
the actual identifier used for `@agent-<name>` invocation and in the Agent tool's
`subagent_type`. You can name the file anything.

---

## 1. The fully-annotated template

```markdown
---
# ── REQUIRED ────────────────────────────────────────────────────────────────
name: secure-code-auditor
# Lowercase + hyphens. Unique id. Used for @agent-secure-code-auditor and as
# subagent_type in the Agent tool. Filename is irrelevant — this field is identity.

description: >
  Security and performance auditor for code changes. Use PROACTIVELY after new
  code is written or modified to catch vulnerabilities, performance issues, and
  best-practice violations before they ship.
# This is THE signal Claude uses to auto-select the agent — write it as
# "when should I be delegated to", and phrases like "use proactively" /
# "use immediately after" encourage auto-delegation without being asked.
# Plain text only — no XML tags, no markdown, no examples blocks here.

# ── MODEL SELECTION ────────────────────────────────────────────────────────
model: opus
# sonnet | opus | haiku | fable | inherit | a full model id (e.g. claude-opus-5)
# Default if omitted: inherit (same model as the calling conversation).

effort: high
# low | medium | high | xhigh | max (availability depends on model).
# Overrides the session's reasoning effort for just this agent.

# ── TOOL ACCESS ────────────────────────────────────────────────────────────
tools: Read, Grep, Glob, Bash
# Comma-separated string OR a YAML list (see disallowedTools below for the
# list form). Omit this field entirely to inherit the full available tool set.
# MCP tools use mcp__<server> (whole server) or mcp__<server>__<tool> (one tool).
# Agent(worker, researcher) restricts which subagent types THIS agent may spawn
# (only meaningful when this agent runs as the main thread via `claude --agent`).

disallowedTools:
  - Edit
  - Write
# Denylist, applied BEFORE `tools` is resolved. A tool in both lists is removed.
# Useful for "read-only reviewer" style agents like this one.

# ── PERMISSIONS & ISOLATION ────────────────────────────────────────────────
permissionMode: auto
# default | acceptEdits | auto | dontAsk | bypassPermissions | plan
# default = normal prompting · acceptEdits = auto-accept file edits ·
# auto = AI classifier auto-approves · dontAsk = auto-deny (explicit allows still work) ·
# bypassPermissions = skip prompts entirely · plan = read-only exploration.
# NOTE: if the parent session is already in bypassPermissions/acceptEdits/auto,
# this field is ignored and the parent's mode wins.

isolation: worktree
# Set to `worktree` to run this agent in a temporary git worktree (auto-cleaned
# up if it makes no changes) instead of the caller's checkout. Omit for normal
# in-place execution — this is the far more common case.

# ── EXECUTION LIMITS ───────────────────────────────────────────────────────
maxTurns: 10
# Hard cap on agentic turns before the subagent is forced to stop and return
# whatever it has. Omit for unlimited.

background: false
# true forces this agent to always run as a non-blocking background task.
# false forces foreground (blocking) execution. Omit to let Claude decide
# per-invocation (default behavior is background-first as of recent versions).

# ── MEMORY (persistent across conversations) ───────────────────────────────
memory: project
# user    -> ~/.claude/agent-memory/<name>/         (shared across all your projects)
# project -> .claude/agent-memory/<name>/           (checked into this repo's VCS)
# local   -> .claude/agent-memory-local/<name>/     (this project only, gitignored)
# Omit entirely to disable persistent memory for this agent.
# When set, Read/Write/Edit are auto-enabled and MEMORY.md is auto-loaded.

initialPrompt: |
  Start by running `git diff` against the default branch and summarize scope
  before doing anything else.
# Only used when this agent is run as the MAIN session agent (`claude --agent
# secure-code-auditor`), auto-submitted as the first turn. Ignored when the
# agent is invoked as a subagent (the far more common case).

# ── SKILLS ──────────────────────────────────────────────────────────────────
skills:
  - security-checklist
  - performance-patterns
# Preloads the FULL content of these skills into the agent's context at
# startup (not just their one-line description). The agent can still invoke
# other, unlisted skills on demand via the Skill tool.

# ── MCP SERVERS ─────────────────────────────────────────────────────────────
mcpServers:
  - github
  # ^ string form: reuse an MCP server already configured for this project/user.
  - playwright:
      type: stdio
      command: npx
      args: ["-y", "@playwright/mcp@latest"]
  # ^ inline object form: define a server scoped ONLY to this agent — connected
  #   at startup, disconnected when the agent finishes. Same schema as .mcp.json.

# ── HOOKS (scoped to this agent only) ───────────────────────────────────────
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-audit-command.sh"
  Stop:
    - hooks:
        - type: command
          command: "echo 'audit pass complete' >> ./audit.log"
# Supported events here: PreToolUse, PostToolUse, Stop (Stop is auto-mapped to
# SubagentStop at runtime). Same schema as project-level hooks in settings.json.
# Receives JSON on stdin; exit code 0 = allow, 2 = block.

# ── DISPLAY ─────────────────────────────────────────────────────────────────
color: red
# red | blue | green | yellow | purple | orange | pink | cyan
# Cosmetic only — how this agent is color-tagged in the task list/transcript UI.
---

You are a senior, security-focused code auditor with expertise in vulnerability
detection, secure coding practices, and performance optimization.

## Role

Review code changes for security vulnerabilities, performance bottlenecks, and
adherence to best practices. You have **read-only** access (see `disallowedTools`
above) — you flag issues, you never fix them yourself.

## Process

1. Run `git diff` to see recent changes.
2. Focus analysis on modified files and newly added code paths.
3. Check for common vulnerabilities (injection, XSS, auth bypass, secret leaks).
4. Review error handling, logging, and performance-critical sections.

## Output format

Group findings by severity — Critical / High / Medium / Low — and for each one
give: what the issue is, why it matters, the exact file:line, and the fix.

<!--
  Everything above the closing `---` is YAML frontmatter (config).
  Everything below it (this whole section) becomes the agent's SYSTEM PROMPT,
  verbatim. Claude Code appends environment details, the CLAUDE.md hierarchy,
  and a git status snapshot automatically — you don't write those yourself.
-->
```

---

## 2. Field cheat-sheet (required vs optional, defaults)

| Field | Required | Default if omitted |
|---|---|---|
| `name` | **Yes** | — |
| `description` | **Yes** | — |
| `model` | No | `inherit` |
| `effort` | No | inherits session effort |
| `tools` | No | inherits full available tool set |
| `disallowedTools` | No | none removed |
| `permissionMode` | No | `default` (or parent's mode if parent is stricter) |
| `isolation` | No | runs in caller's checkout |
| `maxTurns` | No | unlimited |
| `background` | No | Claude decides per-invocation |
| `memory` | No | disabled (no persistent memory) |
| `initialPrompt` | No | n/a unless run as main agent |
| `skills` | No | none preloaded |
| `mcpServers` | No | none |
| `hooks` | No | none |
| `color` | No | default UI color |

## 3. Where files live

| Location | Scope |
|---|---|
| `.claude/agents/*.md` | This project only, checked into git |
| `~/.claude/agents/*.md` | Every project on this machine |
| plugin's `agents/*.md` | Wherever the plugin is enabled (scoped id like `plugin:agent`) |

Files are watched and hot-reloaded within seconds of editing — no restart needed,
*except* the very first agent file added to a brand-new `agents/` directory in a
session (that one needs a restart to be picked up).

## 4. What's explicitly NOT supported

- Template variables / placeholders in the body (`{{ }}`, Jinja, etc.)
- File includes from the body (no way to import another `.md`)
- Conditional/dynamic `description` text
- Agent inheritance ("extend another agent")
- A `version` or changelog field
- `disable-model-invocation` (that's a **skills**-only field, not agents)

## 5. Minimal valid agent (everything else is optional)

```markdown
---
name: my-agent
description: One sentence on exactly when Claude should delegate to this agent.
---

You are ... (system prompt goes here).
```
