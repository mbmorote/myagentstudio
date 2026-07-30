import 'server-only';

/**
 * lib/db/repository/settings.ts
 *
 * Raw string I/O for the `setting` table (§4.1, §10.3).
 * Typing and defaults live in lib/settings.ts (SETTING_DEFS + getLiveLlmCalls()).
 * This module has zero knowledge of setting semantics.
 *
 * Append-note: the `setting` table IS updated (upsert on PATCH); unlike the
 * append-only log tables, settings are deliberately mutable operator state.
 */

import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import * as schema from '../schema.js';

/**
 * Returns the raw string value for `key`, or null if the row does not exist.
 * A missing row is a valid, fully-supported state (§6 — fail-open default).
 */
export function getSetting(key: string): string | null {
  const row = db.select().from(schema.setting).where(eq(schema.setting.key, key)).get();
  return row?.value ?? null;
}

/**
 * Upserts a setting row. Returns the resulting row.
 */
export function setSetting(key: string, value: string): { key: string; value: string; updatedAt: Date } {
  db
    .insert(schema.setting)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.setting.key,
      set: { value, updatedAt: new Date() },
    })
    .run();

  const row = db.select().from(schema.setting).where(eq(schema.setting.key, key)).get();
  if (!row) throw new Error(`[settings] setSetting: row not found after upsert for key="${key}"`);
  return row;
}

/**
 * Returns all setting rows as a map from key → raw string value.
 * Keys with no row are absent from the result (callers apply defaults via SETTING_DEFS).
 */
export function getAllSettings(): { key: string; value: string; updatedAt: Date }[] {
  return db.select().from(schema.setting).all();
}
