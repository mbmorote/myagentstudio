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

/** JWT lifetime in seconds — 7 days. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** bcryptjs work factor (cost 10 ≈ 100–300 ms in pure JS). */
export const BCRYPT_COST = 10;

/**
 * Sentinel value meaning "no password set".
 * The bootstrap row is created by SQL (which cannot bcrypt-hash), so it
 * starts with this empty string. Login explicitly rejects it before ever
 * calling bcrypt.compare (§3.7, §8 invariant 9).
 */
export const NO_PASSWORD_SENTINEL = '';
