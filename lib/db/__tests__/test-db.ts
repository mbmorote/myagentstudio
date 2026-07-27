/**
 * lib/db/__tests__/test-db.ts
 *
 * In-memory SQLite DB instance for repository tests.
 * Shared via ES module cache — both vi.mock() factory and test bodies import
 * the same instance, so direct DB queries in tests see exactly what the
 * repository wrote.
 *
 * This module is NOT imported in production code.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const testDb = drizzle(sqlite, { schema });

// Run migrations eagerly so the schema exists before any test uses this module.
migrate(testDb, { migrationsFolder: MIGRATIONS_DIR });
