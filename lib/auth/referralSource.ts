/**
 * lib/auth/referralSource.ts
 *
 * Shared "how did you hear about us?" options for the access-request form
 * (Plan 12, 2026-08-14). Client-safe — no server-only imports — so SignupForm.tsx can
 * import it directly for the dropdown, and the API route can import it for validation,
 * without either side hand-duplicating the list.
 */

export const REFERRAL_SOURCES = ['linkedin', 'thread', 'github', 'friend', 'other'] as const;

export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

export const REFERRAL_SOURCE_LABELS: Record<ReferralSource, string> = {
  linkedin: 'LinkedIn',
  thread: 'A thread/post online',
  github: 'GitHub',
  friend: 'A friend',
  other: 'Other',
};

export function isReferralSource(value: unknown): value is ReferralSource {
  return typeof value === 'string' && (REFERRAL_SOURCES as readonly string[]).includes(value);
}
