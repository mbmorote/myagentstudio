import 'server-only';
import { getSessionTtlSeconds } from './auth/constants.js';

// ── OAuth configuration ────────────────────────────────────────────────────────

/**
 * The resolved OAuth configuration for Google sign-in.
 * All three fields are present — callers must first check `isOAuthConfigured()`.
 */
export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectBaseUrl: string;
};

/**
 * Returns true when all three OAuth env vars are set (§3.4).
 *
 * Used by `providers.ts` to gate the registry and by server components to
 * decide whether to render the "Continue with Google" button.
 */
export function isOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.OAUTH_REDIRECT_BASE_URL,
  );
}

/**
 * Returns the full OAuth configuration. Throws if OAuth is not configured.
 *
 * Callers that handle the unconfigured case gracefully should call
 * `isOAuthConfigured()` first. Route handlers that only reach this after
 * checking can call it directly.
 */
export function getOAuthConfig(): OAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectBaseUrl = process.env.OAUTH_REDIRECT_BASE_URL;

  if (!clientId || !clientSecret || !redirectBaseUrl) {
    throw new Error(
      'OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and ' +
      'OAUTH_REDIRECT_BASE_URL, or none of them (§3.4).',
    );
  }

  return { clientId, clientSecret, redirectBaseUrl };
}

/**
 * Returns true when ANTHROPIC_API_KEY is set in the environment.
 *
 * Use this to check whether the Anthropic provider is configured before
 * calling getAnthropicApiKey(), which throws if the key is absent.
 * assertServerEnv() deliberately does NOT require this at boot — a
 * deployment in dry-run mode has no key by design (Plan 04).
 */
export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Returns the Anthropic API key from environment.
 * Throws at call-time if the variable is unset.
 *
 * `import 'server-only'` at the top of this module causes Next.js to raise a
 * build error if any client bundle (a "use client" component tree) imports this
 * file — keeping the key out of client bundles by construction.
 */
export function getAnthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.',
    );
  }
  return key;
}

/**
 * Returns the configured Anthropic model ID, defaulting to claude-opus-4-8.
 */
export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
}

// ── OpenAI-compatible provider (Plan 11) ──────────────────────────────────────

/**
 * Returns true when both OPENAI_COMPATIBLE_API_KEY and OPENAI_COMPATIBLE_BASE_URL
 * are set — the minimum required to construct a request.
 *
 * The model is optional (getOpenAICompatibleModel() has a hard-coded default) so
 * only key + URL are checked. Pattern mirrors isOAuthConfigured().
 */
export function isOpenAICompatibleConfigured(): boolean {
  return Boolean(
    process.env.OPENAI_COMPATIBLE_API_KEY &&
    process.env.OPENAI_COMPATIBLE_BASE_URL,
  );
}

/**
 * Returns the OpenAI-compatible provider API key.
 * Throws at call-time if the variable is unset. Never logs the key value.
 */
export function getOpenAICompatibleApiKey(): string {
  const key = process.env.OPENAI_COMPATIBLE_API_KEY;
  if (!key) {
    throw new Error(
      'OPENAI_COMPATIBLE_API_KEY is not set. Add it to .env.local and restart the dev server.',
    );
  }
  return key;
}

/**
 * Returns the base URL for the OpenAI-compatible endpoint (e.g.
 * https://integrate.api.nvidia.com/v1 for NVIDIA NIM).
 * Trailing slash is stripped by the provider at call time, not here.
 * Throws at call-time if the variable is unset.
 */
export function getOpenAICompatibleBaseUrl(): string {
  const url = process.env.OPENAI_COMPATIBLE_BASE_URL;
  if (!url) {
    throw new Error(
      'OPENAI_COMPATIBLE_BASE_URL is not set. Add it to .env.local and restart the dev server.',
    );
  }
  return url;
}

/**
 * Returns the configured model ID for the OpenAI-compatible provider.
 * Defaults to meta/llama-3.1-8b-instruct — confirmed callable on a real NVIDIA
 * NIM free-tier account (2026-08-20; see .env.example for other confirmed-working
 * options and why not every catalog-listed model is actually callable). Override
 * with OPENAI_COMPATIBLE_MODEL.
 */
export function getOpenAICompatibleModel(): string {
  return process.env.OPENAI_COMPATIBLE_MODEL ?? 'meta/llama-3.1-8b-instruct';
}

/**
 * Returns the JWT secret as a Uint8Array suitable for jose HS256.
 *
 * Validates at call-time:
 *   - The variable must be set.
 *   - The value must be ≥ 32 characters (a short HMAC secret is forgeable —
 *     this is the single most common way a JWT deployment is broken silently).
 *
 * Never logs or returns the raw string. The secret is the one value this module
 * touches that should never be rendered in any log line or error message.
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Add it to .env.local (≥ 32 random characters).',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      'JWT_SECRET is too short — must be ≥ 32 characters to be cryptographically safe.',
    );
  }
  return new TextEncoder().encode(secret);
}

// ── Email (Resend) — Plan 14 ──────────────────────────────────────────────────

/**
 * Returns true when the required email env-var group (RESEND_API_KEY, EMAIL_FROM,
 * APP_BASE_URL) is fully set. All-or-nothing, like OAuth (§4.6): a fresh install
 * with none of these set behaves exactly as today — codes are copied by hand,
 * nothing errors, nothing warns at boot.
 */
export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY &&
    process.env.EMAIL_FROM &&
    process.env.APP_BASE_URL,
  );
}

/**
 * Returns the Resend API key. Throws at call-time if unset — never logged, never
 * returned in an error message. Read at call time (not module load) so a
 * deployment with no email configured still boots and still runs everything else.
 */
export function getResendApiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error(
      'RESEND_API_KEY is not set. Add it to .env.local and restart the dev server.',
    );
  }
  return key;
}

/**
 * Returns the configured From: address, e.g. "MyAgentStudio <noreply@myagentstudio.dev>".
 * Throws at call-time if unset.
 */
export function getEmailFrom(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error(
      'EMAIL_FROM is not set. Add it to .env.local and restart the dev server.',
    );
  }
  return from;
}

/**
 * Returns the absolute app origin used to build links inside emails (e.g.
 * https://myagentstudio.dev). Throws at call-time if unset.
 *
 * A separate variable from OAUTH_REDIRECT_BASE_URL (§4.6) — that one is optional
 * and OAuth-scoped, and quietly overloading it would make disabling OAuth
 * silently break email links.
 */
export function getAppBaseUrl(): string {
  const url = process.env.APP_BASE_URL;
  if (!url) {
    throw new Error(
      'APP_BASE_URL is not set. Add it to .env.local and restart the dev server.',
    );
  }
  return url;
}

/**
 * Returns the Reply-To address, or null when unset (D2 — optional; absent means
 * no reply-to header is sent).
 */
export function getEmailReplyTo(): string | null {
  return process.env.EMAIL_REPLY_TO || null;
}

/**
 * Returns the fixed admin-notification recipient, or null when unset (D4 —
 * optional, required only if the admin-notice trigger is built). Deliberately
 * env-configured rather than read from the admin user's own row, so a role
 * change never silently redirects operational mail.
 */
export function getAdminNotificationEmail(): string | null {
  return process.env.ADMIN_NOTIFICATION_EMAIL || null;
}

/**
 * Eagerly validates required server-side environment variables.
 *
 * Called once at startup via instrumentation.ts so that a misconfigured
 * deploy fails at boot rather than on the first auth call (§3.2).
 *
 * Deliberately does NOT check ANTHROPIC_API_KEY — that is legitimately
 * optional at boot when the deployment is in dry-run mode (Plan 04).
 */
export function assertServerEnv(): void {
  // Calling getJwtSecret() is sufficient — it throws with a helpful message
  // if the secret is absent or too short.
  getJwtSecret();
  // Validate SESSION_TTL_SECONDS at boot so a typo'd value fails loudly rather
  // than silently falling back to 7 days (constraint 4, §3.2).
  getSessionTtlSeconds();
  // OAuth is all-or-nothing: none set → disabled (fine); all set → validated;
  // some set → throw, because a partial config produces a "Continue with Google"
  // button that leads to a provider error page (§3.4).
  _assertOAuthEnv();
  // Email is all-or-nothing too (§4.6): none set → disabled (fine); all set →
  // validated; some set → throw, because a partial config produces a "we'll
  // email you" promise that silently never fires.
  _assertEmailEnv();
}

/**
 * Validates the three OAuth env vars.
 *
 * Rules (§3.4):
 *   - None set → OAuth disabled; app runs normally (password auth only). No error.
 *   - Some but not all set → throw (partial config is worse than none).
 *   - All set → `OAUTH_REDIRECT_BASE_URL` must be an absolute URL, scheme http/https,
 *     no path/query/fragment, no trailing slash. In production it must be https.
 *
 * Extracted as its own function so the sessionTtl test suite can import
 * `assertServerEnv()` without triggering OAuth validation side-effects.
 *
 * @internal
 */
export function _assertOAuthEnv(): void {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const base = process.env.OAUTH_REDIRECT_BASE_URL;

  const setCount = [id, secret, base].filter((v) => v && v !== '').length;

  if (setCount === 0) return; // OAuth disabled — fine

  if (setCount > 0 && setCount < 3) {
    throw new Error(
      'OAuth is partially configured — set all three of GOOGLE_CLIENT_ID, ' +
      'GOOGLE_CLIENT_SECRET, and OAUTH_REDIRECT_BASE_URL, or none of them.',
    );
  }

  // All three set — validate OAUTH_REDIRECT_BASE_URL
  const raw = base!;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `OAUTH_REDIRECT_BASE_URL must be a valid absolute URL (got: ${raw}).`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `OAUTH_REDIRECT_BASE_URL must use the http or https scheme (got: ${url.protocol}).`,
    );
  }

  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(
      'OAUTH_REDIRECT_BASE_URL must be scheme+host+optional-port only — ' +
      `no path, query, or fragment (got: ${raw}).`,
    );
  }

  if (raw.endsWith('/')) {
    throw new Error(
      `OAUTH_REDIRECT_BASE_URL must not have a trailing slash (got: ${raw}).`,
    );
  }

  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error(
      `OAUTH_REDIRECT_BASE_URL must use https in production (got: ${raw}).`,
    );
  }
}

/**
 * Validates the required email env-var group.
 *
 * Rules (§4.6), same all-or-nothing shape as _assertOAuthEnv:
 *   - None of RESEND_API_KEY / EMAIL_FROM / APP_BASE_URL set → email disabled;
 *     app runs exactly as today. No error.
 *   - Some but not all set → throw (a partial config produces a "we'll email
 *     you" promise that silently never fires).
 *   - All set → APP_BASE_URL must be an absolute URL, scheme http/https, no
 *     path/query/fragment, no trailing slash. In production it must be https.
 *
 * EMAIL_REPLY_TO and ADMIN_NOTIFICATION_EMAIL are deliberately NOT part of this
 * group — both are optional (D2, D4) and read via their own getters, which
 * return null rather than throw when unset.
 *
 * @internal
 */
export function _assertEmailEnv(): void {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const appBaseUrl = process.env.APP_BASE_URL;

  const setCount = [apiKey, from, appBaseUrl].filter((v) => v && v !== '').length;

  if (setCount === 0) return; // Email disabled — fine

  if (setCount > 0 && setCount < 3) {
    throw new Error(
      'Email is partially configured — set all three of RESEND_API_KEY, ' +
      'EMAIL_FROM, and APP_BASE_URL, or none of them.',
    );
  }

  // All three set — validate APP_BASE_URL
  const raw = appBaseUrl!;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `APP_BASE_URL must be a valid absolute URL (got: ${raw}).`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `APP_BASE_URL must use the http or https scheme (got: ${url.protocol}).`,
    );
  }

  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(
      'APP_BASE_URL must be scheme+host+optional-port only — ' +
      `no path, query, or fragment (got: ${raw}).`,
    );
  }

  if (raw.endsWith('/')) {
    throw new Error(
      `APP_BASE_URL must not have a trailing slash (got: ${raw}).`,
    );
  }

  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error(
      `APP_BASE_URL must use https in production (got: ${raw}).`,
    );
  }
}
