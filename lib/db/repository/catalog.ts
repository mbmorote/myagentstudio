/**
 * lib/db/repository/catalog.ts
 *
 * Read-only access to catalog tables (ConfigDef, SectionDef).
 * Used by blueprint validation and the UI for dropdown population.
 *
 * better-sqlite3 is synchronous; these functions return results directly.
 */

import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';
import type { ConfigDefLite, SectionDefLite } from './agents.js';

export function getConfigDefs() {
  return db.select().from(schema.configDef).orderBy(schema.configDef.id).all();
}

/**
 * Section catalog for one platform, in canonical order. This is the live source
 * for the LLM round-trip (the blueprint sent to Daedalus/Prometheus/Hermes, and
 * the heading→sectionKey mapping used to interpret Daedalus's response) — moved
 * off the static SECTION_DEFS array (now `lib/db/sectionDefsSeed.ts`) 2026-08-07, so an admin's
 * in-DB edit actually reaches the AI, not just the UI. `catalog.ts` still seeds
 * the first `platform: 'claude'` row (lib/db/seed.ts) but is no longer read by
 * anything downstream of that.
 */
export function getSectionDefs(platform: string = 'claude') {
  return db
    .select()
    .from(schema.sectionDef)
    .where(eq(schema.sectionDef.platform, platform))
    .orderBy(schema.sectionDef.defaultOrder)
    .all();
}

export type ConfigDefRow = ReturnType<typeof getConfigDefs>[number];
export type SectionDefRow = ReturnType<typeof getSectionDefs>[number];

/**
 * The full config catalog (all keys, not just ones set on a given agent), mapped to the
 * same ConfigDefLite shape AgentDTO.config[].def already uses. Added 2026-07-29 so
 * AgentView.tsx can source model/tools/permissionMode allowedValues, the "+" add-key menu,
 * and unknown-key detection from the DB (fresh on every page load) instead of a static
 * CONFIG_DEFS import. These rows are DB-owned and admin-editable — `catalog.ts`
 * only seeds a row the first time it's inserted (lib/db/seed.ts), it does not
 * overwrite an existing row on later reseeds.
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

/**
 * The full section catalog for one platform (all sections, not just ones present on a
 * given agent), mapped to the same SectionDefLite shape AgentDTO.sections[].def already
 * uses. Same purpose as getConfigCatalog() above — lets AgentView.tsx's "+ Add section"
 * menu (roadmap TODO item 1's non-chat half) list which catalog sections the agent
 * doesn't have yet, fresh from the DB on every page load.
 */
export function getSectionCatalog(platform: string = 'claude'): SectionDefLite[] {
  return getSectionDefs(platform).map((def) => ({
    key: def.key,
    defaultHeading: def.defaultHeading,
    isCore: def.isCore ?? false,
    defaultOrder: def.defaultOrder,
    template: def.template,
    helpText: def.helpText,
  }));
}
