/**
 * scripts/cleanup-test-users.ts
 *
 * Dev/testing routine (added 2026-07-31, at the user's request): deletes every
 * user account except KEEP_EMAIL below, along with their agents, groups, and
 * OAuth links, and resets any invite codes they redeemed back to unredeemed —
 * so signup / Google-OAuth testing can be re-run from a clean slate without
 * hand-editing the real DB each time.
 *
 * Deliberately conservative:
 *   - Dry-run by default — prints what WOULD be deleted, changes nothing.
 *   - Requires --yes to actually execute.
 *   - Backs up myagent.db to myagent.db.bak-<timestamp> before any write,
 *     matching this project's standing practice for real-DB mutations
 *     (Plan 06 Phase 5's "file backup first" pass).
 *   - oauth_account rows for deleted users ARE removed — leaving one behind
 *     would dangling-link the next login attempt with that same Google
 *     identity (see the callback route's step 7 dangling-link guard).
 *   - llm_call_log, section_revision, and agent_snapshot rows are NEVER
 *     touched — all three are append-only/soft-ref audit trails by design
 *     (schema.ts: "log outlives row"), independent of which user or agent
 *     they reference.
 *
 * USAGE:
 *   npm run cleanup:test-users            # dry run — lists what would happen
 *   npm run cleanup:test-users -- --yes   # actually deletes
 *
 * Builds its own DB connection rather than importing lib/db/client.ts — see
 * scripts/bootstrap-user.ts's header for why (server-only guard).
 */

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, ne, inArray } from 'drizzle-orm';
import * as schema from '../lib/db/schema.js';

const KEEP_EMAIL = 'you@example.com';

function main() {
  const execute = process.argv.includes('--yes');

  const DB_PATH = path.join(process.cwd(), 'myagent.db');
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });

  const toDelete = db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(ne(schema.user.email, KEEP_EMAIL))
    .all();

  if (toDelete.length === 0) {
    console.log(`No users to clean up — only ${KEEP_EMAIL} exists.`);
    sqlite.close();
    return;
  }

  const userIds = toDelete.map((u) => u.id);

  const agents = db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(inArray(schema.agent.ownerId, userIds))
    .all();
  const groups = db
    .select({ id: schema.group.id })
    .from(schema.group)
    .where(inArray(schema.group.ownerId, userIds))
    .all();
  const oauthLinks = db
    .select({ provider: schema.oauthAccount.provider })
    .from(schema.oauthAccount)
    .where(inArray(schema.oauthAccount.userId, userIds))
    .all();
  const redeemedCodes = db
    .select({ code: schema.inviteCode.code })
    .from(schema.inviteCode)
    .where(inArray(schema.inviteCode.redeemedBy, userIds))
    .all();

  console.log(`${execute ? 'DELETING' : 'DRY RUN — would delete'}:`);
  for (const u of toDelete) console.log(`  user ${u.email} (${u.id})`);
  console.log(
    `  ${agents.length} agent(s), ${groups.length} group(s), ${oauthLinks.length} oauth link(s)`,
  );
  console.log(`  ${redeemedCodes.length} invite code(s) reset to unredeemed`);
  console.log('  (llm_call_log / section_revision / agent_snapshot rows are never touched)');

  if (!execute) {
    console.log('\nDry run only — pass --yes to actually execute.');
    sqlite.close();
    return;
  }

  const backupPath = `${DB_PATH}.bak-${Date.now()}`;
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`\nBackup written: ${backupPath}`);

  db.transaction((tx) => {
    if (agents.length > 0) {
      const agentIds = agents.map((a) => a.id);
      tx.delete(schema.agentConfig).where(inArray(schema.agentConfig.agentId, agentIds)).run();
      tx.delete(schema.agentSection).where(inArray(schema.agentSection.agentId, agentIds)).run();
      tx.delete(schema.membership).where(inArray(schema.membership.agentId, agentIds)).run();
      tx.delete(schema.agent).where(inArray(schema.agent.id, agentIds)).run();
    }

    if (groups.length > 0) {
      const groupIds = groups.map((g) => g.id);
      tx.delete(schema.membership).where(inArray(schema.membership.groupId, groupIds)).run();
      tx.delete(schema.group).where(inArray(schema.group.id, groupIds)).run();
    }

    tx.delete(schema.oauthAccount).where(inArray(schema.oauthAccount.userId, userIds)).run();

    for (const codeRow of redeemedCodes) {
      tx.update(schema.inviteCode)
        .set({ redeemedBy: null, redeemedAt: null })
        .where(eq(schema.inviteCode.code, codeRow.code))
        .run();
    }

    tx.delete(schema.user).where(inArray(schema.user.id, userIds)).run();
  });

  console.log(`Done — ${toDelete.length} user(s) removed, kept: ${KEEP_EMAIL}`);
  sqlite.close();
}

main();
