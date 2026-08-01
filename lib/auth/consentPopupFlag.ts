/**
 * lib/auth/consentPopupFlag.ts
 *
 * Shared constants for the post-login "Activity log sharing" popup handoff.
 * Every new account is created with shareLogsWithAdmin: false; these flags tell
 * WorkbenchShell (on first load after signup) to offer the choice once, without
 * blocking account creation itself. Client-safe — no server-only imports.
 *
 * Two signup paths, two handoff mechanisms:
 *   - Password signup (SignupForm): a client-side redirect, so a sessionStorage
 *     flag survives the navigation to '/'.
 *   - Google signup (oauth callback route): a server-issued redirect, so the
 *     signal travels as a one-time query param on the destination URL instead.
 */

export const SIGNUP_CONSENT_FLAG_KEY = 'myagent_show_consent_popup';
export const NEW_ACCOUNT_QUERY_PARAM = 'newAccount';
