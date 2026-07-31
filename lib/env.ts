import 'server-only';

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
}
