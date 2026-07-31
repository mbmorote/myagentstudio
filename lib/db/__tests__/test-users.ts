/**
 * lib/db/__tests__/test-users.ts
 *
 * Test helper: inserts a user row into the shared in-memory testDb and returns
 * the inserted values. Used by every suite that needs an ownerId.
 *
 * The consent parameter defaults to false, matching the production default and
 * the "consent is never implicit" invariant (§8 invariant 15).
 */

import { testDb } from './test-db.js';
import * as schema from '../schema.js';

let counter = 0;

/**
 * Creates a test user in the shared in-memory DB.
 * Each call uses a unique email so tests can be run concurrently or in sequence
 * without unique-constraint collisions.
 *
 * @param role Defaults to 'user'; pass 'admin' for admin-role tests.
 * @param shareLogsWithAdmin Defaults to false (production default).
 */
export function createTestUser(
  role: 'admin' | 'user' = 'user',
  shareLogsWithAdmin = false,
): { id: string; email: string; role: 'admin' | 'user'; shareLogsWithAdmin: boolean } {
  counter += 1;
  const id = crypto.randomUUID();
  const email = `test-user-${counter}@example.com`;

  testDb.insert(schema.user).values({
    id,
    email,
    passwordHash: '$2a$10$placeholder-hash-for-tests',
    role,
    shareLogsWithAdmin,
  }).run();

  return { id, email, role, shareLogsWithAdmin };
}
