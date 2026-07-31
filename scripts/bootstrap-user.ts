/**
 * scripts/bootstrap-user.ts
 *
 * Sets the bootstrap admin's real email + password (§5.1). Idempotent, deliberately
 * manual — never runs on `predev`/`prebuild` (see §5.1's rationale for why this must
 * stay structurally separate from lib/db/seed.ts).
 *
 * USAGE:
 *   BOOTSTRAP_USER_EMAIL='you@example.com' BOOTSTRAP_USER_PASSWORD='...' npm run auth:bootstrap
 *   ... --force   (overwrite an already-set password)
 *
 * Never prints the password or the resulting hash.
 *
 * Builds its own DB connection rather than importing lib/db/client.ts (which carries
 * `import 'server-only'`, same as lib/auth/password.ts) — a plain `server-only` import
 * throws when loaded outside Next.js's bundler, so standalone scripts in this codebase
 * always construct their own connection instead of reusing that module (see lib/db/seed.ts
 * for the same pattern). Password-policy validation is duplicated here for the same reason.
 */

import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import * as schema from '../lib/db/schema.js';
import { BOOTSTRAP_USER_ID, BCRYPT_COST } from '../lib/auth/constants.js';

// Mirrors lib/auth/password.ts's §3.7 policy (duplicated — see file header).
const MIN_LENGTH = 12;
const MAX_BYTES = 72;

async function main() {
  const email = process.env.BOOTSTRAP_USER_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_USER_PASSWORD;
  const force = process.argv.includes('--force');

  if (!email) {
    console.error('BOOTSTRAP_USER_EMAIL is not set.');
    process.exit(1);
  }
  if (!password) {
    console.error('BOOTSTRAP_USER_PASSWORD is not set.');
    process.exit(1);
  }
  if (password.length < MIN_LENGTH) {
    console.error(`Password too short — minimum ${MIN_LENGTH} characters.`);
    process.exit(1);
  }
  if (new TextEncoder().encode(password).length > MAX_BYTES) {
    console.error(`Password too long — maximum ${MAX_BYTES} bytes (UTF-8).`);
    process.exit(1);
  }

  const DB_PATH = path.join(process.cwd(), 'myagent.db');
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const existing = db.select().from(schema.user).where(eq(schema.user.id, BOOTSTRAP_USER_ID)).get();

  if (existing) {
    if (!force && existing.passwordHash !== '') {
      console.error('bootstrap user already has a password; pass --force to overwrite');
      process.exit(1);
    }
    db.update(schema.user)
      .set({ email, passwordHash: hash })
      .where(eq(schema.user.id, BOOTSTRAP_USER_ID))
      .run();
  } else {
    db.insert(schema.user)
      .values({ id: BOOTSTRAP_USER_ID, email, passwordHash: hash, role: 'admin' })
      .run();
  }

  const result = db
    .select({ email: schema.user.email, role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, BOOTSTRAP_USER_ID))
    .get();

  console.log(`Bootstrap admin set: ${result?.email} (role: ${result?.role})`);
  sqlite.close();
}

main().catch((err) => {
  console.error('Bootstrap failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
