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
  exportAgentMarkdown,
  VersionConflictError,
} from './agents.js';

export type {
  AgentDTO,
  AgentLiteDTO,
  ConfigDefLite,
  SectionDefLite,
  ImportedAgentData,
} from './agents.js';

export { getConfigDefs, getSectionDefs, getConfigCatalog } from './catalog.js';
export type { ConfigDefRow, SectionDefRow } from './catalog.js';

export { createGroup, listGroups, deleteGroup, addMembership, removeMembership } from './groups.js';
export type { GroupDTO } from './groups.js';
