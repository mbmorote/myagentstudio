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
