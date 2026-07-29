/**
 * lib/blueprint/catalog.ts
 *
 * In-code seed source for ConfigDef + SectionDef as plain typed arrays.
 * This is the single enumeration both the DB seed (Phase 2) and the Blueprint
 * rules read — no duplication anywhere else.
 *
 * Arrays are verbatim from §4 of Plan 01, refreshed 2026-07-28 against the real
 * Claude Code subagent frontmatter schema (code.claude.com/docs/en/sub-agents,
 * .../tools-reference) — see TechDesign.md Rules Index #37-#40. This is the
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
    // for now" — Rules Index #19 originally locked full-IDs-only; superseded).
    key: 'model',
    label: 'Model',
    datatype: 'enum' as const,
    isCore: true,
    required: false,
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
    allowedValues: null,
  },
  {
    // 'manual' added #38 — documented alias for 'default' (Claude Code v2.1.200+).
    key: 'permissionMode',
    label: 'Permission mode',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
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
    allowedValues: null,
  },
  {
    // #40 (2026-07-28): real subagent files may declare mcpServers entries as
    // *inline nested objects* (a full MCP server config: type/command/args/...),
    // not just a flat list of server-name strings — confirmed against the real
    // schema, no longer a hypothetical. lib/serialize/parseFrontmatter.ts (A3)
    // currently rejects a nested map with a loud 400 (unsupported_frontmatter)
    // rather than silently destroying it — correct per A3's stated limitation,
    // but this means importing a real file with an inline mcpServers definition
    // fails loudly today. Deferred until the __raw escape hatch exists (Plan 02
    // Phase D); tracked here since it's now a confirmed-real gap, not spectulative.
    key: 'mcpServers',
    label: 'MCP servers',
    datatype: 'list' as const,
    isCore: false,
    required: false,
    allowedValues: null,
  },
  {
    key: 'memory',
    label: 'Memory',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
    allowedValues: ['user', 'project', 'local'],
  },
  {
    key: 'effort',
    label: 'Effort',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
    allowedValues: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    key: 'background',
    label: 'Background',
    datatype: 'bool' as const,
    isCore: false,
    required: false,
    allowedValues: null,
  },
  {
    // #39 (2026-07-28): fields present in the real subagent frontmatter schema
    // but never modeled here. hooks is a nested object (PreToolUse/PostToolUse/
    // Stop matchers) — datatype 'any' since it doesn't fit string/enum/int/bool/
    // list, and it will hit A3's unsupported_frontmatter guard on import today
    // (same nested-object limitation as mcpServers, #40) until __raw exists.
    key: 'hooks',
    label: 'Hooks',
    datatype: 'any' as const,
    isCore: false,
    required: false,
    allowedValues: null,
  },
  {
    key: 'isolation',
    label: 'Isolation',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
    allowedValues: ['worktree'],
  },
  {
    key: 'color',
    label: 'Color',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
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
    allowedValues: null,
  },
] as const;

// ─────────────────────────────  Section catalog  ───────────────────────────────

export const SECTION_DEFS = [
  {
    key: 'role',
    label: 'Role',
    defaultHeading: '# ROLE',
    isCore: true,
    defaultOrder: 1,
    template: 'You are a [senior X] specializing in:\n- …\n\nYour job is to …',
    helpText:
      'Identity + mandate. Open with "You are…". End with a STOP clause if the agent must refuse ambiguous input.',
  },
  {
    key: 'behavior',
    label: 'Behavior',
    defaultHeading: '# BEHAVIOR',
    isCore: true,
    defaultOrder: 2,
    template: '1. …\n2. …\n3. …',
    helpText:
      'How it works — the numbered process. (This is the section that has 6 different names across real libraries; the tool standardizes it.)',
  },
  {
    key: 'guardrails',
    label: 'Guardrails',
    defaultHeading: '# RULES',
    isCore: true,
    defaultOrder: 3,
    template: '- Never …\n- Always …',
    helpText: 'Hard rules / what it must not do.',
  },
  {
    key: 'output',
    label: 'Output',
    defaultHeading: '# OUTPUT FORMAT',
    isCore: true,
    defaultOrder: 4,
    template: '| Section | Format |\n|---|---|\n| … | … |',
    helpText: 'The shape of what the agent returns.',
  },
  {
    key: 'sources',
    label: 'Sources',
    defaultHeading: '# SOURCES',
    isCore: false,
    defaultOrder: 5,
    template: '',
    helpText: 'Files/inputs it reads.',
  },
  {
    key: 'lifecycle',
    label: 'Lifecycle',
    defaultHeading: '# LIFECYCLE',
    isCore: false,
    defaultOrder: 6,
    template: '',
    helpText: 'Start/end-of-session duties (read memory / write report).',
  },
  {
    key: 'handoffs',
    label: 'Handoffs',
    defaultHeading: '# HANDOFFS',
    isCore: false,
    defaultOrder: 7,
    template: '',
    helpText: 'Relationships to other agents.',
  },
  {
    key: 'tone',
    label: 'Tone',
    defaultHeading: '# TONE',
    isCore: false,
    defaultOrder: 8,
    template: '',
    helpText: 'Voice.',
  },
  {
    key: 'modes',
    label: 'Modes',
    defaultHeading: '# MODES',
    isCore: false,
    defaultOrder: 9,
    template: '',
    helpText: 'Sub-modes (e.g. dev Mode A/B, session modes).',
  },
] as const;

// Derive types for use in rules.ts
export type ConfigDefEntry = (typeof CONFIG_DEFS)[number];
export type SectionDefEntry = (typeof SECTION_DEFS)[number];
export type PlatformDefEntry = (typeof PLATFORM_DEFS)[number];
