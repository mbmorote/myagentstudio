/**
 * app/api/auth/oauth/[provider]/callback/route.ts
 *
 * GET /api/auth/oauth/[provider]/callback — the OAuth 2.0 / OIDC return leg.
 *
 * This route handles the browser navigation that the identity provider redirects
 * back to after the user authenticates and consents. It is necessarily a GET
 * because the provider controls the redirect.
 *
 * Design invariants (§8):
 *   - The tx cookie is cleared on EVERY exit path (constraint 10, invariant 12).
 *     Implemented by routing every response through redirectTo(), which always
 *     calls clearOAuthTxOn(). There is no exit from this handler that does not
 *     clear it — a surviving tx cookie is a replayable authorization state.
 *   - Step 11 is the ONLY place in this handler where a session is issued.
 *     It is reached by all three outcomes (login / auto-link / create).
 *   - No token issued by Google is ever persisted, logged, or returned (invariant 5).
 *   - No invite code appears in any log line (constraint 13 / invariant 13).
 *   - Every failure produces a redirect to /login or /signup with a ?error=<code>
 *     from the closed vocabulary (§7.3, constraint 12). No JSON body, no stack trace,
 *     no provider message ever reaches the browser.
 *
 * Three outcomes (§3.7):
 *   1. Existing oauth_account row → login as that user
 *   2. No row, but user.email matches the verified email → auto-link then login
 *      (UNCONDITIONAL — no runtime toggle, no domain restriction — §5.3, §16.4/5)
 *   3. Neither → create only if mode==='signup' (constraint 6)
 *
 * All three converge at step 11 to issue the session.
 *
 * Non-functional: the token exchange (step 5) completes BEFORE any database
 * transaction opens (step 10). No transaction is held open across the network
 * call to Google (§9, Plan 04 rule).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOAuthProvider } from '@/lib/auth/oauth/providers';
import { readOAuthTx, clearOAuthTxOn } from '@/lib/auth/oauth/tx';
import { OAuthError } from '@/lib/auth/oauth/types';
import type { OAuthProfile } from '@/lib/auth/oauth/types';
import {
  getUserById,
  getUserByEmail,
  createUserWithInvite,
  type UserRow,
} from '@/lib/db/repository/users';
import { getOAuthAccount, linkOAuthAccount } from '@/lib/db/repository/oauthAccounts';
import { getMaxUsers } from '@/lib/settings';
import { signSessionToken } from '@/lib/auth/jwt';
import { SESSION_COOKIE, NO_PASSWORD_SENTINEL, getSessionTtlSeconds } from '@/lib/auth/constants';
import { NEW_ACCOUNT_QUERY_PARAM } from '@/lib/auth/consentPopupFlag';

type Params = { provider: string };

/**
 * Validates a `?next=` destination (Plan 05 §3.6).
 *
 * Returns the path only if it looks like a safe same-origin path starting with /
 * but not // (which would be a protocol-relative URL pointing off-site).
 * Returns null for anything else so the caller falls back to '/'.
 */
function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  return /^\/(?!\/)/.test(next) ? next : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> },
): Promise<NextResponse> {
  const { provider } = await params;
  const origin = new URL(request.url).origin;

  /**
   * Step 0: Every response goes through this helper, which ALWAYS clears the
   * tx cookie (constraint 10, invariant 12). A surviving tx cookie is replayable.
   *
   * `sessionToken` is only ever provided by step 11. All other call sites omit it,
   * which is how we ensure only one place in the handler issues a session.
   */
  function redirectTo(path: string, sessionToken?: string): NextResponse {
    const res = NextResponse.redirect(`${origin}${path}`, { status: 303 });
    clearOAuthTxOn(res); // ALWAYS — every exit path
    if (sessionToken) {
      // Step 11 is the only caller that provides a token
      res.cookies.set(SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: getSessionTtlSeconds(),
      });
    }
    return res;
  }

  // Step 1: Read and validate the tx cookie
  const tx = readOAuthTx(request, provider);
  if (!tx) {
    // Absent, malformed, wrong version, wrong provider — all treated identically
    // (§7.3: the distinction helps only someone probing)
    return redirectTo('/login?error=oauth_state');
  }

  // Step 2: Verify the provider is still in the registry (config could have changed)
  const oauthProvider = getOAuthProvider(provider);
  if (!oauthProvider) {
    return redirectTo('/login?error=oauth_failed');
  }

  // Step 3: Check for a provider-level error in the query string
  const searchParams = new URL(request.url).searchParams;
  const queryError = searchParams.get('error');
  if (queryError !== null) {
    if (queryError === 'access_denied') {
      // User clicked Cancel — routine, not logged
      return redirectTo('/login?error=oauth_cancelled');
    }
    // Any other provider error: log the code only, never the provider message body
    console.error(`[auth] oauth callback: provider error code=${queryError}`);
    return redirectTo('/login?error=oauth_failed');
  }

  // Step 4: State validation — checks CSRF and that a code is present
  const queryState = searchParams.get('state');
  const queryCode = searchParams.get('code');
  if (queryState !== tx.state || typeof queryCode !== 'string' || !queryCode) {
    console.warn('[auth] oauth state mismatch');
    return redirectTo('/login?error=oauth_state');
  }

  // Step 5: Exchange the code for a verified profile.
  //
  //   exchangeAndVerify is one atomic method — a caller can never hold an
  //   unverified profile (§5.1). It throws OAuthError on any failure.
  //
  //   IMPORTANT: this completes BEFORE any database transaction opens (§9).
  //   The exchange call is a network I/O; holding a db.transaction() across
  //   that call would pin a SQLite writer lock for hundreds of milliseconds.
  let profile: OAuthProfile;
  try {
    profile = await oauthProvider.exchangeAndVerify({
      code: queryCode,
      codeVerifier: tx.codeVerifier,
      nonce: tx.nonce,
    });
  } catch (e) {
    // Log the OAuthError CODE only — never the message (may contain provider body/token)
    const code = e instanceof OAuthError ? e.code : 'unknown';
    console.error(`[auth] oauth token exchange/verification failed code=${code}`);
    return redirectTo('/login?error=oauth_failed');
  }

  // Step 6: Require email_verified === true — the boolean, never a coerced value (§3.6)
  if (profile.emailVerified !== true) {
    console.warn('[auth] oauth: email_verified is not true');
    return redirectTo('/login?error=oauth_email_unverified');
  }
  // Normalize email: same normalization as signup (§4.1).
  // Invariant 9: a later sign-in never rewrites user.email from the provider.
  const email = profile.email.trim().toLowerCase();

  // Steps 7–10: Resolve to exactly one user row.
  // All three outcomes converge at step 11.
  let resolvedUser: UserRow | undefined;
  // True only for a genuinely new account (outcome 3, non-race path) — tells
  // step 11 to flag the redirect so WorkbenchShell offers the activity-log-sharing
  // popup once. Login (outcome 1) and auto-link (outcome 2) never set this.
  let isNewAccount = false;

  // Step 7: Existing oauth_account row → OUTCOME 1: login
  const existingLink = getOAuthAccount(provider, profile.providerAccountId);
  if (existingLink) {
    const foundUser = getUserById(existingLink.userId);
    if (!foundUser) {
      // The oauth_account row points at a deleted user — should not happen in practice
      console.error(
        `[auth] dangling oauth link provider=${provider} userId=${existingLink.userId}`,
      );
      return redirectTo('/login?error=oauth_failed');
    }
    resolvedUser = foundUser;
    // → fall through to step 11
  } else {
    // Step 8: Email match on an existing user → OUTCOME 2: auto-link
    const byEmail = getUserByEmail(email);
    if (byEmail) {
      //
      // Auto-link is UNCONDITIONAL (§5.3, §16.4).
      //   - No policy read, no runtime toggle, no domain restriction.
      //   - The ONLY precondition is step 6's emailVerified === true (invariant 10).
      //   - The residual Workspace-domain risk is reviewed and accepted (§3.7).
      //   - Reverting this is a code change, not a settings flip (no toggle exists).
      //
      let linkedUserId = byEmail.id;
      try {
        linkOAuthAccount({
          provider,
          providerAccountId: profile.providerAccountId,
          userId: byEmail.id,
          providerEmail: profile.email,
        });
      } catch {
        // Unique-constraint violation: a concurrent request already linked this identity.
        // Re-read the existing row and continue (§4.2 last paragraph).
        const raceRow = getOAuthAccount(provider, profile.providerAccountId);
        if (raceRow) {
          linkedUserId = raceRow.userId;
        } else {
          console.error(
            `[auth] oauth auto-link race: no row after constraint error provider=${provider}`,
          );
          return redirectTo('/login?error=oauth_failed');
        }
      }
      // Audit line for the accepted risk (§3.7 — must survive any log-noise cleanup)
      console.log(`[auth] oauth account auto-linked provider=${provider} userId=${linkedUserId}`);

      const linkedUser = getUserById(linkedUserId);
      if (!linkedUser) {
        console.error(
          `[auth] dangling oauth link after auto-link provider=${provider} userId=${linkedUserId}`,
        );
        return redirectTo('/login?error=oauth_failed');
      }
      resolvedUser = linkedUser;
      // → fall through to step 11
    } else {
      // Step 9: No existing link and no email match.
      //   Constraint 6: a login-mode flow must never silently create an account.
      //   The invite code and the consent answer are collected only on /signup.
      if (tx.mode !== 'signup' || typeof tx.inviteCode !== 'string') {
        return redirectTo('/signup?error=oauth_no_account');
      }

      // Step 10: Create via the one transactional signup primitive (§4.2).
      //   - Redeems the invite code and re-checks maxUsers inside one transaction.
      //   - passwordHash is the sentinel — this is an OAuth-only account (§3.8).
      //   - shareLogsWithAdmin: tx.consent === true  (invariant 14 — only literal true)
      //   - role: 'user' unconditionally — createUserWithInvite never mints an admin.
      const result = createUserWithInvite({
        email,
        passwordHash: NO_PASSWORD_SENTINEL,
        code: tx.inviteCode,
        maxUsers: getMaxUsers(),
        shareLogsWithAdmin: tx.consent === true,
        oauth: {
          provider,
          providerAccountId: profile.providerAccountId,
          providerEmail: profile.email,
        },
      });

      if (!result.ok) {
        if (result.reason === 'invalid_code') {
          console.warn('[auth] oauth signup: invite code invalid or already redeemed');
          return redirectTo('/signup?error=invalid_invite_code');
        }
        if (result.reason === 'cap_reached') {
          console.warn('[auth] oauth signup: signups closed (maxUsers reached)');
          return redirectTo('/signup?error=signups_closed');
        }
        if (result.reason === 'email_exists') {
          // Lost a race with step 8 — treat as a generic failure (log it for debugging)
          console.error('[auth] oauth signup: email_exists — lost race with auto-link step');
          return redirectTo('/login?error=oauth_failed');
        }
        // result.reason === 'oauth_account_exists' — lost a race with step 7.
        // Re-read the now-existing link and log that user in.
        const raceLink = getOAuthAccount(provider, profile.providerAccountId);
        if (raceLink) {
          const raceUser = getUserById(raceLink.userId);
          if (raceUser) {
            resolvedUser = raceUser;
            // fall through to step 11
          } else {
            console.error(
              '[auth] dangling oauth link after signup race provider=' + provider,
            );
            return redirectTo('/login?error=oauth_failed');
          }
        } else {
          console.error(
            '[auth] oauth signup race: no oauth_account found after oauth_account_exists provider=' + provider,
          );
          return redirectTo('/login?error=oauth_failed');
        }
      } else {
        resolvedUser = result.user;
        isNewAccount = true;
        // → fall through to step 11
      }
    }
  }

  // Step 11: Issue session.
  //
  //   THE ONLY PLACE in the OAuth flow where a session is issued.
  //   All three outcomes (login / auto-link / create) converge here.
  //   There is no early Set-Cookie: myagent_session anywhere above.
  //
  //   A Set-Cookie on a 303 responding to a cross-site top-level navigation is
  //   delivered normally for a SameSite=Lax cookie — Lax restricts *sending*
  //   on cross-site subrequests, not *setting* on a top-level GET. (§6, last note)
  if (!resolvedUser) {
    // Defensive: should not be reachable; all paths above either assign or return.
    console.error('[auth] oauth callback: resolvedUser is undefined at step 11 (bug)');
    return redirectTo('/login?error=oauth_failed');
  }

  const token = await signSessionToken({ sub: resolvedUser.id, email: resolvedUser.email });
  const dest = safeNext(tx.next) ?? '/';
  // New-account flag rides as a one-time query param — this redirect is server-issued,
  // so it cannot use the sessionStorage handoff the password-signup path uses.
  // WorkbenchShell reads it once on mount and strips it via history.replaceState.
  const finalDest = isNewAccount
    ? `${dest}${dest.includes('?') ? '&' : '?'}${NEW_ACCOUNT_QUERY_PARAM}=1`
    : dest;

  return redirectTo(finalDest, token);
}
