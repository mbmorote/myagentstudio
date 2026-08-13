/**
 * lib/auth/__tests__/consentPopupFlag.test.ts
 *
 * consentPopupFlag.ts is just two shared string constants — the actual
 * popup-gating logic that reads/writes them lives in WorkbenchShell.tsx /
 * ConsentPopup.tsx / SignupForm.tsx (deferred, see the app/components TODO
 * item). The only real invariant at this layer: the two keys must be stable
 * and distinct — they back two different storage mechanisms (sessionStorage
 * vs. a URL query param) for the two signup paths (password vs. Google), and
 * accidentally colliding them would silently break one path's handoff.
 */

import { describe, expect, it } from 'vitest';
import { SIGNUP_CONSENT_FLAG_KEY, NEW_ACCOUNT_QUERY_PARAM } from '../consentPopupFlag.js';

describe('consentPopupFlag constants', () => {
  it('are non-empty strings', () => {
    expect(typeof SIGNUP_CONSENT_FLAG_KEY).toBe('string');
    expect(SIGNUP_CONSENT_FLAG_KEY.length).toBeGreaterThan(0);
    expect(typeof NEW_ACCOUNT_QUERY_PARAM).toBe('string');
    expect(NEW_ACCOUNT_QUERY_PARAM.length).toBeGreaterThan(0);
  });

  it('are distinct from each other (they back two different handoff mechanisms)', () => {
    expect(SIGNUP_CONSENT_FLAG_KEY).not.toBe(NEW_ACCOUNT_QUERY_PARAM);
  });

  it('the query param is URL-safe (no spaces or reserved characters)', () => {
    expect(NEW_ACCOUNT_QUERY_PARAM).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
