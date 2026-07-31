/**
 * lib/db/seed.ts
 *
 * Self-healing upsert seed: writes ConfigDef + SectionDef rows from
 * lib/blueprint/catalog.ts.  Uses INSERT … ON CONFLICT DO UPDATE so that if
 * catalog.ts is ever edited after the first seed, the DB rows stay in sync on
 * the next `npm run db:seed` run — never silently stale (prerequisite fix,
 * decided before Phase 4 build).
 *
 * The catalog arrays in catalog.ts are the single source — no duplication here.
 *
 * Run via: npm run db:seed
 * Running twice is a no-op (upsert with identical values is idempotent, still safe).
 */

import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { CONFIG_DEFS, SECTION_DEFS } from '../blueprint/catalog.js';
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

  // ── ConfigDef rows — upsert so catalog edits heal the DB on next seed ────────
  for (const def of CONFIG_DEFS) {
    await db
      .insert(schema.configDef)
      .values({
        key: def.key,
        label: def.label,
        datatype: def.datatype,
        allowedValues: def.allowedValues as string[] | null,
        required: def.required,
        isCore: def.isCore,
        exportable: true,
        hint: def.hint,
      })
      .onConflictDoUpdate({
        target: schema.configDef.key,
        set: {
          label: def.label,
          datatype: def.datatype,
          allowedValues: def.allowedValues as string[] | null,
          required: def.required,
          isCore: def.isCore,
          exportable: true,
          hint: def.hint,
        },
      });
    console.log(`  ~ config_def: ${def.key} (upserted)`);
  }

  // ── SectionDef rows — upsert so catalog edits heal the DB on next seed ───────
  for (const def of SECTION_DEFS) {
    await db
      .insert(schema.sectionDef)
      .values({
        key: def.key,
        label: def.label,
        defaultHeading: def.defaultHeading,
        isCore: def.isCore,
        defaultOrder: def.defaultOrder,
        template: def.template,
        helpText: def.helpText,
      })
      .onConflictDoUpdate({
        target: schema.sectionDef.key,
        set: {
          label: def.label,
          defaultHeading: def.defaultHeading,
          isCore: def.isCore,
          defaultOrder: def.defaultOrder,
          template: def.template,
          helpText: def.helpText,
        },
      });
    console.log(`  ~ section_def: ${def.key} (upserted)`);
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

  console.log('Seed complete.');
  sqlite.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
