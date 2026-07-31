/**
 * instrumentation.ts (repo root)
 *
 * Next.js server startup hook — stable since Next 15.
 * Next runs `register()` once per process start, before any request is served.
 *
 * This is where we call `assertServerEnv()` so that a missing or too-short
 * JWT_SECRET causes the process to exit at boot rather than failing silently
 * on the first login attempt (§3.2).
 *
 * ANTHROPIC_API_KEY is deliberately NOT checked here — it is legitimately
 * absent in dry-run mode (Plan 04), which is a supported deployment state.
 */

export async function register() {
  // Only run in the Node.js runtime (not the Edge runtime, which cannot read
  // better-sqlite3 or perform any server-only work). next/instrumentation
  // calls register() once per runtime, so guard against the edge variant.
  if (process.env.NEXT_RUNTIME === 'nodejs' || !process.env.NEXT_RUNTIME) {
    // Dynamic import keeps this file importable in the Edge context even though
    // lib/env.ts has `import 'server-only'` — the Edge copy never evaluates it.
    const { assertServerEnv } = await import('./lib/env.js');
    assertServerEnv();
  }
}
