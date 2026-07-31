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
  SectionNotFoundError,
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

export { getSetting, setSetting, getAllSettings } from './settings.js';

export { writeCallLog, listCallLogs, getCallLog, countLlmCallsInWindow } from './llmCallLog.js';
export type {
  LlmCallKind,
  WriteCallLogInput,
  CallLogListItem,
  CallLogFull,
  ListCallLogsOptions,
} from './llmCallLog.js';

export {
  getUserById,
  getUserByEmail,
  getUserCount,
  getUserPolicy,
  setUserPassword,
  setUserLogSharing,
  createUserWithInvite,
  createInviteCode,
  listInviteCodes,
  revokeInviteCode,
} from './users.js';
export type {
  UserRow,
  UserPolicy,
  InviteCodeRow,
  CreateUserWithInviteInput,
  CreateUserWithInviteResult,
} from './users.js';
