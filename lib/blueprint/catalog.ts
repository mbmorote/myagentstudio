/**
 * lib/blueprint/catalog.ts
 *
 * In-code source for CONFIG_DEFS — still the live catalog `lib/blueprint/rules.ts`
 * and `lib/blueprint/prompt.ts` read directly (making the config catalog itself
 * platform-aware, the way the section catalog already is, is a separate,
 * not-yet-done migration — see `plans/roadmap.md` FUTURE).
 *
 * SECTION_DEFS used to live here too but moved to `lib/db/sectionDefsSeed.ts`
 * 2026-08-07 — it's bootstrap-seed-only (its one real consumer is
 * `lib/db/seed.ts`), and the live LLM round-trip (the blueprint sent to
 * Daedalus/Prometheus/Hermes, and the heading→sectionKey matcher) reads
 * `getSectionDefs(platform)` from the DB, not this file. See
 * `lib/blueprint/prompt.ts` and `lib/import/assembleStructural.ts`.
 *
 * The CONFIG_DEFS array is verbatim from §4 of Plan 01, refreshed 2026-07-28 against the real
 * Claude Code subagent frontmatter schema (code.claude.com/docs/en/sub-agents,
 * .../tools-reference), refreshed against the real docs 2026-07-28. This is the
 * Claude Code CLI's own subagent format (`.claude/agents/*.md`), which is also
 * what a self-hosted Claude Agent SDK runtime loads — NOT Anthropic's separate,
 * subscription-hosted Managed Agents product (platform.claude.com/docs/en/
 * managed-agents/*), which uses an unrelated JSON config shape and was
 * deliberately ruled out as a target (2026-07-28 design discussion).
 */

// ─────────────────────────────  Platform catalog  ─────────────────────────────
// Not a DB table — agent.platform's allowed-values catalog.

export const PLATFORM_DEFS = [
  { key: 'claude', label: 'Claude' },
] as const;

// ─────────────────────────────  Config catalog  ────────────────────────────────

export const CONFIG_DEFS = [
  {
    // #37 (2026-07-28): real subagent docs show short aliases are the primary
    // documented form, with 'inherit' as the actual default (not just "kept
    // for now" — an earlier version of this catalog locked full-IDs-only,
    // corrected once the real docs were checked).
    key: 'model',
    label: 'Model',
    datatype: 'enum' as const,
    isCore: true,
    required: false,
    hint: '',  // shown in the model+effort header control, not in the config grid
    allowedValues: [
      'sonnet',
      'opus',
      'haiku',
      'fable',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-haiku-4-5-20251001',
      'claude-fable-5',
      'inherit',
    ],
  },
  {
    // #38 (2026-07-28): full current Claude Code tool list (code.claude.com/
    // docs/en/tools-reference), replacing a stale 10-entry guess. 'Create' was
    // never a real tool (an artifact of whatever real agent file seeded this
    // catalog — dev.md still has it, correctly flagged as unrecognized).
    // 'Task' was renamed to 'Agent' in Claude Code v2.1.63; kept only as a
    // backward-compat alias in real subagent files, not a current tool name.
    key: 'tools',
    label: 'Tools',
    datatype: 'list' as const,
    isCore: true,
    required: false,
    hint: 'Omit to inherit the full available tool set. MCP tools use mcp__<server> (whole server) or mcp__<server>__<tool> (one tool). Agent(worker, researcher) restricts which subagent types THIS agent may spawn — only meaningful when this agent runs as the main thread via claude --agent.',
    allowedValues: [
      'Agent',
      'Artifact',
      'AskUserQuestion',
      'Bash',
      'CronCreate',
      'CronDelete',
      'CronList',
      'Edit',
      'EndConversation',
      'EnterPlanMode',
      'EnterWorktree',
      'ExitPlanMode',
      'ExitWorktree',
      'Glob',
      'Grep',
      'ListMcpResourcesTool',
      'LSP',
      'Monitor',
      'NotebookEdit',
      'PowerShell',
      'PushNotification',
      'Read',
      'ReadMcpResourceTool',
      'RemoteTrigger',
      'ReportFindings',
      'ScheduleWakeup',
      'SendMessage',
      'SendUserFile',
      'ShareOnboardingGuide',
      'Skill',
      'TaskCreate',
      'TaskGet',
      'TaskList',
      'TaskOutput',
      'TaskStop',
      'TaskUpdate',
      'TodoWrite',
      'ToolSearch',
      'WaitForMcpServers',
      'WebFetch',
      'WebSearch',
      'Workflow',
      'Write',
    ],
  },
  {
    key: 'disallowedTools',
    label: 'Disallowed tools',
    datatype: 'list' as const,
    isCore: false,
    required: false,
    hint: "Denylist, applied BEFORE tools is resolved. A tool in both lists is removed. Useful for 'read-only reviewer' style agents.",
    allowedValues: null,
  },
  {
    // 'manual' added #38 — documented alias for 'default' (Claude Code v2.1.200+).
    key: 'permissionMode',
    label: 'Permission mode',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
    hint: "default = normal prompting · acceptEdits = auto-accept file edits · auto = AI classifier auto-approves · dontAsk = auto-deny (explicit allows still work) · bypassPermissions = skip prompts entirely · plan = read-only exploration. If the parent session is already in bypassPermissions/acceptEdits/auto, this field is ignored and the parent's mode wins.",
    allowedValues: [
      'default',
      'acceptEdits',
      'auto',
      'dontAsk',
      'bypassPermissions',
      'plan',
      'manual',
    ],
  },
  {
    key: 'maxTurns',
    label: 'Max turns',
    datatype: 'int' as const,
    isCore: false,
    required: false,
    hint: 'Hard cap on agentic turns before the subagent is forced to stop and return whatever it has. Omit for unlimited.',
    allowedValues: null,
  },
  {
    // Open list — Claude Code skills are project/user/plugin-authored by name,
    // not drawn from a fixed catalog (unlike Managed Agents' 4 prebuilt IDs,
    // which don't apply here — see the file header note). Correctly modeled
    // as open already; unchanged by the #37-#40 refresh.
    key: 'skills',
    label: 'Skills',
    datatype: 'list' as const,
    isCore: false,
    required: false,
    hint: "Preloads the FULL content of these skills into the agent's context at startup, not just their one-line description. The agent can still invoke other, unlisted skills on demand via the Skill tool.",
    allowedValues: null,
  },
  {
    // #40 (2026-07-28), resolved 2026-07-31 (roadmap TODO item 2): real subagent files
    // may declare mcpServers entries as *inline nested objects* (a full MCP server
    // config: type/command/args/...), not just a flat list of server-name strings.
    // Previously blocked entirely on import (A3's old hard-reject) — now supported
    // end-to-end via datatype 'json': parseFrontmatter preserves the nested value
    // verbatim instead of rejecting it, and export emits real nested YAML instead of
    // a JSON.stringify'd scalar. Rendered as a raw-JSON block in the UI, same as hooks.
    key: 'mcpServers',
    label: 'MCP servers',
    datatype: 'json' as const,
    isCore: false,
    required: false,
    hint: 'String form reuses an MCP server already configured for this project/user. Inline object form defines a server scoped ONLY to this agent — connected at startup, disconnected when the agent finishes. Same schema as .mcp.json.',
    allowedValues: null,
  },
  {
    key: 'memory',
    label: 'Memory',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
    hint: "user → ~/.claude/agent-memory/<name>/ (shared across all your projects). project → .claude/agent-memory/<name>/ (checked into this repo's VCS). local → .claude/agent-memory-local/<name>/ (this project only, gitignored). When set, Read/Write/Edit are auto-enabled and MEMORY.md is auto-loaded.",
    allowedValues: ['user', 'project', 'local'],
  },
  {
    key: 'effort',
    label: 'Effort',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
    hint: '',  // shown in the model+effort header control, not in the config grid
    allowedValues: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    key: 'background',
    label: 'Background',
    datatype: 'bool' as const,
    isCore: false,
    required: false,
    hint: 'true forces this agent to always run as a non-blocking background task. false forces foreground (blocking) execution. Omit to let Claude decide per-invocation.',
    allowedValues: null,
  },
  {
    // #39 (2026-07-28), resolved 2026-07-31 (roadmap TODO item 2): fields present in
    // the real subagent frontmatter schema but never modeled here. hooks is a nested
    // object (PreToolUse/PostToolUse/Stop matchers) — datatype 'json' (a real general
    // mechanism, not the old 'any' placeholder): parseFrontmatter preserves the nested
    // value verbatim on import instead of rejecting it (A3's old hard-reject), and
    // export emits real nested YAML instead of a JSON.stringify'd scalar.
    key: 'hooks',
    label: 'Hooks',
    datatype: 'json' as const,
    isCore: false,
    required: false,
    hint: 'Supported events: PreToolUse, PostToolUse, Stop (auto-mapped to SubagentStop at runtime). Same schema as project-level hooks in settings.json. Receives JSON on stdin; exit code 0 = allow, 2 = block.',
    allowedValues: null,
  },
  {
    key: 'isolation',
    label: 'Isolation',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
    hint: "Runs this agent in a temporary git worktree (auto-cleaned up if it makes no changes) instead of the caller's checkout. Omit for normal in-place execution — the far more common case.",
    allowedValues: ['worktree'],
  },
  {
    key: 'color',
    label: 'Color',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
    hint: 'Cosmetic only — how this agent is color-tagged in the task list/transcript UI.',
    allowedValues: [
      'red',
      'blue',
      'green',
      'yellow',
      'purple',
      'orange',
      'pink',
      'cyan',
    ],
  },
  {
    key: 'initialPrompt',
    label: 'Initial prompt',
    datatype: 'string' as const,
    isCore: false,
    required: false,
    hint: 'Only used when this agent is run as the MAIN session agent (claude --agent <name>), auto-submitted as the first turn. Ignored when invoked as a subagent — the far more common case here.',
    allowedValues: null,
  },
] as const;

// Section catalog moved out entirely — see lib/db/sectionDefsSeed.ts (2026-08-07).

// Derive types for use in rules.ts
export type ConfigDefEntry = (typeof CONFIG_DEFS)[number];
export type PlatformDefEntry = (typeof PLATFORM_DEFS)[number];
