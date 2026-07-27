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

export function getConfigDefs() {
  return db.select().from(schema.configDef).orderBy(schema.configDef.id).all();
}

export function getSectionDefs() {
  return db.select().from(schema.sectionDef).orderBy(schema.sectionDef.defaultOrder).all();
}

export type ConfigDefRow = ReturnType<typeof getConfigDefs>[number];
export type SectionDefRow = ReturnType<typeof getSectionDefs>[number];
