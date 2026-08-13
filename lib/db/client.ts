/**
 * lib/db/client.ts
 *
 * better-sqlite3 + drizzle() singleton. Server-only — the DB is never touched
 * in a client bundle.
 *
 * The database file path is resolved relative to the project root so the
 * singleton works regardless of cwd during tests.
 */

import 'server-only';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const DB_PATH = path.join(process.cwd(), 'myagent.db');

const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL');
// Enforce foreign key constraints at the SQLite level
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export type Db = typeof db;
