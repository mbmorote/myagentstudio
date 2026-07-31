/**
 * lib/auth/oauth/types.ts
 *
 * The seam's vocabulary — types shared by the OAuth subsystem.
 * No dependency on any OAuth library (constraint 9, §2.2).
 *
 * Everything above the seam (`providers.ts`, route handlers, tests) depends
 * only on these types. `google.ts` is the only file that imports `arctic`.
 */

/**
 * A verified identity profile returned by `OAuthProvider.exchangeAndVerify()`.
 * All fields are guaranteed by the provider's id_token or user-info response.
 */
export type OAuthProfile = {
  providerAccountId: string;  // stable provider-side id (Google: `sub`)
  email: string;              // asserted by the provider
  emailVerified: boolean;     // real boolean — never coerced (§3.6)
};

/**
 * The provider contract. Implemented only by `google.ts` today.
 * All other code (route handlers, tests) depends on this interface,
 * never on arctic's classes directly.
 *
 * `exchangeAndVerify` is deliberately one method, not `exchange + verify`,
 * so a caller can never hold an unverified profile (§5.1).
 */
export type OAuthProvider = {
  readonly name: string;  // 'google'

  /**
   * Builds the provider's authorization URL for an OAuth 2.0 / OIDC flow
   * with PKCE and a nonce. Returns a URL object so the route handler can
   * inspect or extend it before handing it to the client.
   */
  createAuthorizationUrl(args: {
    state: string;
    codeVerifier: string;
    nonce: string;
  }): URL;

  /**
   * Exchanges the authorization code for tokens, verifies the id_token,
   * and returns a verified profile. Throws `OAuthError` on any failure —
   * network error, HTTP error, bad signature, wrong aud/iss, expired token,
   * nonce mismatch. No token is ever stored or returned (constraint 8).
   */
  exchangeAndVerify(args: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<OAuthProfile>;
};

/**
 * The OAuth transaction cookie payload (§3.5).
 *
 * Versioned with `v: 1` so `readOAuthTx()` can reject stale cookies if the
 * shape changes in a future plan. `provider` is also checked so a cookie
 * from a (hypothetical) GitHub flow can never satisfy a Google callback.
 */
export type OAuthTx = {
  v: 1;
  provider: string;
  mode: 'login' | 'signup';
  state: string;
  codeVerifier: string;
  nonce: string;
  inviteCode?: string;
  consent?: boolean;
  next?: string;
};

/**
 * Thrown by `exchangeAndVerify()` on any provider-side or verification failure.
 *
 * `code` is a short, safe-to-log identifier (e.g. `'token_exchange_failed'`).
 * `message` may contain provider text — log the code only, never the message
 * (§7.3, constraint 8).
 */
export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'OAuthError';
  }
}
