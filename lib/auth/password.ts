import 'server-only';

/**
 * lib/auth/password.ts
 *
 * Password hashing, verification, and policy validation.
 * Node-only (`server-only`). Never imported from middleware.ts (Edge).
 *
 * Policy (§3.7):
 *   - Minimum 12 characters.
 *   - Maximum 72 bytes (UTF-8). bcryptjs silently truncates at 72 bytes, so a
 *     password longer than that would authenticate against its own first 72 bytes
 *     and two different long passwords could collide. We reject up front instead.
 *   - Cost 10 ≈ 100–300 ms in pure-JS bcryptjs.
 *
 * The sentinel value '' (empty string) means "no password set" (§3.7).
 * `verifyPassword` never calls bcrypt.compare against it and always returns false.
 * The login route enforces this too (§8 invariant 9), but the double-check here
 * ensures no caller can bypass it by calling verifyPassword directly.
 */

import bcrypt from 'bcryptjs';
import { BCRYPT_COST, NO_PASSWORD_SENTINEL } from './constants.js';

const MIN_LENGTH = 12;
const MAX_BYTES = 72;

export type PasswordPolicyError =
  | { ok: false; reason: 'weak_password'; minLength: number }
  | { ok: false; reason: 'password_too_long'; maxBytes: number };

/**
 * Validates a plaintext password against the §3.7 policy.
 * Returns `{ ok: true }` if it passes, or a typed error if it fails.
 */
export function validatePasswordPolicy(
  password: string,
): { ok: true } | PasswordPolicyError {
  if (password.length < MIN_LENGTH) {
    return { ok: false, reason: 'weak_password', minLength: MIN_LENGTH };
  }
  const byteLength = new TextEncoder().encode(password).length;
  if (byteLength > MAX_BYTES) {
    return { ok: false, reason: 'password_too_long', maxBytes: MAX_BYTES };
  }
  return { ok: true };
}

/**
 * Hashes a plaintext password with bcryptjs at the configured cost.
 * Async — must not be called inside a `db.transaction()` callback (constraint 5).
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Compares a plaintext password against a bcrypt hash.
 * Returns false if the hash is the sentinel (empty string).
 * Returns false on any error.
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  // Sentinel guard — must precede bcrypt.compare (§8 invariant 9).
  if (hash === NO_PASSWORD_SENTINEL) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
