/**
 * lib/blueprint/catalog.ts
 *
 * In-code seed source for ConfigDef + SectionDef as plain typed arrays.
 * This is the single enumeration both the DB seed (Phase 2) and the Blueprint
 * rules read — no duplication anywhere else.
 *
 * Arrays are verbatim from §4 of Plan 01.
 */

// ─────────────────────────────  Platform catalog  ─────────────────────────────
// Not a DB table — agent.platform's allowed-values catalog.

export const PLATFORM_DEFS = [
  { key: 'claude', label: 'Claude' },
] as const;

// ─────────────────────────────  Config catalog  ────────────────────────────────

export const CONFIG_DEFS = [
  {
    key: 'model',
    label: 'Model',
    datatype: 'enum' as const,
    isCore: true,
    required: false,
    allowedValues: [
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-haiku-4-5-20251001',
      'claude-fable-5',
      'inherit',
    ],
  },
  {
    key: 'tools',
    label: 'Tools',
    datatype: 'list' as const,
    isCore: true,
    required: false,
    allowedValues: [
      'Read',
      'Write',
      'Edit',
      'Create',
      'Bash',
      'Grep',
      'Glob',
      'WebFetch',
      'WebSearch',
      'Task',
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
    key: 'permissionMode',
    label: 'Permission mode',
    datatype: 'enum' as const,
    isCore: false,
    required: false,
    allowedValues: ['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan'],
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
    key: 'skills',
    label: 'Skills',
    datatype: 'list' as const,
    isCore: false,
    required: false,
    allowedValues: null,
  },
  {
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
