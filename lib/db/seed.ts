/**
 * lib/db/seed.ts
 *
 * Bootstrap-only seed: writes ConfigDef + SectionDef rows from
 * lib/blueprint/catalog.ts for the 'claude' platform, but ONLY if a
 * (platform, key) row doesn't already exist (INSERT … ON CONFLICT DO NOTHING).
 *
 * These rows are DB-owned and admin-editable going forward (catalog platform
 * scoping, Rules Index #18) — catalog.ts is a first-run default, not a perpetual
 * mirror. A prior version of this file used ON CONFLICT DO UPDATE to force
 * catalog.ts to win on every `npm run dev`/`npm run build`; that's exactly what
 * would silently clobber an admin's in-DB catalog edits, so it's gone — same
 * "operator-owned, DoNothing" reasoning already used below for `setting`.
 *
 * Run via: npm run db:seed
 * Running twice is a no-op once rows exist.
 */

import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { CONFIG_DEFS } from '../blueprint/catalog.js';
import { SECTION_DEFS } from './sectionDefsSeed.js';
import * as schema from './schema.js';

const DB_PATH = path.join(process.cwd(), 'myagent.db');

async function seed() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // Run migrations first (idempotent — drizzle-kit tracks what's already applied)
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'lib/db/migrations') });

  console.log('Running seed...');

  // ── ConfigDef rows — bootstrap only, 'claude' platform. DB-owned after first
  // insert; an admin's in-DB edit is never clobbered by a later catalog.ts change. ──
  for (const def of CONFIG_DEFS) {
    await db
      .insert(schema.configDef)
      .values({
        platform: 'claude',
        key: def.key,
        label: def.label,
        datatype: def.datatype,
        allowedValues: def.allowedValues as string[] | null,
        required: def.required,
        isCore: def.isCore,
        exportable: true,
        hint: def.hint,
      })
      .onConflictDoNothing({
        target: [schema.configDef.platform, schema.configDef.key],
      });
    console.log(`  ~ config_def: claude/${def.key} (skip if exists)`);
  }

  // ── SectionDef rows — bootstrap only, 'claude' platform. Same reasoning. ───────
  for (const def of SECTION_DEFS) {
    await db
      .insert(schema.sectionDef)
      .values({
        platform: 'claude',
        key: def.key,
        defaultHeading: def.defaultHeading,
        isCore: def.isCore,
        defaultOrder: def.defaultOrder,
        template: def.template,
        helpText: def.helpText,
      })
      .onConflictDoNothing({
        target: [schema.sectionDef.platform, schema.sectionDef.key],
      });
    console.log(`  ~ section_def: claude/${def.key} (skip if exists)`);
  }

  // ── Setting rows — onConflictDoNothing (CRITICAL: opposite of catalog pattern) ─
  // configDef/sectionDef use onConflictDoUpdate because they are CODE-OWNED and
  // must heal from catalog.ts. `setting` is OPERATOR-OWNED runtime state.
  // Since npm run db:seed is wired into predev/prebuild, a DoUpdate here would
  // silently flip "Live LLM calls" back to on every single `npm run dev` —
  // a money-spending regression disguised as a seed.
  await db
    .insert(schema.setting)
    .values({ key: 'liveLlmCalls', value: 'true' })
    .onConflictDoNothing();
  console.log('  ~ setting: liveLlmCalls (skip if exists)');

  // maxUsers and maxLlmCallsPerUserPerHour — added by Plan 05 (§8 policy 18, §8 policy 24).
  // onConflictDoNothing is CRITICAL (Rules Index #47): these are admin-owned runtime values;
  // a DoUpdate would silently reset user-configured limits on every `npm run dev`.
  await db
    .insert(schema.setting)
    .values({ key: 'maxUsers', value: '5' })
    .onConflictDoNothing();
  console.log('  ~ setting: maxUsers (skip if exists)');

  await db
    .insert(schema.setting)
    .values({ key: 'maxLlmCallsPerUserPerHour', value: '15' })
    .onConflictDoNothing();
  console.log('  ~ setting: maxLlmCallsPerUserPerHour (skip if exists)');

  await db
    .insert(schema.setting)
    .values({ key: 'chatHistoryTurns', value: '10' })
    .onConflictDoNothing();
  console.log('  ~ setting: chatHistoryTurns (skip if exists)');

  console.log('Seed complete.');
  sqlite.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
