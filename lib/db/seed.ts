/**
 * lib/db/seed.ts
 *
 * Idempotent seed: writes ConfigDef + SectionDef rows from lib/blueprint/catalog.ts.
 * The catalog arrays in catalog.ts are the single source — no duplication here.
 *
 * Run via: npm run db:seed
 * Running twice is a no-op (no duplicate rows, no error on collision).
 */

import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
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

  // ── ConfigDef rows ──────────────────────────────────────────────────────────
  for (const def of CONFIG_DEFS) {
    const existing = await db
      .select({ id: schema.configDef.id })
      .from(schema.configDef)
      .where(eq(schema.configDef.key, def.key));

    if (existing.length === 0) {
      await db.insert(schema.configDef).values({
        key: def.key,
        label: def.label,
        datatype: def.datatype,
        allowedValues: def.allowedValues as string[] | null,
        required: def.required,
        isCore: def.isCore,
        exportable: true,
      });
      console.log(`  + config_def: ${def.key}`);
    } else {
      console.log(`  = config_def: ${def.key} (already exists)`);
    }
  }

  // ── SectionDef rows ─────────────────────────────────────────────────────────
  for (const def of SECTION_DEFS) {
    const existing = await db
      .select({ id: schema.sectionDef.id })
      .from(schema.sectionDef)
      .where(eq(schema.sectionDef.key, def.key));

    if (existing.length === 0) {
      await db.insert(schema.sectionDef).values({
        key: def.key,
        label: def.label,
        defaultHeading: def.defaultHeading,
        isCore: def.isCore,
        defaultOrder: def.defaultOrder,
        template: def.template,
        helpText: def.helpText,
      });
      console.log(`  + section_def: ${def.key}`);
    } else {
      console.log(`  = section_def: ${def.key} (already exists)`);
    }
  }

  console.log('Seed complete.');
  sqlite.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
