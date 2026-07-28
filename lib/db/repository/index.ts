/**
 * lib/db/repository/index.ts
 *
 * Barrel — the ONLY DB import surface for anything outside lib/db.
 * Routes, server components, and other lib/ modules import from here.
 * (Rules Index #8a.)
 */

export {
  createAgent,
  getAgentFull,
  getAgentSnapshotInfo,
  listAgents,
  updateSectionContent,
  updateAgent,
  upsertAgentFromImport,
  deleteAgent,
  VersionConflictError,
} from './agents.js';

export type {
  AgentDTO,
  ConfigDefLite,
  SectionDefLite,
  ImportedAgentData,
} from './agents.js';

export { getConfigDefs, getSectionDefs } from './catalog.js';
export type { ConfigDefRow, SectionDefRow } from './catalog.js';
