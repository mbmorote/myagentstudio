/**
 * lib/db/repository/catalog.ts
 *
 * Read-only access to catalog tables (ConfigDef, SectionDef).
 * Used by blueprint validation and the UI for dropdown population.
 *
 * better-sqlite3 is synchronous; these functions return results directly.
 */

import { db } from '../client.js';
import * as schema from '../schema.js';
import type { ConfigDefLite } from './agents.js';

export function getConfigDefs() {
  return db.select().from(schema.configDef).orderBy(schema.configDef.id).all();
}

export function getSectionDefs() {
  return db.select().from(schema.sectionDef).orderBy(schema.sectionDef.defaultOrder).all();
}

export type ConfigDefRow = ReturnType<typeof getConfigDefs>[number];
export type SectionDefRow = ReturnType<typeof getSectionDefs>[number];

/**
 * The full config catalog (all keys, not just ones set on a given agent), mapped to the
 * same ConfigDefLite shape AgentDTO.config[].def already uses. Added 2026-07-29 so
 * AgentView.tsx can source model/tools/permissionMode allowedValues, the "+" add-key menu,
 * and unknown-key detection from the DB (fresh on every page load) instead of a static
 * CONFIG_DEFS import — a catalog.ts edit + `npm run db:seed` + page reload is then enough
 * to update the UI, no rebuild/redeploy needed.
 */
export function getConfigCatalog(): ConfigDefLite[] {
  return getConfigDefs().map((def) => ({
    key: def.key,
    label: def.label,
    datatype: def.datatype,
    allowedValues: def.allowedValues as string[] | null,
    required: def.required ?? false,
    isCore: def.isCore ?? false,
    exportable: def.exportable ?? true,
    hint: def.hint ?? null,
  }));
}
