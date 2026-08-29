/**
 * lib/auth/shareCode.ts
 *
 * Share-link code generation (Plan 15 — Share agent).
 *
 * A third point on the spectrum this codebase has already reasoned about twice:
 *   - inviteCode.ts stores plaintext with a human-readable alphabet because a human
 *     types it out of an email and the admin must be able to re-read and resend it.
 *   - apiToken.ts stores a SHA-256 hash because the plaintext must never be
 *     re-readable by anyone, including the owner.
 * A share code takes the STORAGE rule from the first (the owner must be able to
 * re-open the Access panel next week and copy the link again — that IS the
 * feature) and the ENTROPY rule from the second (it is machine-copied and pasted,
 * never hand-typed, so there is no reason to sacrifice a single bit for legibility).
 * Nothing else backs it — no expiry, no single-use, no email binding, no rate
 * limit (D4) — so 256 bits of entropy is the entire defense.
 *
 * Format: 'shr_' prefix + 43 base64url chars from 32 crypto.randomBytes — 47
 * characters total, byte-for-byte the shape generateApiToken() produces, minus
 * the hashing. The 'shr_' prefix is a courtesy to secret scanners and to a human
 * eyeballing a pasted string, not a security property (same as apiToken.ts's 'mya_').
 *
 * No 'server-only' guard and no secrets — pure computation, directly testable,
 * matching both siblings.
 */

import { randomBytes } from 'node:crypto';

const CODE_PREFIX = 'shr_';
/** Number of random bytes → 32 bytes → 43 base64url chars. */
const RANDOM_BYTES = 32;

/**
 * Generates a new share-link code: 'shr_' + 43 base64url chars, 47 total.
 * Stored plaintext (see module doc) — this IS the value written to
 * agent.publicCode, never a hash of it.
 */
export function generateShareCode(): string {
  const bytes = randomBytes(RANDOM_BYTES);
  const b64 = bytes.toString('base64url').slice(0, 43);
  return CODE_PREFIX + b64;
}
