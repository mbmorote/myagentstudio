/**
 * lib/auth/constants.ts
 *
 * Shared auth constants. No imports — this file is the dependency root of
 * the auth subsystem so it cannot create a circular dep.
 */

/**
 * Fixed id for the bootstrap admin row created by the migration.
 * Used as the scaffold ownerId in Phase-0 routes and as the initial
 * admin id created by the migration's conditional INSERT.
 */
export const BOOTSTRAP_USER_ID = '00000000-0000-4000-8000-00000000b007';

/** HttpOnly session cookie name. */
export const SESSION_COOKIE = 'myagent_session';

/** Default JWT / cookie lifetime — 7 days, in seconds. */
export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Minimum allowed SESSION_TTL_SECONDS. Below this is a misconfiguration. */
export const MIN_SESSION_TTL_SECONDS = 60;

/** Maximum allowed SESSION_TTL_SECONDS. Beyond this "it expires" is meaningless. */
export const MAX_SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Returns the session lifetime in seconds, read from SESSION_TTL_SECONDS env var.
 *
 * - Unset or empty → DEFAULT_SESSION_TTL_SECONDS (7 days). No warning — this is the
 *   normal case for every existing .env.local that pre-dates Plan 06.
 * - Set to a valid integer in [MIN, MAX] → that integer.
 * - Any other value → throws at call-time so an invalid value prevents boot
 *   (constraint 4, §3.2). Never silently falls back to the default.
 *
 * Called once per session issuance (JWT sign + cookie maxAge in the same request),
 * and once at boot via assertServerEnv(). Not cached — caching would make a restart
 * required for correctness in a way nothing announces (§9).
 */
export function getSessionTtlSeconds(): number {
  const raw = process.env.SESSION_TTL_SECONDS;
  if (raw === undefined || raw === '') return DEFAULT_SESSION_TTL_SECONDS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_SESSION_TTL_SECONDS || n > MAX_SESSION_TTL_SECONDS) {
    throw new Error(
      `SESSION_TTL_SECONDS must be an integer between ${MIN_SESSION_TTL_SECONDS} and ` +
      `${MAX_SESSION_TTL_SECONDS} seconds (got: ${raw}).`,
    );
  }
  return n;
}

/** bcryptjs work factor (cost 10 ≈ 100–300 ms in pure JS). */
export const BCRYPT_COST = 10;

/**
 * Sentinel value meaning "no password set".
 * The bootstrap row is created by SQL (which cannot bcrypt-hash), so it
 * starts with this empty string. Login explicitly rejects it before ever
 * calling bcrypt.compare (§3.7, §8 invariant 9).
 */
export const NO_PASSWORD_SENTINEL = '';
