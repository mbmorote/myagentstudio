/**
 * lib/auth/apiToken.ts
 *
 * Personal Access Token generation and hashing (Plan 13, MCP access).
 *
 * Deliberately not reusing lib/auth/inviteCode.ts: an invite code is typed by
 * a human from an email, so it uses a human-readable alphabet and is stored
 * plaintext so the admin can re-read and resend it. An API token is copied by
 * machine and must never be re-readable — same shape of problem, opposite
 * requirements.
 *
 * Format: 'mya_' prefix + 43 chars of base64url from 32 cryptographic random
 * bytes. Total length: 47 characters. The 'mya_' prefix is a courtesy to
 * secret scanners and to a human eyeballing an env file — not a security property.
 *
 * Storage: SHA-256 of the full plaintext, hex-encoded. Not bcrypt:
 *   - A 256-bit random token is not guessable, so key stretching buys nothing
 *     (bcrypt exists to slow offline guessing of low-entropy human passwords).
 *   - Lookup is by hash as an index key — bcrypt can't do indexed lookup.
 *   - Bcrypt truncates at 72 bytes; the explicit length guard in password.ts
 *     works around this, but a fixed-length token avoids the issue entirely.
 *   - Cost matters: bearer auth runs on every tool call, where password
 *     verification runs once per login.
 *
 * No 'server-only' guard and no secrets — this module is pure computation,
 * matching inviteCode.ts's design; directly testable without any aliasing.
 */

import { createHash, randomBytes } from 'node:crypto';

const TOKEN_PREFIX = 'mya_';
/** Number of random bytes → 32 bytes → 43 base64url chars. */
const RANDOM_BYTES = 32;
/**
 * Display prefix length — first 12 chars of the full plaintext.
 * Short enough to be non-replayable (12 of 47 chars), long enough to
 * identify a token in the list without any ambiguity.
 */
const PREFIX_LENGTH = 12;

/** The result of generateApiToken(). */
export type GeneratedToken = {
  /** The full plaintext token — return exactly once, never store. */
  plaintext: string;
  /** SHA-256 hex of plaintext — the value stored in the database. */
  hash: string;
  /** First 12 chars of plaintext — stored for display, never sufficient to replay. */
  prefix: string;
};

/**
 * Generates a new API token. Returns plaintext, hash, and display prefix.
 *
 * The plaintext MUST be returned to the caller and shown to the user exactly
 * once — it is never re-readable from the database.
 */
export function generateApiToken(): GeneratedToken {
  // Generate 32 cryptographically random bytes → base64url → 43 chars
  const bytes = randomBytes(RANDOM_BYTES);
  const b64 = bytes.toString('base64url').slice(0, 43);
  const plaintext = TOKEN_PREFIX + b64;
  const hash = hashApiToken(plaintext);
  const prefix = plaintext.slice(0, PREFIX_LENGTH);

  return { plaintext, hash, prefix };
}

/**
 * Hashes a token plaintext to a SHA-256 hex string.
 * Deterministic — the same plaintext always produces the same hash.
 * Exported so the MCP guard can hash an incoming bearer value before lookup.
 */
export function hashApiToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}
