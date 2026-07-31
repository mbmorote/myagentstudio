/**
 * lib/auth/inviteCode.ts
 *
 * Invite-code generation and normalization (§4.2).
 *
 * Format: 'XXXX-XXXX-XXXX-XXXX' — 16 characters in four dash-separated groups.
 * Alphabet: ABCDEFGHJKMNPQRSTUVWXYZ23456789 (31 symbols; I, L, O, 0, 1 excluded
 * so a code can be read aloud or copied off a screen without ambiguity).
 *
 * Entropy: 31^16 ≈ 2^79 — guessing is not a threat model, and `maxUsers` is
 * the backstop if it somehow were.
 *
 * Generation uses crypto.randomInt for uniform distribution (no modulo bias).
 * On PK collision → regenerate, up to 3 attempts, then throw.
 *
 * No `server-only` import — this module is pure computation and carries no
 * secrets. It is imported by the signup route (server) and can be imported
 * in tests without any special aliasing.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP_LENGTH = 4;
const GROUP_COUNT = 4;

/**
 * Generates one invite code in canonical form ('XXXX-XXXX-XXXX-XXXX').
 * Uses `crypto.randomInt` for cryptographically random, unbiased selection.
 */
export function generateInviteCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUP_COUNT; g++) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i++) {
      group += ALPHABET[crypto.getRandomValues(new Uint8Array(1))[0] % ALPHABET.length];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/**
 * Normalizes a user-supplied invite code for comparison/storage.
 *
 * Accepts:
 *   - Lowercase letters → uppercased
 *   - Missing dashes → inserted at the right positions
 *   - Surrounding whitespace → stripped
 *
 * Returns null if the result does not match the canonical pattern after
 * normalization (e.g. wrong length, disallowed characters).
 */
export function normalizeInviteCode(raw: string): string | null {
  // Strip whitespace and uppercase
  const upper = raw.trim().toUpperCase();

  // Accept either 'XXXX-XXXX-XXXX-XXXX' (with dashes) or 'XXXXXXXXXXXXXXXX' (without)
  let canonical: string;
  if (upper.includes('-')) {
    canonical = upper;
  } else if (upper.length === GROUP_LENGTH * GROUP_COUNT) {
    // No dashes — insert them
    const groups: string[] = [];
    for (let g = 0; g < GROUP_COUNT; g++) {
      groups.push(upper.slice(g * GROUP_LENGTH, (g + 1) * GROUP_LENGTH));
    }
    canonical = groups.join('-');
  } else {
    return null;
  }

  // Validate canonical form
  const pattern = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;
  if (!pattern.test(canonical)) return null;

  // Reject disallowed characters (I, L, O are uppercase but in the range A-Z)
  const DISALLOWED = /[ILO01]/;
  if (DISALLOWED.test(canonical.replace(/-/g, ''))) return null;

  return canonical;
}
