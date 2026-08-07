/**
 * lib/db/sectionDefsSeed.ts
 *
 * Bootstrap-only default section catalog for the 'claude' platform — the first-run
 * values lib/db/seed.ts inserts into section_def (Rules Index #18). Not read by the
 * live LLM round-trip: getSectionDefs(platform) (lib/db/repository/catalog.ts) is
 * the actual live source for the blueprint sent to Daedalus/Prometheus/Hermes and
 * the heading→sectionKey matcher — see lib/blueprint/prompt.ts and
 * lib/import/assembleStructural.ts. This array only matters once, the first time a
 * fresh DB is seeded; after that, the DB rows are the source of truth and this
 * array is never consulted again for that row.
 *
 * Moved out of lib/blueprint/catalog.ts (which stayed the live source for
 * CONFIG_DEFS) 2026-08-07 — this data's only real consumer is the seed, so it
 * lives next to it rather than in a file whose whole point is being read live.
 *
 * No `label` field (removed the same day, same commit) — defaultHeading is now
 * the single name for a section, display text included. `guardrails` corrected
 * to '# GUARDRAILS' at the same time (was '# RULES' — the value that motivated
 * removing the separate label field in the first place: nothing ever checked it
 * against the label 'Guardrails' it disagreed with).
 */

export const SECTION_DEFS = [
  {
    key: 'role',
    defaultHeading: '# ROLE',
    isCore: true,
    defaultOrder: 1,
    template: 'You are a [senior X] specializing in:\n- …\n\nYour job is to …',
    helpText:
      'Identity + mandate. Open with "You are…". End with a STOP clause if the agent must refuse ambiguous input.',
  },
  {
    key: 'behavior',
    defaultHeading: '# BEHAVIOR',
    isCore: true,
    defaultOrder: 2,
    template: '1. …\n2. …\n3. …',
    helpText:
      'How it works — the numbered process. (This is the section that has 6 different names across real libraries; the tool standardizes it.)',
  },
  {
    key: 'guardrails',
    defaultHeading: '# GUARDRAILS',
    isCore: true,
    defaultOrder: 3,
    template: '- Never …\n- Always …',
    helpText: 'Hard rules / what it must not do.',
  },
  {
    key: 'output',
    defaultHeading: '# OUTPUT FORMAT',
    isCore: true,
    defaultOrder: 4,
    template: '| Section | Format |\n|---|---|\n| … | … |',
    helpText: 'The shape of what the agent returns.',
  },
  {
    key: 'sources',
    defaultHeading: '# SOURCES',
    isCore: false,
    defaultOrder: 5,
    template: '',
    helpText: 'Files/inputs it reads.',
  },
  {
    key: 'lifecycle',
    defaultHeading: '# LIFECYCLE',
    isCore: false,
    defaultOrder: 6,
    template: '',
    helpText: 'Start/end-of-session duties (read memory / write report).',
  },
  {
    key: 'handoffs',
    defaultHeading: '# HANDOFFS',
    isCore: false,
    defaultOrder: 7,
    template: '',
    helpText: 'Relationships to other agents.',
  },
  {
    key: 'tone',
    defaultHeading: '# TONE',
    isCore: false,
    defaultOrder: 8,
    template: '',
    helpText: 'Voice.',
  },
  {
    key: 'modes',
    defaultHeading: '# MODES',
    isCore: false,
    defaultOrder: 9,
    template: '',
    helpText: 'Sub-modes (e.g. dev Mode A/B, session modes).',
  },
  {
    key: 'boundaries',
    defaultHeading: '# BOUNDARIES',
    isCore: false,
    defaultOrder: 10,
    template: '- Do not assume …\n- Do not infer …\n- Do not guess …',
    helpText:
      'What the agent must not assume, infer, or guess when context is incomplete (e.g. missing config, deployment intent, credentials, file paths) — distinct from Guardrails, which covers actions it must not take.',
  },
] as const;

export type SectionDefEntry = (typeof SECTION_DEFS)[number];
